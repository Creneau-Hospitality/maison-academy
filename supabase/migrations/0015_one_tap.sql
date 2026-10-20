-- Maison Academy · Phase 2 · One-tap answers (David, 20 Oct 2026)
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- David found the "How sure were you?" step confusing, so staff now answer
-- with one tap and the confidence step is gone (brief 6.4 and 6.6 changed;
-- recorded in DECISIONS.md):
--   * Right: the card moves up one box. Not yet: back to box 1.
--   * A card counts as known ("mastered") when the last answer was right and
--     it has reached box 4, which means right three times in a row, spaced out.
--   * Confidence is no longer collected, so the private "not yet, but sure"
--     allergen prompt can't happen. The prompt code stays, unused, in case
--     confidence ever comes back.
-- Safe to run more than once.

alter table public.events alter column confidence drop not null;

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
  if p_confidence is not null and p_confidence not in ('sure', 'think', 'guess') then raise exception 'Unknown confidence.'; end if;
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

  -- "Not yet, but sure" on an allergen card (only if confidence is collected again).
  if not ok and p_confidence = 'sure' and c.is_allergen and not exists (
       select 1 from coaching_prompts where staff_id = s.id and card_id = c.id and resolved_at is null) then
    insert into coaching_prompts (staff_id, venue_id, card_id) values (s.id, s.venue_id, c.id);
  end if;

  return jsonb_build_object('correct', ok, 'box', b_after);
end;
$$;

-- Known = last answer right and the card in box 4 or above (right three times, spaced out).
create or replace function public._mastery(s public.staff, p_max_level int) returns table (
  track_id text, track text, sort int, live int, mastered int, pct int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.sort,
         count(c.id)::int,
         count(c.id) filter (where st.last_result and st.box >= 4)::int,
         case when count(c.id) = 0 then 0
              else floor(100.0 * count(c.id) filter (where st.last_result and st.box >= 4) / count(c.id))::int end
  from tracks t
  left join cards c on c.track_id = t.id and c.status = 'live' and s.role = any(c.roles) and c.level <= p_max_level
  left join card_state st on st.staff_id = s.id and st.card_id = c.id
  group by t.id, t.name, t.sort;
$$;

revoke execute on function public._mastery(public.staff, int) from public, anon, authenticated;
revoke execute on function public.record_answer(uuid, uuid, text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.record_answer(uuid, uuid, text, jsonb, text, timestamptz) to authenticated;

select 'one-tap answers ready' as result;
