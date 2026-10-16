# Handover

How Maison Academy fits together and where everything lives. Names only, never passwords or keys. Read this with `MAISON_ACADEMY_BUILD_BRIEF.md`.

## People

- Concept and foundational design: Gerard McCormick, Head of Culinary (owner on every account).
- Build lead and product owner: David, Operations Manager.

## Files

| Where | What |
| --- | --- |
| `5. OPERATIONS/maison-academy` (David's computer) | Project folder and, from Phase 0, the code repository |
| `MAISON_ACADEMY_BUILD_BRIEF.md` | What to build and how |
| `DAVID_ROADMAP.md` | David's step-by-step plan |
| `PROGRESS.md`, `DECISIONS.md` | Where we are; every decision, dated |
| `content/` | Content check and new source files |
| `5. OPERATIONS/1. MANUAL`, `2. TRAINING` | Source library for cards (see `content/CONTENT_CHECK.md`) |

## Accounts

All three are set up on David's email (david@swrhospitality.com) for now. The shared Creneau mailbox is added as owner on each before Phase 4 (see `DECISIONS.md`).

| Account | Name | Owners | Notes |
| --- | --- | --- | --- |
| GitHub | Organisation `Creneau-Hospitality`, private repository `maison-academy` | David (David-SWR); Gerard invited as Owner | The Claude GitHub app is installed on this one repository so Claude can push. |
| Supabase | Organisation `Creneau Hospitality`, project `maison-academy` | David; Gerard invited as Owner | Project URL `https://dxipjlkledacoabdhrdg.supabase.co`. Region Central EU (Frankfurt). Free plan; move to Pro before real staff data. The database password is in David's password manager, never in files. |
| Netlify | To be set up | | |

### Keys

- The Supabase **publishable** key is in `site/config.js`. It is meant to be public: every visitor's browser receives it. Access is controlled by row-level security in the database.
- The **secret / service-role** key and the database password never go in the repository, in front-end code or in chat. When server code needs them they go in Netlify or Supabase environment variables.

## Deploy, restore, import

To be written once the app exists.
