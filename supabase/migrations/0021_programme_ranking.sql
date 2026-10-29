-- Maison Academy · 0021 new-joiner programme and ranking
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- New-joiner programme (David, 29 October):
--   * a fixed sequence of steps from the basics up; each step is one part of a topic;
--   * in a step the person studies the cards, takes the step exam (default 10 cards,
--     80% to pass), then a manager signs them off on the floor; that unlocks the next step;
--   * a step only applies to the roles it lists and that have live cards in it;
--   * managers put people on the programme; the admin edits the steps.
-- Ranking (David, 29 October): points for programme steps and completion, levels,
-- practical sign-offs, exams, weekly targets met and cards known. Staff see only
-- their own tier and points; managers see the full ranking. Points and tiers are settings.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.programme_steps (
  id           uuid primary key default gen_random_uuid(),
  position     int  not null,
  name         text not null check (char_length(trim(name)) between 1 and 80),
  track_id     text not null references public.tracks(id),
  unit_id      text references public.units(id),            -- null = the whole topic
  roles        text[] not null default array['host', 'server', 'runner', 'bar', 'barista'],
  exam_cards   int  not null default 10 check (exam_cards between 5 and 40),
  pass_pct     int  not null default 80 check (pass_pct between 50 and 100),
  signoff_note text,                                        -- what the manager checks on the floor
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create table if not exists public.programme_enrolments (
  staff_id     uuid primary key references public.staff(id) on delete cascade,
  enrolled_on  date not null,
  enrolled_by  text,
  completed_on date,
  active       boolean not null default true
);
create table if not exists public.programme_progress (
  staff_id       uuid not null references public.staff(id) on delete cascade,
  step_id        uuid not null references public.programme_steps(id) on delete cascade,
  exam_best_pct  int,
  exam_passed_at timestamptz,
  signed_off_at  timestamptz,
  signed_off_by  text,
  primary key (staff_id, step_id)
);
alter table public.programme_steps enable row level security;
alter table public.programme_enrolments enable row level security;
alter table public.programme_progress enable row level security;
revoke all on public.programme_steps, public.programme_enrolments, public.programme_progress from anon, authenticated;

alter table public.sets add column if not exists step_id uuid references public.programme_steps(id) on delete set null;
alter table public.sets drop constraint if exists sets_kind_check;
alter table public.sets add constraint sets_kind_check check (kind in ('daily', 'readiness', 'exam', 'step'));

insert into public.settings (key, value, note) values
  ('ranking_points', '{"programme_step": 20, "programme_done": 100, "level": 100, "signoff": 20, "exam_max": 10, "week_target": 10, "mastered": 1}',
   'Ranking points: per programme step signed off, programme finished, per level, per practical sign-off, per exam (at 100%), per weekly target met, per card known'),
  ('ranking_tiers', '[{"name": "Bronze", "min": 0}, {"name": "Silver", "min": 250}, {"name": "Gold", "min": 600}, {"name": "Platinum", "min": 1200}]',
   'Ranking tiers and the points each starts at')
on conflict (key) do nothing;

-- Default steps (only when there are none yet). Sign-off notes are starting points for the admin to edit.
insert into public.programme_steps (position, name, track_id, unit_id, roles, signoff_note)
select * from (values
  (1,  'House standards',              'sop',     'house-standards',        array['host','server','runner','bar','barista'], 'Seen on shift meeting the house standards.'),
  (2,  'Safety basics',                'sop',     'safety-basics',          array['host','server','runner','bar','barista'], 'Can show the safety points covered in the cards, on the floor.'),
  (3,  'Allergen protocol',            'sop',     'allergen-protocol',      array['host','server','runner','bar','barista'], 'Walks the manager through taking an allergy and telling the kitchen.'),
  (4,  'Host sequence',                'service', 'host-sequence',          array['host'],    'Seen running the host sequence with guests.'),
  (5,  'Waiter sequence',              'service', 'waiter-sequence',        array['server'],  'Seen running the waiter sequence at a table.'),
  (6,  'Food runner sequence',         'service', 'runner-sequence',        array['runner'],  'Seen running food to the runner sequence.'),
  (7,  'Barista sequence',             'service', 'barista-sequence',       array['barista'], 'Seen running the barista sequence.'),
  (8,  'Bar standards',                'drinks',  'bar-standards',          array['bar'],     'Seen working the bar to standard.'),
  (9,  'Service steps',                'service', 'service-steps',          array['host','server','runner','bar','barista'], 'Takes a table through the service steps with a manager watching.'),
  (10, 'Timing standards',             'service', 'timing-standards',       array['host','server','runner','bar'], 'Meets the timing standards on a shift.'),
  (11, 'Menu basics',                  'food',    'menu-basics',            array['host','server','runner','bar','barista'], 'Explains the menu to the manager as they would to a guest.'),
  (12, 'Breakfast menu',               'food',    'breakfast',              array['host','server','runner','bar','barista'], 'Describes breakfast dishes to the manager.'),
  (13, 'Lunch and dinner menu',        'food',    'lunch-dinner',           array['host','server','runner','bar','barista'], 'Describes lunch and dinner dishes to the manager.'),
  (14, 'Allergens: breakfast',         'food',    'allergens-breakfast',    array['host','server','runner','bar','barista'], 'Answers allergen questions on breakfast dishes correctly.'),
  (15, 'Allergens: lunch and dinner',  'food',    'allergens-lunch-dinner', array['host','server','runner','bar','barista'], 'Answers allergen questions on lunch and dinner dishes correctly.'),
  (16, 'Guest recovery',               'sop',     'guest-recovery',         array['host','server','runner','bar','barista'], 'Handles a role-played complaint the house way.'),
  (17, 'Opening and closing',          'sop',     'opening-closing',        array['host','server','runner','bar','barista'], 'Seen doing an opening or closing to the checklist.'),
  (18, 'Controls',                     'sop',     'controls',               array['host','server','runner','bar','barista'], 'Explains the controls in the cards to the manager.')
) v(position, name, track_id, unit_id, roles, signoff_note)
where not exists (select 1 from public.programme_steps)
  and exists (select 1 from public.units u where u.id = v.unit_id);

-- ---------------------------------------------------------------------------
-- Programme: which steps apply to a person, and where they are
-- ---------------------------------------------------------------------------
create or replace function public._step_pool(p public.programme_steps, p_role text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from cards c
  where c.status = 'live' and p_role = any(c.roles) and c.track_id = p.track_id and (p.unit_id is null or c.unit_id = p.unit_id);
$$;

create or replace function public._step_cards(p public.programme_steps, p_role text, p_limit int) returns text[]
language sql volatile security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from (
    select c.id from cards c
    where c.status = 'live' and p_role = any(c.roles) and c.track_id = p.track_id and (p.unit_id is null or c.unit_id = p.unit_id)
    order by random() limit p_limit) x;
$$;

-- One row per applicable step, in order, with its status:
-- done (signed off), signoff (exam passed, waiting for the manager), current, locked.
create or replace function public._programme_steps(s public.staff)
returns table (step_id uuid, n int, name text, topic text, exam_cards int, pass_pct int, signoff_note text,
               status text, best_pct int, passed_at timestamptz, signed_at timestamptz, signed_by text, pool int)
language sql stable security definer set search_path = public as $$
  with st as (
    select p.*, row_number() over (order by p.position, p.created_at)::int n, _step_pool(p, s.role) pool,
           g.exam_best_pct, g.exam_passed_at, g.signed_off_at, g.signed_off_by
    from programme_steps p
    left join programme_progress g on g.step_id = p.id and g.staff_id = s.id
    where p.active and s.role = any(p.roles) and _step_pool(p, s.role) > 0
  ), firstopen as (select min(n) n from st where signed_off_at is null)
  select st.id, row_number() over (order by st.n)::int, st.name,
         (select t.name || coalesce(': ' || u.name, '') from tracks t left join units u on u.id = st.unit_id where t.id = st.track_id),
         least(st.exam_cards, st.pool), st.pass_pct, st.signoff_note,
         case when st.signed_off_at is not null then 'done'
              when st.n = (select n from firstopen) then case when st.exam_passed_at is not null then 'signoff' else 'current' end
              else 'locked' end,
         st.exam_best_pct, st.exam_passed_at, st.signed_off_at, st.signed_off_by, st.pool
  from st order by st.n;
$$;

create or replace function public._programme(s public.staff) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e programme_enrolments; steps jsonb; cur jsonb;
begin
  select * into e from programme_enrolments where staff_id = s.id;
  if e.staff_id is null or not e.active then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.n), '[]'::jsonb) into steps from _programme_steps(s) x;
  select v into cur from jsonb_array_elements(steps) v where v ->> 'status' in ('current', 'signoff') limit 1;
  return jsonb_build_object(
    'enrolled_on', e.enrolled_on, 'completed_on', e.completed_on,
    'total', jsonb_array_length(steps),
    'done', (select count(*) from jsonb_array_elements(steps) x where x ->> 'status' = 'done'),
    'current', cur, 'steps', steps);
end;
$$;

-- ---------------------------------------------------------------------------
-- Points and tiers
-- ---------------------------------------------------------------------------
create or replace function public._weeks_met(s public.staff) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(
      date_trunc('week', (select min(local_date) from sets where staff_id = s.id and kind = 'daily' and finished_at is not null)::timestamp),
      date_trunc('week', _today(s)::timestamp), interval '7 days') w
  where _sets_in_week(s.id, w::date) >= _target(s);
$$;

create or replace function public._tier(p_points int) returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (select x ->> 'name' name, (x ->> 'min')::int mn from settings, jsonb_array_elements(value) x where key = 'ranking_tiers')
  select jsonb_build_object(
    'tier', (select name from t where mn <= p_points order by mn desc limit 1),
    'next_tier', (select name from t where mn > p_points order by mn limit 1),
    'to_next', (select mn - p_points from t where mn > p_points order by mn limit 1));
$$;

create or replace function public._points(s public.staff) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w jsonb := coalesce((select value from settings where key = 'ranking_points'), '{}'::jsonb);
  n_steps int; n_done int; n_sign int; ex int; n_weeks int; n_known int; v_total int; parts jsonb;
begin
  select count(*) into n_steps from programme_progress where staff_id = s.id and signed_off_at is not null;
  select count(*) into n_done from programme_enrolments where staff_id = s.id and completed_on is not null;
  select count(*) into n_sign from signoffs where staff_id = s.id;
  select coalesce(sum(round(coalesce((w ->> 'exam_max')::numeric, 10) * x.right_count / nullif(x.total, 0))), 0)::int into ex
    from sets x where x.staff_id = s.id and x.kind = 'exam' and x.finished_at is not null;
  n_weeks := _weeks_met(s);
  select count(*) into n_known from card_state x join cards c on c.id = x.card_id
    where x.staff_id = s.id and x.last_result and x.box >= 4 and c.status = 'live';
  parts := jsonb_build_object(
    'programme_steps', n_steps * coalesce((w ->> 'programme_step')::int, 20),
    'programme_done',  n_done  * coalesce((w ->> 'programme_done')::int, 100),
    'levels',          s.level * coalesce((w ->> 'level')::int, 100),
    'signoffs',        n_sign  * coalesce((w ->> 'signoff')::int, 20),
    'exams',           ex,
    'weeks',           n_weeks * coalesce((w ->> 'week_target')::int, 10),
    'known',           n_known * coalesce((w ->> 'mastered')::int, 1));
  select sum(value::int) into v_total from jsonb_each_text(parts);
  return jsonb_build_object('points', v_total, 'parts', parts,
    'counts', jsonb_build_object('programme_steps', n_steps, 'programme_done', n_done, 'level', s.level,
                                 'signoffs', n_sign, 'weeks', n_weeks, 'known', n_known)) || _tier(v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create or replace function public.my_programme() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('programme', _programme(_me()), 'points', _points(_me()),
    'weights', (select value from settings where key = 'ranking_points'),
    'tiers', (select value from settings where key = 'ranking_tiers'));
$$;

create or replace function public.study_step(p_step uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); r record; p programme_steps;
begin
  select x.* into r from _programme_steps(s) x where x.step_id = p_step;
  if not exists (select 1 from programme_enrolments where staff_id = s.id and active) or r.step_id is null then
    raise exception 'That step isn''t part of your programme.';
  end if;
  if r.status = 'locked' then raise exception 'This step opens once the one before it is signed off.'; end if;
  select * into p from programme_steps where id = p_step;
  return jsonb_build_object('step', jsonb_build_object('id', p.id, 'name', p.name),
                            'cards', _cards_json(_step_cards(p, s.role, 40)));
end;
$$;

create or replace function public.start_step_exam(p_step uuid, p_lat float8 default null, p_lng float8 default null, p_accuracy float8 default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff := _me(); r record; p programme_steps; st sets; here boolean; ids text[];
begin
  select x.* into r from _programme_steps(s) x where x.step_id = p_step;
  if not exists (select 1 from programme_enrolments where staff_id = s.id and active) or r.step_id is null then
    raise exception 'That step isn''t part of your programme.';
  end if;
  if r.status = 'locked' then raise exception 'This step opens once the one before it is signed off.'; end if;
  if r.status in ('signoff', 'done') then raise exception 'You''ve already passed this exam.'; end if;
  here := _check_on_site(s, p_lat, p_lng, p_accuracy);
  select * into p from programme_steps where id = p_step;
  select * into st from sets where staff_id = s.id and kind = 'step' and step_id = p_step and finished_at is null
    order by started_at desc limit 1;
  if st.id is null then
    ids := _step_cards(p, s.role, p.exam_cards);
    insert into sets (staff_id, kind, local_date, card_ids, on_site, step_id) values (s.id, 'step', _today(s), ids, here, p.id)
    returning * into st;
  end if;
  return jsonb_build_object(
    'set', jsonb_build_object('id', st.id, 'kind', st.kind, 'local_date', st.local_date, 'finished', st.finished_at is not null),
    'exam', jsonb_build_object('name', p.name, 'topic', r.topic, 'pass_pct', p.pass_pct),
    'cards', _cards_json(st.card_ids),
    'answered', (select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'correct', correct)), '[]'::jsonb)
                 from events where set_id = st.id));
end;
$$;

-- Answers: a step exam behaves like an exam (never moves a card up; "not yet" back to box 1).
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
  elsif st.kind in ('exam', 'step') then
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
declare n_answered int; n_right int; n_learned int; n_strong int; lvl int; practise jsonb; e exams; p programme_steps; ok boolean;
begin
  select count(*), count(*) filter (where correct),
         count(*) filter (where correct and was_new),
         count(*) filter (where correct and not was_new and box_after > box_before)
    into n_answered, n_right, n_learned, n_strong
  from events where set_id = st.id;
  if n_answered < cardinality(st.card_ids) then raise exception 'set_not_complete'; end if;
  if st.kind = 'step' then select * into p from programme_steps where id = st.step_id; end if;
  if st.finished_at is null then
    update sets set finished_at = now(), learned = n_learned, strengthened = n_strong,
      right_count = n_right, total = n_answered,
      passed = case when kind = 'readiness' then n_right * 100 >= _setting_int('readiness_pass_pct', 80) * n_answered
                    when kind = 'step' then n_right * 100 >= coalesce(p.pass_pct, 80) * n_answered end
    where id = st.id returning * into st;
    if st.kind = 'step' and p.id is not null then
      insert into programme_progress as g (staff_id, step_id, exam_best_pct, exam_passed_at)
      values (s.id, p.id, round(100.0 * n_right / nullif(n_answered, 0))::int, case when st.passed then now() end)
      on conflict (staff_id, step_id) do update set
        exam_best_pct = greatest(g.exam_best_pct, excluded.exam_best_pct),
        exam_passed_at = coalesce(g.exam_passed_at, excluded.exam_passed_at);
    end if;
  end if;
  lvl := _check_level(s.id);
  if st.kind in ('readiness', 'exam', 'step') then
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
    'step', case when p.id is not null then jsonb_build_object('id', p.id, 'name', p.name, 'pass_pct', p.pass_pct, 'signoff_note', p.signoff_note) end,
    'level', lvl, 'level_name', _level_name(lvl), 'level_up', lvl > s.level,
    'rhythm', _rhythm(s), 'team', _team(s));
end;
$$;

-- Home: programme summary and own tier (adds to 0019's version).
create or replace function public.staff_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s staff := _me(); d date := _today(s); st sets; m text := _setting_text('reminders_mode', 'off'); e exams; ex sets;
        prog jsonb; pts jsonb;
begin
  select * into st from sets where staff_id = s.id and kind = 'daily' and local_date = d;
  e := _exam_today(s, d);
  if e.id is not null then
    select * into ex from sets where staff_id = s.id and kind = 'exam' and exam_id = e.id and local_date = d;
  end if;
  prog := _programme(s);
  pts := _points(s);
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
    'programme', case when prog is null then null else jsonb_build_object(
        'total', prog -> 'total', 'done', prog -> 'done', 'completed_on', prog -> 'completed_on', 'current', prog -> 'current') end,
    'points', jsonb_build_object('points', pts -> 'points', 'tier', pts -> 'tier', 'next_tier', pts -> 'next_tier', 'to_next', pts -> 'to_next'),
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
-- Managers: enrol, sign off, see progress
-- ---------------------------------------------------------------------------
create or replace function public.programme_enrol(p_staff uuid[], p_on boolean) returns int
language plpgsql volatile security definer set search_path = public as $$
declare s staff; n int := 0;
begin
  for s in select * from staff where id = any(p_staff) loop
    if not public.is_manager_for(s.venue_id) then raise exception 'Not allowed for %.', _name(s); end if;
    if p_on then
      insert into programme_enrolments (staff_id, enrolled_on, enrolled_by, active)
      values (s.id, _venue_today(s.venue_id), public.current_display_name(), true)
      on conflict (staff_id) do update set active = true;
    else
      update programme_enrolments set active = false where staff_id = s.id;
    end if;
    n := n + 1;
    insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
    values (auth.uid(), public.current_display_name(), case when p_on then 'programme_enrolled' else 'programme_removed' end,
            'staff', s.id::text, '{}'::jsonb);
  end loop;
  return n;
end;
$$;

create or replace function public.programme_sign_off(p_staff uuid, p_step uuid, p_undo boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff; g programme_progress; left_n int;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  select * into g from programme_progress where staff_id = p_staff and step_id = p_step;
  if coalesce(p_undo, false) then
    update programme_progress set signed_off_at = null, signed_off_by = null where staff_id = p_staff and step_id = p_step;
    update programme_enrolments set completed_on = null where staff_id = p_staff;
  else
    if g.exam_passed_at is null then raise exception 'The step exam needs passing before the sign-off.'; end if;
    update programme_progress set signed_off_at = now(), signed_off_by = public.current_display_name()
    where staff_id = p_staff and step_id = p_step and signed_off_at is null;
    select count(*) into left_n from _programme_steps(s) x where x.status <> 'done';
    if left_n = 0 then
      update programme_enrolments set completed_on = coalesce(completed_on, _venue_today(s.venue_id)) where staff_id = p_staff;
    end if;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), case when p_undo then 'programme_signoff_undone' else 'programme_signed_off' end,
          'staff', p_staff::text, jsonb_build_object('step', p_step));
  return _programme(s);
end;
$$;

create or replace function public.dash_programme(p_venue text default null, p_include_test boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', s.id, 'name', _name(s), 'role', s.role, 'is_test', s.is_test,
        'venue', (select name from venues where id = s.venue_id),
        'enrolled_on', e.enrolled_on, 'completed_on', e.completed_on,
        'total', pr -> 'total', 'done', pr -> 'done', 'current', pr -> 'current', 'steps', pr -> 'steps')
        order by (e.completed_on is not null), (pr -> 'current' ->> 'status') = 'signoff' desc, s.first_name), '[]'::jsonb)
      from _dash_staff(p_venue, p_include_test) s join programme_enrolments e on e.staff_id = s.id and e.active
      cross join lateral (select _programme(s) pr) z),
    'others', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', _name(s), 'role', s.role, 'is_test', s.is_test,
        'venue', (select name from venues where id = s.venue_id)) order by s.first_name), '[]'::jsonb)
      from _dash_staff(p_venue, p_include_test) s
      where not exists (select 1 from programme_enrolments e where e.staff_id = s.id and e.active)));
$$;

create or replace function public.dash_ranking(p_venue text default null, p_include_test boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by (r ->> 'points')::int desc, r ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object('staff_id', s.id, 'name', _name(s), 'role', s.role, 'is_test', s.is_test,
             'venue', (select name from venues where id = s.venue_id), 'level_name', _level_name(s.level)) || _points(s) r
    from _dash_staff(p_venue, p_include_test) s) x;
$$;

-- ---------------------------------------------------------------------------
-- Admin: edit the steps
-- ---------------------------------------------------------------------------
create or replace function public.programme_steps_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from user_roles where user_id = auth.uid() and role = 'venue_manager')) then
    raise exception 'Not allowed.';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'position', p.position, 'name', p.name, 'track_id', p.track_id, 'unit_id', p.unit_id,
      'topic', (select t.name || coalesce(': ' || u.name, '') from tracks t left join units u on u.id = p.unit_id where t.id = p.track_id),
      'roles', p.roles, 'exam_cards', p.exam_cards, 'pass_pct', p.pass_pct, 'signoff_note', p.signoff_note, 'active', p.active,
      'pool', (select jsonb_object_agg(r, _step_pool(p, r)) from unnest(p.roles) r))
      order by p.position, p.created_at), '[]'::jsonb) from programme_steps p);
end;
$$;

create or replace function public.save_programme_step(
  p_id uuid, p_name text, p_track text, p_unit text, p_roles text[], p_cards int, p_pass int, p_note text, p_active boolean default true
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare sid uuid := p_id; u text := nullif(p_unit, '');
begin
  if not public.is_admin() then raise exception 'Only the admin can edit the programme.'; end if;
  if coalesce(cardinality(p_roles), 0) = 0 then raise exception 'Pick at least one role.'; end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('host', 'server', 'runner', 'bar', 'barista')) then raise exception 'Unknown role.'; end if;
  if not exists (select 1 from tracks where id = p_track) then raise exception 'Pick a topic.'; end if;
  if u is not null and not exists (select 1 from units where id = u and track_id = p_track) then raise exception 'That part doesn''t belong to the topic.'; end if;
  if p_cards is null or p_cards not between 5 and 40 then raise exception 'Exam cards: between 5 and 40.'; end if;
  if p_pass is null or p_pass not between 50 and 100 then raise exception 'Pass mark: between 50 and 100.'; end if;
  if sid is null then
    insert into programme_steps (position, name, track_id, unit_id, roles, exam_cards, pass_pct, signoff_note, active)
    values ((select coalesce(max(position), 0) + 1 from programme_steps), trim(p_name), p_track, u, p_roles, p_cards, p_pass,
            nullif(trim(coalesce(p_note, '')), ''), coalesce(p_active, true))
    returning id into sid;
  else
    update programme_steps set name = trim(p_name), track_id = p_track, unit_id = u, roles = p_roles, exam_cards = p_cards,
      pass_pct = p_pass, signoff_note = nullif(trim(coalesce(p_note, '')), ''), active = coalesce(p_active, active)
    where id = sid;
  end if;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'programme_step_saved', 'programme_step', sid::text,
          jsonb_build_object('name', p_name, 'active', p_active));
  return sid;
end;
$$;

create or replace function public.move_programme_step(p_id uuid, p_dir int) returns void
language plpgsql volatile security definer set search_path = public as $$
declare a programme_steps; b programme_steps;
begin
  if not public.is_admin() then raise exception 'Only the admin can edit the programme.'; end if;
  select * into a from programme_steps where id = p_id;
  if a.id is null then raise exception 'Unknown step.'; end if;
  if p_dir < 0 then
    select * into b from programme_steps where (position, created_at) < (a.position, a.created_at) order by position desc, created_at desc limit 1;
  else
    select * into b from programme_steps where (position, created_at) > (a.position, a.created_at) order by position, created_at limit 1;
  end if;
  if b.id is null then return; end if;
  update programme_steps set position = case when id = a.id then b.position else a.position end where id in (a.id, b.id);
  if a.position = b.position then
    update programme_steps set position = position + case when p_dir < 0 then -1 else 1 end where id = a.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public._step_pool(public.programme_steps, text), public._step_cards(public.programme_steps, text, int),
  public._programme_steps(public.staff), public._programme(public.staff), public._weeks_met(public.staff),
  public._tier(int), public._points(public.staff)
  from public, anon, authenticated;
revoke execute on function public.my_programme(), public.study_step(uuid), public.start_step_exam(uuid, float8, float8, float8),
  public.programme_enrol(uuid[], boolean), public.programme_sign_off(uuid, uuid, boolean),
  public.dash_programme(text, boolean), public.dash_ranking(text, boolean),
  public.programme_steps_admin(), public.save_programme_step(uuid, text, text, text, text[], int, int, text, boolean),
  public.move_programme_step(uuid, int)
  from public, anon;
grant execute on function public.my_programme(), public.study_step(uuid), public.start_step_exam(uuid, float8, float8, float8),
  public.programme_enrol(uuid[], boolean), public.programme_sign_off(uuid, uuid, boolean),
  public.dash_programme(text, boolean), public.dash_ranking(text, boolean),
  public.programme_steps_admin(), public.save_programme_step(uuid, text, text, text, text[], int, int, text, boolean),
  public.move_programme_step(uuid, int)
  to authenticated;

select 'programme and ranking ready' as result, (select count(*) from programme_steps) as steps;
