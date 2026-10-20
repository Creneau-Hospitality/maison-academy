# Progress

**Current phase:** 3, manager dashboard. Built and live on 20 October with a demo venue of sample people; waiting for David to try it.
**Last updated:** 20 October 2026, afternoon.

## Done

- Week-1 decisions recorded in `DECISIONS.md`: sequence of service and timings, card approval, practice time, pilot dates and champion.
- Project folder set up at `5. OPERATIONS/maison-academy`.
- Content check done: `content/CONTENT_CHECK.md` lists what we have, 14 missing files with owners, and 5 points still to confirm.
- Accounts: GitHub organisation `Creneau-Hospitality` with private repository `maison-academy`; Supabase organisation `Creneau Hospitality` with project `maison-academy` in Frankfurt; Netlify team `Creneau Hospitality`. Gerard invited as owner on GitHub and Supabase.
- Repository set up with LICENSE, README credit, reports and exports folders.
- Hello page live at https://maison-academy.netlify.app (private for now), connected to Supabase in Frankfurt. Checked by David on 16 October.
- Arabian Ranches menus received; allergen flags written for Gerard (`content/MENU_ALLERGEN_FLAGS.md`).
- 152 Level 1 cards drafted, all in review: service 52, SOPs 35, food 65 (27 allergen cards). See `content/drafts/README.md`.
- 37 drinks cards drafted at Level 2 (2 allergen cards).
- David approved all 189 cards: 160 live, 29 allergen cards in review for Gerard.
- Phase-0 report written and release published by David.
- GitHub repository made private on 16 October (it had been public for about two hours after creation; checked private and not viewable signed-out).
- Waiter's sequence of service updated with the allergen question at step 3; `SOS_Waiter.pdf` re-exported from PowerPoint (checked 16 October).
- Network fixed: Claude's workspace reaches npm, Supabase and Netlify (checked 16 October, evening).

## Phase 1 so far (16 October, evening)

- Database set up in Supabase: content tables, row-level security, version history, approvals and an audit log. Tested first on a local copy: 24 checks passed.
- The database refuses to put an allergen card live without a kitchen check, recorded by someone marked as an allergen checker.
- 189 cards loaded with their Phase 0 approvals: 160 live (125 at Level 1), 29 allergen cards in review. Checked field by field against the export: no differences.
- David is the studio admin (his own login, created by him in Supabase).
- Content studio at https://maison-academy.netlify.app/studio: card bank with counts and filters, card editor with a staff preview, approve / approve and next, kitchen check, send back, retire, version history, JSON/CSV import and export, people and roles, learning settings. About line with the copyright and credit.
- Netlify re-linked to the private repository through its GitHub app (David, 16 October); the studio went live at 22:15.
- Supabase Site URL and redirect set, so invite and password-reset emails link to the studio.
- Answer options shuffled (David spotted the right answer was always first): stored order shuffled once on all 182 cards, studio preview shuffles every time, and the staff app must too (Phase 2). Approvals unchanged.
- David tried the studio: edited and re-approved one drinks card (now version 2) and retired one (`drk-beer-0016`, Liefmans Kriek).
- Harder wrong options drafted on a sample of 10 cards (migration 0005), back in review for David. If he likes the level, the rest get the same treatment.
- Voids need manager authorisation (David): the two cards that said otherwise were corrected and sent back to review (migration 0006).
- David approved the 10 harder sample cards unchanged, and the 2 void cards (one with his own edit).
- Harder wrong options drafted on 112 more cards (migrations 0007 to 0010, from `content/harder/`); all back in review. Card bank now: 47 live, 112 in review (harder options), 29 allergen in review, 1 retired.
- 20 Oct: 21 new service cards drafted from the 11-step sequence of service document David shared (unit "Service steps", migration 0011, source saved in `content/sources/`). All in review; one is an allergen card for the kitchen check.
- 20 Oct: David settled the 11-step document's differences (check back 2 min; name the dish, generic also fine; bill 2 to 3 min). Two live cards updated and back in review (migration 0012). The document saved as `2. TRAINING/Sequence of Service/SOS_Service_Steps.docx` and PDF.
- David approved the 112 harder cards.
- 20 Oct: 40 new Level 2 selling cards drafted from David's Server Training Guide: Sales Techniques (migration 0013): Suggestive selling 15, Reading the guest 11 (suggestive track), Upselling 14 (upselling track). Examples use our real Arabian Ranches menu and prices instead of the guide's generic dishes. All in review; one (nut-allergy dessert) is an allergen card for the kitchen check. Card bank: 250 cards, 31 of them allergen cards. The guide PDF is in `content/sources/` on David's computer (PDFs stay out of the repository).
- Screen test (headless browser, sample data): every screen loads, no errors, no sideways scrolling at 360 px.

## Phase 2 so far (20 October)

- David moved on to Phase 2, leaving the remaining review cards and the allergen kitchen check for later. Phase 1's report, export and release are still to do.
- Card bank on 20 October, afternoon: 201 live (136 Level 1, 65 Level 2), 6 in review, 31 allergen cards waiting for the kitchen check, 12 retired.
- Staff database and learning engine (migration 0014, applied 20 October): venues, staff, PIN records, activation codes, card states, sets, answers, coaching prompts, sign-offs, levels, rhythm pauses. The database grades every answer and moves cards between spacing boxes, so the phone can't change the rules.
- Login function `staff-auth` on Supabase Edge Functions (activation with code, PIN login, lockout after 5 tries, obvious PINs refused, never says whether a staff number exists). Deployed 20 October with "Verify JWT" off.
- Staff app at the site's front page: activate (code, privacy notice, PIN), log in, home, daily set with all five card types, "How sure were you?", feedback, set done, review my misses, my progress, readiness check, install help, privacy page. Installable, works on low signal (today's set kept on the phone, answers queued and sent when back online), test bar for test accounts (next day, reset).
- Studio > Staff: add test accounts and print activation codes with a QR code. Real staff come in Phase 4 from the roster.
- David tested on iPhone and Android: works well. He found the "How sure were you?" step confusing, so answers are now one tap (Check button only for pick-all and put-in-order cards), and My progress shows just level steps, tracks and next focus (migration 0015, applied 20 October).
- Extra checks for the sign-off list: a venue manager sees only their own venue (local test, 7 checks passed).
- Tests: local copy, three test accounts over two simulated weeks plus privacy checks (55 checks passed); phone-width screen test (no sideways scrolling, buttons at least 44 px, no banned words); live database test of three days in a throwaway account, undone afterwards (misses came back next set, spacing right, other people's records and PIN hashes blocked).

## Phase 3 so far (20 October)

- `phase-1` and `phase-2` releases published by David.
- Dashboard database (migration 0016, applied 20 October): Overview, Team, Person and Questions figures; practical sign-offs; leave weeks (one a month); "new on the menu" sets that come first in staff's next sets; venue-manager logins; the studio now shows each person only what their role allows.
- Studio: Dashboard (Overview, Team, Person, Questions, CSV downloads), New on the menu, and People can add a venue manager for a venue.
- Demo venue loaded (12 sample people, test accounts, 5 weeks of practice). It never mixes with real figures: the dashboard leaves test and sample accounts out unless "Include test and sample accounts" is ticked (ticked by default while there are no real staff). Remove it in the SQL editor with `select demo_remove();`.
- Tests: local copy, 19 dashboard checks (figures match a manual count; a venue manager sees only their venue; staff can't open the dashboard; menu-set cards come first) plus the earlier staff-app checks again; desktop and phone-width screen test; live check of the figures as David.

## Next

1. David tries the dashboard (Studio > Dashboard): Overview, Team, a person, Questions; tries a sign-off and a "new on the menu" set.
2. Fix what he finds; Phase-3 report and release.
3. Phase 4, pilot ready: roster import, activation sheet, reminders, final privacy notice, paid plans, soft test.
3. Still open from Phase 1: review of the last 6 cards, kitchen check of the 31 allergen cards, phase-1 report, export and release.
4. Decisions still to confirm (defaults in use): weekly target 4 sets, level targets, what Level 3 earns, English only for version 1, the app's name. Privacy notice wording with counsel.
5. Phase 3: the manager dashboard (and practical sign-offs, which Level 1 needs).

## Known issues

- Netlify skipped one deploy on 20 October morning ("account credit usage exceeded"). Later deploys went through. Watch it; the paid plan is planned for Phase 4 anyway.
- The site is behind Netlify team protection, so only signed-in Netlify team members can open it. On an iPhone, the app added to the home screen keeps its own cookies and may ask for the Netlify login again. Staff can only use it once protection is off (Phase 4).



- No allergen matrix yet. Allergen cards are drafted from menu ingredients only and wait for a kitchen check.
- Netlify is on Free with one owner; move to Pro and add Gerard in Phase 4.
- Accounts use David's email for now. The shared Creneau mailbox must be added as owner on all three before Phase 4.
