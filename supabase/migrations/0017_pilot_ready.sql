-- Maison Academy · Phase 4 · Pilot ready
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Adds:
--   * Roster import and activation codes in bulk (for the printable sheet).
--   * A go-live switch: real (non-test) staff can't be added until the admin
--     sets real_staff_allowed = true (after the final privacy notice and
--     Supabase Pro backups are in place).
--   * Reminders by web push: subscriptions, server-held keys, and the list of
--     people due a reminder (at most one a day, at the set time, only until
--     their weekly target is met and not once today's set is done).
--     reminders_mode: off | test (test accounts only) | all.
--   * Optional location check (David, 21 Oct 2026): sets can only be started
--     within a radius of the venue. OFF by default. Only "on site yes/no" is
--     kept, never coordinates.
--   * A basic error log for the apps.
--
-- Safe to run more than once.

insert into public.settings (key, value, note) values
  ('real_staff_allowed', 'false',   'Go-live switch: allow real (non-test) staff to be added. Turn on only after the final privacy notice and Supabase Pro backups.'),
  ('reminders_mode',     '"test"',  'Reminders: "off", "test" (test accounts only) or "all"'),
  ('reminder_time',      '"10:00"', 'Time the daily reminder goes out, venue local time (HH:MM) [TO CONFIRM]'),
  ('location_check',     '"off"',   'Location check when starting a set: "off" or "on". Needs the venue''s map point and privacy wording first.'),
  ('location_radius_m',  '500',     'Location check: metres from the venue')
on conflict (key) do nothing;

alter table public.venues add column if not exists lat double precision;
alter table public.venues add column if not exists lng double precision;
alter table public.sets add column if not exists on_site boolean;

create or replace function public._setting_text(p_key text, p_default text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Go-live switch on adding staff
-- ---------------------------------------------------------------------------
create or replace function public.create_staff(
  p_staff_number text, p_first_name text, p_last_initial text, p_venue_id text, p_role text,
  p_start_month date default null, p_is_test boolean default false, p_weekly_target int default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_manager_for(p_venue_id) then raise exception 'Not allowed for this venue.'; end if;
  if not coalesce(p_is_test, false) and _setting_text('real_staff_allowed', 'false') <> 'true' then
    raise exception 'Real staff can be added from go-live. Until then, add test accounts.';
  end if;
  insert into staff (staff_number, first_name, last_initial, venue_id, role, start_month, is_test,
                     weekly_target, created_by)
  values (upper(trim(p_staff_number)), trim(p_first_name), upper(left(trim(p_last_initial), 1)), p_venue_id,
          p_role, p_start_month, coalesce(p_is_test, false), p_weekly_target, public.current_display_name())
  returning id into new_id;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'staff_created', 'staff', new_id::text,
          jsonb_build_object('venue', p_venue_id, 'role', p_role, 'test', coalesce(p_is_test, false)));
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roster import. Rows: [{staff_number, first_name, last_initial, role, start_month}]
-- Only these fields are accepted; nothing else from the file is stored.
-- ---------------------------------------------------------------------------
create or replace function public.import_staff(
  p_venue text, p_rows jsonb, p_as_test boolean default false, p_deactivate_missing boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r jsonb; i int := 0; num text; fname text; init text; rl text; sm date; ex staff;
  added int := 0; updated int := 0; same int := 0; reactivated int := 0; left_n int := 0;
  problems jsonb := '[]'; seen text[] := '{}';
begin
  if not public.is_manager_for(p_venue) then raise exception 'Not allowed for this venue.'; end if;
  if not coalesce(p_as_test, false) and _setting_text('real_staff_allowed', 'false') <> 'true' then
    raise exception 'Real staff can be imported from go-live. Until then, import as test accounts.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    num := upper(trim(coalesce(r ->> 'staff_number', '')));
    fname := trim(coalesce(r ->> 'first_name', ''));
    init := upper(left(trim(coalesce(r ->> 'last_initial', '')), 1));
    rl := lower(trim(coalesce(r ->> 'role', '')));
    sm := case when coalesce(r ->> 'start_month', '') ~ '^\d{4}-\d{2}' then (left(r ->> 'start_month', 7) || '-01')::date end;
    if num !~ '^[0-9A-Z-]{1,16}$' then problems := problems || jsonb_build_object('row', i, 'reason', 'Staff number missing or not valid'); continue; end if;
    if num = any(seen) then problems := problems || jsonb_build_object('row', i, 'reason', 'Staff number appears twice in the file'); continue; end if;
    if fname = '' or char_length(fname) > 40 then problems := problems || jsonb_build_object('row', i, 'reason', 'First name missing'); continue; end if;
    if init = '' then problems := problems || jsonb_build_object('row', i, 'reason', 'Last name missing'); continue; end if;
    if rl not in ('host', 'server', 'runner', 'bar', 'barista') then problems := problems || jsonb_build_object('row', i, 'reason', 'Role not recognised'); continue; end if;
    seen := seen || num;
    select * into ex from staff where staff_number = num;
    if ex.id is null then
      insert into staff (staff_number, first_name, last_initial, venue_id, role, start_month, is_test, created_by)
      values (num, fname, init, p_venue, rl, sm, coalesce(p_as_test, false), public.current_display_name());
      added := added + 1;
    elsif not public.is_manager_for(ex.venue_id) then
      problems := problems || jsonb_build_object('row', i, 'reason', 'Staff number belongs to another venue');
    elsif ex.is_test <> coalesce(p_as_test, false) then
      problems := problems || jsonb_build_object('row', i, 'reason', 'Staff number is already used by a ' || case when ex.is_test then 'test' else 'real' end || ' account');
    else
      if not ex.active then reactivated := reactivated + 1; end if;
      if ex.first_name is distinct from fname or ex.last_initial is distinct from init or ex.role is distinct from rl
         or ex.venue_id is distinct from p_venue or ex.start_month is distinct from coalesce(sm, ex.start_month) or not ex.active then
        update staff set first_name = fname, last_initial = init, role = rl, venue_id = p_venue,
          start_month = coalesce(sm, start_month), active = true, deactivated_at = null where id = ex.id;
        updated := updated + 1;
      else
        same := same + 1;
      end if;
    end if;
  end loop;
  if p_deactivate_missing then
    with gone as (
      update staff set active = false, deactivated_at = now()
      where venue_id = p_venue and active and is_test = coalesce(p_as_test, false) and not staff_number = any(seen)
      returning id)
    select count(*) into left_n from gone;
    update activation_codes set expires_at = least(expires_at, now())
    where used_at is null and staff_id in (select id from staff where venue_id = p_venue and not active);
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'roster_imported', 'venue', p_venue,
          jsonb_build_object('rows', i, 'added', added, 'updated', updated, 'unchanged', same,
                             'marked_left', left_n, 'problems', jsonb_array_length(problems), 'test', coalesce(p_as_test, false)));
  return jsonb_build_object('rows', i, 'added', added, 'updated', updated, 'unchanged', same,
                            'reactivated', reactivated, 'marked_left', left_n, 'problems', problems);
end;
$$;

-- Codes for many people at once (the printable activation sheet).
create or replace function public.issue_codes(p_staff_ids uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid; res jsonb := '[]'; c jsonb; s staff;
begin
  if cardinality(p_staff_ids) > 200 then raise exception 'Up to 200 people at a time.'; end if;
  foreach sid in array p_staff_ids loop
    select * into s from staff where id = sid;
    c := public.issue_activation_code(sid);
    res := res || jsonb_build_object('staff_id', sid, 'name', s.first_name || ' ' || s.last_initial || '.', 'role', s.role,
                                     'staff_number', c ->> 'staff_number', 'code', c ->> 'code', 'expires_at', c ->> 'expires_at');
  end loop;
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reminders by web push
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures   int not null default 0
);
-- The server's own key pair for push (private key never leaves the server).
create table if not exists public.push_keys (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_jwk jsonb not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.reminder_log (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  local_date date not null,
  sent_at    timestamptz not null default now(),
  primary key (staff_id, local_date)
);
alter table public.push_subscriptions enable row level security;
alter table public.push_keys enable row level security;
alter table public.reminder_log enable row level security;
revoke all on public.push_subscriptions, public.push_keys, public.reminder_log from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me();
begin
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Not a push address.'; end if;
  insert into push_subscriptions (staff_id, endpoint, p256dh, auth) values (s.id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set staff_id = s.id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0;
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me();
begin
  delete from push_subscriptions where endpoint = p_endpoint and staff_id = s.id;
end;
$$;

create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select public_key from push_keys where id = 1;
$$;

-- Server only: keep the key pair the first time it's made.
create or replace function public.svc_init_push_keys(p_public text, p_private jsonb) returns text
language plpgsql volatile security definer set search_path = public as $$
begin
  insert into push_keys (id, public_key, private_jwk) values (1, p_public, p_private) on conflict (id) do nothing;
  return (select public_key from push_keys where id = 1);
end;
$$;

create or replace function public.svc_push_private_key() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk) from push_keys where id = 1;
$$;

-- Server only: who gets a reminder now. At most one a day, at or after the
-- set time, not once today's set is done, only until the weekly target is met.
create or replace function public.svc_due_reminders() returns jsonb
language sql stable security definer set search_path = public as $$
  with mode as (select _setting_text('reminders_mode', 'off') m),
  ppl as (
    select s.id, s.first_name,
           to_char(now() at time zone v.timezone, 'HH24:MI') local_time,
           (now() at time zone v.timezone)::date local_today,
           _today(s) set_day,
           _sets_in_week(s.id, date_trunc('week', _today(s)::timestamp)::date) wk_sets,
           _target(s) target
    from staff s join venues v on v.id = s.venue_id cross join mode
    where s.active and s.user_id is not null
      and (mode.m = 'all' or (mode.m = 'test' and s.is_test))
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', p.id, 'first_name', p.first_name, 'local_date', p.local_today,
           'subs', (select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
                    from push_subscriptions ps where ps.staff_id = p.id))), '[]'::jsonb)
  from ppl p
  where exists (select 1 from push_subscriptions ps where ps.staff_id = p.id)
    and p.local_time >= _setting_text('reminder_time', '10:00')
    and not exists (select 1 from reminder_log rl where rl.staff_id = p.id and rl.local_date = p.local_today)
    and not exists (select 1 from sets x where x.staff_id = p.id and x.kind = 'daily' and x.finished_at is not null
                    and x.local_date = p.set_day)
    and p.wk_sets < p.target;
$$;

create or replace function public.svc_reminder_sent(p_staff uuid, p_local_date date) returns void
language sql volatile security definer set search_path = public as $$
  insert into reminder_log (staff_id, local_date) values (p_staff, p_local_date) on conflict do nothing;
$$;

create or replace function public.svc_push_result(p_sub bigint, p_ok boolean, p_gone boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_gone then delete from push_subscriptions where id = p_sub; return; end if;
  update push_subscriptions set last_ok_at = case when p_ok then now() else last_ok_at end,
    failures = case when p_ok then 0 else failures + 1 end where id = p_sub;
  delete from push_subscriptions where id = p_sub and failures >= 5;
end;
$$;

-- Server only: a test account's own subscriptions (for "send me a test reminder").
create or replace function public.svc_test_push_targets(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]'::jsonb)
  from staff s join push_subscriptions ps on ps.staff_id = s.id
  where s.user_id = p_user and s.active and s.is_test;
$$;

-- ---------------------------------------------------------------------------
-- Optional location check (off by default)
-- ---------------------------------------------------------------------------
create or replace function public._distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- null = no check (switched off, or the venue has no map point); otherwise true, or it stops.
create or replace function public._check_on_site(s public.staff, p_lat float8, p_lng float8, p_accuracy float8) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v venues; d float8;
begin
  if _setting_text('location_check', 'off') <> 'on' then return null; end if;
  select * into v from venues where id = s.venue_id;
  if v.lat is null or v.lng is null then return null; end if;
  if p_lat is null or p_lng is null then raise exception 'location_needed'; end if;
  d := _distance_m(v.lat, v.lng, p_lat, p_lng);
  if d - least(coalesce(p_accuracy, 0), 150) > _setting_int('location_radius_m', 500) then
    raise exception 'not_on_site:%', round(d)::int;
  end if;
  return true;
end;
$$;

create or replace function public._location_required(s public.staff) returns boolean
language sql stable security definer set search_path = public as $$
  select _setting_text('location_check', 'off') = 'on'
     and exists (select 1 from venues where id = s.venue_id and lat is not null and lng is not null);
$$;

drop function if exists public.start_daily_set();
create or replace function public.start_daily_set(p_lat float8 default null, p_lng float8 default null, p_accuracy float8 default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets; ids text[]; here boolean;
begin
  here := _check_on_site(s, p_lat, p_lng, p_accuracy);
  select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  if st.id is null then
    ids := _pick_daily(s, d);
    if cardinality(ids) = 0 then
      return jsonb_build_object('set', null, 'cards', '[]'::jsonb, 'answered', '[]'::jsonb);
    end if;
    insert into sets (staff_id, kind, local_date, card_ids, on_site) values (s.id, 'daily', d, ids, here)
    on conflict do nothing;
    select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  end if;
  return jsonb_build_object(
    'set', jsonb_build_object('id', st.id, 'kind', st.kind, 'local_date', st.local_date,
                              'finished', st.finished_at is not null),
    'cards', _cards_json(st.card_ids),
    'answered', (select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'correct', correct)), '[]'::jsonb)
                 from events where set_id = st.id));
end;
$$;

drop function if exists public.start_readiness();
create or replace function public.start_readiness(p_lat float8 default null, p_lng float8 default null, p_accuracy float8 default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); st sets; ids text[]; here boolean;
begin
  here := _check_on_site(s, p_lat, p_lng, p_accuracy);
  select coalesce(array_agg(id), '{}') into ids from (
    select c.id from cards c
    where c.status = 'live' and s.role = any(c.roles) and c.level = 1
    order by random() limit _setting_int('readiness_check_cards', 20)
  ) x;
  if cardinality(ids) = 0 then return jsonb_build_object('set', null, 'cards', '[]'::jsonb); end if;
  insert into sets (staff_id, kind, local_date, card_ids, on_site) values (s.id, 'readiness', _today(s), ids, here)
  returning * into st;
  return jsonb_build_object(
    'set', jsonb_build_object('id', st.id, 'kind', st.kind, 'local_date', st.local_date, 'finished', false),
    'cards', _cards_json(st.card_ids), 'answered', '[]'::jsonb);
end;
$$;

-- Home screen, now also saying whether a location check or reminders apply.
create or replace function public.staff_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets; m text := _setting_text('reminders_mode', 'off');
begin
  select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  return jsonb_build_object(
    'first_name', s.first_name,
    'role', s.role,
    'level', s.level,
    'level_name', _level_name(s.level),
    'next_level_name', case when s.level < 3 then _level_name(s.level + 1) end,
    'level1_pct', _level1_pct(s),
    'today', d,
    'test', case when s.is_test then jsonb_build_object('offset', s.test_day_offset) end,
    'set_today', case when st.id is null then null else jsonb_build_object(
        'id', st.id, 'finished', st.finished_at is not null, 'total', cardinality(st.card_ids),
        'answered', (select count(*) from events where set_id = st.id)) end,
    'cards_available', exists (select 1 from cards c where _in_scope(s, c)),
    'misses', (select count(*) from card_state x join cards c on c.id = x.card_id
               where x.staff_id = s.id and x.last_result = false and c.status = 'live'),
    'rhythm', _rhythm(s),
    'team', _team(s),
    'privacy_version', s.privacy_version,
    'privacy_accepted_at', s.privacy_accepted_at,
    'location_required', _location_required(s),
    'reminders', jsonb_build_object(
        'available', m = 'all' or (m = 'test' and s.is_test),
        'time', _setting_text('reminder_time', '10:00'),
        'subscriptions', (select count(*) from push_subscriptions where staff_id = s.id),
        'sets_done', (select count(*) from sets where staff_id = s.id and kind = 'daily' and finished_at is not null)));
end;
$$;

-- Venue map point (admin), for the location check.
create or replace function public.set_venue_location(p_venue text, p_lat float8, p_lng float8) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can set a venue''s location.'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception 'Not a valid map point.'; end if;
  update venues set lat = p_lat, lng = p_lng where id = p_venue;
  insert into audit_log (actor_id, actor, action, entity, entity_id)
  values (auth.uid(), public.current_display_name(), 'venue_location_set', 'venue', p_venue);
end;
$$;

create or replace function public.list_venues() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'lat', lat, 'lng', lng) order by name), '[]'::jsonb)
  from venues where active and public.is_manager_for(id);
$$;

-- ---------------------------------------------------------------------------
-- Basic error log (no personal data beyond who was signed in)
-- ---------------------------------------------------------------------------
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  app        text,
  message    text,
  detail     text,
  url        text,
  user_agent text
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant select on public.client_errors to authenticated;
drop policy if exists client_errors_read on public.client_errors;
create policy client_errors_read on public.client_errors for select to authenticated using (public.is_admin());

create or replace function public.log_client_error(p_app text, p_message text, p_detail text, p_url text, p_user_agent text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if (select count(*) from client_errors where user_id = auth.uid() and at > now() - interval '1 hour') >= 30 then return; end if;
  insert into client_errors (user_id, app, message, detail, url, user_agent)
  values (auth.uid(), left(p_app, 20), left(p_message, 500), left(p_detail, 2000),
          left(regexp_replace(coalesce(p_url, ''), '[?#].*$', ''), 300), left(p_user_agent, 300));
  delete from client_errors where at < now() - interval '90 days';
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function public._setting_text(text, text), public._distance_m(float8, float8, float8, float8),
  public._check_on_site(public.staff, float8, float8, float8), public._location_required(public.staff)
  from public, anon, authenticated;

revoke execute on function public.svc_init_push_keys(text, jsonb), public.svc_push_private_key(), public.svc_due_reminders(),
  public.svc_reminder_sent(uuid, date), public.svc_push_result(bigint, boolean, boolean), public.svc_test_push_targets(uuid)
  from public, anon, authenticated;
grant execute on function public.svc_init_push_keys(text, jsonb), public.svc_push_private_key(), public.svc_due_reminders(),
  public.svc_reminder_sent(uuid, date), public.svc_push_result(bigint, boolean, boolean), public.svc_test_push_targets(uuid)
  to service_role;

revoke execute on function public.create_staff(text, text, text, text, text, date, boolean, int),
  public.import_staff(text, jsonb, boolean, boolean), public.issue_codes(uuid[]),
  public.save_push_subscription(text, text, text), public.remove_push_subscription(text), public.push_public_key(),
  public.start_daily_set(float8, float8, float8), public.start_readiness(float8, float8, float8), public.staff_home(),
  public.set_venue_location(text, float8, float8), public.list_venues(), public.log_client_error(text, text, text, text, text)
  from public, anon;
grant execute on function public.create_staff(text, text, text, text, text, date, boolean, int),
  public.import_staff(text, jsonb, boolean, boolean), public.issue_codes(uuid[]),
  public.save_push_subscription(text, text, text), public.remove_push_subscription(text), public.push_public_key(),
  public.start_daily_set(float8, float8, float8), public.start_readiness(float8, float8, float8), public.staff_home(),
  public.set_venue_location(text, float8, float8), public.list_venues(), public.log_client_error(text, text, text, text, text)
  to authenticated;

select 'pilot-ready pieces in place' as result;
