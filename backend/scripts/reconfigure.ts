import { Database } from 'bun:sqlite';
import { decrypt } from '../src/services/crypto.service';
import { dump as yamlDump } from 'js-yaml';
import { $ } from 'bun';

const db = new Database('./data/construct.db');
const row = db.query("SELECT * FROM agent_configs WHERE agent_id = 'QCggKuSb85pnT9NlVjPOg'").get() as any;

const apiKey = await decrypt(row.openrouter_key_encrypted);
console.log('API Key decrypted, length:', apiKey.length);

const config = {
  llm: {
    default_provider: 'openrouter',
    default_model: row.model,
    openrouter: { api_key: apiKey },
    fallback: [],
  },
  agent: {
    max_tool_iterations: 25,
    max_context_tokens: 100000,
    compact_after_messages: 50,
    system_prompt: 'You are BoneClaw, an AI agent operating a virtual desktop.',
  },
  tools: {
    enabled: ['exec', 'file_read', 'file_write', 'file_edit', 'memory_save', 'memory_search', 'memory_get', 'memory_delete', 'desktop'],
    exec: { workspace: '/home/sandbox/workspace', timeout: '30s' },
    fs: { workspace: '/home/sandbox/workspace' },
  },
  mcp: {
    servers: [{ name: 'desktop', transport: 'stdio', command: 'node', args: ['/opt/browser-server/dist/desktop-mcp.js'] }],
  },
  transport: { http: { enabled: true, port: 9223 } },
  memory: { db_path: '/home/sandbox/.boneclaw/memory.db', wal_mode: true },
  logging: { level: 'info', format: 'json' },
};

const yaml = yamlDump(config, { lineWidth: -1 });

// Write config to a temp file and copy to container
await Bun.write('/tmp/boneclaw-config.yaml', yaml);
console.log('Config written to temp file');

// Copy to container
await $`docker cp /tmp/boneclaw-config.yaml sandbox-rCK_dOXmepx4:/etc/boneclaw/config.yaml`;
console.log('Config copied to container');

// Restart boneclaw
await $`docker exec sandbox-rCK_dOXmepx4 supervisorctl restart boneclaw`;
console.log('Boneclaw restarted');
