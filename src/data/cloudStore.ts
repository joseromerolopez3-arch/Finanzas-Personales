import type { SupabaseClient } from '@supabase/supabase-js';
import type { CollectionName, Row, Snapshot } from '../domain/types';
import { EMPTY_SNAPSHOT } from '../domain/types';
import type { LegacyData } from '../domain/legacy';
import { COLLECTIONS, TABLES, fromDb, toDb } from './schema';
import { dropRows, mergeRows, safeStorage, type Store, type SyncState } from './store';

type Op = { col: CollectionName; kind: 'upsert'; rows: { id: string }[] } | { col: CollectionName; kind: 'remove'; ids: string[] };

const PAGE = 1000;
const CHUNK = 500;

export class SchemaMissingError extends Error {}

/**
 * Supabase-backed store. Changes are applied locally at once and queued in an outbox that is
 * kept in localStorage, so nothing is lost when the connection drops; the queue is retried
 * when the browser is back online. The last snapshot is cached for instant/offline start.
 */
export class CloudStore implements Store {
  kind = 'cloud' as const;
  private ls = safeStorage();
  private outbox: Op[] = [];
  private cache: Snapshot = { ...EMPTY_SNAPSHOT };
  private flushing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private cb: (s: SyncState, m?: string) => void = () => {};

  constructor(private sb: SupabaseClient, private userId: string) {
    try {
      this.outbox = JSON.parse(this.ls?.getItem(this.key('outbox')) ?? '[]');
    } catch {
      this.outbox = [];
    }
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  onSync(cb: (s: SyncState, m?: string) => void) {
    this.cb = cb;
  }

  async load(): Promise<Snapshot> {
    await this.flush();
    try {
      const out = { ...EMPTY_SNAPSHOT } as Record<CollectionName, unknown[]>;
      await Promise.all(COLLECTIONS.map(async (c) => { out[c] = await this.fetchAll(c); }));
      // Re-apply changes that could not be sent yet, so they are not hidden by server data.
      for (const op of this.outbox) {
        out[op.col] = op.kind === 'upsert' ? mergeRows(out[op.col] as { id: string }[], op.rows) : dropRows(out[op.col] as { id: string }[], op.ids);
      }
      this.cache = out as unknown as Snapshot;
      this.saveCache();
      return this.cache;
    } catch (e) {
      if (e instanceof SchemaMissingError) throw e;
      const cached = this.readCache();
      if (cached) {
        this.cache = cached;
        this.cb('offline', 'Sin conexión: mostrando los últimos datos guardados.');
        return cached;
      }
      throw e;
    }
  }

  async upsert<C extends CollectionName>(col: C, rows: Row<C>[]) {
    if (!rows.length) return;
    (this.cache[col] as Row<C>[]) = mergeRows(this.cache[col] as Row<C>[], rows);
    this.enqueue({ col, kind: 'upsert', rows });
  }

  async remove(col: CollectionName, ids: string[]) {
    if (!ids.length) return;
    (this.cache[col] as { id: string }[]) = dropRows(this.cache[col] as { id: string }[], ids);
    this.enqueue({ col, kind: 'remove', ids });
  }

  /** Data saved by the first version of the app (one JSON document per key). */
  async loadLegacy(): Promise<LegacyData | null> {
    const { data, error } = await this.sb.from('kv_store').select('key,value').eq('user_id', this.userId);
    if (error || !data?.length) return null;
    const out: Record<string, unknown> = {};
    for (const r of data as { key: string; value: unknown }[]) out[r.key] = r.value;
    return out as LegacyData;
  }

  private enqueue(op: Op) {
    this.outbox.push(op);
    this.saveOutbox();
    this.saveCache();
    void this.flush();
  }

  private async flush() {
    if (this.flushing || !this.outbox.length) return;
    this.flushing = true;
    this.cb('saving');
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        const { table } = TABLES[op.col];
        let error: { message: string; code?: string } | null = null;
        if (op.kind === 'upsert') {
          for (let i = 0; i < op.rows.length && !error; i += CHUNK) {
            const rows = op.rows.slice(i, i + CHUNK).map((r) => toDb(op.col, r as unknown as Record<string, unknown>));
            ({ error } = await this.sb.from(table).upsert(rows, { onConflict: 'user_id,id' }));
          }
        } else {
          for (let i = 0; i < op.ids.length && !error; i += CHUNK) {
            ({ error } = await this.sb.from(table).delete().in('id', op.ids.slice(i, i + CHUNK)));
          }
        }
        if (error) {
          if (isNetwork(error)) {
            this.cb('offline', 'Sin conexión: los cambios se guardarán al recuperarla.');
            this.scheduleRetry();
            return;
          }
          // A rejected change would block the queue forever: drop it and report.
          this.outbox.shift();
          this.saveOutbox();
          this.cb('error', `No se pudo guardar un cambio: ${error.message}`);
          continue;
        }
        this.outbox.shift();
        this.saveOutbox();
      }
      this.cb('saved');
    } catch {
      this.cb('offline', 'Sin conexión: los cambios se guardarán al recuperarla.');
      this.scheduleRetry();
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry() {
    if (this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, 15000);
  }

  private async fetchAll(col: CollectionName): Promise<unknown[]> {
    const { table } = TABLES[col];
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from(table).select('*').order('id').range(from, from + PAGE - 1);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') throw new SchemaMissingError(error.message);
        throw new Error(error.message);
      }
      rows.push(...(data ?? []).map((r) => fromDb(col, r)));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  private key(k: string) {
    return `cp:v2:${k}:${this.userId}`;
  }
  private saveOutbox() {
    try { this.ls?.setItem(this.key('outbox'), JSON.stringify(this.outbox)); } catch { /* quota: keep in memory */ }
  }
  private saveCache() {
    try { this.ls?.setItem(this.key('cache'), JSON.stringify(this.cache)); } catch { /* cache is optional */ }
  }
  private readCache(): Snapshot | null {
    try {
      const raw = this.ls?.getItem(this.key('cache'));
      return raw ? { ...EMPTY_SNAPSHOT, ...JSON.parse(raw) } : null;
    } catch {
      return null;
    }
  }
}

function isNetwork(e: { message: string; code?: string }) {
  return /fetch|network|timeout|load failed/i.test(e.message) || e.code === '';
}
