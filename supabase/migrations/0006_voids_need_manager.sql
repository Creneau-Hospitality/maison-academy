-- Maison Academy · Phase 1 · voids need manager authorisation (David, 16 Oct 2026)
-- The Service Training Program contradicted itself: its recovery section let
-- staff remove a single item from the bill, its void controls said every void
-- needs a manager. David settled it: voids need manager authorisation.
-- Both cards go back to review for David to approve.

update public.cards
set options = (select jsonb_agg(case when x = to_jsonb('Apologise, replace it now, take it off the bill and tell the kitchen'::text)
                                     then to_jsonb('Apologise, replace it now, tell the kitchen and ask a manager to void it'::text)
                                     else x end)
               from jsonb_array_elements(options) x),
    answer = '["Apologise, replace it now, tell the kitchen and ask a manager to void it"]',
    explanation = 'For a cold or incorrect dish: apologise, replace it immediately and notify the kitchen. Taking it off the bill is a void, so a manager authorises it.',
    source_ref = 'Service Training Program v2026/01, complaint scenario playbook; void and discount controls (David, 16 Oct 2026: voids need manager authorisation)',
    status = 'review', reviewed_by = null, reviewed_at = null,
    review_note = 'Updated 16 Oct 2026: voids need manager authorisation (David).',
    updated_by = 'Claude (draft for David)'
where id = 'sop-guest-recovery-0014';

update public.cards
set answer = '["Replacing a dish or drink","Adjusting seating, noise or pace"]',
    explanation = 'You can replace a dish or drink, apologise and follow up, and adjust seating, noise or pace. Removing an item from the bill is a void and needs a manager, as do refunds and illness or injury.',
    source_ref = 'Service Training Program v2026/01, resolve it or escalate it?; void and discount controls (David, 16 Oct 2026: voids need manager authorisation)',
    status = 'review', reviewed_by = null, reviewed_at = null,
    review_note = 'Updated 16 Oct 2026: voids need manager authorisation (David). "Removing a single item from the bill" is now a wrong option.',
    updated_by = 'Claude (draft for David)'
where id = 'sop-guest-recovery-0016';

update public.card_versions set saved_by = 'Claude (draft for David)'
where saved_by = 'System' and card_id in ('sop-guest-recovery-0014', 'sop-guest-recovery-0016');
update public.audit_log set actor = 'Claude (draft for David)'
where actor = 'System' and action = 'card_edited';

select id, status, version, answer,
       (select bool_and(options ? a) from jsonb_array_elements_text(c.answer) a(a)) as right_answer_in_options
from public.cards c where id in ('sop-guest-recovery-0014', 'sop-guest-recovery-0016') order by id;
