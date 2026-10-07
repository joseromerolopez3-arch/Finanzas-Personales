import type { SupabaseClient } from '@supabase/supabase-js';
import type { Account, CollectionName, RecurringLog, Transaction } from '../domain/types';
import { fromDb, TABLES, toDb } from '../data/schema';
import type { AuthRequest, BankAccountRow, BankLinkRow, Db, HouseholdData } from './bankService';

const PAGE = 1000;

/** `Db` backed by Supabase with the service key (bypasses RLS: every query filters by household). */
export class SupabaseDb implements Db {
  constructor(private sb: SupabaseClient) {}

  async links(householdId?: string) {
    let q = this.sb.from('bank_links').select('*');
    if (householdId) q = q.eq('household_id', householdId);
    return (await this.run(q)) as BankLinkRow[];
  }
  async insertLink(row: BankLinkRow) { await this.run(this.sb.from('bank_links').insert(row)); }
  async updateLink(id: string, patch: Partial<BankLinkRow>) { await this.run(this.sb.from('bank_links').update(patch).eq('id', id)); }
  async deleteLink(id: string) { await this.run(this.sb.from('bank_links').delete().eq('id', id)); }

  async session(linkId: string) {
    const rows = (await this.run(this.sb.from('bank_secrets').select('session_id').eq('link_id', linkId))) as { session_id: string }[];
    return rows[0]?.session_id ?? null;
  }
  async setSession(linkId: string, sessionId: string) {
    await this.run(this.sb.from('bank_secrets').upsert({ link_id: linkId, session_id: sessionId }, { onConflict: 'link_id' }));
  }

  async bankAccounts(householdId: string) {
    return (await this.run(this.sb.from('bank_accounts').select('*').eq('household_id', householdId))) as BankAccountRow[];
  }
  async insertBankAccount(row: BankAccountRow) { await this.run(this.sb.from('bank_accounts').insert(row)); }
  async updateBankAccount(id: string, patch: Partial<BankAccountRow>) { await this.run(this.sb.from('bank_accounts').update(patch).eq('id', id)); }

  async saveAuthRequest(r: AuthRequest) { await this.run(this.sb.from('bank_auth_requests').insert(r)); }
  async takeAuthRequest(state: string) {
    const rows = (await this.run(this.sb.from('bank_auth_requests').delete().eq('state', state).select('*'))) as AuthRequest[];
    return rows[0] ?? null;
  }
  async cronToken() {
    const rows = (await this.run(this.sb.from('bank_config').select('cron_token').eq('id', 1))) as { cron_token: string }[];
    return rows[0]?.cron_token ?? null;
  }

  async household(householdId: string): Promise<HouseholdData> {
    const [accounts, transactions, rules, recurring, recurringLog] = await Promise.all([
      this.collection('accounts', householdId), this.collection('transactions', householdId), this.collection('rules', householdId),
      this.collection('recurring', householdId), this.collection('recurringLog', householdId)
    ]);
    return { accounts, transactions, rules, recurring, recurringLog } as HouseholdData;
  }
  async saveTransactions(householdId: string, txs: Transaction[]) { await this.save('transactions', householdId, txs); }
  async saveRecurringLogs(householdId: string, logs: RecurringLog[]) { await this.save('recurringLog', householdId, logs); }
  async saveAccounts(householdId: string, accounts: Account[]) { await this.save('accounts', householdId, accounts); }

  private async collection(col: CollectionName, householdId: string) {
    const out: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const data = (await this.run(this.sb.from(TABLES[col].table).select('*').eq('household_id', householdId).order('id').range(from, from + PAGE - 1))) as Record<string, unknown>[];
      out.push(...data.map((r) => fromDb(col, r)));
      if (data.length < PAGE) break;
    }
    return out;
  }
  private async save(col: CollectionName, householdId: string, rows: { id: string }[]) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...toDb(col, r as unknown as Record<string, unknown>), household_id: householdId }));
      await this.run(this.sb.from(TABLES[col].table).upsert(chunk, { onConflict: 'household_id,id' }));
    }
  }
  /** Query builders are lazy, so awaiting the same builder again re-sends the request. */
  private async run(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<unknown[]> {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await q;
      if (!error) return (data as unknown[]) ?? [];
      if (attempt < 2 && /issued at future|fetch failed|timeout/i.test(error.message)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(error.message);
    }
  }
}
