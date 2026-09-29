import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '../state/app';
import { authErrorText, supabase } from '../data/supabase';
import { Field } from '../ui/controls';

type Mode = 'login' | 'signup' | 'reset';

export function AuthScreen() {
  const { phase, setPhase, startLocal } = useApp();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(authErrorText(e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  };

  if (phase === 'recovery') {
    return (
      <div className="auth">
        <form className="auth-box" onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const { error } = await supabase!.auth.updateUser({ password });
          if (error) throw error;
          setPhase('loading');
          location.reload();
        }); }}>
          <h1 className="display">Nueva contraseña</h1>
          <Field label="Contraseña"><PasswordInput value={password} onChange={setPassword} show={show} setShow={setShow} autoComplete="new-password" /></Field>
          {error && <div className="error-text">{error}</div>}
          <button className="btn primary block" style={{ marginTop: 18 }} disabled={busy || password.length < 6}>Guardar contraseña</button>
        </form>
      </div>
    );
  }

  const submit = () => run(async () => {
    const e = email.trim();
    if (mode === 'reset') {
      const { error } = await supabase!.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.search });
      if (error) throw error;
      setNotice('Te hemos enviado un enlace para crear una contraseña nueva.');
      return;
    }
    if (mode === 'signup') {
      const { data, error } = await supabase!.auth.signUp({ email: e, password, options: { emailRedirectTo: location.origin + location.search } });
      if (error) throw error;
      if (!data.session) setNotice('Revisa tu email y confirma la cuenta para entrar.');
      return;
    }
    const { error } = await supabase!.auth.signInWithPassword({ email: e, password });
    if (error) throw error;
  });

  return (
    <div className="auth">
      <form className="auth-box" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h1 className="display">Cuentas Personales</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {mode === 'signup' ? 'Crea tu cuenta para guardar tus datos en la nube y usarlos en cualquier dispositivo.'
            : mode === 'reset' ? 'Te enviaremos un enlace para crear una contraseña nueva.'
            : 'Lo que entra, lo que sale y lo que queda.'}
        </p>
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required />
        </Field>
        {mode !== 'reset' && (
          <Field label="Contraseña">
            <PasswordInput value={password} onChange={setPassword} show={show} setShow={setShow} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </Field>
        )}
        {error && <div className="error-text">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        <button className="btn primary block" style={{ marginTop: 18 }} disabled={busy}>
          {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
        <div className="center small" style={{ marginTop: 16, display: 'grid', gap: 8 }}>
          {mode === 'login' && <button type="button" className="link" onClick={() => setMode('reset')}>¿Olvidaste tu contraseña?</button>}
          {mode === 'login'
            ? <span className="muted">¿Primera vez? <button type="button" className="link" onClick={() => setMode('signup')}>Crea una cuenta</button></span>
            : <button type="button" className="link" onClick={() => setMode('login')}>Ya tengo cuenta</button>}
          <button type="button" className="link" style={{ color: 'var(--ink-soft)', fontWeight: 500 }} onClick={startLocal}>
            Probar sin cuenta (los datos se quedan en este dispositivo)
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordInput({ value, onChange, show, setShow, autoComplete }: {
  value: string; onChange: (v: string) => void; show: boolean; setShow: (v: boolean) => void; autoComplete: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} minLength={6}
        onChange={(e) => onChange(e.target.value)} placeholder="Mínimo 6 caracteres" required style={{ paddingRight: 44 }} />
      <button type="button" className="icon-btn plain" style={{ position: 'absolute', right: 2, top: 2 }} onClick={() => setShow(!show)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
