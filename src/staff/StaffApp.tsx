// Maison Academy · staff app (brief section 7).
// Copyright © 2026 Creneau Hospitality. All rights reserved.
import { useCallback, useEffect, useState } from 'react';
import { linkProps, navigate } from '../lib/router';
import {
  activate, AuthProblem, checkCode, disableReminders, enableReminders, flush, isIos, isStandalone, login, NeedLogin, Offline,
  pushSupported, queued, rpc, sendTestReminder, signOut, staffDb, store,
  type HomeData,
} from './api';
import Practice, { RhythmLine, TeamLine } from './Practice';
import { PrivacyText } from './Privacy';

// Android offers an install prompt; keep it for the Install help screen.
let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e as typeof installPrompt; });
}

export default function StaffApp({ path }: { path: string }) {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');
  const [notice, setNotice] = useState('');
  const route = path.split('?')[0];

  useEffect(() => {
    staffDb.auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out'));
    const { data: sub } = staffDb.auth.onAuthStateChange((_e, session) => setState(session ? 'in' : 'out'));
    const online = () => { void flush(); };
    window.addEventListener('online', online);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('online', online); };
  }, []);

  const needLogin = useCallback(async () => {
    await signOut();
    setNotice('Please log in again with your staff number and PIN.');
    navigate('/login');
  }, []);

  if (state === 'checking') return <div className="loading">Loading…</div>;
  if (route === '/privacy') return <Page title="Privacy"><PrivacyText /></Page>;
  if (route === '/install') return <Install />;
  if (route === '/activate') return <Activate />;
  if (state === 'out') return <Login notice={notice} />;
  if (route === '/set') return <Practice mode="daily" onNeedLogin={needLogin} />;
  if (route === '/readiness') return <Practice mode="readiness" onNeedLogin={needLogin} />;
  if (route === '/misses') return <Practice mode="misses" onNeedLogin={needLogin} />;
  if (route === '/progress') return <Progress onNeedLogin={needLogin} />;
  return <Home onNeedLogin={needLogin} />;
}

function Page({ title, children, back = true }: { title: string; children: React.ReactNode; back?: boolean }) {
  return (
    <div className="app">
      <div className="app-top">
        {back ? <button className="text" onClick={() => (history.length > 1 ? history.back() : navigate('/'))}>‹ Back</button> : <span />}
        <span className="label">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand-block">
      <div className="stripes" />
      <p className="label" style={{ marginTop: 20 }}>Maison Mathis · front of house</p>
      <h1 className="brand-title">Maison Academy</h1>
    </div>
  );
}

// --- Activate -------------------------------------------------------------------
function Activate() {
  const fromLink = new URLSearchParams(location.search).get('code') ?? '';
  const [step, setStep] = useState<'code' | 'privacy' | 'pin' | 'done'>('code');
  const [code, setCode] = useState(fromLink.toUpperCase());
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [number, setNumber] = useState('');

  const go = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e instanceof AuthProblem ? e.message : 'Something didn’t work. Please try again.'); }
    setBusy(false);
  };

  return (
    <div className="app">
      <Brand />
      {step === 'code' && (
        <form onSubmit={(e) => { e.preventDefault(); void go(async () => { const r = await checkCode(code); setName(r.first_name); setStep('privacy'); }); }}>
          <h2>Activate</h2>
          <p>Enter the activation code your manager gave you.</p>
          <label className="field"><span className="label">Activation code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters"
              autoComplete="one-time-code" placeholder="ABCDE-23456" maxLength={12} required />
          </label>
          {err && <p className="note blush">{err}</p>}
          <button className="wide" disabled={busy || code.replace(/[^A-Z0-9]/g, '').length < 10}>{busy ? 'Checking…' : 'Next'}</button>
          <p className="center"><a {...linkProps('/login')}>I already have a PIN</a></p>
        </form>
      )}
      {step === 'privacy' && (
        <div>
          <h2>Welcome, {name}</h2>
          <p>Before you start, please read how we look after your information.</p>
          <div className="panel"><PrivacyText /></div>
          <label className="check" style={{ margin: '16px 0' }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I've read this and I agree.</span>
          </label>
          <button className="wide" disabled={!agree} onClick={() => setStep('pin')}>Next</button>
        </div>
      )}
      {step === 'pin' && (
        <form onSubmit={(e) => {
          e.preventDefault();
          if (pin !== pin2) { setErr("The two PINs don't match. Please type them again."); return; }
          void go(async () => { const r = await activate(code, pin); setNumber(r.staff_number); store.set('ma-staff-number', r.staff_number); setStep('done'); });
        }}>
          <h2>Choose a PIN</h2>
          <p>Six digits you'll remember. Not a pattern like 123456 or 111111.</p>
          <label className="field"><span className="label">PIN</span>
            <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
          </label>
          <label className="field"><span className="label">PIN again</span>
            <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="new-password"
              value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} required />
          </label>
          {err && <p className="note blush">{err}</p>}
          <button className="wide" disabled={busy || pin.length !== 6 || pin2.length !== 6}>{busy ? 'Activating…' : 'Activate'}</button>
        </form>
      )}
      {step === 'done' && (
        <div>
          <h2>You're in, {name}</h2>
          <p>Your staff number is <strong>{number}</strong>. Next time, log in with it and your PIN. This phone stays logged in for 60 days.</p>
          <p className="info">Tip: add Maison Academy to your home screen so it opens like an app.</p>
          <button className="wide" onClick={() => navigate('/')}>Start</button>
          <p className="center"><a {...linkProps('/install')}>How to add it to your home screen</a></p>
        </div>
      )}
    </div>
  );
}

// --- Log in ---------------------------------------------------------------------
function Login({ notice }: { notice: string }) {
  const [number, setNumber] = useState(store.get('ma-staff-number', ''));
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="app">
      <Brand />
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { await login(number, pin); navigate('/'); }
        catch (x) { setErr(x instanceof AuthProblem ? x.message : 'Something didn’t work. Please try again.'); setPin(''); }
        setBusy(false);
      }}>
        <h2>Log in</h2>
        {notice && <p className="note cream">{notice}</p>}
        <label className="field"><span className="label">Staff number</span>
          <input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="username" required />
        </label>
        <label className="field"><span className="label">PIN</span>
          <input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="current-password"
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
        </label>
        {err && <p className="note blush">{err}</p>}
        <button className="wide" disabled={busy || !number || pin.length !== 6}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p className="center"><a {...linkProps('/activate')}>First time? Activate with your code</a></p>
      <p className="center info">Forgotten your PIN? Ask your manager for a new activation code.</p>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <p className="center info footer-links">
      <a {...linkProps('/install')}>Add to home screen</a> · <a {...linkProps('/privacy')}>Privacy</a>
    </p>
  );
}

// --- Home -----------------------------------------------------------------------
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Home({ onNeedLogin }: { onNeedLogin: () => void }) {
  const [home, setHome] = useState<HomeData | null>(store.get<HomeData | null>('ma-home', null));
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(queued().length);

  const load = useCallback(async () => {
    try {
      await flush();
      setPending(queued().length);
      const h = await rpc<HomeData>('staff_home');
      setHome(h); setOffline(false); store.set('ma-home', h);
      // Keep today's set on the phone, so it still opens on low signal
      // (not when the location check is on: the set starts at the venue).
      if (h.cards_available && !h.set_today?.finished && !h.location_required) {
        rpc('start_daily_set').then((s) => store.set('ma-set', s)).catch(() => {});
      }
    } catch (e) {
      if (e instanceof NeedLogin) onNeedLogin();
      else setOffline(true);
    }
  }, [onNeedLogin]);

  useEffect(() => { void load(); }, [load]);

  if (!home) return offline
    ? <Page title="Home" back={false}><p className="note cream">You're offline. Connect to Wi-Fi or mobile data to load the app the first time.</p><button className="wide" onClick={() => void load()}>Try again</button></Page>
    : <div className="loading">Loading…</div>;

  const st = home.set_today;
  const setLabel = !home.cards_available ? null
    : !st ? `Start today's set · 5 cards`
    : st.finished ? null
    : st.answered > 0 ? `Continue today's set · ${st.answered} of ${st.total}` : `Start today's set · ${st.total} cards`;

  return (
    <div className="app">
      {home.test && <TestBar offset={home.test.offset} onChange={() => { store.del('ma-set'); void load(); }} />}
      <div className="stripes" />
      <p className="label" style={{ marginTop: 20 }}>{home.team.venue}{home.test ? ` · ${home.today}` : ''}</p>
      <h1>{greeting()}, {home.first_name}</h1>
      {offline && <p className="note cream">You're offline. Your answers are saved on this phone and sent when you're back online.</p>}
      {pending > 0 && !offline && <p className="info">Sending saved answers…</p>}

      {setLabel
        ? <button className="wide hero" onClick={() => navigate('/set')}>{setLabel}</button>
        : st?.finished
          ? <div className="panel done-panel"><span className="label">Today</span><p className="big">Today's set is done.</p><p className="info">See you next shift.</p></div>
          : <p className="note cream">No cards are ready for you yet. Check back soon.</p>}

      <Reminders home={home} />

      <RhythmLine r={home.rhythm} />

      <button className="panel level-link" onClick={() => navigate('/progress')}>
        <span className="label">Your level</span>
        <span className="big">{home.level_name}</span>
        {home.next_level_name && home.level === 0 && (
          <>
            <span className="bar" aria-hidden><span style={{ width: `${Math.min(100, home.level1_pct)}%` }} /></span>
            <span className="info">Next: {home.next_level_name} · see what's needed ›</span>
          </>
        )}
        {home.level > 0 && <span className="info">My progress ›</span>}
      </button>

      <TeamLine t={home.team} />

      <div className="list-links">
        <button className="outline wide" onClick={() => navigate('/misses')}>Review my misses{home.misses ? ` · ${home.misses}` : ''}</button>
        <button className="outline wide" onClick={() => navigate('/progress')}>My progress</button>
        {home.level === 0 && <button className="outline wide" onClick={() => navigate('/readiness')}>Readiness check</button>}
      </div>
      <p className="center info footer-links">
        <a {...linkProps('/install')}>Add to home screen</a> · <a {...linkProps('/privacy')}>Privacy</a> · <button className="text" onClick={() => void signOut()}>Log out</button>
      </p>
    </div>
  );
}

// Reminders: offered after the first set is done (brief section 10), at most one a day.
function Reminders({ home }: { home: HomeData }) {
  const r = home.reminders;
  const [state, setState] = useState<'idle' | 'busy' | 'on' | 'off'>(r && r.subscriptions > 0 ? 'on' : 'idle');
  const [msg, setMsg] = useState('');
  const [dismissed, setDismissed] = useState(store.get('ma-reminder-dismissed', false));
  if (!r?.available || r.sets_done < 1) return null;
  const perm = pushSupported() ? Notification.permission : 'unsupported';
  const go = async (fn: () => Promise<void | string>, next: 'on' | 'off') => {
    setState('busy'); setMsg('');
    try { const t = await fn(); setState(next); if (typeof t === 'string') setMsg(t); }
    catch (e) { setMsg((e as Error).message); setState(next === 'on' ? 'idle' : 'on'); }
  };
  if (state === 'on' || state === 'busy' && r.subscriptions > 0) {
    return home.test ? (
      <div className="panel">
        <span className="label">Reminders on · {r.time} on days you haven't practised</span>
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="small outline" onClick={() => void go(sendTestReminder, 'on')}>Send a test reminder</button>
          <button className="small text" onClick={() => void go(disableReminders, 'off')}>Turn off</button>
        </div>
        {msg && <p className="info">{msg}</p>}
      </div>
    ) : null;
  }
  if (dismissed || perm === 'denied') return null;
  if (perm === 'unsupported' || (isIos() && !isStandalone())) {
    return isIos() && !isStandalone() ? (
      <div className="panel">
        <span className="label">Reminders</span>
        <p className="info">To get a short reminder before your shift, first add Maison Academy to your home screen, then open it from there.</p>
        <a className="btn outline small" {...linkProps('/install')}>How to add it</a>
      </div>
    ) : null;
  }
  return (
    <div className="panel">
      <span className="label">Reminders</span>
      <p>Get one short reminder at {r.time} on days you haven't done your set? None once your weekly target is met.</p>
      <div className="actions">
        <button className="small" disabled={state === 'busy'} onClick={() => void go(enableReminders, 'on')}>Yes, remind me</button>
        <button className="small text" onClick={() => { store.set('ma-reminder-dismissed', true); setDismissed(true); }}>Not now</button>
      </div>
      {msg && <p className="info">{msg}</p>}
    </div>
  );
}

// Test accounts only: move the date to watch the spacing work.
function TestBar({ offset, onChange }: { offset: number; onChange: () => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: string, args?: Record<string, unknown>) => {
    setBusy(true);
    try { await rpc(fn, args); } catch (e) { console.error(e); }
    setBusy(false); setSure(false); onChange();
  };
  return (
    <div className="testbar">
      <span>Test account · date {offset ? `+${offset} day${offset === 1 ? '' : 's'}` : 'today'}</span>
      <span className="testbar-actions">
        <button className="small" disabled={busy} onClick={() => void run('test_move_date', { p_days: 1 })}>Next day</button>
        <button className="small outline" disabled={busy} onClick={() => (sure ? void run('test_reset') : setSure(true))}>{sure ? 'Tap to confirm' : 'Reset'}</button>
      </span>
    </div>
  );
}

// --- My progress ------------------------------------------------------------------
interface ProgressData {
  first_name: string; level: number; level_name: string; next_level_name: string | null;
  tracks: { id: string; name: string; live: number; mastered: number; pct: number }[];
  confidence: { right_sure: number; right_not_sure: number; not_yet_not_sure: number; not_yet_sure: number };
  strengths: string[]; next_focus: { track: string; unit: string; reason: 'not_yet' | 'new' } | null;
  level1: { mastery_pct: number; mastery_target: number; readiness_passed: boolean; readiness_cards: number; readiness_pass_pct: number;
            signoffs: { id: string; name: string; done: boolean }[] } | null;
  level2: { mastery_target: number; signoff: boolean } | null;
}

function Progress({ onNeedLogin }: { onNeedLogin: () => void }) {
  const [p, setP] = useState<ProgressData | null>(store.get<ProgressData | null>('ma-progress', null));
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    rpc<ProgressData>('my_progress').then((d) => { setP(d); store.set('ma-progress', d); })
      .catch((e) => { if (e instanceof NeedLogin) onNeedLogin(); else if (e instanceof Offline) setOffline(true); else setOffline(true); });
  }, [onNeedLogin]);
  if (!p) return <Page title="My progress">{offline ? <p className="note cream">You're offline. Connect to see your progress.</p> : <div className="loading">Loading…</div>}</Page>;
  return (
    <Page title="My progress">
      {offline && <p className="note cream">Offline: showing your last update.</p>}
      <span className="label">Your level</span>
      <h1>{p.level_name}</h1>

      {p.level1 && (
        <div className="panel">
          <h3>Next: {p.next_level_name}</h3>
          <ul className="steps">
            <li className={p.level1.mastery_pct >= p.level1.mastery_target ? 'met' : ''}>
              <span>Know {p.level1.mastery_target}% of the Level 1 cards</span>
              <span className="bar" aria-hidden><span style={{ width: `${Math.min(100, (100 * p.level1.mastery_pct) / p.level1.mastery_target)}%` }} /></span>
              <span className="info">You're at {p.level1.mastery_pct}%</span>
            </li>
            <li className={p.level1.readiness_passed ? 'met' : ''}>
              <span>Readiness check: {p.level1.readiness_cards} cards, untimed, take it any time</span>
              {p.level1.readiness_passed ? <span className="info">Done</span> : <button className="small outline" onClick={() => navigate('/readiness')}>Take the check</button>}
            </li>
            {p.level1.signoffs.map((s) => (
              <li key={s.id} className={s.done ? 'met' : ''}>
                <span>{s.name}</span>
                <span className="info">{s.done ? 'Signed off' : 'Your manager signs this off on the floor'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.level2 && (
        <div className="panel">
          <h3>Next: {p.next_level_name}</h3>
          <p className="info">{p.level2.mastery_target}% in every track below, plus your manager's sign-off{p.level2.signoff ? ' (done)' : ''}.</p>
        </div>
      )}

      <div className="panel">
        <h3>Tracks</h3>
        {p.tracks.map((t) => (
          <div key={t.id} className="track-row">
            <div className="track-head"><span>{t.name}</span><span className="info">{t.pct}%</span></div>
            <span className="bar" aria-hidden><span style={{ width: `${t.pct}%` }} /></span>
          </div>
        ))}
        <p className="info">A card counts once you've answered it right three times in a row, spaced out over days.</p>
      </div>

      <div className="panel">
        <h3>Next focus</h3>
        <p>{p.next_focus ? `${p.next_focus.track}: ${p.next_focus.unit}` : 'Keep your rhythm going.'}</p>
      </div>
    </Page>
  );
}

// --- Install help ---------------------------------------------------------------
function Install() {
  const [canPrompt, setCanPrompt] = useState(!!installPrompt);
  useEffect(() => { const t = setInterval(() => setCanPrompt(!!installPrompt), 1000); return () => clearInterval(t); }, []);
  return (
    <Page title="Add to home screen">
      <h2>Open it like an app</h2>
      {canPrompt && (
        <button className="wide" onClick={async () => { await installPrompt?.prompt(); installPrompt = null; setCanPrompt(false); }}>Add to home screen</button>
      )}
      <div className="panel">
        <h3>iPhone (Safari)</h3>
        <ol>
          <li>Open this page in Safari.</li>
          <li>Tap the Share button (the square with an arrow pointing up).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        </ol>
      </div>
      <div className="panel">
        <h3>Android (Chrome)</h3>
        <ol>
          <li>Open this page in Chrome.</li>
          <li>Tap the menu (three dots, top right).</li>
          <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
        </ol>
      </div>
      <p className="info">After that, open Maison Academy from its icon. It works on low signal: your answers are saved and sent when you're back online.</p>
    </Page>
  );
}
