import { useEffect, useState } from 'react';
import { Copy, Share2, UserMinus } from 'lucide-react';
import { useApp } from '../state/app';
import { Sheet } from '../ui/Sheet';
import { Field } from '../ui/controls';

export const inviteLink = (code: string) => `${location.origin}/?unirse=${code}`;

/** Invitation code from a shared link (?unirse=CODE). It stays in the URL until used, so it survives sign-up. */
export function peekInvite(): string | null {
  const code = new URLSearchParams(location.search).get('unirse');
  return code ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
}
export function clearInvite() {
  const params = new URLSearchParams(location.search);
  if (!params.has('unirse')) return;
  params.delete('unirse');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
}

export function HouseholdSheet({ onClose, initialCode }: { onClose: () => void; initialCode?: string | null }) {
  const { household, cloud, userId, settings, refreshHousehold, restart, toast, upsert } = useApp();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(household?.name ?? '');
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  const me = household?.members.find((m) => m.userId === userId);
  const owner = me?.role === 'owner';

  useEffect(() => { void cloud?.myHouseholds().then((l) => setOthers(l.filter((h) => h.id !== household?.id))); }, [cloud, household?.id]);
  if (!cloud || !household) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo completar.'); }
    setBusy(false);
  };
  const share = async (c: string) => {
    const url = inviteLink(c);
    const text = `Únete a nuestro hogar en Cuentas Personales: ${url} (código ${c})`;
    if (navigator.share) { try { await navigator.share({ title: 'Cuentas Personales', text, url }); return; } catch { /* cancelled */ } }
    await navigator.clipboard?.writeText(url);
    toast('Enlace copiado');
  };

  return (
    <Sheet title="Hogar compartido" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Todas las personas del hogar ven y apuntan en las mismas cuentas, movimientos y presupuesto, en tiempo real. Tu nombre y tus preferencias son solo tuyos.
      </p>
      <Field label="Nombre del hogar">
        <input className="input" value={name} disabled={!owner} onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== household.name && void run(async () => { await cloud.renameHousehold(name.trim()); await refreshHousehold(); })} />
      </Field>

      <div className="section-head"><h2>Personas ({household.members.length})</h2></div>
      <div className="card flush">
        {household.members.map((m) => (
          <div className="list-row" key={m.userId}>
            <div className="ico" style={{ background: 'var(--surface-2)', fontWeight: 700 }}>{(m.name || m.email || '?').charAt(0).toUpperCase()}</div>
            <div className="main-col">
              <div className="t1">{m.name || m.email}{m.userId === userId && ' (tú)'}</div>
              <div className="t2">{m.role === 'owner' ? 'Titular' : 'Miembro'}{m.name && m.email ? ` · ${m.email}` : ''}</div>
            </div>
            {owner && m.userId !== userId && (
              <button className="icon-btn plain" aria-label={`Quitar a ${m.name || m.email}`} disabled={busy}
                onClick={() => confirm(`¿Quitar a ${m.name || m.email} del hogar? Dejará de ver los datos.`) && void run(async () => { await cloud.removeMember(m.userId); await refreshHousehold(); })}>
                <UserMinus size={18} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="section-head"><h2>Invitar a alguien</h2></div>
      <div className="card">
        {code ? (
          <>
            <div className="center">
              <div className="small muted">Código de invitación</div>
              <div className="display num" style={{ fontSize: 34, letterSpacing: '0.12em', margin: '4px 0 8px' }}>{code}</div>
              <div className="hint">Válido 7 días y para una sola persona. Que abra el enlace o, al registrarse, introduzca el código.</div>
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => void navigator.clipboard?.writeText(inviteLink(code)).then(() => toast('Enlace copiado'))}><Copy size={16} />Copiar enlace</button>
              <button className="btn primary" onClick={() => void share(code)}><Share2 size={16} />Compartir</button>
            </div>
          </>
        ) : (
          <button className="btn primary block" disabled={busy} onClick={() => void run(async () => setCode(await cloud.createInvite()))}>Crear invitación</button>
        )}
      </div>

      <JoinBox initialCode={initialCode ?? null} onJoined={async () => { await restart(); onClose(); }} />

      {others.length > 0 && (
        <>
          <div className="section-head"><h2>Tus otros hogares</h2></div>
          <div className="card flush">
            {others.map((h) => (
              <button key={h.id} className="list-row" onClick={() => { upsert('settings', [{ ...settings, householdId: h.id }]); void restart(); onClose(); }}>
                <div className="main-col"><div className="t1">{h.name}</div><div className="t2">Cambiar a este hogar</div></div>
              </button>
            ))}
          </div>
        </>
      )}

      {household.members.length > 1 && (
        <button className="btn danger block" style={{ marginTop: 20 }} disabled={busy}
          onClick={() => confirm('¿Salir de este hogar? Dejarás de ver sus datos (los demás los conservan).') && void run(async () => { await cloud.leave(); await restart(); onClose(); })}>
          Salir del hogar
        </button>
      )}
    </Sheet>
  );
}

/** Enter an invitation code, see whose household it is and join it. */
export function JoinBox({ initialCode, onJoined, compact, displayName }: {
  initialCode: string | null; onJoined: () => Promise<void> | void; compact?: boolean; displayName?: string;
}) {
  const { cloud, settings, toast } = useApp();
  const [code, setCode] = useState(initialCode ?? '');
  const [info, setInfo] = useState<{ household_name: string; invited_by: string | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Validate straight away a code received in an invitation link.
  useEffect(() => { if (initialCode) void check(initialCode); }, [initialCode]);
  if (!cloud) return null;

  async function check(c: string) {
    setError(''); setInfo(null);
    if (c.trim().length < 6) return;
    const i = await cloud!.inviteInfo(c).catch(() => null);
    if (i) setInfo(i); else setError('El código no es válido o ha caducado.');
  }
  const join = async () => {
    setBusy(true);
    try {
      await cloud.join(code, displayName ?? settings.name);
      clearInvite();
      toast(`Te has unido a «${info?.household_name ?? 'el hogar'}».`);
      await onJoined();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo unir.');
    }
    setBusy(false);
  };

  return (
    <>
      {!compact && <div className="section-head"><h2>Unirme a otro hogar</h2></div>}
      <div className={compact ? '' : 'card'}>
        <div className="row-flex">
          <input className="input num" value={code} maxLength={8} placeholder="Código de 8 caracteres" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
            onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); setCode(v); if (v.length === 8) void check(v); else { setInfo(null); setError(''); } }} />
        </div>
        {info && (
          <div className="notice">
            Hogar «{info.household_name}»{info.invited_by ? `, invitación de ${info.invited_by}` : ''}. Pasarás a ver y apuntar sus cuentas, movimientos y presupuesto.
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
        {info && <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy} onClick={() => void join()}>Unirme</button>}
      </div>
    </>
  );
}
