import type { Account, BankRow, RecurringLog, Rule, Recurring, Transaction } from '../domain/types';
import { colorFor } from '../domain/defaults';
import { ebToBankRow, openingFromBalance, pickBalance, planBankSync, type SyncInput } from '../domain/bankSync';
import { addDays, ymd } from '../lib/dates';
import { EBError, type EBAccount, type EnableBanking, type Psu } from './enableBanking';

/* Server side of the bank connection, independent from Supabase and Deno so it can be tested. */

export interface BankLinkRow {
  id: string;
  household_id: string;
  aspsp_name: string;
  aspsp_country: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  valid_until: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_by: string | null;
}

export interface BankAccountRow {
  id: string;
  household_id: string;
  link_id: string;
  uid: string;
  identification_hash: string | null;
  name: string;
  iban_tail: string | null;
  currency: string | null;
  account_id: string | null;
  sync_from: string | null;
  init_opening: boolean;
  balance: number | null;
  balance_date: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface AuthRequest {
  state: string;
  household_id: string;
  user_id: string;
  link_id: string | null;
  aspsp_name: string;
  aspsp_country: string;
  created_at: string;
}

export interface HouseholdData {
  accounts: Account[];
  transactions: Transaction[];
  rules: Rule[];
  recurring: Recurring[];
  recurringLog: RecurringLog[];
}

export interface Db {
  links(householdId?: string): Promise<BankLinkRow[]>;
  insertLink(row: BankLinkRow): Promise<void>;
  updateLink(id: string, patch: Partial<BankLinkRow>): Promise<void>;
  deleteLink(id: string): Promise<void>;
  session(linkId: string): Promise<string | null>;
  setSession(linkId: string, sessionId: string): Promise<void>;
  bankAccounts(householdId: string): Promise<BankAccountRow[]>;
  insertBankAccount(row: BankAccountRow): Promise<void>;
  updateBankAccount(id: string, patch: Partial<BankAccountRow>): Promise<void>;
  saveAuthRequest(r: AuthRequest): Promise<void>;
  takeAuthRequest(state: string): Promise<AuthRequest | null>;
  cronToken(): Promise<string | null>;
  household(householdId: string): Promise<HouseholdData>;
  saveTransactions(householdId: string, txs: Transaction[]): Promise<void>;
  saveRecurringLogs(householdId: string, logs: RecurringLog[]): Promise<void>;
  saveAccounts(householdId: string, accounts: Account[]): Promise<void>;
}

export interface Ctx {
  db: Db;
  eb: EnableBanking | null;
  now: () => Date;
  uuid: () => string;
}

export type Caller = { kind: 'user'; userId: string; householdId: string; psu?: Psu } | { kind: 'cron' };

/** Errors whose message can be shown to the person as is. */
export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const DEFAULT_CONSENT_DAYS = 90;
const MAX_CONSENT_DAYS = 180;
let aspspCache: { country: string; at: number; list: { name: string; country: string; logo: string | null; maxConsentDays: number }[] } | null = null;

export async function handle(action: string, body: Record<string, unknown>, caller: Caller, ctx: Ctx): Promise<unknown> {
  if (action === 'status') return { configured: !!ctx.eb };
  if (action === 'verify') {
    // Checks that Enable Banking accepts the application key (lists Spanish banks).
    if (!ctx.eb) return { ok: false, error: 'Faltan las claves de Enable Banking.' };
    try {
      return { ok: true, banks: (await banks(ctx.eb, 'ES')).length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (caller.kind === 'cron') {
    if (action !== 'sync-all') throw new UserError('Acción no permitida', 403);
    return syncAll(ctx);
  }
  const eb = ctx.eb;
  if (!eb) throw new UserError('La conexión bancaria aún no está configurada (faltan las claves de Enable Banking en Supabase).', 503);
  switch (action) {
    case 'banks':
      return { banks: await banks(eb, String(body.country ?? 'ES')) };
    case 'start':
      return start(body, caller, ctx, eb);
    case 'complete':
      return complete(body, caller, ctx, eb);
    case 'map':
      return mapAccounts(body, caller, ctx);
    case 'sync':
      return syncHousehold(caller.householdId, ctx, caller.psu, true);
    case 'disconnect':
      return disconnect(body, caller, ctx, eb);
    default:
      throw new UserError('Acción desconocida');
  }
}

async function banks(eb: EnableBanking, country: string) {
  if (aspspCache && aspspCache.country === country && Date.now() - aspspCache.at < 6 * 3600_000) return aspspCache.list;
  const r = await eb.aspsps(country);
  const list = (r.aspsps ?? [])
    .filter((a) => !a.psu_types || a.psu_types.includes('personal'))
    .map((a) => ({
      name: a.name, country: a.country, logo: a.logo ?? null,
      maxConsentDays: a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86400) : DEFAULT_CONSENT_DAYS
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  aspspCache = { country, at: Date.now(), list };
  return list;
}

async function start(body: Record<string, unknown>, caller: Extract<Caller, { kind: 'user' }>, ctx: Ctx, eb: EnableBanking) {
  const aspsp = body.aspsp as { name?: string; country?: string } | undefined;
  const redirectUrl = String(body.redirectUrl ?? '');
  if (!aspsp?.name || !aspsp.country) throw new UserError('Elige un banco.');
  if (!/^https:\/\/[^/]+\//.test(redirectUrl) && !/^http:\/\/localhost(:\d+)?\//.test(redirectUrl)) throw new UserError('Dirección de retorno no válida.');
  const linkId = body.linkId ? String(body.linkId) : null;
  if (linkId) {
    const link = (await ctx.db.links(caller.householdId)).find((l) => l.id === linkId);
    if (!link) throw new UserError('Conexión no encontrada.', 404);
  }
  const known = (await banks(eb, aspsp.country)).find((b) => b.name === aspsp.name);
  const days = Math.min(known?.maxConsentDays ?? DEFAULT_CONSENT_DAYS, MAX_CONSENT_DAYS);
  const validUntil = new Date(ctx.now().getTime() + days * 86400_000).toISOString();
  const state = ctx.uuid();
  await ctx.db.saveAuthRequest({
    state, household_id: caller.householdId, user_id: caller.userId, link_id: linkId,
    aspsp_name: aspsp.name, aspsp_country: aspsp.country, created_at: ctx.now().toISOString()
  });
  const r = await eb.startAuth({ aspsp: { name: aspsp.name, country: aspsp.country }, redirectUrl, state, validUntil });
  return { url: r.url };
}

async function complete(body: Record<string, unknown>, caller: Extract<Caller, { kind: 'user' }>, ctx: Ctx, eb: EnableBanking) {
  const code = String(body.code ?? '');
  const state = String(body.state ?? '');
  const req = state ? await ctx.db.takeAuthRequest(state) : null;
  if (!req || req.user_id !== caller.userId || req.household_id !== caller.householdId) throw new UserError('La autorización no es válida. Vuelve a intentarlo.', 403);
  if (ctx.now().getTime() - new Date(req.created_at).getTime() > 3600_000) throw new UserError('La autorización ha caducado. Vuelve a intentarlo.', 403);
  if (!code) throw new UserError('El banco no ha completado la autorización.');

  const session = await eb.createSession(code);
  const accounts: EBAccount[] = [];
  for (const a of session.accounts ?? []) accounts.push(typeof a === 'string' ? { ...(await eb.accountDetails(a)), uid: a } : a);
  if (!accounts.length) {
    await eb.deleteSession(session.session_id).catch(() => undefined);
    throw new UserError('El banco no ha devuelto ninguna cuenta. En el modo gratuito de Enable Banking, cada cuenta debe estar habilitada antes en su panel.');
  }

  const validUntil = session.access?.valid_until ?? null;
  const links = await ctx.db.links(caller.householdId);
  let link = req.link_id ? links.find((l) => l.id === req.link_id) ?? null : null;
  if (link) {
    const previous = await ctx.db.session(link.id);
    await ctx.db.updateLink(link.id, { status: 'active', valid_until: validUntil, last_error: null });
    if (previous) await eb.deleteSession(previous).catch(() => undefined);
  } else {
    link = {
      id: ctx.uuid(), household_id: caller.householdId, aspsp_name: req.aspsp_name, aspsp_country: req.aspsp_country,
      status: 'active', valid_until: validUntil, last_sync_at: null, last_error: null, created_by: caller.userId
    };
    await ctx.db.insertLink(link);
  }
  await ctx.db.setSession(link.id, session.session_id);

  // Account ids change with every authorisation; the identification hash does not, so mappings survive a renewal.
  const existing = await ctx.db.bankAccounts(caller.householdId);
  for (const a of accounts) {
    const iban = a.account_id?.iban ?? null;
    const fields = {
      uid: a.uid, link_id: link.id, name: a.name || a.product || 'Cuenta', currency: a.currency ?? 'EUR',
      iban_tail: iban ? iban.replace(/\s+/g, '').slice(-4) : null, last_error: null
    };
    const prev = a.identification_hash ? existing.find((e) => e.identification_hash === a.identification_hash) : undefined;
    if (prev) await ctx.db.updateBankAccount(prev.id, fields);
    else {
      await ctx.db.insertBankAccount({
        ...fields, id: ctx.uuid(), household_id: caller.householdId, identification_hash: a.identification_hash ?? null,
        account_id: null, sync_from: null, init_opening: false, balance: null, balance_date: null, last_sync_at: null
      });
    }
  }
  const linked = (await ctx.db.bankAccounts(caller.householdId)).filter((a) => a.link_id === link!.id);
  if (linked.some((a) => a.account_id)) await syncHousehold(caller.householdId, ctx, caller.psu, false);
  return { linkId: link.id, accounts: linked };
}

interface MapItem { bankAccountId: string; accountId?: string | null; createName?: string | null; syncFrom?: string | null }

async function mapAccounts(body: Record<string, unknown>, caller: Extract<Caller, { kind: 'user' }>, ctx: Ctx) {
  const items = (Array.isArray(body.accounts) ? body.accounts : []) as MapItem[];
  const bankAccounts = await ctx.db.bankAccounts(caller.householdId);
  const data = await ctx.db.household(caller.householdId);
  const today = ymd(ctx.now());
  const created: Account[] = [];
  const target = new Map<string, string | null>(bankAccounts.map((b) => [b.id, b.account_id]));

  const plans: { ba: BankAccountRow; accountId: string | null; syncFrom: string | null; init: boolean }[] = [];
  for (const it of items) {
    const ba = bankAccounts.find((b) => b.id === it.bankAccountId);
    if (!ba) throw new UserError('Cuenta bancaria no encontrada.', 404);
    const syncFrom = it.syncFrom && /^\d{4}-\d{2}-\d{2}$/.test(it.syncFrom) && it.syncFrom <= today ? it.syncFrom : null;
    let accountId = it.accountId ?? null;
    let init = false;
    if (it.createName) {
      const from = syncFrom ?? `${today.slice(0, 7)}-01`;
      const acc: Account = {
        id: ctx.uuid(), name: it.createName.trim().slice(0, 60) || ba.name, icon: '🏦', color: colorFor(data.accounts.length + created.length),
        kind: 'bank', openingBalance: 0, openingDate: from, position: data.accounts.length + created.length, archived: false, importMapping: null
      };
      created.push(acc);
      accountId = acc.id;
      init = true;
    } else if (accountId && !data.accounts.some((a) => a.id === accountId)) {
      throw new UserError('La cuenta elegida no existe.', 404);
    }
    target.set(ba.id, accountId);
    plans.push({ ba, accountId, syncFrom: accountId ? syncFrom ?? (init ? `${today.slice(0, 7)}-01` : null) : null, init });
  }
  const used = [...target.values()].filter(Boolean);
  if (new Set(used).size !== used.length) throw new UserError('Cada cuenta de la app solo puede enlazarse con una cuenta del banco.');

  if (created.length) await ctx.db.saveAccounts(caller.householdId, created);
  for (const p of plans) {
    const changed = p.ba.account_id !== p.accountId;
    await ctx.db.updateBankAccount(p.ba.id, {
      account_id: p.accountId, sync_from: p.syncFrom, init_opening: p.init,
      ...(changed ? { last_sync_at: null, balance: null, balance_date: null } : {})
    });
  }
  return syncHousehold(caller.householdId, ctx, caller.psu, false);
}

async function disconnect(body: Record<string, unknown>, caller: Extract<Caller, { kind: 'user' }>, ctx: Ctx, eb: EnableBanking) {
  const link = (await ctx.db.links(caller.householdId)).find((l) => l.id === body.linkId);
  if (!link) throw new UserError('Conexión no encontrada.', 404);
  const session = await ctx.db.session(link.id);
  if (session) await eb.deleteSession(session).catch(() => undefined);
  await ctx.db.deleteLink(link.id);
  return { ok: true };
}

export interface SyncSummary { created: number; matched: number; transfers: number; scheduled: number; errors: string[] }

async function syncAll(ctx: Ctx): Promise<SyncSummary> {
  const all = await ctx.db.links();
  const total: SyncSummary = { created: 0, matched: 0, transfers: 0, scheduled: 0, errors: [] };
  for (const hid of new Set(all.map((l) => l.household_id))) {
    try {
      const s = await syncHousehold(hid, ctx, undefined, false);
      total.created += s.created; total.matched += s.matched; total.transfers += s.transfers; total.scheduled += s.scheduled;
      total.errors.push(...s.errors);
    } catch (e) {
      total.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return total;
}

/**
 * Downloads movements and balances of every linked account of the household and writes the
 * reconciliation plan. With `throttle`, links synced less than a minute ago are skipped.
 */
export async function syncHousehold(householdId: string, ctx: Ctx, psu: Psu | undefined, throttle: boolean): Promise<SyncSummary> {
  const summary: SyncSummary = { created: 0, matched: 0, transfers: 0, scheduled: 0, errors: [] };
  const eb = ctx.eb;
  if (!eb) return summary;
  const now = ctx.now();
  const nowIso = now.toISOString();
  const today = ymd(now);
  const links = (await ctx.db.links(householdId)).filter((l) => l.status === 'active' || l.status === 'error');
  if (!links.length) return summary;
  const bankAccounts = await ctx.db.bankAccounts(householdId);
  const data = await ctx.db.household(householdId);
  const inputs: SyncInput[] = [];
  const openings: Account[] = [];
  const accountPatches: { id: string; patch: Partial<BankAccountRow> }[] = [];

  for (const link of links) {
    if (throttle && link.last_sync_at && now.getTime() - new Date(link.last_sync_at).getTime() < 60_000) continue;
    if (link.valid_until && new Date(link.valid_until) < now) {
      await ctx.db.updateLink(link.id, { status: 'expired' });
      summary.errors.push(`${link.aspsp_name}: la autorización ha caducado`);
      continue;
    }
    const session = await ctx.db.session(link.id);
    if (!session) continue;
    let linkError: string | null = null;
    let expired = false;
    for (const ba of bankAccounts.filter((b) => b.link_id === link.id && b.account_id)) {
      const app = data.accounts.find((a) => a.id === ba.account_id);
      if (!app) {
        accountPatches.push({ id: ba.id, patch: { account_id: null, last_error: 'La cuenta de la app ya no existe' } });
        continue;
      }
      const first = ba.sync_from ?? maxDate(app.openingDate, addDays(today, -89));
      const from = maxDate(ba.last_sync_at ? maxDate(first, addDays(ba.last_sync_at.slice(0, 10), -7)) : first, app.openingDate);
      try {
        const rows = (await eb.transactions(ba.uid, from, today, psu))
          .map(ebToBankRow)
          .filter((r): r is BankRow => !!r && r.date >= from && r.date <= today);
        const balance = pickBalance(await eb.balances(ba.uid, psu), today);
        if (ba.init_opening && balance) {
          const opening = { ...app, openingBalance: openingFromBalance(balance.amount, rows, from), openingDate: from };
          openings.push(opening);
          data.accounts = data.accounts.map((a) => (a.id === app.id ? opening : a));
        }
        inputs.push({ accountId: app.id, rows });
        accountPatches.push({
          id: ba.id,
          patch: { balance: balance?.amount ?? null, balance_date: balance?.date ?? null, last_sync_at: nowIso, last_error: null, init_opening: false }
        });
      } catch (e) {
        const message = friendlyError(e);
        if (e instanceof EBError && e.expired) expired = true;
        linkError = message;
        accountPatches.push({ id: ba.id, patch: { last_error: message } });
      }
    }
    await ctx.db.updateLink(link.id, {
      last_sync_at: nowIso, last_error: linkError, status: expired ? 'expired' : linkError ? 'error' : 'active'
    });
    if (linkError) summary.errors.push(`${link.aspsp_name}: ${linkError}`);
  }

  const plan = planBankSync(inputs, data, { newId: ctx.uuid, now: nowIso, today });
  if (openings.length) await ctx.db.saveAccounts(householdId, openings);
  await ctx.db.saveTransactions(householdId, [...plan.create, ...plan.update]);
  if (plan.logs.length) await ctx.db.saveRecurringLogs(householdId, plan.logs);
  for (const p of accountPatches) await ctx.db.updateBankAccount(p.id, p.patch);
  summary.created = plan.create.length;
  summary.matched = plan.matched;
  summary.transfers = plan.transfers;
  summary.scheduled = plan.logs.length;
  return summary;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

function friendlyError(e: unknown): string {
  if (e instanceof EBError) {
    if (e.expired) return 'La autorización del banco ha caducado o se ha revocado. Renueva la conexión.';
    if (e.status === 429 || /RATE|LIMIT/i.test(e.code ?? '')) return 'El banco limita las consultas; se volverá a intentar más tarde.';
    return `El banco no ha respondido correctamente (${e.status}).`;
  }
  return 'Error de conexión con el banco.';
}
