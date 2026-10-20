// Maison Academy · staff-auth: staff activation and PIN login.
// Copyright © 2026 Creneau Hospitality. All rights reserved.
//
// Runs on Supabase Edge Functions. The service-role key is provided by
// Supabase as an environment variable on the server; it never reaches a phone.
//
//   POST { action: "check_code", code }                      -> { first_name }
//   POST { action: "activate", code, pin, privacy_version }  -> { session, first_name }
//   POST { action: "login", staff_number, pin }              -> { session, first_name }
//
// Rules (brief section 10): 6-digit PIN; obvious PINs refused; 5 wrong PINs
// pause login for 15 minutes; the reply never says whether a staff number
// exists; PINs are stored only as a slow salted hash (PBKDF2-SHA256).
//
// Deploy with "Verify JWT" turned off: staff have no login yet when they call it.

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const ITERATIONS = 150_000;
const STAFF_EMAIL_DOMAIN = 'staff.maison-academy.invalid'; // reserved name: can never receive email

const ALLOWED = [/^https:\/\/([a-z0-9-]+--)?maison-academy\.netlify\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const NO_MATCH = "That staff number and PIN don't match. After 5 tries, login pauses for 15 minutes.";
const CODE_PROBLEM = "That code isn't valid. Codes work once and last 7 days. Ask your manager for a new one.";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED.some((r) => r.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'https://maison-academy.netlify.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(pin, salt, ITERATIONS))}`;
}

async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  // With no stored hash, still do the same work so timing doesn't reveal anything.
  const parts = (stored ?? '').split('$');
  const valid = parts.length === 4 && parts[0] === 'pbkdf2-sha256';
  const iterations = valid ? Number(parts[1]) : ITERATIONS;
  const salt = valid ? unb64(parts[2]) : new Uint8Array(16);
  const got = await pbkdf2(pin, salt, iterations);
  if (!valid) return false;
  const want = unb64(parts[3]);
  if (want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// Obvious PINs are refused (brief section 10).
function pinProblem(pin: unknown): string | null {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) return 'Your PIN must be 6 digits.';
  const d = pin.split('').map(Number);
  const allSame = d.every((x) => x === d[0]);
  const up = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  const repeats = pin.slice(0, 3) === pin.slice(3) || pin.slice(0, 2).repeat(3) === pin;
  const pairs = d[0] === d[1] && d[2] === d[3] && d[4] === d[5];
  const common = ['696969', '112233', '111222', '159753', '147258', '258369', '789456', '102030', '010203', '000001'];
  if (allSame || up || down || repeats || pairs || common.includes(pin)) {
    return 'That PIN is too easy to guess. Choose six digits that aren’t a pattern.';
  }
  return null;
}

async function sessionFor(userId: string) {
  const { data: u, error: e1 } = await admin.auth.admin.getUserById(userId);
  if (e1 || !u?.user?.email) throw new Error('user_missing');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  if (error || !data?.properties?.hashed_token) throw new Error('link_failed');
  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
  if (e2 || !v?.session) throw new Error('verify_failed');
  return { access_token: v.session.access_token, refresh_token: v.session.refresh_token, expires_at: v.session.expires_at };
}

async function ensureUser(staffId: string, existing: string | null): Promise<string> {
  if (existing) return existing;
  const email = `staff-${staffId}@${STAFF_EMAIL_DOMAIN}`;
  const password = b64(crypto.getRandomValues(new Uint8Array(32))); // never used or stored
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { kind: 'staff' },
  });
  if (data?.user?.id) return data.user.id;
  // Left over from an earlier attempt that didn't finish: find it by its link.
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (l?.user?.id) return l.user.id;
  throw new Error('create_user_failed: ' + (error?.message ?? ''));
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: 'Bad request.' }); }

  try {
    if (body.action === 'check_code') {
      const { data } = await admin.rpc('svc_code_staff', { p_code: String(body.code ?? '') });
      if (!data) return reply(400, { error: CODE_PROBLEM });
      return reply(200, { first_name: data.first_name });
    }

    if (body.action === 'activate') {
      const code = String(body.code ?? '');
      const problem = pinProblem(body.pin);
      if (problem) return reply(400, { error: problem, field: 'pin' });
      const { data: staff } = await admin.rpc('svc_code_staff', { p_code: code });
      if (!staff) return reply(400, { error: CODE_PROBLEM });
      const userId = await ensureUser(staff.staff_id, staff.user_id);
      const { data: done, error } = await admin.rpc('svc_complete_activation', {
        p_code: code, p_user_id: userId, p_pin_hash: await hashPin(body.pin as string),
        p_privacy_version: String(body.privacy_version ?? ''),
      });
      if (error) {
        if (/privacy_version/.test(error.message)) return reply(409, { error: 'The privacy notice has changed. Please read it again.' });
        return reply(400, { error: CODE_PROBLEM });
      }
      return reply(200, { session: await sessionFor(userId), first_name: done.first_name, staff_number: done.staff_number });
    }

    if (body.action === 'login') {
      const number = String(body.staff_number ?? '').trim();
      const pin = String(body.pin ?? '');
      const { data: who } = await admin.rpc('svc_login_lookup', { p_staff_number: number });
      if (!who || who.locked) {
        await verifyPin(pin, null); // same work either way
        return reply(401, { error: NO_MATCH });
      }
      const ok = await verifyPin(pin, who.pin_hash);
      await admin.rpc('svc_login_result', { p_staff_id: who.staff_id, p_ok: ok });
      if (!ok) return reply(401, { error: NO_MATCH });
      return reply(200, { session: await sessionFor(who.user_id) });
    }

    return reply(400, { error: 'Unknown action.' });
  } catch (e) {
    console.error('staff-auth', (e as Error).message); // never logs PINs or codes
    return reply(500, { error: 'Something went wrong on our side. Please try again in a minute.' });
  }
});
