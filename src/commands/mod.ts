/**
 * Slash Commands System
 * Provides interactive commands for the CLI
 */

import { AgentLoop, ThinkingLevel } from '../agent/mod.js';
import { SkillManager, createBuiltInSkills } from '../skills/mod.js';
import { getMemorySystem } from '../memory/mod.js';
import { createProvider, detectProvider } from '../providers/mod.js';

export interface CommandContext {
  agent: AgentLoop;
  skillManager: SkillManager;
  workingDirectory: string;
}

export interface Command {
  name: string;
  description: string;
  usage: string;
  execute: (args: string, context: CommandContext) => Promise<string>;
}

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private skillManager: SkillManager;

  constructor(skillManager: SkillManager) {
    this.skillManager = skillManager;
    this.registerBuiltInCommands();
  }

  register(command: Command): void {
    this.commands.set(command.name.toLowerCase(), command);
  }

  async execute(input: string, context: CommandContext): Promise<string | null> {
    const trimmed = input.trim();
    
    if (!trimmed.startsWith('/')) {
      return null; // Not a command
    }

    const parts = trimmed.slice(1).split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const command = this.commands.get(commandName);
    if (!command) {
      return `❌ Unknown command: ${commandName}\nType /help for available commands`;
    }

    try {
      return await command.execute(args, context);
    } catch (error) {
      return `❌ Command failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  listCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  private registerBuiltInCommands(): void {
    // Help command
    this.register({
      name: 'help',
      description: 'Show available commands',
      usage: '/help',
      execute: async (args, context) => {
        const commands = this.listCommands();
        const skills = this.skillManager.listSkills();

        let output = `
╔═══════════════════════════════════════════════════════════╗
║              🍡 viclaw COMMANDS                       ║
╚═══════════════════════════════════════════════════════════╝

📋 Available Commands:
`;

        for (const cmd of commands) {
          output += `\n  /${cmd.name.padEnd(15)} - ${cmd.description}`;
        }

        if (skills.length > 0) {
          output += `\n\n🎯 Loaded Skills (${skills.length}):`;
          for (const skill of skills) {
            output += `\n  • ${skill.name.padEnd(20)} - ${skill.description}`;
          }
        }

        output += `\n\n💡 Tip: Type a message to chat with the AI agent!`;

        return output;
      },
    });

    // Model switching
    this.register({
      name: 'model',
      description: 'Switch AI model',
      usage: '/model <model-name>',
      execute: async (args, context) => {
        if (!args) {
          const currentConfig = context.agent.getConfig();
          const currentProvider = context.agent.getContext();
          return `Current model: Use /provider to see active provider`;
        }

        const model = args.trim();
        context.agent.updateConfig({});
        
        // Update provider config
        process.env.ANTHROPIC_MODEL = model;
        process.env.OPENAI_MODEL = model;
        process.env.OPENROUTER_MODEL = model;

        return `✅ Model set to: ${model}`;
      },
    });

    // Provider switching
    this.register({
      name: 'provider',
      description: 'Switch AI provider',
      usage: '/provider <anthropic|openai|openrouter|ollama|gemini|bedrock>',
      execute: async (args, context) => {
        if (!args) {
          const providerName = detectProvider();
          return `Current provider: ${providerName}`;
        }

        const provider = args.trim().toLowerCase();
        const validProviders = ['anthropic', 'openai', 'openrouter', 'ollama', 'gemini', 'bedrock'];

        if (!validProviders.includes(provider)) {
          return `❌ Invalid provider. Choose from: ${validProviders.join(', ')}`;
        }

        process.env.viclaw_PROVIDER = provider;

        // Clear API keys for other providers
        if (provider === 'anthropic') {
          if (!process.env.ANTHROPIC_API_KEY) {
            return `⚠️  Please set ANTHROPIC_API_KEY environment variable`;
          }
        } else if (provider === 'openai') {
          if (!process.env.OPENAI_API_KEY) {
            return `⚠️  Please set OPENAI_API_KEY environment variable`;
          }
        } else if (provider === 'ollama') {
          process.env.OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
        } else if (provider === 'gemini') {
          if (!process.env.GEMINI_API_KEY) {
            return `⚠️  Please set GEMINI_API_KEY environment variable`;
          }
        }

        return `✅ Provider switched to: ${provider}`;
      },
    });

    // Status display
    this.register({
      name: 'status',
      description: 'Show current configuration',
      usage: '/status',
      execute: async (args, context) => {
        const providerName = detectProvider();
        const ctx = context.agent.getContext();
        const config = context.agent.getConfig();
        const memory = getMemorySystem();
        const stats = memory.getStats();

        return `
╔═══════════════════════════════════════════════════════════╗
║              📊 viclaw STATUS                         ║
╚═══════════════════════════════════════════════════════════╝

🤖 Provider: ${providerName.toUpperCase()}
🧠 Model: ${process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || 'default'}
📁 Working Directory: ${context.workingDirectory}
🔢 Session ID: ${ctx.sessionId}
🔄 Iteration: ${ctx.iteration}
📝 Messages: ${ctx.messages.length}
🛠️  Tool Calls: ${ctx.toolHistory.length}

💾 Memory Stats:
  • Patterns: ${stats.totalPatterns}
  • Skills: ${stats.totalSkills}
  • Sessions: ${stats.totalSessions}
  • Success Rate: ${(stats.averageSuccessRate * 100).toFixed(1)}%

⚙️  Configuration:
  • Max Iterations: ${config.maxIterations}
  • Max Tokens: ${config.maxTokens}
  • Temperature: ${config.temperature}
  • Thinking Level: ${config.thinkingLevel}
  • Streaming: ${config.stream ? '✅' : '❌'}
`;
      },
    });

    // Compact context
    this.register({
      name: 'compact',
      description: 'Compact conversation history to save tokens',
      usage: '/compact',
      execute: async (args, context) => {
        const ctx = context.agent.getContext();
        const messageCount = ctx.messages.length;

        if (messageCount <= 4) {
          return `ℹ️  Context is already compact (${messageCount} messages)`;
        }

        // Trigger compaction
        await (context.agent as any).compactContext();

        return `✅ Context compacted. Was ${messageCount} messages, now should be much smaller.`;
      },
    });

    // Clear session
    this.register({
      name: 'clear',
      description: 'Clear current session',
      usage: '/clear',
      execute: async (args, context) => {
        await context.agent.reset();
        return `✅ Session cleared. Starting fresh!`;
      },
    });

    // Skills listing
    this.register({
      name: 'skills',
      description: 'List available skills',
      usage: '/skills',
      execute: async (args, context) => {
        const skills = this.skillManager.listSkills();
        
        if (skills.length === 0) {
          return `ℹ️  No skills loaded. Add skills to the skills/ directory.`;
        }

        let output = `🎯 Loaded Skills (${skills.length}):\n\n`;
        for (const skill of skills) {
          output += `• ${skill.name}\n`;
          output += `  ${skill.description}\n`;
          if (skill.triggers && skill.triggers.length > 0) {
            output += `  Triggers: ${skill.triggers.join(', ')}\n`;
          }
          output += `\n`;
        }

        return output;
      },
    });

    // Git commit
    this.register({
      name: 'commit',
      description: 'Generate git commit message',
      usage: '/commit',
      execute: async (args, context) => {
        const { spawn } = await import('node:child_process');
        
        // Get git diff
        const diff = await new Promise<string>((resolve) => {
          const proc = spawn('git', ['diff', '--cached']);
          let output = '';
          proc.stdout.on('data', (data) => output += data.toString());
          proc.on('close', () => resolve(output));
        });

        if (!diff || diff.trim().length === 0) {
          // Try unstaged changes
          const unstaged = await new Promise<string>((resolve) => {
            const proc = spawn('git', ['diff']);
            let output = '';
            proc.stdout.on('data', (data) => output += data.toString());
            proc.on('close', () => resolve(output));
          });

          if (!unstaged || unstaged.trim().length === 0) {
            return `ℹ️  No changes to commit`;
          }
        }

        const skill = context.skillManager.getSkill('git-commit');
        if (skill) {
          const result = await context.skillManager.executeSkill('git-commit', { diff });
          return `📝 Git Commit Skill Ready:\n${result.output}`;
        }

        return `⚠️  Git commit skill not loaded`;
      },
    });

    // Code review
    this.register({
      name: 'review',
      description: 'Review code for quality and issues',
      usage: '/review [file]',
      execute: async (args, context) => {
        const skill = context.skillManager.getSkill('code-review');
        if (skill) {
          return `🔍 Code Review Skill Ready.\n\nProvide a file path or describe what to review.`;
        }

        return `⚠️  Code review skill not loaded`;
      },
    });

    // Thinking level
    this.register({
      name: 'think',
      description: 'Set thinking level',
      usage: '/think <low|medium|high|xhigh>',
      execute: async (args, context) => {
        if (!args) {
          const config = context.agent.getConfig();
          return `Current thinking level: ${config.thinkingLevel}`;
        }

        const level = args.trim().toLowerCase() as ThinkingLevel;
        const validLevels = ['low', 'medium', 'high', 'xhigh'];

        if (!validLevels.includes(level)) {
          return `❌ Invalid level. Choose from: ${validLevels.join(', ')}`;
        }

        context.agent.updateConfig({ thinkingLevel: level });
        return `✅ Thinking level set to: ${level.toUpperCase()}`;
      },
    });

    // Memory stats
    this.register({
      name: 'memory',
      description: 'Show memory and learning stats',
      usage: '/memory',
      execute: async (args, context) => {
        const memory = getMemorySystem();
        const stats = memory.getStats();
        const patterns = memory.getPatterns();

        let output = `💾 Memory System Stats:\n\n`;
        output += `📊 Total Patterns: ${stats.totalPatterns}\n`;
        output += `🎯 Total Skills: ${stats.totalSkills}\n`;
        output += `📁 Total Sessions: ${stats.totalSessions}\n`;
        output += `✅ Success Rate: ${(stats.averageSuccessRate * 100).toFixed(1)}%\n\n`;

        if (patterns.length > 0) {
          output += `🧠 Learned Patterns:\n`;
          for (const pattern of patterns.slice(-5)) {
            output += `  • ${pattern.name} (used ${pattern.useCount} times)\n`;
          }
        }

        return output;
      },
    });

    // Search skills
    this.register({
      name: 'search-skills',
      description: 'Search for skills by keyword',
      usage: '/search-skills <query>',
      execute: async (args, context) => {
        if (!args) {
          return `❌ Usage: /search-skills <query>`;
        }

        const results = await context.skillManager.searchSkills(args);
        
        if (results.length === 0) {
          return `❌ No skills found for: ${args}`;
        }

        let output = `🔍 Found ${results.length} skill(s):\n\n`;
        for (const skill of results) {
          output += `• ${skill.name}\n  ${skill.description}\n\n`;
        }

        return output;
      },
    });

    // Max iterations
    this.register({
      name: 'max-iter',
      description: 'Set maximum iterations',
      usage: '/max-iter <number>',
      execute: async (args, context) => {
        if (!args) {
          const config = context.agent.getConfig();
          return `Current max iterations: ${config.maxIterations}`;
        }

        const iterations = parseInt(args.trim());
        if (isNaN(iterations) || iterations < 1 || iterations > 100) {
          return `❌ Invalid number. Must be between 1 and 100.`;
        }

        context.agent.updateConfig({ maxIterations: iterations });
        return `✅ Max iterations set to: ${iterations}`;
      },
    });

    // Exit
    this.register({
      name: 'exit',
      description: 'Exit viclaw',
      usage: '/exit',
      execute: async (args, context) => {
        process.exit(0);
        return '';
      },
    });

    // Version
    this.register({
      name: 'version',
      description: 'Show version',
      usage: '/version',
      execute: async (args, context) => {
        return `viclaw v1.0.0\nAI coding agent that runs on your machine`;
      },
    });
  }
}
