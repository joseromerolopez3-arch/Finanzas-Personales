import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Sheet({ title, onClose, children, wide, actions }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <>
      <div className="backdrop" onClick={onClose} />
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h3>{title}</h3>
          {actions}
          <button className="icon-btn plain" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>
        {children}
      </div>
    </>,
    document.body
  );
}
