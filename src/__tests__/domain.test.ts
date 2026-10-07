import { describe, expect, it } from 'vitest';
import { parseAmount } from '../lib/format';
import { buildAmounts, budgetFor, compareCategories, inScope, lineId, proposeFromHistory } from '../domain/budget';
import { balanceOf, totals, yearTotals } from '../domain/calc';
import { inheritFromRecurring, occurrences, pending } from '../domain/recurring';
import { closingFromRows, reconcile } from '../domain/reconcile';
import { makeCategorizer } from '../domain/categorize';
import type { Account, BankRow, BudgetLine, Category, Recurring, Transaction } from '../domain/types';

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), type: 'expense', date: '2026-03-10', amount: 10, accountId: 'a',
  toAccountId: null, categoryId: null, note: '', source: 'manual', externalId: null, toExternalId: null,
  bankDescription: null, recurringId: null, propertyId: null, createdBy: null, needsReview: false, createdAt: '', ...p
});
const acc: Account = {
  id: 'a', name: 'Cuenta', icon: '', color: '', kind: 'bank', openingBalance: 1000, openingDate: '2026-01-01',
  position: 0, archived: false, importMapping: null
};

describe('parseAmount', () => {
  it.each([
    ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['-12,5', -12.5], ['12,50 €', 12.5],
    ['(12.50)', -12.5], ['12,50-', -12.5], ['1.234', 1234], ['0,99', 0.99], ['−3,00', -3], ['abc', NaN]
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toEqual(expected);
  });
});

describe('totals and balances', () => {
  const list = [
    tx({ type: 'income', amount: 2000 }), tx({ amount: 500 }),
    tx({ type: 'transfer', amount: 300, toAccountId: 'b' }), tx({ type: 'adjustment', amount: -5 })
  ];
  it('ignores transfers and adjustments in savings', () => {
    expect(totals(list)).toEqual({ income: 2000, expense: 500, savings: 1500 });
  });
  it('applies every movement to the account balance', () => {
    expect(balanceOf(acc, list)).toBe(1000 + 2000 - 500 - 300 - 5);
    expect(balanceOf({ ...acc, id: 'b', openingBalance: 0 }, list)).toBe(300);
    expect(balanceOf(acc, list, '2026-02-01')).toBe(1000);
  });
  it('groups a year by month', () => {
    expect(yearTotals(list, 2026)[2].savings).toBe(1500);
  });
});

describe('budget', () => {
  it('builds the 12 months from each input pattern', () => {
    expect(buildAmounts('monthly', 50)).toEqual(Array(12).fill(50));
    const annual = buildAmounts('annual', 1000);
    expect(annual.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 2);
    expect(annual[0]).toBe(83.33);
    expect(buildAmounts('months', 400, [5])).toEqual([0, 0, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0]);
    expect(buildAmounts('custom', 0, [], [1, 2, 3])).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  const lines: BudgetLine[] = [
    { id: '1', year: 2026, kind: 'income', categoryId: 'nomina', propertyId: null, pattern: 'monthly', base: 2000, amounts: buildAmounts('monthly', 2000) },
    { id: '2', year: 2026, kind: 'expense', categoryId: 'super', propertyId: null, pattern: 'monthly', base: 400, amounts: buildAmounts('monthly', 400) },
    { id: '3', year: 2026, kind: 'expense', categoryId: 'ibi', propertyId: null, pattern: 'months', base: 600, amounts: buildAmounts('months', 600, [5]) },
    { id: '4', year: 2026, kind: 'savings', categoryId: null, propertyId: null, pattern: 'monthly', base: 300, amounts: buildAmounts('monthly', 300) }
  ];

  it('derives savings from categories in category mode', () => {
    const years = [{ id: '2026', year: 2026, mode: 'category' as const }];
    expect(budgetFor(years, lines, 2026, 0, 0).savings).toBe(1600);
    expect(budgetFor(years, lines, 2026, 5, 5).savings).toBe(1000);
    expect(budgetFor(years, lines, 2026, 0, 11).expense).toBe(400 * 12 + 600);
  });
  it('uses only the savings line in savings mode', () => {
    const years = [{ id: '2026', year: 2026, mode: 'savings' as const }];
    const f = budgetFor(years, lines, 2026, 0, 2);
    expect(f.savings).toBe(900);
    expect(f.byCategory.size).toBe(0);
  });
  it('compares each category with its budget', () => {
    const years = [{ id: '2026', year: 2026, mode: 'category' as const }];
    const cats: Category[] = [{ id: 'super', kind: 'expense', name: 'Super', icon: '', color: '', position: 0, archived: false }];
    const rows = compareCategories([tx({ categoryId: 'super', amount: 450 }), tx({ categoryId: 'ocio', amount: 20 })],
      budgetFor(years, lines, 2026, 2, 2), cats, 'expense');
    const s = rows.find((r) => r.categoryId === 'super')!;
    expect(s.status).toBe('over');
    expect(s.remaining).toBe(-50);
    expect(rows.find((r) => r.categoryId === 'ocio')!.status).toBe('none');
  });
  it('proposes a budget from last year', () => {
    const cats: Category[] = [
      { id: 'super', kind: 'expense', name: 'Super', icon: '', color: '', position: 0, archived: false },
      { id: 'viaje', kind: 'expense', name: 'Viaje', icon: '', color: '', position: 1, archived: false }
    ];
    const hist = [
      ...Array.from({ length: 12 }, (_, m) => tx({ categoryId: 'super', amount: 301, date: `2025-${String(m + 1).padStart(2, '0')}-05` })),
      tx({ categoryId: 'viaje', amount: 1203, date: '2025-08-01' })
    ];
    const out = proposeFromHistory(hist, 2025, 2026, cats);
    expect(out.find((l) => l.categoryId === 'super')).toMatchObject({ pattern: 'monthly', base: 305 });
    expect(out.find((l) => l.categoryId === 'viaje')).toMatchObject({ pattern: 'annual', base: 1205 });
  });
});

describe('recurring', () => {
  const base: Recurring = {
    id: 'r', name: 'Hipoteca', type: 'expense', amount: 700, categoryId: null, accountId: null, propertyId: null, frequency: 'monthly',
    everyMonths: 1, day: 31, month: null, startDate: '2026-01-15', endDate: null, active: true
  };
  it('clamps the day to the month length and respects the start date', () => {
    const occ = occurrences(base, '2026-01-01', '2026-03-31').map((o) => o.dueDate);
    expect(occ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('supports every N months and yearly items', () => {
    expect(occurrences({ ...base, everyMonths: 3, day: 1, startDate: '2026-01-01' }, '2026-01-01', '2026-12-31').length).toBe(4);
    expect(occurrences({ ...base, frequency: 'yearly', month: 6, day: 20 }, '2026-01-01', '2027-12-31').map((o) => o.period)).toEqual(['2026', '2027']);
  });
  it('lists pending occurrences not yet logged', () => {
    const log = [{ id: 'r::2026-01', recurringId: 'r', period: '2026-01', status: 'done' as const, transactionId: null, at: '' }];
    expect(pending([base], log, '2026-03-01').map((o) => o.key)).toEqual(['r::2026-02']);
  });
});

describe('reconcile', () => {
  const rows: BankRow[] = [
    { date: '2026-03-11', amount: -45.2, description: 'COMPRA TARJ. MERCADONA VALENCIA', balance: 954.8, externalId: null },
    { date: '2026-03-12', amount: -9.99, description: 'NETFLIX.COM', balance: 944.81, externalId: null },
    { date: '2026-03-12', amount: 1500, description: 'NOMINA EMPRESA SL', balance: 2444.81, externalId: null }
  ];
  const manual = tx({ id: 'm1', amount: 45.2, date: '2026-03-10', note: 'Mercadona', categoryId: 'super' });
  const history = [tx({ id: 'h', amount: 9.99, date: '2026-02-12', bankDescription: 'NETFLIX.COM', categoryId: 'subs' })];

  it('matches hand-entered movements, suggests categories and flags new rows', () => {
    const out = reconcile(rows, 'a', [manual, { ...history[0], externalId: 'old' }], { categorizer: makeCategorizer([], history) });
    expect(out[0]).toMatchObject({ status: 'match', matchId: 'm1' });
    expect(out[1]).toMatchObject({ status: 'new', kind: 'expense', categoryId: 'subs' });
    expect(out[2]).toMatchObject({ status: 'new', kind: 'income' });
  });
  it('detects rows imported before', () => {
    const first = reconcile(rows, 'a', []);
    const imported = first.map((r) => tx({ amount: Math.abs(r.row.amount), date: r.row.date, externalId: r.key }));
    expect(reconcile(rows, 'a', imported).every((r) => r.status === 'duplicate')).toBe(true);
  });
  it('matches the incoming side of a transfer', () => {
    const t = tx({ id: 't', type: 'transfer', accountId: 'b', toAccountId: 'a', amount: 1500, date: '2026-03-12' });
    expect(reconcile(rows, 'a', [t])[2]).toMatchObject({ status: 'match', matchId: 't' });
  });
  it('finds the closing balance whatever the row order', () => {
    expect(closingFromRows([...rows].reverse())).toEqual({ date: '2026-03-12', amount: 2444.81 });
  });
});

describe('categorizer rules', () => {
  it('gives priority to explicit rules', () => {
    const c = makeCategorizer([{ id: '1', pattern: 'mercadona', categoryId: 'super', kind: null }], []);
    expect(c.suggest('COMPRA TARJ. MERCADONA 1234', 'expense')).toBe('super');
  });
});

describe('homes (cost centres)', () => {
  const years = [{ id: '2027', year: 2027, mode: 'category' as const }];
  const line = (categoryId: string, propertyId: string | null, base: number): BudgetLine => ({
    id: lineId(2027, 'expense', categoryId, propertyId), year: 2027, kind: 'expense', categoryId, propertyId,
    pattern: 'monthly', base, amounts: buildAmounts('monthly', base)
  });
  const lines = [line('luz', 'madrid', 60), line('luz', 'playa', 25), line('coche', null, 100)];

  it('keeps old ids for General lines and separates homes', () => {
    expect(lineId(2027, 'expense', 'luz', null)).toBe('2027:luz');
    expect(lineId(2027, 'expense', 'luz', 'playa')).toBe('2027:playa:luz');
    expect(lineId(2027, 'savings', null, 'playa')).toBe('2027:savings');
  });

  it('budgets per home and adds everything up', () => {
    expect(budgetFor(years, lines, 2027, 0, 0).expense).toBe(185);
    expect(budgetFor(years, lines, 2027, 0, 0, 'madrid').byCategory.get('luz')).toBe(60);
    expect(budgetFor(years, lines, 2027, 0, 0, 'playa').expense).toBe(25);
    expect(budgetFor(years, lines, 2027, 0, 0, null).expense).toBe(100);
    expect(budgetFor(years, lines, 2027, 0, 0, 'all').byCategory.get('luz')).toBe(85);
  });

  it('filters movements by home (old rows without a home are General)', () => {
    const old = { ...tx({}), propertyId: undefined } as unknown as Transaction;
    expect(inScope(old, null)).toBe(true);
    expect(inScope(tx({ propertyId: 'playa' }), null)).toBe(false);
    expect(inScope(tx({ propertyId: 'playa' }), 'playa')).toBe(true);
    expect(inScope(tx({ propertyId: 'playa' }), 'all')).toBe(true);
  });

  it('proposes a budget per home from its own movements', () => {
    const hist = [tx({ date: '2026-01-05', amount: 50, categoryId: 'luz', propertyId: 'playa' }), tx({ date: '2026-01-05', amount: 90, categoryId: 'luz' })];
    const out = proposeFromHistory(hist, 2026, 2027, [{ id: 'luz', kind: 'expense', name: 'Luz', icon: '⚡', color: '', position: 0, archived: false }], 'playa');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: '2027:playa:luz', propertyId: 'playa', base: 50 });
  });

  it('movements covered by a scheduled item take its home and category', () => {
    const r: Recurring = {
      id: 'luzplaya', name: 'Luz playa', type: 'expense', amount: 30, categoryId: 'luz', accountId: null, propertyId: 'playa',
      frequency: 'monthly', everyMonths: 1, day: 5, month: null, startDate: '2026-01-01', endDate: null, active: true
    };
    const t = tx({ id: 'b1' });
    const out = inheritFromRecurring([t, tx({ id: 'b2' })], [{ id: 'x', recurringId: 'luzplaya', period: '2026-03', status: 'done', transactionId: 'b1', at: '' }], [r]);
    expect(out).toEqual([{ ...t, recurringId: 'luzplaya', propertyId: 'playa', categoryId: 'luz' }]);
  });
});
