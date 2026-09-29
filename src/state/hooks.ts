import { useMemo } from 'react';
import type { Account, Category, Transaction } from '../domain/types';
import { FALLBACK_ACCOUNT, FALLBACK_CATEGORY } from '../domain/defaults';
import { makeCategorizer } from '../domain/categorize';
import { useApp } from './app';
import { uid } from '../lib/id';
import { todayStr } from '../lib/dates';

export function useLookups() {
  const { accounts, categories } = useApp();
  return useMemo(() => {
    const c = new Map(categories.map((x) => [x.id, x]));
    const a = new Map(accounts.map((x) => [x.id, x]));
    return {
      cat: (id: string | null | undefined): Category => c.get(id ?? '') ?? FALLBACK_CATEGORY,
      acc: (id: string | null | undefined): Account => a.get(id ?? '') ?? FALLBACK_ACCOUNT
    };
  }, [accounts, categories]);
}

export function useCategorizer() {
  const { data } = useApp();
  return useMemo(() => makeCategorizer(data.rules, data.transactions), [data.rules, data.transactions]);
}

/** Categories of a kind, most used first (last 300 movements). */
export function useSortedCategories(kind: 'income' | 'expense') {
  const { categories, data } = useApp();
  return useMemo(() => {
    const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
    const uses = new Map<string, number>();
    for (const t of recent) if (t.categoryId) uses.set(t.categoryId, (uses.get(t.categoryId) || 0) + 1);
    return categories
      .filter((c) => c.kind === kind && !c.archived)
      .sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0) || a.position - b.position);
  }, [categories, data.transactions, kind]);
}

export function newTx(p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'accountId'>): Transaction {
  return {
    id: uid(), date: todayStr(), toAccountId: null, categoryId: null, note: '', source: 'manual', externalId: null,
    toExternalId: null, bankDescription: null, recurringId: null, createdAt: new Date().toISOString(), ...p
  };
}
