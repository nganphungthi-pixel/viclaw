/**
 * Security Audit System
 * Comprehensive security scanner with severity levels: critical, warn, info
 */

import { statSync, existsSync } from "node:fs";
import { platform } from "node:os";

export type SecuritySeverity = "critical" | "warn" | "info";

export interface SecurityFinding {
  id: string;
  severity: SecuritySeverity;
  category: string;
  title: string;
  description: string;
  remediation: string;
  file?: string;
}

export interface SecurityAuditResult {
  findings: SecurityFinding[];
  summary: {
    critical: number;
    warn: number;
    info: number;
    total: number;
  };
  passed: boolean;
  timestamp: number;
}

export class SecurityAuditor {
  private findings: SecurityFinding[] = [];

  /**
   * Run full security audit
   */
  async audit(config: Record<string, unknown> = {}): Promise<SecurityAuditResult> {
    this.findings = [];

    // Run all checks
    this.checkFilesystemPermissions();
    this.checkDangerousConfigFlags(config);
    this.checkExecSecurity(config);
    this.checkChannelSecurity(config);
    this.checkEnvironmentVariables();
    this.checkSandboxConfig(config);

    // Calculate summary
    const summary = {
      critical: this.findings.filter(f => f.severity === "critical").length,
      warn: this.findings.filter(f => f.severity === "warn").length,
      info: this.findings.filter(f => f.severity === "info").length,
      total: this.findings.length,
    };

    return {
      findings: this.findings,
      summary,
      passed: summary.critical === 0,
      timestamp: Date.now(),
    };
  }

  // ============================================
  // FILESYSTEM PERMISSIONS
  // ============================================

  private checkFilesystemPermissions(): void {
    const isWin = platform() === "win32";

    if (isWin) {
      // Windows doesn't have Unix permissions, skip
      this.addFinding("info", "filesystem", "Windows permissions not checked",
        "Windows uses ACLs instead of Unix permissions. Consider using Windows security policies.",
        "Not applicable on Windows");
      return;
    }

    // Check state directory permissions (should be 700)
    const stateDir = process.env.VICLAW_STATE_DIR;
    if (stateDir && existsSync(stateDir)) {
      try {
        const stats = statSync(stateDir);
        const mode = stats.mode & 0o777;
        if (mode !== 0o700) {
          this.addFinding("warn", "filesystem",
            `State directory has mode ${mode.toString(8)}, expected 700`,
            `The state directory ${stateDir} should have restrictive permissions (700) to prevent unauthorized access.`,
            `Run: chmod 700 ${stateDir}`);
        }
      } catch {
        // Non-fatal
      }
    }

    // Check config file permissions (should be 600)
    const configPath = process.env.VICLAW_CONFIG;
    if (configPath && existsSync(configPath)) {
      try {
        const stats = statSync(configPath);
        const mode = stats.mode & 0o777;
        if (mode !== 0o600) {
          this.addFinding("warn", "filesystem",
            `Config file has mode ${mode.toString(8)}, expected 600`,
            `The config file ${configPath} should have restrictive permissions (600).`,
            `Run: chmod 600 ${configPath}`);
        }
      } catch {
        // Non-fatal
      }
    }
  }

  // ============================================
  // DANGEROUS CONFIG FLAGS
  // ============================================

  private checkDangerousConfigFlags(config: Record<string, unknown>): void {
    const dangerousFlags = [
      "insecure",
      "dangerous",
      "disableSecurity",
      "skipValidation",
      "allowAllTools",
      "noSandbox",
      "disableAuth",
    ];

    for (const flag of dangerousFlags) {
      if (config[flag] === true) {
        this.addFinding("critical", "config",
          `Dangerous config flag enabled: ${flag}`,
          `The config flag "${flag}" is set to true, which disables important security controls.`,
          `Remove or set "${flag}" to false in your config.`);
      }
    }
  }

  // ============================================
  // EXEC SECURITY
  // ============================================

  private checkExecSecurity(config: Record<string, unknown>): void {
    const sandboxType = config.sandboxType;

    if (sandboxType === "none") {
      this.addFinding("warn", "exec",
        "Sandbox is disabled - commands run directly on host",
        "Without a sandbox, executed commands have full access to the host system.",
        "Enable sandbox with sandboxType: 'docker' or 'process'");
    }

    // Check for allowed commands
    const allowedCommands = config.allowedCommands as string[] | undefined;
    if (!allowedCommands || allowedCommands.length === 0) {
      this.addFinding("info", "exec",
        "No command allowlist configured",
        "Without an allowlist, all commands are permitted (subject to blocklist).",
        "Configure allowedCommands to restrict command execution");
    }

    // Check for blocked commands
    const blockedCommands = config.blockedCommands as string[] | undefined;
    const essentialBlocks = ["rm -rf /", "mkfs", "dd if="];
    if (blockedCommands) {
      for (const essential of essentialBlocks) {
        if (!blockedCommands.includes(essential)) {
          this.addFinding("critical", "exec",
            `Essential command not blocked: ${essential}`,
            `The dangerous command "${essential}" is not in the blocked commands list.`,
            `Add "${essential}" to blockedCommands`);
        }
      }
    }
  }

  // ============================================
  // CHANNEL SECURITY
  // ============================================

  private checkChannelSecurity(config: Record<string, unknown>): void {
    const channels = config.channels as string[] | undefined;

    if (channels) {
      for (const channel of channels) {
        const tokenEnvVar = `${channel.toUpperCase()}_BOT_TOKEN`;
        if (!process.env[tokenEnvVar]) {
          this.addFinding("info", "channel",
            `Channel "${channel}" enabled but ${tokenEnvVar} not set`,
            `The channel ${channel} is configured but its API token is not set.`,
            `Set ${tokenEnvVar} in your environment`);
        }
      }
    }
  }

  // ============================================
  // ENVIRONMENT VARIABLES
  // ============================================

  private checkEnvironmentVariables(): void {
    const dangerousEnvVars = [
      "AWS_SECRET_ACCESS_KEY",
      "PRIVATE_KEY",
      "DATABASE_PASSWORD",
      "JWT_SECRET",
      "GITHUB_TOKEN",
    ];

    for (const envVar of dangerousEnvVars) {
      if (process.env[envVar]) {
        // Check if it's exposed in config (bad!)
        this.addFinding("info", "environment",
          `Sensitive environment variable ${envVar} is set`,
          `The environment variable ${envVar} contains sensitive credentials.`,
          "Ensure this is not logged or written to files");
      }
    }
  }

  // ============================================
  // SANDBOX CONFIG
  // ============================================

  private checkSandboxConfig(config: Record<string, unknown>): void {
    if (config.sandboxType === "docker") {
      // Docker security checks
      this.addFinding("info", "sandbox",
        "Docker sandbox enabled - verify container security",
        "Ensure the Docker container runs as non-root with minimal capabilities.",
        "Use a minimal base image, drop all capabilities, run as non-root user");
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  private addFinding(
    severity: SecuritySeverity,
    category: string,
    title: string,
    description: string,
    remediation: string,
    file?: string
  ): void {
    this.findings.push({
      id: `${category}-${this.findings.length + 1}`,
      severity,
      category,
      title,
      description,
      remediation,
      file,
    });
  }
}

// Global security auditor
let securityAuditorInstance: SecurityAuditor | null = null;

export function getSecurityAuditor(): SecurityAuditor {
  if (!securityAuditorInstance) {
    securityAuditorInstance = new SecurityAuditor();
  }
  return securityAuditorInstance;
}
