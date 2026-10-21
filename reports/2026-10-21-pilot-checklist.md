# Maison Academy · go-live checklist

**For:** David
**Written:** 21 October 2026
**Soft test:** 3 to 5 staff, mid-December. **Pilot:** Arabian Ranches, from Sunday 3 January 2027.

Everything in the app is built. What's left is mostly accounts and paperwork. Running cost: AED 0 a month. Do the steps in order; Claude does the ones marked *Claude*.

## 1. Send Claude three small things

- [x] **Roster headings:** checked against the Bayzat export on 21 October; the import reads that Excel file directly.
- [ ] **Reminder time:** 10:00 is set for now. Pick a time before most shifts start.
- [ ] **Venue map point:** only if you may ever use the on-site check. Drop a pin on the Arabian Ranches entrance in Google Maps and send the link.

## 2. Accounts (before any real staff data)

- [ ] Create the shared Creneau mailbox (for example academy@...).
- [ ] Add it as an **owner** on GitHub and Supabase. Gerard accepts his invitations.
- [ ] Netlify allows one owner on the free plan: change the Netlify account's email to the shared mailbox.
- [x] **No paid plans** (decided 21 October): Supabase and Netlify stay free. Backups run nightly from GitHub instead of Supabase Pro.
- [x] Backup secrets added in GitHub; first backup and restore test passed (21 October).
- [ ] Give Gerard (or the shared mailbox's password vault) a copy of the backup passphrase.
- [ ] Check the GitHub repository still shows **Private** (it was found public on 21 October and fixed).

## 3. Privacy

- [ ] Send the draft notice (the app's Privacy page) to counsel. If the on-site check might be used, ask them to cover it too: "We check you are at the venue when you start a set. We keep only yes or no, never where you were."
- [ ] Send Claude the final wording. *Claude* puts it in and changes the version, so everyone accepts it again.

## 4. Open the doors (one day before the soft test)

- [ ] Netlify: turn **off** team protection, so staff can open the app.
- [ ] *Claude*: remove the demo venue (12 sample people).
- [ ] *Claude*: turn on go-live (real staff allowed).
- [ ] Studio > Staff > Import roster: import the soft-test staff (3 to 5 people).
- [ ] Print their activation sheet. Codes last 7 days.
- [ ] *Claude*: reminders from "test" to "all".

## 5. Soft test (mid-December, 1 to 2 weeks)

- [ ] Each person activates on their own phone, adds the app to the home screen and turns on reminders.
- [ ] Check the dashboard after a few days: are sets coming in?
- [ ] Settings > Recent app errors: anything showing?
- [ ] Ask the 3 to 5 people: what was confusing, what was slow, did the reminder come at a good time?

## 6. Still open, not blocking the soft test

- Kitchen check of the 31 allergen cards (head chef or Gerard, from a one-page list). Allergen cards stay hidden until then.
- Cards still in review.
- Defaults to confirm: weekly target (4 sets), level targets, what Level 3 earns, English only, the app's name.

## Switched off on purpose

- **On-site check (500 m):** built, off. Turn on only after step 1's map point and step 3's privacy line.
