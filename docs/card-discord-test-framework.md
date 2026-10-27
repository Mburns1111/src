# Discord card-game test framework

This branch is **not** merged into the live bot. Card actions are disabled unless `ENABLE_CARD_GAME_TEST=1`.

## Included
- `/cards test-drop release:<releaseId>`: manager-only, manual test reveal of three cards into current channel.
- `/cards collection`: private count of first 200 owned card copies (not a full gallery).
- Public grab buttons: one card per user per drop, 75-second expiry, cards visible before grabbing.
- Atomic MongoDB transactions protect slot reservation + collector creation + owned copy creation + claim record.
- Test-only opt-in; no recurring automatic drops, startup jobs, spending, dust, Neon/Mega upgrades, trading, or artist-upload workflow yet.

## Setup on development bot (not production)
1. Switch the **development** working copy to `feature/card-game-foundation` and install dependencies as usual.
2. Set `ENABLE_CARD_GAME_TEST=1` **only on the test bot**.
3. Execute `node register-commands.js` with the test bot credentials and test-guild configuration. Beware: this repository's registration script also updates the application's global command list. Use a separate Discord application/token for development.
4. A manager must set up an active `CardRelease` with a real `releaseId`, validated rarity percentages and at least one `CardDefinition` with `enabled=true`, `artStatus=approved`, and `hatchWeight>0`. The system never automatically approves artwork. Only source-owned/approved art should be attached.
5. Run `/cards test-drop release:<releaseId>` in a test channel. Drop buttons appear for 75 seconds. `/cards collection` shows basic inventory counts.
6. Run `npm test` and verify Discord claims with two different users, repeated clicks, expired clicks and concurrent grabs before any public deployment.

## Important limits
- There is **no art/release administrator panel or seed script yet**. Without a real, approved release the manager test-drop command refuses to post.
- The current test drop uses text names and buttons; the egg/card renderer and timed animation still need building.
- MongoDB must support multi-document transactions (replica set / Atlas) for grab persistence.
- The authoritative expiry is checked in MongoDB. Existing buttons may remain visible after expiry until the message is refreshed, but grabs will be refused.
- Unique indexes for `CardClaim` should be built before load testing. Multiple bot processes must not be independently running for unrelated behavior.
- `/cards collection` is a temporary basic count, not a browsable card inventory.
- No automatic scheduled drops, cooldowns, dust burning or upgrades are active yet.
- No live pet/catalog/profile collections are edited by these code commits.
