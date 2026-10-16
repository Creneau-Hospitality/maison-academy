# Card drafts

**Drafted:** 16 October 2026.
**Cards:** 189: 152 at Level 1 and 37 drinks cards at Level 2. David approved them all on 16 October. The 160 cards without allergens are `live`. The 29 allergen cards stay in `review` until Gerard has checked them.

| File | What it is |
| --- | --- |
| `level1-cards.json` | The cards in the build brief's schema, ready to import into the content studio (Phase 1). |
| `level1-cards-review.csv` | The same cards as a spreadsheet for review. It has approve and comment columns, and opens in Excel. |
| `level2-drinks-cards.json`, `level2-drinks-cards-review.csv` | 37 drinks cards (Level 2), in the same two formats |

## Counts

| Track | Units | Cards | Allergen cards |
| --- | --- | --- | --- |
| Sequence of service | Host 13, Waiter 15, Food runner 9, Barista 6, Timing standards 9 | 52 | 1 |
| SOPs | Allergen protocol 9, Guest recovery 9, House standards 7, Opening and closing 4, Controls 2, Safety basics 4 | 35 | 9 |
| Food | Menu basics 13, Breakfast 13, Lunch and dinner 22, Allergens: breakfast 6, Allergens: lunch and dinner 11 | 65 | 17 |
| **Level 1 total** | | **152** | **27** |
| Drinks (Level 2) | Bar standards 5, Spirits and wine basics 7, Beer 6, Cocktails 11, Mocktails and soft drinks 4, Coffee and tea 4 | 37 | 2 |
| **All drafts** | | **189** | **29** |

## Sources

Every card names its source in `source_ref`. The sources are:

- the four role sequence-of-service documents
- the Service Training Program (2026/01)
- the Operations Manual (2026/01)
- the Arabian Ranches menus: breakfast (14 September 2026) and lunch and dinner (22 September 2026)
- David's confirmation of the breakfast service hours

No fact comes from general knowledge, except the allergen group a food belongs to (for example, that squid is a mollusc). Those groups follow the 14 allergens in the Service Training Program.

## To confirm

1. **Allergen cards from the menu (19).** There are 17 food cards and 2 drinks cards. All were drafted from the ingredients the menu lists, not the allergen matrix. Gerard checks each one, and none says a dish is free from anything. See `../MENU_ALLERGEN_FLAGS.md`.

### Settled by David on 16 October

- **Dish names:** spelt as printed on the menu, for example "Huitres Hervé #3" and "Morrocan Mint".
- **Leche de tigre:** the ceviche card stays as it is.
- **Champagne:** the card follows the manual: Champagne is made in France.
- **"86'd":** means unavailable. The pre-shift card wording stays.
- **Allergen question at the order:** added to the waiter's sequence of service (step 3), and the card now cites it.

## Not drafted yet

- **Photo cards.** These wait for dish photos.
- **Payments and alcohol service SOPs.** These wait for the venue procedures.
