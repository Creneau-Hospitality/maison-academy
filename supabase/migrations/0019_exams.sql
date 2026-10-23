-- Maison Academy · 0019 exams
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Managers schedule an exam on a topic (a track, or one unit of it) for chosen
-- roles at a venue, on one date or every week on that weekday (David, 23 October):
--   * that day the exam replaces the person's 5-card daily set;
--   * each person gets their own cards from the topic (default 20): cards they
--     missed first, then ones they don't know yet, then the rest;
--   * it's kept separately as an exam score, and doesn't count toward the weekly target;
--   * only managers schedule exams: the admin anywhere, a venue manager for their venue.
-- Exam answers don't move cards up; a "not yet" sends the card back to box 1, so it
-- returns in the next daily set (as any "not yet" does).
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.exams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(trim(name)) between 1 and 80),
  venue_id      text references public.venues(id),          -- null = every venue (admin only)
  roles         text[] not null check (cardinality(roles) > 0),
  track_id      text not null references public.tracks(id),
  unit_id       text references public.units(id),            -- null = the whole track
  card_count    int  not null default 20 check (card_count between 5 and 40),
  exam_date     date not null,
  repeat_weekly boolean not null default false,              -- every week on exam_date's weekday
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    text
);
alter table public.exams enable row level security;
revoke all on public.exams from anon;
drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams for select to authenticated
  using (public.is_admin() or (venue_id is null and exists (select 1 from user_roles where user_id = auth.uid() and role = 'venue_manager'))
         or public.is_manager_for(venue_id));

alter table public.sets add column if not exists exam_id uuid references public.exams(id) on delete set null;
alter table public.sets drop constraint if exists sets_kind_check;
alter table public.sets add constraint sets_kind_check check (kind in ('daily', 'readiness', 'exam'));
create unique index if not exists sets_one_exam on public.sets (staff_id, exam_id, local_date) where kind = 'exam';

-- ---------------------------------------------------------------------------
-- Which exam (if any) a person has on a given day, and their cards for it
-- ---------------------------------------------------------------------------
create or replace function public._exam_on(e public.exams, d date) returns boolean
language sql immutable as $$
  select e.exam_date = d
      or (e.repeat_weekly and d > e.exam_date and extract(isodow from d) = extract(isodow from e.exam_date));
$$;

create or replace function public._exam_pool(e public.exams, p_role text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from cards c
  where c.status = 'live' and p_role = any(c.roles) and c.track_id = e.track_id and (e.unit_id is null or c.unit_id = e.unit_id);
$$;

create or replace function public._exam_today(s public.staff, d date) returns public.exams
language sql stable security definer set search_path = public as $$
  select e.* from exams e
  where e.active and (e.venue_id is null or e.venue_id = s.venue_id) and s.role = any(e.roles) and _exam_on(e, d)
    and _exam_pool(e, s.role) > 0      -- no cards for this role: no exam, the daily set carries on
  order by e.created_at limit 1;
$$;

create or replace function public._pick_exam(s public.staff, e public.exams) returns text[]
language sql volatile security definer set search_path = public as $$
  select coalesce(array_agg(id order by grp, rnd), '{}') from (
    select c.id,
           case when st.last_result = false then 0 when st.box is null or st.box < 4 then 1 else 2 end grp,
           random() rnd
    from cards c left join card_state st on st.staff_id = s.id and st.card_id = c.id
    where c.status = 'live' and s.role = any(c.roles) and c.track_id = e.track_id
      and (e.unit_id is null or c.unit_id = e.unit_id)
    order by grp, rnd
    limit e.card_count
  ) x;
$$;

create or replace function public._topic_name(e public.exams) returns text
language sql stable security definer set search_path = public as $$
  select t.name || coalesce(': ' || u.name, '') from tracks t left join units u on u.id = e.unit_id where t.id = e.track_id;
$$;

-- ---------------------------------------------------------------------------
-- Staff: start today's exam
-- ---------------------------------------------------------------------------
create or replace function public.start_exam(p_lat float8 default null, p_lng float8 default null, p_accuracy float8 default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); e exams; st sets; ids text[]; here boolean;
begin
  e := _exam_today(s, d);
  if e.id is null then raise exception 'No exam today.'; end if;
  here := _check_on_site(s, p_lat, p_lng, p_accuracy);
  select * into st from sets where staff_id = s.id and kind = 'exam' and exam_id = e.id and local_date = d;
  if st.id is null then
    ids := _pick_exam(s, e);
    if cardinality(ids) = 0 then
      return jsonb_build_object('set', null, 'cards', '[]'::jsonb, 'answered', '[]'::jsonb);
    end if;
    insert into sets (staff_id, kind, local_date, card_ids, on_site, exam_id) values (s.id, 'exam', d, ids, here, e.id)
    on conflict do nothing;
    select * into st from sets where staff_id = s.id and kind = 'exam' and exam_id = e.id and local_date = d;
  end if;
  return jsonb_build_object(
    'set', jsonb_build_object('id', st.id, 'kind', st.kind, 'local_date', st.local_date,
                              'finished', st.finished_at is not null),
    'exam', jsonb_build_object('name', e.name, 'topic', _topic_name(e)),
    'cards', _cards_json(st.card_ids),
    'answered', (select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'correct', correct)), '[]'::jsonb)
                 from events where set_id = st.id));
end;
$$;

-- On an exam day there is no daily set (it's replaced by the exam).
create or replace function public.start_daily_set(p_lat float8 default null, p_lng float8 default null, p_accuracy float8 default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets; ids text[]; here boolean;
begin
  here := _check_on_site(s, p_lat, p_lng, p_accuracy);
  select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  if st.id is null then
    if (_exam_today(s, d)).id is not null then raise exception 'exam_today'; end if;
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

-- ---------------------------------------------------------------------------
-- Answers and finishing: exam branch
-- ---------------------------------------------------------------------------
create or replace function public._apply_answer(
  s public.staff, st public.sets, c public.cards, p_chosen jsonb, p_confidence text,
  p_client_event_id uuid, p_answered_at timestamptz
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare cs card_state; ok boolean; is_new boolean; b_before int; b_after int; max_box int;
begin
  ok := _is_right(c, p_chosen);
  if st.kind = 'daily' then
    select * into cs from card_state where staff_id = s.id and card_id = c.id for update;
    is_new := cs.staff_id is null;
    b_before := coalesce(cs.box, 1);
    max_box := case when c.is_allergen then _setting_int('allergen_max_box', 5) else 6 end;
    b_after := case
      when ok and coalesce(p_confidence, 'sure') in ('sure', 'think') then least(b_before + 1, max_box)
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
  elsif st.kind = 'exam' then
    -- An exam never moves a card up; a "not yet" sends it back to box 1, due in the next daily set.
    select * into cs from card_state where staff_id = s.id and card_id = c.id for update;
    b_before := coalesce(cs.box, 1);
    b_after := case when ok then b_before else 1 end;
    if not ok then
      insert into card_state as x (staff_id, card_id, box, due_on, last_result, last_confidence,
                                   times_seen, times_right, first_seen_on, last_seen_on)
      values (s.id, c.id, 1, st.local_date, false, null, 1, 0, st.local_date, st.local_date)
      on conflict (staff_id, card_id) do update set
        box = 1, due_on = excluded.due_on, last_result = false, times_seen = x.times_seen + 1,
        last_seen_on = excluded.last_seen_on, last_seen_at = now();
    end if;
  end if;

  insert into events (client_event_id, staff_id, set_id, set_kind, card_id, card_version, chosen,
                      correct, confidence, was_new, box_before, box_after, local_date, answered_at)
  values (p_client_event_id, s.id, st.id, st.kind, c.id, c.version, p_chosen, ok, p_confidence,
          coalesce(is_new, false), b_before, b_after, st.local_date,
          least(coalesce(p_answered_at, now()), now()));

  if not ok and p_confidence = 'sure' and c.is_allergen and not exists (
       select 1 from coaching_prompts where staff_id = s.id and card_id = c.id and resolved_at is null) then
    insert into coaching_prompts (staff_id, venue_id, card_id) values (s.id, s.venue_id, c.id);
  end if;
  return jsonb_build_object('correct', ok, 'box', b_after);
end;
$$;

create or replace function public._finish_set(s public.staff, st public.sets) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n_answered int; n_right int; n_learned int; n_strong int; lvl int; practise jsonb; e exams;
begin
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
  if st.kind in ('readiness', 'exam') then
    select coalesce(jsonb_agg(jsonb_build_object('track', track, 'unit', unit, 'cards', n) order by n desc, unit), '[]'::jsonb)
      into practise
    from (select t.name track, u.name unit, count(*) n from events ev
          join cards c on c.id = ev.card_id join units u on u.id = c.unit_id join tracks t on t.id = c.track_id
          where ev.set_id = st.id and not ev.correct group by t.name, u.name) x;
  end if;
  if st.kind = 'exam' then select * into e from exams where id = st.exam_id; end if;
  return jsonb_build_object(
    'kind', st.kind, 'learned', st.learned, 'strengthened', st.strengthened,
    'practised', st.total, 'passed', st.passed, 'practise', practise,
    'right', st.right_count, 'total', st.total,
    'exam', case when e.id is not null then jsonb_build_object('name', e.name, 'topic', _topic_name(e)) end,
    'level', lvl, 'level_name', _level_name(lvl), 'level_up', lvl > s.level,
    'rhythm', _rhythm(s), 'team', _team(s));
end;
$$;

-- ---------------------------------------------------------------------------
-- Home screen: today's exam
-- ---------------------------------------------------------------------------
create or replace function public.staff_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets; m text := _setting_text('reminders_mode', 'off'); e exams; ex sets;
begin
  select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  e := _exam_today(s, d);
  if e.id is not null then
    select * into ex from sets where staff_id = s.id and kind = 'exam' and exam_id = e.id and local_date = d;
  end if;
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
    'exam_today', case when e.id is null then null else jsonb_build_object(
        'name', e.name, 'topic', _topic_name(e),
        'cards', case when ex.id is not null then cardinality(ex.card_ids) else least(e.card_count, _exam_pool(e, s.role)) end,
        'started', ex.id is not null,
        'finished', ex.finished_at is not null,
        'answered', case when ex.id is not null then (select count(*) from events where set_id = ex.id) else 0 end,
        'right', ex.right_count, 'total', ex.total) end,
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

-- ---------------------------------------------------------------------------
-- Reminders: on an exam day, remind about the exam (even if the weekly target is met)
-- ---------------------------------------------------------------------------
create or replace function public.svc_due_reminders() returns jsonb
language sql stable security definer set search_path = public as $$
  with mode as (select _setting_text('reminders_mode', 'off') m),
  ppl as (
    select s.id, s.first_name, s.role,
           to_char(now() at time zone v.timezone, 'HH24:MI') local_time,
           (now() at time zone v.timezone)::date local_today,
           _today(s) set_day,
           _sets_in_week(s.id, date_trunc('week', _today(s)::timestamp)::date) wk_sets,
           _target(s) target,
           (_exam_today(s, _today(s))).id exam_id
    from staff s join venues v on v.id = s.venue_id cross join mode
    where s.active and s.user_id is not null
      and (mode.m = 'all' or (mode.m = 'test' and s.is_test))
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', p.id, 'first_name', p.first_name, 'local_date', p.local_today,
           'exam', (select jsonb_build_object('topic', _topic_name(e), 'cards', least(e.card_count, _exam_pool(e, p.role)))
                    from exams e where e.id = p.exam_id),
           'subs', (select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
                    from push_subscriptions ps where ps.staff_id = p.id))), '[]'::jsonb)
  from ppl p
  where exists (select 1 from push_subscriptions ps where ps.staff_id = p.id)
    and p.local_time >= _setting_text('reminder_time', '10:00')
    and not exists (select 1 from reminder_log rl where rl.staff_id = p.id and rl.local_date = p.local_today)
    and case
          when p.exam_id is not null then
            not exists (select 1 from sets x where x.staff_id = p.id and x.kind = 'exam' and x.exam_id = p.exam_id
                        and x.local_date = p.set_day and x.finished_at is not null)
          else
            not exists (select 1 from sets x where x.staff_id = p.id and x.kind = 'daily' and x.finished_at is not null
                        and x.local_date = p.set_day)
            and p.wk_sets < p.target
        end;
$$;

-- ---------------------------------------------------------------------------
-- Managers: topics, scheduling, results
-- ---------------------------------------------------------------------------
create or replace function public._can_manage_exam(p_venue text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_venue is null then public.is_admin() else public.is_manager_for(p_venue) end;
$$;

-- Topics with how many live cards each role would draw from.
create or replace function public.exam_topics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from user_roles where user_id = auth.uid() and role = 'venue_manager')) then
    raise exception 'Only managers can schedule exams.';
  end if;
  return (
    with live as (select c.track_id, c.unit_id, r.role from cards c cross join unnest(c.roles) r(role) where c.status = 'live'),
    per_unit as (
      select t.id track_id, t.name track, t.sort tsort, u.id unit_id, u.name unit, u.sort usort,
             (select jsonb_object_agg(role, n) from (select role, count(*) n from live l where l.unit_id = u.id group by role) z) counts
      from tracks t join units u on u.track_id = t.id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'track_id', track_id, 'track', track,
             'counts', (select jsonb_object_agg(role, n) from (select role, count(*) n from live l where l.track_id = g.track_id group by role) z),
             'units', units) order by tsort, track), '[]'::jsonb)
    from (select track_id, track, tsort,
                 jsonb_agg(jsonb_build_object('unit_id', unit_id, 'unit', unit, 'counts', coalesce(counts, '{}'::jsonb)) order by usort, unit)
                   filter (where counts is not null) units
          from per_unit group by track_id, track, tsort) g
    where units is not null
  );
end;
$$;

create or replace function public.save_exam(
  p_id uuid, p_name text, p_venue text, p_roles text[], p_track text, p_unit text,
  p_count int, p_date date, p_weekly boolean, p_active boolean default true
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare eid uuid := p_id; old exams; v text := nullif(p_venue, ''); u text := nullif(p_unit, '');
begin
  if not _can_manage_exam(v) then
    raise exception '%', case when v is null then 'Only the admin can schedule an exam for every venue.' else 'Not allowed for this venue.' end;
  end if;
  if eid is not null then
    select * into old from exams where id = eid;
    if old.id is null then raise exception 'Unknown exam.'; end if;
    if not _can_manage_exam(old.venue_id) then raise exception 'Not allowed for this exam.'; end if;
  end if;
  if coalesce(cardinality(p_roles), 0) = 0 then raise exception 'Pick at least one role.'; end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('host', 'server', 'runner', 'bar', 'barista')) then
    raise exception 'Unknown role.';
  end if;
  if not exists (select 1 from tracks where id = p_track) then raise exception 'Pick a topic.'; end if;
  if u is not null and not exists (select 1 from units where id = u and track_id = p_track) then
    raise exception 'That part doesn''t belong to the topic.';
  end if;
  if p_count is null or p_count not between 5 and 40 then raise exception 'Cards per person: between 5 and 40.'; end if;
  if p_date is null then raise exception 'Pick a date.'; end if;
  if eid is null and p_date < _venue_today(v) then raise exception 'Pick today or a later date.'; end if;
  if not exists (select 1 from cards c where c.status = 'live' and c.track_id = p_track and (u is null or c.unit_id = u)
                 and c.roles && p_roles) then
    raise exception 'No live cards in this topic for these roles yet.';
  end if;
  if eid is null then
    insert into exams (name, venue_id, roles, track_id, unit_id, card_count, exam_date, repeat_weekly, active, created_by)
    values (trim(p_name), v, p_roles, p_track, u, p_count, p_date, coalesce(p_weekly, false), coalesce(p_active, true),
            public.current_display_name())
    returning id into eid;
  else
    update exams set name = trim(p_name), venue_id = v, roles = p_roles, track_id = p_track, unit_id = u,
      card_count = p_count, exam_date = p_date, repeat_weekly = coalesce(p_weekly, false),
      active = coalesce(p_active, active) where id = eid;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'exam_saved', 'exam', eid::text,
          jsonb_build_object('track', p_track, 'unit', u, 'roles', p_roles, 'date', p_date, 'weekly', p_weekly, 'active', p_active));
  return eid;
end;
$$;

create or replace function public.set_exam_active(p_id uuid, p_active boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
declare e exams;
begin
  select * into e from exams where id = p_id;
  if e.id is null then raise exception 'Unknown exam.'; end if;
  if not _can_manage_exam(e.venue_id) then raise exception 'Not allowed for this exam.'; end if;
  update exams set active = p_active where id = p_id;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), case when p_active then 'exam_resumed' else 'exam_stopped' end,
          'exam', p_id::text, '{}'::jsonb);
end;
$$;

-- Most recent date on or before p_day, and the next one on or after it.
create or replace function public._exam_last(e public.exams, p_day date) returns date
language sql immutable as $$
  select case when p_day < e.exam_date then null
              when not e.repeat_weekly then e.exam_date
              else e.exam_date + 7 * ((p_day - e.exam_date) / 7) end;
$$;
create or replace function public._exam_next(e public.exams, p_day date) returns date
language sql immutable as $$
  select case when p_day <= e.exam_date then e.exam_date
              when not e.repeat_weekly then null
              else e.exam_date + 7 * ((p_day - e.exam_date + 6) / 7) end;
$$;

create or replace function public._exam_people(e public.exams, p_venue text, p_include_test boolean) returns setof public.staff
language sql stable security definer set search_path = public as $$
  select s.* from _dash_staff(coalesce(e.venue_id, p_venue), p_include_test) s
  where s.role = any(e.roles) and (p_venue is null or s.venue_id = p_venue);
$$;

create or replace function public.dash_exams(p_venue text default null, p_include_test boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from user_roles where user_id = auth.uid() and role = 'venue_manager')) then
    raise exception 'Not allowed.';
  end if;
  return (
    select coalesce(jsonb_agg(item order by (item ->> 'sort_date') desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', e.id, 'name', e.name, 'topic', _topic_name(e), 'track_id', e.track_id, 'unit_id', e.unit_id,
        'roles', e.roles, 'venue_id', e.venue_id,
        'venue', coalesce((select name from venues where id = e.venue_id), 'Every venue'),
        'card_count', e.card_count, 'exam_date', e.exam_date, 'repeat_weekly', e.repeat_weekly, 'active', e.active,
        'can_edit', _can_manage_exam(e.venue_id),
        'last_date', lst, 'next_date', case when e.active then nxt end,
        'invited', (select count(*) from _exam_people(e, p_venue, p_include_test)),
        'done', case when lst is null then 0 else (
           select count(*) from sets x join _exam_people(e, p_venue, p_include_test) s on s.id = x.staff_id
           where x.kind = 'exam' and x.exam_id = e.id and x.local_date = lst and x.finished_at is not null) end,
        'avg_pct', case when lst is null then null else (
           select round(100.0 * sum(x.right_count) / nullif(sum(x.total), 0))::int
           from sets x join _exam_people(e, p_venue, p_include_test) s on s.id = x.staff_id
           where x.kind = 'exam' and x.exam_id = e.id and x.local_date = lst and x.finished_at is not null) end,
        'sort_date', coalesce(case when e.active then nxt end, lst, e.exam_date)) item
      from exams e
      cross join lateral (select _exam_last(e, _venue_today(coalesce(e.venue_id, p_venue))) lst,
                                 _exam_next(e, _venue_today(coalesce(e.venue_id, p_venue))) nxt) d
      where (public.is_admin() or e.venue_id is null or public.is_manager_for(e.venue_id))
        and (p_venue is null or e.venue_id is null or e.venue_id = p_venue)
    ) z
  );
end;
$$;

create or replace function public.dash_exam_results(
  p_exam uuid, p_date date default null, p_venue text default null, p_include_test boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e exams; d date; today date;
begin
  select * into e from exams where id = p_exam;
  if e.id is null or not (public.is_admin() or e.venue_id is null or public.is_manager_for(e.venue_id)) then
    raise exception 'Not allowed.';
  end if;
  today := _venue_today(coalesce(e.venue_id, p_venue));
  d := coalesce(p_date, _exam_last(e, today), e.exam_date);
  return jsonb_build_object(
    'exam', jsonb_build_object('id', e.id, 'name', e.name, 'topic', _topic_name(e), 'roles', e.roles, 'card_count', e.card_count),
    'date', d,
    'dates', (select coalesce(jsonb_agg(x order by x desc), '[]'::jsonb) from (
                select gs::date x from generate_series(e.exam_date, coalesce(_exam_last(e, today), e.exam_date), interval '7 days') gs
                where e.repeat_weekly or gs::date = e.exam_date
                order by 1 desc limit 12) z),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                  'staff_id', s.id, 'name', _name(s), 'role', s.role, 'is_test', s.is_test,
                  'venue', (select name from venues where id = s.venue_id),
                  'done', x.finished_at is not null, 'started', x.id is not null,
                  'right', x.right_count, 'total', x.total,
                  'pct', case when x.total > 0 then round(100.0 * x.right_count / x.total)::int end)
                  order by (x.finished_at is null), case when x.total > 0 then x.right_count::float / x.total end desc nulls last, s.first_name), '[]'::jsonb)
               from _exam_people(e, p_venue, p_include_test) s
               left join sets x on x.staff_id = s.id and x.kind = 'exam' and x.exam_id = e.id and x.local_date = d),
    'practise', (select coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'pct', pct, 'answers', n) order by pct, unit), '[]'::jsonb) from (
                   select u.name unit, count(*) n, round(100.0 * count(*) filter (where ev.correct) / count(*))::int pct
                   from events ev join sets x on x.id = ev.set_id join _exam_people(e, p_venue, p_include_test) s on s.id = x.staff_id
                   join cards c on c.id = ev.card_id join units u on u.id = c.unit_id
                   where x.kind = 'exam' and x.exam_id = e.id and x.local_date = d
                   group by u.name) z)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public._exam_on(public.exams, date), public._exam_today(public.staff, date),
  public._exam_pool(public.exams, text), public._pick_exam(public.staff, public.exams), public._topic_name(public.exams),
  public._can_manage_exam(text), public._exam_last(public.exams, date), public._exam_next(public.exams, date),
  public._exam_people(public.exams, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.start_exam(float8, float8, float8), public.exam_topics(),
  public.save_exam(uuid, text, text, text[], text, text, int, date, boolean, boolean), public.set_exam_active(uuid, boolean),
  public.dash_exams(text, boolean), public.dash_exam_results(uuid, date, text, boolean)
  from public, anon;
grant execute on function public.start_exam(float8, float8, float8), public.exam_topics(),
  public.save_exam(uuid, text, text, text[], text, text, int, date, boolean, boolean), public.set_exam_active(uuid, boolean),
  public.dash_exams(text, boolean), public.dash_exam_results(uuid, date, text, boolean)
  to authenticated;
revoke execute on function public.svc_due_reminders() from public, anon, authenticated;
grant execute on function public.svc_due_reminders() to service_role;

select 'exams ready' as result;
