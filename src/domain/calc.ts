import type { Account, Kind, Transaction } from './types';
import { round2 } from '../lib/format';

export interface Totals { income: number; expense: number; savings: number }

export const inMonth = (t: Transaction, y: number, m0: number) =>
  Number(t.date.slice(0, 4)) === y && Number(t.date.slice(5, 7)) === m0 + 1;
export const inYear = (t: Transaction, y: number) => Number(t.date.slice(0, 4)) === y;
/** Months are inclusive, 0-based. */
export const inMonthRange = (t: Transaction, y: number, from: number, to: number) => {
  const m = Number(t.date.slice(5, 7)) - 1;
  return inYear(t, y) && m >= from && m <= to;
};

/** Transfers and balance adjustments move money between/within accounts: never income or expense. */
export function totals(list: Transaction[]): Totals {
  let income = 0, expense = 0;
  for (const t of list) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income: round2(income), expense: round2(expense), savings: round2(income - expense) };
}

export function byCategory(list: Transaction[], kind: Kind): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of list) {
    if (t.type !== kind) continue;
    const k = t.categoryId || '';
    out.set(k, round2((out.get(k) || 0) + t.amount));
  }
  return out;
}

/** Signed effect of a movement on one account. */
export function effectOn(t: Transaction, accountId: string): number {
  switch (t.type) {
    case 'income': return t.accountId === accountId ? t.amount : 0;
    case 'expense': return t.accountId === accountId ? -t.amount : 0;
    case 'adjustment': return t.accountId === accountId ? t.amount : 0;
    case 'transfer':
      if (t.accountId === accountId) return -t.amount;
      if (t.toAccountId === accountId) return t.amount;
      return 0;
  }
}

export const touches = (t: Transaction, accountId: string) =>
  t.accountId === accountId || (t.type === 'transfer' && t.toAccountId === accountId);

/** Balance of an account at the end of `date` (inclusive), or today's if no date. */
export function balanceOf(acc: Account, txs: Transaction[], date?: string): number {
  let bal = !date || acc.openingDate <= date ? acc.openingBalance : 0;
  for (const t of txs) {
    if (date && t.date > date) continue;
    bal += effectOn(t, acc.id);
  }
  return round2(bal);
}

export function netWorth(accounts: Account[], txs: Transaction[], date?: string): number {
  return round2(accounts.reduce((s, a) => s + balanceOf(a, txs, date), 0));
}

/** Monthly totals for a whole year, January..December. */
export function yearTotals(txs: Transaction[], y: number): Totals[] {
  const out: Totals[] = Array.from({ length: 12 }, () => ({ income: 0, expense: 0, savings: 0 }));
  for (const t of txs) {
    if (!inYear(t, y)) continue;
    const m = Number(t.date.slice(5, 7)) - 1;
    if (t.type === 'income') out[m].income += t.amount;
    else if (t.type === 'expense') out[m].expense += t.amount;
  }
  for (const r of out) {
    r.income = round2(r.income); r.expense = round2(r.expense); r.savings = round2(r.income - r.expense);
  }
  return out;
}

export const sumTotals = (list: Totals[]): Totals => {
  const income = round2(list.reduce((s, t) => s + t.income, 0));
  const expense = round2(list.reduce((s, t) => s + t.expense, 0));
  return { income, expense, savings: round2(income - expense) };
};
