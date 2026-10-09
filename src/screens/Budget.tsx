import { useState } from 'react';
import { Plus, Wand2, Copy, Trash2, ChevronRight } from 'lucide-react';
import type { BudgetLine, BudgetMode, Category, Kind } from '../domain/types';
import { useApp } from '../state/app';
import { useUI } from '../state/ui';
import { budgetFor, inScope, lineId, lineTotal, proposeFromHistory, type Scope } from '../domain/budget';
import { inYear } from '../domain/calc';
import { eur } from '../lib/format';
import { Empty, Segmented, YearNav } from '../ui/controls';
import { BudgetLineSheet, describeLine } from './BudgetLineSheet';
import { ScopeChips } from './parts';
import { useLookups } from '../state/hooks';
import { Sheet } from '../ui/Sheet';

/**
 * Where the budget is written and adjusted. Comparing it with what actually happened
 * is done in Informes (and the month at a glance in Resumen).
 */
export function BudgetScreen() {
  const { data, categories, upsert, remove, toast, activeProperties } = useApp();
  const { home } = useLookups();
  const ui = useUI();
  const [year, setYear] = useState(ui.period.y);
  const [editing, setEditing] = useState<{ kind: Kind | 'savings'; categoryId: string | null; propertyId?: string | null } | null>(null);
  const [splitting, setSplitting] = useState<{ kind: Kind; categoryId: string } | null>(null);
  // With several homes: 'all' = everything added up, null = General, or one home.
  const [pickedScope, setScope] = useState<Scope>('all');
  const homes = activeProperties.length > 0;
  const scope: Scope = homes && (pickedScope === null || activeProperties.some((p) => p.id === pickedScope)) ? pickedScope : 'all';
  const scopeName = scope === 'all' ? '' : scope === null ? 'General' : home(scope)?.name ?? '';

  const mode = data.budgetYears.find((b) => b.year === year)?.mode ?? null;
  const lines = data.budgetLines.filter((l) => l.year === year);
  const scopedLines = lines.filter((l) => l.kind !== 'savings' && inScope(l, scope));
  const savingsLine = lines.find((l) => l.kind === 'savings');
  const prevLines = data.budgetLines.filter((l) => l.year === year - 1);
  const prevHasData = data.transactions.some((t) => inYear(t, year - 1) && (t.type === 'expense' || t.type === 'income'));
  const yearBudget = budgetFor(data.budgetYears, data.budgetLines, year, 0, 11, scope);

  const writeMode = (m: BudgetMode) => upsert('budgetYears', [{ id: String(year), year, mode: m }]);
  // Changing the way of budgeting a year that already has amounts is asked first (it is easy to tap by mistake).
  const changeMode = (m: BudgetMode) => {
    if (m === mode) return;
    const has = m === 'savings' ? lines.some((l) => l.kind !== 'savings') : !!savingsLine;
    const text = m === 'savings'
      ? `¿Presupuestar ${year} solo con un objetivo de ahorro? Tus importes por categoría se guardan, pero dejarán de compararse hasta que vuelvas a «Por categorías».`
      : `¿Presupuestar ${year} por categorías? El objetivo de ahorro se guarda, pero el ahorro previsto pasará a calcularse con las categorías.`;
    if (has && !confirm(text)) return;
    writeMode(m);
  };

  const editCategory = (kind: Kind, categoryId: string) => {
    if (homes && scope === 'all') setSplitting({ kind, categoryId });
    else setEditing({ kind, categoryId, propertyId: scope === 'all' ? null : scope });
  };

  const propose = () => {
    const scopes: (string | null)[] = scope !== 'all' ? [scope] : [null, ...activeProperties.map((p) => p.id)];
    const proposal = scopes.flatMap((sc) => proposeFromHistory(data.transactions, year - 1, year, categories, sc));
    if (!proposal.length) { toast(`No hay movimientos de ${year - 1} para proponer un presupuesto.`); return; }
    const existing = new Set(lines.map((l) => l.id));
    const fresh = proposal.filter((l) => !existing.has(l.id));
    upsert('budgetLines', fresh);
    if (!mode) writeMode('category');
    toast(fresh.length ? `Propuestas ${fresh.length} categorías a partir de ${year - 1}. Revísalas y ajusta lo que quieras.` : 'Todas las categorías ya tenían presupuesto.');
  };
  const copyPrev = () => {
    const existing = new Set(lines.map((l) => l.id));
    const copied = prevLines.map((l) => ({ ...l, id: lineId(year, l.kind, l.categoryId, l.propertyId ?? null), year })).filter((l) => !existing.has(l.id));
    upsert('budgetLines', copied);
    const prevMode = data.budgetYears.find((b) => b.year === year - 1)?.mode;
    if (!mode && prevMode) writeMode(prevMode);
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
    <div className="chips" style={{ marginTop: 16 }}>
      {prevHasData && <button className="chip" onClick={propose}><Wand2 size={15} />Proponer con datos de {year - 1}</button>}
      {prevLines.length > 0 && <button className="chip" onClick={copyPrev}><Copy size={15} />Copiar {year - 1}</button>}
      {mode && <button className="chip" onClick={clear}><Trash2 size={15} />Borrar</button>}
    </div>
  );

  const net = mode === 'category' && scope !== 'all' ? -yearBudget.savings : yearBudget.savings;
  return (
    <>
      <div className="topbar"><h1 className="display" style={{ flex: 1 }}>Presupuesto</h1></div>
      <YearNav year={year} onChange={setYear} />

      {!mode ? (
        <>
          <p className="muted">Aún no hay presupuesto para {year}. Elige cómo quieres hacerlo:</p>
          <button className="choice" onClick={() => writeMode('category')}>
            <div className="t">Por categorías</div>
            <div className="d">Indicas lo que prevés ingresar y gastar en cada categoría (cada mes, al año o en meses concretos). El ahorro previsto sale solo.</div>
          </button>
          <button className="choice" onClick={() => { writeMode('savings'); setEditing({ kind: 'savings', categoryId: null }); }}>
            <div className="t">Solo un objetivo de ahorro</div>
            <div className="d">Indicas cuánto quieres ahorrar (cada mes, al año o mes a mes). En Informes verás el gasto por categoría sin comparativa.</div>
          </button>
          {tools}
        </>
      ) : (
        <>
          <Segmented value={mode} onChange={changeMode}
            options={[{ value: 'category', label: 'Por categorías' }, { value: 'savings', label: 'Solo ahorro' }]} />
          {mode === 'category' && homes && <ScopeChips value={scope} onChange={setScope} />}

          <div className="hero" style={{ marginTop: 14 }}>
            <div className="hero-label">{mode === 'savings' ? `Objetivo de ahorro ${year}` : scope === 'all' ? `Ahorro previsto en ${year}` : `Coste previsto · ${scopeName} ${year}`}</div>
            <div className="hero-amount display num">{eur(net)}</div>
            <div className="hero-note">≈ {eur(net / 12)} al mes</div>
            {mode === 'category' && (
              <div className="pills">
                <div className="pill"><div className="l">Ingresos previstos</div><div className="v num">{eur(yearBudget.income)}</div></div>
                <div className="pill"><div className="l">Gastos previstos</div><div className="v num">{eur(yearBudget.expense)}</div></div>
              </div>
            )}
          </div>
          <p className="hint">Toca una línea para cambiar su importe o su reparto por meses. Para comparar con lo real, ve a Informes.</p>

          {mode === 'category' ? (
            <>
              <PlanList title="Ingresos" kind="income" lines={scopedLines} categories={categories} onEdit={(id) => editCategory('income', id)} />
              <PlanList title="Gastos" kind="expense" lines={scopedLines} categories={categories} onEdit={(id) => editCategory('expense', id)} />
              {!scopedLines.length && <Empty>Toca «Presupuestar otra categoría», o usa «Proponer» para empezar con tus datos reales.</Empty>}
            </>
          ) : (
            <>
              <div className="section-head"><h2>Objetivo de ahorro</h2></div>
              <div className="card flush">
                <button className="list-row" onClick={() => setEditing({ kind: 'savings', categoryId: null })}>
                  <span style={{ fontSize: 20 }}>🐷</span>
                  <div className="main-col"><div className="t1">{savingsLine ? describeLine(savingsLine) : 'Sin definir'}</div><div className="t2">{savingsLine ? `${eur(lineTotal(savingsLine))} al año` : 'Toca para indicar cuánto quieres ahorrar'}</div></div>
                  <ChevronRight size={16} className="faint" />
                </button>
              </div>
            </>
          )}
          {tools}
        </>
      )}
      {editing && <BudgetLineSheet year={year} kind={editing.kind} categoryId={editing.categoryId} propertyId={editing.propertyId ?? null} onClose={() => setEditing(null)} />}
      {splitting && !editing && (
        <SplitSheet year={year} kind={splitting.kind} categoryId={splitting.categoryId}
          onPick={(propertyId) => setEditing({ ...splitting, propertyId })} onClose={() => setSplitting(null)} />
      )}
    </>
  );
}

/** Budgeted categories of a kind with their plan for the year; tap to edit, or add another one. */
function PlanList({ title, kind, lines, categories, onEdit }: {
  title: string; kind: Kind; lines: BudgetLine[]; categories: Category[]; onEdit: (id: string) => void;
}) {
  const ofKind = categories.filter((c) => c.kind === kind && !c.archived);
  const withBudget = ofKind.filter((c) => lines.some((l) => l.kind === kind && l.categoryId === c.id));
  const without = ofKind.filter((c) => !withBudget.includes(c));
  const total = lines.filter((l) => l.kind === kind).reduce((s, l) => s + lineTotal(l), 0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="small muted num">{eur(total)} / año</span>
      </div>
      <div className="card flush">
        {withBudget.length === 0 && <p className="muted small" style={{ margin: 0, padding: '14px 16px' }}>Ninguna categoría de {title.toLowerCase()} presupuestada todavía.</p>}
        {withBudget.map((c) => {
          const own = lines.filter((l) => l.kind === kind && l.categoryId === c.id);
          const year = own.reduce((s, l) => s + lineTotal(l), 0);
          return (
            <button key={c.id} className="list-row" onClick={() => onEdit(c.id)}>
              <span style={{ fontSize: 20 }}>{c.icon}</span>
              <div className="main-col">
                <div className="t1">{c.name}</div>
                <div className="t2">{own.length > 1 ? `${own.length} viviendas` : describeLine(own[0])}</div>
              </div>
              <div className="amt num">{eur(year)}<div className="xsmall muted" style={{ fontWeight: 400 }}>al año</div></div>
              <ChevronRight size={16} className="faint" />
            </button>
          );
        })}
        {without.length > 0 && (
          <div style={{ padding: '10px 16px 14px' }}>
            <button className="link" onClick={() => setOpen(!open)}><Plus size={14} style={{ verticalAlign: -2 }} /> Presupuestar otra categoría ({without.length})</button>
            {open && (
              <div className="chips" style={{ marginTop: 8 }}>
                {without.map((c) => <button key={c.id} className="chip" onClick={() => { setOpen(false); onEdit(c.id); }}>{c.icon} {c.name}</button>)}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** With several homes, a category is budgeted separately for each one (and for General). */
function SplitSheet({ year, kind, categoryId, onPick, onClose }: {
  year: number; kind: Kind; categoryId: string; onPick: (propertyId: string | null) => void; onClose: () => void;
}) {
  const { data, properties } = useApp();
  const { cat } = useLookups();
  const c = cat(categoryId);
  const lines = data.budgetLines.filter((l) => l.year === year && l.kind === kind && l.categoryId === categoryId);
  const scopes = [
    { id: null as string | null, name: 'General', icon: '📋' },
    ...properties.filter((p) => !p.archived || lines.some((l) => l.propertyId === p.id))
  ];
  return (
    <Sheet title={`${c.icon} ${c.name} · ${year}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>Cada vivienda tiene su propio importe. «General» es lo que no va a ninguna vivienda en concreto.</p>
      <div className="card flush">
        {scopes.map((sc) => {
          const l = lines.find((x) => (x.propertyId ?? null) === sc.id);
          return (
            <button key={String(sc.id)} className="list-row" onClick={() => onPick(sc.id)}>
              <span style={{ fontSize: 20 }}>{sc.icon}</span>
              <div className="main-col"><div className="t1">{sc.name}</div><div className="t2">{l ? describeLine(l) : 'Sin presupuesto'}</div></div>
              <div className="amt num">{l ? eur(lineTotal(l)) : '—'}</div>
              <ChevronRight size={16} className="faint" />
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
