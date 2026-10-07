import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { Transaction } from '../domain/types';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { shortDate } from '../lib/dates';
import { eur } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Empty } from '../ui/controls';

export function useToReview(): Transaction[] {
  const { data } = useApp();
  return useMemo(() => data.transactions.filter((t) => t.needsReview).sort((a, b) => b.date.localeCompare(a.date)), [data.transactions]);
}

/** Movements created from the bank: confirm or change the category with one tap. */
export function ReviewSheet({ onClose }: { onClose: () => void }) {
  const { upsert, categories } = useApp();
  const ui = useUI();
  const { acc } = useLookups();
  const list = useToReview();
  const [cats, setCats] = useState<Record<string, string>>({});

  const confirm = (items: Transaction[]) =>
    upsert('transactions', items.map((t) => ({ ...t, categoryId: cats[t.id] ?? t.categoryId, needsReview: false })));

  return (
    <Sheet title="Por revisar" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Movimientos que han llegado del banco. Comprueba la categoría y confírmalos; toca el concepto para editar más detalles (por ejemplo, convertirlo en traspaso).
      </p>
      {list.length === 0 ? <Empty icon="✅">No hay nada pendiente de revisar.</Empty> : (
        <>
          {list.map((t) => {
            const value = cats[t.id] ?? t.categoryId ?? '';
            const kindCats = categories.filter((c) => c.kind === t.type && !c.archived);
            return (
              <div className="review-row" key={t.id}>
                <button className="link" style={{ textAlign: 'left', color: 'var(--ink)', fontWeight: 500, minWidth: 0 }} onClick={() => { onClose(); ui.openTx({ tx: t }); }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.note || t.bankDescription}</div>
                  <div className="xsmall muted" style={{ fontWeight: 400 }}>{shortDate(t.date)} · {acc(t.accountId).name}</div>
                </button>
                <strong className={`num ${t.type === 'income' ? 'pos' : ''}`}>{t.type === 'income' ? '+' : '−'}{eur(t.amount)}</strong>
                {t.type === 'income' || t.type === 'expense' ? (
                  <div className="row-flex" style={{ gridColumn: '1 / -1' }}>
                    <select className="input" value={value} onChange={(e) => setCats({ ...cats, [t.id]: e.target.value })}>
                      <option value="">Sin categoría</option>
                      {kindCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                    <button className="btn small primary" aria-label="Confirmar" onClick={() => confirm([t])}><Check size={16} /></button>
                  </div>
                ) : (
                  <div style={{ gridColumn: '1 / -1' }}><button className="btn small" onClick={() => confirm([t])}>Confirmar</button></div>
                )}
              </div>
            );
          })}
          <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => { confirm(list); onClose(); }}>Confirmar todos ({list.length})</button>
        </>
      )}
    </Sheet>
  );
}
