// Studio · Manager dashboard (brief section 8): Overview, Team, Person, Questions, Exams.
// Copyright © 2026 Creneau Hospitality. All rights reserved.
// Every figure comes from a database function that checks who is asking:
// a venue manager sees their venue only; the admin sees everything.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { download, toCsv } from '../lib/csv';
import { linkProps, navigate } from '../lib/router';
import { fmtDate, type Access } from '../lib/types';
import ExamsView from './Exams';

const TRACKS = [
  { id: 'service', short: 'Service', name: 'Sequence of service' },
  { id: 'food', short: 'Food', name: 'Food menu' },
  { id: 'drinks', short: 'Drinks', name: 'Drinks' },
  { id: 'upselling', short: 'Upsell', name: 'Upselling' },
  { id: 'suggestive', short: 'Suggest', name: 'Suggestive selling' },
  { id: 'sop', short: 'SOPs', name: 'SOPs' },
];
const LEVELS = ['Getting started', 'New in the house', 'House regular', 'Host of the house'];
// Venue line colours: one validated categorical set, assigned in fixed order by venue name.
const SERIES = ['#3E7B45', '#D2803A', '#6A8FD0'];

type VenueOpt = { id: string; name: string };
interface Overview {
  people: number; active_week: number; target_met: number; floor_ready: number; avg_mastery: number; coaching_open: number;
  menu: { name: string; done: number; people: number } | null;
  heatmap: { venue_id: string; venue: string; people: number; tracks: { track_id: string; track: string; pct: number | null }[] }[];
  trend: { venue_id: string; venue: string; goal_pct: number; weeks: { week_start: string; pct: number | null }[] }[];
  levels: { venue: string; counts: number[] }[];
  coach: { unit: string; track: string; pct: number; answers: number; card: { id: string; prompt: string; answer: string[] } }[];
  recognise: { improved: { staff_id: string; name: string; gain: number }[]; streak: { staff_id: string; name: string; weeks: number } | null;
               level_ups: { staff_id: string; name: string; level_name: string }[] };
  week_start: string; today: string;
}
interface TeamRow {
  id: string; name: string; staff_number: string; role: string; venue: string; venue_id: string; is_test: boolean; activated: boolean;
  level: number; level_name: string; streak: number; this_week: number; target: number;
  tracks: { track_id: string; pct: number | null }[]; last_active: string | null; next_focus: string | null;
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const csvDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

export default function Dashboard({ access, path }: { access: Access; path: string }) {
  const sub = path.replace(/^\/studio\/dashboard\/?/, '').split('?')[0];
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const [venues, setVenues] = useState<VenueOpt[]>([]);
  const [venue, setVenue] = useState<string>(params.get('venue') ?? '');
  const [withTest, setWithTest] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.rpc('list_venues').then(({ data }) => setVenues((data as VenueOpt[]) ?? []));
    // Until real staff exist, include test and sample accounts so there is something to see.
    supabase.rpc('dash_team', { p_venue: null, p_include_test: false }).then(({ data }) => setWithTest(((data as TeamRow[]) ?? []).length === 0));
  }, []);

  const tabs = [
    { to: '/studio/dashboard', label: 'Overview', on: sub === '' },
    { to: '/studio/dashboard/team', label: 'Team', on: sub === 'team' || sub.startsWith('person') },
    { to: '/studio/dashboard/questions', label: 'Questions', on: sub === 'questions' },
    { to: '/studio/dashboard/exams', label: 'Exams', on: sub === 'exams' },
  ];
  const q = venue ? `?venue=${venue}` : '';

  if (withTest === null) return <div className="loading">Loading the dashboard…</div>;
  return (
    <div className="wrap dash">
      <p className="label">Dashboard</p>
      <div className="dash-head">
        <nav className="dash-tabs" aria-label="Dashboard">
          {tabs.map((t) => <a key={t.to} className={t.on ? 'on' : ''} {...linkProps(t.to + q)}>{t.label}</a>)}
        </nav>
        {!sub.startsWith('person') && (
          <div className="dash-filters">
            {venues.length > 1 && (
              <label className="inline"><span className="label">Venue</span>
                <select value={venue} onChange={(e) => { setVenue(e.target.value); history.replaceState(null, '', location.pathname + (e.target.value ? `?venue=${e.target.value}` : '')); }}>
                  <option value="">All venues</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
            <label className="check"><input type="checkbox" checked={withTest} onChange={(e) => setWithTest(e.target.checked)} /> Include test and sample accounts</label>
          </div>
        )}
      </div>
      {sub === '' && <OverviewView venue={venue || null} withTest={withTest} />}
      {sub === 'team' && <TeamView venue={venue || null} withTest={withTest} />}
      {sub === 'questions' && <QuestionsView venue={venue || null} withTest={withTest} access={access} />}
      {sub.startsWith('person/') && <PersonView id={decodeURIComponent(sub.slice(7))} />}
      {sub === 'exams' && <ExamsView venue={venue || null} withTest={withTest} venues={venues} admin={access.admin} />}
    </div>
  );
}

function useRpc<T>(fn: string, args: Record<string, unknown>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const { data, error } = await supabase.rpc(fn, args);
    if (error) setErr(error.message); else setData(data as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, err, reload: load };
}

function Kpi({ k, v, d, flag }: { k: string; v: React.ReactNode; d: string; flag?: boolean }) {
  return <div className={'kpi' + (flag ? ' flag' : '')}><div className="k">{k}</div><div className="v">{v}</div><div className="d">{d}</div></div>;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function OverviewView({ venue, withTest }: { venue: string | null; withTest: boolean }) {
  const { data: o, err } = useRpc<Overview>('dash_overview', { p_venue: venue, p_include_test: withTest }, [venue, withTest]);
  if (err) return <p className="note blush">{err}</p>;
  if (!o) return <div className="loading">Loading…</div>;
  if (o.people === 0) return <p className="note cream">No staff in this view yet. Real staff arrive in Phase 4; tick "Include test and sample accounts" to see the demo venue.</p>;
  const venueColor = (name: string) => SERIES[[...o.trend.map((t) => t.venue)].sort().indexOf(name) % SERIES.length];
  return (
    <>
      <div className="kpis">
        <Kpi k="Practised this week" v={<>{pct(o.active_week, o.people)}<small>%</small></>} d={`${o.active_week} of ${o.people} staff did at least one set since Monday`} />
        <Kpi k="Weekly target met" v={<>{pct(o.target_met, o.people)}<small>%</small></>} d={`${o.target_met} of ${o.people} staff so far this week`} />
        <Kpi k="Floor ready" v={<>{pct(o.floor_ready, o.people)}<small>%</small></>} d={`${o.floor_ready} of ${o.people} staff at Level 1 or above`} />
        <Kpi k="Average mastery" v={<>{o.avg_mastery}<small>%</small></>} d="Cards known: right three times in a row, spaced out" />
        <Kpi k="New on the menu" v={o.menu ? <>{pct(o.menu.done, o.menu.people)}<small>%</small></> : '–'} d={o.menu ? `Have done "${o.menu.name}"` : 'No menu set running'} />
      </div>

      <div className="grid g2">
        <section className="block">
          <h2>Mastery by venue and track</h2>
          <p className="lead">Share of each track's cards the team knows. Darker is stronger.</p>
          <div className="scroll-x">
            <table className="heat">
              <thead><tr><th scope="col">Venue</th>{TRACKS.map((t) => <th key={t.id} scope="col" title={t.name}>{t.short}</th>)}</tr></thead>
              <tbody>
                {o.heatmap.map((h) => (
                  <tr key={h.venue_id}>
                    <td>{h.venue}</td>
                    {h.tracks.map((t) => {
                      const v = t.pct;
                      const bg = v === null ? 'transparent' : `rgba(33,51,31,${(0.08 + 0.92 * Math.min(1, v / 100)).toFixed(2)})`;
                      return <td key={t.track_id}><span className="cell" style={{ background: bg, color: v !== null && v >= 50 ? '#fff' : 'var(--ink)' }}
                        title={`${h.venue} · ${t.track}: ${v === null ? 'no cards at this level yet' : v + '%'}`}>{v === null ? '–' : v}</span></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note-s">"–" means the team has no live cards in that track at their level yet (Drinks and selling are Level 2).</p>
        </section>
        <section className="block">
          <h2>Weekly target met, week by week</h2>
          <p className="lead">Share of staff who met their weekly target in each of the last 8 full weeks, by venue. The dotted line is the team goal.</p>
          <TrendChart trend={o.trend} color={venueColor} />
        </section>
      </div>

      <div className="grid g3">
        <section className="block">
          <h2>Level mix</h2>
          <p className="lead">Where each team sits on the path.</p>
          {o.levels.map((l) => {
            const total = l.counts.reduce((a, b) => a + b, 0);
            return (
              <div key={l.venue} className="lv-row">
                <div className="n">{l.venue}</div>
                <div className="stack" role="img" aria-label={`${l.venue}: ` + l.counts.map((n, i) => `${n} ${LEVELS[i]}`).join(', ')}>
                  {l.counts.map((n, i) => n ? <i key={i} className={'L' + i} style={{ flex: n }} title={`${LEVELS[i]}: ${n} of ${total}`}>{n}</i> : null)}
                </div>
              </div>
            );
          })}
          <div className="legend">{LEVELS.map((l, i) => <span key={l}><i className={'sw L' + i} />{i ? `L${i} ` : ''}{l}</span>)}</div>
        </section>
        <section className="block">
          <h2>Coach this week</h2>
          <p className="lead">The three topics with the most "not yet" answers in the last 4 weeks, each with a question for the pre-shift huddle.</p>
          {o.coach.length === 0 ? <p className="muted">Not enough answers yet.</p> : (
            <ol className="coach">
              {o.coach.map((c, i) => (
                <li key={c.unit}>
                  <span className="num">{i + 1}</span>
                  <span className="t">{c.unit} <span className="note-s">· {c.track} · {c.pct}% right</span></span>
                  <span className="q">Huddle: "{c.card.prompt}"</span>
                  <span className="a">Answer: {c.card.answer.join(c.card.answer.length > 2 ? ' → ' : ', ')}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="block">
          <h2>Recognise</h2>
          <p className="lead">Worth a shout-out at pre-shift.</p>
          <ul className="plain rec">
            {o.recognise.improved.map((p) => <li key={p.staff_id}><a {...linkProps('/studio/dashboard/person/' + p.staff_id)}>{p.name}</a><span className="r">Most improved · +{p.gain} points in 4 weeks</span></li>)}
            {o.recognise.streak && <li><a {...linkProps('/studio/dashboard/person/' + o.recognise.streak.staff_id)}>{o.recognise.streak.name}</a><span className="r">{o.recognise.streak.weeks} weeks in a row on target</span></li>}
            {o.recognise.level_ups.map((p) => <li key={p.staff_id + p.level_name}><a {...linkProps('/studio/dashboard/person/' + p.staff_id)}>{p.name}</a><span className="r">Reached {p.level_name}</span></li>)}
            {!o.recognise.improved.length && !o.recognise.streak && !o.recognise.level_ups.length && <li className="muted">Nothing yet this week.</li>}
          </ul>
        </section>
      </div>
      <p className="note-s">Figures inform; people decide. No score acts on its own.</p>
    </>
  );
}

function TrendChart({ trend, color }: { trend: Overview['trend']; color: (v: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const weeks = trend[0]?.weeks ?? [];
  const W = 640, H = 260, m = { l: 40, r: 120, t: 14, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = (i: number) => m.l + (weeks.length > 1 ? (i * iw) / (weeks.length - 1) : iw / 2);
  const Y = (v: number) => m.t + ih - (v / 100) * ih;
  const goal = trend[0]?.goal_pct ?? 85;
  const label = (w: string, _i?: number) => 'w/c ' + new Date(w + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of staff meeting their weekly target, by week and venue">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}><line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} stroke="rgba(33,51,31,.12)" />
            <text x={m.l - 8} y={Y(t) + 4} textAnchor="end" className="ax">{t}%</text></g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={Y(goal)} y2={Y(goal)} stroke="#21331F" strokeDasharray="2 4" strokeWidth={1.2} />
        <text x={m.l + 4} y={Y(goal) - 6} className="ax goal">GOAL {goal}%</text>
        {weeks.map((w, i) => (i % 2 === (weeks.length - 1) % 2) && <text key={w.week_start} x={X(i)} y={H - 8} textAnchor="middle" className="ax">{label(w.week_start, i)}</text>)}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={m.t} y2={m.t + ih} stroke="rgba(33,51,31,.35)" />}
        {trend.map((s) => {
          const pts = s.weeks.map((w, i) => (w.pct === null ? null : [X(i), Y(w.pct)] as const));
          let d = ''; let started = false;
          pts.forEach((p) => { if (!p) { started = false; return; } d += (started ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); started = true; });
          const last = [...pts].reverse().find(Boolean);
          return (
            <g key={s.venue_id}>
              <path d={d} fill="none" stroke={color(s.venue)} strokeWidth={2} />
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill={color(s.venue)} stroke="#fff" strokeWidth={2} />)}
              {last && <text x={last[0] + 8} y={last[1] + 4} className="ax lbl">{s.venue.replace(' (sample data)', '')}</text>}
            </g>
          );
        })}
        {weeks.map((_w, i) => <rect key={'h' + i} x={X(i) - iw / weeks.length / 2} y={m.t} width={iw / weeks.length} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />)}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: `${(X(hover) / W) * 100}%` }}>
          <b>{label(weeks[hover].week_start, hover)}</b>
          {trend.map((s) => <div key={s.venue_id}><i style={{ background: color(s.venue) }} />{s.venue}: {s.weeks[hover].pct === null ? 'no staff yet' : s.weeks[hover].pct + '%'}</div>)}
        </div>
      )}
      {trend.length > 1 && <div className="legend">{trend.map((s) => <span key={s.venue_id}><i className="sw" style={{ background: color(s.venue) }} />{s.venue}</span>)}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
function TeamView({ venue, withTest }: { venue: string | null; withTest: boolean }) {
  const { data: rows, err } = useRpc<TeamRow[]>('dash_team', { p_venue: venue, p_include_test: withTest }, [venue, withTest]);
  const [sort, setSort] = useState<'name' | 'level' | 'week' | 'last'>('name');
  const sorted = useMemo(() => {
    const r = [...(rows ?? [])];
    if (sort === 'level') r.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    if (sort === 'week') r.sort((a, b) => b.this_week / b.target - a.this_week / a.target || a.name.localeCompare(b.name));
    if (sort === 'last') r.sort((a, b) => (b.last_active ?? '').localeCompare(a.last_active ?? ''));
    return r;
  }, [rows, sort]);
  if (err) return <p className="note blush">{err}</p>;
  if (!rows) return <div className="loading">Loading…</div>;
  if (!rows.length) return <p className="note cream">No staff in this view yet.</p>;
  const exportCsv = () => download(`maison-academy-team-${csvDate()}.csv`, toCsv(
    ['Name', 'Staff number', 'Venue', 'Role', 'Level', 'Weeks on target in a row', 'Sets this week', 'Weekly target', ...TRACKS.map((t) => t.name + ' %'), 'Last active', 'Next focus'],
    sorted.map((r) => [r.name, r.staff_number, r.venue, r.role, r.level_name, r.streak, r.this_week, r.target,
      ...TRACKS.map((t) => r.tracks.find((x) => x.track_id === t.id)?.pct ?? ''), r.last_active ?? '', r.next_focus ?? ''])), 'text/csv;charset=utf-8');
  return (
    <section className="block">
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Team</h2>
        <span className="actions">
          <label className="inline"><span className="label">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="name">Name</option><option value="level">Level</option><option value="week">This week</option><option value="last">Last active</option>
            </select></label>
          <button className="small outline" onClick={exportCsv}>Download CSV</button>
        </span>
      </div>
      <div className="scroll-x" style={{ marginTop: 12 }}>
        <table className="team">
          <thead><tr><th>Name</th><th>Role</th><th>Level</th><th className="num">On target</th><th>This week</th>
            {TRACKS.map((t) => <th key={t.id} title={t.name}>{t.short}</th>)}<th>Last active</th><th>Next focus</th></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td><a {...linkProps('/studio/dashboard/person/' + r.id)}>{r.name}</a>{r.is_test && <span className="tag" style={{ marginLeft: 6 }}>Test</span>}
                  {venueLabel(r)}</td>
                <td>{r.role}</td>
                <td>{r.level_name}</td>
                <td className="num">{r.streak ? `${r.streak} wk` : '–'}</td>
                <td><span className="wk">{Array.from({ length: Math.max(r.target, r.this_week) }, (_, k) => <i key={k} className={k < r.this_week ? 'on' : ''} />)}</span> {r.this_week}/{r.target}</td>
                {TRACKS.map((t) => {
                  const v = r.tracks.find((x) => x.track_id === t.id)?.pct;
                  return <td key={t.id} className="mini" title={`${t.name}: ${v === null || v === undefined ? 'no cards at this level yet' : v + '%'}`}>
                    {v === null || v === undefined ? <span className="muted">–</span> : <><span className="mb"><b style={{ width: `${v}%` }} /></span><span className="mv">{v}</span></>}
                  </td>;
                })}
                <td>{r.last_active ? fmtDay(r.last_active) : <span className="muted">{r.activated ? 'Not yet' : 'Not activated'}</span>}</td>
                <td>{r.next_focus ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
const venueLabel = (r: TeamRow) => <div className="note-s">{r.venue}</div>;
const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------
interface PersonData {
  id: string; name: string; staff_number: string; role: string; venue: string; is_test: boolean; activated: boolean; today: string;
  level: number; level_name: string; next_level_name: string | null;
  tracks: { id: string; name: string; live: number; mastered: number; pct: number }[];
  next_focus: { track: string; unit: string; reason: string } | null; strengths: string[];
  level1: { mastery_pct: number; mastery_target: number; readiness_passed: boolean } | null;
  level2: { mastery_target: number; signoff: boolean } | null;
  rhythm: { target: number; this_week: number; streak: number };
  days: { date: string; sets: number }[];
  signoffs: { skill: string; name: string; signed_by: string | null; signed_at: string | null }[];
  leave_weeks: string[]; week_start: string;
  coaching: { id: number; card: string; created_at: string }[];
  levels_reached: { level_name: string; at: string }[];
}

function PersonView({ id }: { id: string }) {
  const { data: p, err, reload } = useRpc<PersonData>('dash_person', { p_staff: id }, [id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);
  const act = async (fn: string, args: Record<string, unknown>, done?: (d: unknown) => string | null) => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setMsg({ kind: 'blush', text: error.message }); return; }
    const t = done?.(data); if (t) setMsg({ kind: 'sky', text: t });
    await reload();
  };
  if (err) return <p className="note blush">{err}</p>;
  if (!p) return <div className="loading">Loading…</div>;
  const onLeave = p.leave_weeks.includes(p.week_start);
  return (
    <>
      <p><button className="text" onClick={() => (history.length > 1 ? history.back() : navigate('/studio/dashboard/team'))}>‹ Back</button></p>
      <div className="ptop">
        <div>
          <h1 className="pname">{p.name}{p.is_test && <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>Test</span>}</h1>
          <div className="note-s">{p.role} · {p.venue} · staff number {p.staff_number} · {p.rhythm.streak ? `${p.rhythm.streak} weeks in a row on target` : 'no run yet'}</div>
        </div>
        <div className="plevel">
          <div className="label">Level {p.level} · {p.level_name}</div>
          {p.level1 && <><div className="bar" aria-hidden><span style={{ width: `${Math.min(100, (100 * p.level1.mastery_pct) / p.level1.mastery_target)}%` }} /></div>
            <div className="note-s">Level 1 cards known: {p.level1.mastery_pct}% of the {p.level1.mastery_target}% needed</div></>}
        </div>
      </div>
      {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}
      {p.coaching.length > 0 && (
        <div className="private">
          <h3 style={{ color: 'var(--cream)' }}>Private coaching prompt</h3>
          {p.coaching.map((c) => <p key={c.id}>Sure but not right on an allergen card: "{c.card}". Walk through it together at the next shift.{' '}
            <button className="small outline" style={{ color: 'var(--cream)', borderColor: 'var(--cream)' }} onClick={() => act('resolve_coaching', { p_id: c.id })}>Done</button></p>)}
        </div>
      )}
      <div className="grid g2">
        <section className="block">
          <h2>Mastery by track</h2>
          <p className="lead">Share of each track's cards {p.name.split(' ')[0]} knows (right three times in a row, spaced out).</p>
          {p.tracks.map((t) => (
            <div key={t.id} className="track-row">
              <div className="track-head"><span>{t.name}</span><span className="note-s">{t.mastered} of {t.live} · {t.pct}%</span></div>
              <span className="bar" aria-hidden><span style={{ width: `${t.pct}%` }} /></span>
            </div>
          ))}
          <div className="two">
            <div><div className="label">Strengths</div><p>{p.strengths.join(', ') || '–'}</p></div>
            <div><div className="label">Next focus</div><p>{p.next_focus ? `${p.next_focus.track}: ${p.next_focus.unit}` : '–'}</p></div>
          </div>
        </section>
        <section className="block">
          <h2>Practical sign-offs</h2>
          <p className="lead">Observed on the floor by a buddy or manager. Level 1 needs the first three, plus the readiness check{p.level1?.readiness_passed ? ' (passed)' : ' (not yet taken or passed)'} and {p.level1?.mastery_target ?? 80}% of Level 1 cards known.</p>
          <ul className="plain so">
            {p.signoffs.filter((s) => s.skill !== 'level2_signoff' || p.level >= 1).map((s) => (
              <li key={s.skill}>
                <span className={'tick' + (s.signed_by ? ' on' : '')} aria-hidden />
                <span className="so-name">{s.name}{s.signed_by && <span className="note-s"> · {s.signed_by}, {fmtDate(s.signed_at)}</span>}</span>
                {s.signed_by
                  ? <button className="small text" disabled={busy} onClick={() => act('sign_off', { p_staff: p.id, p_skill: s.skill, p_signed: false })}>Undo</button>
                  : <button className="small" disabled={busy} onClick={() => act('sign_off', { p_staff: p.id, p_skill: s.skill, p_signed: true },
                      (d) => (d as { level_up: boolean; level_name: string }).level_up ? `${p.name} reached ${(d as { level_name: string }).level_name}.` : 'Signed off.')}>Sign off</button>}
              </li>
            ))}
          </ul>
          <p className="note-s">Undoing a sign-off never moves anyone down a level.</p>
        </section>
      </div>
      <div className="grid g2">
        <section className="block">
          <h2>Last four weeks</h2>
          <p className="lead">One square per day. This week: {p.rhythm.this_week} of {p.rhythm.target} sets.</p>
          <div className="days" role="img" aria-label={`Practised on ${p.days.filter((d) => d.sets).length} of the last 28 days`}>
            {p.days.map((d) => <i key={d.date} className={d.sets ? 'on' : ''} title={`${fmtDay(d.date)}: ${d.sets ? 'set done' : 'no set'}`} />)}
          </div>
          <div className="legend"><span><i className="sw" style={{ background: 'var(--forest)' }} />Set done</span><span><i className="sw" style={{ border: '1px solid var(--line)', background: 'var(--white)' }} />No set</span></div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="small outline" disabled={busy} onClick={() => act('set_leave_week', { p_staff: p.id, p_week: p.week_start, p_on: !onLeave },
              () => (onLeave ? 'Leave week removed.' : 'This week is marked as leave: it won’t break their run.'))}>
              {onLeave ? 'Remove leave for this week' : 'Mark this week as leave'}</button>
            <span className="note-s">One leave week a month keeps their run going.</span>
          </div>
        </section>
        <section className="block">
          <h2>Levels reached</h2>
          {p.levels_reached.length ? <ul className="plain">{p.levels_reached.map((l) => <li key={l.level_name}>{l.level_name}<span className="r">{fmtDate(l.at)}</span></li>)}</ul>
            : <p className="muted">None yet.</p>}
          {!p.activated && <p className="note cream">Not activated yet. Issue a code from Studio &gt; Staff.</p>}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------
interface QData {
  min_answers: number; known_pct: number; answered_cards: number;
  missed: { id: string; prompt: string; track: string; unit: string; ftr: number; answers: number; instead: string | null }[];
  known: { id: string; prompt: string; track: string; ftr: number; answers: number }[];
  bank: { track: string; live: number; review: number; allergen_waiting: number; draft: number }[];
  menu_sets: { id: string; name: string; cards: number; venue: string; done: number; people: number }[];
}

function QuestionsView({ venue, withTest, access }: { venue: string | null; withTest: boolean; access: Access }) {
  const { data: q, err } = useRpc<QData>('dash_questions', { p_venue: venue, p_include_test: withTest }, [venue, withTest]);
  if (err) return <p className="note blush">{err}</p>;
  if (!q) return <div className="loading">Loading…</div>;
  const canEdit = access.admin || access.reviewer_tracks.length > 0;
  const exportMissed = () => download(`maison-academy-most-missed-${csvDate()}.csv`, toCsv(
    ['Card', 'Track', 'Unit', 'Right first time %', 'Answers', 'Most picked instead'],
    q.missed.map((m) => [m.prompt, m.track, m.unit, m.ftr, m.answers, m.instead ?? ''])), 'text/csv;charset=utf-8');
  const max = Math.max(1, ...q.bank.map((b) => b.live + b.review + b.allergen_waiting + b.draft));
  return (
    <>
      <p className="lead">When most of the team misses a card, the card is usually the problem. Fix the card before coaching the people.</p>
      <section className="block">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Most missed</h2>
          {q.missed.length > 0 && <button className="small outline" onClick={exportMissed}>Download CSV</button>}
        </div>
        <p className="lead">First answers only. Cards show once {q.min_answers} people have answered them.</p>
        {q.missed.length === 0 ? <p className="muted">No card has {q.min_answers} answers yet.</p> : (
          <div className="scroll-x"><table>
            <thead><tr><th>Card</th><th>Track</th><th className="num">Right first time</th><th className="num">Answers</th><th>Most picked instead</th></tr></thead>
            <tbody>{q.missed.map((m) => (
              <tr key={m.id}>
                <td>{canEdit ? <a {...linkProps('/studio/card/' + encodeURIComponent(m.id))}>{m.prompt}</a> : m.prompt}</td>
                <td className="note-s">{m.track} · {m.unit}</td><td className="num">{m.ftr}%</td><td className="num">{m.answers}</td><td>{m.instead ?? '–'}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <div className="grid g2">
        <section className="block">
          <h2>Cards everyone knows</h2>
          <p className="lead">{q.known_pct}% or more right first time: candidates to retire or make harder, so sets stay useful.</p>
          {q.known.length === 0 ? <p className="muted">None yet.</p> : (
            <table><tbody>{q.known.map((k) => <tr key={k.id}><td>{k.prompt}</td><td className="note-s">{k.track}</td><td className="num">{k.ftr}%</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="block">
          <h2>Card bank</h2>
          <p className="lead">Live, in review, and allergen cards waiting for the kitchen check.</p>
          {q.bank.map((b) => {
            const tot = b.live + b.review + b.allergen_waiting + b.draft;
            return (
              <div key={b.track} className="cov-row">
                <div className="n">{b.track}</div>
                <div className="cov" style={{ width: `${(tot / max) * 100}%` }} title={`${b.live} live, ${b.review} in review, ${b.allergen_waiting} waiting for the kitchen`}>
                  <i className="c-live" style={{ flex: b.live }} /><i className="c-rev" style={{ flex: b.review }} /><i className="c-alg" style={{ flex: b.allergen_waiting }} />
                </div>
                <div className="v">{b.live} live{b.review ? ` · ${b.review} rev.` : ''}{b.allergen_waiting ? ` · ${b.allergen_waiting} kitchen` : ''}</div>
              </div>
            );
          })}
          <div className="legend"><span><i className="sw c-live" />Live</span><span><i className="sw c-rev" />In review</span><span><i className="sw c-alg" />Waiting for kitchen check</span></div>
        </section>
      </div>
      <section className="block">
        <h2>New on the menu</h2>
        {q.menu_sets.length === 0 ? <p className="muted">No menu set running.{access.admin && <> Create one in <a {...linkProps('/studio/menu')}>New on the menu</a>.</>}</p> : (
          q.menu_sets.map((m) => (
            <div key={m.id} className="cov-row">
              <div className="n">{m.name} <span className="note-s">· {m.venue} · {m.cards} cards</span></div>
              <div className="cov" style={{ width: '100%' }}><i className="c-live" style={{ flex: m.done }} /><i className="c-rest" style={{ flex: Math.max(0, m.people - m.done) }} /></div>
              <div className="v">{pct(m.done, m.people)}% done</div>
            </div>
          ))
        )}
        <p className="note-s">Staff who haven't done it yet get it first in their next set.</p>
      </section>
    </>
  );
}
