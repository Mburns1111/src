# Pet catalogue verification — 26 October 2026

Repository: **Mburns1111/src** · Branch: **feature/pet-catalog**

## Current comparison and review

Initial comparison: 701 pet entries in `ironbabatekkral/adoptme-values`, 763 facts entries in `gyanu1614/gamevault`. There are 690 exact normalized identity matches, 11 entries unique to the first dataset, and 73 unique to the second. A third 2021 dataset matches 158 historic pet identities across both lists.

The follow-up review recorded **103 evidence records**, including 88 officially verified records in the primary reviewed category, 9 newly found official pets absent from both candidate lists, 4 name/ID aliases, and 2 official identity-only confirmations (Blue Cat and Pink Dog).

From the original **84 mismatches**:
- **84 pet identities now have an official citation**, including four aliases to reconcile before import.
- **0 remain unmatched on pet identity.** S’mores Raccoon is officially confirmed as Ultra-Rare via https://www.playadopt.me/discover/pets/smores-raccoon .
- **20 additional pets** are now documented with explicit official pet/rarity evidence and staged outside the two original candidate datasets: nine October Halloween additions, plus eleven discovered in a further official-directory comparison.
- **689** of 690 matching candidates have officially confirmed rarities agreeing with the provisional catalogue. All **690** originally matched pet candidates now have explicit official rarity evidence: 689 agreements and 1 separately recorded conflict. All 416 initially classified Legendary / Ultra-Rare matches have been reviewed: 415 agree with official evidence and 1 has a documented conflict.
- **1 rarity conflict** is documented (The Black Dog: official Rare versus provisional Ultra-Rare). **No originally matched pets remain without rarity evidence.** Do not treat the conflict as an accepted agreement.

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

## Exception decisions and remaining launch gates

The Black Dog has been **adjudicated to official Rare** for a future catalogue record, with provisional Ultra-Rare and the one historical conflict explicitly retained. The four documented spelling aliases now have decided canonical IDs, and the nine extra officially documented pets are **staged for later preview** rather than inserted into the original source baselines. All decisions live in `data/pet-catalog-exception-decisions.json` and are checked by the offline report generator.

Blue Cat and Pink Dog are confirmed as distinct Throwback Egg pets by the September 18, 2026 official Cat Cafe notes. Third-party sources report both **Uncommon**, but the official release note does **not** state their rarities and their individual official pet-directory entries could not be verified. Their **official rarity remains null/pending**, not approved as Uncommon. Do not confuse Blue Cat with Blue Dog or Pink Dog with Pink Cat.

Still requiring independent action before any import or card release:
1. Explicit official pet rarity evidence for Blue Cat and Pink Dog, or a separately documented staff decision about allowing unverified rarity (default: do not approve).
2. Source-rights and Uplift IP/artwork permission assessment. Bulk import and artwork remain **blocked** (see `docs/pet-catalog-source-provenance.md`).
3. A staff-only preview/approval workflow for a future rights-cleared catalogue; no changes to MongoDB or the live bot.

No merge, deployment, artwork download, mass import or production approval occurred.

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

## 26 October 2026 — thirteenth official rarity batch (Rare / Uncommon / Common)

Verified **60** additional matched pets, from **Clover Cow** through **Husky**, by directly reading the **Type: Pet** and **Rarity** fields on the individually identified [official Adopt Me directory](https://www.playadopt.me/discover/pets) pages.

- **29 Rare**, **21 Uncommon**, and **10 Common** classifications agreed with the provisional catalogue.
- **0 new disagreements**. The existing **The Black Dog** conflict remains unchanged (official Rare vs provisional Ultra-Rare), and is not included in the confirmed-agreement total.
- Each new verification record stores its exact individual official pet-page URL, confirmed rarity, and 2026-10-26 verification date. No rarity was inferred merely because a URL existed.

**Current matched-rarity status:** **538 agreeing official checks / 690 matched candidates**, **151 still awaiting official rarity checks**, and **1 separately tracked conflict**. The remaining unverified matched candidates comprise **85 Rare, 45 Uncommon, and 21 Common**. The original 84 unmatched pet identities are still accounted for separately, with nine additional official pets and four naming aliases awaiting final import planning.

Verification only: no image downloads, trading value additions, database import, Wispbyte deployment or `main` merge. Confirm bulk data reuse rights before any later import.

## 26 October 2026 — fourteenth official rarity batch (Rare / Uncommon / Common)

Checked the next **60** matched candidates, **Hyena** through **Patchy Bear**, against the official [Adopt Me pet directory](https://www.playadopt.me/discover/pets). Each of the individual official pages explicitly identified a pet and its rarity, except **Island Tarsier**, whose page fetch failed but whose **Common** rarity was explicitly confirmed in the official [Summer Sticker Sunset notes](https://www.playadopt.me/news/summer-sticker-sunset-notes), in the **New Pets** table and not the separate sticker rarity table.

- **37 Rare**, **14 Uncommon** and **9 Common** classifications agreed with the provisional catalogue.
- **0 new conflicts**. The already documented **The Black Dog** official Rare/provisional Ultra-Rare conflict remains open.
- The source URLs and individual check dates are saved in `data/pet-catalog-curated-verification.json`. The report and tests preserve agreement checks separately from conflicts.

**Current cumulative status:** **598 / 690** matched pet rarities officially confirmed in agreement, **91 still pending** (48 Rare, 31 Uncommon, 12 Common), and **1 separately flagged conflict**. The work remains evidence review only, with no images, artwork, trading values or MongoDB imports and no merge or deployment.

## 26 October 2026 — fifteenth batch: remaining 91 matching pet rarities

Completed individual official-source verification for **all 91 previously pending matched pets**, from **Pig** through **Zombie Chick**, comprising **48 Rare**, **31 Uncommon**, and **12 Common** classifications. The official Adopt Me pet directory explicitly identifies the pet and its rarity for each record; official indexed snippets for nine pets were used when direct page fetches returned incomplete content. Those records state the evidence limitation in their notes: Scarecrow, Seahorse, Sneak Weasel, Snow Cat, Starhopper, Tarsier, Tawny Frogmouth, Toy Poodle and Warthog.

- **91 agreements**, **0 newly discovered conflicts**.
- **689 / 690** originally matched pet rarities now agree with explicit official evidence, and **all 690 have been reviewed**.
- **1 existing conflict** remains separately flagged: **The Black Dog** is **Rare** on the [official pet page](https://www.playadopt.me/discover/pets/the-black-dog) but **Ultra-Rare** in the provisional source. Both values remain recorded; no automatic correction is approved.
- Confirmed agreements by original matched rarity tier: **213 Legendary, 202 Ultra-Rare, 136 Rare, 87 Uncommon, and 51 Common**. The 203rd original Ultra-Rare candidate is the conflict.
- **0 previously matched rarity candidates await official evidence**. This does **not** mean the catalogue is ready for import: the separate Blue Cat and Pink Dog identity-only records still lack official rarity evidence, four canonical aliases require reconciliation, nine official pets absent from the original lists require planning, and licensing/attribution clearance remains outstanding.

Only short factual classifications, official links and source review dates were saved. No automated directory scrape, artwork/image download, trading-value import, MongoDB write, merge to `main`, or Wispbyte deployment was performed.

## 26 October 2026 — final exception adjudication

### Rarity disagreement

**The Black Dog** — [official pet page](https://www.playadopt.me/discover/pets/the-black-dog) and [Halloween: Surprise Spiders Notes](https://www.playadopt.me/news/halloween-surprise-spiders-notes) both explicitly say **Rare**. Selected canonical rarity: **Rare**. Provisional source value **Ultra-Rare** is retained for audit, not silently changed. The report now separately counts **one adjudicated historical difference** and **zero unadjudicated matched-candidate conflicts**.

### Two 2026 identity-only pets

**Blue Cat** and **Pink Dog** — [official Cat Cafe notes](https://www.playadopt.me/news/cat-cafe-notes) confirm their identity and Throwback Egg origin, but not their rarities. The official directory did not provide individual verifiable rarity pages for these names. [Traderie Blue Cat](https://traderie.com/adoptme/product/blue-cat) and [AdoptMe.Rocks Pink Dog](https://adoptme.rocks/pets/pink-dog) support a **community-provisional Uncommon** classification, **not** official verification. Both official-rarity fields remain unset; they are not counted in the 689 accepted official agreements.

### Four canonical identity decisions

| Source identifier | Canonical pet ID | Official name and rarity |
|---|---|---|
| `malaysian-tapir` | `malayan-tapir` | Malayan Tapir — Common |
| `wooly-rhino` | `woolly-rhino` | Woolly Rhino — Ultra-Rare |
| `tio-de-nadal` | `ti-de-nadal` | Tió De Nadal — Legendary |
| `s-mores-raccoon` | `smores-raccoon` | S'mores Raccoon — Ultra-Rare |

Canonical mappings are chosen for any later authorized import; source aliases are retained as lookup keys. Do not create two separate pets from any alias. Names, rarities and canonical URL slugs are confirmed by the individual official pet pages in the curated evidence.

### Nine additional official pets, staged only

- **Halloween Hauntlet Returns (9 Oct):** Bubblegeist (Legendary), Bobageist (Ultra-Rare), Caramelgeist (Uncommon).
- **Halloween Stitches' Spotlight (16 Oct):** Stitches (Ultra-Rare), Boohoo (Rare), Shoebill (Uncommon), Copycat (Legendary).
- **Halloween Where Bear Returns (23 Oct):** Count Slothula (Ultra-Rare), Stray Cat Dragon (Legendary).

Each item has an official source URL and is staged in the exception manifest, **not** a new baseline import or MongoDB write.

### Rights review outcome

Uplift's [2026 Terms of Service](https://www.playadopt.me/legal/terms) restrict unapproved copying, extraction and automated access. Its [Fan Art and Ideas Submission Policy](https://www.playadopt.me/legal/fan-art-and-ideas-submission-policy) is not a blanket permission for official pet artwork. The upstream candidate repositories do not establish a transferable license for their third-party data/images. **Reuse and artwork rights remain unapproved**, regardless of factual verification completeness.

`scripts/pet-catalog-review.js` now applies the explicit decision file when writing the offline report and keeps the historical conflict, selected official rarity, canonical aliases, staged pets, provisional-only labels and rights gate distinguishable. It neither scrapes nor imports. Manual owner authorization to merge/deploy is a separate gate.

## 26 October 2026 — official website omission follow-up (11 additional pets)

A new comparison with the official [Adopt Me pet directory](https://www.playadopt.me/discover/pets) identified **11 distinct missing pets** that were absent from the prior staff preview and both original source comparisons. Their identity and rarity are now recorded as first-party verified evidence:

| Pet | Official rarity | Evidence |
|---|---|---|
| 2026 Birthday Butterfly | Uncommon | [Individual pet page](https://www.playadopt.me/discover/pets/2026-birthday-butterfly) |
| 2D Doggy | Legendary | [Individual pet page](https://www.playadopt.me/discover/pets/2d-doggy) |
| Budgie Witch | Uncommon | [Individual pet page](https://www.playadopt.me/discover/pets/budgie-witch) |
| Chihuahua | Ultra-Rare | [Individual pet page](https://www.playadopt.me/discover/pets/chihuahua) |
| Dylan | Uncommon | [Individual pet page](https://www.playadopt.me/discover/pets/dylan) |
| Granny Wolf | Rare | [Individual pet page](https://www.playadopt.me/discover/pets/granny-wolf) |
| Ms. Muffet | Common | [Individual pet page](https://www.playadopt.me/discover/pets/ms-muffet) |
| Pistachio | Uncommon | [Individual pet page](https://www.playadopt.me/discover/pets/pistachio) |
| Ranger Beaver | Rare | [Journey to Summer Camp Week 1 official notes](https://www.playadopt.me/news/journey-to-summer-camp-week-1-notes), under New Pets |
| River | Uncommon | [Individual pet page](https://www.playadopt.me/discover/pets/river) |
| Storm Condor | Ultra-Rare | [Individual pet page](https://www.playadopt.me/discover/pets/storm-condor) |

Individual pages explicitly say **Type: Pet** and state the corresponding rarity; for **Ranger Beaver**, the release notes explicitly place it in the **New Pets** section as **Rare**, separate from Rare pet-wear entries. No egg/container or pet sticker was imported as a pet.

**Updated staff-preview counts:** **794 official evidence/source rows**, **793 distinct canonical pets**, **791 known official rarities**, **2 still Unknown** (Blue Cat and Pink Dog), and **20 additional officially evidenced pets staged** (nine prior plus these eleven). Only one duplicate source pair collapses (`tio-de-nadal` / `ti-de-nadal`). All **793** remain staff-pending, with bulk import and artwork rights **not cleared**.

**Dirty Ducky is NOT included yet:** it is named in the official directory index and independently reported as Common by community sources, but its direct official pet page and an explicit official rarity statement could not be checked. Record it as a discovery gap to verify rather than treating a community rarity as official. The full directory has not been exhaustively enumerated; further omissions may exist.

No production Discord messages, database imports, merges, artwork or trading values were created as part of this update.
