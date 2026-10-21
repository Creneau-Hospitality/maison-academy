import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Setting { key: string; value: unknown; note: string | null; updated_at: string; updated_by: string | null }

// Learning-engine settings (brief section 6): change them here, no code needed.
export default function Settings() {
  const [rows, setRows] = useState<Setting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);

  const load = async () => {
    const { data } = await supabase.from('settings').select('*').order('key');
    setRows((data ?? []) as Setting[]);
    setDraft(Object.fromEntries((data ?? []).map((s) => [s.key, JSON.stringify(s.value)])));
  };
  useEffect(() => { load(); }, []);

  const save = async (s: Setting) => {
    let value: unknown;
    try { value = JSON.parse(draft[s.key]); } catch { setMsg({ kind: 'blush', text: `${s.key}: that isn't a valid value.` }); return; }
    const { error } = await supabase.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', s.key);
    if (error) setMsg({ kind: 'blush', text: error.message }); else { setMsg({ kind: 'sky', text: `${s.key} saved.` }); load(); }
  };

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <p className="label">Settings</p>
      <h1>Settings</h1>
      <p>Change how the app behaves, no code needed. Values in quotes are words (for example "on"); the rest are numbers or true/false.</p>
      <ul className="info">
        <li><strong>real staff allowed</strong>: the go-live switch. Turn on only once the final privacy notice is approved and Supabase Pro backups are on.</li>
        <li><strong>reminders mode</strong>: "off", "test" (test accounts only) or "all". <strong>reminder time</strong>: for example "10:00".</li>
        <li><strong>location check</strong>: "off" or "on". It needs the venue's map point below, and a line in the privacy notice, before it's switched on.</li>
      </ul>
      {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}
      <VenuePoints />
      <div className="panel">
        {rows.map((s) => (
          <div key={s.key} className="row" style={{ alignItems: 'flex-end', borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
            <div style={{ flex: '2 1 260px' }}>
              <div className="label">{s.key.replace(/_/g, ' ')}</div>
              <div className="info">{s.note}</div>
            </div>
            <input style={{ flex: '1 1 160px' }} value={draft[s.key] ?? ''} aria-label={s.key}
              onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} />
            <div style={{ flex: '0 0 auto' }}>
              <button className="outline small" disabled={draft[s.key] === JSON.stringify(s.value)} onClick={() => save(s)}>Save</button>
            </div>
          </div>
        ))}
      </div>
      <RecentErrors />
    </div>
  );
}

// Venue map points for the optional location check.
function VenuePoints() {
  const [venues, setVenues] = useState<{ id: string; name: string; lat: number | null; lng: number | null }[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const load = async () => {
    const { data } = await supabase.rpc('list_venues');
    const vs = ((data ?? []) as { id: string; name: string; lat: number | null; lng: number | null }[]).filter((v) => v.id !== 'demo');
    setVenues(vs);
    setDraft(Object.fromEntries(vs.map((v) => [v.id, v.lat !== null && v.lng !== null ? `${v.lat}, ${v.lng}` : ''])));
  };
  useEffect(() => { void load(); }, []);
  const save = async (id: string) => {
    const t = (draft[id] ?? '').trim();
    const m = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (t && !m) { setMsg('Use two numbers separated by a comma, for example 25.0512, 55.2689.'); return; }
    const { error } = await supabase.rpc('set_venue_location', { p_venue: id, p_lat: m ? Number(m[1]) : null, p_lng: m ? Number(m[2]) : null });
    setMsg(error ? error.message : 'Saved.'); void load();
  };
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3>Venue map points</h3>
      <p className="info">For the location check only. In Google Maps, press and hold on the venue's entrance and copy the two numbers shown.</p>
      {venues.map((v) => (
        <div key={v.id} className="row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
          <label className="field" style={{ margin: 0 }}><span className="label">{v.name}</span>
            <input value={draft[v.id] ?? ''} placeholder="latitude, longitude" onChange={(e) => setDraft({ ...draft, [v.id]: e.target.value })} /></label>
          <div style={{ flex: '0 0 auto' }}><button className="outline small" onClick={() => void save(v.id)}>Save</button></div>
        </div>
      ))}
      {msg && <p className="note-s">{msg}</p>}
    </div>
  );
}

// The last app errors (kept 90 days), to spot problems early in the pilot.
function RecentErrors() {
  const [rows, setRows] = useState<{ id: number; at: string; app: string; message: string; url: string }[]>([]);
  useEffect(() => {
    supabase.from('client_errors').select('id, at, app, message, url').order('at', { ascending: false }).limit(20)
      .then(({ data }) => setRows((data ?? []) as typeof rows));
  }, []);
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Recent app errors</h3>
      {rows.length === 0 ? <p className="muted">None recorded.</p> : (
        <div className="scroll-x"><table><tbody>{rows.map((r) => (
          <tr key={r.id}><td className="note-s">{new Date(r.at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}</td><td>{r.app}</td><td>{r.message}</td><td className="note-s">{r.url}</td></tr>
        ))}</tbody></table></div>
      )}
    </div>
  );
}
