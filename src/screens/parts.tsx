import { useMemo, useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import type { Kind, Transaction } from '../domain/types';
import type { CategoryComparison, Scope } from '../domain/budget';
import { byCategory, balanceOf } from '../domain/calc';
import { pending, type Occurrence } from '../domain/recurring';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { eur, round2 } from '../lib/format';
import { shortDate, todayStr } from '../lib/dates';
import { Empty, Ico, Progress, Segmented } from '../ui/controls';

export function SyncDot() {
  const { sync, storeKind } = useApp();
  if (storeKind !== 'cloud') return null;
  const title = sync.message ?? (sync.state === 'saving' ? 'Guardando…' : 'Todo guardado');
  return <span className={`sync-dot ${sync.state}`} title={title} aria-label={title} />;
}

export function usePending() {
  const { data } = useApp();
  return useMemo(() => pending(data.recurring, data.recurringLog, todayStr()), [data.recurring, data.recurringLog]);
}

export function BellButton() {
  const ui = useUI();
  const count = usePending().length;
  return (
    <button className="icon-btn" onClick={ui.openRecurring} aria-label={`Pagos e ingresos programados${count ? `, ${count} pendientes` : ''}`}>
      <Bell size={18} />
      {count > 0 && <span className="badge">{count}</span>}
    </button>
  );
}

/** Register a due recurring item as a real movement (opens the movement form pre-filled). */
export function useOccurrenceActions() {
  const { upsert, activeAccounts, settings } = useApp();
  const ui = useUI();
  const log = (o: Occurrence, status: 'done' | 'skipped', transactionId: string | null = null) =>
    upsert('recurringLog', [{ id: o.key, recurringId: o.recurring.id, period: o.period, status, transactionId, at: new Date().toISOString() }]);
  const register = (o: Occurrence) => {
    const r = o.recurring;
    ui.openTx({
      title: r.name,
      preset: {
        type: r.type, amount: r.amount ?? 0, categoryId: r.categoryId, note: r.name, date: o.dueDate > todayStr() ? todayStr() : o.dueDate,
        accountId: r.accountId ?? settings.lastAccountId ?? activeAccounts[0]?.id, recurringId: r.id, propertyId: r.propertyId ?? null, source: 'recurring'
      },
      onSaved: (tx) => log(o, 'done', tx.id)
    });
  };
  return { register, done: (o: Occurrence) => log(o, 'done'), skip: (o: Occurrence) => log(o, 'skipped') };
}

export function OccurrenceRow({ o, compact }: { o: Occurrence; compact?: boolean }) {
  const { register, done, skip } = useOccurrenceActions();
  const { cat } = useLookups();
  const r = o.recurring;
  const c = cat(r.categoryId);
  const overdue = o.dueDate < todayStr();
  return (
    <div className="list-row">
      <Ico icon={r.categoryId ? c.icon : r.type === 'income' ? '💰' : '🧾'} color={r.type === 'income' ? 'var(--income)' : 'var(--expense)'} />
      <div className="main-col">
        <div className="t1">{r.name}</div>
        <div className="t2">{overdue ? 'Venció' : 'Vence'} el {shortDate(o.dueDate)}{r.amount ? ` · ${eur(r.amount)}` : ''}</div>
      </div>
      <button className="btn small primary" onClick={() => register(o)}>Registrar</button>
      {!compact && <button className="btn small" onClick={() => done(o)} title="Ya estaba registrado">Hecho</button>}
      {!compact && <button className="btn small" onClick={() => skip(o)}>Omitir</button>}
    </div>
  );
}

export function AccountsCard() {
  const { activeAccounts, data } = useApp();
  const ui = useUI();
  const total = round2(activeAccounts.reduce((s, a) => s + balanceOf(a, data.transactions), 0));
  if (!activeAccounts.length) return <div className="card"><Empty>No hay cuentas. Añade una desde Ajustes.</Empty></div>;
  return (
    <div className="card flush">
      {activeAccounts.map((a) => {
        const bal = balanceOf(a, data.transactions);
        return (
          <button className="list-row" key={a.id} onClick={() => ui.openAccount(a.id)}>
            <Ico icon={a.icon} color={a.color} />
            <div className="main-col"><div className="t1">{a.name}</div></div>
            <div className={`amt ${bal < 0 ? 'neg' : ''}`}>{eur(bal)}</div>
          </button>
        );
      })}
      <div className="list-row total">
        <div className="ico" style={{ background: 'var(--surface-2)' }}>Σ</div>
        <div className="main-col"><div className="t1">Total</div></div>
        <div className="amt">{eur(total)}</div>
      </div>
    </div>
  );
}

const STATUS_TEXT = { ok: 'En línea', warn: 'Cerca del límite', over: 'Superado', none: 'Sin presupuesto' } as const;

/** Category by category, actual vs budget (budget by categories). */
export function CompareList({ rows, kind, onPick }: { rows: CategoryComparison[]; kind: Kind; onPick?: (categoryId: string) => void }) {
  const { cat } = useLookups();
  if (!rows.length) return <Empty>Sin {kind === 'income' ? 'ingresos' : 'gastos'} ni presupuesto en este periodo.</Empty>;
  return (
    <div>
      {rows.map((r) => {
        const c = cat(r.categoryId);
        const text = r.budget
          ? kind === 'expense'
            ? r.remaining >= 0 ? `Quedan ${eur(r.remaining)}` : `Te has pasado ${eur(-r.remaining)}`
            : r.remaining > 0 ? `Faltan ${eur(r.remaining)}` : `Superado en ${eur(-r.remaining)}`
          : 'Sin presupuesto';
        const status = kind === 'income' && r.status === 'over' ? 'warn' : r.status;
        const Row = onPick ? 'button' : 'div';
        return (
          <Row key={r.categoryId} className="cat-line" style={onPick ? { width: '100%', background: 'none', border: 'none', textAlign: 'left', display: 'block' } : undefined}
            onClick={onPick ? () => onPick(r.categoryId) : undefined}>
            <div className="head">
              <span className="emoji">{c.icon}</span>
              <span className="name">{c.name}</span>
              <span className="val">{eur(r.actual)}{r.budget ? <span className="faint small"> / {eur(r.budget)}</span> : null}</span>
            </div>
            <Progress value={r.actual} max={r.budget || r.actual} status={r.budget ? status : 'none'} />
            <div className="bar-meta">
              <span>{text}</span>
              {r.budget ? <span className={`tag ${status}`}>{Math.round(r.ratio * 100)} % · {STATUS_TEXT[status]}</span> : null}
            </div>
          </Row>
        );
      })}
    </div>
  );
}

/** Category detail without budget: amount and share of the total. */
export function ShareList({ txs, kind, months = 1 }: { txs: Transaction[]; kind: Kind; months?: number }) {
  const { cat } = useLookups();
  const rows = [...byCategory(txs, kind).entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, r) => s + r[1], 0);
  if (!rows.length) return <Empty>Sin {kind === 'income' ? 'ingresos' : 'gastos'} en este periodo.</Empty>;
  return (
    <div>
      {rows.map(([id, v]) => {
        const c = cat(id);
        return (
          <div className="cat-line" key={id}>
            <div className="head">
              <span className="emoji">{c.icon}</span>
              <span className="name">{c.name}</span>
              <span className="val">{eur(v)}</span>
            </div>
            <div className="bar"><div className="fill" style={{ width: `${(v / rows[0][1]) * 100}%`, background: c.color }} /></div>
            <div className="bar-meta">
              <span>{Math.round((v / total) * 100)} % del total</span>
              {months > 1 && <span>{eur(v / months)} / mes</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function KindToggle({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  return (
    <Segmented value={value} onChange={onChange} tone={value}
      options={[{ value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }]} />
  );
}

export function useKindToggle() {
  return useState<Kind>('expense');
}

export function ReconciledMark() {
  return <CheckCircle2 size={13} style={{ verticalAlign: -2, color: 'var(--income)' }} aria-label="Conciliado con el banco" />;
}

/** Filter by home: all of them, General (not tied to a home) or one home. */
export function ScopeChips({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const { activeProperties } = useApp();
  const options: [Scope, string][] = [['all', 'Todas'], [null, 'General'], ...activeProperties.map((p): [Scope, string] => [p.id, `${p.icon} ${p.name}`])];
  return (
    <div className="chips" style={{ marginTop: 12 }} role="group" aria-label="Vivienda">
      {options.map(([v, l]) => <button key={String(v)} className={`chip${value === v ? ' on' : ''}`} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
