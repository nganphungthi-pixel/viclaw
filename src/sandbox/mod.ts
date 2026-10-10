import { spawn } from "node:child_process";
import { resolve, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export interface SandboxConfig {
  type: "docker" | "process" | "web";
  image?: string;
  memoryLimit?: number;
  cpuLimit?: number;
  networkIsolation?: boolean;
  timeout?: number;
  workingDirectory?: string;
}

export interface SandboxOptions {
  timeout?: number;
  env?: Record<string, string>;
  workingDirectory?: string;
  networkEnabled?: boolean;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
}

export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface SessionData {
  id: string;
  createdAt: number;
  expiresAt: number;
  data: Map<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface SessionSharingOptions {
  readOnly?: boolean;
  ttl?: number;
}

const DEFAULT_BLOCKED_PATHS = [
  "/etc/passwd",
  "/etc/shadow",
  "/etc/sudoers",
  "/root",
  "/home/*/.ssh",
  "/.ssh",
  "C:\\Windows",
  "C:\\Program Files",
  homedir(),
];

const DEFAULT_ALLOWED_PATHS = [process.cwd(), homedir()];

const COST_PER_1K_TOKENS = {
  input: 0.003,
  output: 0.015,
};

class ToolPermissionSystem {
  private permissions: Map<string, Set<string>> = new Map();
  private defaultPermissions: Set<string> = new Set();

  constructor() {
    this.defaultPermissions = new Set([
      "Read",
      "Write",
      "Edit",
      "Bash",
      "WebSearch",
      "WebFetch",
    ]);
  }

  grant(tool: string, identity: string): void {
    if (!this.permissions.has(identity)) {
      this.permissions.set(identity, new Set());
    }
    this.permissions.get(identity)!.add(tool);
  }

  revoke(tool: string, identity: string): void {
    this.permissions.get(identity)?.delete(tool);
  }

  check(tool: string, identity: string): PermissionCheck {
    const identityPerms = this.permissions.get(identity);
    
    if (identityPerms && identityPerms.has(tool)) {
      return { allowed: true };
    }
    
    if (this.defaultPermissions.has(tool)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Tool '${tool}' not permitted for identity '${identity}'`,
    };
  }

  getPermissions(identity: string): string[] {
    const perms = this.permissions.get(identity);
    if (!perms) {
      return Array.from(this.defaultPermissions);
    }
    return Array.from(perms);
  }

  setDefaultPermissions(tools: string[]): void {
    this.defaultPermissions = new Set(tools);
  }
}

class PathAllowList {
  private allowedPaths: Set<string> = new Set();

  constructor(paths: string[] = DEFAULT_ALLOWED_PATHS) {
    paths.forEach(p => this.add(p));
  }

  add(path: string): void {
    const normalized = isAbsolute(path) ? path : resolve(process.cwd(), path);
    this.allowedPaths.add(normalized);
  }

  remove(path: string): void {
    const normalized = isAbsolute(path) ? path : resolve(process.cwd(), path);
    this.allowedPaths.delete(normalized);
  }

  check(path: string): boolean {
    const normalized = isAbsolute(path) ? path : resolve(process.cwd(), path);
    
    for (const allowed of this.allowedPaths) {
      if (normalized.startsWith(allowed) || normalized === allowed) {
        return true;
      }
    }
    
    return this.allowedPaths.size === 0;
  }

  getAll(): string[] {
    return Array.from(this.allowedPaths);
  }
}

class PathBlockList {
  private blockedPaths: Set<string> = new Set();
  private patterns: RegExp[] = [];

  constructor(paths: string[] = DEFAULT_BLOCKED_PATHS) {
    paths.forEach(p => this.add(p));
  }

  add(path: string): void {
    if (path.includes("*")) {
      const regex = new RegExp("^" + path.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
      this.patterns.push(regex);
    } else {
      const normalized = isAbsolute(path) ? path : resolve(process.cwd(), path);
      this.blockedPaths.add(normalized);
    }
  }

  remove(path: string): void {
    const normalized = isAbsolute(path) ? path : resolve(process.cwd(), path);
    this.blockedPaths.delete(normalized);
  }

  check(path: string): boolean {
    const normalized = isAbsolute(path) ? path : resolve(process.cwd(), path);
    
    for (const blocked of this.blockedPaths) {
      if (normalized.startsWith(blocked) || normalized === blocked) {
        return false;
      }
    }

    for (const pattern of this.patterns) {
      if (pattern.test(normalized)) {
        return false;
      }
    }

    return true;
  }

  getAll(): string[] {
    return Array.from(this.blockedPaths);
  }
}

class RateLimiter {
  private limits: Map<string, { count: number; windowStart: number; limit: number; windowMs: number }> = new Map();

  setLimit(identifier: string, limit: number, windowMs: number = 60000): void {
    this.limits.set(identifier, {
      count: 0,
      windowStart: Date.now(),
      limit,
      windowMs,
    });
  }

  enforce(identifier: string): RateLimitResult {
    const now = Date.now();
    let limitData = this.limits.get(identifier);

    if (!limitData) {
      limitData = { count: 0, windowStart: now, limit: 100, windowMs: 60000 };
      this.limits.set(identifier, limitData);
    }

    if (now - limitData.windowStart > limitData.windowMs) {
      limitData.count = 0;
      limitData.windowStart = now;
    }

    if (limitData.count >= limitData.limit) {
      const retryAfter = limitData.windowMs - (now - limitData.windowStart);
      return {
        allowed: false,
        remaining: 0,
        resetAt: limitData.windowStart + limitData.windowMs,
        retryAfter,
      };
    }

    limitData.count++;
    const remaining = limitData.limit - limitData.count;

    return {
      allowed: true,
      remaining,
      resetAt: limitData.windowStart + limitData.windowMs,
    };
  }

  reset(identifier: string): void {
    this.limits.delete(identifier);
  }

  getStatus(identifier: string): RateLimitResult | null {
    const limitData = this.limits.get(identifier);
    if (!limitData) return null;

    return {
      allowed: limitData.count < limitData.limit,
      remaining: Math.max(0, limitData.limit - limitData.count),
      resetAt: limitData.windowStart + limitData.windowMs,
    };
  }
}

class CostTracker {
  private budgets: Map<string, { spent: number; limit: number; period: number; periodStart: number }> = new Map();
  private usage: Map<string, { inputTokens: number; outputTokens: number; cost: number }> = new Map();

  setBudget(identifier: string, limit: number, periodMs: number = 3600000): void {
    this.budgets.set(identifier, {
      spent: 0,
      limit,
      period: periodMs,
      periodStart: Date.now(),
    });
  }

  track(identifier: string, inputTokens: number, outputTokens: number): void {
    const cost = (inputTokens * COST_PER_1K_TOKENS.input + outputTokens * COST_PER_1K_TOKENS.output) / 1000;

    let usageData = this.usage.get(identifier);
    if (!usageData) {
      usageData = { inputTokens: 0, outputTokens: 0, cost: 0 };
      this.usage.set(identifier, usageData);
    }

    usageData.inputTokens += inputTokens;
    usageData.outputTokens += outputTokens;
    usageData.cost += cost;

    const budget = this.budgets.get(identifier);
    if (budget) {
      const now = Date.now();
      if (now - budget.periodStart > budget.period) {
        budget.spent = 0;
        budget.periodStart = now;
      }
      budget.spent += cost;
    }
  }

  getRemaining(identifier: string): number {
    const budget = this.budgets.get(identifier);
    if (!budget) return Infinity;

    const now = Date.now();
    let currentSpent = budget.spent;
    if (now - budget.periodStart > budget.period) {
      currentSpent = 0;
    }

    return Math.max(0, budget.limit - currentSpent);
  }

  checkBudget(identifier: string): boolean {
    const budget = this.budgets.get(identifier);
    if (!budget) return true;

    return this.getRemaining(identifier) > 0;
  }

  getUsage(identifier: string): { inputTokens: number; outputTokens: number; cost: number } | null {
    return this.usage.get(identifier) || null;
  }

  resetBudget(identifier: string): void {
    this.budgets.delete(identifier);
  }

  resetUsage(identifier: string): void {
    this.usage.delete(identifier);
  }
}

export class DockerSandbox {
  private image: string;
  private containerId?: string;

  constructor(config: SandboxConfig) {
    this.image = config.image || "viclaw-sandbox:latest";
  }

  async start(): Promise<void> {
    const { stdout } = await this.execCommand("docker", ["run", "-d", "--rm", this.image, "sleep", "infinity"]);
    this.containerId = stdout.trim();
  }

  async exec(command: string, options?: SandboxOptions): Promise<ExecutionResult> {
    if (!this.containerId) {
      return { success: false, output: "", error: "Container not started", exitCode: -1, duration: 0 };
    }

    const startTime = Date.now();
    const args = ["exec", this.containerId, "sh", "-c", command];
    return this.runCommand("docker", args, options, startTime);
  }

  async stop(): Promise<void> {
    if (this.containerId) {
      await this.execCommand("docker", ["stop", this.containerId]);
      this.containerId = undefined;
    }
  }

  private execCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args);
      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });

      proc.on("error", () => {
        resolve({ stdout, stderr, exitCode: -1 });
      });
    });
  }

  private runCommand(cmd: string, args: string[], options?: SandboxOptions, startTime?: number): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const timeout = options?.timeout || 30000;
      const env = { ...process.env, ...options?.env };
      const cwd = options?.workingDirectory;

      const proc = spawn(cmd, args, { env, cwd });
      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          success: false,
          output: stdout,
          error: `Command timed out after ${timeout}ms`,
          exitCode: -1,
          duration: Date.now() - (startTime || Date.now()),
        });
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = code || 0;
        resolve({
          success: exitCode === 0,
          output: stdout,
          error: stderr || undefined,
          exitCode,
          duration: Date.now() - (startTime || Date.now()),
        });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: "",
          error: error.message,
          exitCode: -1,
          duration: Date.now() - (startTime || Date.now()),
        });
      });
    });
  }

  getContainerId(): string | undefined {
    return this.containerId;
  }
}

export class ProcessSandbox {
  private workingDirectory: string;
  private env: Record<string, string>;
  private networkEnabled: boolean;

  constructor(config: SandboxConfig) {
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.env = { ...process.env } as Record<string, string>;
    this.networkEnabled = config.networkIsolation || false;
  }

  async exec(command: string, options?: SandboxOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const cwd = options?.workingDirectory || this.workingDirectory;
    const env = { ...this.env, ...options?.env };

    if (!this.networkEnabled) {
      delete env.HTTP_PROXY;
      delete env.HTTPS_PROXY;
      delete env.http_proxy;
      delete env.https_proxy;
    }

    return this.runCommand("sh", ["-c", command], { ...options, env, workingDirectory: cwd }, startTime);
  }

  private runCommand(cmd: string, args: string[], options?: SandboxOptions, startTime?: number): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const timeout = options?.timeout || 60000;
      const env = options?.env || this.env;
      const cwd = options?.workingDirectory || this.workingDirectory;

      const proc = spawn(cmd, args, { env, cwd });
      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          success: false,
          output: stdout,
          error: `Command timed out after ${timeout}ms`,
          exitCode: -1,
          duration: Date.now() - (startTime || Date.now()),
        });
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = code || 0;
        resolve({
          success: exitCode === 0,
          output: stdout,
          error: stderr || undefined,
          exitCode,
          duration: Date.now() - (startTime || Date.now()),
        });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: "",
          error: error.message,
          exitCode: -1,
          duration: Date.now() - (startTime || Date.now()),
        });
      });
    });
  }

  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  setEnv(key: string, value: string): void {
    this.env[key] = value;
  }
}

export class WebSandbox {
  private browserContext?: unknown;
  private page?: unknown;

  constructor(config: SandboxConfig) {
    // Web sandbox for browser isolation - requires external browser automation library
  }

  async navigate(url: string): Promise<ExecutionResult> {
    return { success: true, output: `Navigated to ${url}`, exitCode: 0, duration: 0 };
  }

  async execute(script: string): Promise<ExecutionResult> {
    return { success: true, output: `Executed: ${script}`, exitCode: 0, duration: 0 };
  }

  async close(): Promise<void> {
    this.browserContext = undefined;
    this.page = undefined;
  }
}

export class SandboxManager {
  private permissionSystem: ToolPermissionSystem;
  private allowList: PathAllowList;
  private blockList: PathBlockList;
  private rateLimiter: RateLimiter;
  private costTracker: CostTracker;
  private sessions: Map<string, SessionData> = new Map();
  private activeSandbox?: DockerSandbox | ProcessSandbox | WebSandbox;
  private sessionDataSharing: Map<string, Map<string, SessionData>> = new Map();

  constructor() {
    this.permissionSystem = new ToolPermissionSystem();
    this.allowList = new PathAllowList();
    this.blockList = new PathBlockList();
    this.rateLimiter = new RateLimiter();
    this.costTracker = new CostTracker();
  }

  createSandbox(config: SandboxConfig): DockerSandbox | ProcessSandbox | WebSandbox {
    switch (config.type) {
      case "docker":
        this.activeSandbox = new DockerSandbox(config);
        break;
      case "process":
        this.activeSandbox = new ProcessSandbox(config);
        break;
      case "web":
        this.activeSandbox = new WebSandbox(config);
        break;
      default:
        this.activeSandbox = new ProcessSandbox(config);
    }
    return this.activeSandbox;
  }

  async sandboxedExec(command: string, options?: SandboxOptions): Promise<ExecutionResult> {
    if (!this.activeSandbox) {
      this.activeSandbox = new ProcessSandbox({ type: "process", workingDirectory: options?.workingDirectory });
    }

    if (this.activeSandbox instanceof ProcessSandbox) {
      return this.activeSandbox.exec(command, options);
    } else if (this.activeSandbox instanceof DockerSandbox) {
      return this.activeSandbox.exec(command, options);
    }

    return { success: false, output: "", error: "Unsupported sandbox type", exitCode: -1, duration: 0 };
  }

  checkPermission(tool: string, identity: string = "default"): PermissionCheck {
    return this.permissionSystem.check(tool, identity);
  }

  estimateCost(prompt: string, tools: string[]): CostEstimate {
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = tools.length * 100;
    const estimatedCost = (inputTokens * COST_PER_1K_TOKENS.input + outputTokens * COST_PER_1K_TOKENS.output) / 1000;

    return { inputTokens, outputTokens, estimatedCost };
  }

  enforceRateLimit(identifier: string): RateLimitResult {
    return this.rateLimiter.enforce(identifier);
  }

  checkPath(path: string): boolean {
    if (!this.allowList.check(path)) {
      return false;
    }
    return this.blockList.check(path);
  }

  grantPermission(tool: string, identity: string): void {
    this.permissionSystem.grant(tool, identity);
  }

  revokePermission(tool: string, identity: string): void {
    this.permissionSystem.revoke(tool, identity);
  }

  addAllowedPath(path: string): void {
    this.allowList.add(path);
  }

  addBlockedPath(path: string): void {
    this.blockList.add(path);
  }

  setRateLimit(identifier: string, limit: number, windowMs?: number): void {
    this.rateLimiter.setLimit(identifier, limit, windowMs);
  }

  setBudget(identifier: string, limit: number, periodMs?: number): void {
    this.costTracker.setBudget(identifier, limit, periodMs);
  }

  trackCost(identifier: string, inputTokens: number, outputTokens: number): void {
    this.costTracker.track(identifier, inputTokens, outputTokens);
  }

  getRemainingBudget(identifier: string): number {
    return this.costTracker.getRemaining(identifier);
  }

  createSession(ttl?: number): string {
    const id = randomUUID();
    const now = Date.now();
    const session: SessionData = {
      id,
      createdAt: now,
      expiresAt: now + (ttl || 3600000),
      data: new Map(),
      metadata: {},
    };
    this.sessions.set(id, session);
    return id;
  }

  destroySession(sessionId: string): boolean {
    for (const [, sharedSessions] of this.sessionDataSharing) {
      sharedSessions.delete(sessionId);
    }
    return this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): SessionData | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  setSessionData(sessionId: string, key: string, value: unknown): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    session.data.set(key, value);
    return true;
  }

  getSessionData(sessionId: string, key: string): unknown {
    const session = this.getSession(sessionId);
    if (!session) return undefined;

    return session.data.get(key);
  }

  shareSessionData(sourceSessionId: string, targetSessionId: string, options?: SessionSharingOptions): boolean {
    const sourceSession = this.getSession(sourceSessionId);
    const targetSession = this.getSession(targetSessionId);

    if (!sourceSession || !targetSession) return false;

    if (!this.sessionDataSharing.has(targetSessionId)) {
      this.sessionDataSharing.set(targetSessionId, new Map());
    }

    const sharedData = new Map(options?.readOnly ? sourceSession.data : new Map(sourceSession.data));
    this.sessionDataSharing.get(targetSessionId)!.set(sourceSessionId, {
      ...sourceSession,
      data: sharedData,
    });

    return true;
  }

  getSharedData(targetSessionId: string): Map<string, unknown> {
    const shared = new Map<string, unknown>();
    const sharedSessions = this.sessionDataSharing.get(targetSessionId);

    if (sharedSessions) {
      for (const [, data] of sharedSessions) {
        for (const [key, value] of data.data) {
          shared.set(key, value);
        }
      }
    }

    return shared;
  }

  getPermissionSystem(): ToolPermissionSystem {
    return this.permissionSystem;
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getCostTracker(): CostTracker {
    return this.costTracker;
  }
}

let sandboxManagerInstance: SandboxManager | null = null;

export function createSandboxManager(): SandboxManager {
  sandboxManagerInstance = new SandboxManager();
  return sandboxManagerInstance;
}

export function getSandboxManager(): SandboxManager {
  if (!sandboxManagerInstance) {
    sandboxManagerInstance = new SandboxManager();
  }
  return sandboxManagerInstance;
}

export const sandboxedExec = async (command: string, options?: SandboxOptions): Promise<ExecutionResult> => {
  const manager = getSandboxManager();
  return manager.sandboxedExec(command, options);
};

export const checkPermission = (tool: string, identity?: string): PermissionCheck => {
  const manager = getSandboxManager();
  return manager.checkPermission(tool, identity);
};

export const estimateCost = (prompt: string, tools: string[]): CostEstimate => {
  const manager = getSandboxManager();
  return manager.estimateCost(prompt, tools);
};

export const enforceRateLimit = (identifier: string): RateLimitResult => {
  const manager = getSandboxManager();
  return manager.enforceRateLimit(identifier);
};

export const createIsolatedSession = (ttl?: number): string => {
  const manager = getSandboxManager();
  return manager.createSession(ttl);
};

export const destroyIsolatedSession = (sessionId: string): boolean => {
  const manager = getSandboxManager();
  return manager.destroySession(sessionId);
};

export const shareDataBetweenSessions = (sourceId: string, targetId: string, options?: SessionSharingOptions): boolean => {
  const manager = getSandboxManager();
  return manager.shareSessionData(sourceId, targetId, options);
};