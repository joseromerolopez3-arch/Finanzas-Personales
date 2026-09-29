import { useState } from 'react';
import type { BudgetLine, BudgetPattern, Kind } from '../domain/types';
import { activeMonths, buildAmounts, lineId, lineTotal } from '../domain/budget';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { MONTHS_SHORT } from '../lib/dates';
import { eur, round2 } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Field, MoneyInput, MonthPicker } from '../ui/controls';

const PATTERNS: { value: BudgetPattern; label: string; help: string }[] = [
  { value: 'monthly', label: 'Cada mes', help: 'El mismo importe todos los meses.' },
  { value: 'annual', label: 'Anual', help: 'Un total para el año, repartido entre los 12 meses. Ideal para gastos irregulares (ropa, regalos…).' },
  { value: 'months', label: 'Meses concretos', help: 'Solo en los meses que elijas (p. ej. el IBI en junio o las pagas extra).' },
  { value: 'custom', label: 'Mes a mes', help: 'Un importe distinto para cada mes.' }
];

export function BudgetLineSheet({ year, kind, categoryId, onClose }: {
  year: number; kind: Kind | 'savings'; categoryId: string | null; onClose: () => void;
}) {
  const { data, upsert, remove } = useApp();
  const { cat } = useLookups();
  const id = lineId(year, kind, categoryId);
  const line = data.budgetLines.find((l) => l.id === id);
  const [pattern, setPattern] = useState<BudgetPattern>(line?.pattern ?? 'monthly');
  const [base, setBase] = useState<number>(line?.base ?? NaN);
  const [months, setMonths] = useState<number[]>(line && line.pattern === 'months' ? activeMonths(line) : []);
  const [custom, setCustom] = useState<number[]>(line?.amounts ?? Array(12).fill(0));

  const amounts = buildAmounts(pattern, isNaN(base) ? 0 : base, months, custom);
  const total = lineTotal({ amounts });

  const switchTo = (p: BudgetPattern) => {
    const cur = amounts;
    const tot = total;
    if (p === 'custom') setCustom(cur);
    else if (p === 'annual') setBase(tot || NaN);
    else if (p === 'monthly') setBase(pattern === 'annual' || pattern === 'custom' ? round2(tot / 12) || NaN : base);
    else if (p === 'months') {
      const nz = cur.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      setMonths(nz.length && nz.length < 12 ? nz : []);
      if (pattern !== 'monthly' && pattern !== 'months') setBase(Math.max(...cur) || NaN);
    }
    setPattern(p);
  };

  const save = () => {
    const l: BudgetLine = { id, year, kind, categoryId, pattern, base: pattern === 'custom' ? 0 : isNaN(base) ? 0 : base, amounts };
    if (!amounts.some(Boolean)) remove('budgetLines', [id]);
    else upsert('budgetLines', [l]);
    onClose();
  };

  const c = categoryId ? cat(categoryId) : null;
  const title = kind === 'savings' ? `Objetivo de ahorro ${year}` : `${c?.icon} ${c?.name} · ${year}`;
  const verb = kind === 'savings' ? 'ahorrar' : kind === 'income' ? 'ingresar' : 'gastar';

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>¿Cómo quieres indicar lo que prevés {verb}?</p>
      <div className="chips">
        {PATTERNS.map((p) => (
          <button key={p.value} type="button" className={`chip${pattern === p.value ? ' on' : ''}`} onClick={() => switchTo(p.value)}>{p.label}</button>
        ))}
      </div>
      <p className="hint">{PATTERNS.find((p) => p.value === pattern)!.help}</p>

      {pattern === 'monthly' && (
        <Field label="Importe cada mes">
          <MoneyInput big value={isNaN(base) ? null : base} onChange={setBase} autoFocus />
        </Field>
      )}
      {pattern === 'annual' && (
        <Field label="Total del año">
          <MoneyInput big value={isNaN(base) ? null : base} onChange={setBase} autoFocus />
        </Field>
      )}
      {pattern === 'months' && (
        <>
          <div className="field"><span className="label">Meses</span><MonthPicker value={months} onChange={setMonths} /></div>
          <Field label="Importe en cada mes elegido">
            <MoneyInput big value={isNaN(base) ? null : base} onChange={setBase} />
          </Field>
        </>
      )}
      {pattern === 'custom' && (
        <div className="field">
          <div className="row-flex" style={{ marginBottom: 8 }}>
            <span className="label" style={{ margin: 0, flex: 1 }}>Importe por mes</span>
            <button className="link" onClick={() => setCustom(Array(12).fill(custom[0] || 0))}>Copiar enero a todos</button>
          </div>
          <div className="month-inputs">
            {MONTHS_SHORT.map((m, i) => (
              <label key={m}>
                <span>{m}</span>
                <MoneyInput value={custom[i] || null} onChange={(n) => setCustom((c) => c.map((v, k) => (k === i ? (isNaN(n) ? 0 : n) : v)))} />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row-flex"><span className="muted">Total año</span><span className="spacer" /><strong className="num">{eur(total)}</strong></div>
        <div className="row-flex small" style={{ marginTop: 4 }}><span className="muted">Media mensual</span><span className="spacer" /><span className="num">{eur(total / 12)}</span></div>
      </div>

      <div className="btn-row">
        {line && <button className="btn danger" onClick={() => { remove('budgetLines', [id]); onClose(); }}>Quitar</button>}
        <button className="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  );
}

export function describeLine(l: BudgetLine): string {
  switch (l.pattern) {
    case 'monthly': return `${eur(l.base)} / mes`;
    case 'annual': return `${eur(l.base)} / año`;
    case 'months': return `${activeMonths(l).map((m) => MONTHS_SHORT[m]).join(', ')} · ${eur(l.base)}`;
    case 'custom': return `Mes a mes · ${eur(lineTotal(l))} / año`;
  }
}
