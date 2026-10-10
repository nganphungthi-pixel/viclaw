/**
 * Memory System Tests
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { MemorySystem, MemoryType } from '../src/memory/mod.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const TEST_DIR = './.test-viclaw-memory';

describe('MemorySystem', () => {
  let memory: MemorySystem;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    memory = new MemorySystem({
      storageDir: TEST_DIR,
    });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should save and load session memory', async () => {
    await memory.saveMemory('viclaw-test-key', { value: 'test' }, MemoryType.Session);
    const loaded = memory.loadMemory('viclaw-test-key', MemoryType.Session);
    expect(loaded).toBeDefined();
  });

  it('should save and load working memory', async () => {
    await memory.saveMemory('viclaw-working-key', 'viclaw-working-value', MemoryType.Working);
    const loaded = memory.loadMemory('viclaw-working-key', MemoryType.Working);
    expect(loaded).toBe('viclaw-working-value');
  });

  it('should search memory', async () => {
    await memory.saveMemory('viclaw-search-test', { data: 'findable' }, MemoryType.Session);
    const results = await memory.searchMemory('viclaw-search');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should learn patterns', async () => {
    const pattern = await memory.learnPattern(
      'viclaw-test-pattern',
      'A test pattern',
      { type: 'test' },
      undefined,
      ['Read', 'Write']
    );
    expect(pattern.name).toBe('viclaw-test-pattern');
  });

  it('should manage sessions', async () => {
    const sessionId = await memory.startNewSession();
    expect(sessionId).toBeDefined();
    expect(memory.getSessionId()).toBe(sessionId);
  });

  it('should return stats', () => {
    const stats = memory.getStats();
    expect(stats.totalPatterns).toBeDefined();
    expect(stats.totalSessions).toBeDefined();
  });
});
