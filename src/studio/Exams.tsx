// Studio · Dashboard › Exams: managers schedule an exam on a topic for chosen roles,
// on one date or every week, and see the scores (David, 23 October).
// Copyright © 2026 Creneau Hospitality. All rights reserved.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { download, toCsv } from '../lib/csv';
import { ROLES } from '../lib/types';

interface Topic { track_id: string; track: string; counts: Record<string, number>; units: { unit_id: string; unit: string; counts: Record<string, number> }[] }
interface ExamRow {
  id: string; name: string; topic: string; track_id: string; unit_id: string | null; roles: string[];
  venue_id: string | null; venue: string; card_count: number; exam_date: string; repeat_weekly: boolean; active: boolean;
  can_edit: boolean; last_date: string | null; next_date: string | null; invited: number; done: number; avg_pct: number | null;
}
interface Results {
  exam: { id: string; name: string; topic: string; roles: string[]; card_count: number };
  date: string; dates: string[];
  people: { staff_id: string; name: string; role: string; is_test: boolean; venue: string; done: boolean; started: boolean; right: number | null; total: number | null; pct: number | null }[];
  practise: { unit: string; pct: number; answers: number }[];
}
type VenueOpt = { id: string; name: string };

const day = (d: string | null, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', opts) : '';
const weekday = (d: string) => day(d, { weekday: 'long' });
const todayDubai = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function ExamsView({ venue, withTest, venues, admin }: { venue: string | null; withTest: boolean; venues: VenueOpt[]; admin: boolean }) {
  const [list, setList] = useState<ExamRow[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<ExamRow | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr('');
    const { data, error } = await supabase.rpc('dash_exams', { p_venue: venue, p_include_test: withTest });
    if (error) setErr(error.message); else setList(data as ExamRow[]);
  }, [venue, withTest]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (e: ExamRow) => {
    const { error } = await supabase.rpc('set_exam_active', { p_id: e.id, p_active: !e.active });
    if (error) setErr(error.message); else void load();
  };

  if (err && !list) return <p className="note blush">{err}</p>;
  if (!list) return <div className="loading">Loading…</div>;
  return (
    <>
      <div className="dash-intro">
        <p>An exam replaces that day's 5 cards for the chosen roles. Each person gets their own cards from the topic: the ones they've missed first, then ones they don't know yet. Exams are scored separately and don't count toward the weekly target.</p>
        {!editing && <button onClick={() => setEditing('new')}>Schedule an exam</button>}
      </div>
      {err && <p className="note blush">{err}</p>}
      {editing && <ExamForm exam={editing === 'new' ? null : editing} venues={venues} admin={admin} defaultVenue={venue}
        onDone={() => { setEditing(null); void load(); }} />}

      {list.length === 0 && !editing && <p className="note cream">No exams yet.</p>}
      {list.length > 0 && (
        <div className="scroll-x panel" style={{ padding: 0 }}>
          <table className="team">
            <thead><tr><th>Exam</th><th>Who</th><th>When</th><th>Latest</th><th></th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id} style={{ opacity: e.active ? 1 : 0.6 }}>
                <td><strong>{e.name}</strong><br /><span className="note-s">{e.topic} · {plural(e.card_count, 'card')} each</span></td>
                <td>{e.roles.join(', ')}<br /><span className="note-s">{e.venue}</span></td>
                <td>{e.repeat_weekly ? `Every ${weekday(e.exam_date)}` : day(e.exam_date)}
                  <br /><span className="note-s">{!e.active ? 'Stopped' : e.next_date ? (e.next_date === todayDubai() ? 'Today' : `Next: ${day(e.next_date)}`) : 'Finished'}</span></td>
                <td>{e.last_date
                  ? <>{e.done} of {e.invited} done{e.avg_pct != null && <> · average {e.avg_pct}%</>}<br /><span className="note-s">{day(e.last_date)}</span></>
                  : <span className="note-s">Not yet held</span>}</td>
                <td className="actions-cell">
                  {e.last_date && <button className="small outline" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide results' : 'Results'}</button>}
                  {e.can_edit && <button className="small text" onClick={() => setEditing(e)}>Edit</button>}
                  {e.can_edit && <button className="small text" onClick={() => void toggle(e)}>{e.active ? 'Stop' : 'Resume'}</button>}
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ExamResults id={open} venue={venue} withTest={withTest} />}
    </>
  );
}

function ExamResults({ id, venue, withTest }: { id: string; venue: string | null; withTest: boolean }) {
  const [date, setDate] = useState<string | null>(null);
  const [r, setR] = useState<Results | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    supabase.rpc('dash_exam_results', { p_exam: id, p_date: date, p_venue: venue, p_include_test: withTest })
      .then(({ data, error }) => { if (error) setErr(error.message); else setR(data as Results); });
  }, [id, date, venue, withTest]);
  if (err) return <p className="note blush">{err}</p>;
  if (!r) return <div className="loading">Loading…</div>;
  const done = r.people.filter((p) => p.done);
  const exportCsv = () => download(`exam-${r.exam.name.replace(/\W+/g, '-').toLowerCase()}-${r.date}.csv`,
    toCsv(['name', 'role', 'venue', 'done', 'right', 'total', 'percent'],
      r.people.map((p) => [p.name, p.role, p.venue, p.done ? 'yes' : 'no', p.right ?? '', p.total ?? '', p.pct ?? ''])), 'text/csv');
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div><span className="label">Results</span><h3 style={{ margin: '4px 0' }}>{r.exam.name} · {r.exam.topic}</h3></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          {r.dates.length > 1 && (
            <label className="field"><span className="label">Date</span>
              <select value={r.date} onChange={(e) => setDate(e.target.value)}>{r.dates.map((d) => <option key={d} value={d}>{day(d)}</option>)}</select>
            </label>)}
          <button className="small outline" onClick={exportCsv}>Download CSV</button>
        </div>
      </div>
      <p>{done.length} of {r.people.length} done on {day(r.date, { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Score</th></tr></thead>
          <tbody>{r.people.map((p) => (
            <tr key={p.staff_id}>
              <td>{p.name}{p.is_test && <span className="tag" style={{ marginLeft: 6 }}>Test</span>}</td>
              <td>{p.role}</td>
              <td>{p.done ? <><strong>{p.right} of {p.total}</strong> · {p.pct}%</> : <span className="note-s">{p.started ? 'Started, not finished' : 'Not taken'}</span>}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
      {r.practise.length > 0 && (
        <>
          <p className="label" style={{ marginTop: 16 }}>By part of the topic (share answered right)</p>
          <ul className="plain">{r.practise.map((u) => <li key={u.unit}>{u.unit}: {u.pct}% <span className="note-s">({plural(u.answers, 'answer')})</span></li>)}</ul>
        </>
      )}
    </div>
  );
}

function ExamForm({ exam, venues, admin, defaultVenue, onDone }: {
  exam: ExamRow | null; venues: VenueOpt[]; admin: boolean; defaultVenue: string | null; onDone: () => void;
}) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [f, setF] = useState(() => ({
    name: exam?.name ?? '',
    venue: exam ? (exam.venue_id ?? '') : (defaultVenue ?? (admin ? '' : venues[0]?.id ?? '')),
    roles: exam?.roles ?? ['server'],
    track: exam?.track_id ?? '',
    unit: exam?.unit_id ?? '',
    count: exam?.card_count ?? 20,
    date: exam?.exam_date ?? todayDubai(),
    weekly: exam?.repeat_weekly ?? false,
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('exam_topics').then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      const t = data as Topic[]; setTopics(t);
      setF((x) => (x.track ? x : { ...x, track: t.find((y) => y.track_id === 'sop')?.track_id ?? t[0]?.track_id ?? '' }));
    });
  }, []);

  const topic = topics?.find((t) => t.track_id === f.track);
  const counts = (f.unit ? topic?.units.find((u) => u.unit_id === f.unit)?.counts : topic?.counts) ?? {};
  const pool = useMemo(() => f.roles.map((r) => ({ role: r, n: counts[r] ?? 0 })), [f.roles, counts]);
  const autoName = `${topic?.track ?? 'Topic'} check`;

  const save = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('save_exam', {
      p_id: exam?.id ?? null, p_name: f.name.trim() || autoName, p_venue: f.venue || null, p_roles: f.roles,
      p_track: f.track, p_unit: f.unit || null, p_count: f.count, p_date: f.date, p_weekly: f.weekly, p_active: true,
    });
    setBusy(false);
    if (error) setErr(error.message); else onDone();
  };

  if (!topics) return <div className="panel"><div className="loading">Loading topics…</div>{err && <p className="note blush">{err}</p>}</div>;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>{exam ? 'Edit exam' : 'Schedule an exam'}</h3>
      <div className="row">
        <label className="field" style={{ flex: '2 1 240px' }}><span className="label">Name (staff see it)</span>
          <input value={f.name} placeholder={autoName} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field" style={{ flex: '1 1 200px' }}><span className="label">Venue</span>
          <select value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })}>
            {admin && <option value="">Every venue</option>}
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
      </div>
      <div className="row">
        <label className="field" style={{ flex: '1 1 200px' }}><span className="label">Topic</span>
          <select value={f.track} onChange={(e) => setF({ ...f, track: e.target.value, unit: '' })}>
            {topics.map((t) => <option key={t.track_id} value={t.track_id}>{t.track}</option>)}
          </select></label>
        <label className="field" style={{ flex: '1 1 200px' }}><span className="label">Part</span>
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            <option value="">The whole topic</option>
            {topic?.units.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.unit}</option>)}
          </select></label>
        <label className="field" style={{ flex: '0 1 140px' }}><span className="label">Cards each</span>
          <input type="number" min={5} max={40} value={f.count} onChange={(e) => setF({ ...f, count: Math.max(5, Math.min(40, Number(e.target.value) || 20)) })} /></label>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: '8px 0' }}>
        <legend className="label">Roles</legend>
        <div className="row">{ROLES.map((r) => (
          <label key={r} className="check"><input type="checkbox" checked={f.roles.includes(r)}
            onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} /> {r}</label>))}
        </div>
      </fieldset>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '0 1 200px' }}><span className="label">{f.weekly ? 'First date' : 'Date'}</span>
          <input type="date" value={f.date} min={exam ? undefined : todayDubai()} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="check" style={{ paddingBottom: 12 }}><input type="checkbox" checked={f.weekly} onChange={(e) => setF({ ...f, weekly: e.target.checked })} />
          {' '}Repeat every {f.date ? weekday(f.date) : 'week'}</label>
      </div>
      {f.roles.length > 0 && (
        <p className="note-s">Live cards to draw from: {pool.map((p) => `${p.role} ${p.n}`).join(' · ')}.
          {pool.some((p) => p.n > 0 && p.n < f.count) && ' Where a role has fewer than the number asked, each person gets all of them.'}
          {pool.some((p) => p.n === 0) && ' A role with 0 cards gets no exam (their daily set carries on).'}</p>
      )}
      {err && <p className="note blush">{err}</p>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button disabled={busy || f.roles.length === 0 || !f.track || !f.date} onClick={() => void save()}>{busy ? 'Saving…' : exam ? 'Save changes' : 'Schedule'}</button>
        <button className="text" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
