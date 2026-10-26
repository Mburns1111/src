# Adopt Me pet catalogue — source provenance and comparison

This project is an unofficial fan project, not affiliated with Roblox or Uplift Games. No image files or trading-value estimates are imported into the pet catalogue.

## Compared sources (26 October 2026)

1. **ironbabatekkral/adoptme-values** — https://github.com/ironbabatekkral/adoptme-values/blob/main/adoptme_values.json
   - 701 entries with `type: pets`, providing names and rarity classifications.
   - Project README credits **Elvebredd** (https://elvebredd.com) and the Adopt Me trading community for baseline data.
   - Its README specifically says the MIT license covers **code**, while asset/data ownership is attributed to third parties. Attribution is not proof of permission to bulk republish source data.
2. **gyanu1614/gamevault** — https://github.com/gyanu1614/gamevault/blob/main/scripts/values-seeds/adopt-me.facts.json
   - 763 facts entries with slugs, release dates, origin fields, obtaining methods, statuses and per-item upstream URLs.
   - Its collection script identifies **Adopt Me Wiki** (https://adoptme.fandom.com) as the source; it cites CC BY-SA for wiki content. Retain attribution and assess relevant terms, including share-alike, before reuse.
   - No repository-wide license was verified.
3. **kennarddh/adopt_me_trading_api** — https://github.com/kennarddh/adopt_me_trading_api/blob/master/data.json
   - Historical snapshot marked 2021 (173 objects under pets; **158** have `is_pet: true`).
   - This source includes pet names/IDs and trading values, but no rarity field; values were not copied.
   - No LICENSE file was verified. Treat as historical evidence only.

## Matching results

- Sources 1 and 2: **690** exact normalized-ID matches; **11** names found only in source 1; **73** slugs only in source 2.
- Source 3: **158** name matches in source 1, **158** in source 2 and all **158** in both.
- Source 3 resolves **zero** of the 84 unmatched entries.
- Matching names establish *identity overlap*, **not independently confirmed rarities**, as sources 2 and 3 do not provide rarity.
- A shared upstream source does not constitute independent corroboration.

## Files and status

- `data/pet-catalog-matched-candidates.json` — 690 **review-only** candidates; single-source rarity, never auto-approved.
- `data/pet-catalog-unmatched-review.json` — 84 unmatched records requiring independent validation.
- `data/pet-catalog-third-source-crosscheck.json` — 158 historical identities matching all three sources.

None of these are applied to MongoDB or the live bot. Verify permission/reuse terms and actual pet details before importing. Preserve the upstream attribution on any approved entries. Data mismatches require manual or permitted-source verification.

## 26 October 2026 — rights and permissions decision

**Decision: bulk dataset and art reuse NOT CLEARED.** This is an operational safeguard, not a legal opinion or a finding that all factual pet names/rarities are protected expression. Short factual verification with citations and whole-dataset republication are different activities. Neither the completed rarity comparisons nor the existence of a public GitHub dataset grants permission to reuse a complete third-party database.

- **Uplift Games / Adopt Me:** [Terms of Service](https://www.playadopt.me/legal/terms) (last updated 17 July 2026), especially §§5 and 11, limit unauthorized copying/extraction and automated website access. This project did not conduct an automated pet-directory scrape. For a future public Discord card game, confirm that the intended reuse of names, game IP, branding and card artwork is permitted; seek permission or qualified legal advice as appropriate. In-game pet copies are **not** exchanged through Discord cards.
- **Fan artwork:** [Uplift Fan Art and Ideas Submission Policy](https://www.playadopt.me/legal/fan-art-and-ideas-submission-policy) addresses fan-created works and notices; it is not a blanket license to copy and redistribute official pet images. It also restricts trademark usage and imposes notice requirements for fan art outside its channel. Artwork is separately blocked until rights are reviewed, including each community artist's permissions.
- **Source 1 (adoptme-values):** Its own README distinguishes MIT-licensed **code** from third-party assets/data, credits Elvebredd and the community, and disclaims ownership of Adopt Me intellectual property. Do not infer a data redistribution license from MIT. No trading values or media assets are being imported.
- **Source 2 (gamevault):** Its documented upstream Adopt Me Wiki community text may be CC BY-SA **unless otherwise noted** (see [Adopt Me Wiki](https://adoptme.fandom.com/wiki/Adopt_Me%21_Wiki)). Share-alike attribution for eligible wiki text does not license any underlying official game images/IP or necessarily the independent GameVault compilation. Do not assume that its entire facts file may be republished.
- **Source 3 (historical API):** A third-party historical matching reference only; no verified grant of rights for broad data reuse.
- **Allowed at present:** local/offline verification files containing brief factual names, classifications, source URLs, aliases, and the review audit. **Not authorized:** production MongoDB import, republishing source compilations, bulk scraping, copying official images, or releasing collectible card artwork.

The independent decision manifest `data/pet-catalog-exception-decisions.json` marks both `approvedForDatabaseImport` and `approvedForArtworkUse` **false**. Staff/owner authorization to merge code is a distinct decision from obtaining source/IP permissions. Permission or legal review of any proposed dataset and card art remains required before deployment.
