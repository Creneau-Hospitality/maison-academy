// Studio · New on the menu: a set of live cards that comes first in staff's next sets until done.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/types';
import type { StudioData } from './Studio';

interface MenuSet { id: string; name: string; venue_id: string | null; card_ids: string[]; active: boolean; created_at: string; created_by: string | null }

export default function MenuSets({ ctx }: { ctx: StudioData }) {
  const { cards, units, tracks } = ctx;
  const [sets, setSets] = useState<MenuSet[]>([]);
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState<MenuSet | null>(null);
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState('');
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [m, v] = await Promise.all([supabase.from('menu_sets').select('*').order('created_at', { ascending: false }), supabase.rpc('list_venues')]);
    if (m.error) setMsg({ kind: 'blush', text: m.error.message }); else setSets(m.data as MenuSet[]);
    setVenues((v.data as { id: string; name: string }[]) ?? []);
  };
  useEffect(() => { void load(); }, []);

  const live = useMemo(() => cards.filter((c) => c.status === 'live'), [cards]);
  const shown = useMemo(() => live.filter((c) => (!unit || c.unit_id === unit)
    && (!search || (c.prompt + ' ' + c.id).toLowerCase().includes(search.toLowerCase()))).slice(0, 200), [live, unit, search]);
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? id;
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? id;

  const save = async (s: MenuSet) => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc('save_menu_set', {
      p_id: s.id || null, p_name: s.name, p_venue: s.venue_id ?? '', p_card_ids: s.card_ids, p_active: s.active,
    });
    setBusy(false);
    if (error) { setMsg({ kind: 'blush', text: error.message }); return; }
    setMsg({ kind: 'sky', text: s.active ? `"${s.name}" is running. Staff get its cards first in their next sets.` : `"${s.name}" is stopped.` });
    setEdit(null); void load();
  };

  return (
    <div className="wrap" style={{ maxWidth: 960 }}>
      <p className="label">New on the menu</p>
      <h1>New on the menu</h1>
      <p>When the menu changes, pick the cards about the new dishes. Staff get them first in their next sets until they've done them all, and the dashboard shows who has.</p>
      {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}

      {!edit && (
        <>
          <button onClick={() => setEdit({ id: '', name: '', venue_id: null, card_ids: [], active: true, created_at: '', created_by: null })}>New menu set</button>
          <div className="panel scroll-x" style={{ marginTop: 16 }}>
            {sets.length === 0 ? <p className="muted">No menu sets yet.</p> : (
              <table>
                <thead><tr><th>Name</th><th>Venue</th><th className="num">Cards</th><th>Status</th><th>Created</th><th></th></tr></thead>
                <tbody>{sets.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td><td>{venues.find((v) => v.id === s.venue_id)?.name ?? 'Every venue'}</td>
                    <td className="num">{s.card_ids.length}</td><td>{s.active ? <span className="tag live">Running</span> : <span className="tag retired">Stopped</span>}</td>
                    <td className="note-s">{fmtDate(s.created_at)}{s.created_by ? ` · ${s.created_by}` : ''}</td>
                    <td className="actions">
                      <button className="small outline" onClick={() => setEdit(s)}>Edit</button>
                      <button className="small text" disabled={busy} onClick={() => save({ ...s, active: !s.active })}>{s.active ? 'Stop' : 'Run again'}</button>
                    </td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
        </>
      )}

      {edit && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void save(edit); }}>
          <div className="row">
            <label className="field"><span className="label">Name</span>
              <input value={edit.name} required maxLength={80} placeholder="e.g. Winter specials" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field"><span className="label">Venue</span>
              <select value={edit.venue_id ?? ''} onChange={(e) => setEdit({ ...edit, venue_id: e.target.value || null })}>
                <option value="">Every venue</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></label>
          </div>
          <p className="label">{edit.card_ids.length} cards picked</p>
          {edit.card_ids.length > 0 && (
            <ul className="picked">{edit.card_ids.map((id) => {
              const c = cards.find((x) => x.id === id);
              return <li key={id}>{c?.prompt ?? id} <button type="button" className="small text" onClick={() => setEdit({ ...edit, card_ids: edit.card_ids.filter((x) => x !== id) })}>Remove</button></li>;
            })}</ul>
          )}
          <div className="filters">
            <input className="search" placeholder="Search live cards" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">All units</option>
              {units.map((u) => <option key={u.id} value={u.id}>{trackName(u.track_id)}: {u.name}</option>)}
            </select>
          </div>
          <div className="pick-list">
            {shown.map((c) => (
              <label key={c.id} className="check pick">
                <input type="checkbox" checked={edit.card_ids.includes(c.id)}
                  onChange={() => setEdit({ ...edit, card_ids: edit.card_ids.includes(c.id) ? edit.card_ids.filter((x) => x !== c.id) : [...edit.card_ids, c.id] })} />
                <span>{c.prompt} <span className="note-s">· {unitName(c.unit_id)}</span></span>
              </label>
            ))}
            {shown.length === 0 && <p className="muted">No live cards match.</p>}
          </div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button type="submit" disabled={busy || !edit.name.trim() || edit.card_ids.length === 0}>{edit.id ? 'Save' : 'Start this menu set'}</button>
            <button type="button" className="text" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
