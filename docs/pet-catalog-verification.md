# Pet catalogue verification — 26 October 2026

Repository: **Mburns1111/src** · Branch: **feature/pet-catalog**

## Current comparison and review

Initial comparison: 701 pet entries in `ironbabatekkral/adoptme-values`, 763 facts entries in `gyanu1614/gamevault`. There are 690 exact normalized identity matches, 11 entries unique to the first dataset, and 73 unique to the second. A third 2021 dataset matches 158 historic pet identities across both lists.

The follow-up review recorded **103 evidence records**, including 88 officially verified records in the primary reviewed category, 9 newly found official pets absent from both candidate lists, 4 name/ID aliases, and 2 official identity-only confirmations (Blue Cat and Pink Dog).

From the original **84 mismatches**:
- **84 pet identities now have an official citation**, including four aliases to reconcile before import.
- **0 remain unmatched on pet identity.** S’mores Raccoon is officially confirmed as Ultra-Rare via https://www.playadopt.me/discover/pets/smores-raccoon .
- **9 additional recent pets** were found in official update notes but neither candidate dataset.
- **478** of 690 matching candidates have officially confirmed rarities agreeing with the provisional catalogue. All 416 initially classified Legendary / Ultra-Rare matches have been reviewed: 415 agree with official evidence and 1 has a documented conflict.
- **1 rarity conflict** is documented (The Black Dog: official Rare versus provisional Ultra-Rare). The other **211 matching candidates** still require independent rarity verification. Do not treat the conflict as an accepted match.

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
2. Check the remaining **211** provisional Rare, Uncommon and Common matches against explicit official pet-rarity statements. Separately resolve The Black Dog's Rare/Ultra-Rare conflict without silently overwriting the original source.
3. Review alias normalization and licensing before previewing any database import.
4. Add a staff-only preview/approval workflow and keep the live bot untouched.

No merging, deployment or MongoDB import occurred.

## 26 October 2026 — Legendary / Ultra-Rare first batch

33 more matched pets were checked against individual official Adopt Me pet directory pages or official update articles. Every rarity agreed with the provisional value; **0 conflicts in this batch**. Exact links and per-pet records are in `data/pet-catalog-curated-verification.json`. Total matched rarity spot checks after the first batch were **43 / 690**. These are manual official-page checks, not automated site scraping or wholesale data collection.

## 26 October 2026 — Legendary / Ultra-Rare second batch

29 additional pet rarities were individually verified on official Adopt Me pet pages, with zero observed disagreements. **72 of 690** matching pets had official rarity evidence at the end of that batch, leaving **618** unmatched to an independent rarity source. The Astronaut Gorilla page could not be fetched, so this pet remains pending; no evidence was inferred from its URL alone. Source URLs are individually recorded in `data/pet-catalog-curated-verification.json`. Tests are run by GitHub Actions on commits; no records were imported into MongoDB.

## 26 October 2026 — Legendary / Ultra-Rare third batch

37 additional pets were individually checked against official Adopt Me pet pages; **37 agreed** with the candidate rarities and **0 conflicts** were observed. Cumulative official rarity confirmation is now **109 / 690**, with **581** matched rarities still pending. Astronaut Gorilla remains pending, because no confirmed official rarity page has been reviewed. Exact URL provenance is recorded in `data/pet-catalog-curated-verification.json`. The check and report do not copy official artwork or scrape the official directory with an automated crawler.

## 26 October 2026 — Legendary / Ultra-Rare fourth batch

26 more pets were individually checked against the official Adopt Me directory: all 26 agreed with the candidate rarity, zero disagreements. Overall **135 / 690** matched pets have an official rarity check, leaving **555**. The Astronaut Gorilla and Field Mouse records were not added in this batch because their official rarity wasn't confirmed in the current review. Exact evidence links are in `data/pet-catalog-curated-verification.json`.

## 26 October 2026 — Legendary / Ultra-Rare fifth batch

39 additional pet rarities confirmed directly in official Adopt Me directory search results, each with the matching source URL saved in `data/pet-catalog-curated-verification.json`. All 39 matched the provisional rarity; no conflict was identified. Current total: **174 / 690** officially verified matching rarities, **516** pending. Astronaut Gorilla and Field Mouse were pending at that time. Do not confuse pet rarities with rarities assigned to pet stickers, accessories, or egg containers.

## 26 October 2026 — Legendary / Ultra-Rare sixth batch

24 additional rarities were cross-checked with search results from official individual Adopt Me pet pages. Every result explicitly listed **Type: Pet** and the rarity, and all 24 agreed with the candidates. This makes **198 of 690** matched rarities checked and **492** still pending. Individual page links are stored with each reviewed pet. This batch was verified using official search result text and did not involve an automated site scraper. Data rights and import approval remain separate from factual accuracy checks.

## 26 October 2026 — Legendary / Ultra-Rare seventh batch

37 additional matched pet rarities verified from official individual pet directory pages (Hot Doggo through Lionfish, excluding entries without a confirming page result). All 37 agreed with the provisional data. **235 of 690** matched rarities now have official-page evidence; **455** remain pending. Source links are saved per pet in `data/pet-catalog-curated-verification.json`. No images, article text or trading valuations were imported. Astronaut Gorilla, Field Mouse, and Kelp Captain were pending at that time; all three have since been verified.

## 26 October 2026 — Legendary / Ultra-Rare eighth batch

28 additional matched pets were verified from explicit official Adopt Me pet-page rarity fields and the official Summer Sticker Sunset release notes (Manta Ray pet, not sticker). All 28 agree with the provisional rarity; no discrepancies in this batch. Cumulative verified matched rarities: **263 / 690**, leaving **427** provisional rarities. Source URLs are stored for each evidence record. Entries with no authoritative rarity result (including Astronaut Gorilla and Field Mouse) remain pending. No production import, artwork use, or merge occurred.

## 26 October 2026 — ninth official rarity batch

27 additional matched pet rarities were directly confirmed using fetched official Adopt Me pages and the Summer Cannon Circle update. Every one agreed with the provisional list, with no conflicts. **290 / 690** matched rarities now have official confirmation, **400** remain provisional. Kelp Captain is now confirmed Legendary by the official Summer Cannon Circle notes. Astronaut Gorilla and Field Mouse remain pending. Source URLs are recorded in `data/pet-catalog-curated-verification.json`. No scrape, image import, MongoDB write, merge, or deployment was performed.

## 26 October 2026 — tenth official rarity batch

50 more entries were individually checked using live search results from the official Adopt Me pet directory. Each result explicitly stated pet name, **Type: Pet**, and rarity. All 50 matched the provisional classifications, including **Astronaut Gorilla — Legendary** and **Field Mouse — Legendary**, previously pending. Official source URLs are recorded for every entry in `data/pet-catalog-curated-verification.json`. Cumulative official rarity checks: **340 / 690**, with **350** matched rarities still pending. There are **79** still-pending Legendary or Ultra-Rare matches; the rest are other rarity tiers. No automated directory scraping or image import occurred. Retain provenance and confirm bulk-data reuse permissions before database import.

## 26 October 2026 — eleventh official rarity batch (remaining high-rarity candidates)

Reviewed all **79** remaining Legendary / Ultra-Rare candidates individually on Adopt Me's official pet pages. Each page explicitly identified the pet and its rarity. **78 matched** the provisional rarity (35 Legendary and 43 Ultra-Rare); **1 was a discrepancy**:

- **The Black Dog**: the candidate list says **Ultra-Rare**, but the official pet directory states **Rare** — https://www.playadopt.me/discover/pets/the-black-dog. It is retained as a `rarity-conflict` in the generated report, not silently reclassified or approved as a matching candidate.

Cumulative matched-rarity confirmations without conflict are **418 / 690**. All **416 originally Legendary / Ultra-Rare candidates** have now received an official rarity review, comprising **415 agreements and 1 conflict**. Of the other matching candidates, **271** still lack official rarity verification (135 Rare, 87 Uncommon, 49 Common). One separately documented high-rarity conflict also remains open. Previously verified Rare/Common candidates remain counted among the 418 agreements.

The curated evidence contains the exact official URL and check date per reviewed pet. The report retains both the official rarity and original catalogue rarity for disagreements. **No pet records, artwork, images, trading values or card data were imported**, and the data-reuse rights review remains pending. No merge to `main` or deployment to Wispbyte was authorized.

## 26 October 2026 — twelfth official rarity batch (Rare / Uncommon / Common)

Reviewed the next **60** unmatched candidate rarities (2021 Uplift Butterfly through Classic Teapot). Each candidate was compared against an explicit rarity statement in its individual official Adopt Me pet directory page or, for **Black Tiger**, the official [Endangered Egg Notes](https://www.playadopt.me/news/endangered-egg-notes).

- **21 Rare**, **21 Uncommon**, and **18 Common** classifications agreed with the provisional candidates.
- **0 new conflicts** found. The earlier **Black Dog: official Rare / provisional Ultra-Rare** disagreement remains open and unchanged.
- The direct Chocolate Labrador page could not be fetched, but an official directory search result explicitly showed **Type: Pet** and **Rarity: Uncommon**; this is documented in its per-pet evidence note.
- The Black Tiger individual page initially rendered without details. The official Endangered Egg notes explicitly state **Black Tiger — Uncommon**. Its curated record uses that news URL rather than inferring rarity from the page URL alone.

Cumulative confirmed, agreeing matched rarities: **478 / 690**. Another **211** matched pets need an official rarity source (**114 Rare**, **66 Uncommon**, and **31 Common**, based on original tiers); **1 separate conflict** remains under review. Exact sources and the date of verification are kept in the curated JSON. No automated scrape, image download, MongoDB import, production deployment or merge was performed.
