/**
 * Skills System - Load and execute specialized skills from files
 * Skills are reusable workflows that extend agent capabilities
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  instructions: string;
  triggers?: string[];
  tools?: string[];
  category?: string;
  enabled?: boolean;
}

export interface Skill {
  manifest: SkillManifest;
  execute: (input: Record<string, unknown>) => Promise<SkillResult>;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  error?: string;
  nextSteps?: string[];
}

export interface SkillConfig {
  skillsDir?: string;
  autoLoad?: boolean;
}

const DEFAULT_SKILL_CONFIG: Required<SkillConfig> = {
  skillsDir: join(process.cwd(), 'skills'),
  autoLoad: true,
};

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private config: Required<SkillConfig>;

  constructor(config: SkillConfig = {}) {
    this.config = { ...DEFAULT_SKILL_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.config.autoLoad) {
      await this.loadAllSkills();
    }
  }

  async loadAllSkills(): Promise<void> {
    if (!existsSync(this.config.skillsDir)) {
      console.log(`⚠️  Skills directory not found: ${this.config.skillsDir}`);
      return;
    }

    const files = readdirSync(this.config.skillsDir);
    
    for (const file of files) {
      const fullPath = join(this.config.skillsDir, file);
      
      if (statSync(fullPath).isDirectory()) {
        await this.loadSkillFromDir(fullPath);
      } else if (extname(file) === '.md' || extname(file) === '.txt') {
        await this.loadSkillFromFile(fullPath);
      }
    }

    console.log(`✅ Loaded ${this.skills.size} skills`);
  }

  private async loadSkillFromDir(dirPath: string): Promise<void> {
    try {
      // Look for manifest file
      const manifestPath = join(dirPath, 'SKILL.md');
      if (!existsSync(manifestPath)) {
        return;
      }

      const content = readFileSync(manifestPath, 'utf-8');
      const manifest = this.parseSkillManifest(content);
      
      if (manifest) {
        this.registerSkill({
          manifest,
          execute: async (input) => ({
            success: true,
            output: `Skill '${manifest.name}' loaded. Instructions: ${manifest.instructions}`,
            nextSteps: manifest.triggers || [],
          }),
        });
      }
    } catch (error) {
      console.error(`Failed to load skill from ${dirPath}:`, error);
    }
  }

  private async loadSkillFromFile(filePath: string): Promise<void> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const manifest = this.parseSkillManifest(content);
      
      if (manifest) {
        this.registerSkill({
          manifest,
          execute: async (input) => ({
            success: true,
            output: `Skill '${manifest.name}' loaded. Instructions: ${manifest.instructions}`,
          }),
        });
      }
    } catch (error) {
      console.error(`Failed to load skill from ${filePath}:`, error);
    }
  }

  private parseSkillManifest(content: string): SkillManifest | null {
    // Parse markdown frontmatter or simple format
    const lines = content.split('\n');
    const manifest: Partial<SkillManifest> = {
      name: 'Unknown',
      description: '',
      version: '1.0.0',
      instructions: '',
      enabled: true,
    };

    let inFrontmatter = false;
    let instructionsStart = false;
    const instructionsLines: string[] = [];

    for (const line of lines) {
      if (line.trim() === '---') {
        inFrontmatter = !inFrontmatter;
        if (!inFrontmatter) {
          instructionsStart = true;
        }
        continue;
      }

      if (inFrontmatter) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          switch (key) {
            case 'name':
              manifest.name = value.replace(/["']/g, '').trim();
              break;
            case 'description':
              manifest.description = value.replace(/["']/g, '').trim();
              break;
            case 'version':
              manifest.version = value.replace(/["']/g, '').trim();
              break;
            case 'author':
              manifest.author = value.replace(/["']/g, '').trim();
              break;
            case 'category':
              manifest.category = value.replace(/["']/g, '').trim();
              break;
            case 'triggers':
              manifest.triggers = value.replace(/[\[\]"]/g, '').split(',').map(t => t.trim());
              break;
          }
        }
      } else if (instructionsStart) {
        instructionsLines.push(line);
      }
    }

    manifest.instructions = instructionsLines.join('\n').trim();

    if (manifest.name === 'Unknown' && !manifest.instructions) {
      return null;
    }

    return manifest as SkillManifest;
  }

  registerSkill(skill: Skill): void {
    if (skill.manifest.enabled === false) {
      return;
    }
    this.skills.set(skill.manifest.name, skill);
    console.log(`📦 Registered skill: ${skill.manifest.name}`);
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillManifest[] {
    return Array.from(this.skills.values()).map(s => s.manifest);
  }

  async executeSkill(name: string, input: Record<string, unknown> = {}): Promise<SkillResult> {
    const skill = this.skills.get(name);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${name}`,
      };
    }

    skill.manifest.enabled = true;
    
    try {
      const result = await skill.execute(input);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async searchSkills(query: string): Promise<SkillManifest[]> {
    const queryLower = query.toLowerCase();
    return Array.from(this.skills.values())
      .map(s => s.manifest)
      .filter(m => 
        m.name.toLowerCase().includes(queryLower) ||
        m.description.toLowerCase().includes(queryLower) ||
        m.instructions.toLowerCase().includes(queryLower) ||
        m.triggers?.some(t => t.toLowerCase().includes(queryLower))
      );
  }

  getSkillCount(): number {
    return this.skills.size;
  }
}

// ============================================
// BUILT-IN SKILLS
// ============================================

export function createBuiltInSkills(): SkillManager {
  const manager = new SkillManager();

  // Code Review Skill
  manager.registerSkill({
    manifest: {
      name: 'code-review',
      description: 'Perform thorough code review with best practices',
      version: '1.0.0',
      instructions: `Review the code for:
1. Code quality and readability
2. Potential bugs and edge cases
3. Performance issues
4. Security vulnerabilities
5. Best practices and patterns
6. Test coverage
7. Documentation

Provide constructive feedback with specific examples and suggestions.`,
      triggers: ['review', 'code review', 'audit'],
      category: 'development',
    },
    execute: async (input) => {
      const filePath = input.filePath as string;
      if (!filePath) {
        return {
          success: false,
          error: 'No file path provided. Usage: { filePath: "path/to/file.ts" }',
        };
      }

      try {
        const { readFileSync, existsSync } = await import('node:fs');
        if (!existsSync(filePath)) {
          return { success: false, error: `File not found: ${filePath}` };
        }

        const code = readFileSync(filePath, 'utf-8');
        const issues: string[] = [];

        // Check for common issues
        if (code.includes('console.log')) {
          issues.push('⚠️ Found console.log statements - consider using proper logging');
        }
        if (code.includes('any')) {
          issues.push('⚠️ Found "any" type - consider using more specific types');
        }
        if (code.includes('eval(')) {
          issues.push('🚨 Found eval() - potential security vulnerability');
        }
        if (code.includes('innerHTML')) {
          issues.push('⚠️ Found innerHTML - potential XSS vulnerability');
        }
        if (!code.includes('try') && code.includes('fetch')) {
          issues.push('⚠️ Fetch calls without try/catch error handling');
        }

        const lines = code.split('\n');
        if (lines.length > 300) {
          issues.push('⚠️ File is over 300 lines - consider splitting');
        }

        const functions = (code.match(/function|=>|async/g) || []).length;
        if (functions > 10) {
          issues.push('⚠️ Many functions in single file - consider modularization');
        }

        return {
          success: true,
          output: `Code Review for ${filePath}:\n\n` +
                  `Lines: ${lines.length}\n` +
                  `Functions: ${functions}\n` +
                  `Issues Found: ${issues.length}\n\n` +
                  issues.join('\n'),
          nextSteps: issues.length > 0 ? ['Fix identified issues', 'Re-review code'] : ['Code looks good!'],
        };
      } catch (error) {
        return {
          success: false,
          error: `Review failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  // Git Commit Skill
  manager.registerSkill({
    manifest: {
      name: 'git-commit',
      description: 'Create intelligent git commit messages',
      version: '1.0.0',
      instructions: `Analyze the git diff and create a descriptive commit message following conventional commits:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Adding tests
- chore: Maintenance

Format: <type>(<scope>): <description>

[optional body]`,
      triggers: ['commit', 'git commit'],
      category: 'git',
    },
    execute: async (input) => {
      const { execSync } = await import('node:child_process');

      try {
        const diff = execSync('git diff --cached', { encoding: 'utf-8' });
        const status = execSync('git status --short', { encoding: 'utf-8' });

        if (!diff && !status) {
          return { success: false, error: 'No changes to commit' };
        }

        const lines = diff.split('\n');
        const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
        const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

        const files = status.split('\n').filter(Boolean).length;
        const commitType = added > removed ? 'feat' : removed > added ? 'fix' : 'chore';

        const commitMessage = input.message || `${commitType}: update ${files} file(s)`;

        const command = input.dryRun ? 'git commit --dry-run' : `git commit -m "${commitMessage}"`;

        if (input.dryRun) {
          return {
            success: true,
            output: `Dry Run - Would commit:\n` +
                    `Type: ${commitType}\n` +
                    `Message: ${commitMessage}\n` +
                    `Files: ${files}\n` +
                    `Added: ${added} lines\n` +
                    `Removed: ${removed} lines`,
            nextSteps: ['Remove dryRun flag to commit'],
          };
        }

        execSync(command, { encoding: 'utf-8' });

        return {
          success: true,
          output: `Committed: ${commitMessage}\n` +
                  `Files: ${files}\n` +
                  `Added: ${added} lines\n` +
                  `Removed: ${removed} lines`,
          nextSteps: ['Push to remote', 'Create pull request'],
        };
      } catch (error) {
        return {
          success: false,
          error: `Git commit failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  // Bug Hunting Skill
  manager.registerSkill({
    manifest: {
      name: 'bug-hunt',
      description: 'Systematically find and fix bugs',
      version: '1.0.0',
      instructions: `Systematically search for bugs:
1. Read through code carefully
2. Look for common patterns:
   - Null/undefined references
   - Off-by-one errors
   - Race conditions
   - Memory leaks
   - Security vulnerabilities
3. Test edge cases
4. Verify error handling
5. Check input validation

Report findings with severity levels and suggested fixes.`,
      triggers: ['bug', 'debug', 'fix'],
      category: 'debugging',
    },
    execute: async (input) => {
      const filePath = input.filePath as string;
      const { readFileSync, existsSync, readdirSync, statSync } = await import('node:fs');
      const { join } = await import('node:path');

      const scanFile = (file: string): string[] => {
        const bugs: string[] = [];
        try {
          const code = readFileSync(file, 'utf-8');
          const lines = code.split('\n');

          lines.forEach((line, idx) => {
            const lineNum = idx + 1;

            // Security vulnerabilities
            if (line.includes('eval(')) {
              bugs.push(`🚨 [CRITICAL] Line ${lineNum}: eval() usage - code injection risk`);
            }
            if (line.includes('exec(') && !line.includes('import')) {
              bugs.push(`🚨 [CRITICAL] Line ${lineNum}: exec() usage - command injection risk`);
            }
            if (line.includes('innerHTML')) {
              bugs.push(`⚠️ [HIGH] Line ${lineNum}: innerHTML - XSS vulnerability`);
            }
            if (line.includes('document.write')) {
              bugs.push(`⚠️ [HIGH] Line ${lineNum}: document.write() - XSS vulnerability`);
            }
            if (line.match(/password|secret|api[_-]?key/i) && line.includes('=')) {
              if (!line.includes('process.env') && !line.includes('#')) {
                bugs.push(`🚨 [CRITICAL] Line ${lineNum}: Possible hardcoded secret/API key`);
              }
            }

            // Common bugs
            if (line.includes('==') && !line.includes('===')) {
              bugs.push(`⚠️ [MEDIUM] Line ${lineNum}: Loose equality (==) - use ===`);
            }
            if (line.includes('!=') && !line.includes('!==')) {
              bugs.push(`⚠️ [MEDIUM] Line ${lineNum}: Loose inequality (!=) - use !==`);
            }
            if (line.includes('setTimeout') && !line.includes('clearTimeout')) {
              bugs.push(`ℹ️ [LOW] Line ${lineNum}: setTimeout without clearTimeout - potential memory leak`);
            }
            if (line.includes('subscribe') && !line.includes('unsubscribe')) {
              bugs.push(`ℹ️ [LOW] Line ${lineNum}: Subscription without unsubscribe - potential memory leak`);
            }
            if (line.includes('catch') && lines[idx + 1]?.includes('//')) {
              bugs.push(`⚠️ [MEDIUM] Line ${lineNum}: Empty catch block - error swallowing`);
            }
          });

          // Check for missing error handling
          if (code.includes('fetch(') && !code.includes('try')) {
            bugs.push(`⚠️ [MEDIUM] Network request without error handling`);
          }
          if (code.includes('async') && !code.includes('try') && !code.includes('.catch')) {
            bugs.push(`⚠️ [MEDIUM] Async function without error handling`);
          }
        } catch (error) {
          // Skip unreadable files
        }
        return bugs;
      };

      try {
        const allBugs: string[] = [];
        const filesScanned: string[] = [];

        if (filePath) {
          if (existsSync(filePath)) {
            const stat = statSync(filePath);
            if (stat.isFile()) {
              allBugs.push(...scanFile(filePath));
              filesScanned.push(filePath);
            } else if (stat.isDirectory()) {
              const files = readdirSync(filePath).filter(f => f.match(/\.(ts|js|tsx|jsx|py|go)$/));
              for (const file of files.slice(0, 20)) {
                const fullPath = join(filePath, file);
                allBugs.push(...scanFile(fullPath));
                filesScanned.push(fullPath);
              }
            }
          }
        }

        const critical = allBugs.filter(b => b.includes('CRITICAL')).length;
        const high = allBugs.filter(b => b.includes('HIGH')).length;
        const medium = allBugs.filter(b => b.includes('MEDIUM')).length;
        const low = allBugs.filter(b => b.includes('LOW')).length;

        return {
          success: true,
          output: `Bug Hunt Report\n` +
                  `===============\n` +
                  `Files Scanned: ${filesScanned.length}\n` +
                  `Total Issues: ${allBugs.length}\n\n` +
                  `🚨 Critical: ${critical}\n` +
                  `🔴 High: ${high}\n` +
                  `🟡 Medium: ${medium}\n` +
                  `🔵 Low: ${low}\n\n` +
                  (allBugs.length > 0 ? allBugs.join('\n') : 'No bugs found!'),
          nextSteps: critical > 0 ? ['Fix critical issues immediately'] : ['Review medium/high issues'],
        };
      } catch (error) {
        return {
          success: false,
          error: `Bug hunt failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  // Architecture Design Skill
  manager.registerSkill({
    manifest: {
      name: 'architecture',
      description: 'Design and review system architecture',
      version: '1.0.0',
      instructions: `When designing architecture:
1. Identify core components and responsibilities
2. Define clear interfaces between components
3. Consider scalability, reliability, and maintainability
4. Choose appropriate design patterns
5. Document trade-offs and decisions
6. Plan for future extensibility

Create clear diagrams and documentation.`,
      triggers: ['architecture', 'design', 'system design'],
      category: 'planning',
    },
    execute: async (input) => ({
      success: true,
      output: 'Architecture design skill ready. Use /architect to start designing.',
      nextSteps: ['Define requirements', 'Design components', 'Document architecture'],
    }),
  });

  // Testing Skill
  manager.registerSkill({
    manifest: {
      name: 'testing',
      description: 'Write comprehensive tests',
      version: '1.0.0',
      instructions: `Write tests following best practices:
1. Unit tests for individual functions
2. Integration tests for component interactions
3. Edge cases and error scenarios
4. Happy path and sad path
5. Mock external dependencies
6. Use descriptive test names
7. Follow AAA pattern: Arrange, Act, Assert

Aim for high code coverage with meaningful tests.`,
      triggers: ['test', 'tests', 'unit test'],
      category: 'testing',
    },
    execute: async (input) => {
      const filePath = input.filePath as string;
      const { readFileSync, existsSync, writeFileSync } = await import('node:fs');
      const { join, dirname, extname, basename } = await import('node:path');

      if (!filePath || !existsSync(filePath)) {
        return { success: false, error: 'File path required' };
      }

      try {
        const code = readFileSync(filePath, 'utf-8');
        const ext = extname(filePath);
        const baseName = basename(filePath, ext);
        const testFileName = baseName + '.test' + ext;
        const testFilePath = join(dirname(filePath), testFileName);

        // Extract functions to test
        const functionMatches = code.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g);
        const functions = Array.from(functionMatches, m => ({ name: m[1], params: m[2] }));

        const classMatches = code.matchAll(/(?:export\s+)?class\s+(\w+)/g);
        const classes = Array.from(classMatches, m => m[1]);

        let testContent = '';

        if (ext === '.ts' || ext === '.tsx') {
          testContent = `import { describe, it, expect } from 'vitest';
import { ${functions.map(f => f.name).join(', ')} } from './${baseName}';

describe('${baseName}', () => {
`;

          for (const fn of functions) {
            testContent += `  describe('${fn.name}', () => {
    it('should work correctly', async () => {
      // TODO: Add test implementation
      expect(true).toBe(true);
    });

    it('should handle edge cases', async () => {
      // TODO: Add edge case test
    });
  });

`;
          }

          testContent += `});
`;
        } else if (ext === '.py') {
          testContent = `import unittest
from ${baseName} import ${functions.map(f => f.name).join(', ')}

class Test${baseName.charAt(0).toUpperCase() + baseName.slice(1)}(unittest.TestCase):
`;

          for (const fn of functions) {
            testContent += `
    def test_${fn.name}(self):
        # TODO: Add test implementation
        pass

`;
          }

          testContent += `
if __name__ == '__main__':
    unittest.main()
`;
        } else {
          return { success: false, error: `Unsupported file type: ${ext}` };
        }

        if (input.write === true) {
          writeFileSync(testFilePath, testContent);
          return {
            success: true,
            output: `Test file created: ${testFilePath}\n\n` +
                    `Functions found: ${functions.length}\n` +
                    `${functions.map(f => `- ${f.name}`).join('\n')}\n\n` +
                    `Edit the test file to add test implementations.`,
            nextSteps: ['Edit test file', 'Run tests with npm test'],
          };
        }

        return {
          success: true,
          output: `Generated test skeleton for ${functions.length} functions:\n\n` +
                  testContent,
          nextSteps: ['Set write=true to save file'],
        };
      } catch (error) {
        return {
          success: false,
          error: `Test generation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  // Documentation Skill
  manager.registerSkill({
    manifest: {
      name: 'documentation',
      description: 'Generate comprehensive documentation',
      version: '1.0.0',
      instructions: `Create clear, comprehensive documentation:
1. README with setup and usage
2. API documentation with examples
3. Architecture overview
4. Code comments for complex logic
5. Contributing guidelines
6. Troubleshooting guide

Use markdown formatting with code examples.`,
      triggers: ['docs', 'documentation', 'readme'],
      category: 'documentation',
    },
    execute: async (input) => {
      const projectName = (input.projectName as string) || 'My Project';
      const { readFileSync, existsSync, readdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');

      try {
        let readme = `# ${projectName}\n\n`;
        readme += `> Auto-generated documentation by viclaw\n\n`;
        readme += `## Table of Contents\n`;
        readme += `- [Installation](#installation)\n`;
        readme += `- [Usage](#usage)\n`;
        readme += `- [API Reference](#api-reference)\n`;
        readme += `- [Architecture](#architecture)\n`;
        readme += `- [Contributing](#contributing)\n\n`;

        readme += `## Installation\n\n`;
        readme += '```bash\nnpm install\n```\n\n';

        readme += `## Usage\n\n`;
        readme += '```bash\nnpm start\n```\n\n';

        readme += `## API Reference\n\n`;

        // Scan source files for exports
        const srcDir = input.sourceDir as string || 'src';
        if (existsSync(srcDir)) {
          const files = readdirSync(srcDir).filter(f => f.match(/\.(ts|js|py)$/));

          for (const file of files.slice(0, 10)) {
            const filePath = join(srcDir, file);
            const code = readFileSync(filePath, 'utf-8');

            const functions = code.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g);
            for (const fn of functions) {
              readme += `### \`${fn[1]}(${fn[2]})\`\n\n`;
              readme += `Defined in: \`${file}\`\n\n`;
              readme += '**Description:** TODO\n\n';
              readme += '**Parameters:**\n';
              readme += `- \`${fn[2]}\` - TODO\n\n`;
              readme += '**Returns:** TODO\n\n';
            }

            const classes = code.matchAll(/(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/g);
            for (const cls of classes) {
              readme += `### \`class ${cls[1]}\`\n\n`;
              readme += `Defined in: \`${file}\`\n\n`;
              readme += '**Description:** TODO\n\n';
            }
          }
        }

        readme += `## Architecture\n\n`;
        readme += `TODO: Add architecture diagram\n\n`;
        readme += `## Contributing\n\n`;
        readme += `1. Fork the repository\n2. Create a feature branch\n3. Make your changes\n4. Submit a pull request\n\n`;

        if (input.write === true) {
          const outputFile = (input.outputFile as string) || 'README.md';
          writeFileSync(outputFile, readme);
          return {
            success: true,
            output: `Documentation written to ${outputFile}`,
            nextSteps: ['Edit README.md to add descriptions', 'Add architecture diagram'],
          };
        }

        return {
          success: true,
          output: readme,
          nextSteps: ['Set write=true to save file'],
        };
      } catch (error) {
        return {
          success: false,
          error: `Documentation generation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  return manager;
}
