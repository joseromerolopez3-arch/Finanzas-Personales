import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Account, Category } from '../domain/types';
import { EMOJIS } from '../domain/defaults';
import { MONTHS_SHORT, monthLabel } from '../lib/dates';
import { parseAmount, toInput } from '../lib/format';
import type { Status } from '../domain/budget';

export function Segmented<T extends string>({ value, options, onChange, tone }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; tone?: string;
}) {
  return (
    <div className={`seg ${tone ?? ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

/** Decimal input that accepts "12,50" or "12.50" and reports a number (NaN when empty). */
export function MoneyInput({ value, onChange, autoFocus, big, placeholder, id, allowNegative }: {
  value: number | null; onChange: (n: number) => void; autoFocus?: boolean; big?: boolean; placeholder?: string; id?: string; allowNegative?: boolean;
}) {
  const [text, setText] = useState(() => toInput(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { setText(toInput(value)); last.current = value; }
  }, [value]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 120); }, [autoFocus]);
  const input = (
    <input
      ref={ref} id={id} className={big ? '' : 'input num'} inputMode="decimal" placeholder={placeholder ?? '0,00'} value={text}
      onChange={(e) => {
        const t = e.target.value.replace(allowNegative ? /[^\d.,-]/g : /[^\d.,]/g, '');
        setText(t);
        const n = parseAmount(t);
        last.current = isNaN(n) ? null : n;
        onChange(n);
      }}
    />
  );
  if (!big) return input;
  return <div className="amount-input">{input}<span>€</span></div>;
}

export function MonthNav({ y, m0, onChange, min, max }: {
  y: number; m0: number; onChange: (y: number, m0: number) => void; min?: string; max?: string;
}) {
  const key = `${y}-${String(m0 + 1).padStart(2, '0')}`;
  const go = (d: number) => {
    const t = y * 12 + m0 + d;
    onChange(Math.floor(t / 12), t % 12);
  };
  return (
    <div className="month-nav">
      <button onClick={() => go(-1)} disabled={!!min && key <= min} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
      <div className="label">{monthLabel(y, m0)}</div>
      <button onClick={() => go(1)} disabled={!!max && key >= max} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
    </div>
  );
}

export function YearNav({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  return (
    <div className="month-nav">
      <button onClick={() => onChange(year - 1)} aria-label="Año anterior"><ChevronLeft size={18} /></button>
      <div className="label">{year}</div>
      <button onClick={() => onChange(year + 1)} aria-label="Año siguiente"><ChevronRight size={18} /></button>
    </div>
  );
}

export function Progress({ value, max, status = 'ok', marker }: { value: number; max: number; status?: Status; marker?: number }) {
  const w = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : value > 0 ? 100 : 0;
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`fill ${status}`} style={{ width: `${w}%` }} />
      {marker != null && marker > 0 && marker < 1 && <div className="marker" style={{ left: `${marker * 100}%` }} />}
    </div>
  );
}

export function CategoryChips({ categories, value, onChange }: { categories: Category[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div className="chips">
      {categories.map((c) => (
        <button type="button" key={c.id} className={`chip${value === c.id ? ' on' : ''}`} onClick={() => onChange(c.id)}>
          <span>{c.icon}</span>{c.name}
        </button>
      ))}
    </div>
  );
}

export function AccountChips({ accounts, value, onChange, exclude }: { accounts: Account[]; value: string | null; onChange: (id: string) => void; exclude?: string | null }) {
  return (
    <div className="chips">
      {accounts.filter((a) => a.id !== exclude).map((a) => (
        <button type="button" key={a.id} className={`chip${value === a.id ? ' on' : ''}`} onClick={() => onChange(a.id)}>
          <span>{a.icon}</span>{a.name}
        </button>
      ))}
    </div>
  );
}

export function MonthPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="month-grid">
      {MONTHS_SHORT.map((m, i) => (
        <button type="button" key={m} className={`chip${value.includes(i) ? ' on' : ''}`}
          onClick={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b))}>
          {m}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <div className="emoji-grid">
      {EMOJIS.map((e) => (
        <button type="button" key={e} className={value === e ? 'on' : ''} onClick={() => onChange(e)} aria-label={e}>{e}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, children }: { icon?: string; children: ReactNode }) {
  return <div className="empty">{icon && <div className="big">{icon}</div>}{children}</div>;
}

export function Ico({ icon, color }: { icon: string; color: string }) {
  return <div className="ico" style={{ background: `${color}22`, color }}>{icon}</div>;
}
