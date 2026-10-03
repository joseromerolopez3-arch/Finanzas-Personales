import type { createClient as CreateClientFn } from '@supabase/supabase-js';
import { EnableBanking } from './enableBanking';
import { handle, UserError, type Caller } from './bankService';
import { SupabaseDb } from './supabaseDb';

/* HTTP entry of the `bank` Edge Function (Deno). Kept here so it is type-checked with the app. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export interface Env { get(name: string): string | undefined }

/**
 * Legacy JWT keys first: the new `sb_secret_…` keys are exchanged for a fresh JWT on every call and a
 * small clock skew makes some requests fail with "JWT issued at future".
 */
function keyFrom(env: Env, jsonVar: string, legacyVar: string): string {
  const legacy = env.get(legacyVar);
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(env.get(jsonVar) ?? '{}') as Record<string, string>;
    return parsed.default ?? '';
  } catch {
    return '';
  }
}

/** `createClient` is injected so the bundle has no imports (the Edge runtime provides supabase-js). */
export function makeHandler(env: Env, createClient: typeof CreateClientFn) {
  const url = env.get('SUPABASE_URL') ?? '';
  const secretKey = keyFrom(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = keyFrom(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new SupabaseDb(admin);
  const appId = env.get('ENABLE_BANKING_APP_ID');
  const privateKey = env.get('ENABLE_BANKING_PRIVATE_KEY');
  const eb = appId && privateKey ? new EnableBanking(appId, privateKey) : null;
  const ctx = { db, eb, now: () => new Date(), uuid: () => crypto.randomUUID() };

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    try {
      if (req.method !== 'POST') return json(405, { error: 'Método no permitido' });
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const action = String(body.action ?? '');
      let caller: Caller;
      const cronHeader = req.headers.get('x-cron-token');
      if (cronHeader) {
        const token = await db.cronToken();
        if (!token || token !== cronHeader) return json(401, { error: 'No autorizado' });
        caller = { kind: 'cron' };
      } else {
        const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const { data: userData } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
        if (!userData.user) return json(401, { error: 'Inicia sesión para continuar.' });
        // Active household of the person, through the same RPC the app uses (runs with their permissions).
        const asUser = createClient(url, publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${jwt}` } }
        });
        const { data: householdId, error } = await asUser.rpc('ensure_household');
        if (error || !householdId) return json(403, { error: 'No se ha encontrado tu hogar.' });
        const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
        caller = { kind: 'user', userId: userData.user.id, householdId: householdId as string, psu: { ip, userAgent: req.headers.get('user-agent') } };
      }
      return json(200, await handle(action, body, caller, ctx));
    } catch (e) {
      if (e instanceof UserError) return json(e.status, { error: e.message });
      console.error(e);
      return json(500, { error: 'Error inesperado en la conexión bancaria.' });
    }
  };
}
