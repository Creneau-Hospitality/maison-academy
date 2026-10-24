import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { StudioData } from './Studio';

interface Person {
  user_id: string; email: string; display_name: string; allergen_checker: boolean; active: boolean;
  user_roles: { role: string; tracks: string[] | null; venue_id?: string | null }[];
}

const ROLE_NAMES: Record<string, string> = { admin: 'Admin', reviewer: 'Content reviewer', venue_manager: 'Venue manager', staff: 'Staff' };

export default function People({ ctx }: { ctx: StudioData }) {
  const { tracks } = ctx;
  const [people, setPeople] = useState<Person[]>([]);
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'reviewer', tracks: [] as string[], checker: false, venue: '' });
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { supabase.rpc('list_venues').then(({ data }) => setVenues(((data as { id: string; name: string }[]) ?? []).filter((v) => v.id !== 'demo'))); }, []);

  const load = async () => {
    const { data, error } = await supabase.from('app_users').select('user_id, email, display_name, allergen_checker, active, user_roles(role, tracks, venue_id)').order('display_name');
    if (error) setMsg({ kind: 'blush', text: error.message }); else setPeople((data ?? []) as Person[]);
  };
  useEffect(() => { load(); }, []);

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = form.role === 'venue_manager'
      ? await supabase.rpc('grant_venue_manager', { p_email: form.email, p_display_name: form.name || null, p_venue: form.venue || venues[0]?.id })
      : await supabase.rpc('grant_role', {
          p_email: form.email, p_role: form.role, p_display_name: form.name || null,
          p_tracks: form.role === 'reviewer' ? form.tracks : null, p_allergen_checker: form.checker,
        });
    setBusy(false);
    if (error) { setMsg({ kind: 'blush', text: error.message }); return; }
    setMsg({ kind: 'sky', text: `${form.name || form.email} is set up.` });
    setForm({ email: '', name: '', role: 'reviewer', tracks: [], checker: false, venue: '' });
    load();
  };

  const revoke = async (p: Person, role: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('revoke_role', { p_user: p.user_id, p_role: role });
    setBusy(false);
    if (error) setMsg({ kind: 'blush', text: error.message }); else load();
  };

  const toggleChecker = async (p: Person) => {
    const { error } = await supabase.rpc('grant_role', {
      p_email: p.email, p_role: p.user_roles[0]?.role ?? 'reviewer', p_display_name: null,
      p_tracks: p.user_roles.find((r) => r.role === (p.user_roles[0]?.role ?? 'reviewer'))?.tracks ?? null,
      p_allergen_checker: !p.allergen_checker,
    });
    if (error) setMsg({ kind: 'blush', text: error.message }); else load();
  };

  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="wrap" style={{ maxWidth: 960 }}>
      <p className="label">People</p>
      <h1>Who can use the studio</h1>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Kitchen allergen check</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.user_id}>
                <td>{p.display_name}</td>
                <td className="info">{p.email}</td>
                <td>
                  {p.user_roles.map((r) => (
                    <div key={r.role}>
                      {ROLE_NAMES[r.role] ?? r.role}{r.tracks?.length ? `: ${r.tracks.map(trackName).join(', ')}` : ''}{r.venue_id ? `: ${venues.find((v) => v.id === r.venue_id)?.name ?? r.venue_id}` : ''}{' '}
                      <button className="text small" disabled={busy} onClick={() => revoke(p, r.role)}>Remove</button>
                    </div>
                  ))}
                </td>
                <td>
                  <label className="check">
                    <input type="checkbox" checked={p.allergen_checker} onChange={() => toggleChecker(p)} disabled={p.user_roles.length === 0} />
                    {p.allergen_checker ? 'Can record it' : 'No'}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h2>Add someone</h2>
        <ol className="info" style={{ paddingLeft: 18 }}>
          <li>First invite them in Supabase: Authentication, then Users, then Invite user, with their work email. They get an email to set a password.</li>
          <li>Then add them here with the same email.</li>
        </ol>
        <form onSubmit={grant}>
          <div className="row">
            <label className="field"><span className="label">Email</span>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span className="label">Name shown in the studio</span>
              <input value={form.name} placeholder="e.g. Head Chef, Arabian Ranches" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span className="label">Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="reviewer">Content reviewer</option>
                <option value="venue_manager">Venue manager</option>
                <option value="admin">Admin</option>
              </select></label>
            {form.role === 'venue_manager' && (
              <label className="field"><span className="label">Venue</span>
                <select value={form.venue || venues[0]?.id || ''} onChange={(e) => setForm({ ...form, venue: e.target.value })}>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select></label>
            )}
          </div>
          {form.role === 'reviewer' && (
            <div className="field">
              <span className="label">Tracks they can edit and approve</span>
              <div className="row" style={{ gap: '4px 16px' }}>
                {tracks.map((t) => (
                  <label key={t.id} className="check" style={{ flex: '0 0 auto' }}>
                    <input type="checkbox" checked={form.tracks.includes(t.id)}
                      onChange={() => setForm({ ...form, tracks: form.tracks.includes(t.id) ? form.tracks.filter((x) => x !== t.id) : [...form.tracks, t.id] })} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {form.role !== 'venue_manager' && (
          <label className="check" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={form.checker} onChange={(e) => setForm({ ...form, checker: e.target.checked })} />
            Can record the kitchen allergen check (head chef only)
          </label>
          )}
          {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}
          <div><button type="submit" disabled={busy}>Add</button></div>
        </form>
      </div>
    </div>
  );
}
