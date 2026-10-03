import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/* Client side of the bank connection: everything goes through the `bank` Edge Function. */

export interface BankLink {
  id: string;
  aspspName: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  validUntil: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface BankAccountLink {
  id: string;
  linkId: string;
  name: string;
  ibanTail: string | null;
  accountId: string | null;
  syncFrom: string | null;
  balance: number | null;
  balanceDate: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface BankState { links: BankLink[]; accounts: BankAccountLink[] }
export interface BankOption { name: string; country: string; logo: string | null; maxConsentDays: number }
export interface SyncSummary { created: number; matched: number; transfers: number; scheduled: number; errors: string[] }

/** Where the bank sends the person back after authorising (must be registered in Enable Banking). */
export const BANK_CALLBACK_PATH = '/banco';
export const bankRedirectUrl = () => `${location.origin}${BANK_CALLBACK_PATH}`;

export async function bankCall<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('Necesitas una cuenta para conectar el banco.');
  const { data, error } = await supabase.functions.invoke('bank', { body: { action, ...body } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? 'No se pudo completar la operación con el banco.');
    }
    throw new Error('Sin conexión con el servidor.');
  }
  return data as T;
}

export async function loadBank(householdId: string): Promise<BankState> {
  if (!supabase) return { links: [], accounts: [] };
  const [links, accounts] = await Promise.all([
    supabase.from('bank_links').select('*').eq('household_id', householdId).order('created_at'),
    supabase.from('bank_accounts').select('*').eq('household_id', householdId).order('created_at')
  ]);
  if (links.error || accounts.error) return { links: [], accounts: [] };
  return {
    links: (links.data ?? []).map((l) => ({
      id: l.id, aspspName: l.aspsp_name, status: l.status, validUntil: l.valid_until, lastSyncAt: l.last_sync_at, lastError: l.last_error
    })),
    accounts: (accounts.data ?? []).map((a) => ({
      id: a.id, linkId: a.link_id, name: a.name, ibanTail: a.iban_tail, accountId: a.account_id, syncFrom: a.sync_from,
      balance: a.balance == null ? null : Number(a.balance), balanceDate: a.balance_date, lastSyncAt: a.last_sync_at, lastError: a.last_error
    }))
  };
}

/** Parameters the bank adds when it sends the person back to the app. */
export function bankCallback(): { code: string | null; state: string | null; error: string | null } | null {
  if (!location.pathname.startsWith(BANK_CALLBACK_PATH)) return null;
  const p = new URLSearchParams(location.search);
  return { code: p.get('code'), state: p.get('state'), error: p.get('error_description') ?? p.get('error') };
}
export function clearBankCallback() {
  history.replaceState(null, '', '/');
}

export function daysLeft(validUntil: string | null): number | null {
  if (!validUntil) return null;
  return Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86400000);
}
