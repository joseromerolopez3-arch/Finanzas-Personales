import type { Kind, Transaction } from '../domain/types';
import { useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { dayLabel } from '../lib/dates';
import { eur } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Empty } from '../ui/controls';
import { TxRow } from './Movements';

/** The movements behind a category figure (same period and home as the table it was opened from). */
export function CategoryMovementsSheet({ categoryId, kind, txs, period, onClose }: {
  categoryId: string; kind: Kind; txs: Transaction[]; period: string; onClose: () => void;
}) {
  const ui = useUI();
  const lookups = useLookups();
  const c = lookups.cat(categoryId || null);
  const list = txs
    .filter((t) => t.type === kind && (t.categoryId || '') === categoryId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const total = list.reduce((s, t) => s + t.amount, 0);
  const days = [...new Set(list.map((t) => t.date))];
  return (
    <Sheet title={`${c.icon} ${c.name}`} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>{period} · {list.length} movimiento{list.length === 1 ? '' : 's'} · {eur(total)}</p>
      {list.length === 0 && <Empty>Sin movimientos en este periodo.</Empty>}
      {days.map((d) => (
        <div key={d}>
          <div className="day-head"><span>{dayLabel(d)}</span></div>
          <div className="card flush">
            {list.filter((t) => t.date === d).map((t) => (
              <TxRow key={t.id} t={t} lookups={lookups} onClick={() => { onClose(); ui.openTx({ tx: t }); }} />
            ))}
          </div>
        </div>
      ))}
      {list.length > 0 && <p className="hint">Toca un movimiento para verlo o corregirlo.</p>}
    </Sheet>
  );
}
