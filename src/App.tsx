import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Home, List, PiggyBank, Plus, Settings as Cog } from 'lucide-react';
import { AppProvider, useApp } from './state/app';
import { UICtx, type Tab, type TxSheetOptions, type UI } from './state/ui';
import { AuthScreen } from './screens/Auth';
import { Onboarding } from './screens/Onboarding';
import { HomeScreen } from './screens/Home';
import { MovementsScreen } from './screens/Movements';
import { BudgetScreen } from './screens/Budget';
import { ReportsScreen } from './screens/Reports';
import { SettingsScreen } from './screens/Settings';
import { TransactionSheet } from './screens/TransactionSheet';
import { RecurringSheet } from './screens/Recurring';
import { ImportSheet } from './screens/Import';
import { AccountSheet } from './screens/Accounts';
import { Toasts } from './ui/Toasts';
import { todayStr } from './lib/dates';

export default function App() {
  return (
    <AppProvider>
      <Root />
      <Toasts />
    </AppProvider>
  );
}

function Root() {
  const { phase, settings, errorMessage, signOut, reload, startLocal } = useApp();
  if (phase === 'loading') return <div className="auth"><div className="display muted" style={{ fontSize: 22 }}>Cuentas Personales</div></div>;
  if (phase === 'auth' || phase === 'recovery') return <AuthScreen />;
  if (phase === 'schema' || phase === 'error') {
    return (
      <div className="auth">
        <div className="auth-box stack">
          <h1 className="display">{phase === 'schema' ? 'Falta actualizar la base de datos' : 'No se pudieron cargar tus datos'}</h1>
          <p className="muted">
            {phase === 'schema'
              ? 'La nueva versión necesita sus tablas en Supabase. Ejecuta la migración supabase/migrations del repositorio en el SQL Editor de tu proyecto y vuelve a intentarlo. Tus datos anteriores no se tocan y se importarán solos.'
              : errorMessage}
          </p>
          <button className="btn primary block" onClick={() => location.reload()}>Reintentar</button>
          {phase === 'error' && <button className="btn block" onClick={() => void reload()}>Volver a cargar</button>}
          <button className="btn block" onClick={startLocal}>Usar sin cuenta en este dispositivo</button>
          <button className="btn danger block" onClick={() => void signOut()}>Cerrar sesión</button>
        </div>
      </div>
    );
  }
  if (!settings.onboarded) return <Onboarding />;
  return <Shell />;
}

const TABS: { id: Tab; label: string; icon: typeof Home; hash: string }[] = [
  { id: 'home', label: 'Resumen', icon: Home, hash: '' },
  { id: 'movements', label: 'Movimientos', icon: List, hash: 'movimientos' },
  { id: 'budget', label: 'Presupuesto', icon: PiggyBank, hash: 'presupuesto' },
  { id: 'reports', label: 'Informes', icon: BarChart3, hash: 'informes' },
  { id: 'settings', label: 'Ajustes', icon: Cog, hash: 'ajustes' }
];
const tabFromHash = (): Tab => TABS.find((t) => t.hash && `#${t.hash}` === location.hash)?.id ?? 'home';

function Shell() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [txSheet, setTxSheet] = useState<TxSheetOptions | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [importFor, setImportFor] = useState<string | null | undefined>(undefined);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [period, setPeriodState] = useState(() => ({ y: Number(todayStr().slice(0, 4)), m0: Number(todayStr().slice(5, 7)) - 1 }));

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goTab = useCallback((t: Tab) => {
    const hash = TABS.find((x) => x.id === t)!.hash;
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);

  const ui: UI = useMemo(() => ({
    tab, goTab,
    openTx: (o) => setTxSheet(o ?? {}),
    openRecurring: () => setRecurringOpen(true),
    openImport: (id) => setImportFor(id ?? null),
    openAccount: (id) => setAccountId(id),
    period,
    setPeriod: (y, m0) => setPeriodState({ y, m0 })
  }), [tab, goTab, period]);

  return (
    <UICtx.Provider value={ui}>
      <div className="shell">
        <nav className="side" aria-label="Secciones">
          <div className="brand display">Cuentas Personales</div>
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => goTab(t.id)}>
              <t.icon size={20} />{t.label}
            </button>
          ))}
          <button className="btn primary new-btn" onClick={() => setTxSheet({})}><Plus size={18} />Nuevo movimiento</button>
        </nav>
        <main className="main">
          {tab === 'home' && <HomeScreen />}
          {tab === 'movements' && <MovementsScreen />}
          {tab === 'budget' && <BudgetScreen />}
          {tab === 'reports' && <ReportsScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </main>
        <button className="fab" onClick={() => setTxSheet({})} aria-label="Nuevo movimiento"><Plus size={26} /></button>
        <nav className="tabbar" aria-label="Secciones">
          <div className="tabbar-inner">
            {TABS.map((t) => (
              <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => goTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
                <t.icon size={22} />{t.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
      {txSheet && <TransactionSheet {...txSheet} onClose={() => setTxSheet(null)} />}
      {recurringOpen && <RecurringSheet onClose={() => setRecurringOpen(false)} />}
      {importFor !== undefined && <ImportSheet accountId={importFor} onClose={() => setImportFor(undefined)} />}
      {accountId && <AccountSheet id={accountId} onClose={() => setAccountId(null)} />}
    </UICtx.Provider>
  );
}
