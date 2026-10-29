-- Maison Academy · 0022 step exam tries
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- New-joiner step exams can be tried 3 times (setting programme_exam_tries). After
-- that the exam stays closed until a manager opens another round of tries for that
-- person and step (David, 29 October). Studying stays open. An attempt counts once
-- it's started; an unfinished attempt can always be finished.
-- Safe to run again.

insert into public.settings (key, value, note) values
  ('programme_exam_tries', '3', 'New-joiner step exam: tries before a manager has to open another round')
on conflict (key) do nothing;

alter table public.programme_progress add column if not exists retry_approved_at timestamptz;
alter table public.programme_progress add column if not exists retry_approved_by text;
alter table public.programme_progress add column if not exists retries_granted int not null default 0;

-- The step list gains tries used / left (the return type changes, so it is recreated).
drop function if exists public._programme_steps(public.staff);

create or replace function public._programme_steps(s public.staff)
returns table (step_id uuid, n int, name text, topic text, exam_cards int, pass_pct int, signoff_note text,
               status text, best_pct int, passed_at timestamptz, signed_at timestamptz, signed_by text, pool int,
               tries_used int, tries_left int, open_attempt boolean, retries_granted int)
language sql stable security definer set search_path = public as $$
  with st as (
    select p.*, row_number() over (order by p.position, p.created_at)::int n, _step_pool(p, s.role) pool,
           g.exam_best_pct, g.exam_passed_at, g.signed_off_at, g.signed_off_by, coalesce(g.retries_granted, 0) retries_granted,
           (select count(*)::int from sets x where x.staff_id = s.id and x.kind = 'step' and x.step_id = p.id
              and x.started_at > coalesce(g.retry_approved_at, '-infinity'::timestamptz)) tries_used,
           exists (select 1 from sets x where x.staff_id = s.id and x.kind = 'step' and x.step_id = p.id and x.finished_at is null) open_attempt
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
         st.exam_best_pct, st.exam_passed_at, st.signed_off_at, st.signed_off_by, st.pool,
         st.tries_used, greatest(_setting_int('programme_exam_tries', 3) - st.tries_used, 0), st.open_attempt, st.retries_granted
  from st order by st.n;
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
  if not r.open_attempt and r.tries_left <= 0 then
    raise exception 'You''ve used your % tries for this step. Keep studying; your manager can open another round when you''re ready.',
      _setting_int('programme_exam_tries', 3);
  end if;
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
    'step', case when p.id is not null then jsonb_build_object('id', p.id, 'name', p.name, 'pass_pct', p.pass_pct, 'signoff_note', p.signoff_note,
              'tries', _setting_int('programme_exam_tries', 3),
              'tries_left', (select x.tries_left from _programme_steps(s) x where x.step_id = p.id)) end,
    'level', lvl, 'level_name', _level_name(lvl), 'level_up', lvl > s.level,
    'rhythm', _rhythm(s), 'team', _team(s));
end;
$$;


-- Managers: open another round of tries.
create or replace function public.programme_allow_retry(p_staff uuid, p_step uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare s staff; r record;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or not public.is_manager_for(s.venue_id) then raise exception 'Not allowed.'; end if;
  select x.* into r from _programme_steps(s) x where x.step_id = p_step;
  if r.step_id is null or r.status <> 'current' then raise exception 'That step isn''t waiting for a retry.'; end if;
  if r.tries_left > 0 or r.open_attempt then raise exception 'They still have tries left on this step.'; end if;
  insert into programme_progress as g (staff_id, step_id, retry_approved_at, retry_approved_by, retries_granted)
  values (p_staff, p_step, now(), public.current_display_name(), 1)
  on conflict (staff_id, step_id) do update set
    retry_approved_at = now(), retry_approved_by = public.current_display_name(), retries_granted = g.retries_granted + 1;
  insert into audit_log (actor_id, actor, action, entity, entity_id, detail)
  values (auth.uid(), public.current_display_name(), 'programme_retry_allowed', 'staff', p_staff::text, jsonb_build_object('step', p_step));
  return _programme(s);
end;
$$;

revoke execute on function public._programme_steps(public.staff) from public, anon, authenticated;
revoke execute on function public.programme_allow_retry(uuid, uuid) from public, anon;
grant execute on function public.programme_allow_retry(uuid, uuid) to authenticated;

select 'step exam tries ready' as result;
