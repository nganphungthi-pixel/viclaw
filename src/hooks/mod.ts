/**
 * Hook System - Pre/Post Processing
 * Inspired by everything-claude-code's hook architecture
 * Fires on agent lifecycle events for observation, governance, and learning
 */

import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ============================================
// HOOK TYPES
// ============================================

export type HookPhase =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "PostAgentResponse"
  | "SessionEnd";

export interface HookContext {
  sessionId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  prompt?: string;
  response?: string;
  error?: Error;
  timestamp: number;
  workingDirectory: string;
  metadata?: Record<string, unknown>;
}

export interface HookHandler {
  id: string;
  phase: HookPhase;
  matcher?: string; // Tool name pattern to match
  handler: (ctx: HookContext) => Promise<void>;
}

export interface HookRegistry {
  hooks: HookHandler[];
  profile: "minimal" | "standard" | "strict";
}

// ============================================
// HOOK SYSTEM
// ============================================

export class HookSystem extends EventEmitter {
  private registry: HookHandler[] = [];
  private profile: "minimal" | "standard" | "strict" = "standard";
  private metricsDir: string;
  private observationsLog: string;

  constructor(profile?: "minimal" | "standard" | "strict") {
    super();
    this.profile = profile || "standard";
    this.metricsDir = join(homedir(), ".viclaw", "metrics");
    this.observationsLog = join(this.metricsDir, "observations.jsonl");

    this.ensureMetricsDir();
  }

  private ensureMetricsDir(): void {
    if (!existsSync(this.metricsDir)) {
      mkdirSync(this.metricsDir, { recursive: true });
    }
  }

  registerHook(hook: HookHandler): void {
    this.registry.push(hook);
  }

  setProfile(profile: "minimal" | "standard" | "strict"): void {
    this.profile = profile;
  }

  async fire(phase: HookPhase, ctx: HookContext): Promise<void> {
    const hooks = this.registry.filter(h => h.phase === phase);

    for (const hook of hooks) {
      // Check profile gating
      if (this.profile === "minimal" && !hook.id.startsWith("critical:")) {
        continue;
      }

      // Check tool matcher
      if (hook.matcher && ctx.toolName && !ctx.toolName.includes(hook.matcher)) {
        continue;
      }

      try {
        await hook.handler(ctx);
      } catch (error) {
        console.error(`Hook error [${hook.id}]:`, error);
      }
    }

    this.emit(phase, ctx);
  }

  // ============================================
  // BUILT-IN HOOKS
  // ============================================

  registerBuiltInHooks(): void {
    // Session Start - Bootstrap
    this.registerHook({
      id: "critical:session-bootstrap",
      phase: "SessionStart",
      handler: async (ctx) => {
        const bootstrap = {
          sessionId: ctx.sessionId,
          timestamp: ctx.timestamp,
          workingDirectory: ctx.workingDirectory,
          nodeVersion: process.version,
          platform: process.platform,
        };

        appendFileSync(
          join(this.metricsDir, "sessions.jsonl"),
          JSON.stringify(bootstrap) + "\n"
        );
      },
    });

    // Pre-Tool Use - Security check
    this.registerHook({
      id: "critical:pre-tool-security",
      phase: "PreToolUse",
      matcher: "Bash",
      handler: async (ctx) => {
        const command = ctx.toolInput?.command as string;
        if (!command) return;

        // Check for dangerous commands
        const dangerous = [
          "rm -rf /",
          "dd if=",
          "mkfs",
          "chmod 777",
          "curl | sh",
          "wget | bash",
          "eval(",
          "exec(",
        ];

        for (const pattern of dangerous) {
          if (command.includes(pattern)) {
            console.warn(`⚠️ Dangerous command detected: ${pattern}`);
            appendFileSync(
              join(this.metricsDir, "security.jsonl"),
              JSON.stringify({
                timestamp: Date.now(),
                type: "dangerous_command",
                command: command.slice(0, 200),
                pattern,
              }) + "\n"
            );
          }
        }
      },
    });

    // Post-Tool Use - Observation capture
    this.registerHook({
      id: "observe:post-tool",
      phase: "PostToolUse",
      handler: async (ctx) => {
        if (!ctx.toolName) return;

        const observation = {
          timestamp: ctx.timestamp,
          sessionId: ctx.sessionId,
          tool: ctx.toolName,
          success: !ctx.error,
          duration: ctx.metadata?.duration || 0,
          cwd: ctx.workingDirectory,
        };

        appendFileSync(this.observationsLog, JSON.stringify(observation) + "\n");
      },
    });

    // Post-Tool Use Failure - Error analysis
    this.registerHook({
      id: "critical:post-tool-failure",
      phase: "PostToolUseFailure",
      handler: async (ctx) => {
        const failure = {
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          tool: ctx.toolName,
          error: ctx.error?.message || "Unknown error",
          input: ctx.toolInput,
        };

        appendFileSync(
          join(this.metricsDir, "failures.jsonl"),
          JSON.stringify(failure) + "\n"
        );
      },
    });

    // Post-Agent Response - Cost tracking
    this.registerHook({
      id: "track:cost",
      phase: "PostAgentResponse",
      handler: async (ctx) => {
        if (!ctx.response) return;

        const inputTokens = Math.ceil((ctx.prompt?.length || 0) / 4);
        const outputTokens = Math.ceil((ctx.response?.length || 0) / 4);
        const estimatedCost = (inputTokens * 0.003 + outputTokens * 0.015) / 1000;

        const costEntry = {
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          inputTokens,
          outputTokens,
          estimatedCost,
          provider: ctx.metadata?.provider || "unknown",
          model: ctx.metadata?.model || "unknown",
        };

        appendFileSync(
          join(this.metricsDir, "costs.jsonl"),
          JSON.stringify(costEntry) + "\n"
        );
      },
    });

    // Session End - Summary
    this.registerHook({
      id: "session-end-summary",
      phase: "SessionEnd",
      handler: async (ctx) => {
        const summary = {
          sessionId: ctx.sessionId,
          endTime: Date.now(),
          observationsFile: this.observationsLog,
        };

        appendFileSync(
          join(this.metricsDir, "sessions.jsonl"),
          JSON.stringify(summary) + "\n"
        );
      },
    });
  }

  // ============================================
  // GOVERNANCE CAPTURE
  // ============================================

  registerGovernanceCapture(): void {
    this.registerHook({
      id: "critical:governance",
      phase: "PreToolUse",
      matcher: "Bash",
      handler: async (ctx) => {
        const command = ctx.toolInput?.command as string;
        if (!command) return;

        // Secret detection
        const secretPatterns = [
          { pattern: /sk-[a-zA-Z0-9]{20,}/, type: "api_key" },
          { pattern: /ghp_[a-zA-Z0-9]{36}/, type: "github_token" },
          { pattern: /AKIA[0-9A-Z]{16}/, type: "aws_key" },
          { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, type: "private_key" },
          { pattern: /password\s*=\s*["'][^"']+["']/i, type: "hardcoded_password" },
        ];

        for (const { pattern, type } of secretPatterns) {
          if (pattern.test(command)) {
            console.warn(`🚨 Secret detected: ${type}`);
            appendFileSync(
              join(this.metricsDir, "governance.jsonl"),
              JSON.stringify({
                timestamp: Date.now(),
                type: "secret_detected",
                secretType: type,
                sessionId: ctx.sessionId,
              }) + "\n"
            );
          }
        }

        // Approval-required commands
        const approvalCommands = ["git push --force", "DROP TABLE", "rm -rf", "FORMAT"];
        for (const ac of approvalCommands) {
          if (command.includes(ac)) {
            appendFileSync(
              join(this.metricsDir, "governance.jsonl"),
              JSON.stringify({
                timestamp: Date.now(),
                type: "approval_required",
                command: ac,
                sessionId: ctx.sessionId,
              }) + "\n"
            );
          }
        }
      },
    });
  }

  // ============================================
  // CONTINUOUS LEARNING OBSERVER
  // ============================================

  registerLearningObserver(): void {
    const observationsPath = join(this.metricsDir, "learning-observations.jsonl");

    this.registerHook({
      id: "learn:observe",
      phase: "PostToolUse",
      handler: async (ctx) => {
        if (!ctx.toolName || this.profile === "minimal") return;

        const observation = {
          timestamp: ctx.timestamp,
          sessionId: ctx.sessionId,
          tool: ctx.toolName,
          input: JSON.stringify(ctx.toolInput || {}).slice(0, 500),
          output: ctx.toolOutput?.slice(0, 500) || "",
          success: !ctx.error,
          cwd: ctx.workingDirectory,
        };

        appendFileSync(observationsPath, JSON.stringify(observation) + "\n");

        // Signal observer every N observations
        const { count } = this.getLineCount(observationsPath);
        if (count > 0 && count % 20 === 0) {
          this.emit("learning-signal", { count, observationsPath });
        }
      },
    });
  }

  private getLineCount(filePath: string): { count: number; size: number } {
    if (!existsSync(filePath)) return { count: 0, size: 0 };

    const { size } = require("node:fs").statSync(filePath);
    let count = 0;
    const content = readFileSync(filePath, "utf-8");
    count = content.split("\n").filter(Boolean).length;

    return { count, size };
  }

  // ============================================
  // METRICS
  // ============================================

  getMetrics(): {
    totalObservations: number;
    totalFailures: number;
    totalCost: number;
    securityAlerts: number;
  } {
    const observations = existsSync(this.observationsLog)
      ? readFileSync(this.observationsLog, "utf-8").split("\n").filter(Boolean).length
      : 0;

    const failuresPath = join(this.metricsDir, "failures.jsonl");
    const failures = existsSync(failuresPath)
      ? readFileSync(failuresPath, "utf-8").split("\n").filter(Boolean).length
      : 0;

    const costsPath = join(this.metricsDir, "costs.jsonl");
    let totalCost = 0;
    if (existsSync(costsPath)) {
      const lines = readFileSync(costsPath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          totalCost += entry.estimatedCost || 0;
        } catch {
          // Skip invalid
        }
      }
    }

    const securityPath = join(this.metricsDir, "security.jsonl");
    const securityAlerts = existsSync(securityPath)
      ? readFileSync(securityPath, "utf-8").split("\n").filter(Boolean).length
      : 0;

    return {
      totalObservations: observations,
      totalFailures: failures,
      totalCost,
      securityAlerts,
    };
  }
}

// Global hook system instance
let hookSystemInstance: HookSystem | null = null;

export function getHookSystem(profile?: "minimal" | "standard" | "strict"): HookSystem {
  if (!hookSystemInstance) {
    hookSystemInstance = new HookSystem(profile);
    hookSystemInstance.registerBuiltInHooks();
    hookSystemInstance.registerGovernanceCapture();
    hookSystemInstance.registerLearningObserver();
  }
  return hookSystemInstance;
}
