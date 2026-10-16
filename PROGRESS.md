# Progress

**Current phase:** 0 done on 16 October, once David publishes the `phase-0` release on GitHub. Phase 1 is next and waits on network settings.
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
- 37 drinks cards drafted at Level 2 (2 allergen cards).
- David approved all 189 cards: 160 live, 29 allergen cards in review for Gerard.
- Gerard confirmed owner access and is watching the repository. Phase-0 report written; David publishes the release on GitHub.
- Waiter's sequence of service updated with the allergen question at step 3.

## Next

1. Allow package registries for Claude's workspace (claude.ai, Settings > Capabilities). The setting was saved on 16 October but hadn't reached this session; check it in a new session.
2. Phase 1: content studio, load the 189 cards, Gerard's reviewer login.
3. Gerard checks the 29 allergen cards; allergen matrix still wanted.
4. David re-exports `SOS_Waiter.pdf` from PowerPoint.
5. Next cards once sources arrive: photo cards, payments and alcohol service SOPs, beer serves, coffee recipes, wine pairings.

## Known issues

- No allergen matrix yet. Allergen cards are drafted from menu ingredients only and wait for Gerard's check.
- Netlify is on Free with one owner; move to Pro and add Gerard in Phase 4.
- Accounts use David's email for now. The shared Creneau mailbox must be added as owner on all three before Phase 4.
- Network: Claude's workspace can't reach the npm package registry, Supabase or Netlify (blocked by the session's network settings, checked 16 October). The Phase 0 hello page needs none of them. Phase 1 needs npm, so David (or the Claude plan's organisation owner) allows package registries, and ideally api.supabase.com and api.netlify.com, on claude.ai under Settings > Capabilities.
