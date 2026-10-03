import { useMemo, useState } from 'react';
import { Search, Upload } from 'lucide-react';
import type { Transaction } from '../domain/types';
import { useApp } from '../state/app';
import { useLookups, useMemberName } from '../state/hooks';
import { useUI } from '../state/ui';
import { inMonth, totals } from '../domain/calc';
import { isReconciled } from '../domain/reconcile';
import { normalizeLoose } from '../domain/text';
import { dayLabel } from '../lib/dates';
import { eur } from '../lib/format';
import { Empty, Ico, MonthNav } from '../ui/controls';
import { BellButton, ReconciledMark } from './parts';

type TypeFilter = 'all' | 'expense' | 'income' | 'transfer' | 'unreconciled' | 'review';

export function MovementsScreen() {
  const { data, activeAccounts, categories } = useApp();
  const ui = useUI();
  const { y, m0 } = ui.period;
  const { cat, acc } = useLookups();
  const [q, setQ] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const importedAccounts = useMemo(() => new Set(data.transactions.filter((t) => t.externalId).map((t) => t.accountId)), [data.transactions]);

  const list = useMemo(() => {
    const needle = normalizeLoose(q);
    return data.transactions
      .filter((t) => (needle || type === 'review' ? true : inMonth(t, y, m0)))
      .filter((t) => {
        if (type === 'review') {
          if (!t.needsReview) return false;
        } else if (type === 'unreconciled') {
          if (t.type === 'transfer') return false;
          if (!importedAccounts.has(t.accountId) || isReconciled(t, t.accountId)) return false;
        } else if (type !== 'all' && t.type !== type) return false;
        if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
        if (categoryId && t.categoryId !== categoryId) return false;
        if (needle) {
          const hay = normalizeLoose(`${t.note} ${t.bankDescription ?? ''} ${cat(t.categoryId).name} ${String(t.amount).replace('.', ',')}`);
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [data.transactions, q, type, accountId, categoryId, y, m0, cat, importedAccounts]);

  const groups = useMemo(() => {
    const g = new Map<string, Transaction[]>();
    for (const t of list.slice(0, 600)) g.set(t.date, [...(g.get(t.date) ?? []), t]);
    return [...g.entries()];
  }, [list]);
  const sum = totals(list);

  return (
    <>
      <div className="topbar">
        <h1 className="display" style={{ flex: 1 }}>Movimientos</h1>
        <button className="icon-btn" onClick={() => ui.openImport()} aria-label="Importar extracto del banco" title="Importar extracto del banco"><Upload size={18} /></button>
        <BellButton />
      </div>
      {!q && type !== 'review' && <MonthNav y={y} m0={m0} onChange={ui.setPeriod} />}
      <div className="search">
        <Search size={17} />
        <input className="input" type="search" placeholder="Buscar en todos los meses…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips scroll" style={{ marginTop: 10 }}>
        {([['all', 'Todos'], ['expense', 'Gastos'], ['income', 'Ingresos'], ['transfer', 'Traspasos'],
          ...(data.transactions.some((t) => t.needsReview) ? [['review', 'Por revisar']] : []),
          ...(importedAccounts.size ? [['unreconciled', 'Sin conciliar']] : [])] as [TypeFilter, string][]).map(([v, l]) => (
          <button key={v} className={`chip${type === v ? ' on' : ''}`} onClick={() => setType(v)}>{l}</button>
        ))}
      </div>
      <div className="row-flex" style={{ marginTop: 8 }}>
        <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
      </div>
      {type === 'unreconciled' && (
        <p className="hint">Movimientos apuntados a mano en cuentas con extractos importados que aún no aparecen en el banco.</p>
      )}
      <div className="row-flex small muted" style={{ margin: '14px 4px 0' }}>
        <span>{list.length} movimientos</span><span className="spacer" />
        <span className="pos">+{eur(sum.income)}</span><span className="neg">−{eur(sum.expense)}</span>
      </div>

      {groups.length === 0 ? (
        <Empty icon="🧾">{q ? 'No hay resultados.' : <>Aún no hay movimientos este mes.<br />Toca «+» para añadir uno o importa el extracto de tu banco.</>}</Empty>
      ) : groups.map(([date, items]) => {
        const net = items.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
        return (
          <div key={date}>
            <div className="day-head">
              <span>{dayLabel(date)}{q && ` · ${date.slice(0, 4)}`}</span>
              {net !== 0 && <span className="num">{net > 0 ? '+' : ''}{eur(net)}</span>}
            </div>
            <div className="card flush">
              {items.map((t) => <TxRow key={t.id} t={t} onClick={() => ui.openTx({ tx: t })} reconciledAccounts={importedAccounts} lookups={{ cat, acc }} />)}
            </div>
          </div>
        );
      })}
      {list.length > 600 && <p className="hint center">Mostrando los 600 más recientes. Usa la búsqueda o los filtros para acotar.</p>}
    </>
  );
}

export function TxRow({ t, onClick, reconciledAccounts, lookups }: {
  t: Transaction; onClick: () => void; reconciledAccounts?: Set<string>; lookups: ReturnType<typeof useLookups>;
}) {
  const { cat, acc } = lookups;
  const who = useMemberName()(t.createdBy);
  const c = cat(t.categoryId);
  const a = acc(t.accountId);
  let icon = c.icon, color = c.color, title = t.note || c.name, sub = `${c.name} · ${a.name}`, amount = '', cls = '';
  if (t.type === 'transfer') {
    const to = acc(t.toAccountId);
    icon = '↔'; color = '#4B6E8C'; title = t.note || 'Traspaso'; sub = `${a.name} → ${to.name}`; amount = eur(t.amount);
  } else if (t.type === 'adjustment') {
    icon = '⚖️'; color = '#7A7A7A'; title = t.note || 'Ajuste de saldo'; sub = a.name; amount = `${t.amount > 0 ? '+' : ''}${eur(t.amount)}`;
  } else if (t.type === 'income') {
    amount = `+${eur(t.amount)}`; cls = 'pos';
  } else {
    amount = `−${eur(t.amount)}`;
  }
  const reconciled = reconciledAccounts?.has(t.accountId) && !!t.externalId;
  if (t.needsReview) sub = `Por revisar · ${sub}`;
  return (
    <button className="list-row" onClick={onClick}>
      <Ico icon={icon} color={color} />
      <div className="main-col">
        <div className="t1">{title}</div>
        <div className="t2">{reconciled && <ReconciledMark />} {sub}{who && ` · ${who}`}</div>
      </div>
      <div className={`amt ${cls}`}>{amount}</div>
    </button>
  );
}
