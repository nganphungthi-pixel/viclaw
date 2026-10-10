import {
  createProvider,
  createFallbackProvider,
  createFreeStackProvider,
  toToolDefinitions,
  Message,
  Chunk,
  Response,
  Provider,
  getDefaultConfig,
  type ToolRequestOptions,
} from "../providers/mod.js";
import { MemorySystem, MemoryType } from "../memory/mod.js";
import { SQLiteMemory } from "../memory/sqlite.js";
import { ToolExecutor, Tool, ToolResult } from "../tools/mod.js";
import { z } from "zod";
import { learningEngine, Interaction } from "./learning.js";
import { taskAnalyzer, TaskAnalysis, TaskCategory } from "./router.js";
import { SandboxManager, getSandboxManager, ExecutionResult as SandboxExecutionResult } from "../sandbox/mod.js";
import { SubAgentManager, SubAgentConfig, SubAgentResult } from "./subagent.js";

export enum ThinkingLevel {
  Low = "low",
  Medium = "medium",
  High = "high",
  XHigh = "xhigh",
}

export interface AgentConfig {
  maxIterations: number;
  maxTokens: number;
  temperature: number;
  thinkingLevel: ThinkingLevel;
  stream: boolean;
  enableRetry: boolean;
  maxRetries: number;
  contextWindow: number;
  compactThreshold: number;
  enableLearning: boolean;
  enableMultiModelRouting: boolean;
  enableSandbox: boolean;
  sandboxType: "docker" | "process" | "none";
  /**
   * Anthropic prompt caching (`cache_control` on system + tools). Default on:
   * the agent loop re-sends the same large prefixes every turn, and caching
   * cuts that cost/latency. Opt-out per call is still possible — providers only
   * cache when `ToolRequestOptions.enablePromptCache` is set.
   */
  enablePromptCache: boolean;
}

export interface AgentContext {
  sessionId: string;
  workingDirectory: string;
  messages: Message[];
  toolHistory: ToolHistoryEntry[];
  iteration: number;
  startTime: number;
  taskAnalysis?: TaskAnalysis;
}

export interface ToolHistoryEntry {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  timestamp: number;
  success: boolean;
}

export interface AgentResult {
  content: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  iterations: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  done: boolean;
  error?: string;
  learningMetrics?: { patternsExtracted: number; lessonsLearned: number };
  subAgents?: SubAgentResult[];
}

export interface StreamCallback {
  onContent?: (content: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; input: Record<string, unknown> }) => void;
  onToolResult?: (result: ToolResult) => void;
  onThinking?: (thinking: string) => void;
  onDone?: (result: AgentResult) => void;
  onError?: (error: Error) => void;
  onSubAgent?: (result: SubAgentResult) => void;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxIterations: 50,
  maxTokens: 8192,
  temperature: 0.7,
  thinkingLevel: ThinkingLevel.Medium,
  stream: true,
  enableRetry: true,
  maxRetries: 3,
  contextWindow: 100000,
  compactThreshold: 50000,
  enableLearning: true,
  enableMultiModelRouting: false,
  enableSandbox: false,
  sandboxType: "process",
  enablePromptCache: true,
};

const SYSTEM_PROMPT = `You are Viclaw, an AI coding agent that runs on your machine.

## Core Capabilities
- **Code Expert**: Next.js, React, Tailwind, shadcn/ui, WordPress, TypeScript, Python, Go, Rust
- **Service Integration**: Supabase, Firebase, Vercel, GitHub, Resend, Hostinger, PostgreSQL
- **Web Research**: Exa-backed search by default; Brave/Serper/Bing/Tavily/GitHub available with API keys, DuckDuckGo as keyless fallback
- **Deep Reasoning**: Chain-of-thought analysis for complex problems
- **Multi-Agent Orchestration**: Spawn sub-agents for parallel execution
- **MCP Connected**: External service integrations via Model Context Protocol
- **Cross-Platform**: Runs on Windows, Linux, macOS

## Available Tools
- Read: Read file contents with optional offset and limit
- Write: Create or overwrite files
- Edit: Edit files by replacing specific text
- Bash: Execute shell commands
- Glob: Find files by glob pattern
- Grep: Search file contents with a regular expression
- WebSearch: Multi-engine web search
- WebFetch: Fetch content from URLs
- Memory: Persistent key-value storage
- Skills: Load and execute specialized skills
- SubAgent: Spawn sub-agents for parallel task execution
- Research: Deep research across multiple search engines
- Reason: Deep reasoning with chain-of-thought analysis

Tools are invoked through the model's native tool-calling interface. Choose the
narrowest tool that fits: use Glob to locate files, Grep to find symbols or
strings, and only Read a file once you know which part you need.

## How to Work
1. Analyze the task and activate relevant expertise patterns
2. Use Research for information gathering when needed
3. Use Reason for complex analysis and debugging
4. Use tools to gather information or make changes
5. Spawn sub-agents for parallelizable tasks
6. Execute commands and analyze results
7. Continue until the task is complete

Always verify your work. When researching, cite sources. When reasoning, show your work. When coding, follow best practices.`;

const THINKING_PROMPTS: Record<ThinkingLevel, string> = {
  [ThinkingLevel.Low]: "Think briefly about how to approach this task.",
  [ThinkingLevel.Medium]: "Think carefully about the best approach to solve this task. Consider the steps needed and potential challenges.",
  [ThinkingLevel.High]: "Think deeply about this task. Analyze the requirements thoroughly, consider multiple approaches, and plan your execution step by step.",
  [ThinkingLevel.XHigh]: "Think extensively about this task. Perform thorough reasoning, consider all edge cases, plan detailed steps, and anticipate potential issues. Explain your reasoning clearly.",
};

const AgentConfigSchema = z.object({
  maxIterations: z.number().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  thinkingLevel: z.nativeEnum(ThinkingLevel).optional(),
  stream: z.boolean().optional(),
  enableRetry: z.boolean().optional(),
  maxRetries: z.number().optional(),
  contextWindow: z.number().optional(),
  compactThreshold: z.number().optional(),
  enableLearning: z.boolean().optional(),
  enableMultiModelRouting: z.boolean().optional(),
  enableSandbox: z.boolean().optional(),
  sandboxType: z.enum(["docker", "process", "none"]).optional(),
  enablePromptCache: z.boolean().optional(),
});

export class AgentLoop {
  private config: AgentConfig;
  private provider: Provider;
  private memory: MemorySystem;
  private sqliteMemory?: SQLiteMemory;
  private tools: ToolExecutor;
  private context: AgentContext;
  private loopDetection: Map<string, number>;
  private toolCallSignature: string;
  private streaming: boolean;
  private callback: StreamCallback;
  private sandboxManager?: SandboxManager;
  private subAgentManager?: SubAgentManager;
  private currentTaskStartTime: number;

  constructor(
    config: Partial<AgentConfig> = {},
    provider?: Provider,
    memory?: MemorySystem,
    tools?: ToolExecutor
  ) {
    const parsedConfig = AgentConfigSchema.parse(config);
    this.config = { ...DEFAULT_AGENT_CONFIG, ...parsedConfig };
    // One-switch $0 inference: VICLAW_FREE_STACK=true routes every turn
    // through Ollama → Gemini free → OpenRouter :free (see docs/FREE-STACK.md).
    // An explicitly passed provider always wins over the switch.
    this.provider =
      provider ||
      (process.env.VICLAW_FREE_STACK === "true" ? createFreeStackProvider() : createProvider());
    this.memory = memory || new MemorySystem();
    this.tools = tools || new ToolExecutor();
    this.loopDetection = new Map();
    this.toolCallSignature = "";
    this.streaming = false;
    this.callback = {};
    this.currentTaskStartTime = Date.now();

    if (this.config.enableSandbox && this.config.sandboxType !== "none") {
      this.sandboxManager = getSandboxManager();
    }

    this.context = {
      sessionId: this.memory.getSessionId(),
      workingDirectory: process.cwd(),
      messages: [],
      toolHistory: [],
      iteration: 0,
      startTime: Date.now(),
    };

    this.initializeMessages();
    this.initializeSQLiteMemory();
  }

  private async initializeSQLiteMemory(): Promise<void> {
    try {
      this.sqliteMemory = new SQLiteMemory();
      await this.sqliteMemory.initialize();
    } catch (error) {
      // SQLite is optional - fall back to JSON memory
      this.sqliteMemory = undefined;
    }
  }

  private initializeMessages(): void {
    this.context.messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
    ];
  }

  setCallback(callback: StreamCallback): void {
    this.callback = callback;
  }

  setWorkingDirectory(dir: string): void {
    this.context.workingDirectory = dir;
    this.tools.setWorkingDirectory(dir);
  }

  private buildContext(): string {
    const parts: string[] = [];

    const sessionCtx = this.memory.getSessionContext();
    if (sessionCtx.size > 0) {
      parts.push("## Session Context");
      for (const [key, value] of sessionCtx) {
        parts.push("- " + key + ": " + JSON.stringify(value));
      }
    }

    const workingCtx = this.memory.getWorkingContext();
    if (workingCtx.size > 0) {
      parts.push("## Working Context");
      for (const [key, value] of workingCtx) {
        parts.push("- " + key + ": " + JSON.stringify(value));
      }
    }

    const patterns = this.memory.getPatterns();
    if (patterns.length > 0) {
      parts.push("## Learned Patterns");
      for (const pattern of patterns.slice(-5)) {
        parts.push("- " + pattern.name + ": " + pattern.description);
      }
    }

    const metrics = learningEngine.getMetrics();
    if (metrics.lessonsLearned > 0) {
      parts.push("## Learning Metrics");
      parts.push("- Success Rate: " + (metrics.successRate * 100).toFixed(1) + "%");
      parts.push("- Lessons Learned: " + metrics.lessonsLearned);
      parts.push("- Patterns Extracted: " + metrics.patternsExtracted);
    }

    return parts.length > 0 ? parts.join("\n") : "";
  }

  private async think(prompt: string): Promise<string> {
    const thinkingPrompt = THINKING_PROMPTS[this.config.thinkingLevel] + "\n\nTask: " + prompt;

    const messages: Message[] = [
      ...this.context.messages,
      { role: "user", content: thinkingPrompt },
    ];

    try {
      const response = await this.provider.chat(messages);
      return response.content;
    } catch (error) {
      return "Thinking failed: " + (error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Build the provider request options that declare this agent's tools.
   *
   * This is the piece that makes the agent an *agent*: without sending tool
   * definitions to the model, it has no way to know tools exist or how to call
   * them, and no tool can ever be invoked.
   */
  private buildToolOptions(): ToolRequestOptions {
    const tools = toToolDefinitions(this.tools.getAllTools());
    const enablePromptCache = this.config.enablePromptCache === true;
    return tools.length > 0
      ? { tools, toolChoice: "auto", ...(enablePromptCache ? { enablePromptCache: true as const } : {}) }
      : {};
  }

  private async executeTool(toolCall: { id: string; name: string; input: Record<string, unknown> }): Promise<ToolResult> {
    const id = toolCall.id;
    const name = toolCall.name;
    const input = toolCall.input;

    let result: ToolResult;

    if (this.config.enableSandbox && this.sandboxManager && name === "Bash") {
      const command = input.command as string;
      const timeout = (input.timeout as number) || 120000;

      const sandboxResult = await this.sandboxManager.sandboxedExec(command, {
        timeout,
        workingDirectory: this.context.workingDirectory,
      });

      result = {
        toolCallId: id,
        content: sandboxResult.output + (sandboxResult.error ? "\n" + sandboxResult.error : ""),
        isError: !sandboxResult.success,
      };
    } else {
      result = await this.tools.executeTool(name, input, id);
    }

    this.context.toolHistory.push({
      toolCallId: id,
      toolName: name,
      input: input,
      output: result.content,
      timestamp: Date.now(),
      success: !result.isError,
    });

    return result;
  }

  private detectLoop(toolCalls: Array<{ name: string; input: Record<string, unknown> }>): boolean {
    const signature = JSON.stringify(toolCalls);

    if (signature === this.toolCallSignature) {
      const count = (this.loopDetection.get(signature) || 0) + 1;
      this.loopDetection.set(signature, count);

      if (count >= 3) {
        return true;
      }
    } else {
      this.loopDetection.set(signature, 1);
      this.toolCallSignature = signature;
    }

    return false;
  }

  /**
   * Structured context compaction.
   *
   * The old implementation replaced history with a message *count*, discarding
   * every decision, file touch, and tool output. This version builds a structured
   * digest from tool history + recent turns (goal / decisions / files touched /
   * tool outcomes / open items) so the next turn keeps working context.
   * When an LLM summarizer is available, callers should prefer it and pass the
   * result via `compactContextWithSummary()`; this deterministic digest is the
   * always-available fallback and never returns a bare count.
   */
  private buildCompactionDigest(dropped: Message[]): string {
    const lines: string[] = [];
    const history = this.context.toolHistory;
    const succeeded = history.filter((h) => h.success);
    const failed = history.filter((h) => !h.success);

    lines.push(`Compacted ${dropped.length} older messages (${history.length} tool executions: ${succeeded.length} succeeded, ${failed.length} failed).`);

    const files = new Set<string>();
    for (const h of history) {
      const input = h.input as Record<string, unknown>;
      for (const key of ["filePath", "file", "path"]) {
        if (typeof input[key] === "string" && (input[key] as string).length > 0) {
          files.add(input[key] as string);
        }
      }
    }
    if (files.size > 0) {
      lines.push(`Files touched: ${[...files].slice(0, 20).join(", ")}${files.size > 20 ? ` (+${files.size - 20} more)` : ""}.`);
    }

    const toolCounts = new Map<string, number>();
    for (const h of history) toolCounts.set(h.toolName, (toolCounts.get(h.toolName) || 0) + 1);
    if (toolCounts.size > 0) {
      lines.push(`Tool usage: ${[...toolCounts.entries()].map(([n, c]) => `${n}x${c}`).join(", ")}.`);
    }

    for (const h of failed.slice(-5)) {
      lines.push(`FAILED ${h.toolName}: ${h.output.slice(0, 200)}.`);
    }
    for (const h of succeeded.slice(-5)) {
      if (h.output.length > 0) {
        lines.push(`OUT ${h.toolName}: ${h.output.slice(0, 300)}.`);
      }
    }

    const userGoals = dropped
      .filter((m) => m.role === "user" && !m.toolCallId)
      .map((m) => m.content.slice(0, 200));
    if (userGoals.length > 0) {
      lines.push(`Earlier user goals: ${userGoals.slice(-3).join(" | ")}.`);
    }
    return lines.join("\n");
  }

  private async compactContext(): Promise<void> {
    const messages = this.context.messages;
    if (messages.length <= 4) return;

    const systemMsg = messages[0];
    const recentMessages = messages.slice(-6);
    const dropped = messages.slice(1, messages.length - 6);
    const digest = this.buildCompactionDigest(dropped);

    this.context.messages = [
      systemMsg,
      { role: "user", content: "[Compacted context — structured digest, not a message count:]\n" + digest },
      ...recentMessages.slice(1),
    ];

    await this.memory.saveMemory(
      "last_compaction",
      { timestamp: Date.now(), messageCount: messages.length, digest },
      MemoryType.Session
    );
  }

  private estimateTokenCount(messages: Message[]): number {
    let count = 0;
    for (const msg of messages) {
      count += Math.ceil(msg.content.length / 4);
    }
    return count;
  }

  private async recordInteraction(prompt: string, result: AgentResult, error?: Error): Promise<void> {
    if (!this.config.enableLearning) return;

    const toolsUsed = this.context.toolHistory
      .slice(-result.iterations)
      .map(entry => entry.toolName);

    const duration = Date.now() - this.currentTaskStartTime;

    const interaction: Omit<Interaction, 'id' | 'timestamp'> = {
      query: prompt,
      response: result.content,
      toolsUsed,
      iterations: result.iterations,
      success: result.done && !result.error,
      duration,
      userFeedback: result.error ? 'negative' : 'positive',
    };

    await learningEngine.recordInteraction(interaction);

    if (error) {
      const lastInteraction = this.context.toolHistory[this.context.toolHistory.length - 1];
      if (lastInteraction) {
        await learningEngine.analyzeFailure(
          { ...interaction, id: lastInteraction.toolCallId, timestamp: Date.now() },
          error
        );
      }
    }
  }

  private async analyzeTaskComplexity(prompt: string): Promise<TaskAnalysis> {
    const analysis = taskAnalyzer.analyzeComplexity(prompt);
    this.context.taskAnalysis = analysis;
    return analysis;
  }

  private async spawnSubAgentsIfNeeded(prompt: string): Promise<SubAgentResult[]> {
    if (!this.subAgentManager) {
      this.subAgentManager = new SubAgentManager({
        maxConcurrent: 3,
        defaultProvider: this.provider,
        memory: this.memory,
        tools: this.tools,
      });
    }

    const analysis = this.context.taskAnalysis;
    if (!analysis || analysis.complexity < 60) {
      return [];
    }

    const subAgents = await this.subAgentManager.spawnSubAgents(prompt, analysis);
    return subAgents;
  }

  private async executeWithRetry(
    prompt: string,
    context?: { useThinking?: boolean; forceResult?: boolean }
  ): Promise<AgentResult> {
    const messages: Message[] = [
      ...this.context.messages,
    ];

    const contextInfo = this.buildContext();
    if (contextInfo) {
      messages.push({
        role: "user",
        content: "Context:\n" + contextInfo + "\n\nTask: " + prompt,
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= this.config.maxRetries) {
      try {
        if (context?.useThinking) {
          const thinking = await this.think(prompt);
          if (this.callback.onThinking) {
            this.callback.onThinking(thinking);
          }
          messages.push({ role: "assistant", content: thinking });
        }

        if (this.config.stream) {
          return await this.handleStreaming(prompt, messages);
        } else {
          return await this.handleNonStreaming(prompt, messages);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.config.enableRetry || retries >= this.config.maxRetries) {
          break;
        }

        retries++;
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }

    return {
      content: "",
      iterations: this.context.iteration,
      done: false,
      error: lastError?.message || "Unknown error",
    };
  }

  private async handleStreaming(prompt: string, messages: Message[]): Promise<AgentResult> {
    this.streaming = true;
    let fullContent = "";
    let toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of this.provider.streamChat(messages, this.buildToolOptions())) {
        switch (chunk.type) {
          case "content":
          case "message_delta":
            if (chunk.delta) {
              fullContent += chunk.delta;
              if (this.callback.onContent) {
                this.callback.onContent(chunk.delta);
              }
            }
            break;

          case "tool_use":
            if (chunk.toolCall) {
              toolCalls.push(chunk.toolCall);
              if (this.callback.onToolCall) {
                this.callback.onToolCall(chunk.toolCall);
              }
            }
            break;

          case "message_start":
            break;

          case "message_stop":
            usage = chunk.usage ? {
              inputTokens: chunk.usage.inputTokens,
              outputTokens: chunk.usage.outputTokens,
              totalTokens: chunk.usage.inputTokens + chunk.usage.outputTokens,
            } : undefined;
            break;

          case "error":
            if (this.callback.onError) {
              this.callback.onError(new Error(chunk.error || "Stream error"));
            }
            break;
        }
      }
    } finally {
      this.streaming = false;
    }

    if (toolCalls.length > 0) {
      return await this.processToolCalls(toolCalls, fullContent, usage);
    }

    return {
      content: fullContent,
      toolCalls: undefined,
      iterations: this.context.iteration,
      usage: usage,
      done: true,
    };
  }

  private async handleNonStreaming(prompt: string, messages: Message[]): Promise<AgentResult> {
    const response = await this.provider.chat(messages, this.buildToolOptions());

    if (this.callback.onContent && response.content) {
      this.callback.onContent(response.content);
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      return await this.processToolCalls(
        response.toolCalls,
        response.content,
        response.usage
      );
    }

    return {
      content: response.content,
      toolCalls: undefined,
      iterations: this.context.iteration,
      usage: response.usage,
      done: true,
    };
  }

  private async processToolCalls(
    toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
    textContent: string,
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  ): Promise<AgentResult> {
    if (this.detectLoop(toolCalls)) {
      return {
        content: textContent + "\n\n[Loop detected. Stopping to prevent infinite recursion.]",
        iterations: this.context.iteration,
        usage: usage,
        done: true,
        error: "Tool loop detected",
      };
    }

    const toolResults: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      if (toolCall.name === "SubAgent") {
        const subAgentResult = await this.subAgentManager?.executeSubAgent(
          toolCall.input.task as string,
          toolCall.input.name as string
        );
        if (subAgentResult) {
          toolResults.push({
            toolCallId: toolCall.id,
            content: subAgentResult.output,
            isError: subAgentResult.error !== undefined,
          });
          if (this.callback.onSubAgent) {
            this.callback.onSubAgent(subAgentResult);
          }
        }
      } else {
        const result = await this.executeTool(toolCall);
        toolResults.push(result);

        if (this.callback.onToolResult) {
          this.callback.onToolResult(result);
        }
      }

      this.context.messages.push({
        role: "assistant",
        content: "",
        toolCalls: [toolCall],
      });

      const lastResult = toolResults[toolResults.length - 1];
      this.context.messages.push({
        role: "tool",
        content: lastResult.content,
        toolCallId: lastResult.toolCallId,
        // Providers that route tool results by function name (Gemini) need this.
        name: toolCall.name,
        isError: Boolean(lastResult.isError),
      });
    }

    this.context.iteration++;

    if (this.context.iteration >= this.config.maxIterations) {
      return {
        content: textContent + "\n\n[Max iterations reached.]",
        iterations: this.context.iteration,
        usage: usage,
        done: true,
        error: "Max iterations reached",
      };
    }

    const totalTokens = this.estimateTokenCount(this.context.messages);
    if (totalTokens > this.config.compactThreshold) {
      await this.compactContext();
    }

    return await this.executeWithRetry("Continue", { forceResult: true });
  }

  async runAgent(prompt: string, context?: { useThinking?: boolean }): Promise<AgentResult> {
    this.context.iteration = 0;
    this.context.startTime = Date.now();
    this.currentTaskStartTime = Date.now();
    this.loopDetection.clear();
    this.toolCallSignature = "";

    await this.analyzeTaskComplexity(prompt);

    const subAgentResults = await this.spawnSubAgentsIfNeeded(prompt);

    const result = await this.executeWithRetry(prompt, {
      useThinking: context?.useThinking ?? false,
    });

    this.context.messages.push({ role: "user", content: prompt });

    if (result.content) {
      this.context.messages.push({ role: "assistant", content: result.content });
    }

    if (this.callback.onDone) {
      this.callback.onDone(result);
    }

    await this.memory.saveMemory(
      "last_task",
      { prompt, result: result.content, iterations: result.iterations },
      MemoryType.Session
    );

    await this.recordInteraction(prompt, result);

    const metrics = learningEngine.getMetrics();
    result.learningMetrics = {
      patternsExtracted: metrics.patternsExtracted,
      lessonsLearned: metrics.lessonsLearned,
    };

    if (subAgentResults.length > 0) {
      result.subAgents = subAgentResults;
    }

    if (this.sqliteMemory) {
      try {
        await this.sqliteMemory.saveMemory(
          "task_" + Date.now(),
          { prompt, success: result.done, iterations: result.iterations },
          "episodic"
        );
      } catch (error) {
        // SQLite save failure is non-critical
      }
    }

    return result;
  }

  async runAgentStream(
    prompt: string,
    callback: StreamCallback
  ): Promise<AgentResult> {
    this.setCallback(callback);
    return this.runAgent(prompt);
  }

  getContext(): AgentContext {
    return { ...this.context };
  }

  getConfig(): AgentConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  addMessage(role: Message["role"], content: string): void {
    this.context.messages.push({ role, content });
  }

  getToolHistory(): ToolHistoryEntry[] {
    return [...this.context.toolHistory];
  }

  getLearningMetrics() {
    return learningEngine.getMetrics();
  }

  async reset(): Promise<void> {
    this.context.messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
    ];
    this.context.toolHistory = [];
    this.context.iteration = 0;
    this.loopDetection.clear();
    this.toolCallSignature = "";
  }

  async shutdown(): Promise<void> {
    if (this.sqliteMemory) {
      this.sqliteMemory.save();
    }
    if (this.subAgentManager) {
      await this.subAgentManager.shutdown();
    }
  }
}

export function createAgentLoop(
  config?: Partial<AgentConfig>,
  provider?: Provider,
  memory?: MemorySystem,
  tools?: ToolExecutor
): AgentLoop {
  return new AgentLoop(config, provider, memory, tools);
}
