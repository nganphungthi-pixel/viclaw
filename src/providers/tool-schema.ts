/**
 * Tool schema utilities.
 *
 * Converts Zod input schemas into JSON Schema tool definitions that can be sent
 * to LLM providers via their native `tools` / `tool_choice` parameters.
 *
 * Why a hand-rolled converter instead of `zod-to-json-schema`:
 *  - zero extra dependency to install/maintain
 *  - supports exactly the Zod subset this codebase uses, and degrades safely
 *    (unknown types fall back to a permissive object schema instead of throwing)
 *
 * Tested in tests/tool-schema.test.ts.
 */

import { z } from "zod";

// ============================================
// TYPES
// ============================================

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  [key: string]: unknown;
}

/** A tool as declared to an LLM provider. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** Anything that looks like a tool with a Zod input schema. */
export interface SchemaBearingTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
}

/** Provider-agnostic tool choice. */
export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "tool"; name: string };

export interface ToolRequestOptions {
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  /**
   * Opt-in to Anthropic prompt caching (`cache_control: { type: "ephemeral" }`
   * on the system prompt + tools breakpoint). Off by default so cached and
   * uncached request shapes stay distinguishable in tests; the agent loop
   * enables it via `AgentConfig.enablePromptCache`.
   */
  enablePromptCache?: boolean;
}

// ============================================
// ZOD -> JSON SCHEMA
// ============================================

const PERMISSIVE: JsonSchema = { type: "object", additionalProperties: true };

/**
 * Prefer zod's native converter when the installed zod provides it.
 *
 * `zod-to-json-schema` was officially deprecated in Nov 2025 in favour of
 * zod v4's `z.toJSONSchema()` (see the deprecation notice on its npm page).
 * Precisely: zod >= 3.25 bundles v3 and v4 side by side — v4 lives under the
 * `zod/v4` subpath while the package root stays v3 until 4.0.0 — so this code
 * prefers a native `toJSONSchema` only when the installed zod actually exposes
 * one. When neither is available we fall back to the local converter below,
 * which supports the subset of Zod this codebase uses.
 */
let nativeToJsonSchema: ((schema: z.ZodSchema, options?: Record<string, unknown>) => JsonSchema) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyZ = z as any;
  if (typeof anyZ.toJSONSchema === "function") {
    nativeToJsonSchema = (schema: z.ZodSchema, options?: Record<string, unknown>) =>
      anyZ.toJSONSchema(schema, { target: "draft-7", ...options }) as JsonSchema;
  }
} catch {
  nativeToJsonSchema = null;
}

/** Force the local converter on or off (used by tests). */
export function setNativeConverterEnabled(enabled: boolean): void {
  if (!enabled) {
    nativeToJsonSchema = null;
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyZ = z as any;
    nativeToJsonSchema = typeof anyZ.toJSONSchema === "function"
      ? (schema: z.ZodSchema, options?: Record<string, unknown>) =>
          anyZ.toJSONSchema(schema, { target: "draft-7", ...options }) as JsonSchema
      : null;
  } catch {
    nativeToJsonSchema = null;
  }
}

/** Strip a leading `*` and trailing `?`/`.` from a JSDoc-ish description. */
function describeOf(schema: z.ZodSchema): string | undefined {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const raw = def?.description;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function withDescription(schema: z.ZodSchema, json: JsonSchema): JsonSchema {
  const description = describeOf(schema);
  return description ? { description, ...json } : json;
}

/**
 * Convert a Zod schema to JSON Schema.
 * Unknown/unsupported Zod types degrade to `{ type: "object", additionalProperties: true }`
 * rather than throwing, so a single odd field can never break tool calling.
 */
export function zodToJsonSchema(schema: z.ZodSchema): JsonSchema {
  if (nativeToJsonSchema) {
    try {
      return withDescription(schema, nativeToJsonSchema(schema));
    } catch {
      // Fall through to the local converter.
    }
  }
  return withDescription(schema, convert(schema));
}

function convert(schema: z.ZodSchema): JsonSchema {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const typeName = def?.typeName as string | undefined;

  switch (typeName) {
    case "ZodString":
      return convertString(def!);
    case "ZodNumber":
      return convertNumber(def!);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodAny":
    case "ZodUnknown":
      return {};
    case "ZodObject":
      return convertObject(schema, def!);
    case "ZodArray": {
      const inner = def!.type as z.ZodSchema | undefined;
      return { type: "array", items: inner ? zodToJsonSchema(inner) : {} };
    }
    case "ZodEnum":
      return { type: "string", enum: [...(def!.values as string[])] };
    case "ZodNativeEnum": {
      const values = def!.values as Record<string, unknown>;
      const unique = [...new Set(Object.values(values))];
      const allStrings = unique.every((v) => typeof v === "string");
      return { type: allStrings ? "string" : "number", enum: unique };
    }
    case "ZodLiteral":
      return { const: def!.value };
    case "ZodOptional":
      return convert(def!.innerType as z.ZodSchema);
    case "ZodNullable": {
      const inner = convert(def!.innerType as z.ZodSchema);
      return { anyOf: [inner, { type: "null" }] };
    }
    case "ZodDefault": {
      const inner = convert(def!.innerType as z.ZodSchema);
      let defaultValue: unknown;
      try {
        defaultValue = (def!.defaultValue as () => unknown)();
      } catch {
        defaultValue = undefined;
      }
      return defaultValue === undefined ? inner : { default: defaultValue, ...inner };
    }
    case "ZodUnion": {
      const options = (def!.options as z.ZodSchema[]) || [];
      return { anyOf: options.map((o) => zodToJsonSchema(o)) };
    }
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: def!.valueType ? zodToJsonSchema(def!.valueType as z.ZodSchema) : true,
      };
    case "ZodTuple": {
      const items = (def!.items as z.ZodSchema[]) || [];
      return { type: "array", items: items.length === 1 ? zodToJsonSchema(items[0]) : { anyOf: items.map((i) => zodToJsonSchema(i)) } };
    }
    case "ZodEffects":
      // .refine() / .transform() wrappers: unwrap to the underlying schema.
      return convert(def!.schema as z.ZodSchema);
    case "ZodLazy":
      return convert((def!.getter as () => z.ZodSchema)());
    default:
      return { ...PERMISSIVE };
  }
}

function convertString(def: Record<string, unknown>): JsonSchema {
  const json: JsonSchema = { type: "string" };
  const checks = (def.checks as Array<Record<string, unknown>>) || [];
  for (const check of checks) {
    switch (check.kind) {
      case "min":
        json.minLength = check.value as number;
        break;
      case "max":
        json.maxLength = check.value as number;
        break;
      case "email":
        json.format = "email";
        break;
      case "url":
        json.format = "uri";
        break;
      case "uuid":
        json.format = "uuid";
        break;
      case "datetime":
        json.format = "date-time";
        break;
      case "regex":
        // JSON Schema `pattern` is not universally supported by LLM providers,
        // so we keep it descriptive instead of authoritative.
        json.pattern = String(check.regex);
        break;
      default:
        break;
    }
  }
  return json;
}

function convertNumber(def: Record<string, unknown>): JsonSchema {
  const checks = (def.checks as Array<Record<string, unknown>>) || [];
  const isInt = checks.some((c) => c.kind === "int");
  const json: JsonSchema = { type: isInt ? "integer" : "number" };
  for (const check of checks) {
    if (check.kind === "min") json.minimum = check.value as number;
    if (check.kind === "max") json.maximum = check.value as number;
  }
  return json;
}

function convertObject(schema: z.ZodSchema, def: Record<string, unknown>): JsonSchema {
  let shape: Record<string, z.ZodSchema>;
  const rawShape = def.shape;

  if (typeof rawShape === "function") {
    shape = (rawShape as () => Record<string, z.ZodSchema>)();
  } else if (rawShape && typeof rawShape === "object") {
    shape = rawShape as Record<string, z.ZodSchema>;
  } else {
    return { ...PERMISSIVE };
  }

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodToJsonSchema(value);
    if (!isOptional(value)) {
      required.push(key);
    }
  }

  const json: JsonSchema = { type: "object", properties };
  if (required.length > 0) json.required = required;

  // Unknown-key policy: default to disallowing extras so providers with
  // `strict` mode accept the schema.
  const unknownKeys = def.unknownKeys as string | undefined;
  json.additionalProperties = unknownKeys === "passthrough" ? true : false;

  return json;
}

function isOptional(schema: z.ZodSchema): boolean {
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const typeName = def?.typeName as string | undefined;
  if (typeName === "ZodOptional" || typeName === "ZodDefault" || typeName === "ZodAny" || typeName === "ZodUnknown") {
    return true;
  }
  if (typeName === "ZodEffects") {
    return isOptional(def!.schema as z.ZodSchema);
  }
  // z.string().nullable() is still required unless explicitly optional.
  return false;
}

// ============================================
// TOOL DEFINITIONS
// ============================================

/**
 * Build provider-facing tool definitions from the agent's tool registry.
 * Tools without a Zod schema are skipped rather than breaking the request.
 */
export function toToolDefinitions(tools: SchemaBearingTool[]): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  const seen = new Set<string>();

  for (const tool of tools) {
    if (!tool?.name || seen.has(tool.name)) continue;
    seen.add(tool.name);

    let inputSchema: JsonSchema;
    try {
      inputSchema = zodToJsonSchema(tool.inputSchema);
    } catch {
      inputSchema = { ...PERMISSIVE };
    }

    out.push({
      name: tool.name,
      description: tool.description || `Use the ${tool.name} tool.`,
      inputSchema,
    });
  }

  return out;
}

// ============================================
// TOOL CALL NORMALIZATION
// ============================================

/**
 * Providers disagree about how tool arguments arrive:
 *   - OpenAI / Ollama / OpenRouter: `function.arguments` is a JSON *string*
 *   - Anthropic / Gemini / Bedrock: `input` / `args` is already an object
 * This normalizes both, and never throws on malformed input.
 */
export function normalizeToolArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      // Some models emit prose-wrapped JSON; try to salvage it.
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, end + 1));
          return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
        } catch {
          return {};
        }
      }
      return {};
    }
  }
  return {};
}

export interface RawToolCall {
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  function?: { name?: string; arguments?: unknown };
}

/** Normalize a raw tool call from any provider into the internal ToolCall shape. */
export function normalizeToolCall(raw: RawToolCall, index = 0): { id: string; name: string; input: Record<string, unknown> } {
  const name = raw.name || raw.function?.name || "";
  const rawArgs = raw.input !== undefined ? raw.input : (raw.arguments !== undefined ? raw.arguments : raw.function?.arguments);
  return {
    id: raw.id || `call_${index}_${Date.now()}`,
    name,
    input: normalizeToolArguments(rawArgs),
  };
}

/** Normalize a list of raw tool calls, dropping any without a name. */
export function normalizeToolCalls(raw: RawToolCall[] | undefined | null): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry, index) => normalizeToolCall(entry, index))
    .filter((entry) => entry.name.length > 0);
}

// ============================================
// STREAMING TOOL CALL ACCUMULATION
// ============================================

/**
 * OpenAI / OpenRouter stream tool calls as *fragments*: the first delta carries
 * `id` + `function.name`, later deltas carry pieces of `function.arguments`, and
 * each fragment repeats the same `index`. Emitting one tool call per fragment
 * yields broken (empty) arguments, so fragments must be buffered per index and
 * flushed when the stream ends.
 */
export class StreamToolCallAccumulator {
  private calls = new Map<number, { id: string; name: string; args: string }>();

  /** Feed one streamed tool-call delta. */
  push(delta: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
    name?: string;
    arguments?: unknown;
  }): void {
    const index = typeof delta.index === "number" ? delta.index : 0;
    const existing = this.calls.get(index) || { id: "", name: "", args: "" };

    if (delta.id) existing.id = delta.id;
    const name = delta.function?.name ?? delta.name;
    if (name) existing.name = name;

    const argsFragment = delta.function?.arguments ?? delta.arguments;
    if (typeof argsFragment === "string") existing.args += argsFragment;
    else if (argsFragment && typeof argsFragment === "object" && existing.args === "") {
      existing.args = JSON.stringify(argsFragment);
    }

    this.calls.set(index, existing);
  }

  /** Flush every buffered call. Call this when the stream finishes. */
  flush(): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    const out: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    for (const [index, entry] of this.calls.entries()) {
      if (!entry.name) continue;
      out.push({
        id: entry.id || `call_${index}_${Date.now()}`,
        name: entry.name,
        input: normalizeToolArguments(entry.args),
      });
    }
    this.calls.clear();
    return out;
  }

  get size(): number {
    return this.calls.size;
  }

  clear(): void {
    this.calls.clear();
  }
}
