import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Account, Category, CollectionName, Row, Settings, Snapshot } from '../domain/types';
import { EMPTY_SNAPSHOT } from '../domain/types';
import { defaultSettings } from '../domain/defaults';
import { convertLegacy } from '../domain/legacy';
import { COLLECTIONS } from '../data/schema';
import { dropRows, mergeRows, safeStorage, type Store, type SyncState } from '../data/store';
import { LocalStore } from '../data/localStore';
import { CloudStore, SchemaMissingError } from '../data/cloudStore';
import { supabase } from '../data/supabase';
import { cloudEnabled } from '../config';

export type Phase = 'loading' | 'auth' | 'recovery' | 'schema' | 'error' | 'ready';

export interface Toast { id: number; message: string; action?: { label: string; run: () => void } }

interface AppCtx {
  phase: Phase;
  errorMessage: string;
  storeKind: 'local' | 'cloud' | null;
  email: string | null;
  data: Snapshot;
  settings: Settings;
  accounts: Account[];
  activeAccounts: Account[];
  categories: Category[];
  sync: { state: SyncState; message?: string };
  upsert: <C extends CollectionName>(col: C, rows: Row<C>[]) => void;
  remove: (col: CollectionName, ids: string[]) => void;
  saveSettings: (patch: Partial<Settings>) => void;
  replaceAll: (snap: Snapshot) => void;
  startLocal: () => void;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  toast: (message: string, action?: Toast['action']) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  setPhase: (p: Phase) => void;
}

const Ctx = createContext<AppCtx | null>(null);
const MODE_KEY = 'cp:v2:mode';

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [data, setData] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [email, setEmail] = useState<string | null>(null);
  const [sync, setSync] = useState<{ state: SyncState; message?: string }>({ state: 'saved' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const storeRef = useRef<Store | null>(null);
  const lastLoad = useRef(0);
  const [storeKind, setStoreKind] = useState<'local' | 'cloud' | null>(null);

  const toast = useCallback((message: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const attach = useCallback(async (store: Store) => {
    storeRef.current = store;
    setStoreKind(store.kind);
    store.onSync((state, message) => {
      setSync({ state, message });
      if (state === 'error' && message) toast(message);
    });
    setPhase('loading');
    try {
      let snap = await store.load();
      lastLoad.current = Date.now();
      if (!snap.settings.length && store instanceof CloudStore) {
        const legacy = await store.loadLegacy();
        if (legacy && (legacy.profile || legacy.transactions?.length)) {
          snap = convertLegacy(legacy);
          for (const c of COLLECTIONS) await store.upsert(c, snap[c] as never);
          toast('Hemos traído tus datos de la versión anterior.');
        }
      }
      setData(snap);
      // A password-recovery link signs in too: keep the "new password" screen on top.
      setPhase((p) => (p === 'recovery' ? p : 'ready'));
    } catch (e) {
      if (e instanceof SchemaMissingError) { setPhase('schema'); return; }
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [toast]);

  const startCloud = useCallback(async (session: Session) => {
    setEmail(session.user.email ?? null);
    await attach(new CloudStore(supabase!, session.user.id));
  }, [attach]);

  const startLocal = useCallback(() => {
    safeStorage()?.setItem(MODE_KEY, 'local');
    setEmail(null);
    void attach(new LocalStore());
  }, [attach]);

  useEffect(() => {
    if (!cloudEnabled || !supabase) { startLocal(); return; }
    if (safeStorage()?.getItem(MODE_KEY) === 'local') { startLocal(); return; }
    let started = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { started = true; void startCloud(session); } else setPhase('auth');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPhase('recovery');
      else if (event === 'SIGNED_IN' && session && !started) { started = true; void startCloud(session); }
      else if (event === 'SIGNED_OUT') { started = false; storeRef.current = null; setData(EMPTY_SNAPSHOT); setPhase('auth'); }
    });
    return () => sub.subscription.unsubscribe();
  }, [startCloud, startLocal]);

  const reload = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    try {
      const snap = await store.load();
      lastLoad.current = Date.now();
      setData(snap);
    } catch { /* keep current data */ }
  }, []);

  // Pick up changes made from another device when coming back to the app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && storeRef.current?.kind === 'cloud' && Date.now() - lastLoad.current > 60000) void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const upsert = useCallback(<C extends CollectionName>(col: C, rows: Row<C>[]) => {
    if (!rows.length) return;
    setData((d) => ({ ...d, [col]: mergeRows(d[col] as Row<C>[], rows) }));
    void storeRef.current?.upsert(col, rows);
  }, []);

  const remove = useCallback((col: CollectionName, ids: string[]) => {
    if (!ids.length) return;
    setData((d) => ({ ...d, [col]: dropRows(d[col] as { id: string }[], ids) }));
    void storeRef.current?.remove(col, ids);
  }, []);

  const settings = useMemo(() => ({ ...defaultSettings(), ...(data.settings[0] ?? {}) }), [data.settings]);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    upsert('settings', [{ ...settings, ...patch, id: 'me' }]);
  }, [settings, upsert]);

  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  /** Replaces every collection (restoring a backup). */
  const replaceAll = useCallback((snap: Snapshot) => {
    const current = dataRef.current;
    for (const c of COLLECTIONS) {
      const keep = new Set((snap[c] as { id: string }[]).map((r) => r.id));
      const gone = (current[c] as { id: string }[]).filter((r) => !keep.has(r.id)).map((r) => r.id);
      void storeRef.current?.remove(c, gone);
      void storeRef.current?.upsert(c, snap[c] as never);
    }
    setData(snap);
  }, []);

  const signOut = useCallback(async () => {
    safeStorage()?.removeItem(MODE_KEY);
    if (storeRef.current?.kind === 'cloud' && supabase) await supabase.auth.signOut();
    storeRef.current = null;
    setData(EMPTY_SNAPSHOT);
    setPhase(cloudEnabled ? 'auth' : 'loading');
    if (!cloudEnabled) startLocal();
  }, [startLocal]);

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const accounts = useMemo(() => [...data.accounts].sort((a, b) => a.position - b.position), [data.accounts]);
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const categories = useMemo(() => [...data.categories].sort((a, b) => a.position - b.position), [data.categories]);

  const value: AppCtx = {
    phase, errorMessage, storeKind, email, data, settings, accounts, activeAccounts, categories, sync,
    upsert, remove, saveSettings, replaceAll, startLocal, signOut, reload, toast, toasts, dismissToast, setPhase
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
