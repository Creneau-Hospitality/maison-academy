-- Maison Academy · Phase 1 · harder wrong options, sample of 10 (David, 16 Oct 2026)
-- Same question facts and right answers; the wrong options now come from our
-- own menus and standards, so they sound right. The right answer is no longer
-- the longest option. Each card goes back to review for David to approve.

with changes(id, options, answer, explanation) as (values
  ('svc-timing-standards-0046',
   '["Within 5 minutes","Within 8 minutes","Within 10 minutes","Within 3 minutes"]'::jsonb, null::jsonb, null::text),
  ('svc-timing-standards-0048',
   '["Within 10 minutes","Within 20 minutes","Within 15 minutes","Within 5 minutes"]', null, null),
  ('svc-timing-standards-0050',
   '["Within 5 minutes","Within 2 minutes","After about 10 minutes","Once they''re halfway through"]', null, null),
  ('svc-runner-sequence-0037',
   '["The waiter only, so they can apologise","The chef in charge, and the waiter","The manager on duty, after the shift","No one unless the guest asks you to"]', null, null),
  ('sop-guest-recovery-0012',
   '["Apologise and offer to replace the dish","Explain what happened in the kitchen","Listen without interrupting","Reassure them it won''t happen again"]', null, null),
  ('sop-house-standards-0022',
   '["\"I think so, but I''m not sure\"","\"It should say on the menu\"","\"Let me find out for you\"","\"I''ll check if I get a minute\""]', null, null),
  ('food-breakfast-0018',
   '["Sujuk sausage","Black pudding","Brioche toast","Hash brown","Sautéed spinach","Grilled tomato"]',
   '["Black pudding","Hash brown","Grilled tomato"]', null),
  ('food-lunch-dinner-0043',
   '["Beer-battered haddock, mushy peas, tartare, fries","Beer-battered cod, garden peas, tartare, fries","Beer-battered cod, mushy peas, tartare, fries","Breaded cod, mushy peas, aioli, fries"]', null, null),
  ('drk-beer-0015',
   '["6.6%","8.5%","6.2%","6.5%"]', null,
   'Duvel (Belgium, 8.5%) is "Belgian beer royalty", devilishly strong. Leffe Blonde is 6.6% and Leffe Brune 6.5%.'),
  ('drk-cocktails-0020',
   '["Vintage rock glass, orange peel","Red wine glass, orange peel","Red wine glass, dry orange","Highball, dry orange"]', null, null)
)
update public.cards c
set options = ch.options,
    answer = coalesce(ch.answer, c.answer),
    explanation = coalesce(ch.explanation, c.explanation),
    status = 'review', reviewed_by = null, reviewed_at = null,
    review_note = 'Harder wrong options (sample of 10), drafted by Claude 16 Oct 2026. Same facts and right answer; the new wrong options come from our own menus and standards.',
    updated_by = 'Claude (draft for David)'
from changes ch
where c.id = ch.id;

update public.card_versions set saved_by = 'Claude (draft for David)'
where saved_by = 'System' and card_id in (select id from public.cards where updated_by = 'Claude (draft for David)');
update public.audit_log set actor = 'Claude (draft for David)'
where actor = 'System' and action = 'card_edited';

-- Check: every right answer is still one of the options.
select id, status, version,
       (select bool_and(options ? a) from jsonb_array_elements_text(c.answer) a(a)) as right_answer_in_options
from public.cards c where updated_by = 'Claude (draft for David)' order by id;
