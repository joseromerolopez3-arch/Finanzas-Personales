import { useEffect, useMemo, useState } from 'react';
import { Landmark, RefreshCw, Search } from 'lucide-react';
import { useApp } from '../state/app';
import { bankCall, bankRedirectUrl, daysLeft, type BankAccountLink, type BankOption, type SyncSummary } from '../data/bank';
import { addDays, longDate, todayStr } from '../lib/dates';
import { eur } from '../lib/format';
import { normalizeLoose } from '../domain/text';
import { Sheet } from '../ui/Sheet';
import { Empty, Field } from '../ui/controls';

export function summaryText(s: SyncSummary): string {
  const parts = [`${s.created} movimientos nuevos`, `${s.matched} conciliados`];
  if (s.transfers) parts.push(`${s.transfers} traspasos`);
  if (s.scheduled) parts.push(`${s.scheduled} programados hechos`);
  return parts.join(' · ') + (s.errors.length ? `. Avisos: ${s.errors.join('; ')}` : '');
}

/** Connected banks: status, accounts, sync, renew and disconnect. */
export function BanksSheet({ onClose, mapLinkId }: { onClose: () => void; mapLinkId?: string | null }) {
  const { bank, refreshBank, toast, reload, accounts } = useApp();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const [mapping, setMapping] = useState<string | null>(mapLinkId ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { bankCall<{ configured: boolean }>('status').then((r) => setConfigured(r.configured)).catch(() => setConfigured(false)); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo completar.'); }
    setBusy(false);
  };
  const sync = () => run(async () => {
    const s = await bankCall<SyncSummary>('sync');
    await Promise.all([refreshBank(), reload()]);
    toast(summaryText(s));
  });

  if (picking) return <BankPicker onClose={() => setPicking(false)} />;
  if (mapping) return <MapAccounts linkId={mapping} onClose={() => { setMapping(null); if (mapLinkId) onClose(); }} />;

  return (
    <Sheet title="Bancos conectados" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Cada mañana se descargan los movimientos y el saldo de las cuentas enlazadas. Lo que ya apuntasteis se concilia solo; lo nuevo queda en «Por revisar».
      </p>
      {configured === false && (
        <div className="warn-box">La conexión bancaria aún no está activada: falta configurar Enable Banking en Supabase (lo hace una sola vez la persona titular). Mientras tanto puedes importar extractos desde Movimientos.</div>
      )}
      {bank.links.length === 0 ? (
        <Empty icon="🏦">Aún no hay ningún banco conectado.</Empty>
      ) : bank.links.map((l) => {
        const left = daysLeft(l.validUntil);
        const expired = l.status === 'expired' || (left != null && left <= 0);
        const tag = expired ? <span className="tag over">Caducada</span>
          : l.status === 'error' ? <span className="tag warn">Con avisos</span>
          : left != null && left <= 10 ? <span className="tag warn">Caduca en {left} días</span>
          : <span className="tag ok">Activa</span>;
        const accs = bank.accounts.filter((a) => a.linkId === l.id);
        return (
          <div className="card" key={l.id} style={{ marginTop: 12 }}>
            <div className="row-flex">
              <Landmark size={18} />
              <strong style={{ flex: 1 }}>{l.aspspName}</strong>
              {tag}
            </div>
            <div className="xsmall muted" style={{ marginTop: 4 }}>
              {l.lastSyncAt ? `Última sincronización: ${new Date(l.lastSyncAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Aún sin sincronizar'}
              {l.validUntil && ` · autorizada hasta el ${longDate(l.validUntil.slice(0, 10))}`}
            </div>
            {l.lastError && <div className="error-text">{l.lastError}</div>}
            <div style={{ marginTop: 8 }}>
              {accs.map((a) => (
                <div className="row-flex small" key={a.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ flex: 1 }}>{a.name}{a.ibanTail && <span className="faint"> ···{a.ibanTail}</span>}
                    <div className="xsmall muted">{a.accountId ? `→ ${accounts.find((x) => x.id === a.accountId)?.name ?? 'cuenta borrada'}` : 'Sin enlazar'}</div>
                  </span>
                  {a.balance != null && <span className="num">{eur(a.balance)}</span>}
                </div>
              ))}
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              <button className="chip" onClick={() => setMapping(l.id)}>Enlazar cuentas</button>
              {(expired || (left != null && left <= 10)) && (
                <button className="chip" disabled={busy} onClick={() => run(() => startAuth({ name: l.aspspName, country: 'ES' }, l.id))}>Renovar autorización</button>
              )}
              <button className="chip" disabled={busy} onClick={() => confirm(`¿Desconectar ${l.aspspName}? Los movimientos ya descargados se conservan.`) && run(async () => {
                await bankCall('disconnect', { linkId: l.id });
                await refreshBank();
              })}>Desconectar</button>
            </div>
          </div>
        );
      })}
      <div className="btn-row">
        {bank.links.length > 0 && <button className="btn" disabled={busy || !configured} onClick={sync}><RefreshCw size={16} />Sincronizar ahora</button>}
        <button className="btn primary" disabled={busy || !configured} onClick={() => setPicking(true)}>Conectar un banco</button>
      </div>
      <p className="hint">La conexión usa Enable Banking (normativa europea PSD2): te identificas en la web de tu banco y la app nunca ve tus claves. La autorización dura hasta 180 días según el banco; te avisaremos para renovarla.</p>
    </Sheet>
  );
}

async function startAuth(aspsp: { name: string; country: string }, linkId?: string) {
  const r = await bankCall<{ url: string }>('start', { aspsp, redirectUrl: bankRedirectUrl(), linkId });
  location.href = r.url;
}

function BankPicker({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [list, setList] = useState<BankOption[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    bankCall<{ banks: BankOption[] }>('banks', { country: 'ES' }).then((r) => setList(r.banks)).catch((e) => { toast(e.message); setList([]); });
  }, [toast]);
  const shown = useMemo(() => (list ?? []).filter((b) => normalizeLoose(b.name).includes(normalizeLoose(q))), [list, q]);
  return (
    <Sheet title="Elige tu banco" onClose={onClose}>
      <div className="search">
        <Search size={17} />
        <input className="input" placeholder="Buscar banco…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="card flush" style={{ marginTop: 12 }}>
        {list == null ? <p className="muted center small">Cargando bancos…</p>
          : shown.length ? shown.map((b) => (
            <button key={b.name} className="list-row" disabled={!!busy} onClick={async () => {
              setBusy(b.name);
              try { await startAuth({ name: b.name, country: b.country }); } catch (e) { toast(e instanceof Error ? e.message : 'Error'); setBusy(null); }
            }}>
              {b.logo ? <img src={b.logo} alt="" width={32} height={32} style={{ objectFit: 'contain', borderRadius: 6, background: '#fff' }} /> : <Landmark size={22} />}
              <div className="main-col"><div className="t1">{b.name}</div></div>
              {busy === b.name && <span className="small muted">Abriendo…</span>}
            </button>
          )) : <p className="muted center small">No hay resultados.</p>}
      </div>
      <p className="hint">Te llevaremos a la web de tu banco para que autorices el acceso de solo lectura y volverás aquí.</p>
    </Sheet>
  );
}

/** Which app account each bank account feeds, and from which date to bring movements. */
export function MapAccounts({ linkId, onClose }: { linkId: string; onClose: () => void }) {
  const { bank, activeAccounts, refreshBank, reload, toast } = useApp();
  const accs = bank.accounts.filter((a) => a.linkId === linkId);
  const today = todayStr();
  const takenElsewhere = new Set(bank.accounts.filter((a) => a.linkId !== linkId && a.accountId).map((a) => a.accountId));
  const defaultFrom = (accountId: string | null) => {
    const acc = activeAccounts.find((x) => x.id === accountId);
    if (!acc) return `${today.slice(0, 7)}-01`;
    const limit = addDays(today, -89);
    return acc.openingDate > limit ? acc.openingDate : limit;
  };
  const [choice, setChoice] = useState<Record<string, { value: string; from: string }>>(() =>
    Object.fromEntries(accs.map((a) => [a.id, { value: a.accountId ?? (accs.length === 1 ? 'new' : 'none'), from: a.syncFrom ?? defaultFrom(a.accountId) }])));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const chosen = Object.values(choice).map((c) => c.value).filter((v) => v !== 'new' && v !== 'none');
    if (new Set(chosen).size !== chosen.length) { toast('Cada cuenta de la app solo puede enlazarse con una cuenta del banco.'); return; }
    setBusy(true);
    try {
      const s = await bankCall<SyncSummary>('map', {
        accounts: accs.map((a: BankAccountLink) => {
          const c = choice[a.id];
          return {
            bankAccountId: a.id,
            accountId: c.value === 'new' || c.value === 'none' ? null : c.value,
            createName: c.value === 'new' ? a.name : null,
            syncFrom: c.value === 'none' ? null : c.from
          };
        })
      });
      await Promise.all([refreshBank(), reload()]);
      toast(summaryText(s));
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
    setBusy(false);
  };

  return (
    <Sheet title="Enlazar cuentas" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Indica con qué cuenta de la app se corresponde cada cuenta del banco. Si eliges una que ya usáis, los movimientos que apuntasteis a mano se conciliarán y no se duplicarán.
      </p>
      {accs.length === 0 && <Empty>Esta conexión no tiene cuentas.</Empty>}
      {accs.map((a) => {
        const c = choice[a.id];
        return (
          <div className="card" key={a.id} style={{ marginTop: 12 }}>
            <strong>{a.name}</strong>{a.ibanTail && <span className="faint"> ···{a.ibanTail}</span>}
            {a.balance != null && <div className="xsmall muted">Saldo en el banco: {eur(a.balance)}</div>}
            <Field label="En la app">
              <select className="input" value={c.value} onChange={(e) => setChoice({ ...choice, [a.id]: { value: e.target.value, from: defaultFrom(e.target.value) } })}>
                <option value="new">➕ Crear la cuenta «{a.name}»</option>
                {activeAccounts.filter((x) => !takenElsewhere.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.icon} {x.name}</option>)}
                <option value="none">No sincronizar</option>
              </select>
            </Field>
            {c.value !== 'none' && (
              <Field label="Traer movimientos desde" hint={c.value === 'new' ? 'El saldo inicial se calcula solo a partir del saldo del banco.' : 'Normalmente el banco permite hasta 90 días atrás.'}>
                <input className="input" type="date" max={today} min={addDays(today, -730)} value={c.from}
                  onChange={(e) => e.target.value && setChoice({ ...choice, [a.id]: { ...c, from: e.target.value } })} />
              </Field>
            )}
          </div>
        );
      })}
      <div className="btn-row">
        <button className="btn" onClick={onClose}>Más tarde</button>
        <button className="btn primary" disabled={busy || !accs.length} onClick={() => void save()}>{busy ? 'Sincronizando…' : 'Guardar y sincronizar'}</button>
      </div>
    </Sheet>
  );
}
