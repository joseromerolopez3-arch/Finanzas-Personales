import type { Account, BankRow, Kind, Transaction } from './types';
import { cents, round2 } from '../lib/format';
import { diffDays } from '../lib/dates';
import { hash } from '../lib/id';
import { balanceOf, effectOn, touches } from './calc';
import type { Categorizer } from './categorize';
import { normalizeLoose, similarity } from './text';

export type ReviewStatus = 'new' | 'match' | 'duplicate';

export interface ReviewRow {
  key: string;
  row: BankRow;
  status: ReviewStatus;
  /** Existing movement this bank row corresponds to (status = match). */
  matchId: string | null;
  kind: Kind;
  categoryId: string | null;
}

/**
 * Stable fingerprint of a bank row. Uses the bank's own id when there is one; otherwise
 * date + amount + description + position among identical rows, so re-importing an
 * overlapping period never duplicates movements.
 */
export function fingerprints(rows: BankRow[], accountId: string): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.externalId) return `x:${hash(`${accountId}|${r.externalId}`)}`;
    const base = `${accountId}|${r.date}|${cents(r.amount)}|${normalizeLoose(r.description)}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return `h:${hash(`${base}|${n}`)}`;
  });
}

/** Bank fingerprint stored on the side of the movement that touches this account. */
export const sideKey = (t: Transaction, accountId: string) =>
  t.type === 'transfer' && t.toAccountId === accountId && t.accountId !== accountId ? t.toExternalId : t.externalId;

export const isReconciled = (t: Transaction, accountId: string) => !!sideKey(t, accountId);

export interface ReconcileOptions {
  toleranceDays?: number;
  categorizer?: Categorizer;
}

/**
 * Classifies each bank row as already imported (duplicate), matching a movement that was
 * entered by hand (match) or new. Matching needs the same signed amount on the account and
 * a date within the tolerance; ties are broken by date distance and description similarity.
 */
export function reconcile(rows: BankRow[], accountId: string, txs: Transaction[], opts: ReconcileOptions = {}): ReviewRow[] {
  const tol = opts.toleranceDays ?? 4;
  const keys = fingerprints(rows, accountId);
  const ofAccount = txs.filter((t) => touches(t, accountId));
  const known = new Set(ofAccount.map((t) => sideKey(t, accountId)).filter(Boolean) as string[]);
  const free = ofAccount.filter((t) => !isReconciled(t, accountId));
  const used = new Set<string>();

  const order = rows.map((_, i) => i).sort((a, b) => rows[a].date.localeCompare(rows[b].date));
  const out: ReviewRow[] = new Array(rows.length);
  for (const i of order) {
    const row = rows[i];
    const key = keys[i];
    const kind: Kind = row.amount < 0 ? 'expense' : 'income';
    if (known.has(key)) {
      out[i] = { key, row, status: 'duplicate', matchId: null, kind, categoryId: null };
      continue;
    }
    const target = cents(row.amount);
    let best: Transaction | null = null;
    let bestScore = -Infinity;
    for (const t of free) {
      if (used.has(t.id) || cents(effectOn(t, accountId)) !== target) continue;
      const dd = Math.abs(diffDays(t.date, row.date));
      if (dd > tol) continue;
      const score = -dd + similarity(row.description, `${t.note} ${t.bankDescription ?? ''}`) * 2;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) {
      used.add(best.id);
      out[i] = { key, row, status: 'match', matchId: best.id, kind, categoryId: best.categoryId };
    } else {
      const categoryId = opts.categorizer?.suggest(row.description, kind) ?? null;
      out[i] = { key, row, status: 'new', matchId: null, kind, categoryId };
    }
  }
  return out;
}

/**
 * Closing balance reported by the bank rows themselves (when the file has a balance column).
 * Among the rows of the latest date, the last one is the row whose balance is not the
 * "previous balance" of any other row that day — this works whatever the file order is.
 */
export function closingFromRows(rows: BankRow[]): { date: string; amount: number } | null {
  const withBal = rows.filter((r) => r.balance != null);
  if (!withBal.length) return null;
  const last = withBal.reduce((m, r) => (r.date > m ? r.date : m), withBal[0].date);
  const day = withBal.filter((r) => r.date === last);
  const prev = new Set(day.map((r) => cents((r.balance as number) - r.amount)));
  const final = day.find((r) => !prev.has(cents(r.balance as number))) ?? day[0];
  return { date: last, amount: round2(final.balance as number) };
}

/** Difference between the bank balance and the app balance for that date (positive = app is short). */
export function balanceGap(acc: Account, txs: Transaction[], closing: { date: string; amount: number }): number {
  return round2(closing.amount - balanceOf(acc, txs, closing.date));
}
