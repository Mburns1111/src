# Three-card Discord drop preview (development)

The `/cards test-drop release:test-s1-r1` command now posts one **1920 × 1510 PNG**:
- A **release banner at the top**, independent of the individual cards. If `CardRelease.eggImageUrl` is set to an accessible image URL, it is cropped to the 1828×600 banner area (fit without cropping); otherwise a styled text header is used. The bot now reads the release egg art from its already-existing MongoDB GridFS image store. It looks for a uniquely matching file name such as `Release 1.png` or `Release 1(1).png` in known buckets. No local upload, ZIP or duplicate image record is required. The optional `CardRelease.eggImageFileId` / `eggImageBucket` allow pointing to an exact stored file; a configured `eggImageUrl` remains a legacy fallback.
- Three normal-stage card previews in the same order as Grab #1/#2/#3.
- Each card uses the existing portrait-card style: pet name, rarity colors, artwork frame, and placeholder or approved art. **Each drop card always shows an artist-credit field**. Test placeholders show `Test placeholder · Artist pending`; approved art is rejected if the artist name is missing.
- **No public card IDs** and no collector statistics on unclaimed drop cards. IDs are minted only at the end when reserved cards are awarded.
- Only a **single header line** appears above the image: `🥚 Release Name Egg — Hatched!` while open and `🥚 Release Name Egg — Drop Ended` after expiry. **No redundant pet list, countdown, or claim text is shown above the PNG.** The three Grab buttons appear below. The image does not change when a slot is reserved; buttons change to Reserved and are removed at expiry.
- The image is generated before creating the MongoDB drop record, so a render error does not create an unposted drop.

Test by pulling `feature/card-game-foundation`, running `npm test`, restarting the development bot and using `/cards test-drop release:test-s1-r1`. No slash command registration or database migration is required for the layout.

Run `node scripts/find-release-egg-artwork.js test-s1-r1` (read-only) to see the matching stored files and their GridFS buckets. If no match is found, confirm the filename and database collection; the test drop will explain the missing asset instead of silently using the placeholder. Nothing is uploaded or duplicated. Preserve the original attribution/source notes; confirm redistributable rights before making a public production release.

This change does not touch production, card ownership or the grab/settlement rules.
