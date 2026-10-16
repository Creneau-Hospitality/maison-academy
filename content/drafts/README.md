# Level 1 card drafts

**Drafted:** 16 October 2026.
**Cards:** 152, all with `status: review`. None goes live until David approves it. The 27 allergen cards also need Gerard's check.

| File | What it is |
| --- | --- |
| `level1-cards.json` | The cards in the build brief's schema, ready to import into the content studio (Phase 1). |
| `level1-cards-review.csv` | The same cards as a spreadsheet for review. It has approve and comment columns, and opens in Excel. |

## Counts

| Track | Units | Cards | Allergen cards |
| --- | --- | --- | --- |
| Sequence of service | Host 13, Waiter 15, Food runner 9, Barista 6, Timing standards 9 | 52 | 1 |
| SOPs | Allergen protocol 9, Guest recovery 9, House standards 7, Opening and closing 4, Controls 2, Safety basics 4 | 35 | 9 |
| Food | Menu basics 13, Breakfast 13, Lunch and dinner 22, Allergens: breakfast 6, Allergens: lunch and dinner 11 | 65 | 17 |
| **Total** | | **152** | **27** |

## Sources

Every card names its source in `source_ref`. The sources are:

- the four role sequence-of-service documents
- the Service Training Program (2026/01)
- the Operations Manual (2026/01)
- the Arabian Ranches menus: breakfast (14 September 2026) and lunch and dinner (22 September 2026)
- David's confirmation of the breakfast service hours

No fact comes from general knowledge, except the allergen group a food belongs to (for example, that squid is a mollusc). Those groups follow the 14 allergens in the Service Training Program.

## To confirm

1. **Allergen cards from the menu (17).** These were drafted from the ingredients the menu lists, not from the allergen matrix. Gerard checks each one. None says a dish is free from anything. See `../MENU_ALLERGEN_FLAGS.md`.
2. **Oysters spelling.** The menu prints "HUITRES HERVÉ"; the card writes "Huîtres". Which spelling do we keep?
3. **Leche de tigre.** The menu names ají amarillo but doesn't say what leche de tigre is. Does the chef want to add a one-line description?
4. **"86'd".** The pre-shift card explains "86'd" as unavailable. The manuals use the term but don't define it.
5. **Allergen question at the order.** The waiter's sequence of service doesn't include asking about allergies, but the training programme's step 4 does. The card follows the training programme. You may want to add the step to the waiter document.

## Not drafted yet

- **Drinks cards.** These are Level 2 in the brief, drafted next from the cocktails manual and the menus.
- **Photo cards.** These wait for dish photos.
- **Payments and alcohol service SOPs.** These wait for the venue procedures.
