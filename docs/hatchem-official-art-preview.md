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

## Importing the supplied Hatchems.zip (88 provisional pet PNGs)

The artwork ZIP contains **88 matching pet illustrations**, a shared `01_base_background_900x1260.png`,
five rarity images (`common-basic.png`, `uncommon frame.png`, `rare frame.png`,
`ultra rare frame.png`, `Leg frame.png`), and `neon.png`/`mega.png`.
Ignore the supplied blank/template PNGs, guides and GIMP project files.

Each pet PNG is **already 900 × 1260 RGBA** with deliberately transparent margins and the art positioned in its central window. The renderer draws it at (0,0) at original resolution, without cropping. Rarity art is drawn underneath the pet because `common-basic.png` has a solid central region; transparent uncommon/rare/ultra/legendary frames retain their edge designs. Neon/Mega layers appear above them, beneath bot-generated labels.

The import is **dry-run by default**, needs no new dependencies, and does not use Discord attachments. Upload `Hatchems.zip` to **Replit only** and extract it:

```bash
unzip Hatchems.zip -d tmp/hatchem-art-import
node scripts/import-hatchem-art-pack.js --release=s1-r1 --dir=tmp/hatchem-art-import/Hatchems
```

Use the **actual draft release ID** in place of `s1-r1`. The script must see `ENABLE_CARD_GAME_TEST=1`, a correct development `MONGODB_URI`, and the 799-pet catalog. Dry-run validates PNG sizes, matches exact pet names (including documented aliases), shows counts, and makes **zero changes**. After reviewing the matches, apply explicitly:

```bash
node scripts/import-hatchem-art-pack.js --release=s1-r1 --dir=tmp/hatchem-art-import/Hatchems --apply
```

If all art has the same known artist, supply `--artist="Artist Display Name"`.
If credits vary or are not yet established, **do not guess artist names**. Leave them pending;
approved assignments and hatch activation require verified attribution and rights.

The batch uploader writes **immutable GridFS assets** and stages draft card assignments.
Every imported pet remains `enabled:false`, `artStatus:pending`, with asset review
`needs-review`. It does not claim permission, activate the release, or mint cards. The
import is resumable for unchanged files; it refuses conflicting keys and won't overwrite
approved cards or previously assigned artwork. Use the art-review/release controls to
approve and enable items later after verifying their sources.

The 12 expected Series 1 artwork omissions are: Arctic Fox, Cute-A-Cabra,
Happy Duckling, Hedgehog, Lamb, Lion, Otter, Owl, Strawberry Shortcake Bat Dragon,
Turtle, Unicorn and Wolf. Those pets are not silently generated or enabled.
Filename alias `ice dragon.png` is mapped to **Frost Dragon** for dry-run review;
verify that intended identity before applying.

### Viewing the real draft in Discord

`/cards-owner preview-art release:<real-id> pet:<pet-id> stage:Normal|Neon|Mega`
provides a private full-resolution preview. `/cards-owner preview-drop release:<real-id>`
shows three representative cards without creating a hatch, spending cooldowns or
awarding cards. Both commands load current draft assignments, including
unapproved temporary placeholder art **for owner previews only**.

No live change occurs until the owner separately approves a merge, deployment and
activation. All affected files remain on the development feature branch.
