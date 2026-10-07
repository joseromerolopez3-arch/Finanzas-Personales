import { useMemo, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import type { Transaction, TxType } from '../domain/types';
import { useApp } from '../state/app';
import { newTx, useCategorizer, useSortedCategories } from '../state/hooks';
import type { TxSheetOptions } from '../state/ui';
import { addDays, todayStr } from '../lib/dates';
import { round2 } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { AccountChips, CategoryChips, Field, MoneyInput, PropertyChips, Segmented } from '../ui/controls';

export function TransactionSheet({ tx, preset, title, onSaved, onClose }: TxSheetOptions & { onClose: () => void }) {
  const { activeAccounts, activeProperties, properties, settings, upsert, remove, saveSettings, toast, data } = useApp();
  const base = tx ?? preset ?? {};
  const [type, setType] = useState<TxType>(base.type ?? 'expense');
  const [amount, setAmount] = useState<number>(base.amount ? Math.abs(base.amount) : NaN);
  const [sign, setSign] = useState(base.type === 'adjustment' && (base.amount ?? 0) < 0 ? -1 : 1);
  const [categoryId, setCategoryId] = useState<string | null>(base.categoryId ?? null);
  const [touchedCategory, setTouchedCategory] = useState(!!base.categoryId);
  const defaultAccount = settings.lastAccountId && activeAccounts.some((a) => a.id === settings.lastAccountId) ? settings.lastAccountId : activeAccounts[0]?.id ?? '';
  const [accountId, setAccountId] = useState<string>(base.accountId ?? defaultAccount);
  const [toAccountId, setToAccountId] = useState<string | null>(base.toAccountId ?? null);
  const [date, setDate] = useState(base.date ?? todayStr());
  const [note, setNote] = useState(base.note ?? '');
  const [propertyId, setPropertyId] = useState<string | null>(base.propertyId ?? null);
  // An archived home stays selectable on the movements that already use it.
  const homes = propertyId && !activeProperties.some((p) => p.id === propertyId) ? [...activeProperties, ...properties.filter((p) => p.id === propertyId)] : activeProperties;
  const [error, setError] = useState('');
  const categorizer = useCategorizer();
  const kind = type === 'income' ? 'income' : 'expense';
  const cats = useSortedCategories(kind);
  const [showAll, setShowAll] = useState(false);

  const suggested = useMemo(() => (type === 'income' || type === 'expense') && note.trim().length > 2 ? categorizer.suggest(note, type) : null, [note, type, categorizer]);
  const effectiveCategory = touchedCategory ? categoryId : categoryId ?? suggested;
  const visibleCats = showAll || cats.length <= 10 ? cats : cats.slice(0, 9);
  const selectedHidden = effectiveCategory && !visibleCats.some((c) => c.id === effectiveCategory) ? cats.find((c) => c.id === effectiveCategory) : null;

  const save = () => {
    if (!(amount > 0)) { setError('Escribe un importe.'); return; }
    if (!accountId) { setError('Elige una cuenta.'); return; }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) { setError('Elige dos cuentas distintas.'); return; }
    const value = round2(type === 'adjustment' ? sign * amount : amount);
    const fields: Partial<Transaction> = {
      type, amount: value, accountId, date, note: note.trim(), needsReview: false,
      toAccountId: type === 'transfer' ? toAccountId : null,
      categoryId: type === 'income' || type === 'expense' ? effectiveCategory ?? null : null,
      propertyId: type === 'income' || type === 'expense' ? propertyId : null
    };
    const saved: Transaction = tx ? { ...tx, ...fields } : newTx({ ...(preset ?? {}), ...fields } as Transaction);
    upsert('transactions', [saved]);
    if (accountId !== settings.lastAccountId && !tx) saveSettings({ lastAccountId: accountId });
    onSaved?.(saved);
    onClose();
  };

  const del = () => {
    if (!tx) return;
    remove('transactions', [tx.id]);
    const logs = data.recurringLog.filter((l) => l.transactionId === tx.id);
    if (logs.length) remove('recurringLog', logs.map((l) => l.id));
    toast('Movimiento eliminado', { label: 'Deshacer', run: () => { upsert('transactions', [tx]); if (logs.length) upsert('recurringLog', logs); } });
    onClose();
  };

  const duplicate = () => {
    if (!tx) return;
    upsert('transactions', [{ ...tx, id: newTx(tx).id, date: todayStr(), externalId: null, toExternalId: null, source: 'manual', createdAt: new Date().toISOString() }]);
    toast('Movimiento duplicado con fecha de hoy');
    onClose();
  };

  return (
    <Sheet title={title ?? (tx ? 'Editar movimiento' : 'Nuevo movimiento')} onClose={onClose}
      actions={tx && <button className="icon-btn plain" onClick={duplicate} aria-label="Duplicar" title="Duplicar"><Copy size={18} /></button>}>
      {type === 'adjustment' ? (
        <Segmented value={sign === 1 ? 'up' : 'down'} onChange={(v) => setSign(v === 'up' ? 1 : -1)}
          options={[{ value: 'up', label: 'Ajuste +' }, { value: 'down', label: 'Ajuste −' }]} />
      ) : (
        <Segmented value={type} onChange={(v) => { setType(v); setCategoryId(null); setTouchedCategory(false); setError(''); }} tone={type}
          options={[{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }, { value: 'transfer', label: 'Traspaso' }]} />
      )}

      <div style={{ marginTop: 14 }}>
        <MoneyInput big value={isNaN(amount) ? null : amount} onChange={(n) => { setAmount(n); setError(''); }} autoFocus={!tx} />
      </div>

      {(type === 'expense' || type === 'income') && (
        <div className="field">
          <span className="label">Categoría {!touchedCategory && suggested && <span className="tag ok">sugerida</span>}</span>
          <CategoryChips categories={selectedHidden ? [selectedHidden, ...visibleCats] : visibleCats} value={effectiveCategory}
            onChange={(id) => { setCategoryId(id); setTouchedCategory(true); }} />
          {cats.length > 10 && <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Ver menos' : `Ver todas (${cats.length})`}</button>}
        </div>
      )}

      {type === 'transfer' ? (
        <>
          <div className="field"><span className="label">Desde</span><AccountChips accounts={activeAccounts} value={accountId} onChange={setAccountId} /></div>
          <div className="field"><span className="label">Hacia</span><AccountChips accounts={activeAccounts} value={toAccountId} onChange={setToAccountId} exclude={accountId} /></div>
        </>
      ) : (
        <div className="field"><span className="label">Cuenta</span><AccountChips accounts={activeAccounts} value={accountId} onChange={setAccountId} /></div>
      )}

      {(type === 'expense' || type === 'income') && homes.length > 0 && (
        <div className="field"><span className="label">Vivienda</span><PropertyChips properties={homes} value={propertyId} onChange={setPropertyId} /></div>
      )}

      <Field label="Concepto (opcional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Compra semanal" />
      </Field>
      {tx?.bankDescription && tx.bankDescription !== note && <p className="hint">Según el banco: {tx.bankDescription}</p>}

      <div className="field">
        <span className="label">Fecha</span>
        <div className="row-flex">
          <button type="button" className={`chip${date === todayStr() ? ' on' : ''}`} onClick={() => setDate(todayStr())}>Hoy</button>
          <button type="button" className={`chip${date === addDays(todayStr(), -1) ? ' on' : ''}`} onClick={() => setDate(addDays(todayStr(), -1))}>Ayer</button>
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ flex: 1 }} />
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      <div className="btn-row">
        {tx && <button className="btn danger" style={{ flex: 0 }} onClick={del} aria-label="Eliminar"><Trash2 size={18} /></button>}
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  );
}
