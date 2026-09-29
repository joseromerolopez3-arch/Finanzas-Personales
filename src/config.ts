export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
/** Email allowed to manage the shared "Formación" resources (also enforced by RLS in Supabase). */
export const ADMIN_EMAIL: string = (import.meta.env.VITE_ADMIN_EMAIL ?? '').toLowerCase();
export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
