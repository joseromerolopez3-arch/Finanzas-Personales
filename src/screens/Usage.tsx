import { useState } from 'react';
import { ArrowUp, ArrowDown, ChevronRight, Plus } from 'lucide-react';
import type { HouseholdKind, HouseholdRef, Property } from '../domain/types';
import { useApp } from '../state/app';
import { useUI } from '../state/ui';
import { uid } from '../lib/id';
import { Sheet } from '../ui/Sheet';
import { EmojiPicker, Ico } from '../ui/controls';
import { JoinBox } from './Household';

export const KIND_LABEL: Record<HouseholdKind, string> = { personal: 'Finanzas personales', shared: 'Hogar compartido' };
export const kindIcon = (k: HouseholdKind) => (k === 'personal' ? '👤' : '🏡');

/** Default names for new homes. */
const HOME_NAMES = ['Vivienda principal', 'Segunda vivienda', 'Tercera vivienda', 'Cuarta vivienda', 'Quinta vivienda'];
const HOME_ICONS = ['🏠', '🏖️', '🏡', '🏢', '🏔️'];
export const newHomes = (count: number, from = 0): Property[] =>
  Array.from({ length: count }, (_, i) => ({
    id: uid(), name: HOME_NAMES[from + i] ?? `Vivienda ${from + i + 1}`, icon: HOME_ICONS[(from + i) % HOME_ICONS.length], position: from + i, archived: false
  }));

/** Switch between the person's spaces (personal / shared) from anywhere. */
export function HouseholdSwitch() {
  const { households, household, switchHousehold } = useApp();
  if (households.length < 2 || !household) return null;
  return (
    <select className="hh-switch" value={household.id} aria-label="Cambiar de espacio" onChange={(e) => void switchHousehold(e.target.value)}>
      {households.map((h) => <option key={h.id} value={h.id}>{kindIcon(h.kind)} {h.name}</option>)}
    </select>
  );
}

/** Settings block: personal finances and/or shared household. */
export function UsageSection() {
  const { households, household, switchHousehold, restart, cloud, toast } = useApp();
  const ui = useUI();
  const [adding, setAdding] = useState<HouseholdKind | null>(null);
  if (!cloud || !household) return null;
  const has = (k: HouseholdKind) => households.some((h) => h.kind === k);
  const add = async (kind: HouseholdKind) => {
    try {
      const id = await cloud.createHousehold(kind === 'personal' ? 'Personal' : 'Hogar', kind);
      setAdding(null);
      await switchHousehold(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear.');
    }
  };
  const describe = (h: HouseholdRef) => {
    if (h.id !== household.id) return `${KIND_LABEL[h.kind]} · toca para abrir`;
    if (h.kind === 'personal') return KIND_LABEL.personal;
    const people = household.members.length > 1 ? household.members.map((m) => m.name || m.email).join(', ') : 'solo tú · invita a quien quieras';
    return `${KIND_LABEL.shared} · ${people}`;
  };
  return (
    <>
      <div className="section-head"><h2>Tipo de uso</h2></div>
      <div className="card flush">
        {households.map((h) => (
          <button key={h.id} className="list-row" onClick={() => (h.id === household.id ? ui.openHousehold() : void switchHousehold(h.id))}>
            <Ico icon={kindIcon(h.kind)} color={h.kind === 'personal' ? '#4B6E8C' : '#3F8C74'} />
            <div className="main-col">
              <div className="t1">{h.name}{h.id === household.id && households.length > 1 && <span className="tag ok" style={{ marginLeft: 6 }}>abierto</span>}</div>
              <div className="t2">{describe(h)}</div>
            </div>
            <ChevronRight size={16} className="faint" />
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {!has('personal') && <button className="chip" onClick={() => setAdding('personal')}><Plus size={15} />Añadir mis finanzas personales</button>}
        {!has('shared') && <button className="chip" onClick={() => setAdding('shared')}><Plus size={15} />Añadir un hogar compartido</button>}
      </div>
      {adding && (
        <Sheet title={adding === 'personal' ? 'Tus finanzas personales' : 'Hogar compartido'} onClose={() => setAdding(null)}>
          <p className="muted small" style={{ marginTop: 0 }}>
            {adding === 'personal'
              ? 'Un espacio solo tuyo, con sus propias cuentas y presupuesto. Nadie del hogar lo ve. Cambias de uno a otro desde el Resumen o desde aquí.'
              : 'Un espacio en común con tu pareja o familia: las mismas cuentas, movimientos y presupuesto para todos. Tus finanzas personales siguen aparte.'}
          </p>
          {adding === 'shared' && <JoinBox initialCode={null} onJoined={async () => { setAdding(null); await restart(); }} />}
          <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => void add(adding)}>
            {adding === 'personal' ? 'Crear mis finanzas personales' : 'Crear un hogar nuevo'}
          </button>
        </Sheet>
      )}
    </>
  );
}

/** Homes of the household: each one is a cost centre with its own budget. */
export function PropertiesSection() {
  const { properties, data } = useApp();
  const [open, setOpen] = useState(false);
  const active = properties.filter((p) => !p.archived);
  return (
    <>
      <div className="section-head"><h2>Viviendas</h2><button className="link" onClick={() => setOpen(true)}>{active.length ? 'Editar' : 'Configurar'}</button></div>
      <div className="card">
        {active.length ? (
          <div className="chips">{active.map((p) => <button key={p.id} className="chip" onClick={() => setOpen(true)}>{p.icon} {p.name}</button>)}</div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Una sola vivienda: no hace falta separar nada. Si tienes dos o más (segunda residencia, apartamento…), añádelas para ver y presupuestar lo que cuesta cada una.</p>
        )}
        {active.length > 0 && <p className="hint">Al apuntar un gasto eliges su vivienda; lo que no es de ninguna va a «General». {data.transactions.some((t) => t.propertyId) ? '' : 'Aún no hay movimientos asignados.'}</p>}
      </div>
      {open && <PropertiesSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function PropertiesSheet({ onClose }: { onClose: () => void }) {
  const { properties, data, upsert, remove, toast } = useApp();
  const [list, setList] = useState<Property[]>(() => (properties.length ? properties : newHomes(2)));
  const used = (id: string) => data.transactions.some((t) => t.propertyId === id) || data.budgetLines.some((l) => l.propertyId === id) || data.recurring.some((r) => r.propertyId === id);
  const set = (id: string, patch: Partial<Property>) => setList((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (i: number, d: number) => setList((l) => {
    const next = [...l];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const [iconFor, setIconFor] = useState<string | null>(null);

  const save = () => {
    const kept = list.filter((p) => p.name.trim()).map((p, i) => ({ ...p, name: p.name.trim(), position: i }));
    const keptIds = new Set(kept.map((p) => p.id));
    const gone = properties.filter((p) => !keptIds.has(p.id));
    const archive = gone.filter((p) => used(p.id)).map((p) => ({ ...p, archived: true }));
    upsert('properties', [...kept, ...archive]);
    remove('properties', gone.filter((p) => !used(p.id)).map((p) => p.id));
    if (archive.length) toast('Las viviendas con movimientos se archivan (sus datos se conservan).');
    onClose();
  };

  return (
    <Sheet title="Viviendas" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Cada vivienda es un centro de coste: verás lo que gastas en luz, comida… en cada una y podrás presupuestarlas por separado. Lo que no es de ninguna va a «General».
      </p>
      <div className="card flush">
        {list.map((p, i) => (
          <div key={p.id} style={{ opacity: p.archived ? 0.55 : 1 }}>
            <div className="list-row">
              <button className="icon-btn plain" style={{ fontSize: 20 }} onClick={() => setIconFor(iconFor === p.id ? null : p.id)} aria-label="Cambiar icono">{p.icon}</button>
              <input className="input" style={{ flex: 1, padding: '9px 10px' }} value={p.name} placeholder="Nombre" aria-label="Nombre de la vivienda"
                onChange={(e) => set(p.id, { name: e.target.value })} />
              <button className="icon-btn plain" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp size={16} /></button>
              <button className="icon-btn plain" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown size={16} /></button>
              {p.archived
                ? <button className="btn small" onClick={() => set(p.id, { archived: false })}>Reactivar</button>
                : <button className="btn small" onClick={() => setList((l) => l.filter((x) => x.id !== p.id))}>Quitar</button>}
            </div>
            {iconFor === p.id && <div style={{ padding: '0 12px 12px' }}><EmojiPicker value={p.icon} onChange={(icon) => { set(p.id, { icon }); setIconFor(null); }} /></div>}
          </div>
        ))}
      </div>
      <button className="btn block" style={{ marginTop: 10 }} disabled={list.length >= 8}
        onClick={() => setList((l) => [...l, ...newHomes(1, l.length)])}><Plus size={16} />Añadir vivienda</button>
      {list.length === 1 && <p className="hint">Con una sola vivienda no hace falta separar: puedes quitarla y todo irá a «General».</p>}
      <div className="btn-row">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  );
}

/** Number of homes, asked when setting up a space. */
export function HomesPicker({ value, onChange }: { value: Property[]; onChange: (v: Property[]) => void }) {
  const count = Math.max(1, value.length);
  const setCount = (n: number) => onChange(n <= 1 ? [] : n > value.length ? [...value, ...newHomes(n - value.length, value.length)] : value.slice(0, n));
  return (
    <>
      <div className="chips">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" className={`chip${count === n ? ' on' : ''}`} onClick={() => setCount(n)}>{n === 4 ? '4 o más' : n}</button>
        ))}
      </div>
      {value.length > 1 && (
        <div className="card flush" style={{ marginTop: 12 }}>
          {value.map((p) => (
            <div className="list-row" key={p.id}>
              <span style={{ fontSize: 20 }}>{p.icon}</span>
              <input className="input" style={{ flex: 1, padding: '9px 10px' }} value={p.name} aria-label="Nombre de la vivienda"
                onChange={(e) => onChange(value.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      )}
      <p className="hint">
        {value.length > 1
          ? 'Cada vivienda será un centro de coste con su propio presupuesto. Puedes cambiar los nombres o añadir más en Ajustes.'
          : 'Con una sola vivienda todo va junto. Si más adelante tienes otra, la añades en Ajustes → Viviendas.'}
      </p>
    </>
  );
}

