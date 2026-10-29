// Staff app · new-joiner programme and own tier (David, 29 October).
// Copyright © 2026 Creneau Hospitality. All rights reserved.
// Staff only ever see their own tier and points, never anyone else's.
import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { NeedLogin, Offline, rpc, store } from './api';

export interface ProgStep {
  step_id: string; n: number; name: string; topic: string; exam_cards: number; pass_pct: number; signoff_note: string | null;
  status: 'done' | 'signoff' | 'current' | 'locked'; best_pct: number | null; passed_at: string | null; signed_at: string | null; signed_by: string | null; pool: number;
  tries_used?: number; tries_left?: number; open_attempt?: boolean;
}
export interface Points {
  points: number; tier: string; next_tier: string | null; to_next: number | null;
  parts?: Record<string, number>; counts?: Record<string, number>;
}
interface MyProgramme {
  programme: { enrolled_on: string; completed_on: string | null; total: number; done: number; current: ProgStep | null; steps: ProgStep[] } | null;
  points: Points;
  weights: Record<string, number>;
  tiers: { name: string; min: number }[];
}

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

function useMyProgramme(onNeedLogin: () => void) {
  const [d, setD] = useState<MyProgramme | null>(store.get<MyProgramme | null>('ma-programme', null));
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    rpc<MyProgramme>('my_programme').then((x) => { setD(x); store.set('ma-programme', x); })
      .catch((e) => { if (e instanceof NeedLogin) onNeedLogin(); else if (e instanceof Offline) setOffline(true); else setOffline(true); });
  }, [onNeedLogin]);
  return { d, offline };
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app">
      <div className="app-top"><button className="text" onClick={() => navigate('/')}>‹ Home</button><span className="label">{title}</span></div>
      {children}
    </div>
  );
}

export function ProgrammePage({ onNeedLogin }: { onNeedLogin: () => void }) {
  const { d, offline } = useMyProgramme(onNeedLogin);
  if (!d) return <Shell title="My programme">{offline ? <p className="note cream">You're offline. Connect to see your programme.</p> : <div className="loading">Loading…</div>}</Shell>;
  const p = d.programme;
  if (!p) return <Shell title="My programme"><p className="note cream">You're not on the new-joiner programme. Your manager can add you.</p></Shell>;
  return (
    <Shell title="New-joiner programme">
      {offline && <p className="note cream">Offline: showing your last update.</p>}
      <h1>{p.completed_on ? 'Programme complete' : `Step ${p.current ? p.current.n : p.done} of ${p.total}`}</h1>
      <span className="bar" aria-hidden><span style={{ width: `${p.total ? (100 * p.done) / p.total : 0}%` }} /></span>
      <p className="info">{p.done} of {p.total} steps signed off{p.completed_on ? `, finished ${day(p.completed_on)}. Well done.` : '.'}</p>

      {p.current && <CurrentStep s={p.current} />}

      <div className="panel">
        <h3>All steps</h3>
        <ol className="prog-steps">
          {p.steps.map((s) => (
            <li key={s.step_id} className={'prog-' + s.status}>
              <span className="prog-mark" aria-hidden>{s.status === 'done' ? '✓' : s.n}</span>
              <span className="prog-name">{s.name}<br /><span className="info">{
                s.status === 'done' ? `Signed off${s.signed_by ? ' by ' + s.signed_by : ''} ${day(s.signed_at)}`
                : s.status === 'signoff' ? `Exam passed (${s.best_pct}%). Waiting for your manager's sign-off.`
                : s.status === 'current' ? 'Now'
                : 'Opens after the step before'}</span></span>
            </li>
          ))}
        </ol>
      </div>
      <TierPanel points={d.points} link={false} />
    </Shell>
  );
}

function CurrentStep({ s }: { s: ProgStep }) {
  return (
    <div className="panel current-step">
      <span className="label">Step {s.n} · {s.topic}</span>
      <h2 style={{ margin: '4px 0 12px' }}>{s.name}</h2>
      {s.status === 'current' ? (
        <>
          <ol className="steps">
            <li><span>Study the cards ({s.pool})</span><button className="small outline" onClick={() => navigate(`/programme/study/${s.step_id}`)}>Study</button></li>
            <li><span>Take the step exam: {s.exam_cards} cards, {s.pass_pct}% to pass.
              {s.tries_left !== undefined && ` Tries left: ${s.tries_left} of ${(s.tries_used ?? 0) + s.tries_left}.`}</span>
              {s.tries_left === 0 && !s.open_attempt
                ? <span className="note sky" style={{ display: 'block', marginTop: 8 }}>You've used your tries for this step. Keep studying; your manager can open another round when you're ready.</span>
                : <button className="small" onClick={() => navigate(`/programme/exam/${s.step_id}`)}>{s.open_attempt ? 'Finish the exam' : 'Take the exam'}</button>}</li>
            <li><span>Your manager signs you off on the floor</span></li>
          </ol>
          {s.best_pct != null && <p className="info">Your best so far: {s.best_pct}%.</p>}
        </>
      ) : (
        <>
          <p className="big">Exam passed: {s.best_pct}%.</p>
          <p>Next, your manager signs you off on the floor{s.signoff_note ? ':' : '.'}</p>
          {s.signoff_note && <p className="note sky">{s.signoff_note}</p>}
          <button className="wide outline" onClick={() => navigate(`/programme/study/${s.step_id}`)}>Study the cards again</button>
        </>
      )}
    </div>
  );
}

export function TierPanel({ points, link = true }: { points: Points; link?: boolean }) {
  const body = (
    <>
      <span className="label">Your tier</span>
      <span className="big">{points.tier} · {points.points} points</span>
      <span className="info">{points.next_tier ? `${points.to_next} points to ${points.next_tier}` : 'Top tier. Well done.'}{link ? ' · how points work ›' : ''}</span>
    </>
  );
  return link
    ? <button className="panel level-link" onClick={() => navigate('/progress')}>{body}</button>
    : <div className="panel level-link">{body}</div>;
}

// Full breakdown, on My progress.
export function TierDetail({ onNeedLogin }: { onNeedLogin: () => void }) {
  const { d } = useMyProgramme(onNeedLogin);
  if (!d) return null;
  const w = d.weights ?? {}; const parts = d.points.parts ?? {};
  const rows: [string, string, number | undefined][] = [
    ['Programme steps signed off', `${w.programme_step} each`, parts.programme_steps],
    ['New-joiner programme finished', `${w.programme_done}`, parts.programme_done],
    ['Levels reached', `${w.level} per level`, parts.levels],
    ['Practical sign-offs', `${w.signoff} each`, parts.signoffs],
    ['Exams', `up to ${w.exam_max} each, by score`, parts.exams],
    ['Weeks with your target met', `${w.week_target} each`, parts.weeks],
    ['Cards you know', `${w.mastered} each`, parts.known],
  ];
  return (
    <div className="panel" id="tier">
      <h3>Your tier: {d.points.tier}</h3>
      <p>{d.points.points} points{d.points.next_tier ? `, ${d.points.to_next} to ${d.points.next_tier}` : ''}. Only you see your tier and points.</p>
      <table className="tier-table"><tbody>
        {rows.map(([k, how, v]) => <tr key={k}><td>{k}<br /><span className="info">{how}</span></td><td className="num">{v ?? 0}</td></tr>)}
      </tbody></table>
      <p className="info">Tiers: {(d.tiers ?? []).map((t) => `${t.name} from ${t.min}`).join(' · ')}.</p>
    </div>
  );
}
