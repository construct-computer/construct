import type {
  Message,
  ToolDefinition,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  StreamEvent,
  ParsedToolCall,
} from './types';

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenRouterClient {
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  /**
   * Non-streaming completion with retry logic
   */
  async complete(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<CompletionResponse> {
    const request: CompletionRequest = {
      model: this.config.model,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: false,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelayMs ?? 5000;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': 'https://construct.computer',
          'X-Title': 'BoneClaw Agent',
        },
        body: JSON.stringify(request),
      });

      if (response.ok) {
        return response.json();
      }

      // Handle rate limits with exponential backoff
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const resetTime = response.headers.get('X-RateLimit-Reset');
        
        let waitMs = baseDelay * Math.pow(2, attempt);
        
        if (retryAfter) {
          waitMs = parseInt(retryAfter, 10) * 1000;
        } else if (resetTime) {
          waitMs = Math.max(parseInt(resetTime, 10) - Date.now(), baseDelay);
        }
        
        console.error(`Rate limited, waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await sleep(waitMs);
        continue;
      }

      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Streaming completion with retry logic - yields events as they arrive
   */
  async *stream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: { temperature?: number; maxTokens?: number }
  ): AsyncGenerator<StreamEvent> {
    const request: CompletionRequest = {
      model: this.config.model,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelayMs ?? 5000;
    
    let response: Response | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': 'https://construct.computer',
          'X-Title': 'BoneClaw Agent',
        },
        body: JSON.stringify(request),
      });

      if (response.ok) {
        break;
      }

      // Handle rate limits with exponential backoff
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const resetTime = response.headers.get('X-RateLimit-Reset');
        
        let waitMs = baseDelay * Math.pow(2, attempt);
        
        if (retryAfter) {
          waitMs = parseInt(retryAfter, 10) * 1000;
        } else if (resetTime) {
          waitMs = Math.max(parseInt(resetTime, 10) - Date.now(), baseDelay);
        }
        
        console.error(`Rate limited, waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await sleep(waitMs);
        continue;
      }

      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
    }

    if (!response || !response.ok) {
      throw new Error('Max retries exceeded');
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Track tool calls being built
    const toolCallBuilders: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const chunk: StreamChunk = JSON.parse(trimmed.slice(6));
            const choice = chunk.choices[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Handle text content
            if (delta.content) {
              yield { type: 'text_delta', content: delta.content };
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                
                if (tc.id) {
                  // New tool call starting
                  toolCallBuilders.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  });
                  if (tc.function?.name) {
                    yield { type: 'tool_call_start', id: tc.id, name: tc.function.name };
                  }
                } else {
                  // Continuing existing tool call
                  const builder = toolCallBuilders.get(index);
                  if (builder) {
                    if (tc.function?.name) {
                      builder.name += tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      builder.arguments += tc.function.arguments;
                      yield { type: 'tool_call_delta', id: builder.id, arguments: tc.function.arguments };
                    }
                  }
                }
              }
            }

            // Handle finish
            if (choice.finish_reason) {
              // Emit tool_call_end for all built tool calls
              for (const [, builder] of toolCallBuilders) {
                yield { type: 'tool_call_end', id: builder.id };
              }
              yield { type: 'finish', reason: choice.finish_reason };
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Collect streaming response into a full response
   */
  async streamAndCollect(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: { temperature?: number; maxTokens?: number; onEvent?: (event: StreamEvent) => void }
  ): Promise<{ content: string; toolCalls: ParsedToolCall[] }> {
    let content = '';
    const toolCallBuilders: Map<string, { id: string; name: string; arguments: string }> = new Map();

    for await (const event of this.stream(messages, tools, options)) {
      options?.onEvent?.(event);

      switch (event.type) {
        case 'text_delta':
          content += event.content;
          break;
        case 'tool_call_start':
          toolCallBuilders.set(event.id, { id: event.id, name: event.name, arguments: '' });
          break;
        case 'tool_call_delta':
          const builder = toolCallBuilders.get(event.id);
          if (builder) {
            builder.arguments += event.arguments;
          }
          break;
      }
    }

    // Parse tool call arguments
    const toolCalls: ParsedToolCall[] = [];
    for (const [, builder] of toolCallBuilders) {
      try {
        const args = builder.arguments ? JSON.parse(builder.arguments) : {};
        toolCalls.push({ id: builder.id, name: builder.name, arguments: args });
      } catch {
        toolCalls.push({ id: builder.id, name: builder.name, arguments: {} });
      }
    }

    return { content, toolCalls };
  }
}
