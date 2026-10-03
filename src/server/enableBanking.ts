import type { EBBalance, EBTransaction } from '../domain/bankSync';

/* Minimal Enable Banking API client (https://enablebanking.com/docs/api/reference/). Runs in Deno and Node. */

export interface EBAspsp {
  name: string;
  country: string;
  logo?: string;
  maximum_consent_validity?: number;
  psu_types?: string[];
}

export interface EBAccount {
  uid: string;
  identification_hash?: string | null;
  name?: string | null;
  currency?: string | null;
  account_id?: { iban?: string | null } | null;
  product?: string | null;
}

export interface EBSession {
  session_id: string;
  accounts: (EBAccount | string)[];
  access?: { valid_until?: string | null } | null;
  aspsp?: { name: string; country: string } | null;
}

export interface Psu { ip?: string | null; userAgent?: string | null }

export class EBError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message);
  }
  /** The bank authorisation is no longer valid (expired, revoked or unknown session). */
  get expired() {
    return this.status === 401 || this.status === 403 || /EXPIRED|REVOKED|SESSION|ACCESS/i.test(this.code ?? '');
  }
}

export class EnableBanking {
  private token: { value: string; exp: number } | null = null;
  private key: Promise<CryptoKey> | null = null;

  constructor(
    private appId: string,
    private privateKeyPem: string,
    private baseUrl = 'https://api.enablebanking.com',
    private fetchFn: typeof fetch = (...args) => fetch(...args)
  ) {}

  aspsps(country: string): Promise<{ aspsps: EBAspsp[] }> {
    return this.call('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
  }

  startAuth(p: { aspsp: { name: string; country: string }; redirectUrl: string; state: string; validUntil: string }): Promise<{ url: string }> {
    return this.call('POST', '/auth', {
      access: { valid_until: p.validUntil },
      aspsp: p.aspsp,
      state: p.state,
      redirect_url: p.redirectUrl,
      psu_type: 'personal'
    });
  }

  createSession(code: string): Promise<EBSession> {
    return this.call('POST', '/sessions', { code });
  }

  deleteSession(id: string): Promise<unknown> {
    return this.call('DELETE', `/sessions/${encodeURIComponent(id)}`);
  }

  accountDetails(uid: string): Promise<EBAccount> {
    return this.call('GET', `/accounts/${encodeURIComponent(uid)}/details`);
  }

  async balances(uid: string, psu?: Psu): Promise<EBBalance[]> {
    const r = await this.call<{ balances?: EBBalance[] }>('GET', `/accounts/${encodeURIComponent(uid)}/balances`, undefined, psu);
    return r.balances ?? [];
  }

  /** All booked and pending movements between two dates, following pagination. */
  async transactions(uid: string, dateFrom: string, dateTo: string, psu?: Psu): Promise<EBTransaction[]> {
    const out: EBTransaction[] = [];
    let continuation: string | null = null;
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      if (continuation) q.set('continuation_key', continuation);
      const r: { transactions?: EBTransaction[]; continuation_key?: string | null } =
        await this.call('GET', `/accounts/${encodeURIComponent(uid)}/transactions?${q}`, undefined, psu);
      out.push(...(r.transactions ?? []));
      continuation = r.continuation_key ?? null;
      if (!continuation) break;
    }
    return out;
  }

  private async call<T>(method: string, path: string, body?: unknown, psu?: Psu): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.jwt()}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // With the person present, requests do not count towards the 4 daily unattended accesses allowed by PSD2.
    if (psu?.ip) headers['Psu-Ip-Address'] = psu.ip;
    if (psu?.userAgent) headers['Psu-User-Agent'] = psu.userAgent;
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const j = (json ?? {}) as { code?: string; error?: string; message?: string; detail?: unknown };
      const detail = typeof j.detail === 'string' ? j.detail : j.message ?? j.error ?? text.slice(0, 200);
      throw new EBError(res.status, j.code ?? j.error ?? null, `Enable Banking ${res.status}: ${detail}`);
    }
    return json as T;
  }

  /** RS256 JWT signed with the application's private key (valid for one hour, reused while valid). */
  async jwt(nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
    if (this.token && this.token.exp - 300 > nowSec) return this.token.value;
    this.key ??= importPrivateKey(this.privateKeyPem);
    const exp = nowSec + 3600;
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: this.appId }));
    const payload = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: nowSec, exp }));
    const data = new TextEncoder().encode(`${header}.${payload}`);
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await this.key, data));
    const value = `${header}.${payload}.${b64urlBytes(sig)}`;
    this.token = { value, exp };
    return value;
  }
}

function b64url(s: string) {
  return b64urlBytes(new TextEncoder().encode(s));
}
function b64urlBytes(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Accepts PKCS#8 ("BEGIN PRIVATE KEY") and PKCS#1 ("BEGIN RSA PRIVATE KEY") PEM keys, with real or escaped newlines. */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const clean = pem.replace(/\\n/g, '\n').trim();
  const b64 = clean.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const der = clean.includes('BEGIN RSA PRIVATE KEY') ? pkcs1ToPkcs8(raw) : raw;
  return crypto.subtle.importKey('pkcs8', der.slice().buffer as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function derLength(n: number): number[] {
  if (n < 128) return [n];
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}

/** Wraps an RSA PKCS#1 key in the PKCS#8 structure WebCrypto expects. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...rsaAlgorithm, ...octet];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}
