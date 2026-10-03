import type { BankRow, Kind, Recurring, RecurringLog, Rule, Transaction } from './types';
import { makeCategorizer } from './categorize';
import { reconcile } from './reconcile';
import { matchRecurring, pending } from './recurring';
import { prettify } from './text';
import { diffDays } from '../lib/dates';
import { cents, round2 } from '../lib/format';

/* ---------- Enable Banking payloads (only the fields we use) ---------- */

export interface EBTransaction {
  transaction_id?: string | null;
  entry_reference?: string | null;
  transaction_amount: { amount: string; currency?: string };
  credit_debit_indicator: 'CRDT' | 'DBIT';
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  bank_transaction_code?: { description?: string | null } | null;
}

export interface EBBalance {
  balance_amount: { amount: string; currency?: string };
  balance_type?: string | null;
  reference_date?: string | null;
  last_change_date_time?: string | null;
}

/** Only booked movements: pending card payments change id when they are booked. */
export function ebToBankRow(t: EBTransaction): BankRow | null {
  if (t.status && t.status !== 'BOOK') return null;
  const date = (t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10);
  const raw = Number(t.transaction_amount?.amount);
  if (!date || !Number.isFinite(raw) || raw === 0) return null;
  const amount = round2(Math.abs(raw) * (t.credit_debit_indicator === 'DBIT' ? -1 : 1));
  const counterparty = (t.credit_debit_indicator === 'DBIT' ? t.creditor?.name : t.debtor?.name)?.trim();
  const info = (t.remittance_information ?? []).map((s) => s.trim()).filter(Boolean);
  const parts = counterparty && !info.some((i) => i.toLowerCase().includes(counterparty.toLowerCase())) ? [counterparty, ...info] : info;
  const description = parts.join(' · ') || t.bank_transaction_code?.description?.trim() || 'Movimiento';
  return { date, amount, description, balance: null, externalId: t.transaction_id || t.entry_reference || null };
}

const BALANCE_PREFERENCE = ['ITBD', 'CLBD', 'XPCD', 'ITAV', 'CLAV', 'OPBD'];

/** Booked balance first: it is the one that matches booked movements. */
export function pickBalance(balances: EBBalance[], today: string): { amount: number; date: string } | null {
  if (!balances.length) return null;
  const rank = (b: EBBalance) => {
    const i = BALANCE_PREFERENCE.indexOf(b.balance_type ?? '');
    return i < 0 ? 99 : i;
  };
  const best = [...balances].sort((a, b) => rank(a) - rank(b))[0];
  const amount = Number(best.balance_amount?.amount);
  if (!Number.isFinite(amount)) return null;
  const date = (best.reference_date || best.last_change_date_time || today).slice(0, 10);
  return { amount: round2(amount), date };
}

/** Balance the account had just before `from`, given today's balance and the booked movements since then. */
export function openingFromBalance(balance: number, rows: BankRow[], from: string): number {
  return round2(balance - rows.filter((r) => r.date >= from).reduce((s, r) => s + r.amount, 0));
}

/* ---------- planning ---------- */

export interface SyncInput {
  accountId: string;
  rows: BankRow[];
}

export interface SyncData {
  transactions: Transaction[];
  rules: Rule[];
  recurring: Recurring[];
  recurringLog: RecurringLog[];
}

export interface SyncPlan {
  create: Transaction[];
  update: Transaction[];
  logs: RecurringLog[];
  matched: number;
  transfers: number;
}

interface Candidate { accountId: string; key: string; row: BankRow; kind: Kind; categoryId: string | null }

/**
 * Decides what to write after downloading bank movements for one or several accounts of a household:
 * - rows already imported are ignored;
 * - rows matching a movement entered by hand reconcile it (no duplicate);
 * - an outflow in one account and the same inflow in another become one transfer;
 * - the rest are created with the suggested category and flagged for review;
 * - due scheduled payments covered by these movements are marked as done.
 */
export function planBankSync(inputs: SyncInput[], data: SyncData, opts: { newId: () => string; now: string; today: string }): SyncPlan {
  const categorizer = makeCategorizer(data.rules, data.transactions);
  let working = [...data.transactions];
  const updated = new Map<string, Transaction>();
  const candidates: Candidate[] = [];

  for (const input of inputs) {
    const review = reconcile(input.rows, input.accountId, working, { categorizer });
    for (const r of review) {
      if (r.status === 'match' && r.matchId) {
        const t = updated.get(r.matchId) ?? working.find((x) => x.id === r.matchId)!;
        const inbound = t.type === 'transfer' && t.toAccountId === input.accountId && t.accountId !== input.accountId;
        const next = { ...t, ...(inbound ? { toExternalId: r.key } : { externalId: r.key }), bankDescription: t.bankDescription ?? r.row.description };
        updated.set(t.id, next);
        working = working.map((x) => (x.id === next.id ? next : x));
      } else if (r.status === 'new') {
        candidates.push({ accountId: input.accountId, key: r.key, row: r.row, kind: r.kind, categoryId: r.categoryId });
      }
    }
  }

  const create: Transaction[] = [];
  const base = (row: BankRow) => ({
    date: row.date, note: prettify(row.description), bankDescription: row.description, source: 'bank' as const,
    recurringId: null, createdBy: null, createdAt: opts.now
  });

  // Same amount leaving one of your accounts and entering another one: a transfer, not income + expense.
  const paired = new Set<string>();
  let transfers = 0;
  for (const out of candidates.filter((c) => c.row.amount < 0)) {
    let best: Candidate | null = null;
    for (const inc of candidates) {
      if (paired.has(inc.key) || inc.accountId === out.accountId || cents(inc.row.amount) !== -cents(out.row.amount)) continue;
      const dd = Math.abs(diffDays(inc.row.date, out.row.date));
      if (dd > 3) continue;
      if (!best || dd < Math.abs(diffDays(best.row.date, out.row.date))) best = inc;
    }
    if (!best) continue;
    paired.add(out.key).add(best.key);
    transfers++;
    create.push({
      ...base(out.row), id: opts.newId(), type: 'transfer', amount: round2(-out.row.amount), accountId: out.accountId,
      toAccountId: best.accountId, categoryId: null, externalId: out.key, toExternalId: best.key, needsReview: false
    });
  }

  for (const c of candidates) {
    if (paired.has(c.key)) continue;
    create.push({
      ...base(c.row), id: opts.newId(), type: c.kind, amount: round2(Math.abs(c.row.amount)), accountId: c.accountId,
      toAccountId: null, categoryId: c.categoryId, externalId: c.key, toExternalId: null, needsReview: true
    });
  }

  const update = [...updated.values()];
  const due = pending(data.recurring, data.recurringLog, opts.today);
  const logs = matchRecurring(due, [...create, ...update], opts.now);
  return { create, update, logs, matched: update.length, transfers };
}
