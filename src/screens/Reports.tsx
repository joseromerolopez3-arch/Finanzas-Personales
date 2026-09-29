import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { budgetFor, compareCategories, monthlySavingsBudget } from '../domain/budget';
import { inYear, netWorth, sumTotals, yearTotals } from '../domain/calc';
import { makeDate, MONTHS_SHORT, todayStr } from '../lib/dates';
import { eur } from '../lib/format';
import { YearNav } from '../ui/controls';
import { LineChart, MonthColumns } from '../ui/charts';
import { CompareList, KindToggle, ShareList, useKindToggle } from './parts';
import { downloadCSV } from './backup';

export function ReportsScreen() {
  const { data, activeAccounts, categories } = useApp();
  const ui = useUI();
  const lookups = useLookups();
  const [year, setYear] = useState(ui.period.y);
  const [kind, setKind] = useKindToggle();
  const today = todayStr();
  const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7)) - 1;
  const lastMonth = year < curY ? 11 : year > curY ? -1 : curM;

  const months = useMemo(() => yearTotals(data.transactions, year), [data.transactions, year]);
  const total = sumTotals(months);
  const targets = monthlySavingsBudget(data.budgetYears, data.budgetLines, year);
  const hasTargets = targets.some(Boolean);
  const budget = budgetFor(data.budgetYears, data.budgetLines, year, 0, 11);
  const txsYear = useMemo(() => data.transactions.filter((t) => inYear(t, year)), [data.transactions, year]);
  const rate = total.income > 0 ? Math.round((total.savings / total.income) * 100) : null;
  // Months before the app started tracking (earliest opening date or movement) are left blank.
  const worth = useMemo(() => {
    const start = [...activeAccounts.map((a) => a.openingDate), ...data.transactions.map((t) => t.date)].sort()[0] ?? today;
    return MONTHS_SHORT.map((_, m) => {
      const end = makeDate(year, m, 31);
      return m <= lastMonth && end >= start ? netWorth(activeAccounts, data.transactions, end) : null;
    });
  }, [activeAccounts, data.transactions, year, lastMonth, today]);
  const monthsElapsed = Math.max(1, lastMonth + 1);

  return (
    <>
      <div className="topbar">
        <h1 className="display" style={{ flex: 1 }}>Informes</h1>
        <button className="icon-btn" title="Descargar movimientos del año (CSV)" aria-label="Descargar movimientos del año (CSV)"
          onClick={() => downloadCSV(txsYear, lookups, `movimientos-${year}.csv`)}><Download size={18} /></button>
      </div>
      <YearNav year={year} onChange={setYear} />

      <div className="hero">
        <div className="hero-label">Ahorrado en {year}</div>
        <div className="hero-amount display num">{eur(total.savings)}</div>
        <div className="hero-note">
          {rate != null && `Tasa de ahorro ${rate} % de los ingresos`}
          {hasTargets && ` · Objetivo del año ${eur(budget.savings)}`}
        </div>
        <div className="pills">
          <div className="pill"><div className="l">Ingresos</div><div className="v num">{eur(total.income)}</div><div className="l">{eur(total.income / monthsElapsed)} / mes</div></div>
          <div className="pill"><div className="l">Gastos</div><div className="v num">{eur(total.expense)}</div><div className="l">{eur(total.expense / monthsElapsed)} / mes</div></div>
        </div>
      </div>

      <div className="section-head"><h2>Ahorro por mes</h2></div>
      <div className="card">
        <MonthColumns series={[{ label: 'Ahorro real', color: 'var(--series-1)', values: months.map((m) => m.savings) }]}
          target={hasTargets ? targets : null} targetLabel="Objetivo" highlight={year === curY ? curM : undefined} />
      </div>

      <div className="section-head"><h2>Ingresos y gastos</h2></div>
      <div className="card">
        <MonthColumns series={[
          { label: 'Ingresos', color: 'var(--series-income)', values: months.map((m) => m.income) },
          { label: 'Gastos', color: 'var(--series-expense)', values: months.map((m) => m.expense) }
        ]} highlight={year === curY ? curM : undefined} />
      </div>

      <div className="section-head"><h2>Mes a mes</h2></div>
      <div className="card table-wrap" style={{ padding: '6px 10px' }}>
        <table className="table">
          <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorro</th>{hasTargets && <th>Objetivo</th>}{hasTargets && <th>Dif.</th>}</tr></thead>
          <tbody>
            {months.map((m, i) => {
              const empty = !m.income && !m.expense;
              return (
                <tr key={i} className={empty ? 'dim' : ''}>
                  <td>{MONTHS_SHORT[i]}</td>
                  <td>{empty ? '—' : eur(m.income)}</td>
                  <td>{empty ? '—' : eur(m.expense)}</td>
                  <td className={m.savings < 0 ? 'neg' : ''}>{empty ? '—' : eur(m.savings)}</td>
                  {hasTargets && <td>{targets[i] ? eur(targets[i]) : '—'}</td>}
                  {hasTargets && <td className={!empty && targets[i] ? (m.savings >= targets[i] ? 'pos' : 'neg') : ''}>{!empty && targets[i] ? eur(m.savings - targets[i]) : '—'}</td>}
                </tr>
              );
            })}
            <tr className="total">
              <td>Total</td><td>{eur(total.income)}</td><td>{eur(total.expense)}</td><td>{eur(total.savings)}</td>
              {hasTargets && <td>{eur(budget.savings)}</td>}
              {hasTargets && <td className={total.savings >= budget.savings ? 'pos' : 'neg'}>{eur(total.savings - budget.savings)}</td>}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-head"><h2>Por categoría</h2><span className="small muted">{year}</span></div>
      <div className="card">
        <KindToggle value={kind} onChange={setKind} />
        {budget.mode === 'category'
          ? <CompareList rows={compareCategories(txsYear, budget, categories, kind, lastMonth < 0 ? 0 : (lastMonth + 1) / 12)} kind={kind} />
          : <ShareList txs={txsYear} kind={kind} months={monthsElapsed} />}
      </div>

      {worth.some((v) => v != null) && (
        <>
          <div className="section-head"><h2>Patrimonio a fin de mes</h2><span className="small muted">suma de tus cuentas</span></div>
          <div className="card"><LineChart values={worth} labels={MONTHS_SHORT} /></div>
        </>
      )}
    </>
  );
}
