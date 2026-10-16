import type { Card, CardType, Status } from './types';

/** Parse CSV text (RFC 4180: quotes, commas and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export const CSV_HEADER = [
  'id', 'track', 'unit', 'level', 'roles', 'type', 'prompt', 'options', 'answer', 'explanation',
  'why_it_matters', 'is_allergen', 'source_ref', 'status', 'reviewed_by', 'reviewed_at',
  'allergen_check_by', 'review_note', 'version',
];

export function cardsToCsv(cards: Card[]): string {
  return toCsv(CSV_HEADER, cards.map((c) => [
    c.id, c.track_id, c.unit_id, c.level, c.roles.join('|'), c.type, c.prompt, c.options.join('|'),
    c.answer.join('|'), c.explanation, c.why_it_matters, c.is_allergen ? 'True' : 'False', c.source_ref,
    c.status, c.reviewed_by ?? '', c.reviewed_at ?? '', c.allergen_check_by ?? '', c.review_note ?? '', c.version,
  ]));
}

const split = (s: string | undefined, sep: RegExp = /\s*\|\s*/) =>
  (s ?? '').split(sep).map((x) => x.trim()).filter(Boolean);
const truthy = (s: unknown) => /^(true|yes|y|1)$/i.test(String(s ?? '').trim());

/**
 * Turn an imported row into a card. Accepts the brief's JSON schema
 * (track, unit) and the database's names (track_id, unit_id), plus the CSV
 * layouts used for export and for review.
 */
export function normaliseCard(raw: Record<string, unknown>): Card {
  const g = (...keys: string[]) => {
    for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') return raw[k];
    return undefined;
  };
  const list = (v: unknown, sep?: RegExp) => (Array.isArray(v) ? v.map((x) => String(x).trim()) : split(v as string, sep));
  const answerRaw = g('answer', 'right answer');
  return {
    id: String(g('id') ?? '').trim(),
    track_id: String(g('track_id', 'track') ?? '').trim(),
    unit_id: String(g('unit_id', 'unit') ?? '').trim(),
    level: Number(g('level') ?? 1),
    roles: list(g('roles'), /\s*[|,]\s*/),
    type: String(g('type') ?? 'mcq').trim() as CardType,
    prompt: String(g('prompt') ?? '').trim(),
    media: (g('media') as string) ?? null,
    options: list(g('options')),
    answer: list(answerRaw, /\s*(?:\||→)\s*/),
    explanation: String(g('explanation') ?? '').trim(),
    why_it_matters: String(g('why_it_matters', 'why it matters') ?? '').trim(),
    is_allergen: truthy(g('is_allergen', 'allergen card')),
    source_ref: String(g('source_ref', 'source') ?? '').trim(),
    review_note: (g('review_note', 'note for reviewer') as string) ?? null,
    status: (String(g('status') ?? 'review').trim() as Status),
    reviewed_by: null, reviewed_at: null, allergen_check_by: null, allergen_checked_at: null,
    version: 1,
  };
}

export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const humanise = (id: string) =>
  id.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
