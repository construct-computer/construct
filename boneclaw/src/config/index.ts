import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Goal schema
const GoalSchema = z.object({
  id: z.string(),
  description: z.string(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  status: z.enum(['active', 'paused', 'completed']).default('active'),
  context: z.string().optional(),
});

// Schedule schema (cron-like)
const ScheduleSchema = z.object({
  id: z.string(),
  cron: z.string(), // Cron expression like "0 */2 * * *"
  action: z.string(),
  enabled: z.boolean().default(true),
});

// Full config schema
const ConfigSchema = z.object({
  openrouter: z.object({
    apiKey: z.string(),
    model: z.string().default('nvidia/nemotron-nano-9b-v2:free'),
    baseUrl: z.string().default('https://openrouter.ai/api/v1'),
  }),
  identity: z.object({
    name: z.string().default('BoneClaw Agent'),
    description: z.string().default('An autonomous AI agent'),
  }),
  goals: z.array(GoalSchema).default([]),
  schedules: z.array(ScheduleSchema).default([]),
  memory: z.object({
    persistPath: z.string().default('./.boneclaw/memory'),
    maxContextTokens: z.number().default(8000),
  }),
  heartbeat: z.object({
    intervalMs: z.number().default(60000),
  }),
  workspace: z.string().default(process.cwd()),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;

// Default config
const DEFAULT_CONFIG: Config = {
  openrouter: {
    apiKey: '',
    model: 'nvidia/nemotron-nano-9b-v2:free',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  identity: {
    name: 'BoneClaw Agent',
    description: 'An autonomous AI agent',
  },
  goals: [],
  schedules: [],
  memory: {
    persistPath: './.boneclaw/memory',
    maxContextTokens: 8000,
  },
  heartbeat: {
    intervalMs: 60000,
  },
  workspace: process.cwd(),
};

/**
 * Load config from file or environment
 */
export function loadConfig(configPath?: string): Config {
  let config: Partial<Config> = {};
  
  // Try to load from file
  const paths = [
    configPath,
    process.env.BONECLAW_CONFIG,
    join(process.cwd(), '.boneclaw', 'config.json'),
    join(process.env.HOME || '', '.boneclaw', 'config.json'),
  ].filter(Boolean) as string[];
  
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        config = JSON.parse(content);
        break;
      } catch {
        // Continue to next path
      }
    }
  }
  
  // Override with environment variables
  if (process.env.OPENROUTER_API_KEY) {
    config.openrouter = {
      ...config.openrouter,
      apiKey: process.env.OPENROUTER_API_KEY,
    };
  }
  
  if (process.env.OPENROUTER_MODEL) {
    config.openrouter = {
      ...config.openrouter,
      model: process.env.OPENROUTER_MODEL,
    };
  }
  
  if (process.env.BONECLAW_WORKSPACE) {
    config.workspace = process.env.BONECLAW_WORKSPACE;
  }
  
  // Merge with defaults and validate
  const merged = {
    ...DEFAULT_CONFIG,
    ...config,
    openrouter: { ...DEFAULT_CONFIG.openrouter, ...config.openrouter },
    identity: { ...DEFAULT_CONFIG.identity, ...config.identity },
    memory: { ...DEFAULT_CONFIG.memory, ...config.memory },
    heartbeat: { ...DEFAULT_CONFIG.heartbeat, ...config.heartbeat },
  };
  
  return ConfigSchema.parse(merged);
}

/**
 * Get a config value for display (masks sensitive values)
 */
export function getConfigSummary(config: Config): Record<string, unknown> {
  return {
    model: config.openrouter.model,
    name: config.identity.name,
    goals: config.goals.length,
    schedules: config.schedules.length,
    workspace: config.workspace,
    hasApiKey: !!config.openrouter.apiKey,
  };
}
