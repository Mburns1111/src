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
