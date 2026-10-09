import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { budgetFor, compareCategories, inScope, monthlySavingsBudget, type Scope } from '../domain/budget';
import { inMonthRange, sumTotals, yearTotals } from '../domain/calc';
import { MONTHS_LONG, MONTHS_SHORT, todayStr } from '../lib/dates';
import { eur } from '../lib/format';
import { Segmented, YearNav } from '../ui/controls';
import { CompareList, KindToggle, ScopeChips, ShareList, useKindToggle } from './parts';
import { downloadCSV } from './backup';

type PeriodMode = 'month' | 'range' | 'year';

export function ReportsScreen() {
  const { data, categories, properties, activeProperties } = useApp();
  const ui = useUI();
  const lookups = useLookups();
  const today = todayStr();
  const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7)) - 1;
  const [year, setYear] = useState(ui.period.y);
  const [kind, setKind] = useKindToggle();
  // Period: one month, a run of months (e.g. January–March) or the whole year.
  const [mode, setMode] = useState<PeriodMode>(year === curY ? 'range' : 'year');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(year === curY ? curM : 11);
  const [month, setMonth] = useState(year === curY ? curM : 0);
  const [f, t] = mode === 'year' ? [0, 11] : mode === 'month' ? [month, month] : [from, to];
  const lastMonth = year < curY ? 11 : year > curY ? -1 : curM;
  const label = f === 0 && t === 11 ? `todo ${year}` : f === t ? `${MONTHS_LONG[f]} ${year}` : `${MONTHS_LONG[f]} – ${MONTHS_LONG[t]} ${year}`;

  const changeYear = (y: number) => {
    setYear(y);
    if (y === curY) { setTo(curM); setMonth(curM); } else { setTo(11); setMonth(0); }
    setFrom(0);
  };

  const months = useMemo(() => yearTotals(data.transactions, year), [data.transactions, year]);
  const inPeriod = months.map((m, i) => ({ ...m, i })).slice(f, t + 1);
  const total = sumTotals(inPeriod);
  const targets = monthlySavingsBudget(data.budgetYears, data.budgetLines, year);
  const hasTargets = targets.slice(f, t + 1).some(Boolean);
  // Target of the months that already have movements, so the deviation compares like with like.
  const elapsedTarget = inPeriod.reduce((s, m) => s + (m.income || m.expense ? targets[m.i] : 0), 0);
  const txs = useMemo(() => data.transactions.filter((x) => inMonthRange(x, year, f, t)), [data.transactions, year, f, t]);
  const rate = total.income > 0 ? Math.round((total.savings / total.income) * 100) : null;
  // Months of the period already lived (for monthly averages and how far incomes should be).
  const livedTo = Math.min(t, lastMonth);
  const lived = Math.max(0, livedTo - f + 1);
  const elapsed = lived / (t - f + 1);

  // Homes (cost centres): totals per home and the category detail of the chosen one.
  const [pickedScope, setScope] = useState<Scope>('all');
  const homes = activeProperties.length > 0;
  const scope: Scope = homes && (pickedScope === null || activeProperties.some((p) => p.id === pickedScope)) ? pickedScope : 'all';
  const scopedTxs = useMemo(() => txs.filter((x) => inScope(x, scope)), [txs, scope]);
  const scopedBudget = budgetFor(data.budgetYears, data.budgetLines, year, f, t, scope);
  const perHome = useMemo(() => {
    if (!homes) return [];
    const list = [{ id: null as string | null, name: 'General', icon: '📋' }, ...properties.filter((p) => !p.archived || txs.some((x) => x.propertyId === p.id))];
    return list.map((h) => {
      const tx = txs.filter((x) => inScope(x, h.id));
      const b = budgetFor(data.budgetYears, data.budgetLines, year, f, t, h.id);
      const sum = (k: string) => tx.filter((x) => x.type === k).reduce((s, x) => s + x.amount, 0);
      return { ...h, expense: sum('expense'), income: sum('income'), budget: b.mode === 'category' ? b.expense : null };
    });
  }, [homes, properties, txs, data.budgetYears, data.budgetLines, year, f, t]);

  const monthOptions = MONTHS_LONG.map((m, i) => <option key={m} value={i}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>);

  return (
    <>
      <div className="topbar">
        <h1 className="display" style={{ flex: 1 }}>Informes</h1>
        <button className="icon-btn" title="Descargar movimientos del periodo (CSV)" aria-label="Descargar movimientos del periodo (CSV)"
          onClick={() => downloadCSV(txs, lookups, `movimientos-${year}-${f + 1}-${t + 1}.csv`)}><Download size={18} /></button>
      </div>
      <YearNav year={year} onChange={changeYear} />

      <Segmented value={mode} onChange={setMode}
        options={[{ value: 'month', label: 'Un mes' }, { value: 'range', label: 'Varios meses' }, { value: 'year', label: 'Año entero' }]} />
      {mode === 'month' && (
        <div className="row-flex" style={{ marginTop: 10 }}>
          <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mes">{monthOptions}</select>
        </div>
      )}
      {mode === 'range' && (
        <div className="row-flex" style={{ marginTop: 10 }}>
          <label style={{ flex: 1 }}><span className="small muted">Desde</span>
            <select className="input" value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (v > to) setTo(v); }}>{monthOptions}</select>
          </label>
          <label style={{ flex: 1 }}><span className="small muted">Hasta</span>
            <select className="input" value={to} onChange={(e) => { const v = Number(e.target.value); setTo(v); if (v < from) setFrom(v); }}>{monthOptions}</select>
          </label>
        </div>
      )}

      <div className="hero" style={{ marginTop: 14 }}>
        <div className="hero-label">Ahorrado · {label}</div>
        <div className="hero-amount display num">{eur(total.savings)}</div>
        <div className="hero-note">
          {[rate != null ? `Tasa de ahorro ${rate} % de los ingresos` : '', hasTargets ? `Objetivo ${eur(elapsedTarget)}` : ''].filter(Boolean).join(' · ')}
        </div>
        <div className="pills">
          <div className="pill"><div className="l">Ingresos</div><div className="v num">{eur(total.income)}</div>{lived > 1 && <div className="l">{eur(total.income / lived)} / mes</div>}</div>
          <div className="pill"><div className="l">Gastos</div><div className="v num">{eur(total.expense)}</div>{lived > 1 && <div className="l">{eur(total.expense / lived)} / mes</div>}</div>
        </div>
      </div>

      {t > f && (
        <>
          <div className="section-head"><h2>Mes a mes</h2><span className="small muted">ahorro</span></div>
          <div className="card table-wrap" style={{ padding: '6px 10px' }}>
            <table className="table">
              <thead><tr><th>Mes</th><th>Real</th><th>Objetivo</th><th>Desviación</th></tr></thead>
              <tbody>
                {inPeriod.map((m) => {
                  const empty = !m.income && !m.expense;
                  const dev = !empty && targets[m.i] ? m.savings - targets[m.i] : null;
                  return (
                    <tr key={m.i} className={empty && !targets[m.i] ? 'dim' : ''}>
                      <td>{MONTHS_SHORT[m.i]}</td>
                      <td className={m.savings < 0 ? 'neg' : ''}>{empty ? '—' : eur(m.savings)}</td>
                      <td>{targets[m.i] ? eur(targets[m.i]) : '—'}</td>
                      <td className={dev == null ? '' : dev >= 0 ? 'pos' : 'neg'}>{dev == null ? '—' : `${dev > 0 ? '+' : ''}${eur(dev)}`}</td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td>Total</td><td>{eur(total.savings)}</td>
                  <td>{hasTargets ? eur(elapsedTarget) : '—'}</td>
                  <td className={hasTargets ? (total.savings >= elapsedTarget ? 'pos' : 'neg') : ''}>{hasTargets ? `${total.savings - elapsedTarget > 0 ? '+' : ''}${eur(total.savings - elapsedTarget)}` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {hasTargets && <p className="hint">Desviación = ahorro real − objetivo del mes; en positivo has ahorrado más de lo previsto. El total compara solo los meses con movimientos.</p>}
        </>
      )}

      {homes && (
        <>
          <div className="section-head"><h2>Por vivienda</h2><span className="small muted">{label}</span></div>
          <div className="card table-wrap" style={{ padding: '6px 10px' }}>
            <table className="table">
              <thead><tr><th>Vivienda</th><th>Gastos</th>{perHome.some((h) => h.budget != null) && <th>Presup.</th>}<th>Ingresos</th></tr></thead>
              <tbody>
                {perHome.map((h) => (
                  <tr key={String(h.id)} onClick={() => setScope(h.id)} style={{ cursor: 'pointer' }} className={scope === h.id ? 'total' : ''}>
                    <td style={{ textTransform: 'none' }}>{h.icon} {h.name}</td>
                    <td>{eur(h.expense)}</td>
                    {perHome.some((x) => x.budget != null) && <td className={h.budget != null && h.expense > h.budget ? 'neg' : ''}>{h.budget != null ? eur(h.budget) : '—'}</td>}
                    <td>{h.income ? eur(h.income) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-head"><h2>Por categoría</h2><span className="small muted">{label}</span></div>
      {homes && <div style={{ marginBottom: 10 }}><ScopeChips value={scope} onChange={setScope} /></div>}
      <div className="card">
        <KindToggle value={kind} onChange={setKind} />
        {scopedBudget.mode === 'category'
          ? <CompareList rows={compareCategories(scopedTxs, scopedBudget, categories, kind, elapsed)} kind={kind} />
          : <ShareList txs={scopedTxs} kind={kind} months={Math.max(1, lived)} />}
      </div>
    </>
  );
}
