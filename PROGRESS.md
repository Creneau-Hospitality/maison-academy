# Progress

**Current phase:** 0, kick-off.
**Last updated:** 16 October 2026.

## Done

- Week-1 decisions recorded in `DECISIONS.md`: sequence of service and timings, card approval, practice time, pilot dates and champion.
- Project folder set up at `5. OPERATIONS/maison-academy`.
- Content check done: `content/CONTENT_CHECK.md` lists what we have, 14 missing files with owners, and 5 points still to confirm.

## Next

1. Accounts: GitHub, Supabase (Frankfurt), Netlify, on a shared Creneau mailbox, with Gerard and David as owners.
2. Repository: LICENSE, README, reports, exports; a brand-style "hello" page live on Netlify and connected to Supabase.
3. Gerard confirms access and turns on Watch; phase-0 report and release.

## Known issues

- No allergen matrix yet, so no allergen cards can be drafted.
- Netlify is on Free with one owner; move to Pro and add Gerard in Phase 4.
- Accounts use David's email for now. The shared Creneau mailbox must be added as owner on all three before Phase 4.
- Network: Claude's workspace can't reach the npm package registry, Supabase or Netlify (blocked by the session's network settings, checked 16 October). The Phase 0 hello page needs none of them. Phase 1 needs npm, so David (or the Claude plan's organisation owner) allows package registries, and ideally api.supabase.com and api.netlify.com, on claude.ai under Settings > Capabilities.
