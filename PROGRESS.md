# Progress

**Current phase:** 0, kick-off (nearly done).
**Last updated:** 16 October 2026.

## Done

- Week-1 decisions recorded in `DECISIONS.md`: sequence of service and timings, card approval, practice time, pilot dates and champion.
- Project folder set up at `5. OPERATIONS/maison-academy`.
- Content check done: `content/CONTENT_CHECK.md` lists what we have, 14 missing files with owners, and 5 points still to confirm.
- Accounts: GitHub organisation `Creneau-Hospitality` with private repository `maison-academy`; Supabase organisation `Creneau Hospitality` with project `maison-academy` in Frankfurt; Netlify team `Creneau Hospitality`. Gerard invited as owner on GitHub and Supabase.
- Repository set up with LICENSE, README credit, reports and exports folders.
- Hello page live at https://maison-academy.netlify.app (private for now), connected to Supabase in Frankfurt. Checked by David on 16 October.
- Arabian Ranches menus received; allergen flags written for Gerard (`content/MENU_ALLERGEN_FLAGS.md`).
- 152 Level 1 cards drafted, all in review: service 52, SOPs 35, food 65 (27 allergen cards). See `content/drafts/README.md`.
- 37 drinks cards drafted at Level 2, in review (2 allergen cards).
- Waiter's sequence of service updated with the allergen question at step 3.

## Next

1. Gerard accepts the GitHub and Supabase invitations and turns on Watch for the repository.
2. Publish the phase-0 release (report in `reports/`), so Gerard receives it.
3. David reviews the card drafts (`content/drafts/level1-cards-review.csv` and `level2-drinks-cards-review.csv`); Gerard checks the 29 allergen cards.
4. David re-exports `SOS_Waiter.pdf` from PowerPoint.
5. Before Phase 1: allow package registries in Claude's network settings; allergen matrix still wanted.
6. Next drafts once sources arrive: photo cards, payments and alcohol service SOPs, beer serves, coffee recipes, wine pairings.

## Known issues

- No allergen matrix yet. Allergen cards are drafted from menu ingredients only and wait for Gerard's check.
- Netlify is on Free with one owner; move to Pro and add Gerard in Phase 4.
- Accounts use David's email for now. The shared Creneau mailbox must be added as owner on all three before Phase 4.
- Network: Claude's workspace can't reach the npm package registry, Supabase or Netlify (blocked by the session's network settings, checked 16 October). The Phase 0 hello page needs none of them. Phase 1 needs npm, so David (or the Claude plan's organisation owner) allows package registries, and ideally api.supabase.com and api.netlify.com, on claude.ai under Settings > Capabilities.
