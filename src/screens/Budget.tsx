import { useMemo, useState } from 'react';
import { Plus, Wand2, Copy, Trash2, ChevronRight } from 'lucide-react';
import type { BudgetLine, BudgetMode, Category, Kind } from '../domain/types';
import { useApp } from '../state/app';
import { useUI } from '../state/ui';
import { budgetFor, compareCategories, lineId, monthlySavingsBudget, proposeFromHistory, type CategoryComparison } from '../domain/budget';
import { inMonthRange, inYear, yearTotals } from '../domain/calc';
import { MONTHS_LONG, todayStr } from '../lib/dates';
import { eur } from '../lib/format';
import { Empty, MonthNav, Progress, Segmented, YearNav } from '../ui/controls';
import { MonthColumns } from '../ui/charts';
import { BudgetLineSheet, describeLine } from './BudgetLineSheet';
import { KindToggle, ShareList, useKindToggle } from './parts';

type PeriodKind = 'month' | 'ytd' | 'year';

export function BudgetScreen() {
  const { data, categories, upsert, remove, toast } = useApp();
  const ui = useUI();
  const [year, setYear] = useState(ui.period.y);
  const [periodKind, setPeriodKind] = useState<PeriodKind>('month');
  const [month, setMonth] = useState(ui.period.y === year ? ui.period.m0 : 0);
  const [editing, setEditing] = useState<{ kind: Kind | 'savings'; categoryId: string | null } | null>(null);
  const [kind, setKind] = useKindToggle();

  const today = todayStr();
  const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7)) - 1;
  const mode = data.budgetYears.find((b) => b.year === year)?.mode ?? null;
  const lines = data.budgetLines.filter((l) => l.year === year);
  const prevLines = data.budgetLines.filter((l) => l.year === year - 1);
  const prevHasData = data.transactions.some((t) => inYear(t, year - 1) && (t.type === 'expense' || t.type === 'income'));

  const [from, to] = periodKind === 'month' ? [month, month] : periodKind === 'year' ? [0, 11] : [0, year < curY ? 11 : year > curY ? -1 : curM];
  const periodLabel = periodKind === 'month' ? MONTHS_LONG[month] : periodKind === 'year' ? `todo ${year}` : `enero – ${MONTHS_LONG[Math.max(to, 0)]}`;
  const txs = useMemo(() => (to < 0 ? [] : data.transactions.filter((t) => inMonthRange(t, year, from, to))), [data.transactions, year, from, to]);
  const budget = budgetFor(data.budgetYears, data.budgetLines, year, Math.max(from, 0), Math.max(to, 0));
  const yearBudget = budgetFor(data.budgetYears, data.budgetLines, year, 0, 11);
  const actualSavings = txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);

  const setMode = (m: BudgetMode) => upsert('budgetYears', [{ id: String(year), year, mode: m }]);

  const propose = () => {
    const proposal = proposeFromHistory(data.transactions, year - 1, year, categories);
    if (!proposal.length) { toast(`No hay movimientos de ${year - 1} para proponer un presupuesto.`); return; }
    const existing = new Set(lines.map((l) => l.id));
    const fresh = proposal.filter((l) => !existing.has(l.id));
    upsert('budgetLines', fresh);
    if (!mode) setMode('category');
    toast(fresh.length ? `Propuestas ${fresh.length} categorías a partir de ${year - 1}. Revísalas y ajusta lo que quieras.` : 'Todas las categorías ya tenían presupuesto.');
  };
  const copyPrev = () => {
    const existing = new Set(lines.map((l) => l.id));
    const copied = prevLines.map((l) => ({ ...l, id: lineId(year, l.kind, l.categoryId), year })).filter((l) => !existing.has(l.id));
    upsert('budgetLines', copied);
    const prevMode = data.budgetYears.find((b) => b.year === year - 1)?.mode;
    if (!mode && prevMode) setMode(prevMode);
    toast(`Copiado el presupuesto de ${year - 1}.`);
  };
  const clear = () => {
    if (!confirm(`¿Borrar todo el presupuesto de ${year}? Tus movimientos no se tocan.`)) return;
    const removedLines = lines, removedYear = data.budgetYears.filter((b) => b.year === year);
    remove('budgetLines', lines.map((l) => l.id));
    remove('budgetYears', [String(year)]);
    toast('Presupuesto borrado', { label: 'Deshacer', run: () => { upsert('budgetLines', removedLines); upsert('budgetYears', removedYear); } });
  };

  const tools = (
    <div className="chips" style={{ marginTop: 12 }}>
      {prevHasData && <button className="chip" onClick={propose}><Wand2 size={15} />Proponer con datos de {year - 1}</button>}
      {prevLines.length > 0 && <button className="chip" onClick={copyPrev}><Copy size={15} />Copiar {year - 1}</button>}
      {mode && <button className="chip" onClick={clear}><Trash2 size={15} />Borrar</button>}
    </div>
  );

  return (
    <>
      <div className="topbar"><h1 className="display" style={{ flex: 1 }}>Presupuesto</h1></div>
      <YearNav year={year} onChange={(y) => { setYear(y); setMonth(y === curY ? curM : 0); }} />

      {!mode ? (
        <>
          <p className="muted">Aún no hay presupuesto para {year}. Elige cómo quieres hacerlo:</p>
          <button className="choice" onClick={() => setMode('category')}>
            <div className="t">Por categorías</div>
            <div className="d">Indicas lo que prevés ingresar y gastar en cada categoría (cada mes, al año o en meses concretos). El ahorro previsto sale solo y cada categoría se compara con su presupuesto.</div>
          </button>
          <button className="choice" onClick={() => { setMode('savings'); setEditing({ kind: 'savings', categoryId: null }); }}>
            <div className="t">Solo un objetivo de ahorro</div>
            <div className="d">Indicas cuánto quieres ahorrar (cada mes, al año o mes a mes) y solo se compara eso. Verás el detalle de gastos por categoría sin comparativa.</div>
          </button>
          {tools}
        </>
      ) : (
        <>
          <Segmented value={mode} onChange={setMode}
            options={[{ value: 'category', label: 'Por categorías' }, { value: 'savings', label: 'Solo ahorro' }]} />

          <div className="hero" style={{ marginTop: 14 }}>
            <div className="hero-label">{mode === 'category' ? `Ahorro previsto en ${year}` : `Objetivo de ahorro ${year}`}</div>
            <div className="hero-amount display num">{eur(yearBudget.savings)}</div>
            <div className="hero-note">≈ {eur(yearBudget.savings / 12)} al mes</div>
            {mode === 'category' && (
              <div className="pills">
                <div className="pill"><div className="l">Ingresos previstos</div><div className="v num">{eur(yearBudget.income)}</div></div>
                <div className="pill"><div className="l">Gastos previstos</div><div className="v num">{eur(yearBudget.expense)}</div></div>
              </div>
            )}
          </div>

          <div className="section-head"><h2>Real frente a presupuesto</h2></div>
          <Segmented value={periodKind} onChange={setPeriodKind}
            options={[{ value: 'month', label: 'Mes' }, { value: 'ytd', label: 'Año hasta hoy' }, { value: 'year', label: 'Año' }]} />
          {periodKind === 'month' && <div style={{ marginTop: 10 }}><MonthNav y={year} m0={month} onChange={(y, m) => { if (y !== year) setYear(y); setMonth(m); }} /></div>}

          <div className="card" style={{ marginTop: periodKind === 'month' ? 0 : 12 }}>
            <div className="row-flex">
              <span style={{ flex: 1 }}><strong>Ahorro</strong> <span className="muted small">· {periodLabel}</span></span>
              <span className="num"><strong>{eur(actualSavings)}</strong> <span className="faint small">/ {eur(budget.savings)}</span></span>
            </div>
            <div style={{ marginTop: 8 }}>
              <Progress value={Math.max(0, actualSavings)} max={budget.savings} status={!budget.savings ? 'none' : actualSavings >= budget.savings ? 'ok' : to >= curM && year === curY ? 'warn' : 'over'} />
            </div>
            <div className="bar-meta">
              <span>{actualSavings >= budget.savings ? `Por encima en ${eur(actualSavings - budget.savings)}` : `Por debajo en ${eur(budget.savings - actualSavings)}`}</span>
              {mode === 'savings' && <button className="link" onClick={() => setEditing({ kind: 'savings', categoryId: null })}>Editar objetivo</button>}
            </div>
          </div>

          {mode === 'category' ? (
            <>
              <CategoryBudgetList title="Ingresos" kind="income" lines={lines} categories={categories} periodKind={periodKind}
                comparison={compareCategories(txs, budget, categories, 'income', 1)} onEdit={(id) => setEditing({ kind: 'income', categoryId: id })} />
              <CategoryBudgetList title="Gastos" kind="expense" lines={lines} categories={categories} periodKind={periodKind}
                comparison={compareCategories(txs, budget, categories, 'expense', 1)} onEdit={(id) => setEditing({ kind: 'expense', categoryId: id })} />
            </>
          ) : (
            <>
              <div className="section-head"><h2>Objetivo por mes</h2>
                <button className="link" onClick={() => setEditing({ kind: 'savings', categoryId: null })}>{lines.some((l) => l.kind === 'savings') ? describeLine(lines.find((l) => l.kind === 'savings')!) : 'Definir'}</button>
              </div>
              <div className="card">
                <MonthColumns height={180} highlight={year === curY ? curM : undefined}
                  series={[{ label: 'Ahorro real', color: 'var(--series-1)', values: yearTotals(data.transactions, year).map((t) => t.savings) }]}
                  target={monthlySavingsBudget(data.budgetYears, data.budgetLines, year)} />
              </div>
              <div className="section-head"><h2>Detalle por categoría</h2><span className="small muted">{periodLabel}</span></div>
              <div className="card">
                <KindToggle value={kind} onChange={setKind} />
                <ShareList txs={txs} kind={kind} months={Math.max(1, to - from + 1)} />
              </div>
            </>
          )}
          {tools}
        </>
      )}
      {editing && <BudgetLineSheet year={year} kind={editing.kind} categoryId={editing.categoryId} onClose={() => setEditing(null)} />}
      {mode === 'category' && !lines.length && <Empty>Toca una categoría para presupuestarla, o usa «Proponer» para empezar con tus datos reales.</Empty>}
    </>
  );
}

function CategoryBudgetList({ title, kind, comparison, lines, categories, periodKind, onEdit }: {
  title: string; kind: Kind; comparison: CategoryComparison[]; lines: BudgetLine[]; categories: Category[]; periodKind: PeriodKind; onEdit: (id: string) => void;
}) {
  const byId = new Map(comparison.map((c) => [c.categoryId, c]));
  const ofKind = categories.filter((c) => c.kind === kind && !c.archived);
  const withBudget = ofKind.filter((c) => lines.some((l) => l.categoryId === c.id));
  const without = ofKind.filter((c) => !lines.some((l) => l.categoryId === c.id));
  const totalBudget = withBudget.reduce((s, c) => s + (byId.get(c.id)?.budget ?? 0), 0);
  const totalActual = comparison.reduce((s, c) => s + c.actual, 0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="small muted num">{eur(totalActual)} / {eur(totalBudget)}</span>
      </div>
      <div className="card">
        {withBudget.length === 0 && <p className="muted small" style={{ margin: 0 }}>Ninguna categoría de {title.toLowerCase()} presupuestada todavía.</p>}
        {withBudget.map((c) => {
          const r = byId.get(c.id);
          const line = lines.find((l) => l.categoryId === c.id)!;
          const actual = r?.actual ?? 0, b = r?.budget ?? 0;
          const status = r?.status === 'over' && kind === 'income' ? 'warn' : r?.status ?? 'ok';
          return (
            <button key={c.id} className="cat-line" style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', display: 'block', padding: '10px 0' }} onClick={() => onEdit(c.id)}>
              <div className="head">
                <span className="emoji">{c.icon}</span>
                <span className="name">{c.name}<div className="xsmall muted">{describeLine(line)}</div></span>
                <span className="val">{eur(actual)} <span className="faint small">/ {eur(b)}</span></span>
                <ChevronRight size={16} className="faint" />
              </div>
              <Progress value={actual} max={b} status={b ? status : 'none'} />
              <div className="bar-meta">
                <span>{kind === 'expense' ? (b - actual >= 0 ? `Quedan ${eur(b - actual)}` : `Te has pasado ${eur(actual - b)}`) : (b - actual > 0 ? `Faltan ${eur(b - actual)}` : 'Conseguido')}</span>
                {line.pattern === 'annual' && periodKind === 'month' && <span>Anual: mira «Año hasta hoy»</span>}
              </div>
            </button>
          );
        })}
        {without.length > 0 && (
          <div style={{ marginTop: withBudget.length ? 8 : 12 }}>
            <button className="link" onClick={() => setOpen(!open)}><Plus size={14} style={{ verticalAlign: -2 }} /> Presupuestar otra categoría ({without.length})</button>
            {open && (
              <div className="chips" style={{ marginTop: 8 }}>
                {without.map((c) => {
                  const spent = byId.get(c.id)?.actual;
                  return <button key={c.id} className="chip" onClick={() => { setOpen(false); onEdit(c.id); }}>{c.icon} {c.name}{spent ? <span className="faint">· {eur(spent)}</span> : null}</button>;
                })}
              </div>
            )}
          </div>
        )}
        {comparison.some((r) => !r.budget && r.actual && !ofKind.some((c) => c.id === r.categoryId)) && (
          <p className="hint">Hay movimientos sin categoría en este periodo.</p>
        )}
      </div>
    </>
  );
}
