import type { Config } from '../config';
import type { Message, ParsedToolCall } from '../llm/types';
import { OpenRouterClient } from '../llm/openrouter';
import { Memory } from '../memory';
import { buildSystemPrompt, buildTaskPrompt, buildHeartbeatPrompt } from './prompt';
import { getToolDefinitions, executeTool } from '../tools/registry';
import { emit, emitTextDelta, emitThinking, emitComplete, emitError } from '../events/emitter';
import type { ToolContext } from '../tools/types';

const MAX_TOOL_ITERATIONS = 20;

export interface AgentLoopOptions {
  config: Config;
  onMessage?: (message: Message) => void;
}

export class AgentLoop {
  private config: Config;
  private llm: OpenRouterClient;
  private memory: Memory;
  private running: boolean = false;
  private onMessage?: (message: Message) => void;

  constructor(options: AgentLoopOptions) {
    this.config = options.config;
    this.onMessage = options.onMessage;
    
    this.llm = new OpenRouterClient({
      apiKey: this.config.openrouter.apiKey,
      baseUrl: this.config.openrouter.baseUrl,
      model: this.config.openrouter.model,
      maxRetries: 3,
      retryDelayMs: 10000, // 10 seconds base delay for rate limits
    });
    
    this.memory = new Memory(
      this.config.memory.persistPath,
      this.config.memory.maxContextTokens
    );
  }

  /**
   * Run a single agent turn with a user message
   */
  async run(userMessage: string): Promise<string> {
    const systemPrompt = buildSystemPrompt(this.config, this.memory);
    
    // Add user message to memory
    const userMsg: Message = { role: 'user', content: userMessage };
    this.memory.addMessage(userMsg);
    this.onMessage?.(userMsg);
    
    // Build messages array
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...this.memory.getRecentContext(),
    ];
    
    let iterations = 0;
    let finalResponse = '';
    
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      
      try {
        // Get LLM response with streaming
        const { content, toolCalls } = await this.llm.streamAndCollect(
          messages,
          getToolDefinitions(),
          {
            onEvent: (event) => {
              if (event.type === 'text_delta') {
                emitTextDelta(event.content);
              }
            },
          }
        );
        
        // Handle text response
        if (content) {
          finalResponse = content;
          const assistantMsg: Message = { role: 'assistant', content };
          messages.push(assistantMsg);
          this.memory.addMessage(assistantMsg);
          this.onMessage?.(assistantMsg);
        }
        
        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }
        
        // Build assistant message with tool calls
        const assistantMsgWithTools: Message = {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
        
        if (!content) {
          messages.push(assistantMsgWithTools);
        }
        
        // Execute tool calls
        const context: ToolContext = {
          workdir: this.config.workspace,
          emit,
        };
        
        for (const toolCall of toolCalls) {
          const result = await executeTool(toolCall, context);
          
          // Add tool result to messages
          const toolMsg: Message = {
            role: 'tool',
            content: result.output,
            tool_call_id: toolCall.id,
          };
          messages.push(toolMsg);
          this.memory.addMessage(toolMsg);
          this.onMessage?.(toolMsg);
        }
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        emitError(errorMsg);
        
        // Break on LLM errors (rate limits, API errors)
        // These are not recoverable in the same loop
        if (errorMsg.includes('OpenRouter API error') || errorMsg.includes('Max retries')) {
          finalResponse = `Error: ${errorMsg}`;
          break;
        }
        
        // For tool errors, add context and continue
        messages.push({
          role: 'user',
          content: `Error occurred: ${errorMsg}. Please acknowledge and continue.`,
        });
      }
    }
    
    if (iterations >= MAX_TOOL_ITERATIONS) {
      emitError('Max tool iterations reached');
      finalResponse = finalResponse || 'Error: Max tool iterations reached';
    }
    
    // Persist memory
    await this.memory.persist();
    
    emitComplete();
    return finalResponse;
  }

  /**
   * Run a task (for scheduled/goal execution)
   */
  async runTask(task: string, context?: string): Promise<string> {
    const prompt = buildTaskPrompt(task, context);
    return this.run(prompt);
  }

  /**
   * Run a heartbeat check
   */
  async runHeartbeat(): Promise<string> {
    emitThinking('Running heartbeat check...');
    const prompt = buildHeartbeatPrompt();
    return this.run(prompt);
  }

  /**
   * Get memory summary
   */
  getMemorySummary() {
    return this.memory.getSummary();
  }

  /**
   * Check if the agent is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Stop the current run
   */
  stop(): void {
    this.running = false;
  }
}
