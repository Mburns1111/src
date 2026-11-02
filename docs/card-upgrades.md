# Card upgrades — development-only

Use `/cards upgrade card_ids:AAAA1,AAAA2,AAAA3,AAAA4` on the development bot.

## Rules
- The player supplies **one card ID or a pet name**. The bot finds **4 distinct owned cards** from the same card definition (pet + release) and upgrade tier.
- **4 Normal → 1 Neon**; **4 Neon → 1 Mega Neon**; Mega Neon cannot upgrade further.
- Tagged cards **can** be used for upgrades. The bot favors untagged copies when automatically choosing, but a specified tagged ID will be included. Tags are reserved as protection for future burning, not upgrades. Cards with missing IDs cannot upgrade.
- A **private confirmation** displays all four automatically selected input card IDs and the target stage. The request expires after 90 seconds. If pet-name matching finds multiple eligible releases, the bot requests a specific card ID.
- Confirming marks the four input cards as `consumed` and creates **one new copy** with a fresh, globally unique five-character public ID, preserving source provenance in `createdFrom`.
- Consumption, minting, and an immutable `CardLifecycleEvent` record occur in **one MongoDB transaction**. No partial upgrade is retained if the transaction fails. Requires a MongoDB transaction-capable replica set.
- Only the requesting member can confirm; ownership and tags are revalidated inside the transaction.
- Card artwork is inherited by definition and the Neon/Mega renderer already supports different tier presentation. Finished art is not required to test.

## Test procedure
1. Stop dev bot, `git pull origin feature/card-game-foundation`, `npm test`, `node register-commands.js`, `npm start`.
2. Collect four of exactly the same test pet card in the test release. View IDs in `/cards collection`.
3. Tag one copy and attempt an upgrade using its card ID. Confirm it is eligible and included in the confirmation.
4. Untag that card, run `/cards upgrade` with four IDs, and press Cancel. Verify no cards change.
5. Repeat and Confirm. Confirm the four old copies no longer appear as owned and that the new Neon appears in `/cards collection` with a new ID. Check `/cards stats` for the lifecycle counter.
6. For Mega, repeat with four Neon copies. Verify a resulting Mega Neon.

Production code and Wispbyte must not be changed without explicit approval.
