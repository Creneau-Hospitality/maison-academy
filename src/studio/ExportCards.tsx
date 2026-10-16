import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { cardsToCsv, download } from '../lib/csv';
import type { StudioData } from './Studio';

// Export the full card bank: every status and every version, plus settings.
// No personal data: cards, versions and settings only (brief section 13).
export default function ExportCards({ ctx }: { ctx: StudioData }) {
  const { cards } = ctx;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

  const fetchAll = async () => {
    const versions: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('card_versions')
        .select('card_id, version, snapshot, saved_by, saved_at').order('card_id').order('version').range(from, from + 999);
      if (error) throw error;
      versions.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const { data: settings, error } = await supabase.from('settings').select('key, value, note').order('key');
    if (error) throw error;
    return { versions, settings: settings ?? [] };
  };

  const run = async (what: 'json' | 'csv' | 'settings') => {
    setBusy(true); setMsg('');
    try {
      if (what === 'csv') {
        download(`maison-academy-cards-${today}.csv`, cardsToCsv(cards), 'text/csv;charset=utf-8');
      } else {
        const { versions, settings } = await fetchAll();
        if (what === 'json') {
          download(`maison-academy-cards-${today}.json`, JSON.stringify({
            exported_at: new Date().toISOString(), count: cards.length, cards, card_versions: versions,
          }, null, 2), 'application/json');
        } else {
          download(`maison-academy-settings-${today}.json`, JSON.stringify({
            exported_at: new Date().toISOString(),
            settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
          }, null, 2), 'application/json');
        }
      }
      await supabase.rpc('log_event', { p_action: 'cards_exported', p_detail: { format: what, cards: cards.length } });
      setMsg('Downloaded.');
    } catch (e) {
      setMsg("Couldn't export: " + (e as Error).message);
    }
    setBusy(false);
  };

  const by = (s: string) => cards.filter((c) => c.status === s).length;
  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <p className="label">Export</p>
      <h1>Export the card bank</h1>
      <p>The card bank is the company's main asset and must never live only in the database. Export it at the end of each phase, and monthly during the pilot, then keep the files in the project folder.</p>
      <p className="info">{cards.length} cards: {by('live')} live, {by('review')} in review, {by('draft')} draft, {by('retired')} retired. No staff names or scores are included.</p>
      <div className="panel">
        <h3>Full backup (JSON)</h3>
        <p>Every card in every status, with every saved version. Use this to restore.</p>
        <button disabled={busy} onClick={() => run('json')}>Download cards and versions</button>
      </div>
      <div className="panel">
        <h3>Spreadsheet (CSV)</h3>
        <p>The current version of every card. Opens in Excel; can be edited and imported back.</p>
        <button className="outline" disabled={busy} onClick={() => run('csv')}>Download CSV</button>
      </div>
      <div className="panel">
        <h3>Settings (JSON)</h3>
        <p>The learning-engine settings, such as review gaps and targets.</p>
        <button className="outline" disabled={busy} onClick={() => run('settings')}>Download settings</button>
      </div>
      {msg && <p className="note sky" style={{ marginTop: 16 }}>{msg}</p>}
    </div>
  );
}
