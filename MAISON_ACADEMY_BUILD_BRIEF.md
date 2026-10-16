# Maison Academy: build brief for Claude

> **For David, before you start.** This file tells Claude what to build and how to work with you. Keep it in your project folder. If you use Claude Code, rename it `CLAUDE.md` so Claude reads it automatically. In the Claude desktop app, attach it (or add it to the project's instructions) at the start of each session and say: *"Read the build brief and PROGRESS.md, then tell me where we are."* Your step-by-step plan is in `DAVID_ROADMAP.md`.

---

## 1. The project at a glance

| | |
| --- | --- |
| **What** | A phone-first training app for Maison Mathis front-of-house teams, plus a manager dashboard |
| **Owner** | Creneau Hospitality. All code, content and accounts belong to the company. |
| **Concept and foundational design** | Gerard McCormick, Head of Culinary (gerard.mccormick@creneau.com) |
| **Build lead and product owner** | David, Operations Manager. He makes the decisions and is not a developer. |
| **Users** | Hosts, servers, runners, bartenders, baristas, supervisors; venue managers; David |
| **Venues** | Arabian Ranches and voco The Palm (open); pre-opening teams for Dubai South, Pullman JLT and Al Mouj (Muscat, Oman). Hasselt (Belgium) is out of scope unless David says otherwise. Check names with David. |
| **Goal** | Staff knowledge and confidence. Scores show where to help, never to judge. |

**How it works.** Each shift, a team member does one set of five questions, about three minutes. The app picks a mix of new cards and cards due for review. After each answer they tap how sure they were, then see the right answer and why it matters on the floor. Missed cards come back sooner; known cards space out. Progress moves them through three levels. David and venue managers see who is practising, what the team knows, what to coach next, and (later) whether selling on the floor is moving.

---

## 2. How to work with David

1. Speak plainly. Explain any technical word in one line. Keep answers short.
2. One step at a time. When David must do something himself (create an account, change a setting, approve content), give numbered click-by-click steps and wait for him to confirm.
3. Never ask David to edit code or run commands he doesn't understand. You do the technical work.
4. Ask before anything that costs money, sends messages to staff, or touches real staff data. Say what it costs and why.
5. Never invent business facts: dishes, ingredients, allergens, prices, beer names, service timings, SOP steps. If a source file doesn't say it, write `[TO CONFIRM]` and ask.
6. Keep these files current in the project root, updated at the end of every session:
   - `PROGRESS.md`: current phase, what works, what's next, known issues.
   - `DECISIONS.md`: every decision David makes, dated, one line each.
   - `HANDOVER.md`: how the app fits together, where each account and setting lives (names only, never passwords or keys), how to deploy, restore and import. Someone new should be able to take over from this file and this brief.
7. Build in small working slices. Show each one running before moving on.
8. Use git from day one and commit after each working slice with a clear message.
9. Secrets live in environment variables only: never in front-end code, never pasted into chat, never committed.
10. Follow section 13 (ownership and reporting) from the first session. David has agreed to it; it is part of the job.
11. When this brief and David disagree, David wins. Record it in `DECISIONS.md`.
12. Keep it lean. If a feature isn't in this brief, ask before building it.

---

## 3. Non-negotiable principles

These come from the learning research behind the concept. Do not trade them away for engagement tricks.

| Rule | Why (evidence) |
| --- | --- |
| Lessons are questions, not reading | Recall beat rereading at one week: 56% vs 42% (Roediger & Karpicke 2006) |
| Every answer gets an explanation and "why it matters on the floor" | Testing with feedback roughly doubles the benefit (Rowland 2014) |
| Review at growing gaps | Spaced practice beat cramming: 47% vs 37% recall (Cepeda et al. 2006) |
| Feedback is about the task, never the person | 38% of feedback interventions made performance worse, mostly when aimed at the self (Kluger & DeNisi 1996) |
| Mistakes are part of learning: "not yet", and the card comes back | Error management training improves transfer, d = 0.80 (Keith & Frese 2008) |
| Measure confidence with every answer | People who reread feel surer than they should; "sure but wrong" is the risk to fix |
| No public individual rankings; team goals instead | Compulsory leaderboards lowered motivation and exam scores (Hanus & Fox 2015) |
| Streaks forgive days off | Visibly broken streaks reduce later engagement (Silverman & Barasch 2023) |
| No prizes for points | Expected tangible rewards undermine motivation (Deci, Koestner & Ryan 1999) |
| Managers drive it on the floor | Supervisor support predicts use on the job far more than enjoyment (Blume et al. 2010) |

**Never build:** hearts or lives, energy limits, timers or countdowns, fail screens, red crosses on people, public leaderboards of individuals, currency or a shop, guilt-trip notifications, automatic discipline of any kind.

**Words to use:** Not yet · Got it · Strengthened · Still learning · Next focus · Practised.
**Words never to use about people:** wrong, fail, failed, weak, poor, bad, behind, "lost your streak".

---

## 4. Scope

**Version 1 (pilot)**

- Staff app: activation, PIN login, home, daily set, five card types, confidence tap, feedback, "Review my misses", level path, readiness check, weekly rhythm, privacy notice, installable, works on weak signal.
- Content studio (admin): create, edit, review, approve and retire cards; import drafted cards; "new on the menu" sets.
- Manager dashboard: Overview, Venue, Person, Questions; practical sign-offs; CSV export.
- Sales link by weekly CSV import from Micros, with each person's baseline.
- Reminders by web push, once the core works.
- Ownership, phase reports and content backups (section 13).

**Later, only after the pilot review:** Micros Simphony API automation, rota import for per-shift reminders, Microsoft 365 sign-in for managers, weekly digest by email, AI guest role-play, a second language, Power BI.

**Out of scope:** course catalogues, video libraries, chat or social feeds, gamified currency, native app-store apps.

---

## 5. Users and permissions

| Role | Can see | Can do |
| --- | --- | --- |
| Staff | Their own page only | Do sets, review misses, see own progress, and own sales trend if David enables it |
| Venue manager | Their venue's staff and dashboard | Activate staff, reset PINs, sign off practicals, see private allergen coaching prompts for their venue |
| Content reviewer | Content studio | Edit, approve and retire cards in their tracks (chef: food and allergens; bar lead: drinks; David: service and SOPs) |
| Admin (David) | Everything in the app | All of the above, plus settings, imports, exports |
| Company owner (Gerard) | Owner access to GitHub, Supabase and Netlify; phase reports | Continuity and oversight. Reports carry no personal data. |

Enforce app permissions in the database with row-level security, not only in the interface.

---

## 6. Learning engine

All thresholds are defaults. Store them in a `settings` table so David can change them without code.

### 6.1 Structure

- **Tracks (6):** Sequence of service · Food menu · Drinks · Upselling · Suggestive selling · SOPs.
- **Units:** small groups of cards within a track (for example "Allergens: starters", "Belgian beer styles", "Welcome and seating").
- **Cards:** one question each, belonging to one track, one unit and one level (1, 2 or 3).
- **Roles:** cards are tagged for roles (host, server, runner, bar, barista); a role's path shows only its cards.

### 6.2 Card types

1. `mcq`: one right answer from 3 or 4 options.
2. `multi`: pick all that apply (allergens, components).
3. `order`: put steps in order (sequence of service, serve rituals).
4. `image`: a photo of a dish, glass or set-up, then a question.
5. `scenario`: a short table situation; choose the best response.

No timers on any type. No true/false without a reason line.

### 6.3 Card schema

```json
{
  "id": "food-allergen-0007",
  "track": "food",
  "unit": "allergens-starters",
  "level": 1,
  "roles": ["server", "host", "runner", "bar"],
  "type": "multi",
  "prompt": "Which allergens are in [DISH]?",
  "media": null,
  "options": ["Gluten", "Milk", "Egg", "Nuts", "Shellfish"],
  "answer": ["[FROM MATRIX]"],
  "explanation": "One or two sentences with the right answer and the reason.",
  "why_it_matters": "One sentence about the guest or the floor.",
  "is_allergen": true,
  "source_ref": "Allergen matrix v[DATE], row [N]",
  "status": "draft | review | live | retired",
  "reviewed_by": null,
  "version": 1
}
```

### 6.4 Spacing (Leitner boxes)

| Box | Next review |
| --- | --- |
| 1 | Next set |
| 2 | 1 day |
| 3 | 3 days |
| 4 | 7 days |
| 5 | 21 days |
| 6 | 45 days |

- Right, and "Sure" or "Think so": up one box.
- Right, and "Guessing": same box, reviewed again at that box's gap.
- Not yet: back to box 1.
- Allergen cards never go above box 5 (21 days).
- Dates use the venue's local date (Asia/Dubai or Asia/Muscat).

### 6.5 The daily set

1. Up to 3 cards that are due, oldest first, allergen cards first on ties.
2. Up to 2 new cards from the person's current unit.
3. If either pool runs short, fill from the other, then from the earliest-learned cards, to make 5.
4. Mix tracks and similar items (for example two beer styles side by side) so staff learn to tell them apart.
5. An active "new on the menu" set takes priority until done.

"Review my misses" is always open, never counts toward progress and is never scored.

### 6.6 Confidence and mastery

After each answer, before feedback: **How sure were you?** Sure · Think so · Guessing.

| Group | Rule | Shown as |
| --- | --- | --- |
| Mastered | Right and Sure, card in box 4 or above | Right and sure |
| Needs confidence | Right, but Think so or Guessing | Right, not sure |
| Still learning | Not yet, and not Sure | Not yet, not sure |
| Fix first (private) | Not yet, but Sure | Not yet, but sure |

**Track mastery** = mastered cards in the track ÷ live cards in the track within the person's level scope, as a whole percentage.

**Coaching prompt:** any "Not yet, but Sure" on an allergen card creates a private prompt for the venue manager and admin only. It is the only individual alert in the system.

### 6.7 Levels and badges

| Level | Name | Scope | To reach it |
| --- | --- | --- | --- |
| 0 | Getting started | Level 1 cards | Default for new staff |
| 1 | New in the house | Sequence of service, allergens, core menu, SOP basics | 80% mastery of Level 1 scope; a readiness check of 20 cards at 80% or more (untimed, retake any time, nothing lost); 3 practical sign-offs: table set-up, welcome and seating, allergen walk-through |
| 2 | House regular | All six tracks | 70% mastery in every track, plus manager sign-off |
| 3 | Host of the house | Two mastery badges | Two badges at 90% mastery (Beer, Coffee and Bakery, Wine, Selling), plus one practical sign-off on a badge skill |

Never move anyone down a level.

### 6.8 Weekly rhythm (the streak)

Version 1 has no rota data, so the streak counts weeks, not days.

- Each person has a weekly target (default 4 sets; David can set more for full-time and fewer for part-time).
- **Rhythm streak** = consecutive weeks, Monday to Sunday, with the target met.
- Days off never matter. A missed week shows "Start a new run this week", never a loss message.
- One automatic pause week a month for leave, when David marks it.

With a rota import later, switch to "shifts in a row" with automatic freezes on days off.

### 6.9 Feedback copy

- Right: "Got it." + explanation + why it matters.
- Not yet: "Not yet." + the right answer + explanation + why it matters + "This card comes back next set."
- End of set: "3 new things learned, 2 strengthened." Rhythm progress. The venue's weekly goal. No percentage score.

### 6.10 Team goals and recognition

- Each venue has a weekly goal (default: 85% of staff meet their weekly target), shown on every home screen.
- The dashboard lists people to recognise: most improved (mastery gain over 28 days), longest rhythm streak, level-ups this week. Recognition happens at pre-shift, by a person.

---

## 7. Staff app screens

1. **Activate:** enter or scan the activation code, set a 6-digit PIN, read and accept the privacy notice.
2. **Log in:** staff number + PIN; stays signed in for 60 days on that phone.
3. **Home:** greeting, "Start today's set · 5 cards", rhythm streak, level path, venue weekly goal, "Review my misses".
4. **Card:** progress dots, track and unit label, prompt, options, then "How sure were you?"
5. **Feedback:** Got it / Not yet, right answer, explanation, why it matters, "Next card".
6. **Set done:** learned and strengthened counts, rhythm, team goal.
7. **My progress:** level progress, mastery per track, strengths, next focus, practical sign-offs.
8. **Readiness check:** 20 cards, untimed; result "Ready" or "Not yet, here's what to practise"; retake any time.
9. **Install help:** adding to the home screen on iPhone (Share, then Add to Home Screen) and Android.

Design for a 360 px wide phone first. Tap targets at least 44 px. Plain English for staff who may speak English as a second language.

---

## 8. Manager dashboard

Use the clickable prototype as the visual reference (section 18).

| View | Contents |
| --- | --- |
| Overview | Venue filter. Headline figures: active this week, weekly target met, floor ready, average mastery, new-menu readiness, allergen coaching prompts. Mastery heatmap (venue × track). Weekly trend by venue against the venue goal. Level mix. Coach this week: the 3 lowest units, each with its most-missed card as the huddle question. Recognise. Selling, once imported. |
| Venue | Team table: name, role, level, rhythm streak, mastery per track as mini bars, sets this week against target, last active, next focus. Click through to a person. |
| Person | Level progress, mastery per track, confidence groups, last four weeks of practice, practical sign-offs (sign off from here), strengths and next focus, sales against their own baseline. Private allergen prompt, if any. |
| Questions | Most missed cards (first-time-right %, most-picked wrong option, shown after 10+ answers), cards everyone knows, card bank by status per track, new-menu set completion. |

**Metric definitions**

- **Active this week:** staff with at least one completed set, Monday to Sunday, venue local time.
- **Weekly target met:** share of active-roster staff who met their weekly target.
- **Floor ready:** share of staff at Level 1 or above.
- **Average mastery:** mean track mastery across the people in scope.
- **New-menu readiness:** share of staff who completed the latest "new on the menu" set.
- **Most improved:** largest gain in average mastery over the last 28 days.
- **Add-on rate:** add-on items (from a list David approves) per 100 guests, per person per week, against that person's baseline (average of the 8 weeks before launch). Shown only with at least 150 guests in the period, and labelled "a coaching signal, not proof of cause".

**Rules:** the words are "next focus" and "not yet". No red on people; bordeaux is reserved for the private allergen prompt. Every table exports to CSV.

---

## 9. Content pipeline

1. David collects the source files (see the roadmap).
2. You draft cards from those files only, as `status: review`, each with a `source_ref`. Never fill gaps from general knowledge about Belgian food or beer; use `[TO CONFIRM]`.
3. Reviewers approve in the content studio. Food and allergen cards need the Head of Culinary or a head chef, and every allergen answer is checked against the matrix.
4. Editing a live card creates a new version; history is kept.
5. Monthly: retire cards above 95% first-time-right with 30+ answers; reword cards below 50%.
6. Menu change: draft the "new on the menu" set within 48 hours of David sharing the new menu.

**Writing rules:** prompts under 25 words; explanation one or two sentences; why it matters one sentence about the guest; plausible distractors; no trick questions or double negatives; spell dishes exactly as the printed menu does (French names keep their accents).

**Level 1 target:** about 100 to 150 live cards before the pilot.

---

## 10. Architecture

Simple, cheap, and easy for the next person to maintain.

| Part | Choice | Notes |
| --- | --- | --- |
| Front end | Vite + React + TypeScript, plain CSS with design tokens | Installable web app (PWA: manifest + service worker). Few dependencies. |
| Backend | Supabase: Postgres, Auth, Edge Functions, Storage | Region eu-central-1 (Frankfurt); Supabase has no Middle East region. Free tier while building; Pro (USD 25 a month) before real staff data, for daily backups. |
| Hosting | Netlify | A separate team or account from Dock & Trace, on a paid plan before the pilot (on the free plan, an overage pauses every site on the account). |
| Code | Private GitHub repository under a Creneau organisation | Netlify deploys from it. Releases carry the phase reports. |
| Reminders | Web push (VAPID) sent from an Edge Function | iPhone needs iOS 16.4+ and the app on the home screen. Ask permission only after the first completed set. |

**Tables (starting point):** `venues` · `staff` (staff number = Micros employee number, first name, last initial, venue, role, start month, level, weekly target, active) · `user_roles` · `tracks` · `units` · `cards` · `card_versions` · `card_state` (per person per card: box, due date, last result, last confidence, counts) · `sets` · `events` (append-only, with a client event id for de-duplication) · `readiness_attempts` · `signoffs` · `badges` · `level_history` · `menu_sets` · `sales_weekly` · `addon_items` · `push_subscriptions` · `settings` · `audit_log`.

Dashboard figures come from database views over `events` and `card_state`, so they can always be recomputed.

**Login**

- Staff: staff number + 6-digit PIN through an Edge Function that locks the account for 15 minutes after 5 failed attempts and never reveals whether a staff number exists. Block obvious PINs (000000, 123456 and similar).
- Activation: a manager creates the staff record; the system issues a single-use code that expires after 7 days, shown as text and a QR code, printable for pre-shift.
- PIN reset: the venue manager issues a new activation code.
- Managers and admin: email and a strong password in version 1; Microsoft 365 sign-in later, once Creneau IT registers the app.

**Offline:** cache the next set and the app shell; queue answers locally and sync when back online, de-duplicated by client event id.

---

## 11. Integrations

| System | Version 1 | Later |
| --- | --- | --- |
| Oracle Micros Simphony | Weekly CSV import of an employee sales export (guests, checks, net sales, item counts by employee number). Get a real sample export from David first and build the importer to match it. Load the 8 weeks before launch as the baseline. | Simphony Business Intelligence API (`getEmployeeDailyTotals`, `getGuestChecks`), if Creneau's set-up allows it; confirm with Oracle or the integrator |
| Meez | Recipe and allergen exports as card sources (the allergen CSV may need Meez Enterprise) | None; Meez has no public API |
| Bayzat | Monthly roster CSV for joiners and leavers | Rota import, if an export exists |
| Microsoft 365 | None | Manager sign-in |

---

## 12. Privacy and security

Quiz results and sales by employee number are personal data under UAE Federal Decree-Law 45 of 2021, and under Oman's personal data law for Al Mouj. David confirms the wording with counsel; you build the mechanics.

- Collect the minimum: staff number, first name, last initial, venue, role, start month. No date of birth, nationality, ID numbers, phone numbers or staff photos.
- Privacy notice at activation: what is collected, why (training and coaching), that sales figures are linked for coaching, who sees what, how long it is kept, who to ask. Log acceptance with a timestamp. Oman staff give explicit consent to hosting outside Oman.
- Row-level security on every table, tested directly: a staff account must not read anyone else's rows.
- Leavers are deactivated at once and anonymised after 12 months (default).
- No automatic action from any score. Dashboards inform people; people decide.
- Audit log for sign-offs, PIN resets, imports, card approvals and exports.
- Off-site backups. The Supabase service-role key stays server-side only.
- Never put staff names or scores into AI prompts when drafting content.

---

## 13. A shared project: ownership and keeping Gerard in the loop

Maison Academy is Creneau Hospitality's, and it started with Gerard, who did the concept, research and framework. David leads the build. The point of this section is simple: the work stays with the company, and Gerard stays a partner in it as it grows, so nothing depends on one person and the two of them can steer it together. It is open, agreed between them, and it never reports on David or any staff member personally. Keep the tone throughout collaborative, never a status check on David.

**Set up in Phase 0**

1. `LICENSE` in the repo: "Copyright © 2026 Creneau Hospitality. All rights reserved. Proprietary and confidential. Not for use, copying or distribution outside Creneau Hospitality without written permission."
2. The same notice at the top of `README.md`, with: "Concept and foundational design: Gerard McCormick, Head of Culinary, Creneau Hospitality, October 2026. Build lead: David, Operations Manager."
3. The same credit and notice on an "About" line in the app's admin area.
4. GitHub, Supabase and Netlify each sit under a Creneau-owned organisation or team, created with a shared Creneau mailbox. In the same session each one is created, add **Gerard (gerard.mccormick@creneau.com) and David as owners**. Never build on a personal account.
5. The GitHub repository stays private.
6. Ask Gerard to set the repository to *Watch → All Activity*, so GitHub emails him every commit and release. As an owner he sees each build as it happens; that is his update on every build, with nothing extra to wire up.

**At the end of every phase**

1. Write `reports/YYYY-MM-DD-phase-N.md`, two pages at most: what was built, decisions made, card counts by track and status, open issues, costs to date, what's next.
2. Publish it as a GitHub release tagged `phase-N`, with the report as the release notes.
3. Export the full card bank (all statuses and versions) and the settings to `exports/` as JSON and CSV, and commit them. During the pilot, repeat monthly. The card bank is the company's main asset and must never live only in the database.
4. Bring `HANDOVER.md` up to date.

**Never in reports or exports:** staff names, staff scores, sales by person, passwords or keys. Content, structure and totals only.

**Intellectual property.** The concept, research and framework are Gerard's work for Creneau; the app, its content and its data are Creneau's. Before the pilot, David confirms with HR that his and the team's employment terms assign this work to the company and keep it confidential, and records it in `DECISIONS.md`. This is the real protection for the company's work; the account ownership above is the practical backup.

---

## 14. Design system: Maison Mathis

Ask Gerard for access to the Maison Mathis design system and the brand font files. Until then, use the fallbacks.

**Colours**

| Token | Hex | Use |
| --- | --- | --- |
| forest | `#21331F` | House colour: headings, primary buttons, key marks |
| olive | `#5A5C3A` | Second green; stripe partner; secondary bars |
| bordeaux | `#451924` | Private allergen prompt only, with cream text |
| sky | `#B6D8F1` | Light panels; "right answer" highlight with forest text |
| blush | `#F5D5D3` | "Not yet" panel and soft bands, with forest text |
| cream | `#EFEBE2` | Page ground (paper) |
| ink | `#231F20` | Body text |
| white | `#FFFFFF` | Sparingly, for panels on cream |
| chartreuse `#E7E770`, tomato `#DD5134` | | Patterns only, never text |

**Type**

| Role | Brand face | Fallback | Use |
| --- | --- | --- | --- |
| Display | Tenderness Regular | Georgia, serif | Headings, names, big numbers. Always uppercase, never bold. |
| Sans | Cooper Hewitt Medium | Arial, sans-serif | Body, labels, buttons. Labels uppercase with 1 px letter spacing. |
| Info | Area Extended (Archivo Expanded Light stands in) | Arial | Small descriptive lines and notes |
| Script | Geographica Script (Pinyon Script stands in) | cursive | One word at most, rarely |

**Rules:** square corners everywhere; no shadows, gradients or rounded cards; cream ground, forest headings, ink body; three button styles only (forest fill with cream text, forest outline, underlined text); a thin forest and olive vertical stripe band (stripes 30.24 px) as the accent; a blush band for the house line "Good food makes our house a home"; no icon set (use words); focus is a 2 px forest outline offset by 2 px; never retype MAISON MATHIS as the logo (use the logo files).

---

## 15. Build phases

Show David each phase working before starting the next. Every phase ends with the steps in section 13.

### Phase 0: Kick-off (one session)

- Read this brief. Ask David the open decisions in section 17 and record the answers.
- Check which source files he has; list what's missing, with owners.
- Guide him through creating the accounts on a shared Creneau mailbox, with Gerard and David as owners.
- Set up the repo with `LICENSE`, `README.md`, `PROGRESS.md`, `DECISIONS.md`, `HANDOVER.md`, `reports/` and `exports/`, and deploy a "hello" page in brand style.

**Done when:** a Maison Academy page is live on Netlify, connected to Supabase in Frankfurt; decisions are recorded; Gerard has confirmed his access; the `phase-0` release is published.

### Phase 1: Card bank and content studio

- Content tables; content studio (list, filter, edit, review, approve, retire, version history); JSON/CSV import.
- Draft Level 1 cards from David's files, all as `review`.

**Done when:** at least 100 Level 1 cards are live, every allergen card is signed off against the matrix, and the `phase-1` release and card export are published.

### Phase 2: Staff app

- Activation, PIN login, home, daily set, five card types, confidence tap, feedback, set done, review my misses, my progress, readiness check, weekly rhythm, privacy notice, offline queue, install help.
- A test mode where David can move the date forward to see spacing work.

**Done when:** three test accounts complete sets over a simulated two weeks; missed cards return next set; known cards space out; nothing punishing exists; it works on an iPhone and an Android phone; the `phase-2` release is published.

### Phase 3: Dashboard

- Overview, Venue, Person, Questions; practical sign-offs; new-menu sets; CSV export; venue manager and admin permissions.

**Done when:** from test data, David can answer "is the team practising, what do they know, and what should we coach this week", and the `phase-3` release is published.

### Phase 4: Pilot ready

- Import the Arabian Ranches roster from David's CSV; printable activation sheet with codes and QR codes.
- Web push reminders: at most one a day, at a time David sets, only until the weekly target is met.
- Final privacy notice; Supabase Pro with backups; Netlify paid plan; basic error logging.
- Soft launch with 3 to 5 staff for a week; fix what they find.

**Done when:** soft-launch issues are fixed, David signs off the pilot start, and the `phase-4` release is published.

### Phase 5: Pilot support (six weeks)

- Micros CSV importer with baseline, built against a real sample export.
- Weekly: reword most-missed cards with David; draft cards for any menu change; keep `PROGRESS.md` current. Monthly card export.

**Done when:** the week-12 review has its numbers (participation, floor-ready share, mastery after 7+ days, allergen prompts trend, add-on rate against baseline and against voco The Palm) and the `phase-5` release is published.

### Phase 6: After the review (only what David approves)

Roll out to other venues and pre-opening teams; Level 2 and 3 cards; then items from the "later" list in section 4. Each item ends with a report and release.

---

## 16. Testing checklist (before every phase sign-off)

- [ ] A staff account cannot read another person's data (tested in the database, not only on screen).
- [ ] A venue manager cannot see another venue.
- [ ] Spacing: not yet goes to box 1; right moves up; allergen cards stop at box 5.
- [ ] Offline: answer three cards with no signal, reconnect, no duplicates.
- [ ] Works at 360 px wide; buttons at least 44 px; readable at large text size.
- [ ] No banned words (section 3) anywhere in the interface: search the code.
- [ ] Dashboard figures match a manual count on test data.
- [ ] Every card shown to staff is `live` and has a reviewer.
- [ ] `LICENSE` and the README credit are present; Gerard and David are owners on all three accounts.
- [ ] The phase report, release and card export are published, with no personal data in them.

---

## 17. Open decisions to ask David at the start

1. Our sequence of service: the exact steps and timings to teach.
2. Who approves cards in each track.
3. When staff practise on paid time: pre-shift, a break, or a shared tablet at the pass.
4. Pilot venue and dates (default: Arabian Ranches, six weeks) and the on-site champion.
5. Level targets (for example Level 1 within 14 days of starting) and what Level 3 earns: a pin only, or title, pay or rota.
6. Weekly target per contract type (default 4 sets).
7. Whether staff see their own sales trend.
8. Which menu items count as add-ons for the selling measure.
9. Language: English only for version 1?
10. The app's name (Maison Academy is a working title).

---

## 18. Reference material

Gerard prepared these. They are private until he shares them with David; if a link doesn't open, ask David to request access.

- Concept brief with research and sources: https://claude.ai/code/artifact/545fffe1-dd89-433d-a945-ec56b9e879b1
- Clickable dashboard and staff app prototype (sample data): https://claude.ai/artifact/MkvusFEkhhtDrqmUo5U8AL
- Deck for David: `Maison_Academy_for_David.pptx`

Where this brief and the prototype differ, the brief wins for logic and the prototype wins for look.
