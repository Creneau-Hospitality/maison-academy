-- Maison Academy · Phase 1 · option order (David, 16 Oct 2026)
-- 1. Reordering a card's options is not a content change: it doesn't make a
--    new version or send a live card back to review. For "put in order"
--    cards the right order (answer) still counts; for other types the order
--    of the right answers doesn't matter either.
-- 2. One-off: shuffle the stored options of every card except "put in order"
--    cards, so the right answer isn't always first. Approvals are kept.
--    (Staff never rely on the stored order: the app shuffles options every
--    time a card is shown.)

create or replace function public.sorted_jsonb(a jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from jsonb_array_elements(a) x;
$$;

create or replace function public.card_content(c public.cards) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'track_id', c.track_id, 'unit_id', c.unit_id, 'level', c.level, 'roles', c.roles,
    'type', c.type, 'prompt', c.prompt, 'media', c.media,
    'options', public.sorted_jsonb(c.options),
    'answer', case when c.type = 'order' then c.answer else public.sorted_jsonb(c.answer) end,
    'explanation', c.explanation, 'why_it_matters', c.why_it_matters,
    'is_allergen', c.is_allergen, 'source_ref', c.source_ref
  );
$$;

-- Plain random shuffle: every position is equally likely for the right
-- answer, including first, so there's no pattern to learn.
update public.cards
set options = (select jsonb_agg(x order by random()) from jsonb_array_elements(options) x)
where type <> 'order';

-- Keep the saved-by names on the existing version snapshots.
update public.card_versions set saved_by = 'Phase 0 drafts' where saved_by = 'System';

insert into public.audit_log (actor, action, entity, detail)
values ('David (via Claude)', 'options_shuffled', 'cards',
        jsonb_build_object('reason', 'Right answer was always the first option', 'cards',
                           (select count(*) from public.cards where type <> 'order')));

-- Check: how often is the right answer first now?
select type,
       count(*) filter (where options->0 = answer->0) as right_answer_first,
       count(*) as cards,
       max(version) as highest_version
from public.cards group by type order by type;
