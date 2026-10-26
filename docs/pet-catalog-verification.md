# Pet catalogue verification — 26 October 2026

Repository: **Mburns1111/src** · Branch: **feature/pet-catalog**

## Current comparison and review

Initial comparison: 701 pet entries in `ironbabatekkral/adoptme-values`, 763 facts entries in `gyanu1614/gamevault`. There are 690 exact normalized identity matches, 11 entries unique to the first dataset, and 73 unique to the second. A third 2021 dataset matches 158 historic pet identities across both lists.

The follow-up review recorded **103 evidence records**, including 88 officially verified records in the primary reviewed category, 9 newly found official pets absent from both candidate lists, 4 name/ID aliases, and 2 official identity-only confirmations (Blue Cat and Pink Dog).

From the original **84 mismatches**:
- **84 pet identities now have an official citation**, including four aliases to reconcile before import.
- **0 remain unmatched on pet identity.** S’mores Raccoon is officially confirmed as Ultra-Rare via https://www.playadopt.me/discover/pets/smores-raccoon .
- **9 additional recent pets** were found in official update notes but neither candidate dataset.
- **72** of the 690 matching candidates have their rarities explicitly spot-checked against official pages (33 in the first Legendary / Ultra-Rare batch; 29 in the second).
- **0 rarity conflicts** appeared in this reviewed sample; the rarities of the other **618 matching candidates remain single-source** and require further independent verification.

Important: Blue Cat and Pink Dog have **official identity confirmation only**, and their rarities remain unknown. Do not infer these from other pets. No community-only evidence should silently override or approve official fields.

## Naming normalization

`malaysian-tapir` → official **Malayan Tapir** (`malayan-tapir`).

`wooly-rhino` → official **Woolly Rhino** (`woolly-rhino`).

`s-mores-raccoon` → official **S'mores Raccoon** (`smores-raccoon`).

`tio-de-nadal` → official **Tió De Nadal** (official page slug `ti-de-nadal`). The second dataset already has `ti-de-nadal` and this is one pet, not two.

The alias records are **review hints**, not database migrations. Stable card IDs must be planned before renaming stored pets.

## Official verification references

Manually reviewed official sources (no images or article prose copied):

- https://www.playadopt.me/discover/pets (directory)
- https://www.playadopt.me/news/summer-camp-notes
- https://www.playadopt.me/news/stormy-rings-notes
- https://www.playadopt.me/news/campfire-stories-notes
- https://www.playadopt.me/news/stormy-ducky-drama-notes
- https://www.playadopt.me/news/salon-revamp-notes
- https://www.playadopt.me/news/cat-cafe-notes
- October 2026 Halloween notes linked individually in `data/pet-catalog-curated-verification.json`
- Direct links to specific official pet pages saved per reviewed pet.

The source provenance document `docs/pet-catalog-source-provenance.md` credits both candidate repositories and their stated upstreams, including Elvebredd and Adopt Me Wiki. Attribution is not equivalent to permission for wholesale reuse. Source rights must still be cleared before bulk database import.

## Files

- `data/pet-catalog-matched-candidates.json` — 690 original matched candidates, not approved en masse.
- `data/pet-catalog-unmatched-review.json` — original 84 mismatches; retained unchanged as baseline.
- `data/pet-catalog-curated-verification.json` — manually reviewed evidence and precise URLs.
- `data/pet-catalog-verification-report.json` — generated categorization and remaining queue.
- `scripts/pet-catalog-review.js` — offline, no network, no database writes.
- `tests/pet-catalog-review.test.js` — regression checks for counts, aliases and unknown rarity.

To run locally:

```sh
node scripts/pet-catalog-review.js
node --test tests/pet-catalog.test.js tests/pet-catalog-review.test.js
```

Tests are committed, but their successful execution has **not** been verified in this handoff.

## Outstanding work

1. Officially verify Blue Cat and Pink Dog rarities (official news confirms both exist but does not state rarity).
2. Continue checking the **618** already matched pets whose rarity has only one data source. Prioritize Legendary and Ultra-Rare first.
3. Review alias normalization and licensing before previewing any database import.
4. Add a staff-only preview/approval workflow and keep the live bot untouched.

No merging, deployment or MongoDB import occurred.

## 26 October 2026 — Legendary / Ultra-Rare first batch

33 more matched pets were checked against individual official Adopt Me pet directory pages or official update articles. Every rarity agreed with the provisional value; **0 conflicts in this batch**. Exact links and per-pet records are in `data/pet-catalog-curated-verification.json`. Total matched rarity spot checks after the first batch were **43 / 690**. These are manual official-page checks, not automated site scraping or wholesale data collection.

## 26 October 2026 — Legendary / Ultra-Rare second batch

29 additional pet rarities were individually verified on official Adopt Me pet pages, with zero observed disagreements. **72 of 690** matching pets now have official rarity evidence, leaving **618** unmatched to an independent rarity source. The Astronaut Gorilla page could not be fetched, so this pet remains pending; no evidence was inferred from its URL alone. Source URLs are individually recorded in `data/pet-catalog-curated-verification.json`. Tests are run by GitHub Actions on commits; no records were imported into MongoDB.
