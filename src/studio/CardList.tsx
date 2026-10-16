import { useMemo, useState } from 'react';
import { linkProps, navigate } from '../lib/router';
import { STATUSES, CARD_TYPES, statusLabel, typeLabel, type Card } from '../lib/types';
import type { StudioData } from './Studio';

export interface Filters {
  q: string; track: string; unit: string; status: string; level: string; type: string; allergen: string;
}

export function readFilters(path: string): Filters {
  const p = new URLSearchParams(path.split('?')[1] ?? '');
  return {
    q: p.get('q') ?? '', track: p.get('track') ?? '', unit: p.get('unit') ?? '', status: p.get('status') ?? '',
    level: p.get('level') ?? '', type: p.get('type') ?? '', allergen: p.get('allergen') ?? '',
  };
}

export function filterQuery(f: Filters): string {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
}

export function applyFilters(cards: Card[], f: Filters): Card[] {
  const q = f.q.trim().toLowerCase();
  return cards.filter((c) =>
    (!f.track || c.track_id === f.track) &&
    (!f.unit || c.unit_id === f.unit) &&
    (!f.status || c.status === f.status) &&
    (!f.level || String(c.level) === f.level) &&
    (!f.type || c.type === f.type) &&
    (!f.allergen || (f.allergen === 'yes' ? c.is_allergen : !c.is_allergen)) &&
    (!q || [c.id, c.prompt, c.explanation, c.source_ref, ...c.options].join(' ').toLowerCase().includes(q)));
}

export default function CardList({ ctx, path }: { ctx: StudioData; path: string }) {
  const { cards, tracks, units, access } = ctx;
  const f = readFilters(path);
  const [q, setQ] = useState(f.q);
  const set = (patch: Partial<Filters>) => navigate('/studio' + filterQuery({ ...f, ...patch }));
  const shown = useMemo(() => applyFilters(cards, f), [cards, path]); // eslint-disable-line
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? id;
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? id;

  const count = (track: string | null, status: string | null, extra?: (c: Card) => boolean) =>
    cards.filter((c) => (!track || c.track_id === track) && (!status || c.status === status) && (!extra || extra(c))).length;

  const waitingKitchen = cards.filter((c) => c.is_allergen && c.status !== 'live' && c.status !== 'retired' && !c.allergen_check_by).length;
  const lvl1Live = count(null, 'live', (c) => c.level === 1);
  const canAdd = access.admin || access.reviewer_tracks.length > 0;

  return (
    <div className="wrap">
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ flex: '3 1 300px' }}>
          <p className="label">Card bank</p>
          <h1 style={{ margin: 0 }}>{cards.length} cards</h1>
        </div>
        {canAdd && <div style={{ flex: '0 0 auto' }}><a className="btn" {...linkProps('/studio/new')}>New card</a></div>}
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <p className="note sky" style={{ margin: 0 }}>
          <strong>{lvl1Live}</strong> Level 1 cards live. The pilot needs about 100 to 150.
        </p>
        {waitingKitchen > 0 && (
          <p className="note cream" style={{ margin: 0 }}>
            <strong>{waitingKitchen}</strong> allergen cards are waiting for the kitchen check, hidden from staff until then.{' '}
            <button className="cell" onClick={() => set({ allergen: 'yes', status: 'review', track: '', unit: '' })}>Show them</button>
          </p>
        )}
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Track</th>
              {STATUSES.map((s) => <th key={s.id} className="num">{s.label}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id}>
                <td><button className="cell" onClick={() => set({ track: t.id, unit: '', status: '' })}>{t.name}</button></td>
                {STATUSES.map((s) => {
                  const n = count(t.id, s.id);
                  return <td key={s.id} className="num">{n ? <button className="cell" onClick={() => set({ track: t.id, unit: '', status: s.id })}>{n}</button> : <span className="muted">0</span>}</td>;
                })}
                <td className="num">{count(t.id, null)}</td>
              </tr>
            ))}
            <tr>
              <th>All</th>
              {STATUSES.map((s) => <th key={s.id} className="num">{count(null, s.id)}</th>)}
              <th className="num">{cards.length}</th>
            </tr>
          </tbody>
        </table>
      </div>

      <form className="filters" onSubmit={(e) => { e.preventDefault(); set({ q }); }}>
        <div className="search row" style={{ gap: 8 }}>
          <input type="search" placeholder="Search questions, options, sources or IDs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ flex: '1 1 240px' }} />
          <button type="submit" className="outline" style={{ flex: '0 0 auto' }}>Search</button>
        </div>
        <select aria-label="Track" value={f.track} onChange={(e) => set({ track: e.target.value, unit: '' })}>
          <option value="">All tracks</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })}>
          <option value="">All units</option>
          {units.filter((u) => !f.track || u.track_id === f.track).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Level" value={f.level} onChange={(e) => set({ level: e.target.value })}>
          <option value="">Any level</option>
          {[1, 2, 3].map((l) => <option key={l} value={l}>Level {l}</option>)}
        </select>
        <select aria-label="Card type" value={f.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Any type</option>
          {CARD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select aria-label="Allergen" value={f.allergen} onChange={(e) => set({ allergen: e.target.value })}>
          <option value="">Allergen or not</option>
          <option value="yes">Allergen cards</option>
          <option value="no">Not allergen</option>
        </select>
      </form>

      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <p className="label" style={{ margin: 0 }}>Showing {shown.length} of {cards.length}</p>
        {Object.values(f).some(Boolean) && (
          <div style={{ flex: '0 0 auto' }}><button className="text small" onClick={() => { setQ(''); navigate('/studio'); }}>Clear filters</button></div>
        )}
      </div>

      <div>
        {shown.map((c) => (
          <a key={c.id} className="card-row" style={{ textDecoration: 'none' }} {...linkProps(`/studio/card/${encodeURIComponent(c.id)}${filterQuery(f)}`)}>
            <span className="prompt">{c.prompt}</span>
            <span className="tags">
              {c.is_allergen && <span className="tag allergen">Allergen</span>}
              <span className={'tag ' + c.status}>{statusLabel(c.status)}</span>
            </span>
            <span className="meta">
              {c.id} · {trackName(c.track_id)} · {unitName(c.unit_id)} · Level {c.level} · {typeLabel(c.type)}
              {c.is_allergen && c.status !== 'live' && (c.allergen_check_by ? ` · Kitchen check: ${c.allergen_check_by}` : ' · Waiting for kitchen check')}
            </span>
          </a>
        ))}
        {shown.length === 0 && <p className="note cream">No cards match these filters.</p>}
      </div>
    </div>
  );
}
