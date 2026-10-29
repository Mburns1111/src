# Three-card Discord drop preview (development)

The `/cards test-drop release:test-s1-r1` command now posts one **1920 × 1510 PNG**:
- A **release banner at the top**, independent of the individual cards. If `CardRelease.eggImageUrl` is set to an accessible image URL, it is cropped to the 1828×600 banner area (fit without cropping); otherwise a styled text header is used. The supplied Release 1 egg art is available in the project handoff conversation; to activate it in Replit, put the original PNG at `assets/card-eggs/release-1.png` in the development workspace. It is not checked into GitHub and is not live until uploaded. The test release detects this path automatically when the release has no configured image URL.
- Three normal-stage card previews in the same order as Grab #1/#2/#3.
- Each card uses the existing portrait-card style: pet name, rarity colors, artwork frame, and placeholder or approved art. **Each drop card always shows an artist-credit field**. Test placeholders show `Test placeholder · Artist pending`; approved art is rejected if the artist name is missing.
- **No public card IDs** and no collector statistics on unclaimed drop cards. IDs are minted only at the end when reserved cards are awarded.
- Only a **single header line** appears above the image: `🥚 Release Name Egg — Hatched!` while open and `🥚 Release Name Egg — Drop Ended` after expiry. **No redundant pet list, countdown, or claim text is shown above the PNG.** The three Grab buttons appear below. The image does not change when a slot is reserved; buttons change to Reserved and are removed at expiry.
- The image is generated before creating the MongoDB drop record, so a render error does not create an unposted drop.

Test by pulling `feature/card-game-foundation`, running `npm test`, restarting the development bot and using `/cards test-drop release:test-s1-r1`. No slash command registration or database migration is required for the layout.

To show the actual supplied Release 1 egg banner, place the uploaded image at `assets/card-eggs/release-1.png` in the Replit project, or set `CardRelease.eggImageUrl` to a stable approved image URL. Preserve the original attribution/source notes; confirm redistributable rights before making a public production release.

This change does not touch production, card ownership or the grab/settlement rules.
