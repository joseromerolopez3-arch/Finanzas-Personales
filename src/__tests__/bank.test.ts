/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { ebToBankRow, pickBalance, planBankSync, type EBTransaction } from '../domain/bankSync';
import { EnableBanking, EBError } from '../server/enableBanking';
import { handle, type AuthRequest, type BankAccountRow, type BankLinkRow, type Ctx, type Db, type HouseholdData } from '../server/bankService';
import type { Account, Transaction } from '../domain/types';

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), type: 'expense', date: '2026-09-10', amount: 10, accountId: 'a', toAccountId: null,
  categoryId: null, note: '', source: 'manual', externalId: null, toExternalId: null, bankDescription: null, recurringId: null,
  createdBy: null, needsReview: false, createdAt: '', ...p
});
const eb = (p: Partial<EBTransaction> & { amount: string; ind: 'CRDT' | 'DBIT'; date: string }): EBTransaction => ({
  transaction_amount: { amount: p.amount, currency: 'EUR' }, credit_debit_indicator: p.ind, status: 'BOOK', booking_date: p.date, ...p
});

describe('Enable Banking mapping', () => {
  it('signs amounts, builds the description and skips pending movements', () => {
    expect(ebToBankRow(eb({ amount: '45.20', ind: 'DBIT', date: '2026-09-10', creditor: { name: 'MERCADONA' }, remittance_information: ['COMPRA TARJ 1234'], transaction_id: 'T1' })))
      .toEqual({ date: '2026-09-10', amount: -45.2, description: 'MERCADONA · COMPRA TARJ 1234', balance: null, externalId: 'T1' });
    expect(ebToBankRow(eb({ amount: '1500', ind: 'CRDT', date: '2026-09-01', debtor: { name: 'EMPRESA SL' } }))?.amount).toBe(1500);
    expect(ebToBankRow(eb({ amount: '3', ind: 'DBIT', date: '2026-09-01', status: 'PDNG' }))).toBeNull();
  });
  it('prefers the booked balance', () => {
    expect(pickBalance([
      { balance_amount: { amount: '90' }, balance_type: 'ITAV' },
      { balance_amount: { amount: '100' }, balance_type: 'CLBD', reference_date: '2026-09-29' }
    ], '2026-09-30')).toEqual({ amount: 100, date: '2026-09-29' });
  });
});

describe('planBankSync', () => {
  let n = 0;
  const opts = { newId: () => `new${++n}`, now: '2026-09-30T08:00:00Z', today: '2026-09-30' };
  const empty = { transactions: [], rules: [], recurring: [], recurringLog: [] };

  it('reconciles, categorises, pairs transfers and flags new movements for review', () => {
    const manual = tx({ id: 'm1', amount: 45.2, date: '2026-09-09', note: 'Mercadona', accountId: 'a' });
    const history = tx({ id: 'h1', amount: 12.99, date: '2026-08-15', accountId: 'a', categoryId: 'subs', bankDescription: 'NETFLIX.COM', externalId: 'old' });
    const hipoteca = {
      id: 'r1', name: 'Hipoteca', type: 'expense' as const, amount: 700, categoryId: null, accountId: null, frequency: 'monthly' as const,
      everyMonths: 1, day: 1, month: null, startDate: '2026-09-01', endDate: null, active: true
    };
    const plan = planBankSync([
      { accountId: 'a', rows: [
        { date: '2026-09-10', amount: -45.2, description: 'MERCADONA', balance: null, externalId: 'T1' },
        { date: '2026-09-15', amount: -12.99, description: 'NETFLIX.COM', balance: null, externalId: 'T2' },
        { date: '2026-09-20', amount: -300, description: 'TRASPASO A AHORRO', balance: null, externalId: 'T3' },
        { date: '2026-09-01', amount: -700, description: 'RECIBO HIPOTECA BANCO', balance: null, externalId: 'T4' }
      ] },
      { accountId: 'b', rows: [{ date: '2026-09-21', amount: 300, description: 'TRASPASO DESDE CUENTA', balance: null, externalId: 'U1' }] }
    ], { ...empty, transactions: [manual, history], recurring: [hipoteca] }, opts);

    expect(plan.matched).toBe(1);
    expect(plan.update[0]).toMatchObject({ id: 'm1', bankDescription: 'MERCADONA' });
    expect(plan.update[0].externalId).toMatch(/^x:/);
    expect(plan.transfers).toBe(1);
    expect(plan.create.find((t) => t.type === 'transfer')).toMatchObject({ amount: 300, accountId: 'a', toAccountId: 'b', needsReview: false });
    expect(plan.create.find((t) => t.bankDescription === 'NETFLIX.COM')).toMatchObject({ categoryId: 'subs', needsReview: true, source: 'bank' });
    expect(plan.logs).toEqual([expect.objectContaining({ id: 'r1::2026-09', status: 'done' })]);
  });

  it('never imports the same movement twice', () => {
    const rows = [{ date: '2026-09-10', amount: -20, description: 'FARMACIA', balance: null, externalId: 'T9' }];
    const first = planBankSync([{ accountId: 'a', rows }], empty, opts);
    const second = planBankSync([{ accountId: 'a', rows }], { ...empty, transactions: first.create }, opts);
    expect(first.create).toHaveLength(1);
    expect(second.create).toHaveLength(0);
  });
});

describe('JWT for Enable Banking', () => {
  it('signs RS256 tokens with PKCS#8 and PKCS#1 keys', async () => {
    for (const type of ['pkcs8', 'pkcs1'] as const) {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048, privateKeyEncoding: { type, format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' }
      });
      const client = new EnableBanking('app-123', privateKey.replace(/\n/g, '\\n'));
      const jwt = await client.jwt(1_800_000_000);
      const [h, p, s] = jwt.split('.');
      expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-123' });
      expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toMatchObject({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', exp: 1_800_003_600 });
      expect(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey(publicKey), Buffer.from(s, 'base64url'))).toBe(true);
    }
  });
});

/* ---------- service flow with an in-memory database and a fake bank ---------- */

class MemoryDb implements Db {
  linksT: BankLinkRow[] = [];
  accountsT: BankAccountRow[] = [];
  sessions = new Map<string, string>();
  auth: AuthRequest[] = [];
  data: HouseholdData = { accounts: [], transactions: [], rules: [], recurring: [], recurringLog: [] };
  async links(h?: string) { return this.linksT.filter((l) => !h || l.household_id === h).map((l) => ({ ...l })); }
  async insertLink(r: BankLinkRow) { this.linksT.push({ ...r }); }
  async updateLink(id: string, p: Partial<BankLinkRow>) { this.linksT = this.linksT.map((l) => (l.id === id ? { ...l, ...p } : l)); }
  async deleteLink(id: string) { this.linksT = this.linksT.filter((l) => l.id !== id); this.accountsT = this.accountsT.filter((a) => a.link_id !== id); }
  async session(id: string) { return this.sessions.get(id) ?? null; }
  async setSession(id: string, s: string) { this.sessions.set(id, s); }
  async bankAccounts(h: string) { return this.accountsT.filter((a) => a.household_id === h).map((a) => ({ ...a })); }
  async insertBankAccount(r: BankAccountRow) { this.accountsT.push({ ...r }); }
  async updateBankAccount(id: string, p: Partial<BankAccountRow>) { this.accountsT = this.accountsT.map((a) => (a.id === id ? { ...a, ...p } : a)); }
  async saveAuthRequest(r: AuthRequest) { this.auth.push(r); }
  async takeAuthRequest(state: string) { const r = this.auth.find((a) => a.state === state) ?? null; this.auth = this.auth.filter((a) => a.state !== state); return r; }
  async cronToken() { return 'cron'; }
  async household() { return structuredClone(this.data); }
  async saveTransactions(_h: string, txs: Transaction[]) { for (const t of txs) this.data.transactions = [...this.data.transactions.filter((x) => x.id !== t.id), t]; }
  async saveRecurringLogs(_h: string, logs: HouseholdData['recurringLog']) { this.data.recurringLog.push(...logs); }
  async saveAccounts(_h: string, accs: Account[]) { for (const a of accs) this.data.accounts = [...this.data.accounts.filter((x) => x.id !== a.id), a]; }
}

function fakeBank() {
  const calls: string[] = [];
  let session = 0;
  const bank = {
    calls,
    accounts: [{ uid: 'uid-1', identification_hash: 'hash-1', name: 'Cuenta nómina', currency: 'EUR', account_id: { iban: 'ES12 3456 0000 0000 1234' } }],
    movements: [
      eb({ amount: '1500', ind: 'CRDT', date: '2026-09-01', debtor: { name: 'EMPRESA SL' }, transaction_id: 'A1' }),
      eb({ amount: '45.20', ind: 'DBIT', date: '2026-09-10', creditor: { name: 'MERCADONA' }, transaction_id: 'A2' })
    ],
    async aspsps() { return { aspsps: [{ name: 'Banco Prueba', country: 'ES', maximum_consent_validity: 180 * 86400 }] }; },
    async startAuth(p: { state: string }) { calls.push(`auth:${p.state}`); return { url: `https://bank.example/auth?state=${p.state}` }; },
    async createSession() { session++; return { session_id: `s${session}`, accounts: bank.accounts.map((a) => ({ ...a, uid: `${a.uid}-${session}` })), access: { valid_until: '2027-03-01T00:00:00Z' } }; },
    async deleteSession(id: string) { calls.push(`delete:${id}`); return {}; },
    async accountDetails(uid: string) { return { uid }; },
    async balances() { return [{ balance_amount: { amount: '2454.80' }, balance_type: 'ITBD', reference_date: '2026-09-30' }]; },
    async transactions(uid: string, from: string) { calls.push(`tx:${uid}:${from}`); return bank.movements; }
  };
  return bank;
}

describe('bank service', () => {
  const user = { kind: 'user' as const, userId: 'u1', householdId: 'h1' };
  const setup = () => {
    const db = new MemoryDb();
    const bank = fakeBank();
    let id = 0;
    const ctx: Ctx = { db, eb: bank as unknown as EnableBanking, now: () => new Date('2026-09-30T08:00:00Z'), uuid: () => `id${++id}` };
    return { db, bank, ctx };
  };

  it('connects, creates the app account with the right opening balance and syncs without duplicates', async () => {
    const { db, bank, ctx } = setup();
    const { url } = (await handle('start', { aspsp: { name: 'Banco Prueba', country: 'ES' }, redirectUrl: 'https://app.example/banco' }, user, ctx)) as { url: string };
    const state = new URL(url).searchParams.get('state')!;
    const done = (await handle('complete', { code: 'c1', state }, user, ctx)) as { linkId: string; accounts: BankAccountRow[] };
    expect(done.accounts).toHaveLength(1);
    expect(done.accounts[0]).toMatchObject({ name: 'Cuenta nómina', iban_tail: '1234', account_id: null });

    const summary = (await handle('map', { accounts: [{ bankAccountId: done.accounts[0].id, createName: 'Nómina', syncFrom: '2026-09-01' }] }, user, ctx)) as { created: number };
    expect(summary.created).toBe(2);
    const account = db.data.accounts[0];
    expect(account).toMatchObject({ name: 'Nómina', openingDate: '2026-09-01', openingBalance: 1000 });
    expect(db.accountsT[0]).toMatchObject({ balance: 2454.8, init_opening: false, last_error: null });

    // Daily job: nothing new, nothing duplicated.
    const cron = (await handle('sync-all', {}, { kind: 'cron' }, ctx)) as { created: number };
    expect(cron.created).toBe(0);
    expect(db.data.transactions).toHaveLength(2);
    expect(bank.calls.filter((c) => c.startsWith('tx:')).at(-1)).toBe('tx:uid-1-1:2026-09-23');
  });

  it('keeps the account mapping when the authorisation is renewed and can disconnect', async () => {
    const { db, bank, ctx } = setup();
    const start = async (linkId?: string) => {
      const { url } = (await handle('start', { aspsp: { name: 'Banco Prueba', country: 'ES' }, redirectUrl: 'https://app.example/banco', linkId }, user, ctx)) as { url: string };
      return handle('complete', { code: 'c', state: new URL(url).searchParams.get('state') }, user, ctx) as Promise<{ linkId: string; accounts: BankAccountRow[] }>;
    };
    const first = await start();
    db.data.accounts.push({ id: 'acc', name: 'Corriente', icon: '', color: '', kind: 'bank', openingBalance: 0, openingDate: '2026-09-01', position: 0, archived: false, importMapping: null });
    await handle('map', { accounts: [{ bankAccountId: first.accounts[0].id, accountId: 'acc' }] }, user, ctx);
    const renewed = await start(first.linkId);
    expect(renewed.linkId).toBe(first.linkId);
    expect(db.accountsT).toHaveLength(1);
    expect(db.accountsT[0]).toMatchObject({ uid: 'uid-1-2', account_id: 'acc' });
    expect(bank.calls).toContain('delete:s1');

    await handle('disconnect', { linkId: first.linkId }, user, ctx);
    expect(db.linksT).toHaveLength(0);
    expect(bank.calls).toContain('delete:s2');
  });

  it('rejects foreign or stale authorisations and explains empty sessions', async () => {
    const { bank, ctx } = setup();
    await expect(handle('complete', { code: 'c', state: 'nope' }, user, ctx)).rejects.toThrow(/no es válida/);
    const { url } = (await handle('start', { aspsp: { name: 'Banco Prueba', country: 'ES' }, redirectUrl: 'https://app.example/banco' }, user, ctx)) as { url: string };
    const state = new URL(url).searchParams.get('state');
    await expect(handle('complete', { code: 'c', state }, { ...user, userId: 'other' }, ctx)).rejects.toThrow(/no es válida/);
    bank.accounts = [];
    const again = (await handle('start', { aspsp: { name: 'Banco Prueba', country: 'ES' }, redirectUrl: 'https://app.example/banco' }, user, ctx)) as { url: string };
    await expect(handle('complete', { code: 'c', state: new URL(again.url).searchParams.get('state') }, user, ctx)).rejects.toThrow(/panel/);
    await expect(handle('sync-all', {}, user, ctx)).rejects.toThrow();
  });

  it('marks the connection as expired when the bank rejects the session', async () => {
    const { db, bank, ctx } = setup();
    const { url } = (await handle('start', { aspsp: { name: 'Banco Prueba', country: 'ES' }, redirectUrl: 'https://app.example/banco' }, user, ctx)) as { url: string };
    const done = (await handle('complete', { code: 'c', state: new URL(url).searchParams.get('state') }, user, ctx)) as { accounts: BankAccountRow[] };
    bank.transactions = async () => { throw new EBError(401, 'EXPIRED_SESSION', 'expired'); };
    const s = (await handle('map', { accounts: [{ bankAccountId: done.accounts[0].id, createName: 'Nómina' }] }, user, ctx)) as { errors: string[] };
    expect(s.errors[0]).toMatch(/caducado/);
    expect(db.linksT[0].status).toBe('expired');
  });
});
