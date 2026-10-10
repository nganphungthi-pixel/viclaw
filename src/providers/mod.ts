import {
  toAnthropicRequest,
  toOpenAIMessages,
  toOllamaMessages,
  toGeminiRequest,
  withAnthropicPromptCache,
} from "./messages.js";
import {
  normalizeToolArguments,
  normalizeToolCalls,
  normalizeToolCall,
  StreamToolCallAccumulator,
  type ToolDefinition,
  type ToolChoice,
  type ToolRequestOptions,
} from "./tool-schema.js";

export type { ToolDefinition, ToolChoice, ToolRequestOptions } from "./tool-schema.js";
export {
  zodToJsonSchema,
  toToolDefinitions,
  normalizeToolArguments,
  normalizeToolCall,
  normalizeToolCalls,
} from "./tool-schema.js";
export {
  toAnthropicRequest,
  toBedrockRequest,
  toOpenAIMessages,
  toOllamaMessages,
  toGeminiRequest,
  withAnthropicPromptCache,
} from "./messages.js";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  /** Set on tool result messages so Gemini can route the functionResponse. */
  isError?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
}

export interface Response {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  toolCalls?: ToolCall[];
  stopReason?: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | "length" | null;
}

export interface Chunk {
  type: "content" | "tool_use" | "message_start" | "message_delta" | "message_stop" | "error";
  content?: string;
  delta?: string;
  toolCall?: ToolCall;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  isDone?: boolean;
  error?: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  /**
   * Explicit provider selection. When set, it wins over `detectProvider`'s
   * env sniffing — required for chains (e.g. the free stack), where three
   * configs for three different providers coexist in one process.
   */
  provider?: ProviderName;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  chat(messages: Message[], options?: ToolRequestOptions): Promise<Response>;
  streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown>;
}

/**
 * Map the provider-agnostic ToolChoice onto Anthropic's `tool_choice`.
 * Anthropic accepts: "auto" | "any" | "none" | { type: "tool", name }.
 */
export function toAnthropicToolChoice(choice?: ToolChoice): unknown | undefined {
  if (choice === undefined) return undefined;
  if (choice === "required") return "any";
  if (choice === "auto" || choice === "none") return choice;
  return { type: "tool", name: choice.name };
}

/** Map ToolChoice onto OpenAI's `tool_choice`. */
export function toOpenAIToolChoice(choice?: ToolChoice): unknown | undefined {
  if (choice === undefined) return undefined;
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  return { type: "function", function: { name: choice.name } };
}

/** Map ToolChoice onto Gemini's functionCallingConfig. */
export function toGeminiToolConfig(choice?: ToolChoice): unknown | undefined {
  if (choice === undefined) return undefined;
  if (choice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (choice === "required") return { functionCallingConfig: { mode: "ANY" } };
  if (choice === "auto") return { functionCallingConfig: { mode: "AUTO" } };
  return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
}

/** Build Anthropic's `tools` array from tool definitions. */
export function toAnthropicTools(tools?: ToolDefinition[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

/** Build OpenAI's `tools` array from tool definitions. */
export function toOpenAITools(tools?: ToolDefinition[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export type ProviderName = "anthropic" | "openai" | "openrouter" | "ollama" | "gemini" | "bedrock";

export function detectProvider(config?: ProviderConfig): ProviderName {
  const apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";

  if (process.env.OLLAMA_HOST) {
    return "ollama";
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return "bedrock";
  }

  if (apiKey.startsWith("sk-ant-")) {
    return "anthropic";
  }

  if (apiKey.startsWith("sk-")) {
    return "openai";
  }

  if (process.env.OPENROUTER_API_KEY) {
    return "openrouter";
  }

  return "anthropic";
}

export function getDefaultConfig(): ProviderConfig {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || "claude-sonnet-4-20250514",
    maxTokens: parseInt(process.env.MAX_TOKENS || "8192"),
    temperature: parseFloat(process.env.TEMPERATURE || "0.7"),
    timeout: parseInt(process.env.TIMEOUT || "120000"),
  };
}

export function createProvider(config?: ProviderConfig): Provider {
  const cfg = { ...getDefaultConfig(), ...config };
  const providerName = cfg.provider || detectProvider(cfg);

  switch (providerName) {
    case "anthropic":
      return new AnthropicProvider(cfg);
    case "openai":
      return new OpenAIProvider(cfg);
    case "openrouter":
      return new OpenRouterProvider(cfg);
    case "ollama":
      return new OllamaProvider(cfg);
    case "gemini":
      return new GeminiProvider(cfg);
    case "bedrock":
      return new BedrockProvider(cfg);
    default:
      return new AnthropicProvider(cfg);
  }
}

export class AnthropicProvider implements Provider {
  readonly name: ProviderName = "anthropic";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private timeout: number;

  constructor(config: ProviderConfig = {}) {
    this.model = config.model || "claude-sonnet-4-20250514";
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
    this.maxTokens = config.maxTokens || 8192;
    this.timeout = config.timeout || 120000;
  }

  async chat(messages: Message[], options?: ToolRequestOptions): Promise<Response> {
    const wire = toAnthropicRequest(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: wire.messages,
    };

    if (wire.system) {
      body.system = wire.system;
    }

    const tools = toAnthropicTools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toAnthropicToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
      // Without this, some models refuse to call tools at all.
      body.parallel_tool_calls = true;
    }

    if (options?.enablePromptCache) withAnthropicPromptCache(body);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
      stop_reason: string | null;
    };

    const textContent = (data.content || []).find((c) => c.type === "text");
    const toolCallsContent = (data.content || []).filter((c) => c.type === "tool_use");

    return {
      content: textContent?.text || "",
      model: data.model,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      toolCalls: toolCallsContent.length > 0
        ? toolCallsContent.map((tc) => ({
            id: tc.id!,
            name: tc.name!,
            input: (tc.input || {}) as Record<string, unknown>,
          }))
        : undefined,
      stopReason: data.stop_reason as Response["stopReason"],
    };
  }

  async *streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const wire = toAnthropicRequest(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: wire.messages,
      stream: true,
    };

    if (wire.system) {
      body.system = wire.system;
    }

    const tools = toAnthropicTools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toAnthropicToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
      body.parallel_tool_calls = true;
    }

    if (options?.enablePromptCache) withAnthropicPromptCache(body);

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(line.slice(5)) as {
              type: string;
              delta?: { text?: string };
              tool_use?: { id?: string; name?: string; input?: string };
              usage?: { output_tokens?: number };
            };

            switch (data.type) {
              case "content_block_delta":
                if (data.delta?.text) {
                  yield { type: "content", delta: data.delta.text };
                }
                break;
              case "tool_use":
                yield {
                  type: "tool_use",
                  toolCall: {
                    id: data.tool_use?.id || "",
                    name: data.tool_use?.name || "",
                    input: data.tool_use?.input ? JSON.parse(data.tool_use.input) : {},
                  },
                };
                break;
              case "message_start":
                yield { type: "message_start" };
                break;
              case "message_delta":
                if (data.delta?.text) {
                  yield { type: "message_delta", delta: data.delta.text };
                }
                if (data.usage) {
                  yield {
                    type: "message_delta",
                    usage: { inputTokens: 0, outputTokens: data.usage.output_tokens || 0 },
                  };
                }
                break;
              case "message_stop":
                yield { type: "message_stop", isDone: true };
                return;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class OpenAIProvider implements Provider {
  readonly name: ProviderName = "openai";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private timeout: number;

  constructor(config: ProviderConfig = {}) {
    this.model = config.model || "gpt-4o";
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
    this.maxTokens = config.maxTokens || 8192;
    this.timeout = config.timeout || 120000;
  }

  async chat(messages: Message[], options?: ToolRequestOptions): Promise<Response> {
    const apiMessages = toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      max_tokens: this.maxTokens,
    };

    const tools = toOpenAITools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toOpenAIToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
      body.parallel_tool_calls = true;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string;
          tool_calls?: Array<ToolCallFunction>;
        };
        finish_reason: string | null;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };
    
    interface ToolCallFunction {
      id: string;
      type: string;
      "function": { name: string; arguments: string };
    }

    const choice = (data.choices || [])[0];
    const message = choice?.message;

    return {
      content: message?.content || "",
      model: data.model || this.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      toolCalls: normalizeToolCalls(
        message?.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc["function"]?.name,
          arguments: tc["function"]?.arguments,
        }))
      ),
      stopReason: choice?.finish_reason as Response["stopReason"],
    };
  }

  async *streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const apiMessages = toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      max_tokens: this.maxTokens,
      stream: true,
    };

    const tools = toOpenAITools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toOpenAIToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
      body.parallel_tool_calls = true;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        const toolAccumulator = new StreamToolCallAccumulator();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          if (trimmed === "data: [DONE]") {
            for (const call of toolAccumulator.flush()) {
              yield { type: "tool_use", toolCall: call };
            }
            yield { type: "message_stop", isDone: true };
            return;
          }

          try {
            const data = JSON.parse(trimmed.slice(6)) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: Array<DeltaToolCall>;
                };
                finish_reason: string | null;
              }>;
            };

            interface DeltaToolCall {
              id?: string;
              index?: number;
              type?: string;
              "function"?: { name?: string; arguments?: string };
            }

            const choice = data.choices[0];
            if (!choice) continue;

            if (choice.delta?.content) {
              yield { type: "content", delta: choice.delta.content };
            }

            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                toolAccumulator.push(tc);
              }
            }

            if (choice.finish_reason) {
              for (const call of toolAccumulator.flush()) {
                yield { type: "tool_use", toolCall: call };
              }
              yield { type: "message_stop", isDone: true };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class OpenRouterProvider implements Provider {
  readonly name: ProviderName = "openrouter";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private timeout: number;

  constructor(config: ProviderConfig = {}) {
    this.model = config.model || "anthropic/claude-sonnet-4-20250514";
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || "";
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";
    this.maxTokens = config.maxTokens || 8192;
    this.timeout = config.timeout || 120000;
  }

  async chat(messages: Message[], options?: ToolRequestOptions): Promise<Response> {
    const apiMessages = toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
    };

    const tools = toOpenAITools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toOpenAIToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/nganphungthi-pixel/viclaw",
        "X-Title": "viclaw",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string;
          tool_calls?: Array<ORFunctionCall>;
        };
      }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    interface ORFunctionCall {
      id: string;
      "function": { name: string; arguments: string };
    }

    const choice = (data.choices || [])[0];
    const message = choice?.message;

    return {
      content: message?.content || "",
      model: data.model || this.model,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
      toolCalls: normalizeToolCalls(
        message?.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc["function"].name,
          arguments: tc["function"].arguments,
        }))
      ),
    };
  }

  async *streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const apiMessages = toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      stream: true,
    };

    const tools = toOpenAITools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toOpenAIToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/nganphungthi-pixel/viclaw",
        "X-Title": "viclaw",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        const toolAccumulator = new StreamToolCallAccumulator();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          if (trimmed === "data: [DONE]") {
            for (const call of toolAccumulator.flush()) {
              yield { type: "tool_use", toolCall: call };
            }
            yield { type: "message_stop", isDone: true };
            return;
          }

          try {
            const data = JSON.parse(trimmed.slice(6)) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
            };

            const choice = data.choices[0];
            if (!choice) continue;

            if (choice.delta?.content) {
              yield { type: "content", delta: choice.delta.content };
            }

            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                toolAccumulator.push(tc);
              }
            }

            if (choice.finish_reason) {
              for (const call of toolAccumulator.flush()) {
                yield { type: "tool_use", toolCall: call };
              }
              yield { type: "message_stop", isDone: true };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class OllamaProvider implements Provider {
  readonly name: ProviderName = "ollama";
  readonly model: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: ProviderConfig = {}) {
    // Coding-agent default, not a generic chat model: qwen3-coder:8b fits an
    // 8GB GPU and matches the free-stack default (getFreeStackConfigs).
    this.model = config.model || process.env.OLLAMA_MODEL || "qwen3-coder:8b";
    this.baseUrl = config.baseUrl || process.env.OLLAMA_HOST || "http://localhost:11434";
    this.timeout = config.timeout || 120000;
  }

  async chat(messages: Message[], options?: ToolRequestOptions): Promise<Response> {
    const apiMessages = toOllamaMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      stream: false,
    };

    if (options?.tools && options.tools.length > 0) {
      // Ollama expects OpenAI-ish function definitions.
      body.tools = toOpenAITools(options.tools);
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      message: {
        content: string;
        role: string;
        tool_calls?: Array<{ function: { name?: string; arguments?: unknown } }>;
      };
      done: boolean;
      total_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const toolCalls = normalizeToolCalls(
      data.message.tool_calls?.map((tc, index) => ({
        id: `call_${index}_${Date.now()}`,
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      }))
    );

    return {
      content: data.message?.content || "",
      model: this.model,
      usage:
        data.prompt_eval_count !== undefined || data.eval_count !== undefined
          ? {
              inputTokens: data.prompt_eval_count || 0,
              outputTokens: data.eval_count || 0,
              totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            }
          : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async *streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const apiMessages = toOllamaMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      stream: true,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = toOpenAITools(options.tools);
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as {
              message?: {
                content?: string;
                tool_calls?: Array<{ function: { name?: string; arguments?: unknown } }>;
              };
              done: boolean;
            };

            if (data.message?.content) {
              yield { type: "content", delta: data.message.content };
            }

            if (data.message?.tool_calls?.length) {
              for (const [index, tc] of data.message.tool_calls.entries()) {
                const normalized = normalizeToolCall(
                  {
                    id: `call_${index}_${Date.now()}`,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments,
                  },
                  index
                );
                yield { type: "tool_use", toolCall: normalized };
              }
            }

            if (data.done) {
              yield { type: "message_stop", isDone: true };
              return;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export function createFallbackProvider(primaryConfig?: ProviderConfig, fallbackConfig?: ProviderConfig): Provider {
  const primaryProvider = createProvider(primaryConfig);
  
  const originalChat = primaryProvider.chat.bind(primaryProvider);
  const originalStreamChat = primaryProvider.streamChat.bind(primaryProvider);

  primaryProvider.chat = async (messages: Message[], options?: ToolRequestOptions): Promise<Response> => {
    try {
      return await originalChat(messages, options);
    } catch (error) {
      if (!fallbackConfig) throw error;
      
      const fallbackProvider = createProvider(fallbackConfig);
      return fallbackProvider.chat(messages, options);
    }
  };

  primaryProvider.streamChat = async function* (messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    try {
      yield* originalStreamChat(messages, options);
    } catch (error) {
      if (!fallbackConfig) throw error;
      
      const fallbackProvider = createProvider(fallbackConfig);
      yield* fallbackProvider.streamChat(messages, options);
    }
  };

  return primaryProvider;
}

/**
 * Try providers in order until one answers. This generalizes
 * `createFallbackProvider` (which supports exactly one fallback) to an
 * N-length chain — the shape a $0 "free stack" needs, because every free
 * source is quota- or hardware-bound and any single one can be down, capped,
 * or retired on a given day. All failures are collected; if every provider
 * fails, the aggregate error lists each attempt so the operator can see which
 * quota/hardware leg broke.
 */
export function createProviderChain(configs: ProviderConfig[]): Provider {
  if (configs.length === 0) throw new Error("createProviderChain needs at least one config");
  const providers = configs.map((c) => createProvider(c));
  // Bind the ORIGINAL methods first. Overwriting `primary.chat` and then
  // calling `primary.chat` inside the loop would recurse into the chain
  // itself (found by the dependency-free proof harness: stack overflow with
  // the failure accidentally swallowed as a leg error).
  const legs = providers.map((provider) => ({
    name: provider.name,
    chat: provider.chat.bind(provider),
    streamChat: provider.streamChat.bind(provider),
  }));
  const primary = providers[0];

  primary.chat = async (messages: Message[], options?: ToolRequestOptions): Promise<Response> => {
    const errors: string[] = [];
    for (const leg of legs) {
      try {
        return await leg.chat(messages, options);
      } catch (error) {
        errors.push(`${leg.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`All ${legs.length} providers in the chain failed: ${errors.join(" | ")}`);
  };
  primary.streamChat = async function* (messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const errors: string[] = [];
    for (const leg of legs) {
      try {
        yield* leg.streamChat(messages, options);
        return;
      } catch (error) {
        // If a provider already yielded chunks, we cannot rewind the stream;
        // surface the partial failure instead of silently switching mid-turn.
        errors.push(`${leg.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`All ${legs.length} providers in the chain failed: ${errors.join(" | ")}`);
  };

  return primary;
}

/**
 * The $0 inference stack, cheapest-first:
 *   1. Ollama (local — private, unlimited, needs `ollama pull <model>`)
 *   2. Gemini free tier (no card; trains on prompts — never send secrets)
 *   3. OpenRouter `:free` router (auto-selects a free tool-calling model)
 *
 * Defaults are chosen for low-end hardware and live quotas (see
 * docs/FREE-STACK.md); every leg is overridable via env. A leg that is not
 * configured is still in the chain — it fails fast and the next leg answers.
 */
export interface FreeStackEnv {
  OLLAMA_HOST?: string;
  OLLAMA_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_FREE_MODEL?: string;
}

export function getFreeStackConfigs(env: FreeStackEnv = process.env): ProviderConfig[] {
  return [
    {
      provider: "ollama",
      baseUrl: env.OLLAMA_HOST || "http://localhost:11434",
      model: env.OLLAMA_MODEL || "qwen3-coder:8b",
    },
    {
      provider: "gemini",
      apiKey: env.GEMINI_API_KEY || "",
      model: env.GEMINI_MODEL || "gemini-2.0-flash",
    },
    {
      provider: "openrouter",
      apiKey: env.OPENROUTER_API_KEY || "",
      model: env.OPENROUTER_FREE_MODEL || "openrouter/free",
    },
  ];
}

export function createFreeStackProvider(env: FreeStackEnv = process.env): Provider {
  return createProviderChain(getFreeStackConfigs(env));
}

// ============================================
// GEMINI PROVIDER
// ============================================

export class GeminiProvider implements Provider {
  readonly name: ProviderName = "gemini";
  readonly model: string;
  private apiKey: string;
  private maxTokens: number;
  private timeout: number;
  private temperature: number;

  constructor(config: ProviderConfig = {}) {
    this.model = config.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || "";
    this.maxTokens = config.maxTokens || 8192;
    this.timeout = config.timeout || 120000;
    this.temperature = config.temperature ?? 0.7;
  }

  async chat(messages: Message[], options?: ToolRequestOptions): Promise<Response> {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const wire = toGeminiRequest(messages);

    const modelConfig: Record<string, unknown> = { model: this.model };
    if (wire.systemInstruction) modelConfig.systemInstruction = wire.systemInstruction;
    if (options?.tools && options.tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      }];
      const toolConfig = toGeminiToolConfig(options.toolChoice);
      if (toolConfig) modelConfig.toolConfig = toolConfig;
    }

    const model = genAI.getGenerativeModel(modelConfig as never);

    const result = await model.generateContent({
      contents: wire.contents as never,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
    });

    const response = await result.response;
    return this.toResponse(response);
  }

  /** Convert a Gemini response object into our provider-neutral Response. */
  private toResponse(response: {
    text?: () => string;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  }): Response {
    const parts = response.candidates?.[0]?.content?.parts || [];

    const textParts: string[] = [];
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const [index, part] of parts.entries()) {
      if (part.text) textParts.push(part.text);
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${index}_${Date.now()}`,
          name: part.functionCall.name,
          input: normalizeToolArguments(part.functionCall.args),
        });
      }
    }

    // `text()` throws when the turn contains function calls, so only use it as a fallback.
    let content = textParts.join("\n");
    if (!content && toolCalls.length === 0 && typeof response.text === "function") {
      try {
        content = response.text();
      } catch {
        content = "";
      }
    }

    const usage = response.usageMetadata;

    return {
      content,
      model: this.model,
      usage: usage
        ? {
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: usage.candidatesTokenCount || 0,
            totalTokens: usage.totalTokenCount || 0,
          }
        : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async *streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const wire = toGeminiRequest(messages);

    const modelConfig: Record<string, unknown> = { model: this.model };
    if (wire.systemInstruction) modelConfig.systemInstruction = wire.systemInstruction;
    if (options?.tools && options.tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      }];
      const toolConfig = toGeminiToolConfig(options.toolChoice);
      if (toolConfig) modelConfig.toolConfig = toolConfig;
    }

    const model = genAI.getGenerativeModel(modelConfig as never);

    const result = await model.generateContentStream({
      contents: wire.contents as never,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
    });

    yield { type: "message_start" };

    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.text) {
          yield { type: "content", delta: part.text };
        }
        // The installed @google/generative-ai@0.2.1 types `Part` as
        // `TextPart | InlineDataPart` with no FunctionCallPart, while newer SDKs
        // return `functionCall` parts at runtime. Read it structurally so this
        // compiles across SDK minors without changing runtime behavior.
        const functionCall = (part as { functionCall?: { name?: string; args?: unknown } }).functionCall;
        if (functionCall) {
          yield {
            type: "tool_use",
            toolCall: {
              id: `call_${Date.now()}`,
              name: functionCall.name || "unknown",
              input: normalizeToolArguments(functionCall.args),
            },
          };
        }
      }
    }

    yield { type: "message_stop", isDone: true };
  }
}

// ============================================
// BEDROCK PROVIDER
// ============================================

export class BedrockProvider implements Provider {
  readonly name: ProviderName = "bedrock";
  readonly model: string;
  private maxTokens: number;
  private timeout: number;
  private region: string;

  constructor(config: ProviderConfig = {}) {
    this.model = config.model || process.env.BEDROCK_MODEL || "anthropic.claude-3-5-sonnet-20241022-v2:0";
    this.maxTokens = config.maxTokens || 8192;
    this.timeout = config.timeout || 120000;
    this.region = process.env.AWS_REGION || "us-east-1";
  }

  async chat(messages: Message[], options?: ToolRequestOptions): Promise<Response> {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");

    const client = new BedrockRuntimeClient({ region: this.region });

    const wire = toAnthropicRequest(messages);

    const body: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: this.maxTokens,
      messages: wire.messages,
    };
    if (wire.system) body.system = wire.system;

    const tools = toAnthropicTools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toAnthropicToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
    }

    if (options?.enablePromptCache) withAnthropicPromptCache(body);

    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as {
      content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const blocks = responseBody.content || [];
    const content = blocks
      .filter((b) => b.type === "text" || (!b.type && typeof b.text === "string"))
      .map((b) => b.text || "")
      .join("\n");

    const toolCalls = normalizeToolCalls(
      blocks
        .filter((b) => b.type === "tool_use")
        .map((b, index) => ({
          id: b.id || `call_${index}_${Date.now()}`,
          name: b.name,
          input: b.input,
        }))
    );

    const inputTokens = responseBody.usage?.input_tokens || 0;
    const outputTokens = responseBody.usage?.output_tokens || 0;

    return {
      content,
      model: this.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async *streamChat(messages: Message[], options?: ToolRequestOptions): AsyncGenerator<Chunk, void, unknown> {
    const { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } = await import("@aws-sdk/client-bedrock-runtime");

    const client = new BedrockRuntimeClient({ region: this.region });

    const wire = toAnthropicRequest(messages);

    const body: Record<string, unknown> = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: this.maxTokens,
      messages: wire.messages,
    };
    if (wire.system) body.system = wire.system;

    const tools = toAnthropicTools(options?.tools);
    if (tools) {
      body.tools = tools;
      const toolChoice = toAnthropicToolChoice(options?.toolChoice);
      if (toolChoice !== undefined) body.tool_choice = toolChoice;
    }

    if (options?.enablePromptCache) withAnthropicPromptCache(body);

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: this.model,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    });

    const response = await client.send(command);

    yield { type: "message_start" };

    // Anthropic-on-Bedrock streams `content_block_start` / `content_block_delta`
    // events. Text arrives as `text_delta`; tool input arrives as incremental
    // `input_json_delta` fragments that must be concatenated before parsing.
    const pendingToolCalls = new Map<number, { id: string; name: string; json: string }>();

    for await (const chunk of (response as { body?: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> }).body || []) {
      if (!chunk?.chunk?.bytes) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes)) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = data.type as string | undefined;

      if (type === "content_block_start") {
        const index = (data.index as number) ?? 0;
        const block = data.content_block as { type?: string; id?: string; name?: string; text?: string } | undefined;
        if (block?.type === "tool_use") {
          pendingToolCalls.set(index, { id: block.id || `call_${index}`, name: block.name || "", json: "" });
        } else if (block?.type === "text" && typeof block.text === "string" && block.text) {
          yield { type: "content", delta: block.text };
        }
        continue;
      }

      if (type === "content_block_delta") {
        const index = (data.index as number) ?? 0;
        const delta = data.delta as { type?: string; text?: string; partial_json?: string } | undefined;
        if (!delta) continue;

        if (delta.type === "text_delta" && delta.text) {
          yield { type: "content", delta: delta.text };
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const pending = pendingToolCalls.get(index);
          if (pending) pending.json += delta.partial_json;
        }
        continue;
      }

      if (type === "content_block_stop") {
        const index = (data.index as number) ?? 0;
        const pending = pendingToolCalls.get(index);
        if (pending) {
          pendingToolCalls.delete(index);
          yield {
            type: "tool_use",
            toolCall: {
              id: pending.id,
              name: pending.name,
              input: normalizeToolArguments(pending.json),
            },
          };
        }
        continue;
      }

      // Fallback: some runtimes emit the whole message instead of deltas.
      const content = (data.content as Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }> | undefined) || [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          yield { type: "content", delta: block.text };
        } else if (block.type === "tool_use") {
          yield {
            type: "tool_use",
            toolCall: normalizeToolCall({ id: block.id, name: block.name, input: block.input }),
          };
        }
      }
    }

    yield { type: "message_stop", isDone: true };
  }
}