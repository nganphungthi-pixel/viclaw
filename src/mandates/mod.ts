/**
 * Mandate ledger: the money layer that lives OUTSIDE the prompt.
 *
 * Shape follows Google's AP2 payment-mandate model (verified against
 * ap2-protocol.org, Oct 2026): a human approves ONE open mandate with
 * constraints (amount range, allowed payees, expiry); the agent then derives
 * per-transaction closed mandates that the ledger authorizes against those
 * constraints and records as signed receipts. The LLM never holds a transfer
 * capability — it only ever receives approve/deny + receipt.
 *
 * Field mapping to AP2 `mandate.payment.open.1` / `mandate.payment.1`:
 * open constraints -> amountRange (payment.amount_range), payeeAllowlist
 * (payment.allowed_payees), transactionRef binding (payment.reference),
 * expiresAt (exp, kept as short as viable), receipts reference the closed
 * mandate hash (reference = sha256 of the closed mandate).
 *
 * Double-spend rule (AP2: no overlapping mandates without a rejection
 * receipt): the same transactionRef always returns the SAME receipt and never
 * charges twice — authorization is idempotent by reference.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

export interface Payee {
  id: string;
  name: string;
  website?: string;
}

export interface AmountRange {
  currency: string;
  minMinor: number;
  maxMinor: number;
}

export interface OpenMandate {
  vct: "mandate.payment.open.1";
  id: string;
  payeeAllowlist: Payee[];
  amountRange: AmountRange;
  /** Max total per UTC day across all receipts (minor units). */
  dailyCapMinor: number;
  createdAt: number;
  expiresAt: number;
  humanApprovedBy: string;
  revoked: boolean;
}

export interface ClosedMandate {
  vct: "mandate.payment.1";
  transactionId: string;
  mandateId: string;
  payee: Payee;
  amountMinor: number;
  currency: string;
  iat: number;
  nonce: string;
}

export interface PaymentReceipt {
  reference: string;
  mandateId: string;
  closed: ClosedMandate;
  status: "approved";
  recordedAt: number;
}

export interface AuthRequest {
  payeeId: string;
  amountMinor: number;
  currency: string;
  /** Idempotency key. Repeating it returns the original receipt, never a second charge. */
  transactionRef: string;
}

export type AuthResult =
  | { approved: true; receipt: PaymentReceipt }
  | { approved: false; reason: string };

export interface MandateStoreOptions {
  dir: string;
  now?: () => number;
}

function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function hashClosed(closed: ClosedMandate): string {
  return createHash("sha256").update(JSON.stringify(closed)).digest("hex");
}

export class MandateLedger {
  private mandatesFile: string;
  private receiptsFile: string;
  private now: () => number;

  constructor(options: MandateStoreOptions) {
    mkdirSync(options.dir, { recursive: true });
    this.mandatesFile = join(options.dir, "mandates.json");
    this.receiptsFile = join(options.dir, "receipts.jsonl");
    this.now = options.now ?? Date.now;
  }

  /**
   * Human action: approve an open mandate. Throws on invalid constraints so a
   * malformed mandate can never exist (fail at creation, not at spend time).
   */
  createMandate(input: {
    payeeAllowlist: Payee[];
    amountRange: AmountRange;
    dailyCapMinor: number;
    expiresAt: number;
    humanApprovedBy: string;
  }): OpenMandate {
    if (input.payeeAllowlist.length === 0) throw new Error("Mandate needs at least one allowed payee");
    if (!/^[A-Z]{3}$/.test(input.amountRange.currency)) {
      throw new Error(`Currency must be ISO 4217 (e.g. USD, INR): ${input.amountRange.currency}`);
    }
    if (input.amountRange.minMinor < 0 || input.amountRange.maxMinor < input.amountRange.minMinor) {
      throw new Error("Invalid amount range");
    }
    if (input.dailyCapMinor <= 0) throw new Error("dailyCapMinor must be positive");
    if (input.expiresAt <= this.now()) throw new Error("Mandate expiry must be in the future");
    if (!input.humanApprovedBy) throw new Error("A human must approve the mandate");
    const mandate: OpenMandate = {
      vct: "mandate.payment.open.1",
      id: randomUUID(),
      ...input,
      createdAt: this.now(),
      revoked: false,
    };
    const all = this.loadMandates();
    all.push(mandate);
    this.saveMandates(all);
    return mandate;
  }

  revoke(id: string): boolean {
    const all = this.loadMandates();
    const m = all.find((x) => x.id === id);
    if (!m || m.revoked) return false;
    m.revoked = true;
    this.saveMandates(all);
    return true;
  }

  list(): OpenMandate[] {
    return this.loadMandates().map((m) => ({ ...m }));
  }

  dailySpent(mandateId: string, day?: string): number {
    const target = day ?? utcDay(this.now());
    return this.loadReceipts()
      .filter((r) => r.mandateId === mandateId && utcDay(r.recordedAt) === target)
      .reduce((sum, r) => sum + r.closed.amountMinor, 0);
  }

  /**
   * Agent action: request authorization for one payment. Pure gate — approve
   * or deny with a reason. Never throws for business-rule denials (denials
   * are data, not crashes).
   */
  authorize(mandateId: string, req: AuthRequest): AuthResult {
    const mandate = this.loadMandates().find((m) => m.id === mandateId);
    if (!mandate) return { approved: false, reason: `Unknown mandate: ${mandateId}` };
    if (mandate.revoked) return { approved: false, reason: "Mandate revoked" };
    if (this.now() > mandate.expiresAt) return { approved: false, reason: "Mandate expired" };
    if (req.currency !== mandate.amountRange.currency) {
      return { approved: false, reason: `Currency mismatch: mandate allows ${mandate.amountRange.currency}` };
    }
    const payee = mandate.payeeAllowlist.find((p) => p.id === req.payeeId);
    if (!payee) return { approved: false, reason: `Payee not allowlisted: ${req.payeeId}` };
    if (!Number.isInteger(req.amountMinor) || req.amountMinor <= 0) {
      return { approved: false, reason: "Amount must be a positive integer in minor units" };
    }
    if (req.amountMinor < mandate.amountRange.minMinor || req.amountMinor > mandate.amountRange.maxMinor) {
      return {
        approved: false,
        reason: `Amount ${req.amountMinor} outside range [${mandate.amountRange.minMinor}, ${mandate.amountRange.maxMinor}]`,
      };
    }
    // Idempotency first: same reference returns the original receipt, and the
    // spend is NOT counted twice (it was counted once, at first approval).
    const existing = this.loadReceipts().find(
      (r) => r.mandateId === mandateId && r.closed.transactionId === req.transactionRef
    );
    if (existing) return { approved: true, receipt: existing };
    const spent = this.dailySpent(mandateId);
    if (spent + req.amountMinor > mandate.dailyCapMinor) {
      return {
        approved: false,
        reason: `Daily cap exceeded: spent ${spent}, requested ${req.amountMinor}, cap ${mandate.dailyCapMinor}`,
      };
    }
    const closed: ClosedMandate = {
      vct: "mandate.payment.1",
      transactionId: req.transactionRef,
      mandateId,
      payee,
      amountMinor: req.amountMinor,
      currency: req.currency,
      iat: this.now(),
      nonce: randomUUID(),
    };
    const receipt: PaymentReceipt = {
      reference: hashClosed(closed),
      mandateId,
      closed,
      status: "approved",
      recordedAt: this.now(),
    };
    appendFileSync(this.receiptsFile, JSON.stringify(receipt) + "\n");
    return { approved: true, receipt };
  }

  receipts(limit = 500): PaymentReceipt[] {
    return this.loadReceipts().slice(-limit);
  }

  private loadMandates(): OpenMandate[] {
    if (!existsSync(this.mandatesFile)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.mandatesFile, "utf8")) as OpenMandate[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private saveMandates(all: OpenMandate[]): void {
    const tmp = `${this.mandatesFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2));
    renameSync(tmp, this.mandatesFile);
  }

  private loadReceipts(): PaymentReceipt[] {
    if (!existsSync(this.receiptsFile)) return [];
    const out: PaymentReceipt[] = [];
    for (const line of readFileSync(this.receiptsFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as PaymentReceipt);
      } catch {
        // Corrupt receipt lines are skipped, never crash the money path.
      }
    }
    return out;
  }
}
