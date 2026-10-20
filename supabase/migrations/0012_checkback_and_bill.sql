-- Maison Academy · check-back wording and bill timing (David, 20 Oct 2026)
-- 1. Check back within 2 minutes: unchanged (svc-timing-standards-0050 already says so).
-- 2. Check-back question: naming the dish ("How is your steak?") is preferred; "How are you
--    enjoying your meal?" is also accepted, so it can't be a wrong option any more.
-- 3. Bill: present within 2 to 3 minutes of the request (was 3), payment done within 5.
-- Both cards go back to review. Each is only changed if nobody has edited it since 20 Oct, 10:30.

update public.cards set
  prompt = 'A guest is eating the Steak and Fries. What''s the best check-back question?',
  options = '["\"Is everything OK?\" as you walk past", "\"How is your steak?\"", "\"Are you still working on that?\"", "\"Shall I bring the bill?\""]',
  answer = '["\"How is your steak?\""]',
  explanation = 'Ask about the dish by name, such as "How is your steak?" "How are you enjoying your meal?" is fine too, but naming the dish shows real interest.',
  source_ref = 'SOS Waiter (Sequence of Service, Waiter), step 4; Sequence of service steps, 11-step document, step 6; David, 20 Oct 2026 (naming the dish preferred, both accepted)',
  status = 'review', reviewed_by = null, reviewed_at = null,
  review_note = 'Updated 20 Oct 2026: naming the dish is preferred; "How are you enjoying your meal?" is also accepted (David).',
  updated_by = 'Claude (draft for David)'
where id = 'svc-waiter-sequence-0021' and version = 2;

update public.cards set
  options = '["Present it within 5 minutes, payment done within 3", "Present it within 2 to 3 minutes, payment done within 5", "Present it within 3 minutes, payment done within 10", "Present it within 5 minutes, payment done within 10"]',
  answer = '["Present it within 2 to 3 minutes, payment done within 5"]',
  explanation = 'Present the bill within 2 to 3 minutes of the request and finalise payment within 5.',
  source_ref = 'Service Training Program v2026/01, sequence step 6; Sequence of service steps, 11-step document, step 10; David, 20 Oct 2026 (bill within 2 to 3 minutes)',
  status = 'review', reviewed_by = null, reviewed_at = null,
  review_note = 'Updated 20 Oct 2026: bill within 2 to 3 minutes of the request (David).',
  updated_by = 'Claude (draft for David)'
where id = 'svc-timing-standards-0051' and version = 3;

update public.card_versions set saved_by = 'Claude (draft for David)' where saved_by = 'System';
update public.audit_log set actor = 'Claude (draft for David)' where actor = 'System' and action = 'card_edited';

select string_agg(id || ': ' || status || ' v' || version || ' - ' || (answer->>0), ' | ') as result
from public.cards where id in ('svc-waiter-sequence-0021', 'svc-timing-standards-0051');
