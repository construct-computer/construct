import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Memory } from './index';

export interface SessionInfo {
  key: string;
  title: string;
  created: number;
  lastActivity: number;
}

interface SessionsManifest {
  sessions: SessionInfo[];
  activeKey: string;
}

const DEFAULT_SESSION_KEY = 'default';
const SESSIONS_DIR = 'sessions';
const MANIFEST_FILE = 'sessions.json';

/**
 * Manages multiple chat sessions, each backed by its own Memory instance.
 *
 * File layout:
 *   {basePath}/sessions.json                 — manifest
 *   {basePath}/sessions/{key}/memory.json    — per-session memory
 *   {basePath}/sessions/{key}/{date}.jsonl   — per-session daily log
 */
export class SessionManager {
  private basePath: string;
  private maxContextTokens: number;
  private manifest: SessionsManifest;
  /** Lazily-loaded Memory instances keyed by session key */
  private memories: Map<string, Memory> = new Map();

  constructor(basePath: string, maxContextTokens: number = 8000) {
    this.basePath = basePath;
    this.maxContextTokens = maxContextTokens;
    this.manifest = this.loadManifest();
    this.migrate();
  }

  // ── public API ──────────────────────────────────────────────

  /** Get (or lazily create) the Memory for a session. */
  getMemory(key: string): Memory {
    let mem = this.memories.get(key);
    if (mem) return mem;

    const sessionDir = this.sessionDir(key);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    mem = new Memory(sessionDir, this.maxContextTokens);
    this.memories.set(key, mem);
    return mem;
  }

  /** Generate a default "New Chat" / "New Chat 2" / … title. */
  private nextNewChatTitle(): string {
    const existing = this.manifest.sessions
      .map(s => s.title)
      .filter(t => t === 'New Chat' || /^New Chat \d+$/.test(t));

    if (existing.length === 0) return 'New Chat';

    // Find the next available number
    const nums = existing.map(t => {
      if (t === 'New Chat') return 1;
      return parseInt(t.replace('New Chat ', ''), 10);
    });
    const max = Math.max(...nums);
    return `New Chat ${max + 1}`;
  }

  /** Create a new session and return its info. */
  createSession(title?: string): SessionInfo {
    const key = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    const info: SessionInfo = {
      key,
      title: title || this.nextNewChatTitle(),
      created: now,
      lastActivity: now,
    };

    // Create directory + empty memory
    const dir = this.sessionDir(key);
    mkdirSync(dir, { recursive: true });

    this.manifest.sessions.push(info);
    this.manifest.activeKey = key;
    this.saveManifest();
    return info;
  }

  /** Delete a session. If it's the last one, a fresh "Chat 1" is created automatically. */
  deleteSession(key: string): boolean {
    const idx = this.manifest.sessions.findIndex(s => s.key === key);
    if (idx === -1) return false;

    this.manifest.sessions.splice(idx, 1);
    this.memories.delete(key);

    // If that was the last session, create a fresh default
    if (this.manifest.sessions.length === 0) {
      const now = Date.now();
      const newKey = crypto.randomUUID().slice(0, 8);
      const fresh: SessionInfo = {
        key: newKey,
        title: 'New Chat',
        created: now,
        lastActivity: now,
      };
      mkdirSync(this.sessionDir(newKey), { recursive: true });
      this.manifest.sessions.push(fresh);
      this.manifest.activeKey = newKey;
    } else if (this.manifest.activeKey === key) {
      // Deleted the active session — switch to most recent remaining
      const sorted = [...this.manifest.sessions].sort((a, b) => b.lastActivity - a.lastActivity);
      this.manifest.activeKey = sorted[0].key;
    }

    this.saveManifest();

    // Remove files for the deleted session
    const dir = this.sessionDir(key);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    return true;
  }

  /** List all sessions, most recently active first. */
  listSessions(): SessionInfo[] {
    return [...this.manifest.sessions].sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /** Get session info by key. */
  getSession(key: string): SessionInfo | undefined {
    return this.manifest.sessions.find(s => s.key === key);
  }

  /** Get the currently active session key. */
  getActiveKey(): string {
    return this.manifest.activeKey;
  }

  /** Switch the active session. */
  setActiveKey(key: string): boolean {
    if (!this.manifest.sessions.find(s => s.key === key)) return false;
    this.manifest.activeKey = key;
    this.saveManifest();
    return true;
  }

  /** Touch lastActivity on a session and persist manifest. */
  touchSession(key: string): void {
    const info = this.manifest.sessions.find(s => s.key === key);
    if (info) {
      info.lastActivity = Date.now();
      this.saveManifest();
    }
  }

  /** Rename a session. */
  renameSession(key: string, title: string): boolean {
    const info = this.manifest.sessions.find(s => s.key === key);
    if (!info) return false;
    info.title = title;
    this.saveManifest();
    return true;
  }

  // ── private helpers ─────────────────────────────────────────

  private sessionDir(key: string): string {
    return join(this.basePath, SESSIONS_DIR, key);
  }

  private manifestPath(): string {
    return join(this.basePath, MANIFEST_FILE);
  }

  private loadManifest(): SessionsManifest {
    const file = this.manifestPath();
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf-8'));
      } catch {
        // Corrupt manifest — fall through to create default
      }
    }
    // No manifest yet — will be created during migrate()
    return { sessions: [], activeKey: DEFAULT_SESSION_KEY };
  }

  private saveManifest(): void {
    const dir = this.basePath;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.manifestPath(), JSON.stringify(this.manifest, null, 2));
  }

  /**
   * Migrate from single-session layout to multi-session.
   * If {basePath}/memory.json exists (old format), move it into
   * {basePath}/sessions/default/memory.json and create the manifest.
   */
  private migrate(): void {
    const oldMemoryFile = join(this.basePath, 'memory.json');
    const defaultDir = this.sessionDir(DEFAULT_SESSION_KEY);
    const newMemoryFile = join(defaultDir, 'memory.json');

    if (existsSync(oldMemoryFile) && !existsSync(newMemoryFile)) {
      // Move old memory into the default session directory
      mkdirSync(defaultDir, { recursive: true });
      const data = readFileSync(oldMemoryFile, 'utf-8');
      writeFileSync(newMemoryFile, data);

      // Move any daily JSONL logs too
      const { readdirSync, renameSync } = require('fs');
      try {
        const files: string[] = readdirSync(this.basePath);
        for (const f of files) {
          if (f.endsWith('.jsonl')) {
            renameSync(join(this.basePath, f), join(defaultDir, f));
          }
        }
      } catch {
        // Best-effort migration of logs
      }

      // Remove old memory.json (data is now in sessions/default/)
      rmSync(oldMemoryFile, { force: true });
    }

    // Ensure at least the default session exists in the manifest
    if (this.manifest.sessions.length === 0) {
      const now = Date.now();
      this.manifest.sessions.push({
        key: DEFAULT_SESSION_KEY,
        title: 'New Chat',
        created: now,
        lastActivity: now,
      });
      this.manifest.activeKey = DEFAULT_SESSION_KEY;
    }

    // Ensure the active session directory exists
    const activeDir = this.sessionDir(this.manifest.activeKey);
    if (!existsSync(activeDir)) {
      mkdirSync(activeDir, { recursive: true });
    }

    this.saveManifest();
  }
}
