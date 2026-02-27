#!/usr/bin/env bun

import { loadConfig, getConfigSummary } from './config';
import { runAutonomousLoop, runSingleInteraction } from './agent/autonomous';
import { emit } from './events/emitter';

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
 * Run interactive mode - reads messages from stdin
 */
async function runInteractiveMode(config: ReturnType<typeof loadConfig>): Promise<void> {
  const { AgentLoop } = await import('./agent/loop');
  const agentLoop = new AgentLoop({ config });
  
  emit({
    type: 'agent:started',
    config: {
      name: config.identity.name,
      model: config.openrouter.model,
    },
  });
  
  // Read lines from stdin
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  process.stderr.write(`BoneClaw ready. Send messages via stdin.\n`);
  
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
  
  // Validate API key
  if (!config.openrouter.apiKey) {
    console.error('Error: OPENROUTER_API_KEY is required');
    console.error('Set it in your environment or config file.');
    process.exit(1);
  }
  
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
