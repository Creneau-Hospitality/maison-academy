// Studio · Dashboard › Programme (new joiners) and Ranking (David, 29 October).
// Copyright © 2026 Creneau Hospitality. All rights reserved.
// Managers put people on the programme and sign steps off; the admin edits the steps.
// The ranking is for managers only: staff see just their own tier and points.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { download, toCsv } from '../lib/csv';
import { ROLES } from '../lib/types';

type Status = 'done' | 'signoff' | 'current' | 'locked';
interface Step { step_id: string; n: number; name: string; topic: string; status: Status; best_pct: number | null; signoff_note: string | null; signed_by: string | null; signed_at: string | null; tries_used?: number; tries_left?: number; open_attempt?: boolean }
const triesOut = (s: Step | null) => !!s && s.status === 'current' && s.tries_left === 0 && !s.open_attempt;
interface Person { staff_id: string; name: string; role: string; is_test: boolean; venue: string; enrolled_on: string; completed_on: string | null; total: number; done: number; current: Step | null; steps: Step[] }
interface Other { staff_id: string; name: string; role: string; is_test: boolean; venue: string }
interface AdminStep { id: string; position: number; name: string; track_id: string; unit_id: string | null; topic: string; roles: string[]; exam_cards: number; pass_pct: number; signoff_note: string | null; active: boolean; pool: Record<string, number> }
interface Topic { track_id: string; track: string; units: { unit_id: string; unit: string }[] }
interface RankRow { staff_id: string; name: string; role: string; is_test: boolean; venue: string; level_name: string; points: number; tier: string; next_tier: string | null; to_next: number | null; parts: Record<string, number> }

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const Test = ({ on }: { on: boolean }) => (on ? <span className="tag" style={{ marginLeft: 6 }}>Test</span> : null);

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------
export function ProgrammeView({ venue, withTest, admin }: { venue: string | null; withTest: boolean; admin: boolean }) {
  const [d, setD] = useState<{ people: Person[]; others: Other[] } | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editSteps, setEditSteps] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('dash_programme', { p_venue: venue, p_include_test: withTest });
    if (error) setErr(error.message); else { setErr(''); setD(data as { people: Person[]; others: Other[] }); }
  }, [venue, withTest]);
  useEffect(() => { void load(); }, [load]);

  const sign = async (p: Person, s: Step, undo = false) => {
    const { error } = await supabase.rpc('programme_sign_off', { p_staff: p.staff_id, p_step: s.step_id, p_undo: undo });
    if (error) setErr(error.message); else void load();
  };
  const allow = async (p: Person, s: Step) => {
    const { error } = await supabase.rpc('programme_allow_retry', { p_staff: p.staff_id, p_step: s.step_id });
    if (error) setErr(error.message); else void load();
  };
  const remove = async (p: Person) => {
    const { error } = await supabase.rpc('programme_enrol', { p_staff: [p.staff_id], p_on: false });
    if (error) setErr(error.message); else void load();
  };

  if (!d) return err ? <p className="note blush">{err}</p> : <div className="loading">Loading…</div>;
  const waiting = d.people.filter((p) => p.current?.status === 'signoff');
  const retry = d.people.filter((p) => triesOut(p.current));
  return (
    <>
      <div className="dash-intro">
        <p>New joiners work through the steps in order: study the cards, pass the step exam, then you sign them off on the floor. That opens the next step.</p>
        <div className="row">
          {!adding && <button onClick={() => setAdding(true)}>Add people</button>}
          {admin && <button className="outline" onClick={() => setEditSteps(!editSteps)}>{editSteps ? 'Close the steps' : 'Edit the steps'}</button>}
        </div>
      </div>
      {err && <p className="note blush">{err}</p>}
      {adding && <AddPeople others={d.others} onDone={() => { setAdding(false); void load(); }} />}
      {editSteps && admin && <StepsEditor />}

      {waiting.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <span className="label">Waiting for your sign-off</span>
          <ul className="plain">{waiting.map((p) => (
            <li key={p.staff_id} className="signoff-row">
              <div><strong>{p.name}</strong> · {p.role} · step {p.current!.n}: {p.current!.name} (exam {p.current!.best_pct}%)
                {p.current!.signoff_note && <><br /><span className="note-s">Check on the floor: {p.current!.signoff_note}</span></>}</div>
              <button className="small" onClick={() => void sign(p, p.current!)}>Sign off</button>
            </li>))}
          </ul>
        </div>
      )}

      {retry.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <span className="label">Tries used: allow another round?</span>
          <ul className="plain">{retry.map((p) => (
            <li key={p.staff_id} className="signoff-row">
              <div><strong>{p.name}</strong> · {p.role} · step {p.current!.n}: {p.current!.name}
                <br /><span className="note-s">{p.current!.tries_used} tries used, best {p.current!.best_pct ?? 0}%. Worth a quick chat before opening more.</span></div>
              <button className="small outline" onClick={() => void allow(p, p.current!)}>Allow {p.current!.tries_used} more tries</button>
            </li>))}
          </ul>
        </div>
      )}

      {d.people.length === 0 ? <p className="note cream">Nobody on the programme yet. Use "Add people".</p> : (
        <div className="scroll-x panel" style={{ padding: 0 }}>
          <table className="team">
            <thead><tr><th>Name</th><th>Progress</th><th>Now</th><th>Started</th><th></th></tr></thead>
            <tbody>{d.people.map((p) => (
              <tr key={p.staff_id}>
                <td>{p.name}<Test on={p.is_test} /><br /><span className="note-s">{p.role} · {p.venue}</span></td>
                <td style={{ minWidth: 140 }}><span className="bar" aria-hidden><span style={{ width: `${p.total ? (100 * p.done) / p.total : 0}%` }} /></span>
                  <span className="note-s">{p.done} of {p.total}</span></td>
                <td>{p.completed_on ? <>Complete<br /><span className="note-s">{day(p.completed_on)}</span></>
                  : p.current ? <>{p.current.name}<br /><span className="note-s">{p.current.status === 'signoff' ? 'Exam passed, sign-off due' : triesOut(p.current) ? 'Tries used, waiting for you' : p.current.best_pct != null ? `Best ${p.current.best_pct}% · ${p.current.tries_used ?? 0} tries used` : 'Studying'}</span></> : ''}</td>
                <td className="note-s">{day(p.enrolled_on)}</td>
                <td className="actions-cell">
                  <button className="small outline" onClick={() => setOpen(open === p.staff_id ? null : p.staff_id)}>{open === p.staff_id ? 'Hide' : 'Steps'}</button>
                  <button className="small text" onClick={() => void remove(p)}>Remove</button>
                </td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {open && (() => {
        const p = d.people.find((x) => x.staff_id === open);
        if (!p) return null;
        return (
          <div className="panel" style={{ marginTop: 16 }}>
            <span className="label">{p.name} · steps</span>
            <ol className="prog-steps">{p.steps.map((s) => (
              <li key={s.step_id} className={'prog-' + s.status}>
                <span className="prog-mark" aria-hidden>{s.status === 'done' ? '✓' : s.n}</span>
                <span className="prog-name">{s.name} <span className="note-s">· {s.topic}</span><br /><span className="note-s">{
                  s.status === 'done' ? `Signed off by ${s.signed_by ?? ''} ${day(s.signed_at)}`
                  : s.status === 'signoff' ? `Exam passed (${s.best_pct}%), sign-off due`
                  : s.status === 'current' ? (s.best_pct != null ? `Best exam so far ${s.best_pct}% · ${s.tries_used ?? 0} tries used` : 'Now') : 'Opens after the step before'}</span></span>
                {triesOut(s) && <button className="small outline" onClick={() => void allow(p, s)}>Allow more tries</button>}
                {s.status === 'signoff' && <button className="small" onClick={() => void sign(p, s)}>Sign off</button>}
                {s.status === 'done' && <button className="small text" onClick={() => void sign(p, s, true)}>Undo</button>}
              </li>))}
            </ol>
          </div>
        );
      })()}
    </>
  );
}

function AddPeople({ others, onDone }: { others: Other[]; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const save = async () => {
    const { error } = await supabase.rpc('programme_enrol', { p_staff: picked, p_on: true });
    if (error) setErr(error.message); else onDone();
  };
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Add people to the programme</h3>
      {others.length === 0 ? <p className="note-s">Everyone in this view is already on it.</p> : (
        <div className="pick-list">{others.map((o) => (
          <label key={o.staff_id} className="check"><input type="checkbox" checked={picked.includes(o.staff_id)}
            onChange={(e) => setPicked(e.target.checked ? [...picked, o.staff_id] : picked.filter((x) => x !== o.staff_id))} />
            {' '}{o.name} <span className="note-s">· {o.role} · {o.venue}</span><Test on={o.is_test} /></label>))}
        </div>)}
      {err && <p className="note blush">{err}</p>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button disabled={picked.length === 0} onClick={() => void save()}>Add {picked.length || ''}</button>
        <button className="text" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function StepsEditor() {
  const [steps, setSteps] = useState<AdminStep[] | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [edit, setEdit] = useState<AdminStep | 'new' | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('programme_steps_admin');
    if (error) setErr(error.message); else setSteps(data as AdminStep[]);
  }, []);
  useEffect(() => {
    void load();
    supabase.rpc('exam_topics').then(({ data }) => setTopics((data as Topic[]) ?? []));
  }, [load]);
  const move = async (s: AdminStep, dir: number) => { const { error } = await supabase.rpc('move_programme_step', { p_id: s.id, p_dir: dir }); if (error) setErr(error.message); else void load(); };
  if (!steps) return <div className="loading">Loading the steps…</div>;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Programme steps</h3>
        {!edit && <button className="small" style={{ flex: 'none', width: 'auto' }} onClick={() => setEdit('new')}>Add a step</button>}
      </div>
      <p className="note-s">Each person sees only the steps for their role that have live cards. Changes apply straight away.</p>
      {err && <p className="note blush">{err}</p>}
      {edit && <StepForm step={edit === 'new' ? null : edit} topics={topics} onDone={() => { setEdit(null); void load(); }} />}
      <div className="scroll-x">
        <table>
          <thead><tr><th></th><th>Step</th><th>Roles (live cards)</th><th>Exam</th><th>Sign-off</th><th></th></tr></thead>
          <tbody>{steps.map((s, k) => (
            <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
              <td className="actions-cell" style={{ textAlign: 'left' }}>
                <button className="small text" disabled={k === 0} aria-label="Move up" onClick={() => void move(s, -1)}>↑</button>
                <button className="small text" disabled={k === steps.length - 1} aria-label="Move down" onClick={() => void move(s, 1)}>↓</button>
              </td>
              <td><strong>{s.name}</strong>{!s.active && ' (off)'}<br /><span className="note-s">{s.topic}</span></td>
              <td className="note-s">{s.roles.map((r) => `${r} ${s.pool[r] ?? 0}`).join(' · ')}</td>
              <td className="note-s">{s.exam_cards} cards, {s.pass_pct}%</td>
              <td className="note-s" style={{ maxWidth: 260 }}>{s.signoff_note}</td>
              <td className="actions-cell"><button className="small text" onClick={() => setEdit(s)}>Edit</button></td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepForm({ step, topics, onDone }: { step: AdminStep | null; topics: Topic[]; onDone: () => void }) {
  const [f, setF] = useState({
    name: step?.name ?? '', track: step?.track_id ?? topics[0]?.track_id ?? '', unit: step?.unit_id ?? '',
    roles: step?.roles ?? [...ROLES], cards: step?.exam_cards ?? 10, pass: step?.pass_pct ?? 80, note: step?.signoff_note ?? '', active: step?.active ?? true,
  });
  const [err, setErr] = useState('');
  const topic = topics.find((t) => t.track_id === f.track);
  const save = async () => {
    const { error } = await supabase.rpc('save_programme_step', {
      p_id: step?.id ?? null, p_name: f.name.trim() || (topic?.units.find((u) => u.unit_id === f.unit)?.unit ?? topic?.track ?? 'Step'),
      p_track: f.track, p_unit: f.unit || null, p_roles: f.roles, p_cards: f.cards, p_pass: f.pass, p_note: f.note, p_active: f.active,
    });
    if (error) setErr(error.message); else onDone();
  };
  return (
    <div className="panel" style={{ margin: '12px 0', background: 'var(--cream)' }}>
      <div className="row">
        <label className="field" style={{ flex: '2 1 220px' }}><span className="label">Step name</span>
          <input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field" style={{ flex: '1 1 160px' }}><span className="label">Topic</span>
          <select value={f.track} onChange={(e) => setF({ ...f, track: e.target.value, unit: '' })}>{topics.map((t) => <option key={t.track_id} value={t.track_id}>{t.track}</option>)}</select></label>
        <label className="field" style={{ flex: '1 1 180px' }}><span className="label">Part</span>
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="">The whole topic</option>{topic?.units.map((u) => <option key={u.unit_id} value={u.unit_id}>{u.unit}</option>)}</select></label>
      </div>
      <div className="row">
        <label className="field" style={{ flex: '0 1 120px' }}><span className="label">Exam cards</span>
          <input type="number" min={5} max={40} value={f.cards} onChange={(e) => setF({ ...f, cards: Math.max(5, Math.min(40, Number(e.target.value) || 10)) })} /></label>
        <label className="field" style={{ flex: '0 1 120px' }}><span className="label">Pass mark %</span>
          <input type="number" min={50} max={100} value={f.pass} onChange={(e) => setF({ ...f, pass: Math.max(50, Math.min(100, Number(e.target.value) || 80)) })} /></label>
        <label className="field" style={{ flex: '3 1 260px' }}><span className="label">What the manager checks on the floor</span>
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      </div>
      <div className="row">{ROLES.map((r) => (
        <label key={r} className="check"><input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} /> {r}</label>))}
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use</label>
      </div>
      {err && <p className="note blush">{err}</p>}
      <div className="actions" style={{ marginTop: 8 }}>
        <button disabled={f.roles.length === 0 || !f.track} onClick={() => void save()}>{step ? 'Save step' : 'Add step'}</button>
        <button className="text" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking (managers only)
// ---------------------------------------------------------------------------
const PARTS: [string, string][] = [['programme_steps', 'Steps'], ['programme_done', 'Programme'], ['levels', 'Levels'], ['signoffs', 'Sign-offs'], ['exams', 'Exams'], ['weeks', 'Weeks on target'], ['known', 'Cards known']];

export function RankingView({ venue, withTest }: { venue: string | null; withTest: boolean }) {
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.rpc('dash_ranking', { p_venue: venue, p_include_test: withTest })
      .then(({ data, error }) => { if (error) setErr(error.message); else setRows(data as RankRow[]); });
  }, [venue, withTest]);
  if (err) return <p className="note blush">{err}</p>;
  if (!rows) return <div className="loading">Loading…</div>;
  const tiers = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.tier]: (a[r.tier] ?? 0) + 1 }), {});
  const exportCsv = () => download(`ranking-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(['rank', 'name', 'role', 'venue', 'tier', 'points', ...PARTS.map(([, l]) => l)],
      rows.map((r, k) => [k + 1, r.name, r.role, r.venue, r.tier, r.points, ...PARTS.map(([p]) => r.parts[p] ?? 0)])), 'text/csv');
  return (
    <>
      <div className="dash-intro">
        <p>For managers only. Staff see just their own tier and points, never this list. Points come from programme steps, levels, sign-offs, exams, weeks on target and cards known.</p>
        <button className="outline" onClick={exportCsv} disabled={rows.length === 0}>Download CSV</button>
      </div>
      {rows.length === 0 ? <p className="note cream">No staff in this view yet.</p> : (
        <>
          <p className="note-s">{Object.entries(tiers).map(([t, n]) => `${t} ${n}`).join(' · ')}</p>
          <div className="scroll-x panel" style={{ padding: 0 }}>
            <table className="team">
              <thead><tr><th className="num">#</th><th>Name</th><th>Tier</th><th className="num">Points</th>{PARTS.map(([p, l]) => <th key={p} className="num">{l}</th>)}</tr></thead>
              <tbody>{rows.map((r, k) => (
                <tr key={r.staff_id}>
                  <td className="num">{k + 1}</td>
                  <td>{r.name}<Test on={r.is_test} /><br /><span className="note-s">{r.role} · {r.venue} · {r.level_name}</span></td>
                  <td>{r.tier}<br /><span className="note-s">{r.next_tier ? `${r.to_next} to ${r.next_tier}` : 'Top tier'}</span></td>
                  <td className="num"><strong>{r.points}</strong></td>
                  {PARTS.map(([p]) => <td key={p} className="num note-s">{r.parts[p] ?? 0}</td>)}
                </tr>))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
