/**
 * Scheduler Tests.
 *
 * Mirrors the dependency-free proof harness (.openclaw/tmp/proof3.mjs) so the
 * same behavior is locked in under vitest when deps are installed.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Scheduler,
  parseDuration,
  parseCron,
  nextCronRun,
  computeNextRun,
} from '../src/scheduler/mod.js';

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('parseDuration', () => {
  it('parses units', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('1d')).toBe(86_400_000);
    expect(parseDuration('500ms')).toBe(500);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('ten minutes')).toThrow();
  });
});

describe('cron', () => {
  // 2026-10-11 is a Sunday (UTC).
  const sundayNoon = Date.UTC(2026, 9, 11, 12, 0, 0);

  it('finds next 5-minute mark', () => {
    expect(nextCronRun('*/5 * * * *', sundayNoon)).toBe(Date.UTC(2026, 9, 11, 12, 5, 0));
  });

  it('uses Vixie DOM/DOW OR logic (15th beats Friday)', () => {
    expect(nextCronRun('0 9 15 * 5', sundayNoon)).toBe(Date.UTC(2026, 9, 15, 9, 0, 0));
  });

  it('rejects malformed expressions', () => {
    expect(() => parseCron('*/5 * * *')).toThrow();
    expect(() => parseCron('99 * * * *')).toThrow();
  });

  it('computes every-interval next runs', () => {
    expect(computeNextRun({ kind: 'every', every: '1h' }, 1000)).toBe(3_601_000);
  });
});

describe('Scheduler', () => {
  it('fires due jobs and records ok runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-'));
    let now = 1_000_000;
    const fired: string[] = [];
    const s = new Scheduler(
      async (job) => {
        fired.push(job.payload.name);
        return { ok: true, detail: 'did-work' };
      },
      { dir, now: () => now, backoffMs: [50, 60] }
    );
    s.add({ kind: 'every', every: '10m' }, { name: 'heartbeat' });
    now += 600_001;
    await s.tick();
    await flush();
    expect(fired).toEqual(['heartbeat']);
    expect(s.history()).toHaveLength(1);
    expect(s.history()[0].status).toBe('ok');
    s.stop();
  });

  it('auto-deletes successful one-shots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-'));
    let now = 5_000_000;
    const s = new Scheduler(async () => ({ ok: true, detail: 'once' }), { dir, now: () => now });
    s.add({ kind: 'at', at: now + 1000 }, { name: 'once' });
    now += 1001;
    await s.tick();
    await flush();
    expect(s.list()).toHaveLength(0);
    s.stop();
  });

  it('backs off then parks failing jobs (attempts persist across ticks)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-'));
    let now = 9_000_000;
    const s = new Scheduler(
      async () => {
        throw new Error('runner exploded');
      },
      { dir, now: () => now, backoffMs: [50, 60] }
    );
    s.add({ kind: 'every', every: '1h' }, { name: 'flaky' }, { maxAttempts: 2 });
    now += 3_600_001;
    await s.tick();
    await flush();
    expect(s.list()[0].enabled).toBe(true); // first failure: backoff, still live
    now += 51;
    await s.tick();
    await flush();
    const job = s.list()[0];
    expect(job.enabled).toBe(false); // second failure: parked
    expect(job.nextRunMs).toBeNull();
    expect(s.history().filter((r) => r.status === 'error')).toHaveLength(2);
    s.stop();
  });

  it('records timeouts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-'));
    const s = new Scheduler(() => new Promise(() => {}), { dir, backoffMs: [50] });
    s.add({ kind: 'every', every: '1h' }, { name: 'hangs' }, { timeoutMs: 30, maxAttempts: 1 });
    const rec = await s.runNow(s.list()[0].id);
    expect(rec?.status).toBe('timeout');
    s.stop();
  });

  it('preflight failures skip without consuming error budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-'));
    let now = 20_000_000;
    let runs = 0;
    const s = new Scheduler(
      async () => {
        runs++;
        return { ok: true, detail: 'x' };
      },
      { dir, now: () => now, backoffMs: [50] }
    );
    s.setPreflight(async () => false);
    s.add({ kind: 'every', every: '1h' }, { name: 'gated' }, { maxAttempts: 1 });
    now += 3_600_001;
    await s.tick();
    await flush();
    expect(runs).toBe(0);
    expect(s.history()[0].status).toBe('skipped');
    expect(s.list()[0].enabled).toBe(true);
    s.stop();
  });

  it('persists jobs across restarts and skips overdue one-shots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sched-'));
    let now = 30_000_000;
    let runs = 0;
    const a = new Scheduler(
      async () => {
        runs++;
        return { ok: true, detail: 'x' };
      },
      { dir, now: () => now }
    );
    a.add({ kind: 'every', every: '1h' }, { name: 'survivor' });
    a.add({ kind: 'at', at: now + 1000 }, { name: 'missed' });
    a.stop();
    now += 999_999;
    const b = new Scheduler(
      async () => {
        runs++;
        return { ok: true, detail: 'x' };
      },
      { dir, now: () => now }
    );
    expect(b.list()).toHaveLength(2);
    expect(runs).toBe(0); // overdue one-shot skipped, not replayed
    await flush();
    b.stop();
  });
});
