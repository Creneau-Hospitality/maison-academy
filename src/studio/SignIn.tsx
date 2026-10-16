import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);
  const [mode, setMode] = useState<'in' | 'forgot'>('in');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMsg({ kind: 'blush', text: "That email and password didn't match. Check them and try again." });
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: location.origin + '/studio',
      });
      setMsg(error
        ? { kind: 'blush', text: "Couldn't send the email just now. Try again in a minute." }
        : { kind: 'sky', text: 'If that email has a login, a link to set a new password is on its way.' });
    }
    setBusy(false);
  };

  return (
    <div className="narrow">
      <p className="label">Maison Academy</p>
      <h1>Content studio</h1>
      <p className="muted">For David and the content reviewers.</p>
      <form onSubmit={submit} className="panel" style={{ marginTop: 24 }}>
        <label className="field">
          <span className="label">Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'in' && (
          <label className="field">
            <span className="label">Password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Send reset link'}</button>
          <button type="button" className="text" onClick={() => { setMode(mode === 'in' ? 'forgot' : 'in'); setMsg(null); }}>
            {mode === 'in' ? 'Forgotten password?' : 'Back to sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 12) { setMsg('Use at least 12 characters.'); return; }
    if (pw !== pw2) { setMsg("The two passwords don't match yet."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setMsg("Couldn't save it: " + error.message); else onDone();
  };
  return (
    <div className="narrow">
      <h1>Set your password</h1>
      <form onSubmit={submit} className="panel">
        <label className="field">
          <span className="label">New password (12+ characters)</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Same again</span>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {msg && <p className="note blush">{msg}</p>}
        <button type="submit" disabled={busy}>Save password</button>
      </form>
    </div>
  );
}
