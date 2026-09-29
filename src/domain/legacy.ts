import type { Account, BudgetLine, BudgetYear, Category, Recurring, RecurringLog, Settings, Snapshot, Transaction } from './types';
import { defaultAccounts, defaultCategories, defaultSettings } from './defaults';
import { todayStr, ymd } from '../lib/dates';
import { round2 } from '../lib/format';

/* Shapes stored by the first version of the app (Supabase `kv_store`, one JSON value per key). */
interface LegacyCat { id: string; label: string; icon: string; color: string }
interface LegacyTx {
  id: string; type: 'income' | 'expense' | 'transfer' | 'opening'; amount: number; date: string; note?: string;
  categoryId?: string | null; accountId?: string | null; fromAccountId?: string; toAccountId?: string;
}
interface LegacyReminder { id: string; kind: 'income' | 'expense'; label: string; recurrence: 'once' | 'monthly'; date?: string; day?: number; createdAt?: string }
export interface LegacyData {
  transactions?: LegacyTx[];
  categories?: { expense?: LegacyCat[]; income?: LegacyCat[] };
  accounts?: LegacyCat[];
  goals?: Record<string, number>;
  startingBalances?: Record<string, number>;
  profile?: { name?: string; email?: string; startMonth?: string } | null;
  reminders?: LegacyReminder[];
  reminderCompletions?: Record<string, boolean>;
}

/** Converts the first version's data into the new model. Pure and idempotent (ids are preserved). */
export function convertLegacy(data: LegacyData): Snapshot {
  const now = new Date().toISOString();
  const startMonth = data.profile?.startMonth || todayStr().slice(0, 7);
  const fallbackOpening = `${startMonth}-01`;
  const legacyTxs = data.transactions ?? [];

  const accounts: Account[] = (data.accounts ?? []).map((a, position) => {
    const openings = legacyTxs.filter((t) => t.type === 'opening' && t.accountId === a.id);
    const opening = openings.reduce((s, t) => s + t.amount, 0) + (data.startingBalances?.[a.id] ?? 0);
    const openingDate = openings.map((t) => t.date).sort()[0] ?? fallbackOpening;
    return {
      id: a.id, name: a.label, icon: a.icon, color: a.color, kind: guessKind(a.label), openingBalance: round2(opening),
      openingDate, position, archived: false, importMapping: null
    };
  });

  const cat = (kind: 'income' | 'expense') => (c: LegacyCat, position: number): Category =>
    ({ id: c.id, kind, name: c.label, icon: c.icon, color: c.color, position, archived: false });
  const categories: Category[] = [
    ...(data.categories?.expense ?? []).map(cat('expense')),
    ...(data.categories?.income ?? []).map(cat('income'))
  ];

  const firstAccount = accounts[0]?.id ?? 'sincuenta';
  const transactions: Transaction[] = legacyTxs
    .filter((t) => t.type !== 'opening' && t.amount > 0)
    .map((t) => {
      const base = {
        id: t.id, date: t.date, amount: round2(t.amount), note: t.note ?? '', source: 'manual' as const,
        externalId: null, toExternalId: null, bankDescription: null, recurringId: null, createdBy: null, createdAt: now
      };
      if (t.type === 'transfer') {
        return { ...base, type: 'transfer' as const, accountId: t.fromAccountId || firstAccount, toAccountId: t.toAccountId ?? null, categoryId: null };
      }
      return { ...base, type: t.type as 'income' | 'expense', accountId: t.accountId || firstAccount, toAccountId: null, categoryId: t.categoryId || null };
    });

  // Monthly savings goals become a "savings" budget for each year that had any.
  const budgetYears: BudgetYear[] = [];
  const budgetLines: BudgetLine[] = [];
  const goalsByYear = new Map<number, number[]>();
  for (const [key, value] of Object.entries(data.goals ?? {})) {
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1;
    if (!y || m < 0 || m > 11 || !value) continue;
    const arr = goalsByYear.get(y) ?? Array.from({ length: 12 }, () => 0);
    arr[m] = round2(value);
    goalsByYear.set(y, arr);
  }
  for (const [year, amounts] of goalsByYear) {
    budgetYears.push({ id: String(year), year, mode: 'savings' });
    const distinct = new Set(amounts.filter(Boolean));
    const allMonths = amounts.every(Boolean);
    budgetLines.push({
      id: `${year}:savings`, year, kind: 'savings', categoryId: null,
      pattern: allMonths && distinct.size === 1 ? 'monthly' : 'custom',
      base: allMonths && distinct.size === 1 ? amounts[0] : 0, amounts
    });
  }

  const recurring: Recurring[] = (data.reminders ?? []).map((r) => {
    const created = r.createdAt ? ymd(new Date(r.createdAt)) : todayStr();
    const base = {
      id: r.id, name: r.label, type: r.kind, amount: null, categoryId: null, accountId: null,
      everyMonths: 1, month: null, endDate: null, active: true
    };
    if (r.recurrence === 'once') return { ...base, frequency: 'once' as const, day: Number((r.date ?? created).slice(8, 10)), startDate: r.date ?? created };
    // The first version generated occurrences from the first day of the creation month.
    return { ...base, frequency: 'monthly' as const, day: r.day ?? 1, startDate: `${created.slice(0, 7)}-01` };
  });
  const recurringLog: RecurringLog[] = Object.entries(data.reminderCompletions ?? {})
    .filter(([, v]) => v)
    .map(([key]) => {
      const [rid, month] = key.split('::');
      const period = month ?? 'once';
      return { id: `${rid}::${period}`, recurringId: rid, period, status: 'done' as const, transactionId: null, at: now };
    });

  const settings: Settings = {
    ...defaultSettings(data.profile?.name ?? ''),
    startMonth,
    onboarded: !!data.profile,
    legacyImported: true
  };

  return {
    accounts: accounts.length ? accounts : defaultAccounts(fallbackOpening),
    categories: categories.length ? categories : defaultCategories(),
    transactions, budgetYears, budgetLines, recurring, recurringLog, rules: [], settings: [settings]
  };
}

function guessKind(label: string): Account['kind'] {
  const l = label.toLowerCase();
  if (/efectivo|cash|cartera/.test(l)) return 'cash';
  if (/ahorro|hucha|dep[oó]sito/.test(l)) return 'savings';
  if (/tarjeta|cr[eé]dito/.test(l)) return 'card';
  if (/inversi[oó]n|fondo|broker|bolsa/.test(l)) return 'investment';
  return 'bank';
}
