// The card player: daily set, readiness check and "Review my misses".
// Copyright © 2026 Creneau Hospitality. All rights reserved.
import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { shuffled } from '../lib/types';
import {
  enqueue, flush, isRight, newEventId, NeedLogin, Offline, queued, rpc, store,
  type HomeData, type PracticeSet, type SetResult, type StaffCard,
} from './api';

type Mode = 'daily' | 'readiness' | 'misses';
type Phase = 'loading' | 'card' | 'feedback' | 'done' | 'empty' | 'offline';


export default function Practice({ mode, onNeedLogin }: { mode: Mode; onNeedLogin: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [setInfo, setSetInfo] = useState<PracticeSet['set']>(null);
  const [cards, setCards] = useState<StaffCard[]>([]);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [last, setLast] = useState<{ right: boolean; chosen: string[] } | null>(null);
  const [summary, setSummary] = useState<SetResult | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let data: PracticeSet;
        if (mode === 'misses') {
          let list: StaffCard[];
          try { list = await rpc<StaffCard[]>('my_misses'); store.set('ma-misses', list); }
          catch (e) { if (e instanceof Offline) list = store.get<StaffCard[]>('ma-misses', []); else throw e; }
          data = { set: null, cards: list, answered: [] };
        } else if (mode === 'readiness') {
          data = await rpc<PracticeSet>('start_readiness');
        } else {
          try {
            await flush();
            data = await rpc<PracticeSet>('start_daily_set');
            store.set('ma-set', data);
          } catch (e) {
            if (!(e instanceof Offline)) throw e;
            const cached = store.get<PracticeSet | null>('ma-set', null);
            const home = store.get<HomeData | null>('ma-home', null);
            if (!cached?.set || !home || cached.set.local_date !== home.today) { if (live) setPhase('offline'); return; }
            data = cached;
          }
        }
        if (!live) return;
        // Skip cards already answered (on the server, or queued on this phone).
        const done = new Set(data.answered.map((a) => a.card_id));
        if (data.set) queued().forEach((q) => { if (q.kind === 'answer' && q.set_id === data.set!.id) done.add(q.card_id); });
        const todo = data.cards.filter((c) => !done.has(c.id));
        setSetInfo(data.set);
        setCards(todo);
        if (data.set?.finished || (data.set && todo.length === 0 && data.cards.length > 0)) { await finish(data.set); return; }
        setPhase(todo.length ? 'card' : 'empty');
      } catch (e) {
        if (e instanceof NeedLogin) onNeedLogin();
        else if (e instanceof Offline) setPhase('offline');
        else { console.error(e); setPhase('offline'); }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function finish(s: PracticeSet['set']) {
    if (mode === 'misses' || !s) { setPhase('done'); return; }
    if (!queued().some((q) => q.kind === 'finish' && q.set_id === s.id)) enqueue({ kind: 'finish', set_id: s.id });
    const r = await flush();
    if (r.results[s.id]) { setSummary(r.results[s.id]); store.del('ma-home'); }
    else setSavedOffline(true);
    setPhase('done');
  }

  function answer(chosen: string[]) {
    const card = cards[i];
    const right = isRight(card, chosen);
    if (mode !== 'misses' && setInfo) {
      enqueue({ kind: 'answer', client_event_id: newEventId(), set_id: setInfo.id, card_id: card.id, chosen, confidence: null, answered_at: new Date().toISOString() });
      void flush();
    }
    setResults([...results, right]);
    setLast({ right, chosen });
    setPhase('feedback');
    window.scrollTo(0, 0);
  }

  function next() {
    if (i + 1 < cards.length) { setI(i + 1); setLast(null); setPhase('card'); window.scrollTo(0, 0); }
    else { setPhase('loading'); void finish(setInfo); }
  }

  const title = mode === 'daily' ? "Today's set" : mode === 'readiness' ? 'Readiness check' : 'Review my misses';

  if (phase === 'loading') return <div className="loading">Loading…</div>;
  if (phase === 'offline') return (
    <Shell title={title}>
      <p className="note cream">You're offline, and this hasn't been saved on your phone yet. Connect to Wi-Fi or mobile data and try again.</p>
      <button className="wide" onClick={() => navigate('/')}>Back to home</button>
    </Shell>
  );
  if (phase === 'empty') return (
    <Shell title={title}>
      <p>{mode === 'misses' ? 'Nothing to review right now. Cards you answer "not yet" will appear here.' : 'No cards are ready for you yet. Check back soon.'}</p>
      <button className="wide" onClick={() => navigate('/')}>Back to home</button>
    </Shell>
  );
  if (phase === 'done') return <Done mode={mode} summary={summary} savedOffline={savedOffline} count={results.length || cards.length} />;

  const card = cards[i];
  return (
    <Shell title={title} progress={{ at: i, of: cards.length, phase, results }}
      tone={phase === 'feedback' ? (last!.right ? 'got' : 'notyet') : undefined}>
      <p className="label card-meta">{card.track} · {card.unit}</p>
      {phase === 'card'
        ? <CardView key={card.id} card={card} onAnswer={answer} />
        : <Feedback card={card} right={last!.right} chosen={last!.chosen} mode={mode} last={i + 1 === cards.length} onNext={next} />}
    </Shell>
  );
}

function Shell({ title, progress, tone, children }: {
  title: string; children: React.ReactNode; tone?: 'got' | 'notyet';
  progress?: { at: number; of: number; phase: Phase; results: boolean[] };
}) {
  return (
    <div className={'app' + (tone ? ' tone-' + tone : '')}>
      <div className="app-top">
        <button className="text" onClick={() => navigate('/')} aria-label="Back to home">‹ Home</button>
        <span className="label">{title}</span>
      </div>
      {progress && (
        <div className="dots" aria-label={`Card ${progress.at + 1} of ${progress.of}`}>
          {Array.from({ length: progress.of }, (_, k) => (
            <span key={k} className={k < progress.results.length ? 'dot done' : k === progress.at ? 'dot now' : 'dot'} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

function CardView({ card, onAnswer }: { card: StaffCard; onAnswer: (chosen: string[]) => void }) {
  const opts = useMemo(() => {
    if (card.type !== 'order') return shuffled(card.options);
    for (let k = 0; k < 6; k++) { const s = shuffled(card.options); if (JSON.stringify(s) !== JSON.stringify(card.answer)) return s; }
    return shuffled(card.options);
  }, [card]);
  const [picked, setPicked] = useState<string[]>([]);
  const many = card.type === 'multi';
  const ordering = card.type === 'order';
  const ready = ordering ? picked.length === card.options.length : picked.length > 0;

  const tap = (o: string) => {
    if (ordering) setPicked(picked.includes(o) ? picked.slice(0, picked.indexOf(o)) : [...picked, o]);
    else if (many) setPicked(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]);
    else onAnswer([o]); // one tap answers
  };

  return (
    <div>
      {card.media && <img className="card-img" src={card.media} alt="" />}
      <p className="q">{card.prompt}</p>
      {many && !/all that apply/i.test(card.prompt) && <p className="hint">Pick all that apply.</p>}
      {ordering && <p className="hint">Tap them in order, first to last. Tap a numbered one to undo from there.</p>}
      {ordering && picked.length > 0 && (
        <ol className="placed">
          {picked.map((o) => <li key={o}><button className="opt on" onClick={() => tap(o)}>{o}</button></li>)}
        </ol>
      )}
      <div className="opts" role="group">
        {opts.filter((o) => !(ordering && picked.includes(o))).map((o) => (
          <button key={o} className={'opt' + (picked.includes(o) ? ' on' : '')} onClick={() => tap(o)}
            role={many ? 'checkbox' : undefined} aria-checked={many ? picked.includes(o) : undefined}>
            {many && <span className="box" aria-hidden>{picked.includes(o) ? '✓' : ''}</span>}
            <span>{o}</span>
          </button>
        ))}
      </div>
      {(many || ordering) && (
        <button className="wide" disabled={!ready} onClick={() => onAnswer(picked)}>Check</button>
      )}
    </div>
  );
}

function Feedback({ card, right, chosen, mode, last, onNext }: {
  card: StaffCard; right: boolean; chosen: string[]; mode: Mode; last: boolean; onNext: () => void;
}) {
  return (
    <div className="feedback">
      <p className={'verdict ' + (right ? 'got' : 'notyet')}><span aria-hidden>{right ? '✓ ' : ''}</span>{right ? 'Got it.' : 'Not yet.'}</p>
      <p className="q small">{card.prompt}</p>
      {card.type === 'order' ? (
        <>
          <p className="label">{right ? 'The order' : 'The right order'}</p>
          <ol className="answer-list">{card.answer.map((a) => <li key={a}>{a}</li>)}</ol>
        </>
      ) : (
        <>
          <p className="label">{card.answer.length > 1 ? 'The right answers' : 'The right answer'}</p>
          <ul className="answer-list plain">{card.answer.map((a) => <li key={a}>{a}</li>)}</ul>
          {!right && chosen.length > 0 && (<><p className="label">Your answer</p><ul className="chosen-list plain">{chosen.map((a) => <li key={a}>{a}</li>)}</ul></>)}
        </>
      )}
      <p>{card.explanation}</p>
      <div className="why"><span className="label">Why it matters</span><p>{card.why_it_matters}</p></div>
      {!right && mode === 'daily' && <p className="info">This card comes back next set.</p>}
      <button className="wide" onClick={onNext}>{last ? 'Finish' : 'Next card'}</button>
    </div>
  );
}

function Done({ mode, summary, savedOffline, count }: { mode: Mode; summary: SetResult | null; savedOffline: boolean; count: number }) {
  let headline = 'Set done.';
  let lines: React.ReactNode = null;
  if (mode === 'misses') {
    headline = 'Practice done.';
    lines = <p>These don't count toward anything, so practise as often as you like.</p>;
  } else if (savedOffline || !summary) {
    lines = <p className="note cream">{count} cards practised. Saved on this phone: it will be sent when you're back online.</p>;
  } else if (summary.kind === 'readiness') {
    headline = summary.passed ? 'Ready.' : 'Not yet.';
    lines = summary.passed
      ? <p>You've passed the readiness check, one of the steps to Level 1. Well done.</p>
      : (<>
          <p>Here's what to practise, then try again any time. Nothing is lost.</p>
          <ul className="answer-list plain">{(summary.practise ?? []).map((p) => <li key={p.unit}>{p.track}: {p.unit}</li>)}</ul>
        </>);
  } else {
    const parts = [];
    if (summary.learned) parts.push(`${summary.learned} new ${summary.learned === 1 ? 'thing' : 'things'} learned`);
    if (summary.strengthened) parts.push(`${summary.strengthened} strengthened`);
    lines = <p className="big">{parts.length ? parts.join(', ') + '.' : `${summary.practised} cards practised.`}</p>;
  }
  return (
    <div className="app">
      <div className="app-top"><span className="label">{mode === 'readiness' ? 'Readiness check' : mode === 'misses' ? 'Review my misses' : "Today's set"}</span></div>
      <h1>{headline}</h1>
      {lines}
      {summary?.level_up && <p className="note sky">You've reached Level {summary.level}: {summary.level_name}.</p>}
      {summary && <RhythmLine r={summary.rhythm} />}
      {summary && <TeamLine t={summary.team} />}
      <button className="wide" onClick={() => navigate('/')}>Back to home</button>
    </div>
  );
}

export function RhythmLine({ r }: { r: { target: number; this_week: number; streak: number; met: boolean } }) {
  return (
    <div className="panel rhythm">
      <span className="label">This week</span>
      <div className="week-dots" aria-label={`${r.this_week} of ${r.target} sets this week`}>
        {Array.from({ length: Math.max(r.target, r.this_week) }, (_, k) => <span key={k} className={k < r.this_week ? 'dot done' : 'dot'} />)}
      </div>
      <p>{r.this_week} of {r.target} sets{r.met ? ': weekly target met.' : '.'}</p>
      <p className="info">{r.streak > 0 ? `Rhythm: ${r.streak} ${r.streak === 1 ? 'week' : 'weeks'} in a row.` : 'Start a new run this week.'}</p>
    </div>
  );
}

export function TeamLine({ t }: { t: { venue: string; met: number; people: number; pct: number; goal_pct: number } }) {
  return (
    <div className="panel">
      <span className="label">Team goal · {t.venue}</span>
      <div className="bar" aria-hidden><span style={{ width: `${Math.min(100, t.pct)}%` }} /><i style={{ left: `${t.goal_pct}%` }} /></div>
      <p className="info">{t.people ? `${t.pct}% of the team met their weekly target. Goal: ${t.goal_pct}%.` : `Goal: ${t.goal_pct}% of the team meet their weekly target.`}</p>
    </div>
  );
}
