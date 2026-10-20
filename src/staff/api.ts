// Staff app: talking to the server, and keeping answers safe on low signal.
// Copyright © 2026 Creneau Hospitality. All rights reserved.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://dxipjlkledacoabdhrdg.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_xCA8XR-Vyh4fF7d2fjbsHw_kKfyrbbS';

// Staff sessions are kept apart from the studio's (a manager may use both on one phone).
export const staffDb = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ma-staff-auth' },
});

export const PRIVACY_VERSION = 'draft-2026-10-20';

export type Confidence = 'sure' | 'think' | 'guess';
export interface StaffCard {
  id: string; track: string; track_id: string; unit: string;
  type: 'mcq' | 'multi' | 'order' | 'image' | 'scenario';
  prompt: string; media: string | null; options: string[]; answer: string[];
  explanation: string; why_it_matters: string; is_allergen: boolean; version: number;
}
export interface PracticeSet {
  set: { id: string; kind: 'daily' | 'readiness'; local_date: string; finished: boolean } | null;
  cards: StaffCard[];
  answered: { card_id: string; correct: boolean }[];
}
export interface Rhythm { target: number; this_week: number; streak: number; met: boolean; week_start: string }
export interface Team { venue: string; met: number; people: number; pct: number; goal_pct: number }
export interface HomeData {
  first_name: string; role: string; level: number; level_name: string; next_level_name: string | null;
  level1_pct: number; today: string; test: { offset: number } | null;
  set_today: { id: string; finished: boolean; total: number; answered: number } | null;
  cards_available: boolean; misses: number; rhythm: Rhythm; team: Team;
}
export interface SetResult {
  kind: 'daily' | 'readiness'; learned: number; strengthened: number; practised: number;
  passed: boolean | null; practise: { track: string; unit: string; cards: number }[] | null;
  level: number; level_name: string; level_up: boolean; rhythm: Rhythm; team: Team;
}

// --- Safe local storage (private mode can refuse it) -------------------------
export const store = {
  get<T>(k: string, fallback: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};

// --- Login --------------------------------------------------------------------
export class AuthProblem extends Error { field?: string; constructor(m: string, field?: string) { super(m); this.field = field; } }

async function callAuth(body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/staff-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthProblem('No connection. Check your signal or Wi-Fi and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthProblem(data.error || 'Something didn’t work. Please try again.', data.field);
  if (data.session) {
    const { error } = await staffDb.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    if (error) throw new AuthProblem('Signed in, but this phone could not save it. Please try again.');
  }
  return data;
}

export const checkCode = (code: string) => callAuth({ action: 'check_code', code });
export const activate = (code: string, pin: string) =>
  callAuth({ action: 'activate', code, pin, privacy_version: PRIVACY_VERSION });
export async function login(staffNumber: string, pin: string) {
  const r = await callAuth({ action: 'login', staff_number: staffNumber, pin });
  store.set('ma-staff-number', staffNumber.trim().toUpperCase());
  return r;
}
export async function signOut() {
  store.del('ma-set'); store.del('ma-home');
  await staffDb.auth.signOut({ scope: 'local' });
}

// --- Server calls -------------------------------------------------------------
export class NeedLogin extends Error {}
export class Offline extends Error {}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Offline('offline');
  const { data, error } = await staffDb.rpc(fn, args);
  if (error) {
    if (/not_staff|login_expired|JWT|not authenticated|permission denied/i.test(error.message)) throw new NeedLogin(error.message);
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) throw new Offline(error.message);
    throw new Error(error.message);
  }
  return data as T;
}

// --- Grading on the phone (the server grades again; this is for instant feedback offline)
export function isRight(card: StaffCard, chosen: string[]): boolean {
  if (card.type === 'order') return JSON.stringify(chosen) === JSON.stringify(card.answer);
  const a = [...chosen].sort(); const b = [...card.answer].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// --- The answer queue ---------------------------------------------------------
type QueueItem =
  | { kind: 'answer'; client_event_id: string; set_id: string; card_id: string; chosen: string[]; confidence: Confidence; answered_at: string }
  | { kind: 'finish'; set_id: string };

const Q = 'ma-queue';
export const queued = () => store.get<QueueItem[]>(Q, []);
export function enqueue(item: QueueItem) { store.set(Q, [...queued(), item]); }

let flushing: Promise<{ sent: number; left: number; results: Record<string, SetResult> }> | null = null;
/** Send queued answers in order. Safe to call often: each answer has its own id, so repeats count once. */
export function flush() {
  if (!flushing) {
    flushing = (async () => {
      let sent = 0; const results: Record<string, SetResult> = {};
      for (;;) {
        const [item] = queued();
        if (!item) break;
        try {
          if (item.kind === 'answer') {
            await rpc('record_answer', {
              p_client_event_id: item.client_event_id, p_set_id: item.set_id, p_card_id: item.card_id,
              p_chosen: item.chosen, p_confidence: item.confidence, p_answered_at: item.answered_at,
            });
          } else {
            results[item.set_id] = await rpc<SetResult>('finish_set', { p_set_id: item.set_id });
          }
        } catch (e) {
          if (e instanceof Offline || e instanceof NeedLogin) break;
          // The server refused this item (for example a set from a reset test account): drop it.
          console.warn('Dropped a queued item:', (e as Error).message);
        }
        store.set(Q, queued().slice(1));
        sent++;
      }
      return { sent, left: queued().length, results };
    })().finally(() => { flushing = null; });
  }
  return flushing;
}

export function newEventId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
