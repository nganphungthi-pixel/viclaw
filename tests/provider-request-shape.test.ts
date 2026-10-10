/**
 * Provider request-shape regression tests.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Viclaw shipped with a fatal bug: it *parsed* tool calls from responses but
 * never *declared* tools to the model. Every provider request omitted `tools`,
 * so no model could ever call a tool, and the entire tool layer was unreachable.
 * Nothing in the test suite caught it because no test ever looked at the
 * outgoing request.
 *
 * These tests mock `fetch` and assert the exact payload sent to each provider.
 * If someone removes tool declaration again, these fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";

import {
  AnthropicProvider,
  OpenAIProvider,
  OpenRouterProvider,
  OllamaProvider,
  createProvider,
  createProviderChain,
  getFreeStackConfigs,
  toAnthropicTools,
  toOpenAITools,
  toAnthropicToolChoice,
  toOpenAIToolChoice,
  toGeminiToolConfig,
  type Message,
  type ToolDefinition,
} from "../src/providers/mod.js";

const tools: ToolDefinition[] = [
  {
    name: "Grep",
    description: "Search file contents",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "Read",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
      additionalProperties: false,
    },
  },
];

/** Capture every fetch body so we can assert on the wire format. */
let requests: Array<{ url: string; body: Record<string, unknown> }> = [];

function mockFetch(responseBody: unknown, status = 200): void {
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(responseBody),
      json: async () => responseBody,
      body: null,
    } as unknown as Response;
  }));
}

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================
// TOOL DEFINITION ADAPTERS
// ============================================

describe("tool definition adapters", () => {
  it("toAnthropicTools maps to name/description/input_schema", () => {
    const out = toAnthropicTools(tools) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveProperty("name", "Grep");
    expect(out[0]).toHaveProperty("description");
    // Anthropic uses `input_schema`, not `parameters`
    expect(out[0]).toHaveProperty("input_schema");
    expect(out[0]).not.toHaveProperty("parameters");
  });

  it("toOpenAITools wraps in type:function + function.parameters", () => {
    const out = toOpenAITools(tools) as Array<Record<string, { name: string; parameters: unknown }>>;
    expect(out[0]).toHaveProperty("type", "function");
    expect(out[0].function).toHaveProperty("name", "Grep");
    expect(out[0].function).toHaveProperty("parameters");
    // OpenAI uses `parameters`, not `input_schema`
    expect(out[0].function).not.toHaveProperty("input_schema");
  });

  it("returns undefined when there are no tools", () => {
    expect(toAnthropicTools(undefined)).toBeUndefined();
    expect(toAnthropicTools([])).toBeUndefined();
  });

  it("maps tool choice correctly per provider", () => {
    expect(toAnthropicToolChoice("auto")).toBe("auto");
    expect(toAnthropicToolChoice("required")).toBe("any"); // Anthropic says "any"
    expect(toAnthropicToolChoice("none")).toBe("none");
    expect(toAnthropicToolChoice({ type: "tool", name: "Grep" })).toEqual({ type: "tool", name: "Grep" });

    expect(toOpenAIToolChoice("required")).toBe("required");
    expect(toOpenAIToolChoice({ type: "tool", name: "Grep" })).toEqual({
      type: "function",
      function: { name: "Grep" },
    });

    expect(toGeminiToolConfig("auto")).toEqual({ functionCallingConfig: { mode: "AUTO" } });
    expect(toGeminiToolConfig("required")).toEqual({ functionCallingConfig: { mode: "ANY" } });
    expect(toGeminiToolConfig("none")).toEqual({ functionCallingConfig: { mode: "NONE" } });
  });
});

// ============================================
// ANTHROPIC
// ============================================

describe("AnthropicProvider request shape", () => {
  const provider = new AnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-4-20250514" });

  it("REGRESSION: declares tools in the request body", async () => {
    mockFetch({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    await provider.chat([{ role: "user", content: "hi" }], { tools });

    const body = requests[0].body;
    expect(body).toHaveProperty("tools");
    expect(Array.isArray(body.tools)).toBe(true);
    expect((body.tools as unknown[]).length).toBe(2);
  });

  it("uses input_schema (not parameters) and includes tool_choice", async () => {
    mockFetch({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    await provider.chat([{ role: "user", content: "hi" }], { tools, toolChoice: "auto" });

    const body = requests[0].body;
    const firstTool = (body.tools as Array<Record<string, unknown>>)[0];
    expect(firstTool).toHaveProperty("input_schema");
    expect(body).toHaveProperty("tool_choice", "auto");
  });

  it("sends system in the top-level system field, not in messages", async () => {
    mockFetch({ content: [], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    await provider.chat([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ], { tools });

    const body = requests[0].body;
    expect(body.system).toBe("be helpful");
    expect((body.messages as unknown[]).length).toBe(1);
  });

  it("REGRESSION: returns tool results as tool_result blocks in a user message", async () => {
    mockFetch({ content: [], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    await provider.chat([
      { role: "assistant", content: "", toolCalls: [{ id: "toolu_1", name: "Read", input: { filePath: "a.ts" } }] },
      { role: "tool", content: "file text", toolCallId: "toolu_1" },
    ], { tools });

    const messages = requests[0].body.messages as Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }>;
    // messages[0] is the assistant turn that requested the tool;
    // messages[1] is the user turn carrying the tool_result block.
    expect(messages).toHaveLength(2);
    const resultMessage = messages[1];

    // The old code sent { role: "tool", tool_call_id } which Anthropic rejects.
    expect(resultMessage.role).toBe("user");
    expect(resultMessage.content[0].type).toBe("tool_result");
    expect(resultMessage.content[0]).toHaveProperty("tool_use_id", "toolu_1");

    const wireRoles = messages.map((m) => m.role);
    expect(wireRoles).not.toContain("tool");
  });

  it("serializes assistant tool calls as tool_use blocks", async () => {
    mockFetch({ content: [], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    await provider.chat([
      { role: "assistant", content: "", toolCalls: [{ id: "toolu_1", name: "Read", input: { filePath: "a.ts" } }] },
    ], { tools });

    const messages = requests[0].body.messages as Array<{ content: Array<{ type: string }> }>;
    expect(messages[0].content[0].type).toBe("tool_use");
  });

  it("streaming also declares tools", async () => {
    mockFetch({ content: [], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    // streamChat reads response.body.getReader(); give it an empty stream.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({}),
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: () => {},
          }),
        },
      } as unknown as Response;
    }));

    const gen = provider.streamChat([{ role: "user", content: "hi" }], { tools });
    for await (const _chunk of gen) {
      // drain
    }

    expect(requests[0].body).toHaveProperty("tools");
  });

  it("parses tool_use blocks out of the response", async () => {
    mockFetch({
      content: [
        { type: "text", text: "let me check" },
        { type: "tool_use", id: "toolu_9", name: "Grep", input: { pattern: "foo" } },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: "m",
      stop_reason: "tool_use",
    });

    const response = await provider.chat([{ role: "user", content: "hi" }], { tools });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]).toMatchObject({ id: "toolu_9", name: "Grep", input: { pattern: "foo" } });
    expect(response.stopReason).toBe("tool_use");
  });
});

// ============================================
// OPENAI
// ============================================

describe("OpenAIProvider request shape", () => {
  const provider = new OpenAIProvider({ apiKey: "sk-test", model: "gpt-4o" });

  it("REGRESSION: declares tools as type:function with parameters", async () => {
    mockFetch({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: "gpt-4o" });

    await provider.chat([{ role: "user", content: "hi" }], { tools });

    const body = requests[0].body;
    expect(body).toHaveProperty("tools");
    const first = (body.tools as Array<Record<string, { parameters: unknown }>>)[0];
    expect(first).toHaveProperty("type", "function");
    expect(first.function).toHaveProperty("parameters");
  });

  it("returns tool results as role:tool with tool_call_id", async () => {
    mockFetch({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: "gpt-4o" });

    await provider.chat([
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "Read", input: { filePath: "a.ts" } }] },
      { role: "tool", content: "text", toolCallId: "call_1" },
    ], { tools });

    const messages = requests[0].body.messages as Array<{ role: string; tool_call_id?: string }>;
    expect(messages.some((m) => m.role === "tool" && m.tool_call_id === "call_1")).toBe(true);
  });

  it("stringifies tool call arguments for the assistant turn", async () => {
    mockFetch({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: "gpt-4o" });

    await provider.chat([
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "Read", input: { filePath: "a.ts" } }] },
    ], { tools });

    const messages = requests[0].body.messages as Array<{ tool_calls?: Array<{ function: { arguments: unknown } }> }>;
    const args = messages[0].tool_calls?.[0].function.arguments;
    // OpenAI requires a JSON string, not an object
    expect(typeof args).toBe("string");
    expect(JSON.parse(args as string)).toEqual({ filePath: "a.ts" });
  });

  it("parses tool_calls whose arguments are JSON strings", async () => {
    mockFetch({
      choices: [{
        message: {
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"filePath":"a.ts"}' } }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "gpt-4o",
    });

    const response = await provider.chat([{ role: "user", content: "hi" }], { tools });
    expect(response.toolCalls?.[0].input).toEqual({ filePath: "a.ts" });
  });

  it("does not throw when arguments are malformed", async () => {
    mockFetch({
      choices: [{
        message: {
          content: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: "NOT JSON" } }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      model: "gpt-4o",
    });

    await expect(provider.chat([{ role: "user", content: "hi" }], { tools })).resolves.toBeDefined();
  });
});

// ============================================
// OPENROUTER
// ============================================

describe("OpenRouterProvider request shape", () => {
  const provider = new OpenRouterProvider({ apiKey: "sk-or-test", model: "anthropic/claude-sonnet-4" });

  it("declares tools like OpenAI", async () => {
    mockFetch({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: "m" });

    await provider.chat([{ role: "user", content: "hi" }], { tools });

    expect(requests[0].body).toHaveProperty("tools");
  });
});

// ============================================
// OLLAMA
// ============================================

describe("OllamaProvider request shape", () => {
  const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", model: "llama3" });

  it("declares tools on /api/chat", async () => {
    mockFetch({ message: { content: "ok", role: "assistant" }, done: true });

    await provider.chat([{ role: "user", content: "hi" }], { tools });

    expect(requests[0].body).toHaveProperty("tools");
    expect(String(requests[0].url)).toContain("/api/chat");
  });

  it("parses tool_calls with object arguments", async () => {
    mockFetch({
      message: {
        content: "",
        role: "assistant",
        tool_calls: [{ function: { name: "Read", arguments: { filePath: "a.ts" } } }],
      },
      done: true,
    });

    const response = await provider.chat([{ role: "user", content: "hi" }], { tools });
    expect(response.toolCalls?.[0]).toMatchObject({ name: "Read", input: { filePath: "a.ts" } });
    expect(response.stopReason).toBe("tool_use");
  });

  it("uses real token counts when Ollama reports them", async () => {
    mockFetch({
      message: { content: "ok", role: "assistant" },
      done: true,
      prompt_eval_count: 10,
      eval_count: 5,
    });

    const response = await provider.chat([{ role: "user", content: "hi" }]);
    expect(response.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
});

// ============================================
// ROUND TRIP
// ============================================

describe("tool call round trip", () => {
  it("a model-visible tool schema is a valid JSON Schema object", async () => {
    mockFetch({ content: [], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" });

    const provider = new AnthropicProvider({ apiKey: "sk-ant-test" });
    await provider.chat([{ role: "user", content: "hi" }], { tools });

    const declared = requests[0].body.tools as Array<{ name: string; input_schema: Record<string, unknown> }>;
    for (const tool of declared) {
      expect(tool.name).toBeTruthy();
      expect(tool.input_schema).toBeTypeOf("object");
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

// ============================================
// PROMPT CACHING (opt-in via enablePromptCache)
// ============================================

describe("Anthropic prompt caching", () => {
  const okBody = { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 }, model: "m", stop_reason: "end_turn" };

  it("REGRESSION: no cache_control by default (uncached shape unchanged)", async () => {
    mockFetch(okBody);
    const provider = new AnthropicProvider({ apiKey: "sk-ant-test" });
    await provider.chat([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ], { tools });

    const body = requests[0].body;
    expect(body.system).toBe("be helpful");
    for (const tool of body.tools as Array<Record<string, unknown>>) {
      expect(tool).not.toHaveProperty("cache_control");
    }
  });

  it("adds cache breakpoints to system + last tool when enabled", async () => {
    mockFetch(okBody);
    const provider = new AnthropicProvider({ apiKey: "sk-ant-test" });
    await provider.chat([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ], { tools, enablePromptCache: true });

    const body = requests[0].body;
    expect(body.system).toEqual([
      { type: "text", text: "be helpful", cache_control: { type: "ephemeral" } },
    ]);
    const wireTools = body.tools as Array<Record<string, unknown>>;
    expect(wireTools[wireTools.length - 1]).toHaveProperty("cache_control", { type: "ephemeral" });
    // Only one tools breakpoint (Anthropic allows max 4 total).
    expect(wireTools.filter((t) => "cache_control" in t)).toHaveLength(1);
  });

  it("withAnthropicPromptCache is idempotent", async () => {
    const { withAnthropicPromptCache } = await import("../src/providers/mod.js");
    const body: { system?: unknown; tools?: unknown } = {
      system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "T", cache_control: { type: "ephemeral" } }],
    };
    withAnthropicPromptCache(body);
    expect(body.system).toHaveLength(1);
    expect((body.tools as Array<Record<string, unknown>>)[0].cache_control)
      .toEqual({ type: "ephemeral" });
  });
});

// ============================================
// FREE STACK: $0 provider chain
// ============================================

describe("free stack chain", () => {
  const openRouterOk = {
    choices: [{ message: { content: "free-answer" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    model: "openrouter/free",
  };

  it("falls through a dead leg to the next provider", async () => {
    let calls = 0;
    requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls++;
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (calls === 1) throw new Error("ECONNREFUSED 127.0.0.1:11434");
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify(openRouterOk),
        json: async () => openRouterOk,
        body: null,
      } as unknown as Response;
    }));

    const chain = createProviderChain([
      { provider: "ollama", baseUrl: "http://127.0.0.1:9", model: "qwen3-coder:8b" },
      { provider: "openrouter", apiKey: "sk-or-test", model: "openrouter/free" },
    ]);
    const response = await chain.chat([{ role: "user", content: "hi" }]);

    expect(calls).toBe(2);
    expect(requests[0].url).toContain("127.0.0.1:9");
    expect(requests[1].url).toContain("openrouter.ai");
    expect(response.content).toBe("free-answer");
    expect(response.usage).toMatchObject({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
  });

  it("throws an aggregate error when every leg fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const chain = createProviderChain([
      { provider: "ollama", baseUrl: "http://127.0.0.1:9", model: "m1" },
      { provider: "ollama", baseUrl: "http://127.0.0.1:9", model: "m2" },
    ]);
    await expect(chain.chat([{ role: "user", content: "hi" }]))
      .rejects.toThrow(/All 2 providers in the chain failed/);
  });

  it("getFreeStackConfigs returns ollama -> gemini -> openrouter/:free", () => {
    const configs = getFreeStackConfigs({});
    expect(configs.map((c) => c.provider)).toEqual(["ollama", "gemini", "openrouter"]);
    expect(configs[2].model).toBe("openrouter/free");
  });

  it("env overrides each free-stack leg", () => {
    const configs = getFreeStackConfigs({
      OLLAMA_MODEL: "devstral:24b",
      GEMINI_MODEL: "gemini-2.5-flash",
      OPENROUTER_FREE_MODEL: "qwen/qwen3-coder:free",
    });
    expect(configs.map((c) => c.model)).toEqual(["devstral:24b", "gemini-2.5-flash", "qwen/qwen3-coder:free"]);
  });

  it("explicit provider field wins over env sniffing", () => {
    const p = createProvider({ provider: "openrouter", apiKey: "sk-or-x", model: "openrouter/free" });
    expect(p.name).toBe("openrouter");
  });
});
