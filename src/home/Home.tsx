import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { linkProps } from '../lib/router';

// Placeholder front page until the staff app arrives in Phase 2.
export default function Home() {
  const [db, setDb] = useState<'waiting' | 'ok' | 'not-yet'>('waiting');
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ error }) => setDb(error ? 'not-yet' : 'ok'))
      .catch(() => setDb('not-yet'));
  }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="stripes tall" />
      <main style={{ flex: 1, width: '100%', maxWidth: 560, margin: '0 auto', padding: '48px 16px 40px' }}>
        <p className="label">Maison Mathis · front of house</p>
        <h1 style={{ fontSize: 'clamp(40px, 12vw, 64px)' }}>Maison Academy</h1>
        <p>Five questions a shift. About three minutes. Learn the menu, the drinks and the way we look after our guests.</p>
        <p className="info">The staff app opens in the pilot. Content reviewers can sign in to the studio now.</p>
        <p style={{ marginTop: 24 }}><a className="btn outline" {...linkProps('/studio')}>Content studio</a></p>
        <div className="panel" style={{ marginTop: 32 }}>
          <h3>Database</h3>
          <p className={'note ' + (db === 'ok' ? 'sky' : db === 'not-yet' ? 'blush' : 'cream')} style={{ margin: 0 }}>
            {db === 'ok' ? 'Connected to Supabase (Frankfurt)' : db === 'not-yet' ? 'Not connected yet' : 'Checking…'}
          </p>
        </div>
      </main>
      <div className="houseline">Good food makes our house a home</div>
    </div>
  );
}
