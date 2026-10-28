# Public card IDs (development design)

- MongoDB `CardCopy._id` remains the internal, stable primary key and reference for rendering, ownership, transfers, claim history, upgrades and definitions.
- Each *awarded* card receives exactly one unique player-facing `CardCopy.publicId`, five characters long, using `0-9`, `A-Z`, `a-z`, `-`, `_`. Case is significant.
- Unclaimed revealed cards and pending reservations receive no `CardCopy` and consume no public IDs.
- The bot allocates public IDs inside the same MongoDB transaction as the award. The allocator is an atomic global counter with a deterministic one-to-one permutation, yielding varied-looking IDs without random collisions. Its total space is ~1.07 billion IDs.
- IDs are globally unique, never reused, and **do not change when cards are traded or tagged**. When a card is burned/consumed, its ID remains in the audit record but is never reassigned.
- The owner is always determined by `ownerDiscordUserId`; knowing a public ID does not give someone permission to tag, burn, or trade the card.
- Collection summaries and tag commands show and accept only public IDs, never exposing MongoDB `_id` to users. Rendering resolves public ID to the hidden copy record and then its card definition, pet, series, and artwork.
- The legacy `CardCopy` documents created during initial testing are retained. Use the guarded backfill below to give these copies public IDs without modifying their ownership or tags. No pet catalog or profile data is changed.

## Replit development migration

1. Switch to `feature/card-game-foundation`, run `npm test`, and ensure the dev bot is stopped.
2. Run `node scripts/backfill-card-public-ids.js` (read-only preview).
3. Check `cardsMissingPublicId`. If expected, run `CARD_ID_BACKFILL_APPROVED=YES node scripts/backfill-card-public-ids.js --apply` (requires `ENABLE_CARD_GAME_TEST=1`).
4. Restart the dev bot, then use `/cards collection`, `/cards tag tag:Favorite`, and bulk tag commands. No slash-command re-registration is required for this ID format change.

**Do not run backfill against the live production bot or merge/deploy this branch without testing and approval.**

Future card creation paths for Neon/Mega and admin-awarded cards must also allocate a new public ID when a new owned CardCopy is minted.
