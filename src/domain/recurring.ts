import type { Recurring, RecurringLog, Transaction } from './types';
import { addMonths, diffDays, makeDate, parseYmd, todayStr } from '../lib/dates';
import { similarity } from './text';

export interface Occurrence {
  recurring: Recurring;
  period: string;
  dueDate: string;
  key: string;
}

export const occurrenceKey = (recurringId: string, period: string) => `${recurringId}::${period}`;

/** Every occurrence of a recurring item with due date in [from, to]. */
export function occurrences(r: Recurring, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const push = (period: string, dueDate: string) => {
    if (dueDate < from || dueDate > to || dueDate < r.startDate) return;
    if (r.endDate && dueDate > r.endDate) return;
    out.push({ recurring: r, period, dueDate, key: occurrenceKey(r.id, period) });
  };
  if (r.frequency === 'once') {
    push('once', r.startDate);
    return out;
  }
  const start = parseYmd(r.startDate);
  const end = parseYmd(to);
  if (r.frequency === 'yearly') {
    const m0 = (r.month ?? start.m0 + 1) - 1;
    for (let y = start.y; y <= end.y; y++) push(String(y), makeDate(y, m0, r.day));
    return out;
  }
  const step = Math.max(1, r.everyMonths || 1);
  let cur = { y: start.y, m0: start.m0 };
  for (let guard = 0; guard < 1200; guard++) {
    if (cur.y > end.y || (cur.y === end.y && cur.m0 > end.m0)) break;
    push(`${cur.y}-${String(cur.m0 + 1).padStart(2, '0')}`, makeDate(cur.y, cur.m0, r.day));
    cur = addMonths(cur.y, cur.m0, step);
  }
  return out;
}

/** Due (up to today) and not yet marked as done or skipped. */
export function pending(recurring: Recurring[], log: RecurringLog[], today = todayStr()): Occurrence[] {
  const done = new Set(log.map((l) => l.id));
  return recurring
    .filter((r) => r.active)
    .flatMap((r) => occurrences(r, '1970-01-01', today))
    .filter((o) => !done.has(o.key))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function upcoming(recurring: Recurring[], log: RecurringLog[], from: string, to: string): Occurrence[] {
  const done = new Set(log.map((l) => l.id));
  return recurring
    .filter((r) => r.active)
    .flatMap((r) => occurrences(r, from, to))
    .filter((o) => !done.has(o.key))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function describeFrequency(r: Recurring): string {
  if (r.frequency === 'once') return 'Una vez';
  if (r.frequency === 'yearly') {
    const month = new Date(2000, (r.month ?? 1) - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
    return `Cada año, el ${r.day} de ${month}`;
  }
  const every = r.everyMonths > 1 ? `Cada ${r.everyMonths} meses` : 'Cada mes';
  return `${every}, el día ${r.day}`;
}

/**
 * Marks as done the due scheduled items that a bank movement already covers: same type,
 * similar name, amount within 15 % (when known) and date within a week.
 */
export function matchRecurring(due: Occurrence[], txs: Transaction[], at: string): RecurringLog[] {
  const used = new Set<string>();
  const logs: RecurringLog[] = [];
  for (const o of due) {
    const r = o.recurring;
    const t = txs.find((x) => !used.has(x.id) && x.type === r.type && Math.abs(diffDays(x.date, o.dueDate)) <= 7
      && (!r.amount || Math.abs(x.amount - r.amount) <= Math.max(1, r.amount * 0.15))
      && similarity(r.name, `${x.note} ${x.bankDescription ?? ''}`) >= 0.5);
    if (!t) continue;
    used.add(t.id);
    logs.push({ id: o.key, recurringId: r.id, period: o.period, status: 'done', transactionId: t.id, at });
  }
  return logs;
}

/** Movements that a scheduled item covers inherit its home and category when they had none. */
export function inheritFromRecurring(txs: Transaction[], logs: RecurringLog[], recurring: Recurring[]): Transaction[] {
  const byTx = new Map(logs.filter((l) => l.transactionId).map((l) => [l.transactionId!, l.recurringId]));
  const rec = new Map(recurring.map((r) => [r.id, r]));
  const out: Transaction[] = [];
  for (const t of txs) {
    const r = rec.get(byTx.get(t.id) ?? '');
    if (r) out.push({ ...t, recurringId: t.recurringId ?? r.id, propertyId: t.propertyId ?? r.propertyId ?? null, categoryId: t.categoryId ?? r.categoryId });
  }
  return out;
}
