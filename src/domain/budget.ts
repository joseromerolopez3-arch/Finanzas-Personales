import type { BudgetLine, BudgetMode, BudgetPattern, BudgetYear, Category, Kind, Transaction } from './types';
import { round2 } from '../lib/format';
import { byCategory, inYear } from './calc';

export const zeros = () => Array.from({ length: 12 }, () => 0);

/**
 * Builds the 12 monthly amounts from what the person typed.
 * - monthly: `base` every selected month (all by default)
 * - annual: `base` is a yearly total spread evenly; cents left over go to December
 * - months: `base` only in the selected months (a one-off month, or e.g. June + December)
 * - custom: month-by-month values as given
 */
export function buildAmounts(pattern: BudgetPattern, base: number, months: number[] = [], custom: number[] = []): number[] {
  const out = zeros();
  switch (pattern) {
    case 'monthly':
      return out.map(() => round2(base));
    case 'annual': {
      const each = Math.floor((base / 12) * 100) / 100;
      for (let i = 0; i < 12; i++) out[i] = each;
      out[11] = round2(base - each * 11);
      return out;
    }
    case 'months':
      for (const m of months) if (m >= 0 && m < 12) out[m] = round2(base);
      return out;
    case 'custom':
      return out.map((_, i) => round2(custom[i] || 0));
  }
}

/** Selected months of a `months` line (non-zero amounts). */
export const activeMonths = (l: Pick<BudgetLine, 'amounts'>) =>
  l.amounts.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

export const lineTotal = (l: Pick<BudgetLine, 'amounts'>, from = 0, to = 11) =>
  round2(l.amounts.slice(from, to + 1).reduce((s, v) => s + (v || 0), 0));

/**
 * Which part of the budget to look at when the household has several homes:
 * 'all' = everything, null = General (not tied to a home), or a property id.
 */
export type Scope = 'all' | string | null;
export const inScope = (row: { propertyId?: string | null }, scope: Scope) => scope === 'all' || (row.propertyId ?? null) === scope;

export function modeOf(years: BudgetYear[], year: number): BudgetMode | null {
  return years.find((y) => y.year === year)?.mode ?? null;
}

export interface BudgetFigures {
  mode: BudgetMode | null;
  income: number;
  expense: number;
  savings: number;
  /** Budget per category (category mode only). */
  byCategory: Map<string, number>;
  hasBudget: boolean;
  /** Category mode: budgeted income − expenses (what the categories add up to). */
  fromCategories: number;
  /** A savings target rules: always in savings mode; in category mode when the year has one (the categories must add up to it). */
  targetRules: boolean;
}

/** Budget for a range of months (inclusive, 0-based) of a year. The savings target is global (it ignores `scope`). */
export function budgetFor(years: BudgetYear[], lines: BudgetLine[], year: number, from: number, to: number, scope: Scope = 'all'): BudgetFigures {
  const mode = modeOf(years, year);
  const out: BudgetFigures = { mode, income: 0, expense: 0, savings: 0, byCategory: new Map(), hasBudget: false, fromCategories: 0, targetRules: false };
  if (!mode) return out;
  const ofYear = lines.filter((l) => l.year === year);
  if (mode === 'savings') {
    const l = ofYear.find((x) => x.kind === 'savings');
    out.savings = l ? lineTotal(l, from, to) : 0;
    out.hasBudget = !!l && l.amounts.some(Boolean);
    out.targetRules = true;
    return out;
  }
  for (const l of ofYear) {
    if (l.kind === 'savings' || !l.categoryId || !inScope(l, scope)) continue;
    const v = lineTotal(l, from, to);
    if (l.kind === 'income') out.income += v; else out.expense += v;
    out.byCategory.set(l.categoryId, round2((out.byCategory.get(l.categoryId) || 0) + v));
    if (l.amounts.some(Boolean)) out.hasBudget = true;
  }
  out.income = round2(out.income);
  out.expense = round2(out.expense);
  out.fromCategories = round2(out.income - out.expense);
  // With a savings target in category mode, the target rules (the categories should add up to it).
  const target = scope === 'all' ? ofYear.find((x) => x.kind === 'savings' && x.amounts.some(Boolean)) : undefined;
  out.targetRules = !!target;
  out.savings = target ? lineTotal(target, from, to) : out.fromCategories;
  if (target) out.hasBudget = true;
  return out;
}

/** Monthly savings the categories of a year add up to (budgeted income − expenses), for every home. */
export function savingsFromCategories(lines: BudgetLine[], year: number): number[] {
  const out = zeros();
  for (const l of lines) {
    if (l.year !== year || l.kind === 'savings' || !l.categoryId) continue;
    l.amounts.forEach((v, i) => { out[i] += l.kind === 'income' ? v || 0 : -(v || 0); });
  }
  return out.map(round2);
}

/** Monthly budgeted savings for the 12 months of a year. */
export function monthlySavingsBudget(years: BudgetYear[], lines: BudgetLine[], year: number): number[] {
  return zeros().map((_, m) => budgetFor(years, lines, year, m, m).savings);
}

export type Status = 'ok' | 'warn' | 'over' | 'none';

export interface CategoryComparison {
  categoryId: string;
  kind: Kind;
  actual: number;
  budget: number;
  /** Remaining budget (negative when exceeded) — for incomes, what is still expected. */
  remaining: number;
  ratio: number;
  status: Status;
}

/**
 * Actual vs budget per category. For expenses, going over is bad; for incomes, falling short is.
 * `elapsed` (0..1) is the share of the period already gone: an income still short mid-period is only pending.
 */
export function compareCategories(
  txs: Transaction[], budget: BudgetFigures, categories: Category[], kind: Kind, elapsed = 1
): CategoryComparison[] {
  const actual = byCategory(txs, kind);
  const ids = new Set<string>();
  for (const c of categories) if (c.kind === kind && (budget.byCategory.has(c.id) || actual.has(c.id))) ids.add(c.id);
  for (const id of actual.keys()) ids.add(id);
  const rows: CategoryComparison[] = [];
  for (const id of ids) {
    const a = actual.get(id) || 0;
    const b = budget.byCategory.get(id) || 0;
    if (!a && !b) continue;
    const ratio = b ? a / b : a ? Infinity : 0;
    let status: Status = 'none';
    if (b) {
      if (kind === 'expense') status = ratio > 1.0001 ? 'over' : ratio >= 0.9 ? 'warn' : 'ok';
      else status = ratio >= 0.9999 ? 'ok' : elapsed >= 1 ? 'over' : 'warn';
    }
    rows.push({ categoryId: id, kind, actual: a, budget: b, remaining: round2(b - a), ratio, status });
  }
  return rows.sort((x, y) => Math.max(y.budget, y.actual) - Math.max(x.budget, x.actual));
}

/**
 * Proposes a budget from a previous year's actual figures: the monthly average per category,
 * rounded up to 5 €. Categories with irregular spending (less than 4 months) become an annual total.
 */
export function proposeFromHistory(txs: Transaction[], fromYear: number, toYear: number, categories: Category[], propertyId: string | null = null): BudgetLine[] {
  const ofYear = txs.filter((t) => inYear(t, fromYear) && inScope(t, propertyId));
  const out: BudgetLine[] = [];
  for (const c of categories) {
    if (c.archived) continue;
    const perMonth = zeros();
    for (const t of ofYear) if (t.type === c.kind && t.categoryId === c.id) perMonth[Number(t.date.slice(5, 7)) - 1] += t.amount;
    const total = perMonth.reduce((s, v) => s + v, 0);
    if (total <= 0) continue;
    const monthsWithData = perMonth.filter((v) => v > 0).length;
    const regular = monthsWithData >= 4;
    const base = regular ? Math.ceil(total / 12 / 5) * 5 : Math.ceil(total / 5) * 5;
    const pattern: BudgetPattern = regular ? 'monthly' : 'annual';
    out.push({
      id: lineId(toYear, c.kind, c.id, propertyId), year: toYear, kind: c.kind, categoryId: c.id, propertyId, pattern, base,
      amounts: buildAmounts(pattern, base)
    });
  }
  return out;
}

export const lineId = (year: number, kind: BudgetLine['kind'], categoryId: string | null, propertyId: string | null = null) =>
  kind === 'savings' ? `${year}:savings` : propertyId ? `${year}:${propertyId}:${categoryId}` : `${year}:${categoryId}`;
