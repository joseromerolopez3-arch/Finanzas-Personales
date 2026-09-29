import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApp } from '../state/app';
import type { Account, BudgetMode } from '../domain/types';
import { colorFor, defaultAccounts, defaultCategories } from '../domain/defaults';
import { buildAmounts, lineId } from '../domain/budget';
import { todayStr } from '../lib/dates';
import { uid } from '../lib/id';
import { Field, MoneyInput } from '../ui/controls';
import { JoinBox, peekInvite } from './Household';

export function Onboarding() {
  const { data, upsert, settings, email, cloud, restart } = useApp();
  const [inviteCode] = useState(peekInvite);
  const [showJoin, setShowJoin] = useState(!!inviteCode);
  // Joined an existing household: its accounts and budget are already there.
  const joined = data.accounts.length > 0 || data.transactions.length > 0;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.name);
  const [date, setDate] = useState(todayStr());
  const [accounts, setAccounts] = useState<Account[]>(() => (data.accounts.length ? data.accounts : defaultAccounts()));
  const [mode, setMode] = useState<BudgetMode | 'later'>('category');
  const [savings, setSavings] = useState<number>(NaN);

  const setAcc = (id: string, patch: Partial<Account>) => setAccounts((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const finish = () => {
    void cloud?.setMyName(name.trim());
    if (joined) {
      upsert('settings', [{ ...settings, id: 'me', name: name.trim(), onboarded: true }]);
      return;
    }
    const year = Number(date.slice(0, 4));
    if (!data.categories.length) upsert('categories', defaultCategories());
    upsert('accounts', accounts.filter((a) => a.name.trim()).map((a, i) => ({ ...a, name: a.name.trim(), position: i, openingDate: date })));
    if (mode !== 'later') {
      upsert('budgetYears', [{ id: String(year), year, mode }]);
      if (mode === 'savings' && savings > 0) {
        upsert('budgetLines', [{ id: lineId(year, 'savings', null), year, kind: 'savings', categoryId: null, pattern: 'monthly', base: savings, amounts: buildAmounts('monthly', savings) }]);
      }
    }
    upsert('settings', [{ ...settings, id: 'me', name: name.trim(), startMonth: date.slice(0, 7), onboarded: true, lastAccountId: accounts[0]?.id ?? null }]);
  };

  const steps = [
    <div key="0">
      <h2 className="display" style={{ fontSize: 24 }}>Te damos la bienvenida</h2>
      <p className="muted">Tres pasos rápidos y lo tienes listo. Todo se puede cambiar después.</p>
      <Field label="¿Cómo te llamas?">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" autoFocus />
      </Field>
      {email && <p className="hint">Cuenta: {email}</p>}
      {joined && <div className="notice">Ya formas parte de un hogar con sus cuentas y su presupuesto. Solo falta tu nombre.</div>}
      {cloud && !joined && (
        <div style={{ marginTop: 18 }}>
          {showJoin ? (
            <>
              <div className="label small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Código de invitación</div>
              <JoinBox compact initialCode={inviteCode} displayName={name.trim()} onJoined={restart} />
            </>
          ) : (
            <button className="link" onClick={() => setShowJoin(true)}>¿Te han invitado a un hogar compartido? Introduce el código</button>
          )}
        </div>
      )}
    </div>,
    <div key="1">
      <h2 className="display" style={{ fontSize: 24 }}>Tus cuentas</h2>
      <p className="muted">Pon lo que hay hoy en cada una. Puedes dejarlo en 0 y ajustarlo más tarde.</p>
      <Field label="Saldos a fecha de">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} />
      </Field>
      <div className="card flush" style={{ marginTop: 14 }}>
        {accounts.map((a) => (
          <div className="list-row" key={a.id}>
            <span style={{ fontSize: 20 }}>{a.icon}</span>
            <input className="input" style={{ flex: 1.3, padding: '9px 10px' }} value={a.name} onChange={(e) => setAcc(a.id, { name: e.target.value })} aria-label="Nombre de la cuenta" />
            <div style={{ flex: 1 }}><MoneyInput value={a.openingBalance || null} onChange={(n) => setAcc(a.id, { openingBalance: isNaN(n) ? 0 : n })} allowNegative /></div>
            <button className="icon-btn plain" onClick={() => setAccounts((l) => l.filter((x) => x.id !== a.id))} aria-label={`Quitar ${a.name}`}><Trash2 size={17} /></button>
          </div>
        ))}
      </div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={() => setAccounts((l) => [...l, {
        ...defaultAccounts()[0], id: uid(), name: '', icon: '🏦', color: colorFor(l.length), position: l.length
      }])}>Añadir cuenta</button>
    </div>,
    <div key="2">
      <h2 className="display" style={{ fontSize: 24 }}>¿Cómo quieres presupuestar?</h2>
      <p className="muted">Elige la forma que te resulte más cómoda. Puedes cambiarla cada año.</p>
      <button className={`choice${mode === 'category' ? ' on' : ''}`} onClick={() => setMode('category')}>
        <div className="t">Por categorías</div>
        <div className="d">Indicas cuánto prevés ingresar y gastar en cada categoría. La app calcula el ahorro previsto y compara cada categoría con su presupuesto.</div>
      </button>
      <button className={`choice${mode === 'savings' ? ' on' : ''}`} onClick={() => setMode('savings')}>
        <div className="t">Solo un objetivo de ahorro</div>
        <div className="d">Indicas cuánto quieres ahorrar y la app compara solo eso. Verás igualmente el detalle de gastos por categoría.</div>
      </button>
      {mode === 'savings' && (
        <Field label="¿Cuánto quieres ahorrar cada mes?" hint="Podrás poner importes distintos por mes desde Presupuesto.">
          <MoneyInput value={isNaN(savings) ? null : savings} onChange={setSavings} />
        </Field>
      )}
      <button className={`choice${mode === 'later' ? ' on' : ''}`} onClick={() => setMode('later')}>
        <div className="t">Más tarde</div>
        <div className="d">Empieza registrando movimientos y decide después.</div>
      </button>
    </div>
  ];

  const canNext = step !== 0 || name.trim().length > 0;
  if (joined) steps.splice(1);
  return (
    <div className="auth">
      <div className="auth-box" style={{ maxWidth: 460 }}>
        <div className="steps">{steps.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
        {steps[step]}
        <div className="btn-row">
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Atrás</button>}
          <button className="btn primary" disabled={!canNext} onClick={() => (step < steps.length - 1 ? setStep(step + 1) : finish())}>
            {step < steps.length - 1 ? 'Siguiente' : 'Empezar'}
          </button>
        </div>
      </div>
    </div>
  );
}
