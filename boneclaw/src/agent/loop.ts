import type { Config } from '../config';
import type { Message, ContentPart, ParsedToolCall } from '../llm/types';
import { OpenRouterClient } from '../llm/openrouter';
import { Memory } from '../memory';
import { SessionManager } from '../memory/sessions';
import { buildSystemPrompt, buildTaskPrompt, buildHeartbeatPrompt } from './prompt';
import { getToolDefinitions, executeTool } from '../tools/registry';
import { emit, emitTextDelta, emitThinking, emitComplete, emitError } from '../events/emitter';
import type { ToolContext, ToolResult } from '../tools/types';

const MAX_TOOL_ITERATIONS = 20;

export interface AgentLoopOptions {
  config: Config;
  onMessage?: (message: Message) => void;
}

export class AgentLoop {
  private config: Config;
  private llm: OpenRouterClient;
  private sessions: SessionManager;
  private memory: Memory;
  private running: boolean = false;
  private abortController: AbortController | null = null;
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
    
    this.sessions = new SessionManager(
      this.config.memory.persistPath,
      this.config.memory.maxContextTokens
    );
    // Start with the active session's memory
    this.memory = this.sessions.getMemory(this.sessions.getActiveKey());
  }

  /**
   * Run a single agent turn with a user message.
   * @param sessionKey — which chat session to use (defaults to active session)
   */
  async run(userMessage: string, sessionKey?: string): Promise<string> {
    if (!this.config.openrouter.apiKey) {
      emitError('API key not configured. Please set your OpenRouter API key in Settings.');
      return 'Error: API key not configured. Please set your OpenRouter API key in Settings.';
    }
    
    // Create an AbortController for this run so it can be interrupted
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.running = true;
    
    // Switch to the requested session's memory
    const key = sessionKey || this.sessions.getActiveKey();
    this.memory = this.sessions.getMemory(key);
    this.sessions.touchSession(key);
    
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
    // Track whether the model supports vision (images). Starts true; set to false
    // on first failure so we don't keep retrying with images on every iteration.
    let visionSupported = true;
    
    while (iterations < MAX_TOOL_ITERATIONS) {
      // Check for abort before each iteration
      if (signal.aborted) {
        finalResponse = finalResponse || '[Stopped by user]';
        break;
      }
      
      iterations++;
      
      try {
        // If vision isn't supported, strip image content from messages before sending
        const llmMessages = visionSupported
          ? messages
          : messages.map(m => {
              if (!Array.isArray(m.content)) return m;
              const textParts = (m.content as ContentPart[])
                .filter(p => p.type === 'text')
                .map(p => (p as { type: 'text'; text: string }).text);
              return { ...m, content: textParts.join('\n') || '[visual content]' };
            });
        
        // Get LLM response with streaming
        const { content, toolCalls } = await this.llm.streamAndCollect(
          llmMessages,
          getToolDefinitions(),
          {
            onEvent: (event) => {
              if (event.type === 'text_delta') {
                emitTextDelta(event.content);
              }
            },
          }
        );
        
        // Build a single assistant message with both content and tool_calls
        // (if present). The OpenAI API requires that any tool result message
        // references a tool_call_id that exists in the preceding assistant
        // message's tool_calls array. Pushing content and tool_calls as
        // separate messages creates a malformed history that causes the LLM
        // to repeat itself on the next iteration.
        const assistantMsg: Message = {
          role: 'assistant',
          content: content || null,
        };
        
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        
        messages.push(assistantMsg);
        this.memory.addMessage(assistantMsg);
        this.onMessage?.(assistantMsg);
        
        if (content) {
          finalResponse = content;
        }
        
        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }
        
        // Execute tool calls
        const context: ToolContext = {
          workdir: this.config.workspace,
          emit: (event: unknown) => emit(event as Record<string, unknown> & { type: string }),
        };
        
        let lastScreenshot: string | undefined;
        
        for (const toolCall of toolCalls) {
          if (signal.aborted) break;
          const result = await executeTool(toolCall, context);
          
          // Capture the last screenshot from browser tool results
          if (result.screenshot) {
            lastScreenshot = result.screenshot;
          }
          
          // Add tool result to messages (text only — screenshot goes as separate image)
          const toolMsg: Message = {
            role: 'tool',
            content: result.output,
            tool_call_id: toolCall.id,
          };
          messages.push(toolMsg);
          this.memory.addMessage(toolMsg);
          this.onMessage?.(toolMsg);
        }
        
        // If any browser tool returned a screenshot, inject it as a user message
        // with an image so the LLM can visually see the current page state.
        // Only include the LAST screenshot (final state after all actions).
        if (lastScreenshot) {
          const visualMsg: Message = {
            role: 'user',
            content: [
              { type: 'text', text: '[Screenshot of the current browser page]' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${lastScreenshot}`,
                  detail: 'low',
                },
              },
            ],
          };
          messages.push(visualMsg);
          // Don't persist to memory — images are too large for storage
          // The agent gets fresh screenshots on every browser action
        }
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const lowerErr = errorMsg.toLowerCase();
        
        // Detect vision/image-related errors and disable vision for future iterations.
        // This lets the agent continue working with text-only context.
        const isVisionError = visionSupported && (
          lowerErr.includes('image') || lowerErr.includes('vision') ||
          lowerErr.includes('multimodal') || lowerErr.includes('content_part') ||
          lowerErr.includes('content type') || lowerErr.includes('image_url')
        );
        
        if (isVisionError) {
          console.error('[AgentLoop] Model does not support vision, disabling image injection');
          visionSupported = false;
          // Don't break — retry this iteration without images
          iterations--;
          continue;
        }
        
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
    
    // Persist memory and clean up
    this.running = false;
    this.abortController = null;
    await this.memory.persist();
    
    emitComplete();
    return finalResponse;
  }

  /**
   * Abort the currently running agent loop.
   * The loop will stop at the next check point (before next LLM call or tool execution).
   */
  abort(): boolean {
    if (this.abortController && this.running) {
      this.abortController.abort();
      return true;
    }
    return false;
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
   * Get memory instance for a session (for server to access conversation history).
   */
  getMemory(sessionKey?: string): Memory {
    if (sessionKey) return this.sessions.getMemory(sessionKey);
    return this.memory;
  }

  /**
   * Get the session manager (for server to list/create/delete sessions).
   */
  getSessionManager(): SessionManager {
    return this.sessions;
  }

  /**
   * Check if the agent is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Stop the current run (legacy alias for abort).
   */
  stop(): void {
    this.abort();
  }
}
