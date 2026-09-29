import { useApp } from '../state/app';

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.message}</span>
          {t.action && <button onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
