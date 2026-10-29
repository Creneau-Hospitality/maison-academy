-- Maison Academy · 0023 one try per step exam
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Change of plan (David, 29 October): a new-joiner step exam can be taken once.
-- If it isn't passed, a manager allows a retry (one more try each time).
-- Safe to run again.

update public.settings
set value = '1', note = 'New-joiner step exam: tries before a manager has to allow a retry'
where key = 'programme_exam_tries';

-- The message when the try is used.
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
    raise exception 'You''ve had your try for this step. Keep studying; your manager can allow a retry when you''re ready.';
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

select key, value from public.settings where key = 'programme_exam_tries';
