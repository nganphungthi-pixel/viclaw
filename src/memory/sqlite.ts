/**
 * SQLite-based Persistent Memory System
 * Uses sql.js for pure JavaScript SQLite (no native compilation needed)
 */

import initSqlJs, { Database } from 'sql.js';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface MemoryRecord {
  id: string;
  key: string;
  value: string; // JSON string
  type: 'session' | 'longterm' | 'working' | 'episodic';
  priority: number;
  accessCount: number;
  lastAccessed: number;
  createdAt: number;
  metadata?: string; // JSON string
}

export interface PatternRecord {
  id: string;
  name: string;
  description: string;
  pattern: string; // JSON
  useCount: number;
  successRate: number;
  lastUsed: number;
  createdAt: number;
  code?: string;
  steps?: string; // JSON array
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  version: string;
  manifest: string; // JSON
  useCount: number;
  lastUsed: number;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  startTime: number;
  endTime?: number;
  summary?: string;
  success: boolean;
}

export interface SQLiteMemoryConfig {
  dbPath?: string;
  autoSave?: boolean;
  saveInterval?: number;
}

const DEFAULT_SQLITE_CONFIG: Required<SQLiteMemoryConfig> = {
  dbPath: join(homedir(), '.viclaw', 'memory.sqlite'),
  autoSave: true,
  saveInterval: 30000, // 30 seconds
};

let SQL: any;

export class SQLiteMemory {
  private db!: Database;
  private config: Required<SQLiteMemoryConfig>;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(config: SQLiteMemoryConfig = {}) {
    this.config = { ...DEFAULT_SQLITE_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      if (!SQL) {
        // Try local wasm file first, then fallback to URL
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const localWasm = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
        
        if (fs.existsSync(localWasm)) {
          SQL = await initSqlJs({
            locateFile: () => localWasm,
          });
        } else {
          SQL = await initSqlJs({
            locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
          });
        }
      }
    } catch {
      // If wasm loading fails, SQLite won't be available
      // This is non-critical - JSON memory will be used instead
      return;
    }

    const dbDir = dirname(this.config.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Load or create database
    if (existsSync(this.config.dbPath)) {
      const buffer = readFileSync(this.config.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
      this.createTables();
    }

    // Set up auto-save if enabled
    if (this.config.autoSave) {
      this.startAutoSave();
    }
  }

  private createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        type TEXT NOT NULL,
        priority INTEGER DEFAULT 5,
        accessCount INTEGER DEFAULT 0,
        lastAccessed INTEGER,
        createdAt INTEGER,
        metadata TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        pattern TEXT NOT NULL,
        useCount INTEGER DEFAULT 0,
        successRate REAL DEFAULT 1.0,
        lastUsed INTEGER,
        createdAt INTEGER,
        code TEXT,
        steps TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        version TEXT DEFAULT '1.0.0',
        manifest TEXT NOT NULL,
        useCount INTEGER DEFAULT 0,
        lastUsed INTEGER,
        createdAt INTEGER
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        startTime INTEGER NOT NULL,
        endTime INTEGER,
        summary TEXT,
        success INTEGER DEFAULT 1
      )
    `);

    // Create indexes for faster queries
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_patterns_name ON patterns(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`);
    this.db.run(`COMMIT`);
  }

  private startAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    this.saveTimer = setInterval(() => {
      this.save();
    }, this.config.saveInterval);
  }

  save(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    mkdirSync(dirname(this.config.dbPath), { recursive: true });
    writeFileSync(this.config.dbPath, buffer);
  }

  // ============================================
  // MEMORY OPERATIONS
  // ============================================

  async saveMemory(
    key: string,
    value: unknown,
    type: 'session' | 'longterm' | 'working' | 'episodic',
    priority: number = 5,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.run(
      `INSERT OR REPLACE INTO memories (id, key, value, type, priority, accessCount, lastAccessed, createdAt, metadata)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        id,
        key,
        JSON.stringify(value),
        type,
        priority,
        now,
        now,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    if (this.config.autoSave) {
      this.save();
    }
  }

  async loadMemory(key: string, type?: string): Promise<unknown> {
    let query = 'SELECT value FROM memories WHERE key = ?';
    let params: any[] = [key];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.getAsObject(params);
    stmt.free();

    if (result.value) {
      // Update access count
      this.db.run(
        'UPDATE memories SET accessCount = accessCount + 1, lastAccessed = ? WHERE key = ?',
        [Date.now(), key]
      );

      return JSON.parse(result.value as string);
    }

    return undefined;
  }

  async searchMemories(query: string, limit: number = 10): Promise<MemoryRecord[]> {
    const searchQuery = `%${query}%`;
    const stmt = this.db.prepare(
      `SELECT * FROM memories 
       WHERE key LIKE ? OR value LIKE ? 
       ORDER BY lastAccessed DESC 
       LIMIT ?`
    );

    const results: MemoryRecord[] = [];
    stmt.bind([searchQuery, searchQuery, limit]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id as string,
        key: row.key as string,
        value: row.value as string,
        type: row.type as any,
        priority: row.priority as number,
        accessCount: row.accessCount as number,
        lastAccessed: row.lastAccessed as number,
        createdAt: row.createdAt as number,
        metadata: row.metadata as string,
      });
    }

    stmt.free();
    return results;
  }

  async deleteMemory(key: string): Promise<boolean> {
    this.db.run('DELETE FROM memories WHERE key = ?', [key]);

    if (this.config.autoSave) {
      this.save();
    }

    return this.db.getRowsModified() > 0;
  }

  // ============================================
  // PATTERN OPERATIONS
  // ============================================

  async savePattern(pattern: PatternRecord): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO patterns (id, name, description, pattern, useCount, successRate, lastUsed, createdAt, code, steps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pattern.id,
        pattern.name,
        pattern.description,
        pattern.pattern,
        pattern.useCount,
        pattern.successRate,
        pattern.lastUsed,
        pattern.createdAt,
        pattern.code || null,
        pattern.steps || null,
      ]
    );

    if (this.config.autoSave) {
      this.save();
    }
  }

  async loadPattern(id: string): Promise<PatternRecord | undefined> {
    const stmt = this.db.prepare('SELECT * FROM patterns WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return {
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        pattern: row.pattern as string,
        useCount: row.useCount as number,
        successRate: row.successRate as number,
        lastUsed: row.lastUsed as number,
        createdAt: row.createdAt as number,
        code: row.code as string,
        steps: row.steps as string,
      };
    }

    stmt.free();
    return undefined;
  }

  async searchPatterns(query: string, limit: number = 10): Promise<PatternRecord[]> {
    const searchQuery = `%${query}%`;
    const stmt = this.db.prepare(
      `SELECT * FROM patterns 
       WHERE name LIKE ? OR description LIKE ? 
       ORDER BY useCount DESC 
       LIMIT ?`
    );

    const results: PatternRecord[] = [];
    stmt.bind([searchQuery, searchQuery, limit]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        pattern: row.pattern as string,
        useCount: row.useCount as number,
        successRate: row.successRate as number,
        lastUsed: row.lastUsed as number,
        createdAt: row.createdAt as number,
        code: row.code as string,
        steps: row.steps as string,
      });
    }

    stmt.free();
    return results;
  }

  async updatePatternStats(
    id: string,
    success: boolean
  ): Promise<void> {
    const pattern = await this.loadPattern(id);
    if (!pattern) return;

    const totalAttempts = pattern.useCount + 1;
    const successfulAttempts = success ? pattern.useCount + 1 : pattern.useCount;
    const newSuccessRate = successfulAttempts / totalAttempts;

    this.db.run(
      'UPDATE patterns SET useCount = ?, successRate = ?, lastUsed = ? WHERE id = ?',
      [totalAttempts, newSuccessRate, Date.now(), id]
    );

    if (this.config.autoSave) {
      this.save();
    }
  }

  // ============================================
  // SKILL OPERATIONS
  // ============================================

  async saveSkill(skill: SkillRecord): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO skills (id, name, description, version, manifest, useCount, lastUsed, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        skill.id,
        skill.name,
        skill.description,
        skill.version,
        skill.manifest,
        skill.useCount,
        skill.lastUsed,
        skill.createdAt,
      ]
    );

    if (this.config.autoSave) {
      this.save();
    }
  }

  async loadSkill(name: string): Promise<SkillRecord | undefined> {
    const stmt = this.db.prepare('SELECT * FROM skills WHERE name = ?');
    stmt.bind([name]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return {
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        version: row.version as string,
        manifest: row.manifest as string,
        useCount: row.useCount as number,
        lastUsed: row.lastUsed as number,
        createdAt: row.createdAt as number,
      };
    }

    stmt.free();
    return undefined;
  }

  async listSkills(): Promise<SkillRecord[]> {
    const stmt = this.db.prepare('SELECT * FROM skills ORDER BY name');
    const results: SkillRecord[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id as string,
        name: row.name as string,
        description: row.description as string,
        version: row.version as string,
        manifest: row.manifest as string,
        useCount: row.useCount as number,
        lastUsed: row.lastUsed as number,
        createdAt: row.createdAt as number,
      });
    }

    stmt.free();
    return results;
  }

  // ============================================
  // SESSION OPERATIONS
  // ============================================

  async saveSession(session: SessionRecord): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO sessions (id, startTime, endTime, summary, success)
       VALUES (?, ?, ?, ?, ?)`,
      [
        session.id,
        session.startTime,
        session.endTime || null,
        session.summary || null,
        session.success ? 1 : 0,
      ]
    );

    if (this.config.autoSave) {
      this.save();
    }
  }

  async loadSession(id: string): Promise<SessionRecord | undefined> {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return {
        id: row.id as string,
        startTime: row.startTime as number,
        endTime: row.endTime as number,
        summary: row.summary as string,
        success: (row.success as number) === 1,
      };
    }

    stmt.free();
    return undefined;
  }

  async listSessions(limit: number = 20): Promise<SessionRecord[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions ORDER BY startTime DESC LIMIT ?'
    );

    const results: SessionRecord[] = [];
    stmt.bind([limit]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id as string,
        startTime: row.startTime as number,
        endTime: row.endTime as number,
        summary: row.summary as string,
        success: (row.success as number) === 1,
      });
    }

    stmt.free();
    return results;
  }

  // ============================================
  // STATISTICS
  // ============================================

  getStats(): {
    totalMemories: number;
    totalPatterns: number;
    totalSkills: number;
    totalSessions: number;
  } {
    const memCount = this.db.exec('SELECT COUNT(*) as count FROM memories');
    const patCount = this.db.exec('SELECT COUNT(*) as count FROM patterns');
    const skillCount = this.db.exec('SELECT COUNT(*) as count FROM skills');
    const sessionCount = this.db.exec('SELECT COUNT(*) as count FROM sessions');

    return {
      totalMemories: (memCount[0]?.values[0]?.[0] as number) || 0,
      totalPatterns: (patCount[0]?.values[0]?.[0] as number) || 0,
      totalSkills: (skillCount[0]?.values[0]?.[0] as number) || 0,
      totalSessions: (sessionCount[0]?.values[0]?.[0] as number) || 0,
    };
  }

  close(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    this.save();
    this.db.close();
  }
}
