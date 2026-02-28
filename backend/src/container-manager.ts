import { spawn, ChildProcess, execSync, execFileSync, exec } from 'child_process'
import { EventEmitter } from 'events'
import { CONTAINER_PREFIX, SANDBOX_IMAGE, PORT_RANGE_START } from './constants'

export interface ContainerInfo {
  id: string
  instanceId: string
  status: 'creating' | 'running' | 'stopped' | 'error'
  ports: {
    http: number     // For user HTTP servers (container 3000 -> host)
    browser: number  // For browser WebSocket (container 9222 -> host)
    agent: number    // For boneclaw HTTP/WS transport (container 9223 -> host)
  }
  createdAt: Date
}

export interface DockerContainerStats {
  cpuPercent: number
  cpuCount: number
  memUsedBytes: number
  memTotalBytes: number
  pids: number
  netInBytes: number   // cumulative bytes received
  netOutBytes: number  // cumulative bytes sent
  uptime: number       // seconds since container creation
}

export class ContainerManager extends EventEmitter {
  private containers = new Map<string, ContainerInfo>()
  private nextPort = PORT_RANGE_START

  constructor() {
    super()
    console.log('[ContainerManager] Initialized')
  }

  async initialize(): Promise<void> {
    // Check if Docker is available
    try {
      execSync('docker info', { stdio: 'pipe' })
      console.log('[ContainerManager] Docker is available')
    } catch {
      throw new Error('Docker is not available. Please install and start Docker.')
    }

    // Build sandbox image if it doesn't exist
    await this.ensureImage()
  }

  private async ensureImage(): Promise<void> {
    try {
      execSync(`docker image inspect ${SANDBOX_IMAGE}`, { stdio: 'pipe' })
      console.log(`[ContainerManager] Image ${SANDBOX_IMAGE} exists`)
    } catch {
      console.log(`[ContainerManager] Image ${SANDBOX_IMAGE} not found`)
      // In redo, we expect the image to exist from production build
      // Don't auto-build here - just log a warning
      console.warn(`[ContainerManager] Please build the sandbox image: docker build -t ${SANDBOX_IMAGE} ../production/apps/sandbox`)
    }
  }

  /**
   * Discover running sandbox containers from Docker.
   * Returns a map of instanceId -> { containerId, ports }.
   */
  discoverRunningContainers(): Map<string, { containerId: string; ports: { http: number; browser: number; agent: number } }> {
    const discovered = new Map<string, { containerId: string; ports: { http: number; browser: number; agent: number } }>()

    try {
      // List running containers matching our prefix, with port info
      const result = execSync(
        `docker ps --filter "name=${CONTAINER_PREFIX}" --format "{{.ID}}\t{{.Names}}\t{{.Ports}}"`,
        { encoding: 'utf-8' }
      ).trim()

      if (!result) return discovered

      for (const line of result.split('\n').filter(Boolean)) {
        const [containerId, name, portsStr] = line.split('\t')
        const instanceId = name.replace(CONTAINER_PREFIX, '')

        // Parse port mappings like "0.0.0.0:10000->3000/tcp, 0.0.0.0:10001->9222/tcp, 0.0.0.0:10002->9223/tcp"
        const portMap: Record<number, number> = {}
        const portMatches = portsStr.matchAll(/(\d+)->(\d+)\/tcp/g)
        for (const m of portMatches) {
          portMap[parseInt(m[2])] = parseInt(m[1])
        }

        if (portMap[9222] && portMap[9223]) {
          discovered.set(instanceId, {
            containerId: containerId.slice(0, 12),
            ports: {
              http: portMap[3000] || 0,
              browser: portMap[9222],
              agent: portMap[9223],
            },
          })
        }
      }
    } catch (e) {
      console.error('[ContainerManager] Error discovering containers:', e)
    }

    return discovered
  }

  /**
   * Re-adopt a running container into the in-memory state.
   * Used on startup to reconnect to containers that survived a backend restart.
   */
  adoptContainer(instanceId: string, containerId: string, ports: { http: number; browser: number; agent: number }): void {
    const info: ContainerInfo = {
      id: containerId,
      instanceId,
      status: 'running',
      ports,
      createdAt: new Date(), // approximate — real creation time is in Docker
    }
    this.containers.set(instanceId, info)

    // Advance nextPort past the highest adopted port to avoid collisions
    const maxPort = Math.max(ports.http, ports.browser, ports.agent)
    if (maxPort >= this.nextPort) {
      this.nextPort = maxPort + 1
    }

    console.log(`[ContainerManager] Re-adopted container ${containerId} for instance ${instanceId} (ports: ${ports.http}/${ports.browser}/${ports.agent})`)
  }

  /**
   * Remove any sandbox containers that are not in the set of known instance IDs.
   */
  async cleanupOrphans(knownInstanceIds: Set<string>): Promise<void> {
    try {
      const result = execSync(
        `docker ps -a --filter "name=${CONTAINER_PREFIX}" --format "{{.ID}}\t{{.Names}}"`,
        { encoding: 'utf-8' }
      ).trim()

      if (!result) return

      for (const line of result.split('\n').filter(Boolean)) {
        const [id, name] = line.split('\t')
        const instanceId = name.replace(CONTAINER_PREFIX, '')
        if (!knownInstanceIds.has(instanceId)) {
          console.log(`[ContainerManager] Cleaning up orphan container: ${name} (${id})`)
          execFileSync('docker', ['rm', '-f', id], { stdio: 'pipe' })
        }
      }
    } catch (e) {
      console.error('[ContainerManager] Error cleaning up orphans:', e)
    }
  }

  private imageExists(): boolean {
    try {
      execSync(`docker image inspect ${SANDBOX_IMAGE}`, { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  async createContainer(instanceId: string): Promise<ContainerInfo> {
    // Fail fast with a clear message if the Docker image hasn't been built
    if (!this.imageExists()) {
      throw new Error(
        `Docker image "${SANDBOX_IMAGE}" not found. Run ./scripts/build.sh docker to build it.`
      )
    }

    const containerName = `${CONTAINER_PREFIX}${instanceId}`

    // Reserve ports only after successful creation to avoid leaking on failure
    const httpPort = this.nextPort
    const browserPort = this.nextPort + 1
    const agentPort = this.nextPort + 2

    console.log(`[ContainerManager] Creating container ${containerName}`)

    try {
      // Create and start container
      // Port mappings:
      // - httpPort -> 3000: For user HTTP servers inside container
      // - browserPort -> 9222: For browser WebSocket server inside container
      // - agentPort -> 9223: For boneclaw HTTP/WS transport
      const containerId = execSync(
        `docker run -d \
          --name ${containerName} \
          --hostname sandbox \
          --memory=1g \
          --cpus=1 \
          --pids-limit=512 \
          --storage-opt size=20g \
          -p ${httpPort}:3000 \
          -p ${browserPort}:9222 \
          -p ${agentPort}:9223 \
          ${SANDBOX_IMAGE}`,
        { encoding: 'utf-8' }
      ).trim()

      // Commit port allocation only on success
      this.nextPort += 3

      const info: ContainerInfo = {
        id: containerId.slice(0, 12),
        instanceId,
        status: 'running',
        ports: { http: httpPort, browser: browserPort, agent: agentPort },
        createdAt: new Date(),
      }
      
      this.containers.set(instanceId, info)
      console.log(`[ContainerManager] Container ${info.id} created for ${instanceId}`)

      return info
    } catch (e) {
      console.error(`[ContainerManager] Failed to create container for ${instanceId}:`, e)
      throw e
    }
  }

  /**
   * Reboot a container: destroy the existing one and create a fresh one.
   * Preserves the boneclaw config YAML from the old container.
   */
  async rebootContainer(instanceId: string): Promise<ContainerInfo> {
    const existing = this.containers.get(instanceId)

    // Preserve the boneclaw config from the old container
    let savedConfig: string | null = null
    if (existing) {
      try {
        const containerName = `${CONTAINER_PREFIX}${instanceId}`
        savedConfig = execFileSync(
          'docker', ['exec', containerName, 'cat', '/etc/boneclaw/config.yaml'],
          { encoding: 'utf-8', timeout: 5000 }
        )
        console.log(`[ContainerManager] Preserved boneclaw config for ${instanceId}`)
      } catch {
        console.warn(`[ContainerManager] Could not read boneclaw config from ${instanceId}, new container will use defaults`)
      }
    }

    // Destroy old container
    await this.destroyContainer(instanceId)

    // Create fresh container
    const info = await this.createContainer(instanceId)

    // Restore the boneclaw config into the new container
    if (savedConfig) {
      try {
        const containerName = `${CONTAINER_PREFIX}${instanceId}`
        // Pipe config content via stdin to avoid shell injection
        const buf = Buffer.from(savedConfig)
        execFileSync('docker', ['exec', '-i', containerName, 'tee', '/etc/boneclaw/config.yaml'], {
          input: buf,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        })
        // Restart boneclaw so it picks up the restored config
        execFileSync('docker', ['exec', containerName, 'supervisorctl', 'restart', 'boneclaw'], {
          stdio: 'pipe',
          timeout: 10000,
        })
        console.log(`[ContainerManager] Restored boneclaw config and restarted agent for ${instanceId}`)
      } catch (e) {
        console.error(`[ContainerManager] Failed to restore boneclaw config for ${instanceId}:`, e)
      }
    }

    return info
  }

  async destroyContainer(instanceId: string): Promise<void> {
    const info = this.containers.get(instanceId)
    if (!info) return

    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    console.log(`[ContainerManager] Destroying container ${containerName}`)

    try {
      execFileSync('docker', ['rm', '-f', containerName], { stdio: 'pipe' })
      this.containers.delete(instanceId)
      console.log(`[ContainerManager] Container ${containerName} destroyed`)
    } catch (e) {
      console.error(`[ContainerManager] Failed to destroy container ${containerName}:`, e)
    }
  }

  async execInContainer(
    instanceId: string,
    command: string[],
    options: { interactive?: boolean; tty?: boolean } = {}
  ): Promise<ChildProcess> {
    const info = this.containers.get(instanceId)
    if (!info) {
      throw new Error(`Container not found for instance ${instanceId}`)
    }

    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    const flags = [
      options.interactive ? '-i' : '',
      options.tty ? '-t' : '',
    ].filter(Boolean).join(' ')

    const args = ['exec', ...flags.split(' ').filter(Boolean), containerName, ...command]
    
    return spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  // Spawn an interactive shell in the container - returns a PTY-like interface
  spawnShell(instanceId: string): ChildProcess {
    const info = this.containers.get(instanceId)
    if (!info) {
      throw new Error(`Container not found for instance ${instanceId}`)
    }

    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    
    // Use docker exec with -it flags for interactive terminal
    const proc = spawn('docker', [
      'exec',
      '-i',
      '-t',
      '-e', 'TERM=xterm-256color',
      '-w', '/home/sandbox/workspace',
      containerName,
      '/bin/bash',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return proc
  }

  getContainer(instanceId: string): ContainerInfo | undefined {
    return this.containers.get(instanceId)
  }

  getContainerName(instanceId: string): string {
    return `${CONTAINER_PREFIX}${instanceId}`
  }

  async readFile(instanceId: string, filePath: string): Promise<string> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    return execFileSync('docker', ['exec', containerName, 'cat', filePath], {
      encoding: 'utf-8',
    })
  }

  async readFileBinary(instanceId: string, filePath: string): Promise<Buffer> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    return execFileSync('docker', ['exec', containerName, 'cat', filePath], {
      encoding: 'buffer',
    })
  }

  async writeFileBinary(instanceId: string, filePath: string, content: Buffer): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    execFileSync('docker', ['exec', '-i', containerName, 'tee', filePath], {
      input: content,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  async listDirectory(instanceId: string, dirPath: string): Promise<Array<{ name: string; type: 'file' | 'directory' | 'symlink'; size: number; modified: string }>> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    const script = [
      `const fs=require('fs'),path=require('path'),dir=process.argv[1];`,
      `try{const items=fs.readdirSync(dir).map(name=>{try{`,
      `const s=fs.lstatSync(path.join(dir,name));`,
      `const type=s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file';`,
      `return{name,type,size:s.size,modified:s.mtime.toISOString()}}catch{return null}}).filter(Boolean);`,
      `process.stdout.write(JSON.stringify(items))}catch(e){process.stderr.write(e.message);process.exit(1)}`,
    ].join('')
    const output = execFileSync('docker', ['exec', containerName, 'node', '-e', script, dirPath], {
      encoding: 'utf-8',
      timeout: 10000,
    })
    return JSON.parse(output.trim())
  }

  async writeFile(instanceId: string, filePath: string, content: string): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    // Pipe content via stdin to avoid shell injection
    const buf = Buffer.from(content)
    execFileSync('docker', ['exec', '-i', containerName, 'tee', filePath], {
      input: buf,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  async createFile(instanceId: string, filePath: string): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    execFileSync('docker', ['exec', containerName, 'touch', filePath], {
      stdio: 'pipe',
      timeout: 10000,
    })
  }

  async createDirectory(instanceId: string, dirPath: string): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    execFileSync('docker', ['exec', containerName, 'mkdir', '-p', dirPath], {
      stdio: 'pipe',
      timeout: 10000,
    })
  }

  async deleteItem(instanceId: string, itemPath: string): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    execFileSync('docker', ['exec', containerName, 'rm', '-rf', itemPath], {
      stdio: 'pipe',
      timeout: 10000,
    })
  }

  async renameItem(instanceId: string, oldPath: string, newPath: string): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    execFileSync('docker', ['exec', containerName, 'mv', oldPath, newPath], {
      stdio: 'pipe',
      timeout: 10000,
    })
  }

  getStats(): { containers: number } {
    return {
      containers: this.containers.size,
    }
  }

  // ── Docker stats (accurate, host-side) ─────────────────────────────────────

  /**
   * Parse a Docker size string like "26.4MiB", "1GiB", "648B" into bytes.
   */
  private parseDockerSize(str: string): number {
    const match = str.trim().match(/^([\d.]+)\s*([A-Za-z]*)$/)
    if (!match) return 0
    const value = parseFloat(match[1])
    const unit = match[2].toLowerCase()
    const units: Record<string, number> = {
      'b': 1, '': 1,
      'kib': 1024, 'kb': 1000,
      'mib': 1024 ** 2, 'mb': 1000 ** 2,
      'gib': 1024 ** 3, 'gb': 1000 ** 3,
      'tib': 1024 ** 4, 'tb': 1000 ** 4,
    }
    return value * (units[unit] || 1)
  }

  /**
   * Collect accurate container stats via `docker stats` (non-blocking).
   * Returns CPU%, memory used/limit, PID count, network I/O, and uptime.
   * This runs on the host and reads from the Docker daemon directly,
   * bypassing unreliable in-container cgroup file reads.
   */
  getDockerContainerStats(instanceId: string): Promise<DockerContainerStats | null> {
    const info = this.containers.get(instanceId)
    if (!info?.id || info.status !== 'running') return Promise.resolve(null)

    return new Promise((resolve) => {
      exec(
        `docker stats ${info.id} --no-stream --format '{{json .}}'`,
        { encoding: 'utf-8', timeout: 5000 },
        (err, stdout) => {
          if (err || !stdout) return resolve(null)
          try {
            const data = JSON.parse(stdout.trim())

            // CPU%: "0.50%" → 0.5
            const cpuPercent = parseFloat((data.CPUPerc || '0').replace('%', '')) || 0

            // MemUsage: "26.4MiB / 1GiB" → bytes
            const memParts = (data.MemUsage || '0B / 0B').split('/')
            const memUsedBytes = this.parseDockerSize(memParts[0])
            const memTotalBytes = this.parseDockerSize(memParts[1])

            // PIDs
            const pids = parseInt(data.PIDs || '0', 10) || 0

            // NetIO: "648B / 0B" → cumulative bytes received / sent
            const netParts = (data.NetIO || '0B / 0B').split('/')
            const netInBytes = this.parseDockerSize(netParts[0]?.trim() || '0B')
            const netOutBytes = this.parseDockerSize(netParts[1]?.trim() || '0B')

            // Uptime from container creation time
            const uptime = Math.floor((Date.now() - info.createdAt.getTime()) / 1000)

            resolve({
              cpuPercent,
              cpuCount: 1,  // from --cpus=1 in docker run
              memUsedBytes,
              memTotalBytes,
              pids,
              netInBytes,
              netOutBytes,
              uptime,
            })
          } catch {
            resolve(null)
          }
        }
      )
    })
  }

  async shutdown(): Promise<void> {
    console.log('[ContainerManager] Shutting down...')
    
    for (const instanceId of this.containers.keys()) {
      await this.destroyContainer(instanceId)
    }

    console.log('[ContainerManager] Shutdown complete')
  }
}
