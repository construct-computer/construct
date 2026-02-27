import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type { Message } from '../llm/types';

export interface MemoryData {
  // Short-term: recent messages
  shortTerm: Message[];
  
  // Long-term: summarized knowledge
  longTerm: {
    facts: string[];        // Learned information
    skills: string[];       // Acquired capabilities
    relationships: string[]; // People/accounts interacted with
  };
  
  // Task-specific state
  taskState: Record<string, unknown>;
  
  // Timestamps
  lastActivity: number;
  created: number;
}

export interface MemorySummary {
  shortTermMessages: number;
  longTermFacts: number;
  longTermSkills: number;
  lastActivity: Date;
  created: Date;
}

const DEFAULT_MEMORY: MemoryData = {
  shortTerm: [],
  longTerm: {
    facts: [],
    skills: [],
    relationships: [],
  },
  taskState: {},
  lastActivity: Date.now(),
  created: Date.now(),
};

export class Memory {
  private data: MemoryData;
  private persistPath: string;
  private maxContextTokens: number;
  private dirty: boolean = false;

  constructor(persistPath: string, maxContextTokens: number = 8000) {
    this.persistPath = persistPath;
    this.maxContextTokens = maxContextTokens;
    this.data = this.load();
  }

  /**
   * Load memory from disk
   */
  private load(): MemoryData {
    const memoryFile = join(this.persistPath, 'memory.json');
    
    if (existsSync(memoryFile)) {
      try {
        const content = readFileSync(memoryFile, 'utf-8');
        return { ...DEFAULT_MEMORY, ...JSON.parse(content) };
      } catch {
        return { ...DEFAULT_MEMORY };
      }
    }
    
    return { ...DEFAULT_MEMORY };
  }

  /**
   * Persist memory to disk
   */
  async persist(): Promise<void> {
    if (!this.dirty) return;
    
    const dir = this.persistPath;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    const memoryFile = join(dir, 'memory.json');
    writeFileSync(memoryFile, JSON.stringify(this.data, null, 2));
    
    this.dirty = false;
  }

  /**
   * Add a message to short-term memory
   */
  addMessage(message: Message): void {
    this.data.shortTerm.push(message);
    this.data.lastActivity = Date.now();
    this.dirty = true;
    
    // Log to daily file
    this.logToDaily(message);
  }

  /**
   * Log message to daily file
   */
  private logToDaily(message: Message): void {
    const date = new Date().toISOString().split('T')[0];
    const dailyFile = join(this.persistPath, `${date}.jsonl`);
    
    const dir = dirname(dailyFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    appendFileSync(dailyFile, JSON.stringify({
      timestamp: Date.now(),
      ...message,
    }) + '\n');
  }

  /**
   * Get recent context within token budget
   * Simple estimation: ~4 chars per token
   */
  getRecentContext(maxTokens?: number): Message[] {
    const budget = maxTokens || this.maxContextTokens;
    const charBudget = budget * 4;
    
    const messages: Message[] = [];
    let charCount = 0;
    
    // Start from most recent
    for (let i = this.data.shortTerm.length - 1; i >= 0; i--) {
      const msg = this.data.shortTerm[i];
      const msgChars = JSON.stringify(msg).length;
      
      if (charCount + msgChars > charBudget) break;
      
      messages.unshift(msg);
      charCount += msgChars;
    }
    
    return messages;
  }

  /**
   * Add a fact to long-term memory
   */
  addFact(fact: string): void {
    if (!this.data.longTerm.facts.includes(fact)) {
      this.data.longTerm.facts.push(fact);
      this.dirty = true;
    }
  }

  /**
   * Add a skill to long-term memory
   */
  addSkill(skill: string): void {
    if (!this.data.longTerm.skills.includes(skill)) {
      this.data.longTerm.skills.push(skill);
      this.dirty = true;
    }
  }

  /**
   * Add a relationship to long-term memory
   */
  addRelationship(relationship: string): void {
    if (!this.data.longTerm.relationships.includes(relationship)) {
      this.data.longTerm.relationships.push(relationship);
      this.dirty = true;
    }
  }

  /**
   * Set task state
   */
  setTaskState(key: string, value: unknown): void {
    this.data.taskState[key] = value;
    this.dirty = true;
  }

  /**
   * Get task state
   */
  getTaskState<T>(key: string): T | undefined {
    return this.data.taskState[key] as T | undefined;
  }

  /**
   * Get memory summary
   */
  getSummary(): MemorySummary {
    return {
      shortTermMessages: this.data.shortTerm.length,
      longTermFacts: this.data.longTerm.facts.length,
      longTermSkills: this.data.longTerm.skills.length,
      lastActivity: new Date(this.data.lastActivity),
      created: new Date(this.data.created),
    };
  }

  /**
   * Get long-term memory context string
   */
  getLongTermContext(): string {
    const parts: string[] = [];
    
    if (this.data.longTerm.facts.length > 0) {
      parts.push('## Known Facts\n' + this.data.longTerm.facts.map(f => `- ${f}`).join('\n'));
    }
    
    if (this.data.longTerm.skills.length > 0) {
      parts.push('## Acquired Skills\n' + this.data.longTerm.skills.map(s => `- ${s}`).join('\n'));
    }
    
    if (this.data.longTerm.relationships.length > 0) {
      parts.push('## Relationships\n' + this.data.longTerm.relationships.map(r => `- ${r}`).join('\n'));
    }
    
    return parts.join('\n\n');
  }

  /**
   * Compact short-term memory by summarizing older messages
   * This is called when memory gets too large
   */
  async compact(summarizer?: (messages: Message[]) => Promise<string>): Promise<void> {
    if (this.data.shortTerm.length < 20) return;
    
    // Keep last 10 messages, summarize the rest
    const toSummarize = this.data.shortTerm.slice(0, -10);
    const toKeep = this.data.shortTerm.slice(-10);
    
    if (summarizer) {
      const summary = await summarizer(toSummarize);
      this.addFact(`Previous conversation summary: ${summary}`);
    }
    
    this.data.shortTerm = toKeep;
    this.dirty = true;
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.data = { ...DEFAULT_MEMORY, created: this.data.created };
    this.dirty = true;
  }

  /**
   * Get raw data (for debugging)
   */
  getRawData(): MemoryData {
    return { ...this.data };
  }
}
