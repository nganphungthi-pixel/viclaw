/**
 * Tool schema + message normalization tests.
 *
 * These guard the two things that break agent tool calling silently:
 *   1. Zod -> JSON Schema conversion producing schemas providers reject
 *   2. Tool call/result messages being shaped like the wrong provider
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  zodToJsonSchema,
  toToolDefinitions,
  normalizeToolArguments,
  normalizeToolCall,
  normalizeToolCalls,
  StreamToolCallAccumulator,
} from "../src/providers/tool-schema.js";
import {
  toAnthropicRequest,
  toOpenAIMessages,
  toOllamaMessages,
  toGeminiRequest,
} from "../src/providers/messages.js";

describe("zodToJsonSchema", () => {
  it("converts a flat object with required and optional fields", () => {
    const schema = z.object({
      filePath: z.string(),
      offset: z.number().optional(),
    });

    const json = zodToJsonSchema(schema);

    expect(json.type).toBe("object");
    expect(json.properties).toHaveProperty("filePath");
    expect(json.properties?.filePath).toMatchObject({ type: "string" });
    expect(json.properties?.offset).toMatchObject({ type: "number" });
    expect(json.required).toEqual(["filePath"]);
    // optional must not be required
    expect(json.required).not.toContain("offset");
  });

  it("converts enums, booleans, arrays and literals", () => {
    const schema = z.object({
      mode: z.enum(["content", "count"]),
      flag: z.boolean(),
      tags: z.array(z.string()),
      fixed: z.literal("always"),
    });

    const json = zodToJsonSchema(schema);
    expect(json.properties?.mode).toMatchObject({ type: "string", enum: ["content", "count"] });
    expect(json.properties?.flag).toMatchObject({ type: "boolean" });
    expect(json.properties?.tags).toMatchObject({ type: "array" });
    expect((json.properties?.tags as { items: { type: string } }).items.type).toBe("string");
    expect(json.properties?.fixed).toMatchObject({ const: "always" });
  });

  it("converts native enums", () => {
    enum Color { Red = "RED", Blue = "BLUE" }
    const json = zodToJsonSchema(z.object({ c: z.nativeEnum(Color) }));
    expect((json.properties?.c as { enum: unknown[] }).enum).toEqual(expect.arrayContaining(["RED", "BLUE"]));
  });

  it("preserves descriptions", () => {
    const schema = z.object({
      pattern: z.string().describe("Regular expression to search for"),
    });
    const json = zodToJsonSchema(schema);
    expect((json.properties?.pattern as { description?: string }).description).toBe("Regular expression to search for");
  });

  it("records string constraints", () => {
    const json = zodToJsonSchema(z.object({ e: z.string().email(), n: z.string().min(2) }));
    expect((json.properties?.e as { format?: string }).format).toBe("email");
    expect((json.properties?.n as { minLength?: number }).minLength).toBe(2);
  });

  it("marks integers", () => {
    const json = zodToJsonSchema(z.object({ n: z.number().int() }));
    expect((json.properties?.n as { type?: string }).type).toBe("integer");
  });

  it("unwraps optional and default wrappers", () => {
    const json = zodToJsonSchema(z.object({ a: z.string().optional(), b: z.string().default("x") }));
    expect(json.required).toBeUndefined();
  });

  it("does not throw on deeply nested structures", () => {
    const schema = z.object({
      outer: z.object({ inner: z.array(z.object({ v: z.string() })) }),
    });
    expect(() => zodToJsonSchema(schema)).not.toThrow();
  });

  it("degrades to a permissive schema instead of throwing on unknown types", () => {
    const weird = z.map(z.string(), z.string());
    expect(() => zodToJsonSchema(weird)).not.toThrow();
  });
});

describe("toToolDefinitions", () => {
  it("builds definitions from Zod-backed tools", () => {
    const defs = toToolDefinitions([
      { name: "Grep", description: "Search contents", inputSchema: z.object({ pattern: z.string() }) },
    ]);

    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("Grep");
    expect(defs[0].inputSchema.type).toBe("object");
  });

  it("skips duplicate names and tools without names", () => {
    const defs = toToolDefinitions([
      { name: "A", description: "a", inputSchema: z.object({}) },
      { name: "A", description: "a again", inputSchema: z.object({}) },
      { name: "", description: "no name", inputSchema: z.object({}) },
    ]);
    expect(defs).toHaveLength(1);
  });
});

describe("normalizeToolArguments", () => {
  it("passes objects through", () => {
    expect(normalizeToolArguments({ a: 1 })).toEqual({ a: 1 });
  });

  it("parses JSON strings", () => {
    expect(normalizeToolArguments('{"a":1}')).toEqual({ a: 1 });
  });

  it("salvages prose-wrapped JSON", () => {
    expect(normalizeToolArguments('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it("returns empty object on malformed input instead of throwing", () => {
    expect(normalizeToolArguments("not json at all")).toEqual({});
    expect(normalizeToolArguments(null)).toEqual({});
    expect(normalizeToolArguments(undefined)).toEqual({});
    expect(normalizeToolArguments(42)).toEqual({});
    expect(normalizeToolArguments("[1,2]")).toEqual({});
  });
});

describe("normalizeToolCall", () => {
  it("normalizes Anthropic-shaped calls", () => {
    const call = normalizeToolCall({ id: "toolu_1", name: "Read", input: { filePath: "a.ts" } });
    expect(call).toEqual({ id: "toolu_1", name: "Read", input: { filePath: "a.ts" } });
  });

  it("normalizes OpenAI-shaped calls (arguments is a JSON string)", () => {
    const call = normalizeToolCall({
      id: "call_1",
      type: "function",
      function: { name: "Read", arguments: '{"filePath":"a.ts"}' },
    } as never);
    expect(call.name).toBe("Read");
    expect(call.input).toEqual({ filePath: "a.ts" });
  });

  it("generates an id when the provider omits one", () => {
    const call = normalizeToolCall({ name: "Read", input: {} }, 3);
    expect(call.id).toBeTruthy();
  });

  it("drops tool calls without a name", () => {
    expect(normalizeToolCalls([{}, { name: "X", input: {} }])).toHaveLength(1);
  });
});

describe("StreamToolCallAccumulator", () => {
  it("reconstructs a tool call from fragments", () => {
    const acc = new StreamToolCallAccumulator();

    acc.push({ index: 0, id: "call_1", function: { name: "Read", arguments: '{"file' } });
    acc.push({ index: 0, function: { arguments: 'Path":"a.ts"}' } });

    const calls = acc.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("Read");
    expect(calls[0].input).toEqual({ filePath: "a.ts" });
  });

  it("keeps parallel tool calls separate by index", () => {
    const acc = new StreamToolCallAccumulator();

    acc.push({ index: 0, id: "a", function: { name: "Read", arguments: '{"x":1}' } });
    acc.push({ index: 1, id: "b", function: { name: "Grep", arguments: '{"y":2}' } });

    const calls = acc.flush();
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.name).sort()).toEqual(["Grep", "Read"]);
  });

  it("drops fragments with no name", () => {
    const acc = new StreamToolCallAccumulator();
    acc.push({ index: 0, function: { arguments: '{"x":1}' } });
    expect(acc.flush()).toHaveLength(0);
  });

  it("clears after flush", () => {
    const acc = new StreamToolCallAccumulator();
    acc.push({ index: 0, id: "a", function: { name: "Read", arguments: "{}" } });
    acc.flush();
    expect(acc.size).toBe(0);
  });
});

// ============================================
// MESSAGE NORMALIZATION
// ============================================

const toolCall = { id: "toolu_1", name: "Read", input: { filePath: "a.ts" } };

describe("toAnthropicRequest", () => {
  it("moves system messages out of the message list", () => {
    const wire = toAnthropicRequest([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ]);

    expect(wire.system).toBe("You are helpful.");
    expect(wire.messages).toHaveLength(1);
    expect(wire.messages[0].role).toBe("user");
  });

  it("serializes assistant tool calls as tool_use blocks", () => {
    const wire = toAnthropicRequest([
      { role: "user", content: "read a.ts" },
      { role: "assistant", content: "", toolCalls: [toolCall] },
    ]);

    const blocks = wire.messages[1].content;
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
    const toolUse = blocks.find((b) => b.type === "tool_use") as { id: string; name: string; input: unknown };
    expect(toolUse.id).toBe("toolu_1");
    expect(toolUse.name).toBe("Read");
  });

  it("WRONG-SHAPE GUARD: tool results must be tool_result blocks in a user message", () => {
    const wire = toAnthropicRequest([
      { role: "assistant", content: "", toolCalls: [toolCall] },
      { role: "tool", content: "file contents", toolCallId: "toolu_1" },
    ]);

    // The old implementation emitted { role: "tool", tool_call_id } which is
    // OpenAI's shape and makes the Anthropic API return 400.
    const resultMessage = wire.messages[1];
    expect(resultMessage.role).toBe("user");
    expect(resultMessage.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: "file contents",
    });
    // Critically: it must NOT be role "tool"
    expect(resultMessage.role).not.toBe("tool");
  });

  it("groups parallel tool results into a single user message", () => {
    const wire = toAnthropicRequest([
      { role: "assistant", content: "", toolCalls: [toolCall, { ...toolCall, id: "toolu_2", name: "Grep" }] },
      { role: "tool", content: "one", toolCallId: "toolu_1" },
      { role: "tool", content: "two", toolCallId: "toolu_2" },
    ]);

    // messages[0] = assistant, messages[1] = single user holding BOTH results
    expect(wire.messages).toHaveLength(2);
    const userMessage = wire.messages[1];
    expect(userMessage.content).toHaveLength(2);
    expect(userMessage.content.every((b) => b.type === "tool_result")).toBe(true);
  });

  it("keeps tool_result errors distinguishable", () => {
    const wire = toAnthropicRequest([
      { role: "tool", content: "boom", toolCallId: "toolu_1", isError: true },
    ]);
    expect(wire.messages[0].content[0]).toMatchObject({ type: "tool_result", is_error: true });
  });

  it("handles empty input without throwing", () => {
    expect(() => toAnthropicRequest([])).not.toThrow();
  });
});

describe("toOpenAIMessages", () => {
  it("serializes tool calls with stringified arguments", () => {
    const out = toOpenAIMessages([{ role: "assistant", content: "thinking", toolCalls: [toolCall] }]);

    const msg = out[0] as { tool_calls?: Array<{ function: { name: string; arguments: string } }> };
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls?.[0].function.name).toBe("Read");
    // OpenAI requires arguments as a JSON *string*
    expect(typeof msg.tool_calls?.[0].function.arguments).toBe("string");
    expect(JSON.parse(msg.tool_calls?.[0].function.arguments as string)).toEqual({ filePath: "a.ts" });
  });

  it("returns tool results as role tool with tool_call_id", () => {
    const out = toOpenAIMessages([{ role: "tool", content: "result", toolCallId: "call_1" }]);
    expect(out[0]).toMatchObject({ role: "tool", content: "result", tool_call_id: "call_1" });
  });

  it("preserves system role", () => {
    const out = toOpenAIMessages([{ role: "system", content: "sys" }]);
    expect(out[0]).toMatchObject({ role: "system", content: "sys" });
  });
});

describe("toOllamaMessages", () => {
  it("passes arguments as objects (not strings)", () => {
    const out = toOllamaMessages([{ role: "assistant", content: "", toolCalls: [toolCall] }]);
    const msg = out[0] as { tool_calls?: Array<{ function: { arguments: unknown } }> };
    expect(msg.tool_calls?.[0].function.arguments).toEqual({ filePath: "a.ts" });
    expect(typeof msg.tool_calls?.[0].function.arguments).toBe("object");
  });
});

describe("toGeminiRequest", () => {
  it("splits system instruction from contents", () => {
    const wire = toGeminiRequest([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(wire.systemInstruction?.parts?.[0]?.text).toBe("sys");
    expect(wire.contents).toHaveLength(1);
    expect(wire.contents[0].role).toBe("user");
  });

  it("maps assistant tool calls to functionCall parts", () => {
    const wire = toGeminiRequest([{ role: "assistant", content: "", toolCalls: [toolCall] }]);
    const parts = wire.contents[0].parts;
    expect(parts.some((p) => p.functionCall?.name === "Read")).toBe(true);
  });

  it("maps tool results to functionResponse parts", () => {
    const wire = toGeminiRequest([
      { role: "tool", content: "out", toolCallId: "x", name: "Read" },
    ]);
    const parts = wire.contents[0].parts;
    expect(parts[0].functionResponse).toBeDefined();
    expect(parts[0].functionResponse?.name).toBe("Read");
    expect(wire.contents[0].role).toBe("user");
  });

  it("never flattens the conversation into one string", () => {
    const wire = toGeminiRequest([
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
    // Regression guard: the old implementation joined everything into ONE user part.
    expect(wire.contents).toHaveLength(3);
    expect(wire.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });
});
