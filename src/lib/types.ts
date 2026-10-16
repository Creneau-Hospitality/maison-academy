export type CardType = 'mcq' | 'multi' | 'order' | 'image' | 'scenario';
export type Status = 'draft' | 'review' | 'live' | 'retired';

export interface Card {
  id: string;
  track_id: string;
  unit_id: string;
  level: number;
  roles: string[];
  type: CardType;
  prompt: string;
  media: string | null;
  options: string[];
  answer: string[];
  explanation: string;
  why_it_matters: string;
  is_allergen: boolean;
  source_ref: string;
  review_note: string | null;
  status: Status;
  reviewed_by: string | null;
  reviewed_at: string | null;
  allergen_check_by: string | null;
  allergen_checked_at: string | null;
  version: number;
  updated_at?: string;
  updated_by?: string | null;
}

export interface Track { id: string; name: string; sort: number }
export interface Unit { id: string; track_id: string; name: string; sort: number }

export interface CardVersion {
  card_id: string;
  version: number;
  snapshot: Card;
  saved_by: string | null;
  saved_at: string;
}

export interface Access {
  display_name: string | null;
  admin: boolean;
  allergen_checker: boolean;
  reviewer_tracks: string[];
}

export const CARD_TYPES: { id: CardType; label: string }[] = [
  { id: 'mcq', label: 'One right answer' },
  { id: 'multi', label: 'Pick all that apply' },
  { id: 'order', label: 'Put in order' },
  { id: 'image', label: 'Photo question' },
  { id: 'scenario', label: 'Table situation' },
];

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'review', label: 'In review' },
  { id: 'live', label: 'Live' },
  { id: 'retired', label: 'Retired' },
];

export const ROLES = ['host', 'server', 'runner', 'bar', 'barista'];

export const CONTENT_FIELDS = [
  'track_id', 'unit_id', 'level', 'roles', 'type', 'prompt', 'media', 'options', 'answer',
  'explanation', 'why_it_matters', 'is_allergen', 'source_ref',
] as const;

export const typeLabel = (t: string) => CARD_TYPES.find((x) => x.id === t)?.label ?? t;
export const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;

export function blankCard(track_id = 'service', unit_id = ''): Card {
  return {
    id: '', track_id, unit_id, level: 1, roles: [...ROLES], type: 'mcq', prompt: '', media: null,
    options: ['', '', ''], answer: [], explanation: '', why_it_matters: '', is_allergen: false,
    source_ref: '', review_note: null, status: 'review', reviewed_by: null, reviewed_at: null,
    allergen_check_by: null, allergen_checked_at: null, version: 1,
  };
}

export function sameContent(a: Partial<Card>, b: Partial<Card>): boolean {
  return CONTENT_FIELDS.every((f) => JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Dubai',
  });
}
