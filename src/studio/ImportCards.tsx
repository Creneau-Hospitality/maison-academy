import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { csvToObjects, humanise, normaliseCard } from '../lib/csv';
import { checkCard } from '../lib/validate';
import { CONTENT_FIELDS, sameContent, type Card } from '../lib/types';
import type { StudioData } from './Studio';

type Row = { card: Card; kind: 'new' | 'changed' | 'same' | 'problem'; problems: string[] };

export default function ImportCards({ ctx }: { ctx: StudioData }) {
  const { cards, tracks, units, access, reload } = ctx;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);

  const read = async (file: File) => {
    setResult(null); setRows(null); setFileName(file.name);
    const text = await file.text();
    let raws: Record<string, unknown>[] = [];
    try {
      if (/\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const j = JSON.parse(text);
        raws = Array.isArray(j) ? j : Array.isArray(j.cards) ? j.cards : [];
      } else raws = csvToObjects(text);
    } catch {
      setResult({ kind: 'blush', text: "Couldn't read that file. Use the JSON or CSV layout from Export." });
      return;
    }
    if (!raws.length) { setResult({ kind: 'blush', text: 'No cards found in that file.' }); return; }
    const seen = new Set<string>();
    setRows(raws.map((raw) => {
      const card = normaliseCard(raw);
      const problems = [...checkCard(card).errors];
      if (!tracks.some((t) => t.id === card.track_id)) problems.push(`Unknown track "${card.track_id}".`);
      else if (!access.admin && !access.reviewer_tracks.includes(card.track_id)) problems.push("Not one of your tracks.");
      if (seen.has(card.id)) problems.push('This ID appears twice in the file.');
      seen.add(card.id);
      const existing = cards.find((c) => c.id === card.id);
      if (problems.length) return { card, kind: 'problem', problems };
      if (!existing) return { card, kind: 'new', problems };
      return { card, kind: sameContent(card, existing) ? 'same' : 'changed', problems };
    }));
  };

  const count = (k: Row['kind']) => rows?.filter((r) => r.kind === k).length ?? 0;

  const run = async () => {
    if (!rows) return;
    setBusy(true); setResult(null);
    const todo = rows.filter((r) => r.kind === 'new' || r.kind === 'changed');
    // Units the file mentions that don't exist yet.
    const newUnits = [...new Map(todo.filter((r) => !units.some((u) => u.id === r.card.unit_id))
      .map((r) => [r.card.unit_id, { id: r.card.unit_id, track_id: r.card.track_id, name: humanise(r.card.unit_id), sort: 99 }])).values()];
    if (newUnits.length) {
      const { error } = await supabase.from('units').insert(newUnits);
      if (error) { setBusy(false); setResult({ kind: 'blush', text: 'Units not created: ' + error.message }); return; }
    }
    const body = (c: Card) => {
      const b: Record<string, unknown> = { review_note: c.review_note };
      CONTENT_FIELDS.forEach((k) => { b[k] = c[k]; });
      return b;
    };
    const fresh = todo.filter((r) => r.kind === 'new').map((r) => ({ ...body(r.card), id: r.card.id, status: 'review' }));
    let added = 0, updated = 0;
    const issues: string[] = [];
    for (let i = 0; i < fresh.length; i += 100) {
      const { error } = await supabase.from('cards').insert(fresh.slice(i, i + 100));
      if (error) issues.push(error.message); else added += Math.min(100, fresh.length - i);
    }
    for (const r of todo.filter((x) => x.kind === 'changed')) {
      const { error } = await supabase.from('cards').update(body(r.card)).eq('id', r.card.id);
      if (error) issues.push(`${r.card.id}: ${error.message}`); else updated++;
    }
    await supabase.rpc('log_event', { p_action: 'cards_imported', p_detail: { file: fileName, added, updated, units_created: newUnits.length } });
    await reload();
    setBusy(false);
    setRows(null);
    setResult(issues.length
      ? { kind: 'blush', text: `Added ${added}, updated ${updated}. Some cards weren't saved: ${issues.slice(0, 3).join('; ')}` }
      : { kind: 'sky', text: `Done. Added ${added} new cards and updated ${updated}. All are in review, waiting for approval.` });
  };

  return (
    <div className="wrap" style={{ maxWidth: 860 }}>
      <p className="label">Import</p>
      <h1>Import cards</h1>
      <p>Bring in drafted cards from a JSON or CSV file. Every imported card arrives <strong>in review</strong>: nothing goes live until someone approves it here.</p>
      <ul className="info">
        <li>Use the same layout as Export (JSON, or CSV with options separated by "|").</li>
        <li>A card whose ID already exists is updated as a new version and goes back to review. Its history is kept.</li>
        <li>Units that don't exist yet are created.</li>
      </ul>
      <div className="panel" style={{ marginTop: 16 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Choose a file</span>
          <input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        </label>
      </div>
      {result && <p className={'note ' + result.kind} style={{ marginTop: 16 }}>{result.text}</p>}
      {rows && (
        <div className="panel">
          <h3>{fileName}</h3>
          <p>{rows.length} cards read: <strong>{count('new')}</strong> new, <strong>{count('changed')}</strong> changed, {count('same')} unchanged{count('problem') ? <>, <strong>{count('problem')}</strong> to fix</> : null}.</p>
          {count('problem') > 0 && (
            <div className="note blush">
              <strong>These won't be imported until fixed in the file:</strong>
              <ul>{rows.filter((r) => r.kind === 'problem').slice(0, 20).map((r, i) => <li key={i}>{r.card.id || '(no ID)'}: {r.problems.join(' ')}</li>)}</ul>
            </div>
          )}
          {count('changed') > 0 && (
            <div className="note cream">
              <strong>Changed cards</strong> (each becomes a new version, back in review):
              <ul>{rows.filter((r) => r.kind === 'changed').slice(0, 20).map((r) => <li key={r.card.id}>{r.card.id}</li>)}</ul>
            </div>
          )}
          <div className="actions">
            <button disabled={busy || count('new') + count('changed') === 0} onClick={run}>
              {busy ? 'Importing…' : `Import ${count('new') + count('changed')} cards`}
            </button>
            <button className="text" onClick={() => setRows(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
