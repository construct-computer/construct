import Docker from 'dockerode';
import { updateAgent, getAgentConfig, createActivityLog } from '../db/client';
import { decrypt } from './crypto.service';
import type { Agent, AgentConfig } from '../db/schema';
import { dump as yamlDump } from 'js-yaml';

const docker = new Docker();

/**
 * Generate boneclaw config YAML with user's settings
 */
function generateBoneclawConfig(config: {
  apiKey: string;
  model: string;
  identityName?: string;
  identityDescription?: string;
  goals?: string;
}): string {
  const boneclawConfig = {
    telegram: {
      token: '',
      allowed_users: [],
    },
    llm: {
      default_provider: 'openrouter',
      default_model: config.model,
      openrouter: {
        api_key: config.apiKey,
      },
      // No fallback providers - OpenRouter only
      fallback: [],
    },
    agent: {
      max_tool_iterations: 25,
      max_context_tokens: 100000,
      compact_after_messages: 50,
      system_prompt: `You are ${config.identityName || 'BoneClaw'}, an AI agent operating a virtual desktop computer visible to the user. ${config.identityDescription || ''}

${config.goals ? `Your goals:\n${config.goals}\n` : ''}
Everything you do must happen through the desktop apps (browser, terminal, editor) — never use invisible tools like curl or wget. The user is watching your screen.

When searching the web, always use Brave Search (https://search.brave.com/search?q=...) instead of Google.

Call tools immediately without explaining what you're about to do.

## Browser workflow
Use browser_snapshot to see the page. It returns an accessibility tree with element refs like @e1, @e2, etc. Use these refs with browser_click, browser_fill, browser_hover, and browser_select for precise, reliable interaction — refs are much more reliable than coordinate-based clicking.

Typical flow:
1. browser_navigate to go to a URL
2. browser_snapshot to see what's on the page
3. browser_click with a ref (e.g. "@e5") to click a button or link
4. browser_fill with a ref and text to fill an input field
5. browser_snapshot again to see the result

Use browser_press for keyboard shortcuts (e.g. "Enter", "Tab", "Control+a"). Use browser_scroll to scroll the page. Use browser_wait when you need to wait for content to load.`,
    },
    tools: {
      enabled: [
        'exec',
        'file_read',
        'file_write',
        'file_edit',
        'memory_save',
        'memory_search',
        'memory_get',
        'memory_delete',
        'desktop',
      ],
      exec: {
        workspace: '/home/sandbox/workspace',
        timeout: '30s',
      },
      fs: {
        workspace: '/home/sandbox/workspace',
      },
    },
    mcp: {
      servers: [
        {
          name: 'desktop',
          transport: 'stdio',
          command: 'node',
          args: ['/opt/browser-server/dist/desktop-mcp.js'],
        },
      ],
    },
    transport: {
      http: {
        enabled: true,
        port: 9223,
      },
    },
    memory: {
      db_path: '/home/sandbox/.boneclaw/memory.db',
      wal_mode: true,
    },
    logging: {
      level: 'info',
      format: 'json',
    },
  };

  return yamlDump(boneclawConfig, { lineWidth: -1 });
}

/**
 * Configure boneclaw in a running container
 */
async function configureBoneclaw(container: Docker.Container, agentConfig: AgentConfig): Promise<void> {
  // Decrypt API key (may be empty if user hasn't configured yet)
  let apiKey = '';
  if (agentConfig.openrouterKeyEncrypted) {
    try {
      apiKey = await decrypt(agentConfig.openrouterKeyEncrypted);
    } catch {
      // Key might be empty or invalid, that's ok
      apiKey = '';
    }
  }
  
  // Generate config YAML
  const configYaml = generateBoneclawConfig({
    apiKey,
    model: agentConfig.model,
    identityName: agentConfig.identityName,
    identityDescription: agentConfig.identityDescription,
    goals: agentConfig.goals,
  });
  
  // Write config to container
  const exec = await container.exec({
    Cmd: ['sh', '-c', `cat > /etc/boneclaw/config.yaml << 'EOFCONFIG'\n${configYaml}\nEOFCONFIG`],
    User: 'root',
  });
  await exec.start({ Detach: false });
  
  // Restart boneclaw to pick up new config
  const restartExec = await container.exec({
    Cmd: ['supervisorctl', 'restart', 'boneclaw'],
    User: 'root',
  });
  await restartExec.start({ Detach: false });
}

// Container image name
const BONECLAW_IMAGE = 'boneclaw-runtime:latest';

// Resource limits
const CONTAINER_LIMITS = {
  memory: 1024 * 1024 * 1024, // 1GB
  cpuShares: 1024,            // 1 CPU
  // Storage is managed via volumes
};

// Port range for container services
const PORT_RANGE_START = 19000;

export interface ContainerInfo {
  id: string;
  status: string;
  ports: {
    browserStream?: number;
    ptyServer?: number;
  };
}

/**
 * Create and start a container for an agent
 */
export async function createContainer(agent: Agent): Promise<ContainerInfo> {
  const config = getAgentConfig(agent.id);
  if (!config) {
    throw new Error('Agent config not found');
  }
  
  // Calculate unique ports for this container
  // Use agent ID hash to get consistent ports
  const portOffset = Math.abs(hashCode(agent.id)) % 1000;
  const browserStreamPort = PORT_RANGE_START + portOffset;
  const ptyServerPort = PORT_RANGE_START + portOffset + 1;

  // Minimal environment variables (boneclaw config is written to file after start)
  const env = [
    `AGENT_BROWSER_STREAM_PORT=9223`,
    `PTY_SERVER_PORT=9224`,
  ];

  try {
    // Create container
    const container = await docker.createContainer({
      Image: BONECLAW_IMAGE,
      name: `boneclaw-${agent.id}`,
      Env: env,
      HostConfig: {
        Memory: CONTAINER_LIMITS.memory,
        CpuShares: CONTAINER_LIMITS.cpuShares,
        PortBindings: {
          '9223/tcp': [{ HostPort: String(browserStreamPort) }],
          '9224/tcp': [{ HostPort: String(ptyServerPort) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
        // Mount persistent volume for agent data
        Binds: [
          `boneclaw-data-${agent.id}:/home/sandbox/.boneclaw:rw`,
        ],
      },
      ExposedPorts: {
        '9223/tcp': {},
        '9224/tcp': {},
      },
      Labels: {
        'construct.agent_id': agent.id,
        'construct.user_id': agent.userId,
      },
    });

    // Start container
    await container.start();
    
    // Configure boneclaw with user's settings (writes config file and restarts boneclaw)
    await configureBoneclaw(container, config);

    // Update agent with container ID
    updateAgent(agent.id, {
      containerId: container.id,
      status: 'running',
    });

    // Log activity
    createActivityLog(agent.id, 'container:started', {
      containerId: container.id,
      browserStreamPort,
      ptyServerPort,
    });

    return {
      id: container.id,
      status: 'running',
      ports: {
        browserStream: browserStreamPort,
        ptyServer: ptyServerPort,
      },
    };
  } catch (error) {
    updateAgent(agent.id, { status: 'error' });
    createActivityLog(agent.id, 'container:error', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get container info for an agent
 */
export async function getContainerInfo(agent: Agent): Promise<ContainerInfo | null> {
  if (!agent.containerId) return null;

  try {
    const container = docker.getContainer(agent.containerId);
    const info = await container.inspect();
    
    const browserStreamPort = info.NetworkSettings.Ports['9223/tcp']?.[0]?.HostPort;
    const ptyServerPort = info.NetworkSettings.Ports['9224/tcp']?.[0]?.HostPort;

    return {
      id: agent.containerId,
      status: info.State.Running ? 'running' : 'stopped',
      ports: {
        browserStream: browserStreamPort ? parseInt(browserStreamPort) : undefined,
        ptyServer: ptyServerPort ? parseInt(ptyServerPort) : undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Start a stopped container
 */
export async function startContainer(agent: Agent): Promise<void> {
  if (!agent.containerId) {
    throw new Error('No container found for agent');
  }

  const config = getAgentConfig(agent.id);
  if (!config) {
    throw new Error('Agent config not found');
  }

  const container = docker.getContainer(agent.containerId);
  await container.start();
  
  // Reconfigure boneclaw with latest settings
  await configureBoneclaw(container, config);
  
  updateAgent(agent.id, { status: 'running' });
  createActivityLog(agent.id, 'container:started', { containerId: agent.containerId });
}

/**
 * Stop a running container
 */
export async function stopContainer(agent: Agent): Promise<void> {
  if (!agent.containerId) {
    throw new Error('No container found for agent');
  }

  const container = docker.getContainer(agent.containerId);
  await container.stop();
  
  updateAgent(agent.id, { status: 'stopped' });
  createActivityLog(agent.id, 'container:stopped', { containerId: agent.containerId });
}

/**
 * Reconfigure boneclaw in a running container (after settings change)
 */
export async function reconfigureContainer(agent: Agent): Promise<void> {
  if (!agent.containerId) {
    throw new Error('No container found for agent');
  }

  const config = getAgentConfig(agent.id);
  if (!config) {
    throw new Error('Agent config not found');
  }

  const container = docker.getContainer(agent.containerId);
  
  // Check if container is running
  const info = await container.inspect();
  if (!info.State.Running) {
    throw new Error('Container is not running');
  }
  
  await configureBoneclaw(container, config);
  createActivityLog(agent.id, 'container:reconfigured', { containerId: agent.containerId });
}

/**
 * Remove a container
 */
export async function removeContainer(agent: Agent): Promise<void> {
  if (!agent.containerId) return;

  try {
    const container = docker.getContainer(agent.containerId);
    await container.stop().catch(() => {}); // Ignore if already stopped
    await container.remove({ force: true });
    
    updateAgent(agent.id, { containerId: null, status: 'stopped' });
    createActivityLog(agent.id, 'container:removed', { containerId: agent.containerId });
  } catch {
    // Container might not exist
  }
}

/**
 * Execute a command in a container
 */
export async function execInContainer(
  agent: Agent,
  command: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!agent.containerId) {
    throw new Error('No container found for agent');
  }

  const container = docker.getContainer(agent.containerId);
  
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ Detach: false });
  
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    
    stream.on('data', (chunk: Buffer) => {
      // Docker multiplexes stdout/stderr with a header
      // First byte: stream type (1=stdout, 2=stderr)
      // Bytes 5-8: size
      // Rest: data
      const header = chunk.slice(0, 8);
      const streamType = header[0];
      const data = chunk.slice(8).toString();
      
      if (streamType === 1) {
        stdout += data;
      } else if (streamType === 2) {
        stderr += data;
      }
    });
    
    stream.on('end', async () => {
      const inspect = await exec.inspect();
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: inspect.ExitCode ?? 0,
      });
    });
    
    stream.on('error', reject);
  });
}

/**
 * Send a message to the boneclaw agent in a container
 */
export async function sendMessageToAgent(agent: Agent, message: string): Promise<void> {
  if (!agent.containerId) {
    throw new Error('No container found for agent');
  }

  // Write message to stdin of boneclaw process
  // BoneClaw in interactive mode reads JSON messages from stdin
  const jsonMessage = JSON.stringify({ type: 'message', content: message });
  
  const container = docker.getContainer(agent.containerId);
  
  const exec = await container.exec({
    Cmd: ['sh', '-c', `echo '${jsonMessage.replace(/'/g, "'\\''")}' >> /tmp/boneclaw-input`],
    AttachStdout: true,
    AttachStderr: true,
  });
  
  await exec.start({ Detach: false });
  
  createActivityLog(agent.id, 'agent:message_sent', { message });
}

/**
 * Get container logs
 */
export async function getContainerLogs(
  agent: Agent,
  tail: number = 100
): Promise<string> {
  if (!agent.containerId) {
    throw new Error('No container found for agent');
  }

  const container = docker.getContainer(agent.containerId);
  const logs = await container.logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
  });
  
  return logs.toString();
}

/**
 * Check if Docker is available
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the boneclaw runtime image exists
 */
export async function checkImageExists(): Promise<boolean> {
  try {
    await docker.getImage(BONECLAW_IMAGE).inspect();
    return true;
  } catch {
    return false;
  }
}

// Helper function to hash a string to a number
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}
