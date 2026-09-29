import type { CollectionName, Row, Snapshot } from '../domain/types';
import { EMPTY_SNAPSHOT } from '../domain/types';
import { COLLECTIONS } from './schema';
import { dropRows, mergeRows, safeStorage, type Store, type SyncState } from './store';

const KEY = (c: CollectionName) => `cp:v2:local:${c}`;

/** Everything in this browser only (no account). */
export class LocalStore implements Store {
  kind = 'local' as const;
  private ls = safeStorage();
  private data: Snapshot = { ...EMPTY_SNAPSHOT };
  private cb: (s: SyncState, m?: string) => void = () => {};

  async load(): Promise<Snapshot> {
    const out = { ...EMPTY_SNAPSHOT } as Record<CollectionName, unknown[]>;
    for (const c of COLLECTIONS) {
      try {
        out[c] = JSON.parse(this.ls?.getItem(KEY(c)) ?? '[]');
      } catch {
        out[c] = [];
      }
    }
    this.data = out as unknown as Snapshot;
    return this.data;
  }
  async upsert<C extends CollectionName>(col: C, rows: Row<C>[]) {
    (this.data[col] as Row<C>[]) = mergeRows(this.data[col] as Row<C>[], rows);
    this.persist(col);
  }
  async remove(col: CollectionName, ids: string[]) {
    (this.data[col] as { id: string }[]) = dropRows(this.data[col] as { id: string }[], ids);
    this.persist(col);
  }
  onSync(cb: (s: SyncState, m?: string) => void) {
    this.cb = cb;
  }
  private persist(col: CollectionName) {
    try {
      this.ls?.setItem(KEY(col), JSON.stringify(this.data[col]));
      this.cb('saved');
    } catch {
      this.cb('error', 'No se pudo guardar en este dispositivo (¿almacenamiento lleno?).');
    }
  }
}

export function clearLocalData() {
  const ls = safeStorage();
  for (const c of COLLECTIONS) ls?.removeItem(KEY(c));
}
