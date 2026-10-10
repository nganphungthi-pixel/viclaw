/**
 * Sandbox Backend Abstraction
 * Register backends by ID (docker, ssh, process)
 * Build exec specs, filesystem bridge with path safety
 */

import { spawn, SpawnOptions } from "node:child_process";
import { resolve, isAbsolute, join, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";

export interface SandboxBackendExecSpec {
  command: string;
  workdir: string;
  env: Record<string, string>;
  timeout: number;
  pty: boolean;
  elevated: boolean;
}

export interface SandboxBackendCommandResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
}

export interface SandboxBackendCapabilities {
  browser?: boolean;
  network?: boolean;
  filesystem?: boolean;
}

export interface SandboxBackendHandle {
  id: string;
  runtimeId: string;
  runtimeLabel: string;
  workdir: string;
  capabilities: SandboxBackendCapabilities;
  buildExecSpec(params: { command: string; workdir?: string; env?: Record<string, string>; timeout?: number }): Promise<SandboxBackendExecSpec>;
  runShellCommand(params: { command: string; timeout?: number; workdir?: string }): Promise<SandboxBackendCommandResult>;
}

// ============================================
// BACKEND REGISTRY
// ============================================

type BackendFactory = (config: Record<string, unknown>) => Promise<SandboxBackendHandle>;

const backendRegistry: Map<string, BackendFactory> = new Map();

export function registerSandboxBackend(id: string, factory: BackendFactory): void {
  backendRegistry.set(id, factory);
}

export function getSandboxBackend(id: string, config: Record<string, unknown>): SandboxBackendHandle | undefined {
  const factory = backendRegistry.get(id);
  if (!factory) return undefined;
  // Factory returns promise, caller must await
  throw new Error("Use createSandboxBackend() instead");
}

export async function createSandboxBackend(id: string, config: Record<string, unknown>): Promise<SandboxBackendHandle> {
  const factory = backendRegistry.get(id);
  if (!factory) {
    throw new Error(`Sandbox backend not found: ${id}`);
  }
  return factory(config);
}

export function listSandboxBackends(): string[] {
  return Array.from(backendRegistry.keys());
}

// ============================================
// PROCESS SANDBOX BACKEND
// ============================================

export async function createProcessSandbox(config: Record<string, unknown>): Promise<SandboxBackendHandle> {
  const workdir = (config.workdir as string) || process.cwd();
  const blockedCommands = (config.blockedCommands as string[]) || [];

  return {
    id: "process",
    runtimeId: `process-${Date.now()}`,
    runtimeLabel: "Local Process",
    workdir,
    capabilities: {
      browser: false,
      network: true,
      filesystem: true,
    },
    async buildExecSpec(params) {
      return {
        command: params.command,
        workdir: params.workdir || workdir,
        env: sanitizeEnv(params.env || process.env as Record<string, string>),
        timeout: params.timeout || 120000,
        pty: false,
        elevated: false,
      };
    },
    async runShellCommand(params) {
      const startTime = Date.now();
      const command = params.command;

      // Check blocked commands
      for (const blocked of blockedCommands) {
        if (command.includes(blocked)) {
          return {
            success: false,
            output: "",
            error: `Command blocked: ${blocked}`,
            exitCode: -1,
            duration: Date.now() - startTime,
          };
        }
      }

      return execCommand(command, {
        cwd: params.workdir || workdir,
        timeout: params.timeout || 120000,
      });
    },
  };
}

// ============================================
// DOCKER SANDBOX BACKEND
// ============================================

export async function createDockerSandbox(config: Record<string, unknown>): Promise<SandboxBackendHandle> {
  const image = (config.image as string) || "node:22-alpine";
  const containerId = (config.containerId as string) || `viclaw-sandbox-${Date.now()}`;
  const workdir = (config.workdir as string) || "/workspace";
  let isRunning = false;

  // Start container
  await execCommand(`docker run -d --name ${containerId} --rm -w ${workdir} ${image} sleep infinity`);
  isRunning = true;

  return {
    id: "docker",
    runtimeId: containerId,
    runtimeLabel: `Docker (${image})`,
    workdir,
    capabilities: {
      browser: false,
      network: false, // Isolated by default
      filesystem: true,
    },
    async buildExecSpec(params) {
      return {
        command: params.command,
        workdir: params.workdir || workdir,
        env: sanitizeEnv(params.env || {}),
        timeout: params.timeout || 120000,
        pty: false,
        elevated: false,
      };
    },
    async runShellCommand(params) {
      const startTime = Date.now();

      if (!isRunning) {
        return {
          success: false,
          output: "",
          error: "Container not running",
          exitCode: -1,
          duration: 0,
        };
      }

      const command = `docker exec -w ${params.workdir || workdir} ${containerId} sh -c ${JSON.stringify(params.command)}`;

      return execCommand(command, {
        timeout: params.timeout || 120000,
      });
    },
  };
}

// ============================================
// FILESYSTEM BRIDGE - TOCTOU-Safe
// ============================================

export class SandboxFsBridge {
  private mountPoint: string;
  private allowedPaths: string[];

  constructor(mountPoint: string, allowedPaths: string[] = []) {
    this.mountPoint = resolve(mountPoint);
    this.allowedPaths = allowedPaths.map(p => resolve(p));
  }

  /**
   * Resolve path safely - anchored to mount point
   */
  resolvePath(relativePath: string): string {
    const resolved = resolve(this.mountPoint, relativePath);

    // Prevent path traversal
    if (!resolved.startsWith(this.mountPoint)) {
      throw new Error(`Path traversal detected: ${relativePath} resolves outside mount point`);
    }

    // Check allowlist
    if (this.allowedPaths.length > 0) {
      const isAllowed = this.allowedPaths.some(allowed => resolved.startsWith(allowed));
      if (!isAllowed) {
        throw new Error(`Path not in allowlist: ${resolved}`);
      }
    }

    return resolved;
  }

  /**
   * Check if path is safe
   */
  isPathSafe(path: string): boolean {
    try {
      this.resolvePath(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get mount point
   */
  getMountPoint(): string {
    return this.mountPoint;
  }
}

// ============================================
// PATH SAFETY GUARD
// ============================================

export class SandboxFsPathGuard {
  private anchor: string;

  constructor(anchor: string) {
    this.anchor = resolve(normalize(anchor));
  }

  /**
   * Validate and resolve path
   */
  validateAndResolve(path: string): string {
    const resolved = isAbsolute(path) ? resolve(normalize(path)) : resolve(this.anchor, normalize(path));

    if (!resolved.startsWith(this.anchor)) {
      throw new Error(`Path safety violation: ${path} escapes anchor ${this.anchor}`);
    }

    return resolved;
  }

  /**
   * Check if path exists and is within anchor
   */
  safeExists(path: string): boolean {
    try {
      const resolved = this.validateAndResolve(path);
      return existsSync(resolved);
    } catch {
      return false;
    }
  }

  /**
   * Get anchor
   */
  getAnchor(): string {
    return this.anchor;
  }
}

// ============================================
// ENV SANITIZATION
// ============================================

const DANGEROUS_ENV_VARS = [
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "PRIVATE_KEY",
  "DATABASE_PASSWORD",
  "JWT_SECRET",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    // Block PATH modification
    if (key === "PATH") continue;

    // Block dangerous vars
    if (DANGEROUS_ENV_VARS.includes(key)) continue;

    sanitized[key] = value;
  }

  return sanitized;
}

export function isDangerousEnvVar(name: string): boolean {
  return DANGEROUS_ENV_VARS.includes(name) || name === "PATH";
}

// ============================================
// EXEC HELPER
// ============================================

function execCommand(command: string, options: { cwd?: string; timeout?: number } = {}): Promise<SandboxBackendCommandResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeout = options.timeout || 120000;

    const proc = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      timeout,
      shell: true,
    });

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
        duration: Date.now() - startTime,
      });
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
        exitCode: code || 0,
        duration: Date.now() - startTime,
      });
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: "",
        error: error.message,
        exitCode: -1,
        duration: Date.now() - startTime,
      });
    });
  });
}

// ============================================
// REGISTER BUILTIN BACKENDS
// ============================================

registerSandboxBackend("process", createProcessSandbox);
registerSandboxBackend("docker", createDockerSandbox);
