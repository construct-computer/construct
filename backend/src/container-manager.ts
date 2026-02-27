import { spawn, ChildProcess, execSync, execFileSync } from 'child_process'
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

  async createContainer(instanceId: string): Promise<ContainerInfo> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    const httpPort = this.nextPort++
    const browserPort = this.nextPort++
    const agentPort = this.nextPort++

    console.log(`[ContainerManager] Creating container ${containerName}`)

    const info: ContainerInfo = {
      id: '',
      instanceId,
      status: 'creating',
      ports: { http: httpPort, browser: browserPort, agent: agentPort },
      createdAt: new Date(),
    }

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
          --memory=512m \
          --cpus=1 \
          --pids-limit=512 \
          --security-opt=no-new-privileges \
          -p ${httpPort}:3000 \
          -p ${browserPort}:9222 \
          -p ${agentPort}:9223 \
          ${SANDBOX_IMAGE}`,
        { encoding: 'utf-8' }
      ).trim()

      info.id = containerId.slice(0, 12)
      info.status = 'running'
      
      this.containers.set(instanceId, info)
      console.log(`[ContainerManager] Container ${info.id} created for ${instanceId}`)

      return info
    } catch (e) {
      info.status = 'error'
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

  async writeFile(instanceId: string, filePath: string, content: string): Promise<void> {
    const containerName = `${CONTAINER_PREFIX}${instanceId}`
    // Pipe content via stdin to avoid shell injection
    const buf = Buffer.from(content)
    execFileSync('docker', ['exec', '-i', containerName, 'tee', filePath], {
      input: buf,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  getStats(): { containers: number } {
    return {
      containers: this.containers.size,
    }
  }

  async shutdown(): Promise<void> {
    console.log('[ContainerManager] Shutting down...')
    
    for (const instanceId of this.containers.keys()) {
      await this.destroyContainer(instanceId)
    }

    console.log('[ContainerManager] Shutdown complete')
  }
}
