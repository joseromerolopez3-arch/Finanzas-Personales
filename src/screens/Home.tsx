import { useMemo } from 'react';
import { ArrowRight, Inbox, Link2Off } from 'lucide-react';
import { daysLeft } from '../data/bank';
import { useToReview } from './Review';
import { HouseholdSwitch } from './Usage';
import { useApp } from '../state/app';
import { useUI } from '../state/ui';
import { inMonth, totals } from '../domain/calc';
import { budgetFor, compareCategories } from '../domain/budget';
import { upcoming } from '../domain/recurring';
import { daysInMonth, makeDate, monthKey, MONTHS_LONG, todayStr } from '../lib/dates';
import { eur, round2 } from '../lib/format';
import { MonthNav, Progress } from '../ui/controls';
import { AccountsCard, BellButton, CompareList, KindToggle, OccurrenceRow, ShareList, SyncDot, useKindToggle, usePending } from './parts';

export function HomeScreen() {
  const { data, settings, categories, bank, households } = useApp();
  const toReview = useToReview();
  const renew = bank.links.filter((l) => l.status === 'expired' || (daysLeft(l.validUntil) ?? 99) <= 7);
  const ui = useUI();
  const { y, m0 } = ui.period;
  const [kind, setKind] = useKindToggle();
  const today = todayStr();
  const isCurrent = monthKey(y, m0) === today.slice(0, 7);
  const elapsed = isCurrent ? Number(today.slice(8, 10)) / daysInMonth(y, m0) : monthKey(y, m0) < today.slice(0, 7) ? 1 : 0;

  const txs = useMemo(() => data.transactions.filter((t) => inMonth(t, y, m0)), [data.transactions, y, m0]);
  const t = totals(txs);
  const budget = budgetFor(data.budgetYears, data.budgetLines, y, m0, m0);
  const comparison = budget.mode === 'category' ? compareCategories(txs, budget, categories, kind, elapsed) : [];
  const pendingList = usePending();

  // Expected until month end: scheduled items with an amount not registered yet.
  const forecast = useMemo(() => {
    if (!isCurrent) return null;
    const rest = upcoming(data.recurring, data.recurringLog, today, makeDate(y, m0, 31)).filter((o) => o.recurring.amount);
    const overdue = pendingList.filter((o) => o.dueDate.slice(0, 7) === today.slice(0, 7) && o.recurring.amount && !rest.some((r) => r.key === o.key));
    const all = [...rest, ...overdue];
    if (!all.length) return null;
    const delta = all.reduce((s, o) => s + (o.recurring.type === 'income' ? 1 : -1) * (o.recurring.amount || 0), 0);
    return { count: all.length, savings: round2(t.savings + delta) };
  }, [isCurrent, data.recurring, data.recurringLog, pendingList, today, y, m0, t.savings]);

  const target = budget.savings;
  const hasTarget = budget.hasBudget && budget.mode !== null;
  const ratio = target > 0 ? t.savings / target : 0;
  const status = !hasTarget ? 'none' : t.savings >= target ? 'ok' : isCurrent ? 'warn' : 'over';

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}>
          <h1 className="display">{settings.name ? `Hola, ${settings.name}` : 'Resumen'}</h1>
          <div className="sub">{households.length > 1 ? <HouseholdSwitch /> : 'Lo que entra, lo que sale y lo que queda'} <SyncDot /></div>
        </div>
        <BellButton />
      </div>

      <MonthNav y={y} m0={m0} onChange={ui.setPeriod} />

      <div className="hero">
        <div className="hero-label">Ahorro de {MONTHS_LONG[m0]}</div>
        <div className={`hero-amount display num`}>{eur(t.savings)}</div>
        {hasTarget ? (
          <>
            <div className="hero-note">
              {budget.mode === 'category' ? 'Ahorro presupuestado' : 'Objetivo de ahorro'}: {eur(target)}
              {target > 0 && ` · ${Math.round(Math.max(0, ratio) * 100)} %`}
            </div>
            <div style={{ marginTop: 10 }}><Progress value={Math.max(0, t.savings)} max={target} status={status} marker={isCurrent ? elapsed : undefined} /></div>
            <div className="bar-meta">
              <span>{t.savings >= target ? '¡Objetivo cumplido!' : `Faltan ${eur(target - t.savings)}`}</span>
              {forecast && <span>Previsión fin de mes: {eur(forecast.savings)}</span>}
            </div>
          </>
        ) : (
          forecast && <div className="hero-note">Previsión a fin de mes con {forecast.count} pagos/ingresos programados: {eur(forecast.savings)}</div>
        )}
        <div className="pills">
          <div className="pill">
            <div className="l">Ingresos</div>
            <div className="v num">{eur(t.income)}</div>
            {budget.mode === 'category' && budget.income > 0 && <div className="l">de {eur(budget.income)}</div>}
          </div>
          <div className="pill">
            <div className="l">Gastos</div>
            <div className="v num">{eur(t.expense)}</div>
            {budget.mode === 'category' && budget.expense > 0 && <div className="l">de {eur(budget.expense)}</div>}
          </div>
        </div>
      </div>

      {renew.length > 0 && (
        <button className="card" style={{ width: '100%', textAlign: 'left', marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--gold)' }} onClick={() => ui.openBanks()}>
          <Link2Off size={22} />
          <span style={{ flex: 1 }}>
            <strong>Renueva la conexión con {renew.map((l) => l.aspspName).join(', ')}</strong>
            <div className="small muted">{renew.some((l) => l.status === 'expired') ? 'La autorización ha caducado y no se descargan movimientos.' : 'La autorización caduca en pocos días.'}</div>
          </span>
          <ArrowRight size={18} />
        </button>
      )}

      {toReview.length > 0 && (
        <button className="card" style={{ width: '100%', textAlign: 'left', marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }} onClick={ui.openReview}>
          <Inbox size={22} />
          <span style={{ flex: 1 }}>
            <strong>{toReview.length} movimiento{toReview.length > 1 ? 's' : ''} del banco por revisar</strong>
            <div className="small muted">Confirma la categoría con un toque.</div>
          </span>
          <ArrowRight size={18} />
        </button>
      )}

      {!budget.mode && (
        <button className="card" style={{ width: '100%', textAlign: 'left', marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => ui.goTab('budget')}>
          <span style={{ fontSize: 24 }}>🎯</span>
          <span style={{ flex: 1 }}>
            <strong>Crea tu presupuesto de {y}</strong>
            <div className="small muted">Por categorías o con un objetivo de ahorro mensual.</div>
          </span>
          <ArrowRight size={18} />
        </button>
      )}

      {pendingList.length > 0 && (
        <>
          <div className="section-head">
            <h2>Pendientes de registrar</h2>
            <button className="link" onClick={ui.openRecurring}>Ver todos ({pendingList.length})</button>
          </div>
          <div className="card flush">
            {pendingList.slice(0, 3).map((o) => <OccurrenceRow key={o.key} o={o} compact />)}
          </div>
        </>
      )}

      <div className="section-head"><h2>Cuentas</h2></div>
      <AccountsCard />

      <div className="section-head">
        <h2>{budget.mode === 'category' ? 'Presupuesto por categoría' : 'Por categoría'}</h2>
        <button className="link" onClick={() => ui.goTab('movements')}>Movimientos</button>
      </div>
      <div className="card">
        <KindToggle value={kind} onChange={setKind} />
        <div style={{ marginTop: 6 }}>
          {budget.mode === 'category' ? <CompareList rows={comparison} kind={kind} /> : <ShareList txs={txs} kind={kind} />}
        </div>
      </div>
    </>
  );
}
