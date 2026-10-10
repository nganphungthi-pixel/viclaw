/**
 * Provider message normalization.
 *
 * The agent keeps ONE internal message shape. Every provider has a different
 * way of representing tool calls and tool results. Getting this wrong is what
 * turns a working agent into an agent that returns HTTP 400 on the second turn.
 *
 * Internal shape (see providers/mod.ts):
 *   role: "system" | "user" | "assistant" | "tool"
 *   content: string
 *   toolCalls?: Array<{ id, name, input }>   // on assistant messages
 *   toolCallId?: string                       // on tool messages
 *
 * Tested in tests/messages.test.ts.
 */

import type { Message, ToolCall } from "./mod.js";

// ============================================
// SHARED HELPERS
// ============================================

export interface AnthropicToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

function isToolResultMessage(message: Message): boolean {
  return message.role === "tool";
}

function hasToolCalls(message: Message): boolean {
  return Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
}

// ============================================
// ANTHROPIC (Messages API) + BEDROCK
// ============================================

export type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/**
 * Apply Anthropic prompt caching to an already-built request body.
 *
 * Breakpoints (Anthropic allows up to 4): the system prompt and the end of the
 * `tools` array — the two large, stable prefixes re-sent every agent turn.
 * Without this, an agent loop pays full price on every call.
 *
 * Idempotent and safe to call when caching is unwanted: callers gate on
 * `options.enablePromptCache`, and existing breakpoints are never duplicated.
 */
export function withAnthropicPromptCache(body: { system?: unknown; tools?: unknown }): void {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = [
      { type: "text", text: body.system, cache_control: { type: "ephemeral" } },
    ];
  } else if (Array.isArray(body.system) && body.system.length > 0) {
    const last = body.system[body.system.length - 1] as Record<string, unknown>;
    if (last && typeof last === "object" && !("cache_control" in last)) {
      last.cache_control = { type: "ephemeral" };
    }
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const last = (body.tools as Array<Record<string, unknown>>)[body.tools.length - 1];
    if (last && typeof last === "object" && !("cache_control" in last)) {
      last.cache_control = { type: "ephemeral" };
    }
  }
}

export interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export interface AnthropicWireRequest {
  system?: string | AnthropicContentBlock[];
  messages: AnthropicWireMessage[];
}

/**
 * Convert internal messages to Anthropic's wire format.
 *
 * Two rules that are easy to get wrong and produce 400s:
 *  1. `system` messages do NOT go in `messages`; they go in the top-level
 *     `system` field.
 *  2. Tool results are NOT a `role: "tool"` message. Each result is a
 *     `{ type: "tool_result", tool_use_id, content, is_error }` block placed in
 *     a `user` message, and all results belonging to the same assistant turn
 *     must be grouped into ONE user message.
 */
export function toAnthropicRequest(messages: Message[]): AnthropicWireRequest {
  const systemParts: string[] = [];
  const wire: AnthropicWireMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push(message.content);
      continue;
    }

    if (isToolResultMessage(message)) {
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: message.toolCallId || "",
        content: message.content || "",
      };
      // Anthropic uses `is_error` so the model can tell a failed tool call
      // from a successful one. Omitting it (rather than sending false) matters:
      // some models treat an explicit false differently from an absent field.
      if (message.isError) block.is_error = true;
      const last = wire[wire.length - 1];
      // Group consecutive tool results into a single user turn.
      if (last && last.role === "user" && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        wire.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      if (hasToolCalls(message)) {
        for (const call of message.toolCalls as ToolCall[]) {
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input || {} });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      wire.push({ role: "assistant", content: blocks });
      continue;
    }

    // user
    wire.push({ role: "user", content: [{ type: "text", text: message.content || "" }] });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: wire,
  };
}

/** Bedrock's Anthropic-compatible Messages API uses the same message shape. */
export const toBedrockRequest = toAnthropicRequest;

// ============================================
// OPENAI / OPENROUTER (Chat Completions)
// ============================================

export type OpenAIWireMessage =
  | { role: "system" | "user" | "assistant"; content: string; name?: string; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export function toOpenAIMessages(messages: Message[]): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      out.push({
        role: "tool",
        content: message.content || "",
        tool_call_id: message.toolCallId || "",
        ...(message.name ? { name: message.name } : {}),
      });
      continue;
    }

    if (message.role === "assistant" && hasToolCalls(message)) {
      out.push({
        role: "assistant",
        content: message.content || "",
        tool_calls: (message.toolCalls as ToolCall[]).map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            // OpenAI requires arguments to be a JSON *string*.
            arguments: JSON.stringify(call.input || {}),
          },
        })),
      });
      continue;
    }

    out.push({
      role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
      content: message.content || "",
      ...(message.name ? { name: message.name } : {}),
    });
  }

  return out;
}

// ============================================
// OLLAMA
// ============================================

export type OllamaWireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};

export function toOllamaMessages(messages: Message[]): OllamaWireMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant" && hasToolCalls(message)) {
      return {
        role: "assistant",
        content: message.content || "",
        tool_calls: (message.toolCalls as ToolCall[]).map((call) => ({
          function: { name: call.name, arguments: call.input || {} },
        })),
      };
    }
    return {
      role: message.role,
      content: message.content || "",
    };
  });
}

// ============================================
// GEMINI
// ============================================

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

export interface GeminiWireRequest {
  systemInstruction?: { parts: GeminiPart[] };
  contents: GeminiContent[];
}

export function toGeminiRequest(messages: Message[]): GeminiWireRequest {
  const systemParts: GeminiPart[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push({ text: message.content });
      continue;
    }

    if (isToolResultMessage(message)) {
      const name = message.name || "";
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name,
            response: { result: message.content || "", is_error: Boolean((message as Message & { isError?: boolean }).isError) },
          },
        }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content) parts.push({ text: message.content });
      if (hasToolCalls(message)) {
        for (const call of message.toolCalls as ToolCall[]) {
          parts.push({ functionCall: { name: call.name, args: call.input || {} } });
        }
      }
      if (parts.length === 0) parts.push({ text: "" });
      contents.push({ role: "model", parts });
      continue;
    }

    contents.push({ role: "user", parts: [{ text: message.content || "" }] });
  }

  return {
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
    contents,
  };
}
