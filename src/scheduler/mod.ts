/**
 * Scheduler + job ledger: unattended runs ("khud chalna").
 *
 * Design follows the proven shape (OpenClaw automations, Vixie cron):
 * schedule kinds `at` / `every` / `cron`, persistent jobs, run ledger,
 * exponential retry backoff, per-run timeouts, skipped-vs-error tracking,
 * one-shot auto-delete. Deliberate differences: file-based store (no SQLite
 * dependency) and an injected runner — the scheduler never imports the agent
 * loop, so this module is dependency-free and runs anywhere Node runs.
 *
 * Unattended-run safety (enforced here, not in prompts):
 * - A run that throws is retried with backoff 30s, 1m, 5m, 15m, 60m, then
 *   parked as `error` (never infinite retry).
 * - A run exceeding `timeoutMs` is abandoned and recorded as `timeout`.
 * - Overdue jobs after a restart are recorded `skipped`, not replayed blindly.
 * - `maxConcurrentRuns` caps parallel execution.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ScheduleKind = "at" | "every" | "cron";

export interface AtSchedule {
  kind: "at";
  /** ISO timestamp or epoch ms. */
  at: string | number;
  keepAfterRun?: boolean;
}

export interface EverySchedule {
  kind: "every";
  /** Interval like "10m", "1h", "1d" (also accepts raw ms). */
  every: string | number;
}

export interface CronSchedule {
  kind: "cron";
  /** 5-field cron `m h dom mon dow` (UTC). DOM+DOW use OR logic (Vixie). */
  cron: string;
}

export type Schedule = AtSchedule | EverySchedule | CronSchedule;

export interface JobPayload {
  /** Human label shown in history. */
  name: string;
  /** What to run: prompt handed to the runner, or argv executed by it. */
  prompt?: string;
  argv?: string[];
}

export interface Job {
  id: string;
  enabled: boolean;
  schedule: Schedule;
  payload: JobPayload;
  timeoutMs: number;
  maxAttempts: number;
  createdAt: number;
  nextRunMs: number | null;
  lastStatus?: RunStatus;
  lastRunAt?: number;
  consecutiveErrors: number;
}

export type RunStatus = "ok" | "error" | "timeout" | "skipped";

export interface RunRecord {
  runId: string;
  jobId: string;
  jobName: string;
  startedAt: number;
  finishedAt: number;
  status: RunStatus;
  detail: string;
  attempt: number;
}

export interface SchedulerOptions {
  dir: string;
  maxConcurrentRuns?: number;
  tickMs?: number;
  backoffMs?: number[];
  now?: () => number;
}

export type Runner = (job: Job) => Promise<{ ok: boolean; detail: string }>;
export type Preflight = (job: Job) => Promise<boolean>;

const DEFAULT_BACKOFF_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000];
const MAX_HISTORY = 500;

/** Parse "500ms", "10s", "20m", "1h", "1d", "1w" (or raw ms) to milliseconds. */
export function parseDuration(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new Error(`Invalid duration: ${input}`);
    return Math.floor(input);
  }
  const m = /^\s*(\d+)\s*(ms|s|m|h|d|w)?\s*$/i.exec(input);
  if (!m) throw new Error(`Invalid duration: ${JSON.stringify(input)} (try "10m", "1h", "1d")`);
  const n = parseInt(m[1], 10);
  const unit = (m[2] || "ms").toLowerCase();
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return n * mult[unit];
}

interface CronField {
  min: number;
  max: number;
  values: Set<number>;
}

function parseCronField(text: string, min: number, max: number): CronField {
  const values = new Set<number>();
  const add = (v: number) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Cron field out of range: ${text}`);
    values.add(v);
  };
  for (const part of text.split(",")) {
    const stepSplit = part.split("/");
    if (stepSplit.length > 2) throw new Error(`Invalid cron part: ${part}`);
    const step = stepSplit.length === 2 ? parseInt(stepSplit[1], 10) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);
    const range = stepSplit[0];
    let from = min;
    let to = max;
    if (range === "*") {
      // whole range
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map((x) => parseInt(x, 10));
      from = a;
      to = b;
    } else if (range.length > 0) {
      from = parseInt(range, 10);
      to = stepSplit.length === 2 ? max : from;
    } else {
      throw new Error(`Invalid cron part: ${part}`);
    }
    for (let v = from; v <= to; v += step) add(v);
  }
  return { min, max, values };
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron needs 5 fields (m h dom mon dow), got ${parts.length}: ${expr}`);
  const [minute, hour, dom, month, dowRaw] = parts;
  // Accept 7 (Sunday) as Sunday.
  const dow = dowRaw.replace(/(^|[,/-])7(?=$|[,/-])/g, "$10");
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dom: parseCronField(dom, 1, 31),
    month: parseCronField(month, 1, 12),
    dow: parseCronField(dow, 0, 6),
  };
}

/** Next UTC ms strictly after `fromMs` matching the expression. */
export function nextCronRun(expr: string, fromMs: number): number {
  const c = parseCron(expr);
  // Step minute by minute; a full leap-year scan is the absolute ceiling.
  let t = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  const guard = t + 366 * 24 * 60 * 60_000;
  while (t <= guard) {
    const d = new Date(t);
    const domMatch = c.dom.values.has(d.getUTCDate());
    const dowMatch = c.dow.values.has(d.getUTCDay());
    // Vixie OR: when both DOM and DOW are restricted, either may match.
    const domRestricted = c.dom.values.size < 31;
    const dowRestricted = c.dow.values.size < 7;
    const dayOk = domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch;
    if (
      dayOk &&
      c.minute.values.has(d.getUTCMinutes()) &&
      c.hour.values.has(d.getUTCHours()) &&
      c.month.values.has(d.getUTCMonth() + 1)
    ) {
      return t;
    }
    t += 60_000;
  }
  throw new Error(`No cron occurrence within a year: ${expr}`);
}

export function computeNextRun(schedule: Schedule, fromMs: number): number | null {
  if (schedule.kind === "at") {
    const at = typeof schedule.at === "number" ? schedule.at : Date.parse(schedule.at);
    if (!Number.isFinite(at)) throw new Error(`Invalid 'at' timestamp: ${schedule.at}`);
    return at > fromMs ? at : null;
  }
  if (schedule.kind === "every") {
    return fromMs + parseDuration(schedule.every);
  }
  return nextCronRun(schedule.cron, fromMs);
}

export class JobStore {
  private file: string;
  private ledgerFile: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "jobs.json");
    this.ledgerFile = join(dir, "runs.jsonl");
  }

  load(): Job[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Job[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  save(jobs: Job[]): void {
    // Atomic write: crash mid-save must not corrupt the schedule.
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(jobs, null, 2));
    renameSync(tmp, this.file);
  }

  appendRun(record: RunRecord): void {
    appendFileSync(this.ledgerFile, JSON.stringify(record) + "\n");
  }

  readLedger(limit = MAX_HISTORY): RunRecord[] {
    if (!existsSync(this.ledgerFile)) return [];
    const lines = readFileSync(this.ledgerFile, "utf8").split("\n").filter((l) => l.trim().length > 0);
    const out: RunRecord[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as RunRecord);
      } catch {
        // Skip corrupt ledger lines, never crash the scheduler on history.
      }
    }
    return out;
  }
}

export class Scheduler {
  private jobs: Job[] = [];
  private store: JobStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = 0;
  private maxConcurrentRuns: number;
  private tickMs: number;
  private backoffMs: number[];
  private now: () => number;
  private runner: Runner;
  private preflight?: Preflight;

  constructor(runner: Runner, options: SchedulerOptions) {
    this.runner = runner;
    this.store = new JobStore(options.dir);
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 4;
    this.tickMs = options.tickMs ?? 1000;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.now = options.now ?? Date.now;
    this.jobs = this.store.load();
    // Restart policy: overdue one-shots are skipped, recurring jobs resume at
    // their next occurrence — never a blind replay burst after downtime.
    for (const job of this.jobs) {
      if (!job.enabled) continue;
      if (job.nextRunMs !== null && job.nextRunMs <= this.now()) {
        if (job.schedule.kind === "at") {
          job.nextRunMs = null;
          job.lastStatus = "skipped";
          job.lastRunAt = this.now();
          this.store.appendRun({
            runId: randomUUID(),
            jobId: job.id,
            jobName: job.payload.name,
            startedAt: this.now(),
            finishedAt: this.now(),
            status: "skipped",
            detail: "Overdue at startup; one-shot not replayed",
            attempt: 1,
          });
        } else {
          job.nextRunMs = computeNextRun(job.schedule, this.now());
        }
      }
    }
    this.store.save(this.jobs);
  }

  add(schedule: Schedule, payload: JobPayload, opts?: { timeoutMs?: number; maxAttempts?: number; enabled?: boolean }): Job {
    // Validate eagerly so a bad cron/duration fails here, not at 3 AM.
    computeNextRun(schedule, this.now());
    const job: Job = {
      id: randomUUID(),
      enabled: opts?.enabled ?? true,
      schedule,
      payload,
      timeoutMs: opts?.timeoutMs ?? 600_000,
      maxAttempts: opts?.maxAttempts ?? this.backoffMs.length + 1,
      createdAt: this.now(),
      nextRunMs: computeNextRun(schedule, this.now()),
      consecutiveErrors: 0,
    };
    this.jobs.push(job);
    this.store.save(this.jobs);
    return job;
  }

  remove(id: string): boolean {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    if (this.jobs.length !== before) {
      this.store.save(this.jobs);
      return true;
    }
    return false;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return false;
    job.enabled = enabled;
    if (enabled && job.nextRunMs === null) job.nextRunMs = computeNextRun(job.schedule, this.now());
    this.store.save(this.jobs);
    return true;
  }

  list(): Job[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  history(limit?: number): RunRecord[] {
    return this.store.readLedger(limit);
  }

  setPreflight(preflight: Preflight): void {
    this.preflight = preflight;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        // The tick must never die: per-run errors are recorded on the job.
      });
    }, this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Fire one job now, outside its schedule (operator override). */
  async runNow(id: string): Promise<RunRecord | null> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || !job.enabled) return null;
    return this.execute(job);
  }

  async tick(): Promise<void> {
    const now = this.now();
    for (const job of this.jobs) {
      if (!job.enabled || job.nextRunMs === null || job.nextRunMs > now) continue;
      if (this.running >= this.maxConcurrentRuns) continue;
      // Fire and track; the tick loop itself never blocks on a run.
      void this.execute(job).catch(() => undefined);
    }
  }

  private async execute(job: Job): Promise<RunRecord> {
    // The attempt number derives from the persisted error count, so retries
    // across ticks count down maxAttempts instead of resetting it. (An early
    // draft passed a literal 1 on every tick — retries never parked. Caught
    // by the dependency-free proof harness.)
    const attempt = job.consecutiveErrors + 1;
    this.running++;
    const startedAt = this.now();
    const record: RunRecord = {
      runId: randomUUID(),
      jobId: job.id,
      jobName: job.payload.name,
      startedAt,
      finishedAt: startedAt,
      status: "error",
      detail: "",
      attempt,
    };
    try {
      if (this.preflight && !(await this.preflight(job))) {
        record.status = "skipped";
        record.detail = "Preflight check failed (e.g. local model unreachable); will retry on next occurrence";
        // Skips do not consume error budget and do not shift backoff.
        job.nextRunMs = this.advance(job);
        return this.finish(job, record);
      }
      const outcome = await this.withTimeout(job);
      if (outcome.ok) {
        record.status = "ok";
        record.detail = outcome.detail;
        job.consecutiveErrors = 0;
        if (job.schedule.kind === "at" && !job.schedule.keepAfterRun) {
          this.jobs = this.jobs.filter((j) => j.id !== job.id);
        } else {
          job.nextRunMs = this.advance(job);
        }
      } else {
        throw new Error(outcome.detail || "Runner reported failure");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timed out after/.test(message)) {
        record.status = "timeout";
      } else {
        record.status = "error";
      }
      record.detail = message;
      job.consecutiveErrors++;
      const retriesLeft = job.maxAttempts - attempt;
      if (retriesLeft > 0) {
        const wait = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)];
        job.nextRunMs = this.now() + wait;
      } else {
        // Parked, not deleted: the operator inspects, fixes, re-enables.
        job.nextRunMs = null;
        job.enabled = false;
      }
    } finally {
      this.running--;
    }
    return this.finish(job, record);
  }

  private finish(job: Job, record: RunRecord): RunRecord {
    record.finishedAt = this.now();
    job.lastStatus = record.status;
    job.lastRunAt = record.finishedAt;
    this.store.appendRun(record);
    this.store.save(this.jobs);
    return record;
  }

  private advance(job: Job): number | null {
    if (job.schedule.kind === "every") {
      // Anchor on now (not last fire) so slow runs cannot stack up.
      return computeNextRun(job.schedule, this.now());
    }
    return computeNextRun(job.schedule, this.now());
  }

  private async withTimeout(job: Job): Promise<{ ok: boolean; detail: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.runner(job),
        new Promise<{ ok: boolean; detail: string }>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Run timed out after ${job.timeoutMs}ms`)), job.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
