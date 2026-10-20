-- Maison Academy · Phase 2 · Staff app: people, login records and the learning engine
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Creates: venues, staff, staff_secrets, activation_codes, card_state, sets,
-- events, coaching_prompts, signoffs, level_history, rhythm_pauses.
--
-- Rules the database enforces (brief sections 3, 6, 10 and 12):
--   * A staff member can read only their own rows. Venue managers see their
--     venue; the admin sees everything. PIN hashes and activation codes can't
--     be read by anyone through the app: only the two login functions on the
--     server (service role) touch them.
--   * Staff never write to tables directly. Answers go through
--     record_answer(), which grades the answer itself and moves the card
--     between spacing boxes, so the phone can't change the rules.
--   * Staff only ever see live cards (live cards always have a reviewer).
--   * Allergen cards never go above box 5. "Not yet, but sure" on an allergen
--     card creates a private coaching prompt for the venue manager and admin.
--   * Answers are append-only and de-duplicated by the phone's event id, so an
--     answer queued offline and sent twice counts once.
--   * Nobody is ever moved down a level.
--   * Test accounts can move their own date forward (test mode); real staff
--     can't.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Settings used by the staff app
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, note) values
  ('daily_set_size',          '5',  'Cards in a daily set'),
  ('daily_set_due',           '3',  'Daily set: up to this many due cards'),
  ('daily_set_new',           '2',  'Daily set: up to this many new cards'),
  ('stay_signed_in_days',     '60', 'Days a phone stays signed in before the PIN is asked again'),
  ('login_max_attempts',      '5',  'Wrong PINs before login pauses'),
  ('login_pause_minutes',     '15', 'How long login pauses after too many wrong PINs'),
  ('activation_code_days',    '7',  'Days an activation code stays valid'),
  ('privacy_notice_version',  '"draft-2026-10-20"', 'Version of the privacy notice staff accept at activation [TO CONFIRM with counsel]')
on conflict (key) do nothing;

create or replace function public._setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- Venues and staff
-- ---------------------------------------------------------------------------

create table if not exists public.venues (
  id              text primary key,
  name            text not null,
  timezone        text not null default 'Asia/Dubai',
  weekly_goal_pct int check (weekly_goal_pct between 1 and 100),  -- null = the default setting
  active          boolean not null default true
);

insert into public.venues (id, name, timezone) values
  ('arabian-ranches', 'Arabian Ranches', 'Asia/Dubai')
on conflict (id) do nothing;

create table if not exists public.staff (
  id                  uuid primary key default gen_random_uuid(),
  staff_number        text not null unique check (staff_number ~ '^[0-9A-Za-z-]{1,16}$'),
  first_name          text not null check (char_length(trim(first_name)) between 1 and 40),
  last_initial        text not null check (char_length(last_initial) = 1),
  venue_id            text not null references public.venues(id),
  role                text not null check (role in ('host', 'server', 'runner', 'bar', 'barista')),
  start_month         date,
  level               int  not null default 0 check (level between 0 and 3),
  weekly_target       int  check (weekly_target between 1 and 7),       -- null = the default setting
  active              boolean not null default true,
  is_test             boolean not null default false,
  test_day_offset     int  not null default 0 check (test_day_offset between 0 and 400),
  user_id             uuid unique references auth.users(id) on delete set null,
  privacy_version     text,
  privacy_accepted_at timestamptz,
  created_at          timestamptz not null default now(),
  created_by          text,
  deactivated_at      timestamptz,
  check (is_test or test_day_offset = 0)
);
create index if not exists staff_venue on public.staff (venue_id);

-- PIN hash and lockout. Read and written only by the login functions (service role).
create table if not exists public.staff_secrets (
  staff_id        uuid primary key references public.staff(id) on delete cascade,
  pin_hash        text not null,               -- pbkdf2-sha256$iterations$salt$hash
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  pin_set_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

-- Single-use activation codes; only a hash is stored.
create table if not exists public.activation_codes (
  code_hash  text primary key,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text,
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists activation_codes_staff on public.activation_codes (staff_id);

-- ---------------------------------------------------------------------------
-- Learning records
-- ---------------------------------------------------------------------------

create table if not exists public.card_state (
  staff_id        uuid not null references public.staff(id) on delete cascade,
  card_id         text not null references public.cards(id),
  box             int  not null default 1 check (box between 1 and 6),
  due_on          date not null,
  last_result     boolean,
  last_confidence text check (last_confidence in ('sure', 'think', 'guess')),
  times_seen      int  not null default 0,
  times_right     int  not null default 0,
  first_seen_on   date not null,
  last_seen_on    date not null,
  last_seen_at    timestamptz not null default now(),
  primary key (staff_id, card_id)
);
create index if not exists card_state_due on public.card_state (staff_id, due_on);

create table if not exists public.sets (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null check (kind in ('daily', 'readiness')),
  local_date  date not null,
  card_ids    text[] not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  learned     int,
  strengthened int,
  right_count int,
  total       int,
  passed      boolean
);
create unique index if not exists sets_one_daily on public.sets (staff_id, local_date) where kind = 'daily';
create index if not exists sets_staff on public.sets (staff_id, local_date);

-- Append-only answer log. client_event_id comes from the phone, so a retried
-- or offline-queued answer is only counted once.
create table if not exists public.events (
  id              bigint generated always as identity primary key,
  client_event_id uuid not null unique,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  set_id          uuid not null references public.sets(id) on delete cascade,
  set_kind        text not null,
  card_id         text not null references public.cards(id),
  card_version    int  not null,
  chosen          jsonb not null,
  correct         boolean not null,
  confidence      text not null check (confidence in ('sure', 'think', 'guess')),
  was_new         boolean not null default false,
  box_before      int,
  box_after       int,
  local_date      date not null,
  answered_at     timestamptz not null default now(),
  received_at     timestamptz not null default now()
);
create unique index if not exists events_one_per_card on public.events (set_id, card_id);
create index if not exists events_staff on public.events (staff_id, local_date);

-- Private: only the venue manager and admin can see these.
create table if not exists public.coaching_prompts (
  id          bigint generated always as identity primary key,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  venue_id    text not null references public.venues(id),
  card_id     text not null references public.cards(id),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists coaching_open on public.coaching_prompts (venue_id) where resolved_at is null;

-- Practical sign-offs (signed from the dashboard in Phase 3).
create table if not exists public.signoffs (
  staff_id  uuid not null references public.staff(id) on delete cascade,
  skill     text not null,
  signed_by text not null,
  signed_at timestamptz not null default now(),
  primary key (staff_id, skill)
);

create table if not exists public.level_history (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  level      int  not null,
  reached_at timestamptz not null default now(),
  primary key (staff_id, level)
);

-- A week marked as leave doesn't break the rhythm (set by David, Phase 3).
create table if not exists public.rhythm_pauses (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  week_start date not null,
  created_by text,
  primary key (staff_id, week_start)
);

-- Answers can't be edited. Only test accounts' records can be deleted (test reset).
create or replace function public.events_append_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then raise exception 'Answers can''t be changed.'; end if;
  if tg_op = 'DELETE' and not exists (select 1 from staff where id = old.staff_id and is_test) then
    raise exception 'Answers can''t be deleted.';
  end if;
  return old;
end;
$$;
drop trigger if exists events_append_only on public.events;
create trigger events_append_only before update or delete on public.events
  for each row execute function public.events_append_only();

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------

create or replace function public.is_manager_for(p_venue text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from user_roles r join app_users u using (user_id)
    where r.user_id = auth.uid() and r.role = 'venue_manager' and u.active and r.venue_id = p_venue
  );
$$;

-- The signed-in staff member. Stops if they're not staff, inactive, or their
-- 60 days on this login have run out.
create or replace function public._me() returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s staff; last_login timestamptz;
begin
  select * into s from staff where user_id = auth.uid() and active;
  if s.id is null then raise exception 'not_staff'; end if;
  select last_login_at into last_login from staff_secrets where staff_id = s.id;
  if last_login is null or last_login < now() - make_interval(days => _setting_int('stay_signed_in_days', 60)) then
    raise exception 'login_expired';
  end if;
  return s;
end;
$$;

-- Today in the venue's time zone (plus the test offset for test accounts).
create or replace function public._today(s public.staff) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from venues where id = s.venue_id), 'Asia/Dubai'))::date
         + s.test_day_offset;
$$;

create or replace function public._gap(p_box int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> p_box::text)::int from settings where key = 'leitner_gaps_days'),
                  (array[0, 1, 3, 7, 21, 45])[p_box]);
$$;

-- Cards this person may see: live, tagged for their role, within their level scope.
create or replace function public._in_scope(s public.staff, c public.cards) returns boolean
language sql stable as $$
  select c.status = 'live' and s.role = any(c.roles) and c.level <= least(3, s.level + 1);
$$;

create or replace function public._is_right(c public.cards, p_chosen jsonb) returns boolean
language sql immutable as $$
  select case
    when c.type = 'order' then p_chosen = c.answer
    else (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(p_chosen) x)
       = (select coalesce(array_agg(x order by x), '{}') from jsonb_array_elements_text(c.answer) x)
  end;
$$;

create or replace function public._cards_json(p_ids text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'track', t.name, 'track_id', c.track_id, 'unit', u.name, 'type', c.type,
      'prompt', c.prompt, 'media', c.media, 'options', c.options, 'answer', c.answer,
      'explanation', c.explanation, 'why_it_matters', c.why_it_matters,
      'is_allergen', c.is_allergen, 'version', c.version) order by x.ord), '[]'::jsonb)
  from unnest(p_ids) with ordinality x(id, ord)
  join cards c on c.id = x.id
  join tracks t on t.id = c.track_id
  join units u on u.id = c.unit_id;
$$;

-- ---------------------------------------------------------------------------
-- The daily set (brief 6.5)
-- ---------------------------------------------------------------------------
-- 1. Up to 3 due cards, oldest first, allergen cards first on ties.
-- 2. Up to 2 new cards from the current unit. Units are taken in turn across
--    tracks (first unit of each track, then the second of each, ...), so new
--    cards mix tracks over the weeks; within a unit, in card order.
-- 3. If either pool runs short, fill from the other, then from the
--    earliest-learned cards, to make 5.
-- 4. The set is shuffled so cards from the same unit don't sit together.
create or replace function public._pick_daily(s public.staff, p_today date) returns text[]
language plpgsql volatile security definer set search_path = public as $$
declare
  n_total int := _setting_int('daily_set_size', 5);
  n_due   int := _setting_int('daily_set_due', 3);
  n_new   int := _setting_int('daily_set_new', 2);
  due text[]; fresh text[]; picked text[]; more text[]; cid text; n_missed int;
begin
  -- "Not yet" cards were promised to come back next set, so they go first and
  -- may take more than 3 places (new cards give way).
  select coalesce(array_agg(card_id order by rn), '{}'), coalesce(max(rn) filter (where missed), 0)
    into due, n_missed from (
    select st.card_id, st.last_result = false missed, row_number() over (
             order by (st.last_result = false) desc, st.due_on, c.is_allergen desc, st.last_seen_at, c.id) rn
    from card_state st join cards c on c.id = st.card_id
    where st.staff_id = s.id and st.due_on <= p_today and _in_scope(s, c)
  ) x where rn <= n_total;
  n_due := greatest(n_due, n_missed);
  n_new := least(n_new, n_total - least(n_due, cardinality(due)));

  select coalesce(array_agg(id order by rn), '{}') into fresh from (
    select c.id, row_number() over (order by c.level, u.sort, t.sort, u.id, c.id) rn
    from cards c join units u on u.id = c.unit_id join tracks t on t.id = c.track_id
    where _in_scope(s, c)
      and not exists (select 1 from card_state st where st.staff_id = s.id and st.card_id = c.id)
  ) x where rn <= n_total;

  picked := due[1:n_due] || fresh[1:n_new];
  foreach cid in array (due[n_due + 1:] || fresh[n_new + 1:]) loop
    exit when cardinality(picked) >= n_total;
    if not cid = any(picked) then picked := picked || cid; end if;
  end loop;

  if cardinality(picked) < n_total then
    select coalesce(array_agg(card_id order by rn), '{}') into more from (
      select st.card_id, row_number() over (order by st.first_seen_on, st.last_seen_at, st.card_id) rn
      from card_state st join cards c on c.id = st.card_id
      where st.staff_id = s.id and _in_scope(s, c) and not st.card_id = any(picked)
    ) x where rn <= n_total - cardinality(picked);
    picked := picked || more;
  end if;

  -- Round-robin across units, so similar cards are spread out.
  select coalesce(array_agg(id order by k1, k2), '{}') into picked from (
    select c.id, row_number() over (partition by c.unit_id order by random()) k1, random() k2
    from cards c where c.id = any(picked)
  ) y;
  return picked;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rhythm (weeks, Monday to Sunday) and the venue's weekly goal
-- ---------------------------------------------------------------------------

create or replace function public._target(s public.staff) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(s.weekly_target, _setting_int('weekly_target_default', 4));
$$;

create or replace function public._sets_in_week(p_staff uuid, p_week date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from sets
  where staff_id = p_staff and kind = 'daily' and finished_at is not null
    and local_date between p_week and p_week + 6;
$$;

create or replace function public._rhythm(s public.staff) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d date := _today(s);
  wk date := date_trunc('week', d::timestamp)::date;
  target int := _target(s);
  this_week int := _sets_in_week(s.id, wk);
  first_week date;
  w date := wk - 7;
  streak int := 0;
begin
  select date_trunc('week', min(local_date)::timestamp)::date into first_week
  from sets where staff_id = s.id and kind = 'daily' and finished_at is not null;
  while first_week is not null and w >= first_week loop
    if not exists (select 1 from rhythm_pauses where staff_id = s.id and week_start = w) then
      exit when _sets_in_week(s.id, w) < target;
      streak := streak + 1;
    end if;
    w := w - 7;
  end loop;
  if this_week >= target then streak := streak + 1; end if;
  return jsonb_build_object('target', target, 'this_week', this_week, 'streak', streak,
                            'met', this_week >= target, 'week_start', wk);
end;
$$;

-- The venue's goal: share of the team meeting their weekly target. Test
-- accounts only count among themselves, so they never change the real figure.
create or replace function public._team(s public.staff) returns jsonb
language sql stable security definer set search_path = public as $$
  with wk as (select date_trunc('week', _today(s)::timestamp)::date w),
  ppl as (
    select p.id, _target(p) t from staff p
    where p.venue_id = s.venue_id and p.active and p.is_test = s.is_test and p.user_id is not null
  ),
  done as (select count(*) filter (where _sets_in_week(p.id, (select w from wk)) >= p.t) met, count(*) n from ppl p)
  select jsonb_build_object(
    'venue', (select name from venues where id = s.venue_id),
    'met', met, 'people', n,
    'pct', case when n = 0 then 0 else round(100.0 * met / n) end,
    'goal_pct', coalesce((select weekly_goal_pct from venues where id = s.venue_id),
                         _setting_int('venue_weekly_goal_pct', 85)))
  from done;
$$;

-- ---------------------------------------------------------------------------
-- Mastery and levels (brief 6.6 and 6.7)
-- ---------------------------------------------------------------------------

-- Mastered = last answer right and Sure, card in box 4 or above.
create or replace function public._mastery(s public.staff, p_max_level int) returns table (
  track_id text, track text, sort int, live int, mastered int, pct int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.sort,
         count(c.id)::int,
         count(c.id) filter (where st.last_result and st.last_confidence = 'sure' and st.box >= 4)::int,
         case when count(c.id) = 0 then 0
              else floor(100.0 * count(c.id) filter (where st.last_result and st.last_confidence = 'sure' and st.box >= 4)
                         / count(c.id))::int end
  from tracks t
  left join cards c on c.track_id = t.id and c.status = 'live' and s.role = any(c.roles) and c.level <= p_max_level
  left join card_state st on st.staff_id = s.id and st.card_id = c.id
  group by t.id, t.name, t.sort;
$$;

create or replace function public._level1_pct(s public.staff) returns int
language sql stable security definer set search_path = public as $$
  select case when sum(live) = 0 then 0 else floor(100.0 * sum(mastered) / sum(live))::int end
  from _mastery(s, 1);
$$;

create or replace function public._level_name(p int) returns text
language sql immutable as $$
  select (array['Getting started', 'New in the house', 'House regular', 'Host of the house'])[p + 1];
$$;

-- The three practical sign-offs for Level 1 (brief 6.7).
create or replace function public._level1_skills() returns jsonb
language sql immutable as $$
  select '[{"id": "table_setup", "name": "Table set-up"},
           {"id": "welcome_seating", "name": "Welcome and seating"},
           {"id": "allergen_walkthrough", "name": "Allergen walk-through"}]'::jsonb;
$$;

-- Move a person up when they meet the rules. Never down.
create or replace function public._check_level(p_staff uuid) returns int
language plpgsql volatile security definer set search_path = public as $$
declare s staff; ok boolean;
begin
  select * into s from staff where id = p_staff;
  if s.level = 0 then
    ok := _level1_pct(s) >= _setting_int('level1_mastery_pct', 80)
      and exists (select 1 from sets where staff_id = s.id and kind = 'readiness' and passed)
      and (select count(*) from signoffs where staff_id = s.id
           and skill in (select x ->> 'id' from jsonb_array_elements(_level1_skills()) x)) = 3;
    if ok then
      update staff set level = 1 where id = s.id and level = 0;
      insert into level_history (staff_id, level) values (s.id, 1) on conflict do nothing;
      return 1;
    end if;
  elsif s.level = 1 then
    ok := (select bool_and(pct >= _setting_int('level2_mastery_pct', 70)) from _mastery(s, 2) where live > 0)
      and exists (select 1 from signoffs where staff_id = s.id and skill = 'level2_signoff');
    if ok then
      update staff set level = 2 where id = s.id and level = 1;
      insert into level_history (staff_id, level) values (s.id, 2) on conflict do nothing;
      return 2;
    end if;
  end if;
  -- Level 3 (badges) comes later: the badge definitions aren't set yet.
  return s.level;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the staff app calls
-- ---------------------------------------------------------------------------

-- Home screen.
create or replace function public.staff_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets;
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
    'privacy_accepted_at', s.privacy_accepted_at);
end;
$$;

-- Today's set: made once per day, the same set comes back if reopened.
create or replace function public.start_daily_set() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets; ids text[];
begin
  select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  if st.id is null then
    ids := _pick_daily(s, d);
    if cardinality(ids) = 0 then
      return jsonb_build_object('set', null, 'cards', '[]'::jsonb, 'answered', '[]'::jsonb);
    end if;
    insert into sets (staff_id, kind, local_date, card_ids) values (s.id, 'daily', d, ids)
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

-- Readiness check: 20 Level 1 cards for the person's role, untimed, retake any time.
create or replace function public.start_readiness() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); st sets; ids text[];
begin
  select coalesce(array_agg(id), '{}') into ids from (
    select c.id from cards c
    where c.status = 'live' and s.role = any(c.roles) and c.level = 1
    order by random() limit _setting_int('readiness_check_cards', 20)
  ) x;
  if cardinality(ids) = 0 then return jsonb_build_object('set', null, 'cards', '[]'::jsonb); end if;
  insert into sets (staff_id, kind, local_date, card_ids) values (s.id, 'readiness', _today(s), ids)
  returning * into st;
  return jsonb_build_object(
    'set', jsonb_build_object('id', st.id, 'kind', st.kind, 'local_date', st.local_date, 'finished', false),
    'cards', _cards_json(st.card_ids), 'answered', '[]'::jsonb);
end;
$$;

-- One answer. Graded here, not on the phone. Safe to send twice.
create or replace function public.record_answer(
  p_client_event_id uuid, p_set_id uuid, p_card_id text, p_chosen jsonb, p_confidence text,
  p_answered_at timestamptz default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s staff := _me(); st sets; c cards; cs card_state; e events;
  ok boolean; is_new boolean; b_before int; b_after int; max_box int;
begin
  select * into e from events where client_event_id = p_client_event_id;
  if e.id is not null then
    if e.staff_id <> s.id then raise exception 'Not allowed.'; end if;
    return jsonb_build_object('correct', e.correct, 'duplicate', true);
  end if;
  if p_confidence not in ('sure', 'think', 'guess') then raise exception 'Unknown confidence.'; end if;
  if jsonb_typeof(p_chosen) is distinct from 'array' then raise exception 'Answer must be a list.'; end if;

  select * into st from sets where id = p_set_id and staff_id = s.id;
  if st.id is null then raise exception 'Unknown set.'; end if;
  if not p_card_id = any(st.card_ids) then raise exception 'That card isn''t in this set.'; end if;
  select * into e from events where set_id = st.id and card_id = p_card_id;
  if e.id is not null then return jsonb_build_object('correct', e.correct, 'duplicate', true); end if;

  select * into c from cards where id = p_card_id;
  ok := _is_right(c, p_chosen);

  if st.kind = 'daily' then
    select * into cs from card_state where staff_id = s.id and card_id = c.id for update;
    is_new := cs.staff_id is null;
    b_before := coalesce(cs.box, 1);
    max_box := case when c.is_allergen then _setting_int('allergen_max_box', 5) else 6 end;
    b_after := case
      when ok and p_confidence in ('sure', 'think') then least(b_before + 1, max_box)
      when ok then least(b_before, max_box)
      else 1 end;
    insert into card_state as x (staff_id, card_id, box, due_on, last_result, last_confidence,
                                 times_seen, times_right, first_seen_on, last_seen_on)
    values (s.id, c.id, b_after, st.local_date + _gap(b_after), ok, p_confidence,
            1, ok::int, st.local_date, st.local_date)
    on conflict (staff_id, card_id) do update set
      box = excluded.box, due_on = excluded.due_on, last_result = excluded.last_result,
      last_confidence = excluded.last_confidence, times_seen = x.times_seen + 1,
      times_right = x.times_right + excluded.times_right, last_seen_on = excluded.last_seen_on,
      last_seen_at = now();
  end if;

  insert into events (client_event_id, staff_id, set_id, set_kind, card_id, card_version, chosen,
                      correct, confidence, was_new, box_before, box_after, local_date, answered_at)
  values (p_client_event_id, s.id, st.id, st.kind, c.id, c.version, p_chosen, ok, p_confidence,
          coalesce(is_new, false), b_before, b_after, st.local_date,
          least(coalesce(p_answered_at, now()), now()));

  -- "Not yet, but sure" on an allergen card: a private prompt for the manager.
  if not ok and p_confidence = 'sure' and c.is_allergen and not exists (
       select 1 from coaching_prompts where staff_id = s.id and card_id = c.id and resolved_at is null) then
    insert into coaching_prompts (staff_id, venue_id, card_id) values (s.id, s.venue_id, c.id);
  end if;

  return jsonb_build_object('correct', ok, 'box', b_after);
end;
$$;

-- Close a set once every card is answered. Returns what the "set done" screen shows.
create or replace function public.finish_set(p_set_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); st sets; n_answered int; n_right int; n_learned int; n_strong int; lvl int; practise jsonb;
begin
  select * into st from sets where id = p_set_id and staff_id = s.id;
  if st.id is null then raise exception 'Unknown set.'; end if;
  select count(*), count(*) filter (where correct),
         count(*) filter (where correct and was_new),
         count(*) filter (where correct and not was_new and box_after > box_before)
    into n_answered, n_right, n_learned, n_strong
  from events where set_id = st.id;
  if n_answered < cardinality(st.card_ids) then raise exception 'set_not_complete'; end if;

  if st.finished_at is null then
    update sets set finished_at = now(), learned = n_learned, strengthened = n_strong,
      right_count = n_right, total = n_answered,
      passed = case when kind = 'readiness'
                    then n_right * 100 >= _setting_int('readiness_pass_pct', 80) * n_answered end
    where id = st.id returning * into st;
  end if;
  lvl := _check_level(s.id);

  if st.kind = 'readiness' then
    select coalesce(jsonb_agg(jsonb_build_object('track', track, 'unit', unit, 'cards', n) order by n desc, unit), '[]'::jsonb)
      into practise
    from (select t.name track, u.name unit, count(*) n from events e
          join cards c on c.id = e.card_id join units u on u.id = c.unit_id join tracks t on t.id = c.track_id
          where e.set_id = st.id and not e.correct group by t.name, u.name) x;
  end if;

  return jsonb_build_object(
    'kind', st.kind, 'learned', st.learned, 'strengthened', st.strengthened,
    'practised', st.total, 'passed', st.passed, 'practise', practise,
    'level', lvl, 'level_name', _level_name(lvl), 'level_up', lvl > s.level,
    'rhythm', _rhythm(s), 'team', _team(s));
end;
$$;

-- Review my misses: never scored, never counts toward progress, so the phone
-- doesn't send these answers back.
create or replace function public.my_misses() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := _me(); ids text[];
begin
  select coalesce(array_agg(card_id order by last_seen_at desc), '{}') into ids from (
    select x.card_id, x.last_seen_at from card_state x join cards c on c.id = x.card_id
    where x.staff_id = s.id and x.last_result = false and c.status = 'live'
    order by x.last_seen_at desc limit 30) y;
  return _cards_json(ids);
end;
$$;

-- My progress.
create or replace function public.my_progress() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := _me(); scope int := least(3, s.level + 1); tracks jsonb; focus jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', track_id, 'name', track, 'live', live, 'mastered', mastered, 'pct', pct) order by sort)
    into tracks from _mastery(s, scope) where live > 0;

  -- Next focus: the unit with the most "not yet" cards; otherwise the unit new cards come from next.
  select jsonb_build_object('track', t.name, 'unit', u.name, 'reason', 'not_yet') into focus
  from card_state x join cards c on c.id = x.card_id join units u on u.id = c.unit_id join tracks t on t.id = c.track_id
  where x.staff_id = s.id and x.last_result = false and _in_scope(s, c)
  group by t.name, u.name order by count(*) desc, u.name limit 1;
  if focus is null then
    select jsonb_build_object('track', t.name, 'unit', u.name, 'reason', 'new') into focus
    from cards c join units u on u.id = c.unit_id join tracks t on t.id = c.track_id
    where _in_scope(s, c) and not exists (select 1 from card_state x where x.staff_id = s.id and x.card_id = c.id)
    order by c.level, u.sort, t.sort, u.id, c.id limit 1;
  end if;

  return jsonb_build_object(
    'first_name', s.first_name,
    'level', s.level, 'level_name', _level_name(s.level),
    'next_level_name', case when s.level < 3 then _level_name(s.level + 1) end,
    'tracks', coalesce(tracks, '[]'::jsonb),
    'confidence', (select jsonb_build_object(
        'right_sure',      count(*) filter (where x.last_result and x.last_confidence = 'sure'),
        'right_not_sure',  count(*) filter (where x.last_result and x.last_confidence <> 'sure'),
        'not_yet_not_sure',count(*) filter (where not x.last_result and x.last_confidence <> 'sure'),
        'not_yet_sure',    count(*) filter (where not x.last_result and x.last_confidence = 'sure'))
      from card_state x join cards c on c.id = x.card_id where x.staff_id = s.id and _in_scope(s, c)),
    'strengths', (select coalesce(jsonb_agg(name), '[]'::jsonb) from (
        select track name from _mastery(s, scope) where live > 0 and pct > 0 order by pct desc, sort limit 2) y),
    'next_focus', focus,
    'level1', case when s.level = 0 then jsonb_build_object(
        'mastery_pct', _level1_pct(s),
        'mastery_target', _setting_int('level1_mastery_pct', 80),
        'readiness_passed', exists (select 1 from sets where staff_id = s.id and kind = 'readiness' and passed),
        'readiness_cards', _setting_int('readiness_check_cards', 20),
        'readiness_pass_pct', _setting_int('readiness_pass_pct', 80),
        'signoffs', (select jsonb_agg(jsonb_build_object('id', k ->> 'id', 'name', k ->> 'name',
                       'done', exists (select 1 from signoffs where staff_id = s.id and skill = k ->> 'id')))
                     from jsonb_array_elements(_level1_skills()) k)) end,
    'level2', case when s.level = 1 then jsonb_build_object(
        'mastery_target', _setting_int('level2_mastery_pct', 70),
        'signoff', exists (select 1 from signoffs where staff_id = s.id and skill = 'level2_signoff')) end,
    'rhythm', _rhythm(s));
end;
$$;

-- Test mode: a test account moves its own date forward to see spacing work.
create or replace function public.test_move_date(p_days int default 1) returns int
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); n int;
begin
  if not s.is_test then raise exception 'Only test accounts can change the date.'; end if;
  if p_days not between 1 and 30 then raise exception 'Move between 1 and 30 days.'; end if;
  update staff set test_day_offset = least(400, test_day_offset + p_days) where id = s.id
  returning test_day_offset into n;
  return n;
end;
$$;

-- Test mode: start a test account again from nothing.
create or replace function public.test_reset() returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me();
begin
  if not s.is_test then raise exception 'Only test accounts can be reset.'; end if;
  delete from coaching_prompts where staff_id = s.id;
  delete from events where staff_id = s.id;
  delete from sets where staff_id = s.id;
  delete from card_state where staff_id = s.id;
  delete from level_history where staff_id = s.id;
  update staff set test_day_offset = 0, level = 0 where id = s.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the studio calls (admin, or the venue's manager)
-- ---------------------------------------------------------------------------

create or replace function public.create_staff(
  p_staff_number text, p_first_name text, p_last_initial text, p_venue_id text, p_role text,
  p_start_month date default null, p_is_test boolean default false, p_weekly_target int default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_manager_for(p_venue_id) then raise exception 'Not allowed for this venue.'; end if;
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

-- A new single-use code (also how a PIN is reset). Shown once; only its hash is kept.
create or replace function public.issue_activation_code(p_staff_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff; alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; raw bytea; code text := ''; i int; exp timestamptz;
begin
  select * into s from staff where id = p_staff_id;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  if not s.active then raise exception 'This person is inactive.'; end if;
  raw := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
  -- skip the uuid version and variant bytes (6, 8, 22, 24)
  foreach i in array array[0,1,2,3,4,5,7,9,10,11] loop
    code := code || substr(alphabet, 1 + get_byte(raw, i) % 31, 1);
  end loop;
  code := substr(code, 1, 5) || '-' || substr(code, 6, 5);
  exp := now() + make_interval(days => _setting_int('activation_code_days', 7));
  update activation_codes set expires_at = least(expires_at, now()) where staff_id = s.id and used_at is null;
  insert into activation_codes (code_hash, staff_id, created_by, expires_at)
  values (encode(sha256(convert_to(replace(code, '-', ''), 'UTF8')), 'hex'), s.id, public.current_display_name(), exp);
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(),
          case when s.user_id is null then 'activation_code_issued' else 'pin_reset_issued' end,
          'staff', s.id::text, jsonb_build_object('expires_at', exp));
  return jsonb_build_object('code', code, 'staff_number', s.staff_number, 'expires_at', exp);
end;
$$;

create or replace function public.list_staff() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'staff_number', p.staff_number, 'first_name', p.first_name, 'last_initial', p.last_initial,
      'venue_id', p.venue_id, 'role', p.role, 'level', p.level, 'active', p.active, 'is_test', p.is_test,
      'test_day_offset', p.test_day_offset, 'activated', p.user_id is not null,
      'privacy_accepted_at', p.privacy_accepted_at,
      'code_expires_at', (select max(expires_at) from activation_codes a
                          where a.staff_id = p.id and a.used_at is null and a.expires_at > now()),
      'last_set_on', (select max(local_date) from sets x where x.staff_id = p.id and x.finished_at is not null)
    ) order by p.is_test, p.venue_id, p.first_name), '[]'::jsonb)
  from staff p where public.is_manager_for(p.venue_id);
$$;

create or replace function public.set_staff_active(p_staff_id uuid, p_active boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff;
begin
  select * into s from staff where id = p_staff_id;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  update staff set active = p_active, deactivated_at = case when p_active then null else now() end where id = s.id;
  if not p_active then
    update activation_codes set expires_at = least(expires_at, now()) where staff_id = s.id and used_at is null;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id)
  values (auth.uid(), public.current_display_name(), case when p_active then 'staff_reactivated' else 'staff_deactivated' end,
          'staff', s.id::text);
end;
$$;

create or replace function public.list_venues() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
  from venues where active and public.is_manager_for(id);
$$;

-- ---------------------------------------------------------------------------
-- Login functions (called only by the server, with the service role)
-- ---------------------------------------------------------------------------

create or replace function public.svc_code_staff(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_id', s.id, 'staff_number', s.staff_number, 'first_name', s.first_name,
                            'user_id', s.user_id)
  from activation_codes a join staff s on s.id = a.staff_id
  where a.code_hash = encode(sha256(convert_to(upper(replace(replace(trim(p_code), '-', ''), ' ', '')), 'UTF8')), 'hex')
    and a.used_at is null and a.expires_at > now() and s.active;
$$;

create or replace function public.svc_complete_activation(
  p_code text, p_user_id uuid, p_pin_hash text, p_privacy_version text
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid; s staff;
begin
  if p_privacy_version is distinct from (select value #>> '{}' from settings where key = 'privacy_notice_version') then
    raise exception 'privacy_version';
  end if;
  update activation_codes set used_at = now()
  where code_hash = encode(sha256(convert_to(upper(replace(replace(trim(p_code), '-', ''), ' ', '')), 'UTF8')), 'hex')
    and used_at is null and expires_at > now()
  returning staff_id into sid;
  if sid is null then raise exception 'code_invalid'; end if;
  update staff set user_id = p_user_id, privacy_version = p_privacy_version, privacy_accepted_at = now()
  where id = sid and active returning * into s;
  if s.id is null then raise exception 'code_invalid'; end if;
  insert into staff_secrets (staff_id, pin_hash, failed_attempts, locked_until, pin_set_at, last_login_at)
  values (sid, p_pin_hash, 0, null, now(), now())
  on conflict (staff_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0,
    locked_until = null, pin_set_at = now(), last_login_at = now();
  insert into audit_log (actor, action, entity, entity_id, detail)
  values ('Staff app', 'staff_activated', 'staff', sid::text,
          jsonb_build_object('privacy_version', p_privacy_version));
  return jsonb_build_object('staff_id', sid, 'staff_number', s.staff_number, 'first_name', s.first_name);
end;
$$;

create or replace function public.svc_login_lookup(p_staff_number text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_id', s.id, 'user_id', s.user_id, 'pin_hash', k.pin_hash,
                            'locked', coalesce(k.locked_until > now(), false))
  from staff s join staff_secrets k on k.staff_id = s.id
  where s.staff_number = upper(trim(p_staff_number)) and s.active and s.user_id is not null;
$$;

create or replace function public.svc_login_result(p_staff_id uuid, p_ok boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if p_ok then
    update staff_secrets set failed_attempts = 0, locked_until = null, last_login_at = now()
    where staff_id = p_staff_id;
  else
    update staff_secrets set
      failed_attempts = case when failed_attempts + 1 >= _setting_int('login_max_attempts', 5) then 0
                             else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= _setting_int('login_max_attempts', 5)
                          then now() + make_interval(mins => _setting_int('login_pause_minutes', 15))
                          else locked_until end
    where staff_id = p_staff_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and who may call what
-- ---------------------------------------------------------------------------

alter table public.venues           enable row level security;
alter table public.staff            enable row level security;
alter table public.staff_secrets    enable row level security;
alter table public.activation_codes enable row level security;
alter table public.card_state       enable row level security;
alter table public.sets             enable row level security;
alter table public.events           enable row level security;
alter table public.coaching_prompts enable row level security;
alter table public.signoffs         enable row level security;
alter table public.level_history    enable row level security;
alter table public.rhythm_pauses    enable row level security;

-- Nobody signed out reads anything.
revoke all on public.venues, public.staff, public.staff_secrets, public.activation_codes, public.card_state,
  public.sets, public.events, public.coaching_prompts, public.signoffs, public.level_history,
  public.rhythm_pauses from anon;
-- staff_secrets and activation_codes: no policies, so no app user can read or write them.
revoke all on public.staff_secrets, public.activation_codes from authenticated;

drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues for select to authenticated
  using (public.is_manager_for(id) or exists (select 1 from staff s where s.user_id = auth.uid() and s.venue_id = venues.id));

drop policy if exists staff_read on public.staff;
create policy staff_read on public.staff for select to authenticated
  using (user_id = auth.uid() or public.is_manager_for(venue_id));

drop policy if exists card_state_read on public.card_state;
create policy card_state_read on public.card_state for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and (s.user_id = auth.uid() or public.is_manager_for(s.venue_id))));

drop policy if exists sets_read on public.sets;
create policy sets_read on public.sets for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and (s.user_id = auth.uid() or public.is_manager_for(s.venue_id))));

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and (s.user_id = auth.uid() or public.is_manager_for(s.venue_id))));

drop policy if exists signoffs_read on public.signoffs;
create policy signoffs_read on public.signoffs for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and (s.user_id = auth.uid() or public.is_manager_for(s.venue_id))));

drop policy if exists level_history_read on public.level_history;
create policy level_history_read on public.level_history for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and (s.user_id = auth.uid() or public.is_manager_for(s.venue_id))));

drop policy if exists rhythm_pauses_read on public.rhythm_pauses;
create policy rhythm_pauses_read on public.rhythm_pauses for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and (s.user_id = auth.uid() or public.is_manager_for(s.venue_id))));

-- Private coaching prompts: the venue's manager and the admin only, never the person.
drop policy if exists coaching_read on public.coaching_prompts;
create policy coaching_read on public.coaching_prompts for select to authenticated
  using (public.is_manager_for(venue_id));

-- Internal helpers: not callable from the app at all.
revoke execute on function public._setting_int(text, int), public._me(), public._today(public.staff),
  public._gap(int), public._in_scope(public.staff, public.cards), public._is_right(public.cards, jsonb),
  public._cards_json(text[]), public._pick_daily(public.staff, date), public._target(public.staff),
  public._sets_in_week(uuid, date), public._rhythm(public.staff), public._team(public.staff),
  public._mastery(public.staff, int), public._level1_pct(public.staff), public._level_name(int),
  public._level1_skills(), public._check_level(uuid), public.events_append_only()
  from public, anon, authenticated;

-- Login functions: the server only.
revoke execute on function public.svc_code_staff(text), public.svc_complete_activation(text, uuid, text, text),
  public.svc_login_lookup(text), public.svc_login_result(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.svc_code_staff(text), public.svc_complete_activation(text, uuid, text, text),
  public.svc_login_lookup(text), public.svc_login_result(uuid, boolean)
  to service_role;

-- App functions: signed-in people only (each checks who is asking).
revoke execute on function public.staff_home(), public.start_daily_set(), public.start_readiness(),
  public.record_answer(uuid, uuid, text, jsonb, text, timestamptz), public.finish_set(uuid), public.my_misses(),
  public.my_progress(), public.test_move_date(int), public.test_reset(),
  public.create_staff(text, text, text, text, text, date, boolean, int), public.issue_activation_code(uuid),
  public.list_staff(), public.set_staff_active(uuid, boolean), public.list_venues(), public.is_manager_for(text)
  from public, anon;
grant execute on function public.staff_home(), public.start_daily_set(), public.start_readiness(),
  public.record_answer(uuid, uuid, text, jsonb, text, timestamptz), public.finish_set(uuid), public.my_misses(),
  public.my_progress(), public.test_move_date(int), public.test_reset(),
  public.create_staff(text, text, text, text, text, date, boolean, int), public.issue_activation_code(uuid),
  public.list_staff(), public.set_staff_active(uuid, boolean), public.list_venues(), public.is_manager_for(text)
  to authenticated;

select 'staff app ready' as result,
       (select count(*) from venues) as venues,
       (select count(*) from cards where status = 'live') as live_cards;
