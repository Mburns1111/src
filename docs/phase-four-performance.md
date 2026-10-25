# Phase 4 — Performance and usability

## First slice: startup responsiveness

- Slash commands acknowledge immediately and are no longer gated by all startup entry checks and house/outfit reconciliation. Startup maintenance still logs failures and performs the same individual safe checks.
- House and outfit reconciliation now give the event loop a chance to handle interactions after every four records, including records that were skipped or failed. All listing existence, ownership, and media-preservation safeguards remain in place.
- No migration, video layout change, new database collection, new shop prices, or changes to Points rules.

## Test in Replit

1. Pull the Phase 4 branch, run `npm run check:source` and `npm test`, then `npm start`.
2. While the bot is starting, try `/profile` and the existing photo-management controls. Slash commands should not wait for outfit/house reconciliations to finish.
3. Confirm startup reconciliation summaries still report each active outfit/house appropriately; no saved media should be lost.
4. Browse outfit and house photos with Previous/Next. They should still update on the original listing post.
5. Leave Wispbyte production unchanged. This is a development draft PR and requires separate merge/deploy approval.

## Next performance slices (not implemented here)

- Measure redundant render work before considering limited rendered-image caching. Avoid stale cards when users customize appearances or paginate.
- Consider extra gallery query improvements only where real usage shows bottlenecks; galleries already fetch one image rather than all image bytes.
- Review the mixed-video layout separately with user approval; do not silently relocate or delete existing attachments.
