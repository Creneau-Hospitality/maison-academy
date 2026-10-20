-- Maison Academy · Phase 3 · Manager dashboard
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Adds: venue-manager logins, practical sign-offs, leave weeks, "new on the
-- menu" sets (which come first in staff's next sets), and the figures behind
-- the dashboard (Overview, Team, Person, Questions). Every dashboard function
-- checks who is asking: a venue manager sees their venue only; the admin sees
-- everything. Staff can't call any of them.
--
-- Also adds two server-only helpers to load and remove a demo venue of sample
-- people (test accounts), so the dashboard can be tried before real staff.
--
-- Safe to run more than once.

insert into public.settings (key, value, note) values
  ('questions_min_answers', '10', 'Questions view: answers needed before a card is shown'),
  ('questions_known_pct',   '95', 'Questions view: right first time at or above this counts as "everyone knows"'),
  ('leave_weeks_per_month', '1',  'Leave weeks that pause the rhythm, per calendar month')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- New on the menu
-- ---------------------------------------------------------------------------

create table if not exists public.menu_sets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 80),
  venue_id   text references public.venues(id),        -- null = every venue
  card_ids   text[] not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.menu_sets enable row level security;
revoke all on public.menu_sets from anon;
drop policy if exists menu_sets_read on public.menu_sets;
create policy menu_sets_read on public.menu_sets for select to authenticated
  using (public.is_admin() or (venue_id is null and exists (select 1 from user_roles where user_id = auth.uid() and role = 'venue_manager'))
         or public.is_manager_for(venue_id));

-- Menu-set cards this person still has to see (live, for their role, not yet answered since the set began).
create or replace function public._menu_todo(s public.staff) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c.id), '{}')
  from menu_sets m cross join unnest(m.card_ids) x(id) join cards c on c.id = x.id
  where m.active and (m.venue_id is null or m.venue_id = s.venue_id)
    and c.status = 'live' and s.role = any(c.roles)
    and not exists (select 1 from events e where e.staff_id = s.id and e.card_id = c.id and e.received_at >= m.created_at);
$$;

-- ---------------------------------------------------------------------------
-- Daily set, now with "new on the menu" first (brief 6.5, point 5).
-- Order: cards promised to come back ("not yet"), then menu-set cards, then
-- up to 3 due and 2 new as before.
-- ---------------------------------------------------------------------------
create or replace function public._pick_daily(s public.staff, p_today date) returns text[]
language plpgsql volatile security definer set search_path = public as $$
declare
  n_total int := _setting_int('daily_set_size', 5);
  n_due   int := _setting_int('daily_set_due', 3);
  n_new   int := _setting_int('daily_set_new', 2);
  missed text[]; menu text[]; due text[]; fresh text[]; picked text[] := '{}'; more text[]; cid text;
begin
  select coalesce(array_agg(card_id order by due_on, last_seen_at), '{}') into missed
  from card_state st join cards c on c.id = st.card_id
  where st.staff_id = s.id and st.due_on <= p_today and st.last_result = false and _in_scope(s, c);
  missed := missed[1:n_total];

  menu := _menu_todo(s);

  select coalesce(array_agg(card_id order by rn), '{}') into due from (
    select st.card_id, row_number() over (order by st.due_on, c.is_allergen desc, st.last_seen_at, c.id) rn
    from card_state st join cards c on c.id = st.card_id
    where st.staff_id = s.id and st.due_on <= p_today and st.last_result is distinct from false and _in_scope(s, c)
  ) x where rn <= n_total;

  select coalesce(array_agg(id order by rn), '{}') into fresh from (
    select c.id, row_number() over (order by c.level, u.sort, t.sort, u.id, c.id) rn
    from cards c join units u on u.id = c.unit_id join tracks t on t.id = c.track_id
    where _in_scope(s, c)
      and not exists (select 1 from card_state st where st.staff_id = s.id and st.card_id = c.id)
  ) x where rn <= n_total;

  foreach cid in array (missed || menu) loop
    exit when cardinality(picked) >= n_total;
    if not cid = any(picked) then picked := picked || cid; end if;
  end loop;
  -- then up to 3 due and 2 new, in the space left
  n_due := least(n_due, n_total - cardinality(picked));
  foreach cid in array due[1:greatest(n_due, 0)] loop
    if not cid = any(picked) then picked := picked || cid; end if;
  end loop;
  n_new := least(n_new, n_total - cardinality(picked));
  foreach cid in array fresh[1:greatest(n_new, 0)] loop
    if not cid = any(picked) then picked := picked || cid; end if;
  end loop;
  -- fill from the rest of either pool
  foreach cid in array (due || fresh) loop
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

  select coalesce(array_agg(id order by k1, k2), '{}') into picked from (
    select c.id, row_number() over (partition by c.unit_id order by random()) k1, random() k2
    from cards c where c.id = any(picked)
  ) y;
  return picked;
end;
$$;

-- ---------------------------------------------------------------------------
-- Answers and set completion as internal steps (the staff functions and the
-- demo loader both use them). Behaviour unchanged from 0015.
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

create or replace function public.record_answer(
  p_client_event_id uuid, p_set_id uuid, p_card_id text, p_chosen jsonb, p_confidence text,
  p_answered_at timestamptz default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); st sets; c cards; e events;
begin
  select * into e from events where client_event_id = p_client_event_id;
  if e.id is not null then
    if e.staff_id <> s.id then raise exception 'Not allowed.'; end if;
    return jsonb_build_object('correct', e.correct, 'duplicate', true);
  end if;
  if p_confidence is not null and p_confidence not in ('sure', 'think', 'guess') then raise exception 'Unknown confidence.'; end if;
  if jsonb_typeof(p_chosen) is distinct from 'array' then raise exception 'Answer must be a list.'; end if;
  select * into st from sets where id = p_set_id and staff_id = s.id;
  if st.id is null then raise exception 'Unknown set.'; end if;
  if not p_card_id = any(st.card_ids) then raise exception 'That card isn''t in this set.'; end if;
  select * into e from events where set_id = st.id and card_id = p_card_id;
  if e.id is not null then return jsonb_build_object('correct', e.correct, 'duplicate', true); end if;
  select * into c from cards where id = p_card_id;
  return _apply_answer(s, st, c, p_chosen, p_confidence, p_client_event_id, p_answered_at);
end;
$$;

create or replace function public._finish_set(s public.staff, st public.sets) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n_answered int; n_right int; n_learned int; n_strong int; lvl int; practise jsonb;
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

create or replace function public.finish_set(p_set_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); st sets;
begin
  select * into st from sets where id = p_set_id and staff_id = s.id;
  if st.id is null then raise exception 'Unknown set.'; end if;
  return _finish_set(s, st);
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress for one person (shared by the staff app and the dashboard)
-- ---------------------------------------------------------------------------
create or replace function public._progress(s public.staff) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare scope int := least(3, s.level + 1); tracks jsonb; focus jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', track_id, 'name', track, 'live', live, 'mastered', mastered, 'pct', pct) order by sort)
    into tracks from _mastery(s, scope) where live > 0;
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
    'confidence', '{}'::jsonb,
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

create or replace function public.my_progress() returns jsonb
language sql stable security definer set search_path = public as $$
  select _progress(_me());
$$;

-- Average mastery on a given day, worked out from the answer log, so the
-- "most improved" figure can compare today with 28 days ago.
create or replace function public._avg_mastery_on(s public.staff, p_on date) returns int
language sql stable security definer set search_path = public as $$
  with scope as (
    select c.id, c.track_id from cards c
    where c.status = 'live' and s.role = any(c.roles) and c.level <= least(3, s.level + 1)
  ),
  last_ev as (
    select distinct on (e.card_id) e.card_id, e.correct, e.box_after
    from events e where e.staff_id = s.id and e.set_kind = 'daily' and e.local_date <= p_on
    order by e.card_id, e.local_date desc, e.id desc
  ),
  per_track as (
    select sc.track_id, count(*) n, count(*) filter (where le.correct and le.box_after >= 4) k
    from scope sc left join last_ev le on le.card_id = sc.id group by sc.track_id
  )
  select coalesce(round(avg(100.0 * k / n))::int, 0) from per_track;
$$;

-- ---------------------------------------------------------------------------
-- Who the dashboard covers
-- ---------------------------------------------------------------------------
create or replace function public._dash_staff(p_venue text, p_include_test boolean) returns setof public.staff
language sql stable security definer set search_path = public as $$
  select * from staff
  where active and public.is_manager_for(venue_id)
    and (p_venue is null or venue_id = p_venue)
    and (coalesce(p_include_test, false) or not is_test);
$$;

create or replace function public._venue_today(p_venue text) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from venues where id = p_venue), 'Asia/Dubai'))::date;
$$;

create or replace function public._name(s public.staff) returns text
language sql immutable as $$ select s.first_name || ' ' || s.last_initial || '.'; $$;

-- ---------------------------------------------------------------------------
-- Dashboard: Overview
-- ---------------------------------------------------------------------------
create or replace function public.dash_overview(p_venue text default null, p_include_test boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := _venue_today(coalesce(p_venue, 'arabian-ranches'));
  wk date := date_trunc('week', today::timestamp)::date;
  n int; res jsonb; menu menu_sets;
begin
  if not exists (select 1 from venues v where public.is_manager_for(v.id)) then raise exception 'Not allowed.'; end if;
  select count(*) into n from _dash_staff(p_venue, p_include_test);
  select * into menu from menu_sets m where m.active and (p_venue is null or m.venue_id is null or m.venue_id = p_venue)
    order by created_at desc limit 1;

  with ppl as (select * from _dash_staff(p_venue, p_include_test)),
  per as (
    select p.id, p.venue_id, p.level, _sets_in_week(p.id, wk) wk_sets, _target(p) target,
           _avg_mastery_on(p, today) mastery
    from ppl p
  )
  select jsonb_build_object(
    'people', n,
    'active_week', (select count(*) filter (where wk_sets > 0) from per),
    'target_met', (select count(*) filter (where wk_sets >= target) from per),
    'floor_ready', (select count(*) filter (where level >= 1) from per),
    'avg_mastery', (select coalesce(round(avg(mastery))::int, 0) from per),
    'coaching_open', (select count(*) from coaching_prompts cp join ppl p on p.id = cp.staff_id where cp.resolved_at is null),
    'menu', case when menu.id is null then null else jsonb_build_object(
        'name', menu.name,
        'done', (select count(*) from ppl p where p.venue_id = coalesce(menu.venue_id, p.venue_id)
                   and not exists (select 1 from unnest(menu.card_ids) x(id) join cards c on c.id = x.id
                                   where c.status = 'live' and p.role = any(c.roles)
                                     and not exists (select 1 from events e where e.staff_id = p.id and e.card_id = c.id and e.received_at >= menu.created_at))),
        'people', (select count(*) from ppl p where p.venue_id = coalesce(menu.venue_id, p.venue_id))) end
  ) into res;

  -- Mastery by venue and track (average across the people there).
  res := res || jsonb_build_object('heatmap', (
    select coalesce(jsonb_agg(jsonb_build_object('venue_id', v.id, 'venue', v.name, 'people', vp.n, 'tracks', vp.tracks) order by v.name), '[]'::jsonb)
    from venues v
    join lateral (
      select count(distinct p.id) n,
             (select jsonb_agg(jsonb_build_object('track_id', t.id, 'track', t.name, 'pct',
                       (select round(avg(m.pct))::int from _dash_staff(v.id, p_include_test) p2, lateral _mastery(p2, least(3, p2.level + 1)) m
                        where m.track_id = t.id and m.live > 0)) order by t.sort) from tracks t) tracks
      from _dash_staff(v.id, p_include_test) p
    ) vp on true
    where public.is_manager_for(v.id) and (p_venue is null or v.id = p_venue) and vp.n > 0));

  -- Weekly target met, week by week (last 8 weeks), by venue.
  res := res || jsonb_build_object('trend', (
    select coalesce(jsonb_agg(jsonb_build_object('venue_id', v.id, 'venue', v.name,
             'goal_pct', coalesce(v.weekly_goal_pct, _setting_int('venue_weekly_goal_pct', 85)),
             'weeks', (select jsonb_agg(jsonb_build_object('week_start', w,
                         'pct', (select case when count(*) = 0 then null
                                       else round(100.0 * count(*) filter (where _sets_in_week(p.id, w) >= _target(p)) / count(*))::int end
                                 from _dash_staff(v.id, p_include_test) p where p.created_at::date <= w + 6)) order by w)
                       from generate_series(wk - 49, wk, interval '7 days') g(wt), lateral (select g.wt::date w) ww)
           ) order by v.name), '[]'::jsonb)
    from venues v where public.is_manager_for(v.id) and (p_venue is null or v.id = p_venue)
      and exists (select 1 from _dash_staff(v.id, p_include_test))));

  -- Level mix by venue.
  res := res || jsonb_build_object('levels', (
    select coalesce(jsonb_agg(jsonb_build_object('venue', v.name, 'counts',
             (select jsonb_agg((select count(*) from _dash_staff(v.id, p_include_test) p where p.level = l) order by l)
              from generate_series(0, 3) l)) order by v.name), '[]'::jsonb)
    from venues v where public.is_manager_for(v.id) and (p_venue is null or v.id = p_venue)
      and exists (select 1 from _dash_staff(v.id, p_include_test))));

  -- Coach this week: the 3 units with the lowest share of right answers over
  -- the last 28 days (at least 5 answers), each with its most-missed card.
  res := res || jsonb_build_object('coach', (
    with ev as (
      select e.*, c.unit_id, c.track_id from events e join cards c on c.id = e.card_id
      join _dash_staff(p_venue, p_include_test) p on p.id = e.staff_id
      where e.local_date > today - 28 and c.status = 'live'
    ),
    units_ranked as (
      select unit_id, track_id, count(*) n, round(100.0 * count(*) filter (where correct) / count(*))::int pct
      from ev group by unit_id, track_id having count(*) >= 5 order by pct, n desc limit 3
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'unit', u.name, 'track', t.name, 'pct', ur.pct, 'answers', ur.n,
      'card', (select jsonb_build_object('id', c.id, 'prompt', c.prompt, 'answer', c.answer)
               from ev join cards c on c.id = ev.card_id where ev.unit_id = ur.unit_id
               group by c.id, c.prompt, c.answer order by avg(ev.correct::int), count(*) desc limit 1)
    ) order by ur.pct), '[]'::jsonb)
    from units_ranked ur join units u on u.id = ur.unit_id join tracks t on t.id = ur.track_id));

  -- Recognise: most improved over 28 days, longest rhythm, level-ups this week.
  res := res || jsonb_build_object('recognise', jsonb_build_object(
    'improved', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', id, 'name', name, 'gain', gain) order by gain desc), '[]'::jsonb)
                 from (select p.id, _name(p) name, _avg_mastery_on(p, today) - _avg_mastery_on(p, today - 28) gain
                       from _dash_staff(p_venue, p_include_test) p) g where gain > 0 and gain is not null
                 limit 3),
    'streak', (select jsonb_build_object('staff_id', id, 'name', name, 'weeks', weeks)
               from (select p.id, _name(p) name, (_rhythm(p) ->> 'streak')::int weeks from _dash_staff(p_venue, p_include_test) p) r
               where weeks > 0 order by weeks desc, name limit 1),
    'level_ups', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', p.id, 'name', _name(p), 'level_name', _level_name(h.level))), '[]'::jsonb)
                  from level_history h join _dash_staff(p_venue, p_include_test) p on p.id = h.staff_id
                  where h.reached_at::date >= wk)));
  return res || jsonb_build_object('week_start', wk, 'today', today);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: Team (one row per person)
-- ---------------------------------------------------------------------------
create or replace function public.dash_team(p_venue text default null, p_include_test boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(person order by person ->> 'venue', person ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'name', _name(p), 'staff_number', p.staff_number, 'role', p.role, 'venue_id', p.venue_id,
      'venue', (select name from venues where id = p.venue_id), 'is_test', p.is_test, 'activated', p.user_id is not null,
      'level', p.level, 'level_name', _level_name(p.level),
      'streak', (_rhythm(p) ->> 'streak')::int, 'this_week', (_rhythm(p) ->> 'this_week')::int, 'target', _target(p),
      'tracks', (select jsonb_agg(jsonb_build_object('track_id', m.track_id, 'pct', case when m.live > 0 then m.pct end) order by m.sort)
                 from _mastery(p, least(3, p.level + 1)) m),
      'last_active', (select max(local_date) from sets x where x.staff_id = p.id and x.finished_at is not null),
      'next_focus', (_progress(p) -> 'next_focus' ->> 'unit')
    ) person
    from _dash_staff(p_venue, p_include_test) p
  ) r;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: Person
-- ---------------------------------------------------------------------------
create or replace function public.dash_person(p_staff uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff; today date;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  today := _today(s);
  return _progress(s) || jsonb_build_object(
    'id', s.id, 'name', _name(s), 'staff_number', s.staff_number, 'role', s.role, 'is_test', s.is_test,
    'venue', (select name from venues where id = s.venue_id), 'active', s.active, 'activated', s.user_id is not null,
    'today', today,
    'days', (select jsonb_agg(jsonb_build_object('date', d, 'sets',
               (select count(*) from sets x where x.staff_id = s.id and x.kind = 'daily' and x.finished_at is not null and x.local_date = d)) order by d)
             from generate_series(today - 27, today, interval '1 day') g(dd), lateral (select g.dd::date d) z),
    'signoffs', (select coalesce(jsonb_agg(jsonb_build_object('skill', k.id, 'name', k.name,
                    'signed_by', so.signed_by, 'signed_at', so.signed_at) order by k.ord), '[]'::jsonb)
                 from (select x ->> 'id' id, x ->> 'name' name, o ord from jsonb_array_elements(_level1_skills()) with ordinality a(x, o)
                       union all select 'level2_signoff', 'Level 2: manager sign-off', 99) k
                 left join signoffs so on so.staff_id = s.id and so.skill = k.id),
    'leave_weeks', (select coalesce(jsonb_agg(week_start order by week_start desc), '[]'::jsonb)
                    from rhythm_pauses where staff_id = s.id and week_start > today - 120),
    'week_start', date_trunc('week', today::timestamp)::date,
    'coaching', (select coalesce(jsonb_agg(jsonb_build_object('id', cp.id, 'card', c.prompt, 'created_at', cp.created_at)), '[]'::jsonb)
                 from coaching_prompts cp join cards c on c.id = cp.card_id where cp.staff_id = s.id and cp.resolved_at is null),
    'levels_reached', (select coalesce(jsonb_agg(jsonb_build_object('level_name', _level_name(level), 'at', reached_at) order by level), '[]'::jsonb)
                       from level_history where staff_id = s.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: Questions
-- ---------------------------------------------------------------------------
create or replace function public.dash_questions(p_venue text default null, p_include_test boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare min_n int := _setting_int('questions_min_answers', 10); known int := _setting_int('questions_known_pct', 95); res jsonb;
begin
  if not exists (select 1 from venues v where public.is_manager_for(v.id)) then raise exception 'Not allowed.'; end if;
  with first_try as (
    select distinct on (e.staff_id, e.card_id) e.staff_id, e.card_id, e.correct, e.chosen
    from events e join _dash_staff(p_venue, p_include_test) p on p.id = e.staff_id
    order by e.staff_id, e.card_id, e.answered_at, e.id
  ),
  per_card as (
    select f.card_id, count(*) n, round(100.0 * count(*) filter (where f.correct) / count(*))::int ftr
    from first_try f group by f.card_id having count(*) >= min_n
  ),
  picked as (  -- most-picked option among first tries that weren't right
    select f.card_id, x.opt, count(*) k
    from first_try f join cards c on c.id = f.card_id, jsonb_array_elements_text(f.chosen) x(opt)
    where not f.correct and c.type <> 'order' and not c.answer ? x.opt
    group by f.card_id, x.opt
  )
  select jsonb_build_object(
    'min_answers', min_n, 'known_pct', known,
    'answered_cards', (select count(distinct card_id) from first_try),
    'missed', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'prompt', c.prompt, 'track', t.name, 'unit', u.name,
                 'ftr', pc.ftr, 'answers', pc.n,
                 'instead', (select opt from picked pk where pk.card_id = c.id order by k desc, opt limit 1)) order by pc.ftr, pc.n desc), '[]'::jsonb)
               from (select * from per_card order by ftr, n desc limit 10) pc
               join cards c on c.id = pc.card_id join tracks t on t.id = c.track_id join units u on u.id = c.unit_id
               where pc.ftr < known),
    'known', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'prompt', c.prompt, 'track', t.name, 'ftr', pc.ftr, 'answers', pc.n)
                 order by pc.ftr desc, pc.n desc), '[]'::jsonb)
              from (select * from per_card where ftr >= known order by ftr desc, n desc limit 10) pc
              join cards c on c.id = pc.card_id join tracks t on t.id = c.track_id)
  ) into res;

  res := res || jsonb_build_object('bank', (
    select jsonb_agg(b order by sort) from (
      select t.sort, jsonb_build_object('track', t.name,
             'live', count(*) filter (where c.status = 'live'),
             'review', count(*) filter (where c.status = 'review' and not c.is_allergen),
             'allergen_waiting', count(*) filter (where c.status = 'review' and c.is_allergen),
             'draft', count(*) filter (where c.status = 'draft')) b
      from tracks t left join cards c on c.track_id = t.id group by t.id, t.name, t.sort) x));

  res := res || jsonb_build_object('menu_sets', (
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'cards', cardinality(m.card_ids),
             'venue', coalesce((select name from venues where id = m.venue_id), 'Every venue'),
             'done', (select count(*) from _dash_staff(p_venue, p_include_test) p
                      where (m.venue_id is null or p.venue_id = m.venue_id)
                        and not exists (select 1 from unnest(m.card_ids) x(id) join cards c on c.id = x.id
                                        where c.status = 'live' and p.role = any(c.roles)
                                          and not exists (select 1 from events e where e.staff_id = p.id and e.card_id = c.id and e.received_at >= m.created_at))),
             'people', (select count(*) from _dash_staff(p_venue, p_include_test) p where m.venue_id is null or p.venue_id = m.venue_id)
           ) order by m.created_at desc), '[]'::jsonb)
    from menu_sets m where m.active and (p_venue is null or m.venue_id is null or m.venue_id = p_venue)));
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Actions from the dashboard
-- ---------------------------------------------------------------------------

-- Practical sign-off (or undo). Signing can move someone up a level; undoing never moves anyone down.
create or replace function public.sign_off(p_staff uuid, p_skill text, p_signed boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff; lvl int;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  if p_skill not in (select x ->> 'id' from jsonb_array_elements(_level1_skills()) x) and p_skill <> 'level2_signoff' then
    raise exception 'Unknown sign-off.';
  end if;
  if p_signed then
    insert into signoffs (staff_id, skill, signed_by) values (s.id, p_skill, public.current_display_name())
    on conflict (staff_id, skill) do nothing;
  else
    delete from signoffs where staff_id = s.id and skill = p_skill;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), case when p_signed then 'signoff_given' else 'signoff_removed' end,
          'staff', s.id::text, jsonb_build_object('skill', p_skill));
  lvl := _check_level(s.id);
  return jsonb_build_object('level', lvl, 'level_name', _level_name(lvl), 'level_up', lvl > s.level);
end;
$$;

-- Mark a week as leave, so it doesn't break the person's rhythm (one a month).
create or replace function public.set_leave_week(p_staff uuid, p_week date, p_on boolean default true) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s staff; wk date := date_trunc('week', p_week::timestamp)::date;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  if p_on then
    if (select count(*) from rhythm_pauses where staff_id = s.id and date_trunc('month', week_start::timestamp) = date_trunc('month', wk::timestamp)
        and week_start <> wk) >= _setting_int('leave_weeks_per_month', 1) then
      raise exception 'Only one leave week a month.';
    end if;
    insert into rhythm_pauses (staff_id, week_start, created_by) values (s.id, wk, public.current_display_name())
    on conflict do nothing;
  else
    delete from rhythm_pauses where staff_id = s.id and week_start = wk;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), case when p_on then 'leave_week_set' else 'leave_week_removed' end,
          'staff', s.id::text, jsonb_build_object('week_start', wk));
end;
$$;

create or replace function public.resolve_coaching(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v text;
begin
  select venue_id into v from coaching_prompts where id = p_id;
  if v is null or not public.is_manager_for(v) then raise exception 'Not allowed.'; end if;
  update coaching_prompts set resolved_at = now(), resolved_by = public.current_display_name() where id = p_id;
end;
$$;

-- New on the menu: create or update a set (admin).
create or replace function public.save_menu_set(p_id uuid, p_name text, p_venue text, p_card_ids text[], p_active boolean) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare mid uuid := p_id;
begin
  if not public.is_admin() then raise exception 'Only an admin can manage menu sets.'; end if;
  if cardinality(p_card_ids) = 0 then raise exception 'Pick at least one card.'; end if;
  if exists (select 1 from unnest(p_card_ids) x(id) where not exists (select 1 from cards where id = x.id)) then
    raise exception 'Unknown card in the list.';
  end if;
  if mid is null then
    insert into menu_sets (name, venue_id, card_ids, active, created_by)
    values (trim(p_name), nullif(p_venue, ''), p_card_ids, coalesce(p_active, true), public.current_display_name())
    returning id into mid;
  else
    update menu_sets set name = trim(p_name), venue_id = nullif(p_venue, ''), card_ids = p_card_ids,
      active = coalesce(p_active, active) where id = mid;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'menu_set_saved', 'menu_set', mid::text,
          jsonb_build_object('cards', cardinality(p_card_ids), 'active', p_active));
  return mid;
end;
$$;

-- A venue manager login (the person signs up first, as for reviewers).
create or replace function public.grant_venue_manager(p_email text, p_display_name text, p_venue text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles.'; end if;
  if not exists (select 1 from venues where id = p_venue) then raise exception 'Unknown venue.'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No login found for %. Invite them in Supabase first.', p_email; end if;
  insert into app_users (user_id, email, display_name)
  values (uid, lower(trim(p_email)), coalesce(nullif(trim(p_display_name), ''), split_part(p_email, '@', 1)))
  on conflict (user_id) do update set display_name = coalesce(nullif(trim(p_display_name), ''), app_users.display_name), active = true;
  insert into user_roles (user_id, role, venue_id) values (uid, 'venue_manager', p_venue)
  on conflict (user_id, role) do update set venue_id = excluded.venue_id;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'role_granted', 'user', p_email,
          jsonb_build_object('role', 'venue_manager', 'venue', p_venue));
end;
$$;

-- What the signed-in person may do (now also: which venues they manage).
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'display_name', (select display_name from app_users where user_id = auth.uid() and active),
    'admin', public.is_admin(),
    'allergen_checker', public.is_allergen_checker(),
    'reviewer_tracks', coalesce((select tracks from user_roles where user_id = auth.uid() and role = 'reviewer'), '{}'),
    'manager_venues', coalesce((select array_agg(v.id order by v.name) from venues v where v.active and public.is_manager_for(v.id)), '{}')
  );
$$;

-- ---------------------------------------------------------------------------
-- Demo venue (server only: run from the SQL editor). Sample people are test
-- accounts in their own venue, so they never mix with real staff figures.
-- ---------------------------------------------------------------------------
create or replace function public.demo_seed(p_days int default 35) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  people jsonb := '[
    {"n":"D01","f":"Amira","i":"K","r":"server","p":0.90,"a":0.88},
    {"n":"D02","f":"Bilal","i":"R","r":"server","p":0.75,"a":0.70},
    {"n":"D03","f":"Chloe","i":"M","r":"server","p":0.55,"a":0.80},
    {"n":"D04","f":"Daniel","i":"S","r":"server","p":0.85,"a":0.60},
    {"n":"D05","f":"Elena","i":"V","r":"host","p":0.70,"a":0.85},
    {"n":"D06","f":"Faisal","i":"A","r":"server","p":0.35,"a":0.65},
    {"n":"D07","f":"Grace","i":"O","r":"bar","p":0.80,"a":0.75},
    {"n":"D08","f":"Hassan","i":"N","r":"runner","p":0.65,"a":0.70},
    {"n":"D09","f":"Isabel","i":"T","r":"server","p":0.95,"a":0.92},
    {"n":"D10","f":"Joseph","i":"L","r":"bar","p":0.50,"a":0.68},
    {"n":"D11","f":"Kavya","i":"P","r":"host","p":0.60,"a":0.78},
    {"n":"D12","f":"Liam","i":"D","r":"server","p":0.25,"a":0.72}
  ]';
  x jsonb; s staff; st sets; c cards; d date; ids text[]; cid text; ok boolean; chosen jsonb; acc numeric; seen int;
  today date := _venue_today('arabian-ranches'); n_sets int := 0;
begin
  if auth.uid() is not null then raise exception 'Run this from the SQL editor.'; end if;
  insert into venues (id, name, timezone) values ('demo', 'Demo venue (sample data)', 'Asia/Dubai') on conflict (id) do nothing;
  for x in select * from jsonb_array_elements(people) loop
    insert into staff (staff_number, first_name, last_initial, venue_id, role, is_test, created_by, created_at)
    values (x ->> 'n', x ->> 'f', x ->> 'i', 'demo', x ->> 'r', true, 'Demo data', now() - make_interval(days => p_days + 1))
    on conflict (staff_number) do nothing;
    select * into s from staff where staff_number = x ->> 'n';
    if exists (select 1 from sets where staff_id = s.id) then continue; end if;
    for d in select g::date from generate_series(today - p_days, today - 1, interval '1 day') g loop
      continue when random() > (x ->> 'p')::numeric;
      select * into s from staff where id = s.id;
      ids := _pick_daily(s, d);
      continue when cardinality(ids) = 0;
      insert into sets (staff_id, kind, local_date, card_ids, started_at) values (s.id, 'daily', d, ids, d + time '10:00')
      returning * into st;
      foreach cid in array ids loop
        select * into c from cards where id = cid;
        select coalesce(box, 0) into seen from card_state where staff_id = s.id and card_id = cid;
        acc := least(0.98, (x ->> 'a')::numeric + 0.05 * coalesce(seen, 0));
        ok := random() < acc;
        chosen := case when ok then c.answer
                       when c.type = 'order' then (select jsonb_agg(v order by o desc) from jsonb_array_elements(c.answer) with ordinality q(v, o))
                       else (select jsonb_build_array(o) from jsonb_array_elements(c.options) o where not c.answer @> jsonb_build_array(o) order by random() limit 1) end;
        perform _apply_answer(s, st, c, chosen, null, gen_random_uuid(), d + time '10:05');
      end loop;
      perform _finish_set(s, st);
      update sets set finished_at = d + time '10:08' where id = st.id;
      n_sets := n_sets + 1;
    end loop;
  end loop;
  -- A few sign-offs and readiness passes, so the level path has some movement.
  insert into signoffs (staff_id, skill, signed_by)
  select s2.id, k ->> 'id', 'Demo manager' from staff s2, jsonb_array_elements(_level1_skills()) k
  where s2.staff_number in ('D01', 'D09', 'D05') on conflict do nothing;
  insert into signoffs (staff_id, skill, signed_by)
  select id, 'table_setup', 'Demo manager' from staff where staff_number in ('D02', 'D07', 'D04') on conflict do nothing;
  insert into sets (staff_id, kind, local_date, card_ids, finished_at, right_count, total, passed)
  select id, 'readiness', today - 2, '{}', now() - interval '2 days', 18, 20, true from staff
  where staff_number in ('D01', 'D09', 'D05', 'D07') and not exists (select 1 from sets x where x.staff_id = staff.id and x.kind = 'readiness');
  perform _check_level(id) from staff where venue_id = 'demo';
  return jsonb_build_object('people', (select count(*) from staff where venue_id = 'demo'), 'sets_added', n_sets,
                            'answers', (select count(*) from events e join staff p on p.id = e.staff_id where p.venue_id = 'demo'));
end;
$$;

create or replace function public.demo_remove() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null then raise exception 'Run this from the SQL editor.'; end if;
  select count(*) into n from staff where venue_id = 'demo';
  -- answers first, while the people still exist (answers of test accounts may be deleted)
  delete from events where staff_id in (select id from staff where venue_id = 'demo' and is_test);
  delete from staff where venue_id = 'demo' and is_test;
  delete from menu_sets where venue_id = 'demo';
  delete from venues where id = 'demo' and not exists (select 1 from staff where venue_id = 'demo');
  return jsonb_build_object('removed_people', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function public._menu_todo(public.staff), public._pick_daily(public.staff, date),
  public._apply_answer(public.staff, public.sets, public.cards, jsonb, text, uuid, timestamptz),
  public._finish_set(public.staff, public.sets), public._progress(public.staff),
  public._avg_mastery_on(public.staff, date), public._dash_staff(text, boolean), public._venue_today(text),
  public._name(public.staff), public.demo_seed(int), public.demo_remove()
  from public, anon, authenticated;

revoke execute on function public.dash_overview(text, boolean), public.dash_team(text, boolean), public.dash_person(uuid),
  public.dash_questions(text, boolean), public.sign_off(uuid, text, boolean), public.set_leave_week(uuid, date, boolean),
  public.resolve_coaching(bigint), public.save_menu_set(uuid, text, text, text[], boolean),
  public.grant_venue_manager(text, text, text), public.my_progress(), public.finish_set(uuid),
  public.record_answer(uuid, uuid, text, jsonb, text, timestamptz)
  from public, anon;
grant execute on function public.dash_overview(text, boolean), public.dash_team(text, boolean), public.dash_person(uuid),
  public.dash_questions(text, boolean), public.sign_off(uuid, text, boolean), public.set_leave_week(uuid, date, boolean),
  public.resolve_coaching(bigint), public.save_menu_set(uuid, text, text, text[], boolean),
  public.grant_venue_manager(text, text, text), public.my_progress(), public.finish_set(uuid),
  public.record_answer(uuid, uuid, text, jsonb, text, timestamptz)
  to authenticated;

select 'dashboard ready' as result;
