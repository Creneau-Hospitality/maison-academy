import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { linkProps, navigate } from '../lib/router';
import {
  blankCard, CARD_TYPES, CONTENT_FIELDS, fmtDate, ROLES, sameContent, shuffled, statusLabel,
  type Card, type CardType, type CardVersion,
} from '../lib/types';
import { canGoLive, checkCard } from '../lib/validate';
import { humanise } from '../lib/csv';
import { applyFilters, readFilters, filterQuery } from './CardList';
import type { StudioData } from './Studio';

const shuffle = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 1 && a.every((x, i) => x === xs[i])) a.push(a.shift()!);
  return a;
};

export default function CardEditor({ ctx, id, path }: { ctx: StudioData; id: string | null; path: string }) {
  const { cards, tracks, units, access, reload } = ctx;
  const saved = id ? cards.find((c) => c.id === id) ?? null : null;
  const f = readFilters(path);
  const qs = filterQuery(f);

  const [card, setCard] = useState<Card>(() => saved ? structuredClone(saved) : blankCard(f.track || 'service', f.unit || ''));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush' | 'cream'; text: string } | null>(null);
  const [versions, setVersions] = useState<CardVersion[]>([]);
  const [newUnit, setNewUnit] = useState('');
  const [sendBackNote, setSendBackNote] = useState('');

  useEffect(() => { if (saved) setCard(structuredClone(saved)); }, [saved?.updated_at]); // eslint-disable-line

  useEffect(() => {
    if (!id) return;
    supabase.from('card_versions').select('*').eq('card_id', id).order('version', { ascending: false })
      .then(({ data }) => setVersions((data ?? []) as CardVersion[]));
  }, [id, saved?.updated_at]);

  // Before/next in the filtered list, for reviewing one after another.
  const list = useMemo(() => applyFilters(cards, f), [cards, path]); // eslint-disable-line
  const idx = id ? list.findIndex((c) => c.id === id) : -1;
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const go = (c: Card | null) => c && navigate(`/studio/card/${encodeURIComponent(c.id)}${qs}`);

  if (id && !saved) {
    return <div className="narrow"><p className="note blush">There's no card with the ID {id}.</p><a {...linkProps('/studio' + qs)}>Back to cards</a></div>;
  }

  const isNew = !saved;
  const canEdit = access.admin || access.reviewer_tracks.includes(card.track_id);
  const dirty = isNew || !sameContent(card, saved!) || (card.review_note ?? '') !== (saved!.review_note ?? '');
  const check = checkCard(card);
  const liveBlockers = canGoLive(card);
  const trackUnits = units.filter((u) => u.track_id === card.track_id);
  const editableTracks = tracks.filter((t) => access.admin || access.reviewer_tracks.includes(t.id));

  const up = (patch: Partial<Card>) => { setCard((c) => ({ ...c, ...patch })); setMsg(null); };

  // ----- options and answers -----
  const isOrder = card.type === 'order';
  const setType = (type: CardType) => {
    if (type === 'order') {
      const steps = card.options.filter(Boolean);
      up({ type, answer: steps, options: shuffle(steps) });
    } else if (card.type === 'order') {
      up({ type, options: [...card.answer], answer: [] });
    } else if (type !== 'multi' && card.answer.length > 1) {
      up({ type, answer: card.answer.slice(0, 1) });
    } else up({ type });
  };
  // Ordinary cards: edit options; answers follow the text.
  const setOption = (i: number, text: string) => {
    const old = card.options[i];
    const options = card.options.map((o, j) => (j === i ? text : o));
    const answer = card.answer.map((a) => (a === old ? text : a));
    up({ options, answer });
  };
  const toggleRight = (o: string) => {
    if (!o.trim()) return;
    if (card.type === 'multi') up({ answer: card.answer.includes(o) ? card.answer.filter((a) => a !== o) : [...card.answer, o] });
    else up({ answer: [o] });
  };
  const removeOption = (i: number) => {
    const o = card.options[i];
    up({ options: card.options.filter((_, j) => j !== i), answer: card.answer.filter((a) => a !== o) });
  };
  const moveOption = (i: number, d: number) => {
    const a = [...card.options]; const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; up({ options: a });
  };
  // Order cards: edit the steps in the right order; staff see them shuffled.
  const setSteps = (steps: string[], reshuffle = false) => {
    const sameSet = steps.length === card.options.length && steps.every((s) => card.options.includes(s));
    up({ answer: steps, options: sameSet && !reshuffle ? card.options : shuffle(steps) });
  };
  const setStep = (i: number, text: string) => {
    const old = card.answer[i];
    up({ answer: card.answer.map((s, j) => (j === i ? text : s)), options: card.options.map((o) => (o === old ? text : o)) });
  };
  const moveStep = (i: number, d: number) => {
    const a = [...card.answer]; const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; up({ answer: a });
  };

  // ----- saving and status -----
  const finish = async (text: string, kind: 'sky' | 'cream' = 'sky') => {
    await reload();
    setMsg({ kind, text });
  };
  const notSaved = (e: { message: string }) => setMsg({ kind: 'blush', text: 'Not saved: ' + e.message });

  const ensureUnit = async (): Promise<boolean> => {
    if (units.some((u) => u.id === card.unit_id)) return true;
    const { error } = await supabase.from('units').insert({ id: card.unit_id, track_id: card.track_id, name: humanise(card.unit_id), sort: 99 });
    if (error) { notSaved(error); return false; }
    return true;
  };

  const save = async () => {
    if (check.errors.length) { setMsg({ kind: 'blush', text: 'Fix the points in the list first.' }); return; }
    setBusy(true);
    if (!(await ensureUnit())) { setBusy(false); return; }
    const body: Record<string, unknown> = { review_note: card.review_note || null };
    CONTENT_FIELDS.forEach((k) => { body[k] = card[k]; });
    body.options = card.options.map((o) => o.trim());
    body.answer = card.answer.map((a) => a.trim());
    if (isNew) {
      if (cards.some((c) => c.id === card.id)) { setBusy(false); setMsg({ kind: 'blush', text: 'That card ID is already used.' }); return; }
      // Store new cards with their options shuffled, so the right answer isn't always first.
      if (card.type !== 'order') body.options = shuffled(body.options as string[]);
      const { error } = await supabase.from('cards').insert({ ...body, id: card.id, status: 'review' });
      setBusy(false);
      if (error) return notSaved(error);
      await reload();
      navigate(`/studio/card/${encodeURIComponent(card.id)}${qs}`);
      return;
    }
    const wasLive = saved!.status === 'live';
    const { error } = await supabase.from('cards').update(body).eq('id', card.id);
    setBusy(false);
    if (error) return notSaved(error);
    finish(wasLive && !sameContent(card, saved!) ? 'Saved as a new version. It was live, so it is back in review until approved again.' : 'Saved.');
  };

  const setStatus = async (status: Card['status'], extra: Record<string, unknown> = {}, note?: string) => {
    setBusy(true);
    const { error } = await supabase.from('cards').update({ status, ...extra }).eq('id', card.id);
    setBusy(false);
    if (error) return notSaved(error);
    finish(note ?? `Now ${statusLabel(status).toLowerCase()}.`);
  };
  const approve = async (andNext: boolean) => {
    setBusy(true);
    const { error } = await supabase.from('cards').update({ status: 'live' }).eq('id', card.id);
    setBusy(false);
    if (error) return notSaved(error);
    await reload();
    if (andNext && next) go(next); else setMsg({ kind: 'sky', text: 'Approved. The card is live.' });
  };
  const kitchenCheck = async () => {
    setBusy(true);
    const { error } = await supabase.from('cards').update({ allergen_check_by: access.display_name ?? 'checked' }).eq('id', card.id);
    setBusy(false);
    if (error) return notSaved(error);
    finish('Kitchen check recorded. The card can now be approved.');
  };
  const sendBack = () => setStatus('review', { review_note: sendBackNote.trim() || card.review_note }, 'Back in review.');

  return (
    <div className="wrap">
      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <div style={{ flex: '1 1 200px' }}><a className="label" {...linkProps('/studio' + qs)}>← All cards{list.length && idx >= 0 ? ` · ${idx + 1} of ${list.length}` : ''}</a></div>
        {!isNew && (
          <div className="actions" style={{ flex: '0 0 auto' }}>
            <button className="outline small" disabled={!prev} onClick={() => go(prev)}>Previous</button>
            <button className="outline small" disabled={!next} onClick={() => go(next)}>Next</button>
          </div>
        )}
      </div>
      <h1 style={{ fontSize: 28, wordBreak: 'break-word' }}>{isNew ? 'New card' : card.id}</h1>

      <div className="editor">
        <div>
          {!canEdit && !isNew && <p className="note cream">This card is in a track you don't review, so it's read-only for you.</p>}
          <fieldset disabled={!canEdit && !isNew} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
            <div className="panel">
              {isNew && (
                <label className="field">
                  <span className="label">Card ID</span>
                  <input value={card.id} onChange={(e) => up({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="food-breakfast-0014" />
                  <span className="info">Track, unit and a number, for example food-breakfast-0014. It can't be changed later.</span>
                </label>
              )}
              <div className="row">
                <label className="field">
                  <span className="label">Track</span>
                  <select value={card.track_id} onChange={(e) => up({ track_id: e.target.value, unit_id: '' })}>
                    {(isNew ? editableTracks : tracks).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="label">Unit</span>
                  <select value={trackUnits.some((u) => u.id === card.unit_id) ? card.unit_id : card.unit_id ? '__new' : ''}
                    onChange={(e) => e.target.value === '__new' ? up({ unit_id: newUnit || '' }) : up({ unit_id: e.target.value })}>
                    <option value="">Choose…</option>
                    {trackUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    <option value="__new">New unit…</option>
                  </select>
                </label>
                <label className="field" style={{ flex: '0 1 110px' }}>
                  <span className="label">Level</span>
                  <select value={card.level} onChange={(e) => up({ level: Number(e.target.value) })}>
                    {[1, 2, 3].map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
              </div>
              {card.unit_id !== '' && !trackUnits.some((u) => u.id === card.unit_id) || (card.unit_id === '' && newUnit) ? (
                <label className="field">
                  <span className="label">New unit ID</span>
                  <input value={card.unit_id || newUnit} placeholder="allergens-desserts"
                    onChange={(e) => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); setNewUnit(v); up({ unit_id: v }); }} />
                  <span className="info">Created when you save, named "{humanise(card.unit_id || newUnit || 'unit')}".</span>
                </label>
              ) : null}
              <div className="row">
                <label className="field">
                  <span className="label">Card type</span>
                  <select value={card.type} onChange={(e) => setType(e.target.value as CardType)}>
                    {CARD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="field">
                <span className="label">Roles</span>
                <div className="row" style={{ gap: '4px 16px' }}>
                  {ROLES.map((r) => (
                    <label key={r} className="check" style={{ flex: '0 0 auto' }}>
                      <input type="checkbox" checked={card.roles.includes(r)}
                        onChange={() => up({ roles: card.roles.includes(r) ? card.roles.filter((x) => x !== r) : [...card.roles, r] })} />
                      {humanise(r)}
                    </label>
                  ))}
                </div>
              </div>
              <label className="check" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={card.is_allergen} onChange={(e) => up({ is_allergen: e.target.checked })} />
                Allergen card (needs the kitchen check before it can go live)
              </label>
            </div>

            <div className="panel">
              <label className="field">
                <span className="label">Question <span className="wordcount">{card.prompt.trim().split(/\s+/).filter(Boolean).length} / 25 words</span></span>
                <textarea rows={2} value={card.prompt} onChange={(e) => up({ prompt: e.target.value })} />
              </label>
              {card.type === 'image' && (
                <label className="field">
                  <span className="label">Photo link</span>
                  <input value={card.media ?? ''} onChange={(e) => up({ media: e.target.value || null })} placeholder="https://…" />
                  <span className="info">Photo upload arrives with the photo cards. For now, paste a link.</span>
                </label>
              )}

              {!isOrder ? (
                <div className="field">
                  <span className="label">Options · tap ✓ for {card.type === 'multi' ? 'every right answer' : 'the right answer'}</span>
                  {card.options.map((o, i) => {
                    const right = o.trim() !== '' && card.answer.includes(o);
                    return (
                      <div className="opt" key={i}>
                        <button type="button" className={'mark ' + (right ? '' : 'outline')} aria-pressed={right}
                          aria-label={right ? 'Right answer' : 'Mark as right answer'} onClick={() => toggleRight(o)}>{right ? '✓' : ''}</button>
                        <input type="text" value={o} onChange={(e) => setOption(i, e.target.value)} aria-label={`Option ${i + 1}`} />
                        <button type="button" className="text small" onClick={() => moveOption(i, -1)} disabled={i === 0} aria-label="Move up">Up</button>
                        <button type="button" className="text small" onClick={() => removeOption(i)} aria-label="Remove option">Remove</button>
                      </div>
                    );
                  })}
                  {card.options.length < 6 && <button type="button" className="outline small" onClick={() => up({ options: [...card.options, ''] })}>Add option</button>}
                </div>
              ) : (
                <div className="field">
                  <span className="label">Steps, in the right order · staff see them shuffled</span>
                  {card.answer.map((s, i) => (
                    <div className="opt" key={i}>
                      <span className="mark label">{i + 1}</span>
                      <input type="text" value={s} onChange={(e) => setStep(i, e.target.value)} aria-label={`Step ${i + 1}`} />
                      <button type="button" className="text small" onClick={() => moveStep(i, -1)} disabled={i === 0}>Up</button>
                      <button type="button" className="text small" onClick={() => moveStep(i, 1)} disabled={i === card.answer.length - 1}>Down</button>
                      <button type="button" className="text small" onClick={() => setSteps(card.answer.filter((_, j) => j !== i))}>Remove</button>
                    </div>
                  ))}
                  <div className="actions">
                    {card.answer.length < 8 && <button type="button" className="outline small" onClick={() => setSteps([...card.answer, ''])}>Add step</button>}
                    <button type="button" className="text small" onClick={() => setSteps(card.answer, true)}>Shuffle again</button>
                  </div>
                </div>
              )}

              <label className="field">
                <span className="label">Explanation (one or two sentences)</span>
                <textarea rows={2} value={card.explanation} onChange={(e) => up({ explanation: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Why it matters on the floor (one sentence)</span>
                <textarea rows={2} value={card.why_it_matters} onChange={(e) => up({ why_it_matters: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Source (file and section)</span>
                <input value={card.source_ref} onChange={(e) => up({ source_ref: e.target.value })} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="label">Note for reviewers (not shown to staff)</span>
                <textarea rows={2} value={card.review_note ?? ''} onChange={(e) => up({ review_note: e.target.value })} />
              </label>
            </div>
          </fieldset>
        </div>

        <div className="sticky">
          <div className="panel">
            {!isNew && (
              <>
                <div className="tags" style={{ justifyContent: 'flex-start', marginBottom: 12 }}>
                  <span className={'tag ' + saved!.status}>{statusLabel(saved!.status)}</span>
                  {saved!.is_allergen && <span className="tag allergen">Allergen</span>}
                  <span className="tag">Version {saved!.version}</span>
                </div>
                <p className="info" style={{ margin: '0 0 12px' }}>
                  {saved!.reviewed_by ? <>{saved!.status === 'live' ? 'Approved' : 'Content approved'} by {saved!.reviewed_by}, {fmtDate(saved!.reviewed_at)}.<br /></> : null}
                  {saved!.is_allergen ? (saved!.allergen_check_by ? <>Kitchen check: {saved!.allergen_check_by}, {fmtDate(saved!.allergen_checked_at)}.<br /></> : <>Waiting for the kitchen check.<br /></>) : null}
                  {saved!.updated_at ? <>Last saved by {saved!.updated_by ?? 'unknown'}, {fmtDate(saved!.updated_at)}.</> : null}
                </p>
              </>
            )}

            {(check.errors.length > 0 || check.blockers.length > 0) && (
              <div className="note blush">
                <strong>{check.errors.length ? 'To fix before saving' : 'To fix before it can go live'}</strong>
                <ul>{[...check.errors, ...check.blockers].map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {check.warnings.length > 0 && (
              <div className="note cream"><strong>Worth a look</strong><ul>{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
            )}
            {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}

            {(canEdit || isNew) && (
              <div className="actions" style={{ marginBottom: 12 }}>
                <button onClick={save} disabled={busy || !dirty || check.errors.length > 0}>{isNew ? 'Save to review' : 'Save changes'}</button>
                {!isNew && dirty && <button className="text" onClick={() => { setCard(structuredClone(saved!)); setMsg(null); }}>Undo changes</button>}
              </div>
            )}
            {!isNew && dirty && saved!.status === 'live' && canEdit && (
              <p className="info">Saving changes to a live card makes a new version and puts it back in review.</p>
            )}

            {!isNew && canEdit && !dirty && (
              <>
                {saved!.is_allergen && !saved!.allergen_check_by && saved!.status !== 'retired' && (
                  access.allergen_checker
                    ? <div className="actions" style={{ marginBottom: 12 }}><button className="outline" disabled={busy} onClick={kitchenCheck}>Record kitchen check</button></div>
                    : <p className="info">The kitchen check is recorded by the head chef or Gerard, signed in with their own login.</p>
                )}
                {saved!.status !== 'live' && saved!.status !== 'retired' && (
                  <div className="actions" style={{ marginBottom: 12 }}>
                    <button disabled={busy || liveBlockers.length > 0} onClick={() => approve(false)}>Approve</button>
                    {next && <button className="outline" disabled={busy || liveBlockers.length > 0} onClick={() => approve(true)}>Approve and next</button>}
                  </div>
                )}
                {saved!.status !== 'live' && saved!.status !== 'retired' && liveBlockers.length > 0 && (
                  <p className="info">Can't go live yet: {liveBlockers.join(' ')}</p>
                )}
                {saved!.status === 'live' && (
                  <div className="field">
                    <input placeholder="Why it needs another look (optional)" value={sendBackNote} onChange={(e) => setSendBackNote(e.target.value)} aria-label="Note" style={{ marginBottom: 8 }} />
                    <button className="outline" disabled={busy} onClick={sendBack}>Send back to review</button>
                  </div>
                )}
                <div className="actions">
                  {saved!.status !== 'retired'
                    ? <button className="text" disabled={busy} onClick={() => setStatus('retired', {}, 'Retired. Staff no longer see this card.')}>Retire card</button>
                    : <button className="outline" disabled={busy} onClick={() => setStatus('review', {}, 'Restored to review.')}>Restore to review</button>}
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <h3>What staff see</h3>
            <Preview card={card} trackName={tracks.find((t) => t.id === card.track_id)?.name ?? ''} unitName={units.find((u) => u.id === card.unit_id)?.name ?? humanise(card.unit_id)} />
          </div>

          {versions.length > 0 && (
            <div className="panel">
              <h3>Version history</h3>
              <History versions={versions} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Preview({ card, trackName, unitName }: { card: Card; trackName: string; unitName: string }) {
  const [shown, setShown] = useState(false);
  // Staff see the options in a new random order every time, so the preview does too.
  const [round, setRound] = useState(0);
  const optionSet = card.options.filter((o) => o.trim()).join('\u0000');
  const opts = useMemo(() => shuffled(card.options.filter((o) => o.trim())), [optionSet, round]); // eslint-disable-line
  return (
    <div className="preview">
      <p className="label" style={{ margin: 0 }}>{trackName} · {unitName}</p>
      {card.type === 'image' && card.media && <img src={card.media} alt="" />}
      <p className="q">{card.prompt || 'Question'}</p>
      {card.type === 'multi' && <p className="info" style={{ marginTop: -8 }}>Pick all that apply.</p>}
      {card.type === 'order' && <p className="info" style={{ marginTop: -8 }}>Put these in order.</p>}
      {(shown && card.type === 'order' ? card.answer : opts).map((o, i) => (
        <div key={i} className={'o' + (shown && (card.type === 'order' || card.answer.includes(o)) ? ' right' : '')}>
          {shown && card.type === 'order' ? `${i + 1}. ` : ''}{o}
        </div>
      ))}
      {!shown ? (
        <div className="actions">
          <button className="outline small" onClick={() => setShown(true)}>Show the answer</button>
          <button className="text small" onClick={() => setRound((r) => r + 1)}>Shuffle again</button>
        </div>
      ) : (
        <div className="fb">
          <p style={{ margin: '0 0 6px' }}><strong>Got it.</strong> {card.explanation}</p>
          <p className="info" style={{ margin: '0 0 8px' }}>Why it matters: {card.why_it_matters}</p>
          <button className="text small" onClick={() => setShown(false)}>Hide</button>
        </div>
      )}
    </div>
  );
}

const FIELD_NAMES: Record<string, string> = {
  track_id: 'Track', unit_id: 'Unit', level: 'Level', roles: 'Roles', type: 'Type', prompt: 'Question',
  media: 'Photo', options: 'Options', answer: 'Right answer', explanation: 'Explanation',
  why_it_matters: 'Why it matters', is_allergen: 'Allergen card', source_ref: 'Source', status: 'Status',
};
const show = (v: unknown) => Array.isArray(v) ? v.join(' | ') : v === true ? 'Yes' : v === false ? 'No' : v == null ? '' : String(v);

function History({ versions }: { versions: CardVersion[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      {versions.map((v, i) => {
        const older = versions[i + 1]?.snapshot;
        const changed = older ? Object.keys(FIELD_NAMES).filter((k) => JSON.stringify((v.snapshot as never)[k]) !== JSON.stringify((older as never)[k])) : [];
        return (
          <div key={v.version} style={{ borderTop: i ? '1px solid var(--line)' : 'none', padding: '8px 0' }}>
            <button className="cell" onClick={() => setOpen(open === v.version ? null : v.version)}>
              Version {v.version}
            </button>{' '}
            <span className="info">· {statusLabel(v.snapshot.status)} · {v.saved_by ?? ''} · {fmtDate(v.saved_at)}</span>
            {open === v.version && (
              <dl className="diff">
                {older ? (changed.length ? changed.map((k) => (
                  <div key={k}><dt>{FIELD_NAMES[k]}</dt><dd><del>{show((older as never)[k])}</del><br /><ins>{show((v.snapshot as never)[k])}</ins></dd></div>
                )) : <dd className="info">No content changes from the version before.</dd>)
                  : <dd className="info">First version: {v.snapshot.prompt}</dd>}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
