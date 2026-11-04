# Hatchem: provisional artwork on the official draft release

**Development only:** branch `feature/card-release-art-preview`, based on `feature/card-game-foundation`. Do not merge, activate a release, or deploy Wispbyte without explicit approval.

The owner's artwork can be a **first/provisional version** while the actual card definition, pet, series, rarity and identity belong to a real release. This is **not** the isolated `test-s1-r1` fixture.

## Upload to the REAL release

1. Use `/cards-owner releases` and `/cards-owner inspect release:<real-release-id>` to find the real draft release and existing pet IDs. If a real release does not yet exist, create its series/release and add pets with the existing owner commands.
2. `/cards-owner art-upload key:cow-v1 kind:Pet illustration image:<PNG> artist:<actual-author>`. Assign a separate immutable key to each version. The bot stores the file in MongoDB, not in GitHub.
3. Check that the owner actually has rights to use the artwork. Record the evidence with `/cards-owner art-review key:cow-v1 decision:Approve note:<permission/source evidence>`. **Provisional does not mean unlicensed.** Art under review cannot be assigned to an official release.
4. `/cards-release assign-art release:<real-release-id> kind:Pet key:cow-v1 pet:<exact-pet-id>`.
5. For a future hatchable release, `/cards-release set-enabled release:<real-release-id> pet:<exact-pet-id> enabled:true`, but **do not activate it merely to preview artwork**.
6. Repeat for pet illustrations. Release-wide backgrounds and frames use the same upload/review/assign flow with `kind:Card background` or `Transparent frame`. Those whole-card layers must be **900 × 1260**. Frames must have transparency. Pet art is displayed in the `734 × 748` viewport at `x=83, y=242` and cropped to cover.

## Preview the real draft cards safely in Discord

After registering commands on the Replit **test bot**:

- `/cards-owner preview-art release:<real-release-id> pet:<pet-id>` — privately renders one actual draft card using current assigned artwork, name, rarity, and the release's assigned background/frame.
- `/cards-owner preview-drop release:<real-release-id>` — privately renders a three-card composite and egg-banner area. Picks three distinct available definitions, favoring assigned artwork and varied rarities. This is **only a visual sample**, not a real hatch or a weighted probability simulation.

Both commands reject active releases and the `test-*` fixture, and neither writes CardDrop, CardCopy, CardClaim, supply, cooldowns, points or achievements. This is a read-only preview. The image displays a placeholder for pets without assigned artwork.

### Replit update

```bash
git fetch origin
git switch feature/card-release-art-preview
git pull --ff-only origin feature/card-release-art-preview
npm test
node register-commands.js
npm start
```

Keep `ENABLE_CARD_GAME_TEST=1`, a separate testing Discord token, the intended development MongoDB database, and `CARD_GAME_OWNER_DISCORD_ID` set to the owner's own Discord ID.

## Replacing provisional art later

While a release is **draft**, upload a new key such as `cow-v2` with `replaces:cow-v1` and `revision_note:New hand-drawn illustration`; review that version and reassign it to the same pet. Old stored artwork and its credit/review audit remain intact.

**Current limitation:** the existing `/cards-release assign-art` command only accepts **draft releases**, so changing artwork on an *active* release requires a separate safe replacement implementation before launch. Do not create replacement CardCopy records or change public IDs to update artwork. Artwork assignments and preview commands do not themselves prove permission to use third-party art.
