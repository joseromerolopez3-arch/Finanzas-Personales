import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { CollectionName, Household, HouseholdKind, HouseholdRef, Member, Row, Snapshot } from '../domain/types';
import { EMPTY_SNAPSHOT } from '../domain/types';
import { COLLECTIONS, TABLES, fromDb, toDb } from './schema';
import { dropRows, mergeRows, safeStorage, type Store, type SyncState } from './store';

type Op = ({ col: CollectionName; kind: 'upsert'; rows: { id: string }[] } | { col: CollectionName; kind: 'remove'; ids: string[] }) & { hid?: string };

/** Everything except personal settings belongs to the shared household. */
const shared = (c: CollectionName) => c !== 'settings';

export type RemoteChange = { col: CollectionName; kind: 'upsert'; row: { id: string } } | { col: CollectionName; kind: 'remove'; id: string };

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
  private flushing: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private cb: (s: SyncState, m?: string) => void = () => {};
  private channel: RealtimeChannel | null = null;
  householdId: string | null = null;

  constructor(private sb: SupabaseClient, readonly userId: string) {
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
      const { data: hid, error } = await this.sb.rpc('ensure_household');
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') throw new SchemaMissingError(error.message);
        throw new Error(error.message);
      }
      this.householdId = hid as string;
      try { this.ls?.setItem(this.key('hid'), this.householdId); } catch { /* optional */ }
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
      this.householdId ??= this.ls?.getItem(this.key('hid')) ?? null;
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
    this.enqueue({ col, kind: 'upsert', rows, hid: this.householdId ?? undefined });
  }

  async remove(col: CollectionName, ids: string[]) {
    if (!ids.length) return;
    (this.cache[col] as { id: string }[]) = dropRows(this.cache[col] as { id: string }[], ids);
    this.enqueue({ col, kind: 'remove', ids, hid: this.householdId ?? undefined });
  }

  /** Live changes made by the other members of the household. */
  subscribe(onChange: (c: RemoteChange) => void, onBank?: () => void) {
    if (this.channel) void this.sb.removeChannel(this.channel);
    const hid = this.householdId;
    if (!hid) return;
    let ch = this.sb.channel(`household-${hid}`);
    for (const col of COLLECTIONS.filter(shared)) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: TABLES[col].table, filter: `household_id=eq.${hid}` }, (p) => {
        if (p.eventType === 'DELETE') {
          const id = (p.old as { id?: string }).id;
          if (id) onChange({ col, kind: 'remove', id });
          return;
        }
        const row = p.new as Record<string, unknown>;
        if (row.updated_by === this.userId) return; // echo of our own change
        const parsed = fromDb(col, row) as { id: string };
        (this.cache[col] as { id: string }[]) = mergeRows(this.cache[col] as { id: string }[], [parsed]);
        onChange({ col, kind: 'upsert', row: parsed });
      });
    }
    if (onBank) {
      for (const table of ['bank_links', 'bank_accounts']) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${hid}` }, () => onBank());
      }
    }
    this.channel = ch.subscribe();
  }

  close() {
    if (this.channel) void this.sb.removeChannel(this.channel);
    this.channel = null;
  }

  // ---------- shared household ----------

  async household(): Promise<Household | null> {
    const hid = this.householdId;
    if (!hid) return null;
    const [{ data: h }, { data: members }] = await Promise.all([
      this.sb.from('households').select('id,name,kind').eq('id', hid).maybeSingle(),
      this.sb.from('household_members').select('user_id,role,email,name,joined_at').eq('household_id', hid).order('joined_at')
    ]);
    if (!h) return null;
    return {
      id: h.id, name: h.name, kind: h.kind ?? 'shared',
      members: (members ?? []).map((m): Member => ({ userId: m.user_id, role: m.role, email: m.email, name: m.name }))
    };
  }
  async myHouseholds(): Promise<HouseholdRef[]> {
    const { data } = await this.sb.from('households').select('id,name,kind').order('created_at');
    return (data ?? []).map((h) => ({ id: h.id, name: h.name, kind: h.kind ?? 'shared' }));
  }
  /** Personal finances or shared household (only changes labels and what the app offers). */
  async setKind(kind: HouseholdKind, name?: string) {
    await this.call(this.sb.from('households').update(name ? { kind, name } : { kind }).eq('id', this.householdId!));
  }
  /** One more household (e.g. a personal one besides the shared one). The active one does not change. */
  async createHousehold(name: string, kind: HouseholdKind): Promise<string> {
    return (await this.call(this.sb.rpc('create_household', { hname: name, hkind: kind }))) as string;
  }
  async renameHousehold(name: string) {
    await this.call(this.sb.from('households').update({ name }).eq('id', this.householdId!));
  }
  async setMyName(name: string) {
    if (!this.householdId) return;
    await this.sb.from('household_members').update({ name }).eq('household_id', this.householdId).eq('user_id', this.userId);
  }
  async createInvite(): Promise<string> {
    return (await this.call(this.sb.rpc('create_invite', { hid: this.householdId }))) as string;
  }
  async inviteInfo(code: string): Promise<{ household_name: string; invited_by: string | null } | null> {
    const rows = (await this.call(this.sb.rpc('invite_info', { invite: code }))) as { household_name: string; invited_by: string | null }[];
    return rows?.[0] ?? null;
  }
  async join(code: string, name: string) {
    await this.flush();
    await this.call(this.sb.rpc('join_household', { invite: code, display_name: name }));
  }
  async leave() {
    await this.flush();
    await this.call(this.sb.rpc('leave_household', { hid: this.householdId }));
  }
  async removeMember(userId: string) {
    await this.call(this.sb.rpc('remove_member', { hid: this.householdId, member: userId }));
  }
  private async call<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  }

  private enqueue(op: Op) {
    this.outbox.push(op);
    this.saveOutbox();
    this.saveCache();
    void this.flush();
  }

  /** Sends queued changes; concurrent callers wait for the same run. */
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.outbox.length) return Promise.resolve();
    this.flushing = this.runFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async runFlush() {
    this.cb('saving');
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        const { table } = TABLES[op.col];
        const hid = op.hid ?? this.householdId;
        let error: { message: string; code?: string } | null = null;
        if (shared(op.col) && !hid) { this.outbox.shift(); this.saveOutbox(); continue; }
        if (op.kind === 'upsert') {
          for (let i = 0; i < op.rows.length && !error; i += CHUNK) {
            const rows = op.rows.slice(i, i + CHUNK).map((r) => {
              const row = toDb(op.col, r as unknown as Record<string, unknown>);
              return shared(op.col) ? { ...row, household_id: hid } : row;
            });
            ({ error } = await this.sb.from(table).upsert(rows, { onConflict: shared(op.col) ? 'household_id,id' : 'user_id,id' }));
          }
        } else {
          for (let i = 0; i < op.ids.length && !error; i += CHUNK) {
            let q = this.sb.from(table).delete().in('id', op.ids.slice(i, i + CHUNK));
            if (shared(op.col)) q = q.eq('household_id', hid!);
            ({ error } = await q);
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
      let q = this.sb.from(table).select('*');
      if (shared(col)) q = q.eq('household_id', this.householdId!);
      const { data, error } = await q.order('id').range(from, from + PAGE - 1);
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703') throw new SchemaMissingError(error.message);
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
