# Phase 4 — Performance and usability

## First slice: startup responsiveness

- Slash commands acknowledge immediately and are no longer gated by all startup entry checks and house/outfit reconciliation. Startup maintenance still logs failures and performs the same individual safe checks.
- House and outfit reconciliation now give the event loop a chance to handle interactions after every four records, including records that were skipped or failed. All listing existence, ownership, and media-preservation safeguards remain in place.
- No migration, video layout change, new database collection, new shop prices, or changes to Points rules.

## Second slice: safe listing-card render caching

- House and outfit cards use a **content-addressed, in-memory PNG cache**. Returning to the exact same gallery page with unchanged styling can reuse the prior image rather than rendering the full Canvas again.
- Each cache key includes the listing type, card text/data (including gallery page/count), style, resolved appearance and **actual photo bytes**. Changing a photo, sticker, font, panel, text, or page forces a new render. Current profile images and shop draft previews are never cached.
- Duplicate simultaneous requests for identical artwork share one in-flight render; failures cannot be reused as fallback artwork.
- Cache is strictly bounded to **24 MiB**, **24 entries**, and **10 minutes** per process. Nothing is written to MongoDB, and no extra Discord attachments are created or removed.
- Existing per-listing refresh queues, video retention, and safe archival checks remain intact.
- CI regression tests check cache hits, misses, invalidation, expiration, in-flight deduplication, Buffer isolation, and memory bounds.

## Test in Replit

1. Pull the Phase 4 branch, run `npm run check:source` and `npm test`, then `npm start`.
2. While the bot is starting, try `/profile` and the existing photo-management controls. Slash commands should not wait for outfit/house reconciliations to finish.
3. Confirm startup reconciliation summaries still report each active outfit/house appropriately; no saved media should be lost.
4. Browse outfit and house photos with Previous/Next; navigate back to a previously visited photo and verify its artwork is correct.
5. Change an outfit/house appearance (for example a sticker or background), then revisit the same gallery page. The new appearance should show immediately, not the cached older style.
6. Confirm native tour videos remain on the existing listing posts, and no gallery replies disappear.
7. Leave Wispbyte production unchanged. This is a development draft PR and requires separate merge/deploy approval.

## Next performance slices (not implemented here)

- If actual navigation is still slow, profile the repeated MongoDB gallery archive verification and avoid unnecessary queries without compromising source-photo retention.
- Consider extra gallery query improvements only where real usage shows bottlenecks; galleries already fetch one image rather than all image bytes.
- Review the mixed-video layout separately with user approval; do not silently relocate or delete existing attachments.
