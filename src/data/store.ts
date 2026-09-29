import type { CollectionName, Row, Snapshot } from '../domain/types';

export type SyncState = 'saved' | 'saving' | 'offline' | 'error';

export interface Store {
  kind: 'local' | 'cloud';
  load(): Promise<Snapshot>;
  upsert<C extends CollectionName>(col: C, rows: Row<C>[]): Promise<void>;
  remove(col: CollectionName, ids: string[]): Promise<void>;
  onSync(cb: (s: SyncState, message?: string) => void): void;
}

export function mergeRows<T extends { id: string }>(list: T[], rows: T[]): T[] {
  if (!rows.length) return list;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = list.map((x) => byId.get(x.id) ?? x);
  const existing = new Set(list.map((x) => x.id));
  for (const r of rows) if (!existing.has(r.id)) out.push(r);
  return out;
}

export function dropRows<T extends { id: string }>(list: T[], ids: string[]): T[] {
  if (!ids.length) return list;
  const set = new Set(ids);
  return list.filter((x) => !set.has(x.id));
}

export function safeStorage() {
  try {
    const k = '__cp_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}
