import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { linkProps, navigate } from '../lib/router';
import type { Access, Card, Track, Unit } from '../lib/types';
import SignIn, { SetPassword } from './SignIn';
import CardList from './CardList';
import CardEditor from './CardEditor';
import ImportCards from './ImportCards';
import ExportCards from './ExportCards';
import People from './People';
import Settings from './Settings';
import Staff from './Staff';
import Dashboard from './Dashboard';
import MenuSets from './MenuSets';

export interface StudioData {
  access: Access;
  tracks: Track[];
  units: Unit[];
  cards: Card[];
  reload: () => Promise<void>;
}

// Set before Supabase reads the link, so we know to ask for a new password.
const arrivedToSetPassword = /type=(invite|recovery)/.test(location.hash);

export default function Studio({ path }: { path: string }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [needsPassword, setNeedsPassword] = useState(arrivedToSetPassword);
  const [data, setData] = useState<Omit<StudioData, 'reload'> | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    setProblem('');
    const [acc, tr, un, cs] = await Promise.all([
      supabase.rpc('my_access'),
      supabase.from('tracks').select('*').order('sort'),
      supabase.from('units').select('*').order('track_id').order('sort'),
      supabase.from('cards').select('*').order('id').limit(5000),
    ]);
    const err = acc.error || tr.error || un.error || cs.error;
    if (err) { setProblem(err.message); return; }
    setData({ access: acc.data as Access, tracks: tr.data ?? [], units: un.data ?? [], cards: (cs.data ?? []) as Card[] });
  }, []);

  useEffect(() => { if (session) reload(); else setData(null); }, [session, reload]);

  if (session === undefined) return <div className="loading">Loading…</div>;
  if (session && needsPassword) return <Shell><SetPassword onDone={() => { setNeedsPassword(false); history.replaceState(null, '', '/studio'); }} /></Shell>;
  if (!session) return <Shell><SignIn /></Shell>;
  if (problem) return <Shell><div className="narrow"><p className="note blush">Couldn't load the studio: {problem}</p><button onClick={reload}>Try again</button></div></Shell>;
  if (!data) return <div className="loading">Loading the card bank…</div>;

  const { access } = data;
  const isContent = access.admin || access.reviewer_tracks.length > 0;
  const isManager = (access.manager_venues ?? []).length > 0;
  const hasAccess = isContent || isManager;
  const ctx: StudioData = { ...data, reload };

  const signOut = async () => { await supabase.auth.signOut(); navigate('/studio'); };
  const sub = path.replace(/^\/studio\/?/, '').split('?')[0];
  const nav = [
    ...(isManager ? [{ to: '/studio/dashboard', label: 'Dashboard', on: sub.startsWith('dashboard') }] : []),
    ...(isContent ? [
      { to: '/studio', label: 'Cards', on: sub === '' || sub.startsWith('card') || sub === 'new' },
      { to: '/studio/import', label: 'Import', on: sub === 'import' },
      { to: '/studio/export', label: 'Export', on: sub === 'export' },
    ] : []),
    ...(isManager ? [{ to: '/studio/staff', label: 'Staff', on: sub === 'staff' }] : []),
    ...(access.admin ? [
      { to: '/studio/menu', label: 'New on the menu', on: sub === 'menu' },
      { to: '/studio/people', label: 'People', on: sub === 'people' },
      { to: '/studio/settings', label: 'Settings', on: sub === 'settings' },
    ] : []),
  ];

  let page;
  if (!hasAccess) {
    page = (
      <div className="narrow">
        <h2>Not set up yet</h2>
        <p>You're signed in as {session.user.email}, but you don't have a studio role yet. Ask David to add you.</p>
      </div>
    );
  } else if (sub.startsWith('dashboard') && isManager) page = <Dashboard access={access} path={path} />;
  else if (sub === 'staff' && isManager) page = <Staff />;
  else if (sub === 'menu' && access.admin) page = <MenuSets ctx={ctx} />;
  else if (!isContent && sub === '') page = <Dashboard access={access} path="/studio/dashboard" />;
  else if (sub === '') page = <CardList ctx={ctx} path={path} />;
  else if (sub === 'new') page = <CardEditor ctx={ctx} id={null} path={path} key="new" />;
  else if (sub.startsWith('card/')) {
    const id = decodeURIComponent(sub.slice(5));
    page = <CardEditor ctx={ctx} id={id} path={path} key={id} />;
  }
  else if (sub === 'import') page = <ImportCards ctx={ctx} />;
  else if (sub === 'export') page = <ExportCards ctx={ctx} />;
  else if (sub === 'people' && access.admin) page = <People ctx={ctx} />;
  else if (sub === 'settings' && access.admin) page = <Settings />;
  else page = <div className="narrow"><p>Page not found.</p><a {...linkProps('/studio')}>Back to cards</a></div>;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="stripes" />
      <header className="studio-head">
        <a className="brand" style={{ textDecoration: 'none' }} {...linkProps('/studio')}>Content studio</a>
        {hasAccess && <nav aria-label="Studio">{nav.map((n) => <a key={n.to} className={n.on ? 'on' : ''} {...linkProps(n.to)}>{n.label}</a>)}</nav>}
        <div className="who">
          <span>{access.display_name ?? session.user.email}</span>
          <button className="text small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main style={{ flex: 1 }}>{page}</main>
      <About />
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="stripes tall" />
      <main style={{ flex: 1 }}>{children}</main>
      <About />
    </div>
  );
}

export function About() {
  return (
    <footer className="about">
      Maison Academy. Copyright © 2026 Creneau Hospitality. All rights reserved. Proprietary and confidential.<br />
      Concept and foundational design: Gerard McCormick, Head of Culinary, Creneau Hospitality, October 2026. Build lead: David, Operations Manager.
    </footer>
  );
}
