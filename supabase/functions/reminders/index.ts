// Maison Academy · reminders: daily web-push reminders for staff.
// Copyright © 2026 Creneau Hospitality. All rights reserved.
//
//   GET                                   -> { public_key }   (made once, kept in the database)
//   POST { action: "run" }                -> sends the reminders that are due now
//   POST { action: "test" } + staff login -> sends a test reminder to a test account's own phone
//
// Who is due is decided by the database (svc_due_reminders): at most one a
// day per person, at or after the set time, not once today's set is done, and
// only until the weekly target is met. "run" is safe to call any number of
// times, so a scheduler can call it every 15 minutes without a secret.
//
// Web push is done with the platform's own crypto (RFC 8291 message
// encryption, RFC 8292 VAPID). The private key is created here and stored in
// a table only the server can read; it is never sent anywhere.
//
// Deploy with "Verify JWT" turned off (the scheduler calls it without a login).

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

function serverKey(modern: string, legacy: string): string {
  try {
    const j = JSON.parse(Deno.env.get(modern) ?? '');
    const v = j?.default ?? Object.values(j ?? {})[0];
    if (typeof v === 'string' && v) return v;
  } catch { /* not set */ }
  return Deno.env.get(legacy) ?? '';
}
const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = serverKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const SUBJECT = 'https://maison-academy.netlify.app';
const ALLOWED = [/^https:\/\/([a-z0-9-]+--)?maison-academy\.netlify\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

// ---- webpush:start (plain WebCrypto; also tested outside Deno) ----
const enc = new TextEncoder();
export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export async function makeVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64u(raw), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}

export async function vapidHeader(endpoint: string, publicKey: string, privateJwk: JsonWebKey): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + payload)));
  return 'vapid t=' + header + '.' + payload + '.' + b64u(sig) + ', k=' + publicKey;
}

// RFC 8291 (aes128gcm): encrypt a message for one browser subscription.
export async function encryptPayload(p256dh: string, authSecret: string, text: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, body);
}
// ---- webpush:end ----

async function keys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const { data } = await admin.rpc('svc_push_private_key');
  if (data?.public_key) return { publicKey: data.public_key, privateJwk: data.private_jwk };
  const made = await makeVapidKeys();
  await admin.rpc('svc_init_push_keys', { p_public: made.publicKey, p_private: made.privateJwk });
  const { data: again } = await admin.rpc('svc_push_private_key'); // whichever was stored first wins
  return { publicKey: again.public_key, privateJwk: again.private_jwk };
}

type Sub = { id: number; endpoint: string; p256dh: string; auth: string };
async function send(sub: Sub, message: Record<string, unknown>, k: { publicKey: string; privateJwk: JsonWebKey }) {
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(message));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, k.publicKey, k.privateJwk),
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '14400', Urgency: 'normal',
      },
      body,
    });
    const gone = res.status === 404 || res.status === 410;
    await admin.rpc('svc_push_result', { p_sub: sub.id, p_ok: res.ok, p_gone: gone });
    return res.ok;
  } catch (e) {
    console.error('push failed', (e as Error).message);
    await admin.rpc('svc_push_result', { p_sub: sub.id, p_ok: false, p_gone: false });
    return false;
  }
}

// Kind words only: no guilt, no streak warnings (brief section 3).
// On an exam day the reminder names the exam's topic instead.
type Exam = { topic: string; cards: number } | null;
const MESSAGE = (first: string, exam: Exam) => ({
  title: 'Maison Academy',
  body: exam
    ? first + ', today is your ' + exam.topic + ' exam: ' + exam.cards + ' cards, about ' + Math.max(5, Math.round(exam.cards / 2)) + ' minutes.'
    : first + ", today's 5 cards are ready. About 3 minutes.",
  url: '/',
});

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Origin': origin && ALLOWED.some((r) => r.test(origin)) ? origin : 'https://maison-academy.netlify.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin', 'Content-Type': 'application/json',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const k = await keys();
    if (req.method === 'GET') return reply(200, { public_key: k.publicKey });
    const body = await req.json().catch(() => ({}));

    if (body.action === 'run') {
      const { data: due, error } = await admin.rpc('svc_due_reminders');
      if (error) throw new Error(error.message);
      let sent = 0;
      for (const person of due ?? []) {
        let ok = false;
        for (const sub of person.subs ?? []) ok = (await send(sub, MESSAGE(person.first_name, person.exam ?? null), k)) || ok;
        // Marked as done for today either way, so nobody gets more than one a day.
        await admin.rpc('svc_reminder_sent', { p_staff: person.staff_id, p_local_date: person.local_date });
        if (ok) sent++;
      }
      return reply(200, { due: (due ?? []).length, sent });
    }

    if (body.action === 'test') {
      const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: u } = await admin.auth.getUser(token);
      if (!u?.user) return reply(401, { error: 'Please log in again.' });
      const { data: subs } = await admin.rpc('svc_test_push_targets', { p_user: u.user.id });
      if (!subs?.length) return reply(400, { error: 'Test reminders are for test accounts with reminders turned on.' });
      let sent = 0;
      for (const sub of subs) if (await send(sub, { title: 'Maison Academy', body: 'Test reminder: this is what staff will see.', url: '/' }, k)) sent++;
      return reply(200, { sent });
    }
    return reply(400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('reminders', (e as Error).message);
    return reply(500, { error: 'Something didn’t work on our side.' });
  }
});
