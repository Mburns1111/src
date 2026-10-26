# AM Isa Bot — Pet catalogue (foundation)

This catalogue lives in **Mburns1111/src**, separately from any other bot repository.

## Scope
- Global metadata for each Adopt Me pet: ID, name, official rarity, release event/year, original obtaining method, availability, sources, and review status.
- **No images, automatically scraped content, trade valuations, user-owned cards, edition sizes, or card printing.**
- Source attribution is included for later verification; this is not an assertion that a website allows automated collection.

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
