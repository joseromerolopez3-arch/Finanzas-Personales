import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Download, FileUp, LogOut, Plus, Upload } from 'lucide-react';
import type { Category, Kind, Rule } from '../domain/types';
import { useApp } from '../state/app';
import { useLookups } from '../state/hooks';
import { useUI } from '../state/ui';
import { colorFor } from '../domain/defaults';
import { balanceOf } from '../domain/calc';
import { eur } from '../lib/format';
import { uid } from '../lib/id';
import { ADMIN_EMAIL } from '../config';
import { addResource, deleteResource, fetchResources, type Resource } from '../data/supabase';
import { Sheet } from '../ui/Sheet';
import { EmojiPicker, Field, Ico, Segmented } from '../ui/controls';
import { AccountEditSheet } from './Accounts';
import { KindToggle } from './parts';
import { downloadBackup, downloadCSV, readBackup } from './backup';

export function SettingsScreen() {
  const { settings, saveSettings, accounts, data, storeKind, email, signOut, replaceAll, toast, household, cloud, refreshHousehold } = useApp();
  const ui = useUI();
  const lookups = useLookups();
  const [name, setName] = useState(settings.name);
  const [accEdit, setAccEdit] = useState<string | 'new' | null>(null);
  const [catKind, setCatKind] = useState<Kind>('expense');
  const [catEdit, setCatEdit] = useState<Category | 'new' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const snap = await readBackup(file);
      if (!confirm(`Se sustituirán todos tus datos por los de la copia (${snap.transactions.length} movimientos). ¿Continuar?`)) return;
      replaceAll(snap);
      toast('Copia restaurada.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo leer la copia.');
    }
  };

  return (
    <>
      <div className="topbar"><h1 className="display" style={{ flex: 1 }}>Ajustes</h1></div>

      <div className="card">
        <Field label="Tu nombre">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => {
            if (name.trim() === settings.name) return;
            saveSettings({ name: name.trim() });
            void cloud?.setMyName(name.trim()).then(refreshHousehold);
          }} />
        </Field>
        <div className="field"><span className="label">Apariencia</span>
          <Segmented value={settings.theme} onChange={(theme) => saveSettings({ theme })}
            options={[{ value: 'system', label: 'Automática' }, { value: 'light', label: 'Clara' }, { value: 'dark', label: 'Oscura' }]} />
        </div>
        <p className="hint">{storeKind === 'cloud' ? `Sesión: ${email} · tus datos se guardan en la nube.` : 'Modo sin cuenta: los datos solo están en este dispositivo. Haz copias de seguridad.'}</p>
      </div>

      {storeKind === 'cloud' && household && (
        <>
          <div className="section-head"><h2>Hogar compartido</h2></div>
          <div className="card flush">
            <button className="list-row" onClick={ui.openHousehold}>
              <Ico icon="🏡" color="#3F8C74" />
              <div className="main-col">
                <div className="t1">{household.name}</div>
                <div className="t2">{household.members.length > 1 ? household.members.map((m) => m.name || m.email).join(', ') : 'Solo tú · invita a quien quieras'}</div>
              </div>
              <ChevronRight size={16} className="faint" />
            </button>
          </div>
        </>
      )}

      <div className="section-head"><h2>Cuentas</h2><button className="link" onClick={() => setAccEdit('new')}><Plus size={14} style={{ verticalAlign: -2 }} /> Añadir</button></div>
      <div className="card flush">
        {accounts.map((a) => (
          <button key={a.id} className="list-row" onClick={() => setAccEdit(a.id)} style={{ opacity: a.archived ? 0.5 : 1 }}>
            <Ico icon={a.icon} color={a.color} />
            <div className="main-col"><div className="t1">{a.name}</div><div className="t2">{a.archived ? 'Archivada' : `Saldo ${eur(balanceOf(a, data.transactions))}`}</div></div>
            <ChevronRight size={16} className="faint" />
          </button>
        ))}
      </div>

      <div className="section-head"><h2>Categorías</h2><button className="link" onClick={() => setCatEdit('new')}><Plus size={14} style={{ verticalAlign: -2 }} /> Añadir</button></div>
      <div className="card">
        <KindToggle value={catKind} onChange={setCatKind} />
        <div className="chips" style={{ marginTop: 12 }}>
          {data.categories.filter((c) => c.kind === catKind).sort((a, b) => a.position - b.position).map((c) => (
            <button key={c.id} className="chip" style={{ opacity: c.archived ? 0.5 : 1 }} onClick={() => setCatEdit(c)}>{c.icon} {c.name}</button>
          ))}
        </div>
      </div>

      <div className="section-head"><h2>Automatización y banco</h2></div>
      <div className="card flush">
        <button className="list-row" onClick={() => ui.openImport()}>
          <Ico icon="🏦" color="#2F6F5E" />
          <div className="main-col"><div className="t1">Importar extracto bancario</div><div className="t2">CSV, Excel, Norma 43 u OFX · concilia con lo apuntado</div></div>
          <ChevronRight size={16} className="faint" />
        </button>
        <button className="list-row" onClick={ui.openRecurring}>
          <Ico icon="🗓️" color="#4B6E8C" />
          <div className="main-col"><div className="t1">Pagos e ingresos programados</div><div className="t2">{data.recurring.length} configurados</div></div>
          <ChevronRight size={16} className="faint" />
        </button>
        <button className="list-row" onClick={() => setRulesOpen(true)}>
          <Ico icon="🪄" color="#8E5C93" />
          <div className="main-col"><div className="t1">Reglas de categorización</div><div className="t2">«Si el concepto contiene… → categoría»</div></div>
          <ChevronRight size={16} className="faint" />
        </button>
      </div>

      <div className="section-head"><h2>Tus datos</h2></div>
      <div className="card flush">
        <button className="list-row" onClick={() => downloadCSV(data.transactions, lookups, 'movimientos.csv')}>
          <Download size={18} /><div className="main-col"><div className="t1">Descargar movimientos (Excel/CSV)</div></div>
        </button>
        <button className="list-row" onClick={() => downloadBackup(data)}>
          <FileUp size={18} /><div className="main-col"><div className="t1">Copia de seguridad completa</div><div className="t2">Archivo .json con todo</div></div>
        </button>
        <button className="list-row" onClick={() => fileRef.current?.click()}>
          <Upload size={18} /><div className="main-col"><div className="t1">Restaurar copia de seguridad</div></div>
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {storeKind === 'cloud' && (
        <>
          <div className="section-head"><h2>Formación</h2></div>
          <div className="card flush">
            <button className="list-row" onClick={() => setResourcesOpen(true)}>
              <Ico icon="🎓" color="#B5891F" />
              <div className="main-col"><div className="t1">Vídeos y recursos de finanzas personales</div></div>
              <ChevronRight size={16} className="faint" />
            </button>
          </div>
        </>
      )}

      <button className="btn danger block" style={{ marginTop: 24 }} onClick={() => void signOut()}>
        <LogOut size={17} />{storeKind === 'cloud' ? 'Cerrar sesión' : 'Salir del modo sin cuenta'}
      </button>
      <p className="hint center">Cuentas Personales · v2</p>

      {accEdit && <AccountEditSheet account={accEdit === 'new' ? undefined : accounts.find((a) => a.id === accEdit)} onClose={() => setAccEdit(null)} />}
      {catEdit && <CategoryEditSheet category={catEdit === 'new' ? undefined : catEdit} kind={catKind} onClose={() => setCatEdit(null)} />}
      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}
      {resourcesOpen && <ResourcesSheet onClose={() => setResourcesOpen(false)} />}
    </>
  );
}

function CategoryEditSheet({ category, kind, onClose }: { category?: Category; kind: Kind; onClose: () => void }) {
  const { data, upsert, remove } = useApp();
  const [c, setC] = useState<Category>(category ?? {
    id: uid(), kind, name: '', icon: kind === 'income' ? '💰' : '📦', color: colorFor(data.categories.length), position: data.categories.length, archived: false
  });
  const used = data.transactions.some((t) => t.categoryId === c.id) || data.budgetLines.some((l) => l.categoryId === c.id);
  const save = () => { if (c.name.trim()) { upsert('categories', [{ ...c, name: c.name.trim() }]); onClose(); } };
  return (
    <Sheet title={category ? 'Editar categoría' : `Nueva categoría de ${kind === 'income' ? 'ingreso' : 'gasto'}`} onClose={onClose}>
      <Field label="Nombre"><input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus={!category} /></Field>
      <div className="field"><span className="label">Icono</span><EmojiPicker value={c.icon} onChange={(icon) => setC({ ...c, icon })} /></div>
      <div className="btn-row">
        {category && (used
          ? <button className="btn" onClick={() => { upsert('categories', [{ ...c, archived: !c.archived }]); onClose(); }}>{c.archived ? 'Reactivar' : 'Archivar'}</button>
          : <button className="btn danger" onClick={() => { remove('categories', [c.id]); onClose(); }}>Eliminar</button>)}
        <button className="btn primary" onClick={save} disabled={!c.name.trim()}>Guardar</button>
      </div>
      {category && used && <p className="hint">Tiene movimientos o presupuesto: se puede archivar (deja de aparecer al apuntar) pero no borrar.</p>}
    </Sheet>
  );
}

function RulesSheet({ onClose }: { onClose: () => void }) {
  const { data, upsert, remove, categories } = useApp();
  const { cat } = useLookups();
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const add = () => {
    const c = categories.find((x) => x.id === categoryId);
    if (!pattern.trim() || !c) return;
    const rule: Rule = { id: uid(), pattern: pattern.trim(), categoryId: c.id, kind: c.kind };
    upsert('rules', [rule]);
    setPattern('');
  };
  return (
    <Sheet title="Reglas de categorización" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Al importar extractos, la app aprende sola de cómo categorizas. Las reglas sirven para forzar casos concretos y tienen prioridad.
      </p>
      <div className="card flush">
        {data.rules.length ? data.rules.map((r) => (
          <div className="list-row" key={r.id}>
            <div className="main-col"><div className="t1">«{r.pattern}»</div><div className="t2">→ {cat(r.categoryId).icon} {cat(r.categoryId).name}</div></div>
            <button className="btn small" onClick={() => remove('rules', [r.id])}>Quitar</button>
          </div>
        )) : <p className="muted small center">Sin reglas todavía.</p>}
      </div>
      <Field label="Si el concepto contiene"><input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Ej. mercadona" /></Field>
      <Field label="Categoría">
        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Elige…</option>
          {categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.kind === 'income' ? '↑' : '↓'} {c.icon} {c.name}</option>)}
        </select>
      </Field>
      <button className="btn primary block" style={{ marginTop: 14 }} onClick={add} disabled={!pattern.trim() || !categoryId}>Añadir regla</button>
    </Sheet>
  );
}

function ResourcesSheet({ onClose }: { onClose: () => void }) {
  const { email, toast } = useApp();
  const [list, setList] = useState<Resource[] | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const admin = !!ADMIN_EMAIL && email?.toLowerCase() === ADMIN_EMAIL;
  useEffect(() => { void fetchResources().then(setList); }, []);
  return (
    <Sheet title="Formación" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>Vídeos y recursos abiertos sobre finanzas personales.</p>
      <div className="card flush">
        {list == null ? <p className="muted center small">Cargando…</p> : list.length ? list.map((r) => (
          <div className="list-row" key={r.id}>
            <a className="main-col t1" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
            {admin && <button className="btn small" onClick={async () => {
              try { await deleteResource(r.id); setList((l) => l!.filter((x) => x.id !== r.id)); } catch { toast('No se pudo borrar.'); }
            }}>Quitar</button>}
          </div>
        )) : <p className="muted center small">Aún no hay recursos.</p>}
      </div>
      {admin && (
        <>
          <Field label="Título"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Enlace"><input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
          <button className="btn primary block" style={{ marginTop: 14 }} disabled={!title.trim() || !/^https?:\/\//.test(url)} onClick={async () => {
            try { const r = await addResource(title.trim(), url.trim()); setList((l) => [...(l ?? []), r]); setTitle(''); setUrl(''); } catch { toast('No se pudo añadir.'); }
          }}>Añadir recurso</button>
        </>
      )}
    </Sheet>
  );
}
