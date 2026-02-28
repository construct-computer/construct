#!/usr/bin/env bun

import { loadConfig, getConfigSummary } from './config';
import { runAutonomousLoop, runSingleInteraction } from './agent/autonomous';
import { emit, setBroadcastCallback } from './events/emitter';
import { startServer, broadcastEvent } from './server';
import { setTinyfishConfig } from './tools/web_search';

/**
 * Parse command line arguments
 */
function parseArgs(): {
  mode: 'autonomous' | 'interactive' | 'single';
  message?: string;
  configPath?: string;
} {
  const args = process.argv.slice(2);
  
  let mode: 'autonomous' | 'interactive' | 'single' = 'interactive';
  let message: string | undefined;
  let configPath: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--autonomous' || arg === '-a') {
      mode = 'autonomous';
    } else if (arg === '--message' || arg === '-m') {
      mode = 'single';
      message = args[++i];
    } else if (arg === '--config' || arg === '-c') {
      configPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      console.log('boneclaw 0.1.0');
      process.exit(0);
    } else if (!arg.startsWith('-') && !message) {
      // Treat positional argument as message
      mode = 'single';
      message = arg;
    }
  }
  
  return { mode, message, configPath };
}

function printHelp(): void {
  console.log(`
boneclaw - Lightweight AI agent for construct.computer

USAGE:
  boneclaw [OPTIONS] [MESSAGE]

OPTIONS:
  -a, --autonomous     Run in autonomous mode (24/7, goals/schedules)
  -m, --message TEXT   Run a single interaction with the given message
  -c, --config PATH    Path to config file
  -h, --help           Show this help
  -v, --version        Show version

MODES:
  autonomous:  Runs forever, executing goals and scheduled tasks
  interactive: Reads messages from stdin (for integration)
  single:      Runs one message and exits

ENVIRONMENT:
  OPENROUTER_API_KEY   OpenRouter API key (required)
  OPENROUTER_MODEL     Model to use (default: mistralai/mistral-7b-instruct:free)
  BONECLAW_CONFIG      Path to config file
  BONECLAW_WORKSPACE   Working directory

EXAMPLES:
  boneclaw "Search for AI news and summarize"
  boneclaw --autonomous
  boneclaw -c /path/to/config.json -m "Check my email"
`);
}

/**
 * Run interactive mode - runs HTTP server and reads messages from stdin
 */
async function runInteractiveMode(config: ReturnType<typeof loadConfig>): Promise<void> {
  const { AgentLoop } = await import('./agent/loop');
  const agentLoop = new AgentLoop({ config });
  const startTime = Date.now();
  
  // Wire up the broadcast callback so events go to WebSocket clients
  setBroadcastCallback(broadcastEvent);
  
  // Start HTTP server on port 9223 (default agent port)
  const port = parseInt(process.env.BONECLAW_PORT || '9223', 10);
  startServer({
    port,
    agentLoop,
    memory: agentLoop.getMemory(),
    sessions: agentLoop.getSessionManager(),
    startTime,
    config: {
      model: config.openrouter.model,
      provider: 'openrouter',
    },
    openrouter: {
      apiKey: config.openrouter.apiKey,
      baseUrl: config.openrouter.baseUrl,
    },
  });
  
  emit({
    type: 'agent:started',
    config: {
      name: config.identity.name,
      model: config.openrouter.model,
    },
  });
  
  // Read lines from stdin (for local testing/debugging)
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  process.stderr.write(`BoneClaw ready. HTTP server on port ${port}. Send messages via stdin or POST /chat.\n`);
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check for JSON commands
      if (trimmed.startsWith('{')) {
        try {
          const cmd = JSON.parse(trimmed);
          if (cmd.type === 'message' && cmd.content) {
            await agentLoop.run(cmd.content);
          } else if (cmd.type === 'shutdown') {
            process.exit(0);
          }
        } catch {
          // Not valid JSON, treat as plain message
          await agentLoop.run(trimmed);
        }
      } else {
        await agentLoop.run(trimmed);
      }
    }
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { mode, message, configPath } = parseArgs();
  
  // Load config
  let config;
  try {
    config = loadConfig(configPath);
  } catch (error) {
    console.error('Failed to load config:', error);
    process.exit(1);
  }
  
  // Warn about missing API key but don't crash — the HTTP server
  // needs to be running so the backend can connect and the user can
  // configure the key via the Settings UI.
  if (!config.openrouter.apiKey) {
    process.stderr.write('Warning: OPENROUTER_API_KEY is not set. Agent will start but cannot process messages until configured.\n');
  }
  
  // Initialize TinyFish config for the web_search tool
  setTinyfishConfig(config.tinyfish);
  
  // Log config summary to stderr (stdout is for events)
  process.stderr.write(`Config: ${JSON.stringify(getConfigSummary(config))}\n`);
  
  try {
    switch (mode) {
      case 'autonomous':
        await runAutonomousLoop({ config });
        break;
        
      case 'single':
        if (!message) {
          console.error('Error: Message is required for single mode');
          process.exit(1);
        }
        await runSingleInteraction(config, message);
        break;
        
      case 'interactive':
        await runInteractiveMode(config);
        break;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    emit({ type: 'agent:error', error: msg });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
