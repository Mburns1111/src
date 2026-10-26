# Pet catalogue verification — 26 October 2026

**Repository:** `Mburns1111/src` · **Branch:** `feature/pet-catalog`

## Current evidence

- 701 pet records in `ironbabatekkral/adoptme-values` (name and rarity).
- 763 pet fact records in `gyanu1614/gamevault` (origin/release/obtainability).
- 690 normalized identity matches; 11 in the first list only; 73 in the second only.
- 158 historical name matches across both and `kennarddh/adopt_me_trading_api`.
- 18 curated citations reviewed: 17 official-source records and 1 community-source record.
- Of the 84 unmatched entries, **7 are now confirmed by official citations**, leaving **77 unresolved**.
- **9 more officially documented pets** are not present in either of the two candidate lists, so must be reviewed as new entries.
- **2 official-source records** corroborate rarity of existing matches (Frost Dragon and Dragonfruit Fox).
- No rarity conflict was found within this *small reviewed subset*; this does not verify the rarity of the remaining matched pets.
- The Wooly Rhino has community evidence but remains pending independent official rarity confirmation.

## Independent official sources

The official Adopt Me update posts were checked manually; they explicitly identify pets and rarity categories. We keep only short facts and URLs, not copyrighted art, article text, or scraped page copies.

- https://www.playadopt.me/news/halloween-ghost-gallery-notes (3 Oct 2026)
- https://www.playadopt.me/news/halloween-hauntlet-returns-notes (9 Oct 2026)
- https://www.playadopt.me/news/halloween-stitches-spotlight-notes (16 Oct 2026)
- https://www.playadopt.me/news/halloween-wherebear-returns-notes (23 Oct 2026)
- https://www.playadopt.me/news/fresh-fruit-pets-notes (8 Jan 2026)
- https://www.playadopt.me/discover/pets/frost-dragon

The separate community-only check references https://adoptme.fandom.com/wiki/Wooly_Rhino .

## Reproduce review report

Run from repo root:

```sh
node scripts/pet-catalog-review.js
node --test tests/pet-catalog.test.js tests/pet-catalog-review.test.js
```

The script reads the staged candidate lists and curated evidence, then produces `data/pet-catalog-verification-report.json`. It does **not** scrape sites, import MongoDB records, use images, approve pet records, or trigger any Discord commands.

## Data rights and attribution

- See `docs/pet-catalog-source-provenance.md` for all GitHub data and upstream credits. The first dataset credits Elvebredd and community contributors; its MIT license expressly applies to code, not automatically to the third-party data.
- GameVault's pet fact collection references the Adopt Me Wiki and its CC BY-SA content; confirm obligations before redistributing bulk wiki-derived material.
- Official news pages are used as **manually reviewed references**, not as permission to scrape them.
- Evidence overlaps are useful, but not necessarily independent when repositories reuse a shared upstream.

## Next validation batch

1. Independently verify rarities for a representative portion of the 690 matched pets, then continue to full coverage.
2. Prioritize the 77 unmatched identities and the 9 new official entries. Validate precise official names and pet/egg classification.
3. Record source URL, checked date, rarity, discrepancies and staff reviewer.
4. Do not auto-import any bulk third-party dataset without appropriate data-reuse clearance.
5. After clearance and review, expose **preview → approve → MongoDB apply** as an explicit admin-only action.

No files here are deployed; no records are written to the running bot.
