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
      <h1>Learning settings</h1>
      <p>These are the brief's defaults. They take effect when the staff app arrives in Phase 2.</p>
      {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}
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
    </div>
  );
}
