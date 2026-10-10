#!/usr/bin/env node
/**
  * viclaw - AI coding agent that runs on your machine
 * Built from the ground up
 */

import { Command } from 'commander';
import { z } from 'zod';
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import * as readline from 'node:readline';

import 'dotenv/config';

// Core systems
import { AgentLoop, ThinkingLevel } from './agent/mod.js';
import { createProvider, detectProvider, getDefaultConfig } from './providers/mod.js';
import { createToolExecutor } from './tools/mod.js';
import { createMemorySystem } from './memory/mod.js';
import { createSandboxManager } from './sandbox/mod.js';

// New integrated systems
import { ConfigManager } from './config/mod.js';
import { SessionManager, generateSessionKey } from './session/mod.js';
import { SecurityAuditor } from './security/audit.js';
import { getRunStateMachine } from './agent/run-state.js';

// Expert systems
import { getResearchEngine } from './research/mod.js';
import { getReasoningEngine } from './reasoning/mod.js';
import { getExpertiseContext, matchExpertise } from './expertise/mod.js';
import { getSecurityScanner } from './security/mod.js';

// Plugin/connector systems
import { getPluginState, registerPlugin, discoverAndLoadPlugins } from './plugins/api.js';
import { ALL_CONNECTORS, searchConnectors, getConfiguredConnectors } from './connectors/registry.js';
import { ALL_PLUGINS, searchPlugins, getEnabledPlugins } from './plugins/registry.js';
import { ALL_SKILLS, matchSkills, searchSkills as searchSkillRegistry } from './skills/registry.js';

// Platform
import { detectPlatform, getPlatformPath } from './platform/mod.js';

// Skills
import { createBuiltInSkills, SkillManager } from './skills/mod.js';

// Commands
import { CommandRegistry } from './commands/mod.js';

// ============================================================
// CONFIGURATION
// ============================================================

const ConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama', 'gemini', 'bedrock']).default('anthropic'),
  maxIterations: z.number().default(50),
  thinkingLevel: z.nativeEnum(ThinkingLevel).default(ThinkingLevel.Medium),
  enableLearning: z.boolean().default(true),
  enableSandbox: z.boolean().default(false),
  sandboxType: z.enum(['docker', 'process', 'none']).default('process'),
});

type Config = z.infer<typeof ConfigSchema>;

// ============================================================
// VICLAW CLASS
// ============================================================

class Viclaw {
  private config: Config;
  private agent: AgentLoop;
  private skillManager: SkillManager;
  private commandRegistry: CommandRegistry;
  private memorySystem: ReturnType<typeof createMemorySystem>;
  private sessionManager: SessionManager;
  private configManager: ConfigManager;
  private isProcessing = false;
  private runState = getRunStateMachine();

  constructor(config: Config) {
    this.config = config;

    // Platform paths
    const platform = detectPlatform();
    const stateDir = getPlatformPath('data', 'viclaw');
    const configDir = getPlatformPath('config', 'viclaw');

    // Config manager with hot-reload
    this.configManager = new ConfigManager(
      join(configDir, 'config.json'),
      stateDir
    );

    // Session manager
    this.sessionManager = new SessionManager(join(stateDir, 'sessions.json'));

    // Memory system
    this.memorySystem = createMemorySystem({
      storageDir: join(stateDir, 'memory'),
    });

    // Skill manager
    this.skillManager = createBuiltInSkills();

    // Command registry
    this.commandRegistry = new CommandRegistry(this.skillManager);

    // Tool executor with sandbox
    const tools = createToolExecutor({
      sandbox: config.enableSandbox,
      timeout: 120000,
      allowedPaths: [process.cwd()],
      blockedPaths: [],
      allowedCommands: [],
      blockedCommands: ['rm -rf /', 'mkfs', 'dd if='],
    });

    // Agent loop with all systems wired
    this.agent = new AgentLoop(
      {
        maxIterations: config.maxIterations,
        thinkingLevel: config.thinkingLevel,
        stream: true,
        enableLearning: config.enableLearning,
        enableSandbox: config.enableSandbox,
        sandboxType: config.sandboxType,
      },
      createProvider(),
      this.memorySystem,
      tools
    );

    // Register new slash commands
    this.registerNewCommands();
  }

  // ============================================================
  // NEW COMMANDS
  // ============================================================

  private registerNewCommands(): void {
    // /research - Multi-engine research
    this.commandRegistry.register({
      name: 'research',
      description: 'Research across multiple search engines',
      usage: '/research <query> [--deep]',
      execute: async (args) => {
        const isDeep = args.includes('--deep');
        const query = args.replace('--deep', '').trim();
        if (!query) return 'Usage: /research <query> [--deep]';

        console.log(`\n🔍 Researching: "${query}"${isDeep ? ' (deep mode)' : ''}...\n`);
        const engine = getResearchEngine();

        if (isDeep) {
          const report = await engine.deepResearch(query);
          return this.formatResearchReport(report);
        } else {
          const report = await engine.quickResearch(query);
          return this.formatResearchReport(report);
        }
      },
    });

    // /reason - Deep reasoning
    this.commandRegistry.register({
      name: 'reason',
      description: 'Deep chain-of-thought reasoning',
      usage: '/reason <query> [--mode quick|standard|deep|expert]',
      execute: async (args) => {
        const modeMatch = args.match(/--mode\s+(\w+)/);
        const mode = modeMatch ? modeMatch[1] : 'standard';
        const query = args.replace(/--mode\s+\w+/, '').trim();
        if (!query) return 'Usage: /reason <query> [--mode quick|standard|deep|expert]';

        console.log(`\n🧠 Reasoning (${mode} mode): "${query}"...\n`);
        const engine = getReasoningEngine(undefined, mode as any);
        const result = await engine.reason(query);

        let output = `## Reasoning Result\n\n`;
        output += `**Query:** ${result.query}\n`;
        output += `**Confidence:** ${result.confidence}%\n`;
        output += `**Steps:** ${result.steps.length}\n\n`;
        output += `### Reasoning Chain\n\n`;
        for (const step of result.steps) {
          output += `**Step ${step.step}:** ${step.thought}\n`;
        }
        output += `\n### Conclusion\n\n${result.finalAnswer}\n`;
        if (result.alternativePerspectives.length > 0) {
          output += `\n### Alternatives\n\n`;
          result.alternativePerspectives.forEach(a => { output += `- ${a}\n`; });
        }
        if (result.assumptions.length > 0) {
          output += `\n### Assumptions\n\n`;
          result.assumptions.forEach(a => { output += `- ${a}\n`; });
        }
        return output;
      },
    });

    // /connectors - List/search connectors
    this.commandRegistry.register({
      name: 'connectors',
      description: 'Browse available service connectors',
      usage: '/connectors [search]',
      execute: async (args) => {
        const query = args.trim();
        let connectors;
        if (query) {
          connectors = searchConnectors(query);
        } else {
          connectors = getConfiguredConnectors();
          if (connectors.length === 0) {
            connectors = ALL_CONNECTORS.slice(0, 20);
          }
        }

        let output = `## Connectors${query ? `: "${query}"` : ''}\n\n`;
        output += `**Total:** ${connectors.length} configured, ${ALL_CONNECTORS.length} available\n\n`;
        output += `| Name | Category | Status |\n|------|----------|--------|\n`;
        for (const c of connectors.slice(0, 30)) {
          const configured = c.envVars.every(v => process.env[v]);
          output += `| ${c.name} | ${c.category} | ${configured ? '✅' : '⚙️'} |\n`;
        }
        if (connectors.length > 30) {
          output += `\n... and ${connectors.length - 30} more\n`;
        }
        output += `\n**Configure:** Set env vars (e.g. GITHUB_TOKEN, SUPABASE_URL)\n`;
        return output;
      },
    });

    // /plugins - List/search plugins
    this.commandRegistry.register({
      name: 'plugins',
      description: 'Browse available plugins',
      usage: '/plugins [search]',
      execute: async (args) => {
        const query = args.trim();
        let plugins;
        if (query) {
          plugins = searchPlugins(query);
        } else {
          plugins = getEnabledPlugins();
        }

        let output = `## Plugins${query ? `: "${query}"` : ''}\n\n`;
        output += `**Total:** ${plugins.length} enabled\n\n`;
        output += `| Plugin | Category | Installs |\n|--------|----------|----------|\n`;
        for (const p of plugins) {
          const installs = p.installs >= 1000 ? `${(p.installs / 1000).toFixed(1)}K` : p.installs;
          output += `| ${p.name} | ${p.category} | ${installs} |\n`;
        }
        return output;
      },
    });

    // /security - Run security scan
    this.commandRegistry.register({
      name: 'security',
      description: 'Run security audit on current project',
      usage: '/security [--scan]',
      execute: async (args) => {
        const doScan = args.includes('--scan');
        let output = `## Security Audit\n\n`;

        // Config audit
        const auditor = new SecurityAuditor();
        const audit = await auditor.audit({
          sandboxType: this.config.sandboxType,
          enableSandbox: this.config.enableSandbox,
        });

        output += `**Findings:** ${audit.summary.critical} critical, ${audit.summary.warn} warnings, ${audit.summary.info} info\n`;
        output += `**Status:** ${audit.passed ? '✅ Passed' : '❌ Issues found'}\n\n`;

        for (const f of audit.findings) {
          const icon = f.severity === 'critical' ? '🚨' : f.severity === 'warn' ? '⚠️' : 'ℹ️';
          output += `${icon} **[${f.severity.toUpperCase()}]** ${f.title}\n`;
          output += `   ${f.description}\n`;
          output += `   Fix: ${f.remediation}\n\n`;
        }

        // Code scan
        if (doScan) {
          output += `\n## Code Security Scan\n\n`;
          console.log('🔎 Scanning source code...');
          const scanner = getSecurityScanner();
          const report = await scanner.scanDirectory('src');
          output += `**Files scanned:** ${report.filesScanned}\n`;
          output += `**Vulnerabilities:** ${report.totalVulns}\n\n`;
          for (const v of report.vulns.slice(0, 20)) {
            const icon = v.severity === 'critical' ? '🚨' : v.severity === 'high' ? '🔴' : v.severity === 'medium' ? '🟡' : '🔵';
            output += `${icon} **${v.category}** - ${v.title}\n`;
            output += `   ${v.file}:${v.line} - ${v.code.slice(0, 80)}\n`;
            output += `   Fix: ${v.recommendation}\n\n`;
          }
        }

        return output;
      },
    });

    // /session - Session management
    this.commandRegistry.register({
      name: 'session',
      description: 'Manage sessions',
      usage: '/session [list|new|reset|stats]',
      execute: async (args) => {
        const action = args.trim() || 'stats';

        switch (action) {
          case 'list': {
            const sessions = this.sessionManager.listActiveSessions();
            if (sessions.length === 0) return 'No active sessions';
            let output = `## Active Sessions (${sessions.length})\n\n`;
            for (const s of sessions.slice(0, 10)) {
              output += `- **${s.sessionKey}** (${s.channel}) - ${s.messageCount} msgs, ${s.toolCallCount} tools\n`;
            }
            return output;
          }
          case 'new': {
            const key = `cli:main:${Date.now()}`;
            const session = this.sessionManager.createSession(key, 'cli', 'main', 'user');
            return `✅ New session created: ${session.sessionId}`;
          }
          case 'reset': {
            return '🔄 Session reset. Start a new conversation.';
          }
          default: {
            const stats = this.sessionManager.getSessionStats('cli:main:0');
            const runState = this.runState.getState();
            return `## Session Stats\n\n` +
              `**Status:** ${runState.status}\n` +
              `**Active runs:** ${runState.activeRuns}\n` +
              `**Messages:** ${stats?.messageCount || 0}\n` +
              `**Tool calls:** ${stats?.toolCallCount || 0}\n` +
              `**Tokens:** ${stats?.totalInputTokens || 0} in / ${stats?.totalOutputTokens || 0} out\n` +
              `**Cost:** $${((stats?.totalCostCents || 0) / 100).toFixed(4)}\n`;
          }
        }
      },
    });

    // /expertise - Show active expertise patterns
    this.commandRegistry.register({
      name: 'expertise',
      description: 'Show active expertise patterns',
      usage: '/expertise [query]',
      execute: async (args) => {
        const query = args.trim() || 'nextjs react typescript';
        const matched = matchExpertise(query);
        if (matched.length === 0) return `No expertise patterns matched "${query}"`;

        let output = `## Active Expertise Patterns\n\n`;
        for (const e of matched) {
          output += `### ${e.name} (${e.category})\n`;
          output += `${e.guidelines.slice(0, 300)}...\n\n`;
          output += `**Best Practices:** ${e.bestPractices.length}\n`;
          output += `**Common Pitfalls:** e.commonPitfalls.length\n\n`;
        }
        return output;
      },
    });

    // /skills - Enhanced skills list
    this.commandRegistry.register({
      name: 'skills',
      description: 'List or search skills',
      usage: '/skills [search]',
      execute: async (args) => {
        const query = args.trim();
        let skills;
        if (query) {
          skills = searchSkillRegistry(query);
        } else {
          skills = ALL_SKILLS.filter(s => s.enabled);
        }

        if (skills.length === 0) return `No skills found for "${query}"`;

        let output = `## Skills${query ? `: "${query}"` : ''}\n\n`;
        output += `**Total:** ${skills.length} enabled\n\n`;
        output += `| Skill | Category | Triggers |\n|-------|----------|----------|\n`;
        for (const s of skills) {
          output += `| ${s.name} | ${s.category} | ${s.triggers.slice(0, 3).join(', ')} |\n`;
        }
        return output;
      },
    });

    // /memory - Enhanced memory status
    this.commandRegistry.register({
      name: 'memory',
      description: 'Show memory status',
      usage: '/memory [stats|patterns|clear]',
      execute: async (args) => {
        const action = args.trim() || 'stats';
        const memStats = this.memorySystem.getStats();

        switch (action) {
          case 'patterns': {
            const patterns = this.memorySystem.getPatterns();
            if (patterns.length === 0) return 'No patterns learned yet';
            let output = `## Learned Patterns (${patterns.length})\n\n`;
            for (const p of patterns.slice(-10)) {
              output += `- **${p.name}**: ${p.description} (used ${p.useCount}x)\n`;
            }
            return output;
          }
          case 'clear': {
            await this.memorySystem.startNewSession();
            return '🧹 Memory cleared. New session started.';
          }
          default: {
            return `## Memory Status\n\n` +
              `**Patterns:** ${memStats.totalPatterns}\n` +
              `**Skills:** ${memStats.totalSkills}\n` +
              `**Sessions:** ${memStats.totalSessions}\n` +
              `**Avg Success:** ${(memStats.averageSuccessRate * 100).toFixed(1)}%\n`;
          }
        }
      },
    });

    // /bughunt - Security bug hunt
    this.commandRegistry.register({
      name: 'bughunt',
      description: 'Scan for security vulnerabilities',
      usage: '/bughunt [path]',
      execute: async (args) => {
        const target = args.trim() || 'src';
        console.log(`🔎 Scanning ${target}...`);
        const scanner = getSecurityScanner();
        const report = await scanner.scanDirectory(target);

        let output = `## Security Scan Report\n\n`;
        output += `**Files:** ${report.filesScanned} | **Duration:** ${(report.duration / 1000).toFixed(1)}s\n`;
        output += `**Total:** ${report.totalVulns} issues\n\n`;

        output += `| Severity | Count |\n|----------|-------|\n`;
        for (const [sev, count] of Object.entries(report.bySeverity)) {
          const icon = sev === 'critical' ? '🚨' : sev === 'high' ? '🔴' : sev === 'medium' ? '🟡' : '🔵';
          output += `| ${icon} ${sev} | ${count} |\n`;
        }

        output += `\n### Top Issues\n\n`;
        for (const v of report.vulns.slice(0, 15)) {
          const icon = v.severity === 'critical' ? '🚨' : v.severity === 'high' ? '🔴' : v.severity === 'medium' ? '🟡' : '🔵';
          output += `${icon} **${v.severity}** ${v.title}\n`;
          output += `   ${v.file}:${v.line}\n`;
          output += `   ${v.code.slice(0, 100)}\n`;
          output += `   → ${v.recommendation}\n\n`;
        }

        return output;
      },
    });

    // /config - Show/edit config
    this.commandRegistry.register({
      name: 'config',
      description: 'Show current configuration',
      usage: '/config',
      execute: async () => {
        const platform = detectPlatform();
        const providerName = detectProvider();
        const runState = this.runState.getState();

        let output = `## Viclaw Configuration\n\n`;
        output += `### System\n\n`;
        output += `- **Platform:** ${platform.platform} (${platform.arch})\n`;
        output += `- **Shell:** ${platform.shell}\n`;
        output += `- **Package Manager:** ${platform.packageManager}\n`;
        output += `- **WSL:** ${platform.isWSL ? 'Yes' : 'No'}\n\n`;
        output += `### Agent\n\n`;
        output += `- **Provider:** ${providerName}\n`;
        output += `- **Model:** ${this.config.model}\n`;
        output += `- **Thinking:** ${this.config.thinkingLevel}\n`;
        output += `- **Max Iterations:** ${this.config.maxIterations}\n`;
        output += `- **Learning:** ${this.config.enableLearning ? '✅' : '❌'}\n`;
        output += `- **Sandbox:** ${this.config.enableSandbox ? this.config.sandboxType : 'disabled'}\n\n`;
        output += `### Runtime\n\n`;
        output += `- **Status:** ${runState.status}\n`;
        output += `- **Active Runs:** ${runState.activeRuns}\n\n`;

        output += `### API Keys\n\n`;
        const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN', 'SUPABASE_URL', 'VERCEL_TOKEN'];
        for (const k of keys) {
          output += `- ${k}: ${process.env[k] ? '✅' : '❌'}\n`;
        }

        return output;
      },
    });
  }

  // ============================================================
  // START
  // ============================================================

  async start(): Promise<void> {
    // Banner
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║    🧭  V I C L A W                                            ║
║        AI coding agent on your machine                        ║
║        Local-first. Multi-provider. Yours.                    ║
║                                                               ║
║    "Free stack ready. Capped mandates. Audited runs."        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);

    const platform = detectPlatform();
    const providerName = detectProvider();

    console.log(`📡 Platform: ${platform.platform} (${platform.arch})`);
    console.log(`🔌 Provider: ${providerName.toUpperCase()}`);
    console.log(`🤖 Model: ${this.config.model}`);
    console.log(`🧠 Thinking: ${this.config.thinkingLevel}`);
    console.log(`📁 Working: ${process.cwd()}`);

    // Initialize systems
    await this.skillManager.initialize();
    console.log(`🎯 Skills: ${this.skillManager.getSkillCount()} built-in, ${ALL_SKILLS.length} registered`);
    console.log(`🔌 Connectors: ${getConfiguredConnectors().length} configured, ${ALL_CONNECTORS.length} available`);
    console.log(`🧩 Plugins: ${getEnabledPlugins().length} enabled`);

    const expertise = matchExpertise('');
    if (expertise.length > 0) {
      console.log(`🎓 Expertise: ${expertise.length} patterns loaded`);
    }

    console.log('');
    console.log('💡 Type /help for commands, /research for web search, /reason for deep analysis');
    console.log('');

    // Start config file watcher
    this.configManager.startWatching();

    // Start REPL
    this.repl();
  }

  // ============================================================
  // REPL
  // ============================================================

  private repl(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🔥 > ',
    });

    rl.prompt();

    rl.on('line', async (input: string) => {
      if (this.isProcessing) {
        console.log('⏳ Processing... Please wait.');
        rl.prompt();
        return;
      }

      const trimmed = input.trim();

      if (trimmed === '/exit' || trimmed === '.exit' || trimmed === 'exit') {
        console.log('👋 Goodbye!');
        this.configManager.stopWatching();
        this.runState.destroy();
        rl.close();
        process.exit(0);
      }

      if (!trimmed) {
        rl.prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
        this.isProcessing = true;
        this.runState.onRunStart();
        try {
          const context = {
            agent: this.agent,
            skillManager: this.skillManager,
            workingDirectory: process.cwd(),
          };

          const result = await this.commandRegistry.execute(trimmed, context);
          if (result) {
            console.log(result);
          }
        } finally {
          this.runState.onRunEnd();
          this.isProcessing = false;
        }
        rl.prompt();
        return;
      }

      // Regular chat with expertise detection
      this.isProcessing = true;
      this.runState.onRunStart();
      try {
        await this.handleUserMessage(trimmed, rl);
      } finally {
        this.runState.onRunEnd();
        this.isProcessing = false;
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n👋 Goodbye!');
      this.configManager.stopWatching();
      this.runState.destroy();
      process.exit(0);
    });
  }

  // ============================================================
  // MESSAGE HANDLER
  // ============================================================

  private async handleUserMessage(message: string, rl: any): Promise<void> {
    // Detect expertise patterns
    const expertise = matchExpertise(message);
    const expertiseContext = expertise.length > 0
      ? '\n\n## Active Expertise\n' + expertise.map(e => e.name.toUpperCase() + ' MODE').join(', ')
      : '';

    console.log('🤔 Thinking...\n');
    const startTime = Date.now();

    try {
      const result = await this.agent.runAgentStream(message + expertiseContext, {
        onContent: (content) => {
          process.stdout.write(content);
        },
        onToolCall: (toolCall) => {
          console.log(`\n\n🛠️  Using tool: ${toolCall.name}`);
        },
        onToolResult: (result) => {
          console.log(`✅ Tool completed\n`);
        },
        onThinking: () => {},
        onDone: (result) => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          let stats = `\n\n⏱️  ${duration}s | Iterations: ${result.iterations}`;
          if (result.learningMetrics) {
            stats += ` | Patterns: ${result.learningMetrics.patternsExtracted}`;
          }
          console.log(stats);
        },
        onError: (error) => {
          console.log(`\n\n❌ Error: ${error.message}`);
        },
      });

      console.log('');
    } catch (error) {
      console.log(`\n❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private formatResearchReport(report: any): string {
    let output = `## Research Report: ${report.query}\n\n`;
    output += `**Sources:** ${report.sources.length} | **Engines:** ${report.engines.join(', ')} | **Duration:** ${(report.duration / 1000).toFixed(1)}s\n\n`;

    output += `### Summary\n\n${report.summary.slice(0, 500)}...\n\n`;

    if (report.findings.length > 0) {
      output += `### Key Findings\n\n`;
      report.findings.slice(0, 5).forEach((f: string) => { output += `${f.slice(0, 300)}...\n\n---\n\n`; });
    }

    output += `### Sources\n\n`;
    report.sources.slice(0, 10).forEach((r: any, i: number) => {
      output += `${i + 1}. [${r.title}](${r.url}) - [${r.engine}]\n`;
    });

    return output;
  }
}

// ============================================================
// CLI PROGRAM
// ============================================================

const program = new Command();

program
  .name('viclaw')
  .description('AI coding agent that runs on your machine')
  .version('1.0.0');

// Chat command (default)
program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-m, --model <model>', 'AI model to use')
  .option('-p, --provider <provider>', 'AI provider')
  .option('-t, --thinking <level>', 'Thinking level (low/medium/high/xhigh)')
  .option('-i, --iterations <number>', 'Max iterations', '50')
  .option('--learning', 'Enable continuous learning', true)
  .option('--sandbox <type>', 'Sandbox type (docker/process/none)', 'process')
  .option('--tui', 'Use interactive TUI (React/Ink)', false)
  .option('--voice', 'Use voice mode (speak and listen)', false)
  .action(async (opts) => {
    const config = ConfigSchema.parse({
      model: opts.model || process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || 'claude-sonnet-4-20250514',
      provider: (opts.provider || process.env.VICLAW_PROVIDER || detectProvider()) as any,
      maxIterations: parseInt(opts.iterations) || 50,
      thinkingLevel: (opts.thinking || process.env.THINKING_LEVEL || 'medium').toLowerCase(),
      enableLearning: opts.learning !== false,
      enableSandbox: opts.sandbox !== 'none',
      sandboxType: opts.sandbox,
    });

    if (opts.tui) {
      // TUI mode with streaming
      const { renderTUI } = await import('./tui/app.js');
      const agent = new Viclaw(config);
      renderTUI({
        provider: config.provider,
        model: config.model,
        thinkingLevel: config.thinkingLevel,
        onMessage: async (message, callback) => {
          // Handle commands in TUI
          if (message.startsWith('/')) {
            const context = {
              agent: agent['agent'],
              skillManager: agent['skillManager'],
              workingDirectory: process.cwd(),
            };
            const result = await agent['commandRegistry'].execute(message, context);
            callback.onContent(result || 'Command executed');
            callback.onDone();
            return;
          }
          // Regular message with streaming
          await agent['agent'].runAgentStream(message, {
            onContent: callback.onContent,
            onToolCall: (tc) => callback.onToolCall(tc.name),
            onToolResult: () => {},
            onThinking: () => {},
            onDone: () => callback.onDone(),
            onError: callback.onError,
          });
        },
      });
    } else if (opts.voice) {
      // Voice mode
      const { createVoiceCLI } = await import('./voice/cli.js');
      const voiceCLI = createVoiceCLI({
        ttsProvider: (process.env.TTS_PROVIDER as any) || 'edge-tts',
        ttsVoice: process.env.TTS_VOICE || 'en-US-AriaNeural',
      });
      await voiceCLI.startVoiceChat();
    } else {
      // Standard REPL mode
      const agent = new Viclaw(config);
      await agent.start();
    }
  });

// Single query
program
  .command('ask <query>')
  .description('Ask a single question')
  .option('-m, --model <model>', 'AI model to use')
  .option('-r, --reason', 'Use deep reasoning')
  .action(async (query, opts) => {
    const config = ConfigSchema.parse({
      model: opts.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      provider: detectProvider(),
      maxIterations: 10,
      thinkingLevel: ThinkingLevel.Medium,
      enableLearning: true,
      enableSandbox: false,
      sandboxType: 'process',
    });

    const agent = new Viclaw(config);

    if (opts.reason) {
      console.log(`🧠 Reasoning about: ${query}\n`);
      const engine = getReasoningEngine(undefined, 'deep');
      const result = await engine.reason(query);
      console.log(result.finalAnswer);
    } else {
      console.log(`🤔 Processing: ${query}\n`);
      await agent.start();
    }
  });

// Research command
program
  .command('research <query>')
  .description('Research across multiple search engines')
  .option('--deep', 'Deep research with follow-up')
  .action(async (query, opts) => {
    const engine = getResearchEngine();
    console.log(`🔍 Researching: "${query}"${opts.deep ? ' (deep)' : ''}\n`);

    const report = opts.deep
      ? await engine.deepResearch(query)
      : await engine.quickResearch(query);

    // Print report
    console.log(`## Research: ${report.query}\n`);
    console.log(`Sources: ${report.sources.length} | Engines: ${report.engines.join(', ')}\n`);
    console.log(report.summary);
  });

// Security scan
program
  .command('scan [path]')
  .description('Security scan a directory')
  .action(async (path) => {
    const target = path || 'src';
    console.log(`🔎 Scanning ${target}...\n`);

    const scanner = getSecurityScanner();
    const report = await scanner.scanDirectory(target);

    console.log(`Files: ${report.filesScanned} | Duration: ${(report.duration / 1000).toFixed(1)}s`);
    console.log(`Issues: ${report.totalVulns}\n`);

    for (const [sev, count] of Object.entries(report.bySeverity)) {
      const icon = sev === 'critical' ? '🚨' : sev === 'high' ? '🔴' : sev === 'medium' ? '🟡' : '🔵';
      console.log(`${icon} ${sev}: ${count}`);
    }

    if (report.vulns.length > 0) {
      console.log('\nTop issues:');
      for (const v of report.vulns.slice(0, 10)) {
        console.log(`  ${v.severity} ${v.title} - ${v.file}:${v.line}`);
      }
    }
  });

// Serve (WebSocket gateway + Web UI)
program
  .command('serve')
  .description('Start WebSocket gateway server with Web UI')
  .option('--port <port>', 'Port number', '8080')
  .option('--host <host>', 'Host address', 'localhost')
  .option('--no-ui', 'Disable Web UI (API only)', false)
  .action(async (opts) => {
    console.log('🌐 Starting Viclaw gateway server...\n');

    const { GatewayServer } = await import('./gateway/server.js');
    const { autoStartMCPServers } = await import('./mcp/autostart.js');

    // Auto-start MCP servers
    console.log('🔌 Auto-detecting MCP servers...');
    const mcpStatus = await autoStartMCPServers();
    if (mcpStatus.started.length > 0) {
      console.log(`✅ Started ${mcpStatus.started.length} MCP servers: ${mcpStatus.started.join(', ')}`);
    }
    if (mcpStatus.skipped.length > 0) {
      console.log(`⚙️  Skipped ${mcpStatus.skipped.length} (no credentials)`);
    }
    console.log('');

    const gateway = new GatewayServer({
      port: parseInt(opts.port),
      host: opts.host,
      serveWebUI: !opts.noUi,
    });

    await gateway.start();

    if (!opts.noUi) {
      console.log(`🌐 Web UI: http://${opts.host}:${opts.port}`);
    }
    console.log(`🔌 WebSocket: ws://${opts.host}:${opts.port}`);
    console.log('');

    process.on('SIGINT', async () => {
      console.log('\n👋 Shutting down...');
      await gateway.stop();
      process.exit(0);
    });
  });

// Version / Auto-update
program
  .command('version')
  .description('Show version and check for updates')
  .option('--check', 'Check for updates')
  .action(async (opts) => {
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    console.log(`🔥 Viclaw v${pkg.version}`);

    if (opts.check) {
      console.log('\n🔄 Checking for updates...');
      try {
        const response = await fetch('https://registry.npmjs.org/viclaw/latest');
        if (response.ok) {
          const data = await response.json() as { version: string };
          const latest = data.version;
          const current = pkg.version;

          if (latest !== current) {
            console.log(`📦 Update available: ${current} → ${latest}`);
            console.log(`   Run: npm install -g viclaw@${latest}`);
          } else {
            console.log('✅ Already on latest version');
          }
        }
      } catch {
        console.log('⚠️  Could not check for updates (offline?)');
      }
    }
  });

// MCP status
program
  .command('mcp')
  .description('Show MCP server status')
  .action(async () => {
    const { getMCPStatusSummary } = await import('./mcp/autostart.js');
    console.log(getMCPStatusSummary());
  });

// Plugin hot-reload command
program
  .command('watch')
  .description('Watch for plugin/config changes and hot-reload')
  .action(async () => {
    const { ConfigManager } = await import('./config/mod.js');
    const { getPlatformPath } = await import('./platform/mod.js');

    const configDir = getPlatformPath('config', 'viclaw');
    const configManager = new ConfigManager(
      join(configDir, 'config.json'),
      getPlatformPath('data', 'viclaw')
    );

    console.log('👀 Watching for config changes...\n');
    console.log(`Config: ${configManager['configPath']}`);
    console.log('Changes will be hot-reloaded automatically.\n');

    configManager.startWatching();
    configManager.on('change', (config) => {
      console.log(`\n🔄 Config reloaded at ${new Date().toISOString()}`);
      console.log(`   Provider: ${config.provider}`);
      console.log(`   Model: ${config.model}`);
    });

    process.on('SIGINT', () => {
      configManager.stopWatching();
      console.log('\n👋 Stopping watcher...');
      process.exit(0);
    });
  });

// Login
program
  .command('login')
  .description('Configure authentication')
  .action(() => {
    console.log(`
🔐 Authentication Setup

Supported Providers:
1. Anthropic (Claude)  → ANTHROPIC_API_KEY=sk-ant-xxx
2. OpenAI (GPT)        → OPENAI_API_KEY=sk-xxx
3. OpenRouter (200+)   → OPENROUTER_API_KEY=sk-ora-xxx
4. Ollama (LOCAL!)     → ollama pull llama3 (no key needed)
5. Google Gemini       → GEMINI_API_KEY=xxx
6. AWS Bedrock         → AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY

💡 Start with Ollama for free local AI!
    `);
  });

// Status
program
  .command('status')
  .description('Show current configuration')
  .action(() => {
    const providerName = detectProvider();
    const platform = detectPlatform();

    console.log(`
📊 Configuration Status

Platform: ${platform.platform} (${platform.arch})
Package Manager: ${platform.packageManager}
Provider: ${providerName.toUpperCase()}
Model: ${process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || 'default'}
Working: ${process.cwd()}

API Keys:
  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}
  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}
  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '✅' : '❌'}
  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅' : '❌'}
  OLLAMA_HOST: ${process.env.OLLAMA_HOST || '❌'}
  GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? '✅' : '❌'}
  SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}
  VERCEL_TOKEN: ${process.env.VERCEL_TOKEN ? '✅' : '❌'}
    `);
  });

program.parse();
