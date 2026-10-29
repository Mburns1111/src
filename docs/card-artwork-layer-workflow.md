# Collectible card artwork layers — development workflow

Card canvas is **900 × 1260 px**. This system is available only with `ENABLE_CARD_GAME_TEST=1` and `Manage Server` permissions.

## Current behavior
- Existing placeholder cards still work without any art assigned.
- Uploaded image bytes are stored in MongoDB GridFS bucket `cardArtwork`, not Replit or GitHub.
- `CardArtwork` preserves a unique asset key, type, uploader and artist attribution. Uploads cannot overwrite a key.
- Pet illustration uses the **734 × 748** visible art viewport at **x=83, y=242**, and is cropped to fill that window.
- Background and transparent frame images must be **exactly 900 × 1260 px**.
- Background sits under card UI; pet art fills the artwork window; frame overlay is drawn over the design but below footer text/credits. Rarity text/labels remain unchanged.
- Artwork uploads start as **needs-review**, and assignment is limited to the isolated `test-s1-r1` release. Assignments do **not** approve copyright/license or enable production.
- Test release backgrounds/frames apply to all cards in that test release; pet art is assigned per pet definition.

## Discord workflow
After pulling the dev branch, running `npm test`, `node register-commands.js`, and starting the development bot:

1. Upload: `/cards art-upload kind:Pet illustration key:cat-art-01 image:<attachment> artist:<artist>`.
2. Assign: `/cards art-assign kind:Pet illustration key:cat-art-01 pet_id:<exact test pet ID>`.
3. For shared designs: `/cards art-upload kind:Card background key:release1-bg-01 image:<attachment>` and assign the same key with `/cards art-assign kind:Card background key:release1-bg-01`.
4. For frames, use kind `Transparent frame`; export a **PNG with transparency**.
5. `/cards test-drop release:test-s1-r1` checks the three-card layout, or `/cards preview` previews your latest owned card.

Use new artwork keys for revisions; existing keys are deliberately immutable. Current test assets cannot be deleted or reassigned by regular members.

## Not yet implemented
Moderation approval, asset replacement/revision history, separate Neon/Mega art variants and production-release artwork publishing are future stages. No production database or live bot was changed by this feature branch.
