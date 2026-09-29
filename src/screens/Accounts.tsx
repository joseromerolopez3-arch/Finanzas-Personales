import { useMemo, useState } from 'react';
import { Pencil, Scale, Upload } from 'lucide-react';
import type { Account } from '../domain/types';
import { useApp } from '../state/app';
import { newTx, useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { balanceOf, touches } from '../domain/calc';
import { colorFor } from '../domain/defaults';
import { todayStr } from '../lib/dates';
import { eur, round2 } from '../lib/format';
import { uid } from '../lib/id';
import { Sheet } from '../ui/Sheet';
import { EmojiPicker, Field, MoneyInput } from '../ui/controls';
import { TxRow } from './Movements';

/** Account detail: balance, balance adjustment (manual reconciliation) and latest movements. */
export function AccountSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, accounts, upsert } = useApp();
  const ui = useUI();
  const lookups = useLookups();
  const acc = accounts.find((a) => a.id === id);
  const [adjusting, setAdjusting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [real, setReal] = useState<number>(NaN);
  const txs = useMemo(() => data.transactions.filter((t) => touches(t, id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15), [data.transactions, id]);
  if (!acc) return null;
  const bal = balanceOf(acc, data.transactions);
  if (editing) return <AccountEditSheet account={acc} onClose={() => setEditing(false)} />;

  const adjust = () => {
    if (isNaN(real)) return;
    const diff = round2(real - bal);
    if (diff !== 0) upsert('transactions', [newTx({ type: 'adjustment', amount: diff, accountId: id, note: 'Ajuste de saldo' })]);
    setAdjusting(false);
  };

  return (
    <Sheet title={`${acc.icon} ${acc.name}`} onClose={onClose}
      actions={<button className="icon-btn plain" onClick={() => setEditing(true)} aria-label="Editar cuenta"><Pencil size={18} /></button>}>
      <div className="hero">
        <div className="hero-label">Saldo en la app</div>
        <div className="hero-amount display num">{eur(bal)}</div>
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => { setAdjusting(!adjusting); setReal(bal); }}><Scale size={17} />Cuadrar saldo</button>
        <button className="btn" onClick={() => { onClose(); ui.openImport(id); }}><Upload size={17} />Importar extracto</button>
      </div>
      {adjusting && (
        <div className="card" style={{ marginTop: 12 }}>
          <Field label="¿Qué saldo tienes hoy según el banco?" hint={!isNaN(real) && round2(real - bal) !== 0 ? `Se añadirá un ajuste de ${eur(real - bal)} (no cuenta como ingreso ni gasto).` : 'Coincide con la app.'}>
            <MoneyInput value={real} onChange={setReal} allowNegative autoFocus />
          </Field>
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={adjust}>Cuadrar</button>
        </div>
      )}
      <div className="section-head"><h2>Últimos movimientos</h2></div>
      <div className="card flush">
        {txs.length ? txs.map((t) => <TxRow key={t.id} t={t} lookups={lookups} onClick={() => { onClose(); ui.openTx({ tx: t }); }} />)
          : <p className="muted center small">Sin movimientos todavía.</p>}
      </div>
    </Sheet>
  );
}

const KINDS: { value: Account['kind']; label: string }[] = [
  { value: 'bank', label: 'Cuenta corriente' }, { value: 'savings', label: 'Ahorro' }, { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta de crédito' }, { value: 'investment', label: 'Inversión' }, { value: 'other', label: 'Otra' }
];

export function AccountEditSheet({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { data, accounts, upsert, remove, toast } = useApp();
  const [a, setA] = useState<Account>(account ?? {
    id: uid(), name: '', icon: '🏦', color: colorFor(accounts.length), kind: 'bank', openingBalance: 0, openingDate: todayStr(),
    position: accounts.length, archived: false, importMapping: null
  });
  const used = data.transactions.some((t) => touches(t, a.id));
  const set = (p: Partial<Account>) => setA((x) => ({ ...x, ...p }));
  const save = () => {
    if (!a.name.trim()) return;
    upsert('accounts', [{ ...a, name: a.name.trim() }]);
    onClose();
  };
  return (
    <Sheet title={account ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <Field label="Nombre"><input className="input" value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej. Cuenta nómina" autoFocus={!account} /></Field>
      <Field label="Tipo">
        <select className="input" value={a.kind} onChange={(e) => set({ kind: e.target.value as Account['kind'] })}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </Field>
      <div className="row-flex" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field label="Saldo inicial"><MoneyInput value={a.openingBalance || null} onChange={(n) => set({ openingBalance: isNaN(n) ? 0 : n })} allowNegative /></Field></div>
        <div style={{ flex: 1 }}><Field label="A fecha de"><input className="input" type="date" value={a.openingDate} onChange={(e) => e.target.value && set({ openingDate: e.target.value })} /></Field></div>
      </div>
      <div className="field"><span className="label">Icono</span><EmojiPicker value={a.icon} onChange={(icon) => set({ icon })} /></div>
      <div className="btn-row">
        {account && (used
          ? <button className="btn" onClick={() => { upsert('accounts', [{ ...a, archived: !a.archived }]); toast(a.archived ? 'Cuenta reactivada' : 'Cuenta archivada: sus movimientos se conservan'); onClose(); }}>{a.archived ? 'Reactivar' : 'Archivar'}</button>
          : <button className="btn danger" onClick={() => { remove('accounts', [a.id]); onClose(); }}>Eliminar</button>)}
        <button className="btn primary" onClick={save} disabled={!a.name.trim()}>Guardar</button>
      </div>
    </Sheet>
  );
}
