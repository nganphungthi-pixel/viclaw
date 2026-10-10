/**
 * Mandate Ledger Tests (AP2-shaped money layer outside the prompt).
 *
 * Mirrors the dependency-free proof harness (.openclaw/tmp/proof4.mjs).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MandateLedger } from '../src/mandates/mod.js';

const DAY = 86_400_000;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mand-'));
  let now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const ledger = new MandateLedger({ dir, now: () => now });
  return { dir, ledger, advance: (ms: number) => { now += ms; } };
}

function mandate(ledger: MandateLedger, now: number) {
  return ledger.createMandate({
    payeeAllowlist: [{ id: 'exa', name: 'Exa', website: 'https://exa.ai' }],
    amountRange: { currency: 'USD', minMinor: 100, maxMinor: 500 },
    dailyCapMinor: 800,
    expiresAt: now + DAY,
    humanApprovedBy: 'operator-1',
  });
}

describe('MandateLedger creation', () => {
  it('rejects invalid mandates at creation', () => {
    const { ledger } = setup();
    const base = {
      payeeAllowlist: [{ id: 'p', name: 'P' }],
      amountRange: { currency: 'USD', minMinor: 1, maxMinor: 100 },
      dailyCapMinor: 100,
      expiresAt: Date.UTC(2026, 9, 11),
      humanApprovedBy: 'op',
    };
    expect(() => ledger.createMandate({ ...base, payeeAllowlist: [] })).toThrow();
    expect(() => ledger.createMandate({ ...base, amountRange: { currency: 'USDD', minMinor: 1, maxMinor: 100 } })).toThrow();
    expect(() => ledger.createMandate({ ...base, humanApprovedBy: '' })).toThrow();
  });
});

describe('MandateLedger authorization', () => {
  it('approves in-range spend with a hash-bound receipt', () => {
    const { ledger } = setup();
    const m = mandate(ledger, Date.UTC(2026, 9, 10, 12, 0, 0));
    const r = ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 300, currency: 'USD', transactionRef: 'tx-1' });
    expect(r.approved).toBe(true);
    if (!r.approved) return;
    expect(r.receipt.closed.vct).toBe('mandate.payment.1');
    expect(r.receipt.reference).toBe(createHash('sha256').update(JSON.stringify(r.receipt.closed)).digest('hex'));
  });

  it('denies unknown payees, out-of-range amounts, currency mismatch', () => {
    const { ledger } = setup();
    const m = mandate(ledger, Date.UTC(2026, 9, 10, 12, 0, 0));
    expect(ledger.authorize(m.id, { payeeId: 'evil', amountMinor: 300, currency: 'USD', transactionRef: 'a' }).approved).toBe(false);
    expect(ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 501, currency: 'USD', transactionRef: 'b' }).approved).toBe(false);
    expect(ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 300, currency: 'INR', transactionRef: 'c' }).approved).toBe(false);
    expect(ledger.authorize('nope', { payeeId: 'exa', amountMinor: 300, currency: 'USD', transactionRef: 'd' }).approved).toBe(false);
  });

  it('is idempotent by transactionRef (no double charge)', () => {
    const { ledger } = setup();
    const m = mandate(ledger, Date.UTC(2026, 9, 10, 12, 0, 0));
    const a = ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 300, currency: 'USD', transactionRef: 'tx-1' });
    const b = ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 300, currency: 'USD', transactionRef: 'tx-1' });
    expect(a.approved && b.approved).toBe(true);
    if (a.approved && b.approved) expect(b.receipt.reference).toBe(a.receipt.reference);
    expect(ledger.dailySpent(m.id)).toBe(300);
  });

  it('enforces the daily cap and resets next UTC day', () => {
    const { ledger, advance } = setup();
    const m = mandate(ledger, Date.UTC(2026, 9, 10, 12, 0, 0));
    expect(ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 300, currency: 'USD', transactionRef: 't1' }).approved).toBe(true);
    expect(ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 500, currency: 'USD', transactionRef: 't2' }).approved).toBe(true);
    const over = ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 100, currency: 'USD', transactionRef: 't3' });
    expect(over.approved).toBe(false);
    advance(DAY);
    expect(ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 500, currency: 'USD', transactionRef: 't4' }).approved).toBe(true);
  });

  it('denies expired and revoked mandates', () => {
    const { ledger, advance } = setup();
    const m = mandate(ledger, Date.UTC(2026, 9, 10, 12, 0, 0));
    advance(2 * DAY);
    expect(ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 100, currency: 'USD', transactionRef: 't' }).approved).toBe(false);
    expect(ledger.revoke(m.id)).toBe(true);
    expect(ledger.revoke(m.id)).toBe(false);
  });

  it('persists across restarts and skips corrupt receipt lines', () => {
    const { dir, ledger } = setup();
    const m = mandate(ledger, Date.UTC(2026, 9, 10, 12, 0, 0));
    ledger.authorize(m.id, { payeeId: 'exa', amountMinor: 200, currency: 'USD', transactionRef: 'u1' });
    appendFileSync(join(dir, 'receipts.jsonl'), 'CORRUPT{{{');
    const reloaded = new MandateLedger({ dir });
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.receipts()).toHaveLength(1);
    expect(reloaded.dailySpent(m.id)).toBeGreaterThan(0);
  });
});
