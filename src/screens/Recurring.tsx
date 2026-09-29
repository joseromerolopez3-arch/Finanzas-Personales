import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Recurring } from '../domain/types';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { describeFrequency, upcoming } from '../domain/recurring';
import { addDays, longDate, MONTHS_LONG, todayStr } from '../lib/dates';
import { eur } from '../lib/format';
import { uid } from '../lib/id';
import { Sheet } from '../ui/Sheet';
import { AccountChips, Empty, Field, Ico, MoneyInput, Segmented } from '../ui/controls';
import { OccurrenceRow, usePending } from './parts';

export function RecurringSheet({ onClose }: { onClose: () => void }) {
  const { data } = useApp();
  const { cat } = useLookups();
  const pendingList = usePending();
  const [tab, setTab] = useState<'pending' | 'all'>(pendingList.length ? 'pending' : 'all');
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const next = upcoming(data.recurring, data.recurringLog, addDays(todayStr(), 1), addDays(todayStr(), 30));

  if (editing) return <RecurringEdit item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />;

  return (
    <Sheet title="Pagos e ingresos programados" onClose={onClose}
      actions={<button className="icon-btn plain" onClick={() => setEditing('new')} aria-label="Nuevo programado"><Plus size={20} /></button>}>
      <p className="muted small" style={{ marginTop: 0 }}>Recibos, nómina, suscripciones… Te avisamos cuando toquen y los registras con un toque.</p>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'pending', label: `Pendientes (${pendingList.length})` }, { value: 'all', label: `Todos (${data.recurring.length})` }]} />
      {tab === 'pending' ? (
        <>
          <div className="card flush" style={{ marginTop: 12 }}>
            {pendingList.length ? pendingList.map((o) => <OccurrenceRow key={o.key} o={o} />) : <Empty icon="✅">Nada pendiente.</Empty>}
          </div>
          {next.length > 0 && (
            <>
              <div className="section-head"><h2>Próximos 30 días</h2></div>
              <div className="card flush">
                {next.map((o) => (
                  <div className="list-row" key={o.key}>
                    <div className="main-col"><div className="t1">{o.recurring.name}</div><div className="t2">{longDate(o.dueDate)}</div></div>
                    {o.recurring.amount ? <div className={`amt ${o.recurring.type === 'income' ? 'pos' : ''}`}>{eur(o.recurring.amount)}</div> : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="card flush" style={{ marginTop: 12 }}>
          {data.recurring.length ? [...data.recurring].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
            <button className="list-row" key={r.id} onClick={() => setEditing(r)} style={{ opacity: r.active ? 1 : 0.5 }}>
              <Ico icon={r.categoryId ? cat(r.categoryId).icon : r.type === 'income' ? '💰' : '🧾'} color={r.type === 'income' ? 'var(--income)' : 'var(--expense)'} />
              <div className="main-col"><div className="t1">{r.name}</div><div className="t2">{describeFrequency(r)}{r.active ? '' : ' · pausado'}</div></div>
              {r.amount ? <div className={`amt ${r.type === 'income' ? 'pos' : ''}`}>{eur(r.amount)}</div> : null}
            </button>
          )) : <Empty icon="🗓️">Añade tus recibos y cobros habituales con el botón +.</Empty>}
        </div>
      )}
    </Sheet>
  );
}

function RecurringEdit({ item, onClose }: { item?: Recurring; onClose: () => void }) {
  const { upsert, remove, activeAccounts, categories, data } = useApp();
  const [r, setR] = useState<Recurring>(item ?? {
    id: uid(), name: '', type: 'expense', amount: null, categoryId: null, accountId: null, frequency: 'monthly', everyMonths: 1,
    day: Number(todayStr().slice(8, 10)), month: null, startDate: todayStr(), endDate: null, active: true
  });
  const set = (p: Partial<Recurring>) => setR((x) => ({ ...x, ...p }));
  const cats = categories.filter((c) => c.kind === r.type && !c.archived);
  const save = () => {
    if (!r.name.trim()) return;
    const fixed = { ...r, name: r.name.trim(), day: Math.min(31, Math.max(1, r.day || 1)) };
    if (fixed.frequency === 'once') fixed.day = Number(fixed.startDate.slice(8, 10));
    if (fixed.frequency === 'yearly' && !fixed.month) fixed.month = Number(fixed.startDate.slice(5, 7));
    upsert('recurring', [fixed]);
    onClose();
  };
  const del = () => {
    remove('recurring', [r.id]);
    remove('recurringLog', data.recurringLog.filter((l) => l.recurringId === r.id).map((l) => l.id));
    onClose();
  };
  return (
    <Sheet title={item ? 'Editar programado' : 'Nuevo programado'} onClose={onClose}>
      <Segmented value={r.type} tone={r.type} onChange={(type) => set({ type, categoryId: null })}
        options={[{ value: 'expense', label: 'Pago' }, { value: 'income', label: 'Ingreso' }]} />
      <Field label="Nombre"><input className="input" value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej. Hipoteca, Nómina, Netflix…" autoFocus={!item} /></Field>
      <Field label="Importe habitual (opcional)" hint="Si lo indicas, se usa para la previsión de fin de mes y se rellena solo al registrar.">
        <MoneyInput value={r.amount} onChange={(n) => set({ amount: isNaN(n) ? null : n })} />
      </Field>
      <div className="field"><span className="label">Frecuencia</span>
        <Segmented value={r.frequency} onChange={(frequency) => set({ frequency })}
          options={[{ value: 'monthly', label: 'Mensual' }, { value: 'yearly', label: 'Anual' }, { value: 'once', label: 'Una vez' }]} />
      </div>
      {r.frequency === 'monthly' && (
        <div className="row-flex">
          <div style={{ flex: 1 }}><Field label="Día del mes"><input className="input" inputMode="numeric" value={r.day || ''} onChange={(e) => set({ day: Number(e.target.value.replace(/\D/g, '').slice(0, 2)) })} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Cada">
            <select className="input" value={r.everyMonths} onChange={(e) => set({ everyMonths: Number(e.target.value) })}>
              <option value={1}>mes</option><option value={2}>2 meses</option><option value={3}>3 meses</option><option value={4}>4 meses</option><option value={6}>6 meses</option>
            </select>
          </Field></div>
        </div>
      )}
      {r.frequency === 'yearly' && (
        <div className="row-flex">
          <div style={{ flex: 1 }}><Field label="Día"><input className="input" inputMode="numeric" value={r.day || ''} onChange={(e) => set({ day: Number(e.target.value.replace(/\D/g, '').slice(0, 2)) })} /></Field></div>
          <div style={{ flex: 2 }}><Field label="Mes">
            <select className="input" value={r.month ?? Number(r.startDate.slice(5, 7))} onChange={(e) => set({ month: Number(e.target.value) })}>
              {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field></div>
        </div>
      )}
      <div className="row-flex">
        <div style={{ flex: 1 }}><Field label={r.frequency === 'once' ? 'Fecha' : 'Desde'}><input className="input" type="date" value={r.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} /></Field></div>
        {r.frequency !== 'once' && <div style={{ flex: 1 }}><Field label="Hasta (opcional)"><input className="input" type="date" value={r.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} /></Field></div>}
      </div>
      <Field label="Categoría (opcional)">
        <select className="input" value={r.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })}>
          <option value="">—</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </Field>
      <div className="field"><span className="label">Cuenta (opcional)</span><AccountChips accounts={activeAccounts} value={r.accountId} onChange={(accountId) => set({ accountId: accountId === r.accountId ? null : accountId })} /></div>
      {item && (
        <label className="row-flex field"><input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> Activo</label>
      )}
      <div className="btn-row">
        {item && <button className="btn danger" onClick={del}>Eliminar</button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={save} disabled={!r.name.trim()}>Guardar</button>
      </div>
    </Sheet>
  );
}
