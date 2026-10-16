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
| Netlify | Team `Creneau Hospitality`, project `maison-academy`, https://maison-academy.netlify.app | David (only owner on the Free plan) | Deploys automatically from `main` on GitHub, publishing the `site` folder (`netlify.toml`). Team protection is on: only signed-in team members can view. Turn it off in Phase 4. Move to Pro and add Gerard and the shared mailbox as owners in Phase 4. |

### Keys

- The Supabase **publishable** key is in `site/config.js`. It is meant to be public: every visitor's browser receives it. Access is controlled by row-level security in the database.
- The **secret / service-role** key and the database password never go in the repository, in front-end code or in chat. When server code needs them they go in Netlify or Supabase environment variables.

## Deploy, restore, import

- **Deploy:** push to `main` on GitHub. Netlify publishes within a minute or two. No build step yet; from Phase 1 the build command and output folder will be set in `netlify.toml`.
- **Check:** open the site. The Database box should read "Connected to Supabase (Frankfurt)".
- **Restore:** to be written in Phase 1, once there is data to restore.
- **Import:** to be written when the card import and roster import exist.
