import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export enum MemoryType {
  Session = "session",
  LongTerm = "longterm",
  Working = "working",
  Episodic = "episodic",
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  type: MemoryType;
  timestamp: number;
  priority: number;
  accessCount: number;
  lastAccessed: number;
  metadata?: Record<string, unknown>;
}

export interface SessionMemory {
  sessionId: string;
  context: Map<string, unknown>;
  startTime: number;
  variables: Map<string, unknown>;
}

export interface LongTermMemory {
  patterns: Map<string, PatternEntry>;
  learnedSkills: Map<string, Skill>;
  knowledgeGraph: Map<string, KnowledgeNode>;
}

export interface WorkingMemory {
  currentTask: TaskContext | null;
  activeContext: Map<string, unknown>;
  taskStack: TaskContext[];
}

export interface EpisodicMemory {
  sessions: SessionRecord[];
  totalSessions: number;
}

export interface PatternEntry {
  id: string;
  name: string;
  description: string;
  pattern: string;
  useCount: number;
  successRate: number;
  lastUsed: number;
  createdAt: number;
  code?: string;
  steps?: string[];
}

export interface Skill {
  name: string;
  manifest: SkillManifest;
  execute: (input: unknown) => Promise<SkillResult>;
}

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  author?: string;
  parameters: SkillParameter[];
  steps: SkillStep[];
  createdAt: number;
  lastUsed?: number;
  useCount: number;
}

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface SkillStep {
  order: number;
  action: string;
  description: string;
  tool?: string;
  input?: Record<string, unknown>;
}

export interface SkillResult {
  success: boolean;
  output?: unknown;
  error?: string;
  stepsExecuted: number;
}

export interface TaskContext {
  id: string;
  description: string;
  status: TaskStatus;
  priority: number;
  createdAt: number;
  completedAt?: number;
  steps: Array<{
    action: string;
    description: string;
    tool?: string;
    input?: Record<string, unknown>;
  }>;
  input?: unknown;
  output?: unknown;
  patternId?: string;
  skillName?: string;
}

export enum TaskStatus {
  Pending = "pending",
  InProgress = "in_progress",
  Completed = "completed",
  Failed = "failed",
}

export interface KnowledgeNode {
  id: string;
  type: string;
  content: unknown;
  connections: string[];
  createdAt: number;
  accessedAt: number;
}

export interface SessionRecord {
  id: string;
  startTime: number;
  endTime?: number;
  tasks: TaskContext[];
  patternsUsed: string[];
  success: boolean;
  summary?: string;
}

const MemoryConfigSchema = z.object({
  storageDir: z.string().optional(),
  maxSessionEntries: z.number().optional(),
  maxWorkingEntries: z.number().optional(),
  patternSuccessThreshold: z.number().optional(),
  defaultPriority: z.number().optional(),
});

type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

const DEFAULT_CONFIG: Required<MemoryConfig> = {
  storageDir: join(homedir(), ".viclaw", "memory"),
  maxSessionEntries: 1000,
  maxWorkingEntries: 100,
  patternSuccessThreshold: 0.7,
  defaultPriority: 5,
};

const MemoryEntrySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  type: z.nativeEnum(MemoryType),
  timestamp: z.number(),
  priority: z.number(),
  accessCount: z.number(),
  lastAccessed: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

interface StoredMemory {
  version: number;
  memories: MemoryEntry[];
  skills: SkillManifest[];
  patterns: PatternEntry[];
  sessions: SessionRecord[];
}

export class MemorySystem {
  private config: Required<MemoryConfig>;
  private sessionMemory: SessionMemory;
  private longTermMemory: LongTermMemory;
  private workingMemory: WorkingMemory;
  private episodicMemory: EpisodicMemory;
  private storagePath: string;

  constructor(config: MemoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storagePath = join(this.config.storageDir, "memory.json");
    
    this.sessionMemory = {
      sessionId: crypto.randomUUID(),
      context: new Map(),
      startTime: Date.now(),
      variables: new Map(),
    };
    
    this.longTermMemory = {
      patterns: new Map(),
      learnedSkills: new Map(),
      knowledgeGraph: new Map(),
    };
    
    this.workingMemory = {
      currentTask: null,
      activeContext: new Map(),
      taskStack: [],
    };
    
    this.episodicMemory = {
      sessions: [],
      totalSessions: 0,
    };
    
    this.loadFromDisk();
  }

  private ensureStorageDir(): void {
    if (!existsSync(this.config.storageDir)) {
      try {
        mkdirSync(this.config.storageDir, { recursive: true });
      } catch {
        // If we can't create the directory, memory will still work in-memory
        // Just skip disk persistence for this session
      }
    }
  }

  private loadFromDisk(): void {
    try {
      if (existsSync(this.storagePath)) {
        const data = JSON.parse(readFileSync(this.storagePath, "utf-8")) as StoredMemory;

        if (data.patterns) {
          for (const pattern of data.patterns) {
            this.longTermMemory.patterns.set(pattern.id, pattern);
          }
        }

        if (data.skills) {
          for (const manifest of data.skills) {
            const skill: Skill = {
              name: manifest.name,
              manifest,
              execute: async (input: unknown) => ({
                success: false,
                error: "Skill execution not implemented",
                stepsExecuted: 0,
              }),
            };
            this.longTermMemory.learnedSkills.set(manifest.name, skill);
          }
        }

        if (data.sessions) {
          this.episodicMemory.sessions = data.sessions;
          this.episodicMemory.totalSessions = data.sessions.length;
        }
      }
    } catch {
      // If we can't load from disk, start fresh - memory still works in-memory
    }
  }

  private saveToDisk(): void {
    this.ensureStorageDir();

    // If directory still doesn't exist (permission issue), skip saving
    if (!existsSync(this.config.storageDir)) {
      return;
    }

    const patterns = Array.from(this.longTermMemory.patterns.values());
    const skills = Array.from(this.longTermMemory.learnedSkills.values()).map(s => s.manifest);
    const sessions = this.episodicMemory.sessions;
    
    const data: StoredMemory = {
      version: 1,
      memories: [],
      patterns,
      skills,
      sessions,
    };
    
    writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
  }

  async saveMemory(key: string, value: unknown, type: MemoryType, priority?: number, metadata?: Record<string, unknown>): Promise<void> {
    const entry: MemoryEntry = {
      key,
      value,
      type,
      timestamp: Date.now(),
      priority: priority ?? this.config.defaultPriority,
      accessCount: 0,
      lastAccessed: Date.now(),
      metadata,
    };
    
    switch (type) {
      case MemoryType.Session:
        this.sessionMemory.context.set(key, value);
        break;
      case MemoryType.Working:
        this.workingMemory.activeContext.set(key, value);
        break;
      case MemoryType.LongTerm:
        this.longTermMemory.patterns.set(key, {
          id: key,
          name: key,
          description: "",
          pattern: JSON.stringify(value),
          useCount: 0,
          successRate: 1,
          lastUsed: Date.now(),
          createdAt: Date.now(),
        });
        break;
      case MemoryType.Episodic:
        const session: SessionRecord = {
          id: key,
          startTime: Date.now(),
          tasks: [],
          patternsUsed: [],
          success: true,
        };
        this.episodicMemory.sessions.push(session);
        break;
    }
    
    this.saveToDisk();
  }

  loadMemory(key: string, type?: MemoryType): unknown {
    if (type) {
      return this.loadFromType(key, type);
    }
    
    if (this.sessionMemory.context.has(key)) {
      return this.sessionMemory.context.get(key);
    }
    if (this.workingMemory.activeContext.has(key)) {
      return this.workingMemory.activeContext.get(key);
    }
    if (this.longTermMemory.patterns.has(key)) {
      const pattern = this.longTermMemory.patterns.get(key);
      if (pattern) {
        try {
          return JSON.parse(pattern.pattern);
        } catch {
          return pattern.pattern;
        }
      }
    }
    
    return undefined;
  }

  private loadFromType(key: string, type: MemoryType): unknown {
    switch (type) {
      case MemoryType.Session:
        return this.sessionMemory.context.get(key);
      case MemoryType.Working:
        return this.workingMemory.activeContext.get(key);
      case MemoryType.LongTerm:
        const pattern = this.longTermMemory.patterns.get(key);
        return pattern ? JSON.parse(pattern.pattern) : undefined;
      case MemoryType.Episodic:
        return this.episodicMemory.sessions.find(s => s.id === key);
    }
  }

  async searchMemory(query: string, limit: number = 10): Promise<Array<{ key: string; value: unknown; type: MemoryType }>> {
    const results: Array<{ key: string; value: unknown; type: MemoryType }> = [];
    const queryLower = query.toLowerCase();
    
    for (const [key, value] of this.sessionMemory.context) {
      if (key.toLowerCase().includes(queryLower) || JSON.stringify(value).toLowerCase().includes(queryLower)) {
        results.push({ key, value, type: MemoryType.Session });
      }
    }
    
    for (const [key, value] of this.workingMemory.activeContext) {
      if (key.toLowerCase().includes(queryLower) || JSON.stringify(value).toLowerCase().includes(queryLower)) {
        results.push({ key, value, type: MemoryType.Working });
      }
    }
    
    for (const [id, pattern] of this.longTermMemory.patterns) {
      if (pattern.name.toLowerCase().includes(queryLower) || pattern.description.toLowerCase().includes(queryLower)) {
        results.push({ key: id, value: pattern, type: MemoryType.LongTerm });
      }
    }
    
    return results.slice(0, limit);
  }

  async forgetMemory(key: string): Promise<boolean> {
    let deleted = false;
    
    if (this.sessionMemory.context.has(key)) {
      this.sessionMemory.context.delete(key);
      deleted = true;
    }
    if (this.workingMemory.activeContext.has(key)) {
      this.workingMemory.activeContext.delete(key);
      deleted = true;
    }
    if (this.longTermMemory.patterns.has(key)) {
      this.longTermMemory.patterns.delete(key);
      deleted = true;
    }
    
    if (deleted) {
      this.saveToDisk();
    }
    
    return deleted;
  }

  async extractPatterns(): Promise<PatternEntry[]> {
    const patterns: PatternEntry[] = [];
    const recentSessions = this.episodicMemory.sessions.slice(-10);
    
    for (const session of recentSessions) {
      if (session.success && session.tasks.length > 0) {
        for (const task of session.tasks) {
          if (task.status === TaskStatus.Completed && task.patternId) {
            const existing = this.longTermMemory.patterns.get(task.patternId);
            if (existing) {
              existing.useCount++;
              patterns.push(existing);
            }
          }
        }
      }
    }
    
    for (const [id, pattern] of this.longTermMemory.patterns) {
      if (pattern.useCount >= 3) {
        patterns.push(pattern);
      }
    }
    
    this.saveToDisk();
    return patterns;
  }

  async learnPattern(name: string, description: string, pattern: unknown, code?: string, steps?: string[]): Promise<PatternEntry> {
    const entry: PatternEntry = {
      id: crypto.randomUUID(),
      name,
      description,
      pattern: JSON.stringify(pattern),
      useCount: 0,
      successRate: 1,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      code,
      steps,
    };
    
    this.longTermMemory.patterns.set(entry.id, entry);
    this.saveToDisk();
    
    return entry;
  }

  async updatePatternSuccess(patternId: string, success: boolean): Promise<void> {
    const pattern = this.longTermMemory.patterns.get(patternId);
    if (!pattern) return;
    
    const totalAttempts = pattern.useCount + 1;
    const successfulAttempts = success ? pattern.useCount + 1 : pattern.useCount;
    pattern.successRate = successfulAttempts / totalAttempts;
    pattern.useCount = totalAttempts;
    pattern.lastUsed = Date.now();
    
    this.saveToDisk();
  }

  getSessionContext(): Map<string, unknown> {
    return this.sessionMemory.context;
  }

  getWorkingContext(): Map<string, unknown> {
    return this.workingMemory.activeContext;
  }

  getPatterns(): PatternEntry[] {
    return Array.from(this.longTermMemory.patterns.values());
  }

  getSkills(): Skill[] {
    return Array.from(this.longTermMemory.learnedSkills.values());
  }

  getSessionHistory(): SessionRecord[] {
    return this.episodicMemory.sessions;
  }

  async loadSkill(name: string): Promise<Skill | undefined> {
    return this.longTermMemory.learnedSkills.get(name);
  }

  async registerSkill(name: string, description: string, steps: SkillStep[], parameters?: SkillParameter[]): Promise<void> {
    const manifest: SkillManifest = {
      name,
      description,
      version: "1.0.0",
      parameters: parameters || [],
      steps,
      createdAt: Date.now(),
      useCount: 0,
    };
    
    const skill: Skill = {
      name,
      manifest,
      execute: async (input: unknown) => {
        let stepsExecuted = 0;
        for (const step of steps) {
          stepsExecuted++;
        }
        return {
          success: true,
          output: { executed: stepsExecuted },
          stepsExecuted,
        };
      },
    };
    
    this.longTermMemory.learnedSkills.set(name, skill);
    this.saveToDisk();
  }

  async executeSkill(name: string, input: unknown): Promise<SkillResult> {
    const skill = this.longTermMemory.learnedSkills.get(name);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${name}`,
        stepsExecuted: 0,
      };
    }
    
    skill.manifest.useCount++;
    skill.manifest.lastUsed = Date.now();
    
    return skill.execute(input);
  }

  async learnFromTask(task: TaskContext): Promise<Skill | undefined> {
    if (task.status !== TaskStatus.Completed || task.steps.length === 0) {
      return undefined;
    }
    
    const skillName = `auto_${task.id.slice(0, 8)}`;
    const skillSteps: SkillStep[] = task.steps.map((step, index) => ({
      order: index + 1,
      action: step.action,
      description: step.description,
      tool: step.tool,
      input: step.input,
    }));
    
    await this.registerSkill(
      skillName,
      `Auto-learned skill from task: ${task.description}`,
      skillSteps
    );
    
    const pattern = await this.learnPattern(
      skillName,
      task.description,
      { taskId: task.id, steps: skillSteps },
      undefined,
      skillSteps.map(s => s.action)
    );
    
    this.saveToDisk();
    
    return this.longTermMemory.learnedSkills.get(skillName);
  }

  async setWorkingTask(task: TaskContext): Promise<void> {
    this.workingMemory.currentTask = task;
  }

  async getWorkingTask(): Promise<TaskContext | null> {
    return this.workingMemory.currentTask;
  }

  async completeWorkingTask(success: boolean, output?: unknown): Promise<void> {
    if (this.workingMemory.currentTask) {
      this.workingMemory.currentTask.status = success ? TaskStatus.Completed : TaskStatus.Failed;
      this.workingMemory.currentTask.completedAt = Date.now();
      this.workingMemory.currentTask.output = output;
      
      const session = this.episodicMemory.sessions[this.episodicMemory.sessions.length - 1];
      if (session) {
        session.tasks.push(this.workingMemory.currentTask);
        session.success = success;
      }
      
      if (success && this.workingMemory.currentTask.steps.length > 0) {
        await this.learnFromTask(this.workingMemory.currentTask);
      }
      
      this.workingMemory.currentTask = null;
      this.saveToDisk();
    }
  }

  async startNewSession(): Promise<string> {
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      tasks: [],
      patternsUsed: [],
      success: true,
    };
    
    this.episodicMemory.sessions.push(session);
    this.episodicMemory.totalSessions++;
    
    this.sessionMemory = {
      sessionId: session.id,
      context: new Map(),
      startTime: Date.now(),
      variables: new Map(),
    };
    
    this.workingMemory = {
      currentTask: null,
      activeContext: new Map(),
      taskStack: [],
    };
    
    this.saveToDisk();
    
    return session.id;
  }

  async endSession(summary?: string): Promise<void> {
    const session = this.episodicMemory.sessions[this.episodicMemory.sessions.length - 1];
    if (session) {
      session.endTime = Date.now();
      session.summary = summary;
    }
    
    this.saveToDisk();
  }

  getSessionId(): string {
    return this.sessionMemory.sessionId;
  }

  getStats(): {
    totalPatterns: number;
    totalSkills: number;
    totalSessions: number;
    averageSuccessRate: number;
  } {
    let totalSuccessRate = 0;
    let patternsWithUse = 0;
    
    for (const pattern of this.longTermMemory.patterns.values()) {
      if (pattern.useCount > 0) {
        totalSuccessRate += pattern.successRate;
        patternsWithUse++;
      }
    }
    
    return {
      totalPatterns: this.longTermMemory.patterns.size,
      totalSkills: this.longTermMemory.learnedSkills.size,
      totalSessions: this.episodicMemory.totalSessions,
      averageSuccessRate: patternsWithUse > 0 ? totalSuccessRate / patternsWithUse : 0,
    };
  }
}

let memorySystemInstance: MemorySystem | null = null;

export function createMemorySystem(config?: MemoryConfig): MemorySystem {
  memorySystemInstance = new MemorySystem(config);
  return memorySystemInstance;
}

export function getMemorySystem(): MemorySystem {
  if (!memorySystemInstance) {
    memorySystemInstance = new MemorySystem();
  }
  return memorySystemInstance;
}