import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApp } from '../state/app';
import type { Account, BudgetMode, Property } from '../domain/types';
import { colorFor, defaultAccounts, defaultCategories } from '../domain/defaults';
import { buildAmounts, lineId } from '../domain/budget';
import { todayStr } from '../lib/dates';
import { uid } from '../lib/id';
import { Field, MoneyInput } from '../ui/controls';
import { JoinBox, peekInvite } from './Household';
import { HomesPicker, kindIcon } from './Usage';

type Usage = 'personal' | 'shared' | 'both';

const USAGES: { value: Usage; title: string; text: string }[] = [
  { value: 'personal', title: 'Mis finanzas personales', text: 'Solo tú: tus cuentas, tus gastos y tu presupuesto.' },
  { value: 'shared', title: 'Un hogar compartido', text: 'Con tu pareja o familia: todo en común y en tiempo real.' },
  { value: 'both', title: 'Las dos cosas', text: 'Tus finanzas personales y, aparte, las del hogar compartido. Cambias de una a otra con un toque.' }
];

// Survives the reload that happens after joining a household with a code.
const memo: { usage: Usage | null; name: string } = { usage: null, name: '' };

/**
 * First run (name and what the app is for) and setup of an empty space
 * (homes, accounts and budget). A space someone else already set up only needs the first part.
 */
export function Onboarding() {
  const { data, upsert, settings, email, cloud, restart, household, households, switchHousehold, toast } = useApp();
  const [inviteCode] = useState(peekInvite);
  const firstRun = !settings.onboarded;
  // Joined an existing household: its accounts and budget are already there.
  const joined = data.accounts.length > 0 || data.transactions.length > 0;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.name || memo.name);
  const [usage, setUsage] = useState<Usage | null>(memo.usage ?? (inviteCode ? 'shared' : null));
  const [date, setDate] = useState(todayStr());
  const [homes, setHomes] = useState<Property[]>([]);
  const [accounts, setAccounts] = useState<Account[]>(() => (data.accounts.length ? data.accounts : defaultAccounts()));
  const [mode, setMode] = useState<BudgetMode | 'later'>('category');
  const [savings, setSavings] = useState<number>(NaN);
  const [busy, setBusy] = useState(false);

  const setAcc = (id: string, patch: Partial<Account>) => setAccounts((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const pickUsage = (u: Usage) => { setUsage(u); memo.usage = u; };
  const wantsShared = usage === 'shared' || usage === 'both';
  // In «both», the space set up now is the personal one unless the person joined a shared one.
  const settingUp = !firstRun ? household?.kind : usage === 'shared' || (usage === 'both' && joined) ? 'shared' : 'personal';

  const finish = async () => {
    setBusy(true);
    try {
      if (firstRun && cloud) {
        await cloud.setMyName(name.trim());
        if (usage === 'personal') await cloud.setKind('personal', 'Personal');
        else if (usage === 'shared' && !joined) await cloud.setKind('shared', 'Hogar');
        else if (usage === 'both') {
          if (joined) await cloud.createHousehold('Personal', 'personal');
          else {
            await cloud.setKind('personal', 'Personal');
            await cloud.createHousehold('Hogar', 'shared');
          }
        }
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar el tipo de uso. Puedes cambiarlo en Ajustes.');
    }
    if (!joined) {
      const year = Number(date.slice(0, 4));
      if (!data.categories.length) upsert('categories', defaultCategories());
      if (homes.length > 1) upsert('properties', homes.map((h, i) => ({ ...h, name: h.name.trim() || `Vivienda ${i + 1}`, position: i })));
      upsert('accounts', accounts.filter((a) => a.name.trim()).map((a, i) => ({ ...a, name: a.name.trim(), position: i, openingDate: date })));
      if (mode !== 'later') {
        upsert('budgetYears', [{ id: String(year), year, mode }]);
        if (mode === 'savings' && savings > 0) {
          upsert('budgetLines', [{ id: lineId(year, 'savings', null), year, kind: 'savings', categoryId: null, propertyId: null, pattern: 'monthly', base: savings, amounts: buildAmounts('monthly', savings) }]);
        }
      }
    }
    memo.usage = null;
    memo.name = '';
    if (firstRun || !joined) {
      upsert('settings', [{
        ...settings, id: 'me', name: name.trim(), onboarded: true,
        ...(firstRun ? { startMonth: date.slice(0, 7) } : {}),
        ...(!joined ? { lastAccountId: accounts[0]?.id ?? null } : {})
      }]);
    }
    if (firstRun && cloud) {
      if (usage === 'both') toast(joined ? 'Listo. Tus finanzas personales están aparte: cámbialas desde el Resumen para configurarlas.' : 'Listo. Tu hogar compartido está aparte: ábrelo desde el Resumen para configurarlo e invitar a quien quieras.');
      else if (usage === 'shared' && !joined) toast('Listo. Invita a tu pareja o familia desde Ajustes → Tipo de uso.');
    }
    // Refresh names and kinds of the spaces.
    if (firstRun && cloud) await restart();
    setBusy(false);
  };

  const welcome = (
    <div key="welcome">
      <h2 className="display" style={{ fontSize: 24 }}>Te damos la bienvenida</h2>
      <p className="muted">Unos pasos rápidos y lo tienes listo. Todo se puede cambiar después.</p>
      <Field label="¿Cómo te llamas?">
        <input className="input" value={name} onChange={(e) => { setName(e.target.value); memo.name = e.target.value; }} placeholder="Tu nombre" autoFocus />
      </Field>
      {email && <p className="hint">Cuenta: {email}</p>}
      {cloud && (
        <>
          <div className="label small muted" style={{ fontWeight: 600, margin: '18px 0 8px' }}>¿Para qué vas a usar la app?</div>
          {USAGES.map((u) => (
            <button key={u.value} className={`choice${usage === u.value ? ' on' : ''}`} onClick={() => pickUsage(u.value)}>
              <div className="t">{u.title}</div>
              <div className="d">{u.text}</div>
            </button>
          ))}
          {joined && <div className="notice">Ya formas parte de un hogar con sus cuentas y su presupuesto.{usage === 'both' ? ' Tus finanzas personales se crearán aparte.' : ''}</div>}
          {wantsShared && !joined && (
            <div style={{ marginTop: 16 }}>
              <div className="label small muted" style={{ fontWeight: 600, marginBottom: 6 }}>¿Te han invitado a un hogar? Introduce el código</div>
              <JoinBox compact initialCode={inviteCode} displayName={name.trim()} onJoined={restart} />
              <p className="hint">Si no tienes código, sigue: crearás el hogar y podrás invitar a quien quieras desde Ajustes.</p>
            </div>
          )}
        </>
      )}
    </div>
  );

  const spaceName = settingUp === 'shared' ? 'del hogar' : settingUp === 'personal' ? 'personales' : '';
  const homesStep = (
    <div key="homes">
      {!firstRun && household && <p className="tag ok" style={{ display: 'inline-block', marginTop: 0 }}>{kindIcon(household.kind)} {household.name}</p>}
      <h2 className="display" style={{ fontSize: 24 }}>¿Cuántas viviendas tienes?</h2>
      <p className="muted">Si tienes más de una (una segunda residencia, un apartamento…), cada una será un centro de coste: verás lo que cuesta la luz, la comida… en cada casa y podrás presupuestarlas por separado.</p>
      <HomesPicker value={homes} onChange={setHomes} />
    </div>
  );

  const accountsStep = (
    <div key="accounts">
      <h2 className="display" style={{ fontSize: 24 }}>Tus cuentas {spaceName}</h2>
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
    </div>
  );

  const budgetStep = (
    <div key="budget">
      <h2 className="display" style={{ fontSize: 24 }}>¿Cómo quieres presupuestar?</h2>
      <p className="muted">Elige la forma que te resulte más cómoda. Puedes cambiarla cada año.</p>
      <button className={`choice${mode === 'category' ? ' on' : ''}`} onClick={() => setMode('category')}>
        <div className="t">Por categorías</div>
        <div className="d">Indicas cuánto prevés ingresar y gastar en cada categoría{homes.length > 1 ? ' y vivienda' : ''}. La app calcula el ahorro previsto y compara cada categoría con su presupuesto.</div>
      </button>
      <button className={`choice${mode === 'savings' ? ' on' : ''}`} onClick={() => setMode('savings')}>
        <div className="t">Solo un objetivo de ahorro</div>
        <div className="d">Indicas cuánto quieres ahorrar y la app compara solo eso. Verás igualmente el detalle de gastos por categoría{homes.length > 1 ? ' y vivienda' : ''}.</div>
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
  );

  const steps = [...(firstRun ? [welcome] : []), ...(joined ? [] : [homesStep, accountsStep, budgetStep])];
  const current = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;
  const canNext = current !== welcome || (name.trim().length > 0 && (!cloud || !!usage));
  const others = households.filter((h) => h.id !== household?.id);
  return (
    <div className="auth">
      <div className="auth-box" style={{ maxWidth: 460 }}>
        <div className="steps">{steps.map((_, i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
        {current}
        <div className="btn-row">
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Atrás</button>}
          <button className="btn primary" disabled={!canNext || busy} onClick={() => (last ? void finish() : setStep(step + 1))}>
            {last ? 'Empezar' : 'Siguiente'}
          </button>
        </div>
        {!firstRun && others.length > 0 && (
          <p className="hint center">
            <button className="link" onClick={() => void switchHousehold(others[0].id)}>Volver a «{others[0].name}»</button>
          </p>
        )}
      </div>
    </div>
  );
}
