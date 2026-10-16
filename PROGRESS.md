# Progress

**Current phase:** 1, content studio, built on 16 October (evening). Waiting for David to try it, then the phase-1 report, export and release.
**Last updated:** 16 October 2026, evening.

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
- Screen test (headless browser, sample data): every screen loads, no errors, no sideways scrolling at 360 px.

## Next

1. David reviews the 10 harder cards (studio: status In review, Not allergen) and says whether to do the rest.
2. Check with David that retiring `drk-beer-0016` was intended (one click to restore).
3. Phase-1 report, card export to `exports/`, and David publishes the `phase-1` release.
4. Kitchen check of the 29 allergen cards (Arabian Ranches head chef or Gerard), from a one-page list. They stay hidden from staff until then.
5. Gerard accepts the GitHub and Supabase invitations when he can (not blocking).
6. Next cards once sources arrive: photo cards, payments and alcohol service SOPs, beer serves, coffee recipes, wine pairings.

## Known issues

- Source conflict to settle: the Service Training Program lets staff remove a single item from the bill themselves (card `sop-guest-recovery-0016`), but its void and discount controls say every void needs manager authorisation (card `sop-controls-0030`). Both cards are live. Asked David 16 October.

- No allergen matrix yet. Allergen cards are drafted from menu ingredients only and wait for a kitchen check.
- Netlify is on Free with one owner; move to Pro and add Gerard in Phase 4.
- Accounts use David's email for now. The shared Creneau mailbox must be added as owner on all three before Phase 4.
