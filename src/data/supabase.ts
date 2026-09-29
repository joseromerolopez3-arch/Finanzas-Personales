import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from '../config';

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export function authErrorText(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'Email o contraseña incorrectos.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ya existe una cuenta con ese email. Prueba a entrar.';
  if (m.includes('password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('email not confirmed')) return 'Confirma tu email con el enlace que te hemos enviado.';
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera un momento y vuelve a probar.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión con el servidor. Revisa tu conexión.';
  return message;
}

export interface Resource { id: string; title: string; url: string }

export async function fetchResources(): Promise<Resource[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('resources').select('id,title,url').order('created_at', { ascending: true });
  if (error) return [];
  return data ?? [];
}
export async function addResource(title: string, url: string): Promise<Resource> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const { error } = await supabase!.from('resources').insert({ id, title, url });
  if (error) throw error;
  return { id, title, url };
}
export async function deleteResource(id: string) {
  const { error } = await supabase!.from('resources').delete().eq('id', id);
  if (error) throw error;
}
