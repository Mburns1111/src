# AM Isa Bot — Pet catalogue (foundation)

This catalogue lives in **Mburns1111/src**, separately from any other bot repository.

## Scope
- Global metadata for each Adopt Me pet: ID, name, official rarity, release event/year, original obtaining method, availability, sources, and review status.
- **No images, automatically scraped content, trade valuations, user-owned cards, edition sizes, or card printing.**
- Source attribution is included for later verification; this is not an assertion that a website allows automated collection.

## Phase 1 complete — offline staff-readable dry-run preview (26 October 2026)

The draft branch includes a **searchable Markdown review catalogue** at [`docs/pet-catalog-preview.md`](pet-catalog-preview.md), a **filterable CSV** at [`data/pet-catalog-preview.csv`](../data/pet-catalog-preview.csv), and a structured JSON output at [`data/pet-catalog-preview.json`](../data/pet-catalog-preview.json). All three are generated from the same independently checked sources and exception decisions.

**Preview totals (updated 26 October):** 800 input/evidence records, **799 unique canonical pet identities**, **796 officially known rarity values**, and **3 official-rarity gaps** (Blue Cat, Pink Dog and Dirty Ducky, shown as `Unknown`). Four source aliases are mapped to official canonical IDs; only the two source records `tio-de-nadal` and `ti-de-nadal` collapse into one pet. **26 staged additions are staged**: nine Halloween releases, eleven earlier discoveries, and six additional missing pets. The Black Dog is shown as official **Rare** with provisional **Ultra-Rare** retained as audit evidence.

Every preview row is **pending staff review**. No row is a database migration or an authorized asset. In particular, `Unknown` is not replaced with its community-provisional Uncommon value.

From the repository root:

```sh
npm run pet-catalog:preview        # regenerate the JSON, CSV and Markdown files locally
npm run pet-catalog:preview:check  # fail if committed previews differ from source evidence
node --test tests/pet-catalog-preview.test.js
```

The generator uses only local JSON, with **no network request, Discord call, MongoDB connection, or write outside those three preview files**. The consistency tests enforce unique IDs and names, exact record counts, correct alias consolidation, official-vs-community rarity separation, all twenty staged additions, and the rights gate.

**Rights clearance remains a prerequisite before bulk import or public use of art and data.** There is no staff approval button or production import in Phase 1. Phase 2 is a separate authorized staff approval design only after scope and rights are decided.

## Import preparation
Use `parsePetCatalogCsv(text)` then `preparePetCatalogImport(rows)` from `services/pet-catalog-import.js`. JSON arrays of pet objects can go straight into `preparePetCatalogImport`.

Supported CSV headers: `petId,name,rarity,releaseEvent,releaseYear,originalObtainingMethod,availability,sourceName,sourceUrl`. Only `name` is mandatory; missing rarity becomes `Unknown`. The importer outputs accepted and rejected rows, without writing to MongoDB. Accepted records default to `reviewStatus: "pending"` so staff can verify them before approval.

## Data safety / rights
Collect factual pet metadata only from sources that permit the collection method used, or from manually checked and approved input. Do not scrape Adopt Me's website without permission. Do not populate images from external sources as part of this feature.

## Next steps
1. Select legally suitable source data, prepare an initial CSV/JSON import and review the list.
2. Add a staff-only preview/apply importer (with duplicate/change review and source-history handling).
3. Add catalogue browse/edit commands.
4. Later connect approved pets to card series and edition stock without coupling the two databases.

**Official directory completeness:** Six further missing pets were added to the staff preview. Golden Chow-Chow already existed as Golden Chow Chow under the same stable ID; no duplicate was added. Dirty Ducky has Unknown official rarity (community-provisional Common only). Completeness is not certified; the catalog and art remain unapproved for production.

## MongoDB pet-name and rarity import (owner-scoped)

The owner has authorized the factual **pet ID, name and rarity** fields, provided we keep attribution to the GitHub comparison sources and explicitly mark which names/rarities were manually checked against Adopt Me's official directory and release notes. This is **not** a finding of general third-party dataset reuse rights. Other original data, artwork, trading values, printed cards and metadata remain outside this authorization.

The importer takes **799 distinct pets** from the current offline preview, with three official rarities still **Unknown** (Blue Cat, Pink Dog and Dirty Ducky), and writes new documents as `pending` only. The `sources` array records source name, exact link, covered fields and whether the source was independently manually verified. The GitHub candidate datasets are attributed only to pets actually present in their records; official/manual-only discoveries are not falsely attributed to either GitHub dataset. The Black Dog keeps official Rare and its historical conflict in the separate audit.

Preview without writing to MongoDB:

```sh
npm run pet-catalog:mongo:dry-run
```

After reviewing the preview and confirming your `MONGODB_URI` points at the intended database, a database operator can apply the authorized factual-only insert:

```sh
PET_CATALOG_IMPORT_APPROVED=YES npm run pet-catalog:mongo:apply
```

The MongoDB URL must already be supplied securely in the environment, not committed to GitHub. The apply command uses `petId` and `$setOnInsert` so any existing pet documents are **left untouched**; rerunning is safe from duplicate canonical IDs. This is a deliberate one-time command, **not** a normal bot startup action. No code here creates or assigns collectible cards or art.

**Other reuse permissions remain unresolved.** The existing `rightsReview.approvedForDatabaseImport = false` continues to protect broader third-party dataset and media reuse. The separately recorded `factualMetadataImport` documents this narrower owner instruction; it is not independent legal clearance.
