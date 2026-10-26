# AM Isa Bot — Pet catalogue (foundation)

This catalogue lives in **Mburns1111/src**, separately from any other bot repository.

## Scope
- Global metadata for each Adopt Me pet: ID, name, official rarity, release event/year, original obtaining method, availability, sources, and review status.
- **No images, automatically scraped content, trade valuations, user-owned cards, edition sizes, or card printing.**
- Source attribution is included for later verification; this is not an assertion that a website allows automated collection.

## Phase 1 complete — offline staff-readable dry-run preview (26 October 2026)

The draft branch includes a **searchable Markdown review catalogue** at [`docs/pet-catalog-preview.md`](pet-catalog-preview.md), a **filterable CSV** at [`data/pet-catalog-preview.csv`](../data/pet-catalog-preview.csv), and a structured JSON output at [`data/pet-catalog-preview.json`](../data/pet-catalog-preview.json). All three are generated from the same independently checked sources and exception decisions.

**Preview totals:** 783 input/evidence records, **782 unique canonical pet identities**, **780 officially known rarity values**, and **2 official-rarity gaps** (Blue Cat and Pink Dog, shown as `Unknown`). Four source aliases are mapped to official canonical IDs; only the two source records `tio-de-nadal` and `ti-de-nadal` collapse into one pet. Nine October Halloween pets appear as **staged additions**, and The Black Dog is shown as official **Rare** with provisional **Ultra-Rare** retained as audit evidence.

Every preview row is **pending staff review**. No row is a database migration or an authorized asset. In particular, `Unknown` is not replaced with its community-provisional Uncommon value.

From the repository root:

```sh
npm run pet-catalog:preview        # regenerate the JSON, CSV and Markdown files locally
npm run pet-catalog:preview:check  # fail if committed previews differ from source evidence
node --test tests/pet-catalog-preview.test.js
```

The generator uses only local JSON, with **no network request, Discord call, MongoDB connection, or write outside those three preview files**. The consistency tests enforce unique IDs and names, exact record counts, correct alias consolidation, official-vs-community rarity separation, nine staged additions, and the rights gate.

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
