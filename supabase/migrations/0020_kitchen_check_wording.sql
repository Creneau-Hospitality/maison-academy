-- Maison Academy · 0020 kitchen check wording
-- Copyright © 2026 Creneau Hospitality. All rights reserved.
--
-- Gerard is no longer named in the app (David, 24 October). Card review notes
-- that said "Gerard to check" now say the kitchen checks. Review notes are not
-- card content, so no card changes version or goes back to review.
-- Safe to run again.

update public.cards
set review_note = replace(replace(review_note, 'Gerard to check', 'Kitchen to check'), 'Gerard', 'the kitchen')
where review_note like '%Gerard%';

select count(*) as notes_still_naming_him from public.cards where review_note like '%Gerard%';
