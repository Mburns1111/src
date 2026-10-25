# Admin migration — inventory video and Trading Post

This extends `/admin-import` on the existing draft PR, without changing successful house/outfit migrations.

## New commands

- `/admin-import inventory member:@Member` — enter **either** a playable video upload or a video link. The bot creates a new post in the configured inventory channel, credits the selected member, stores its post reference in **that member's profile**, and refreshes their existing profile/Trading Post cards best effort.
- `/admin-import trading member:@Member` — enter **Looking for** and/or **Willing to trade**. The bot creates that member's standard styled Trading Post card, with their profile appearance and ownership controls.

An importing admin is recorded separately for audit. Neither import grants first-post Points rewards.

## Important: create-only, no replacement

Both inventory and Trading Post normally have **one entry per member**. The migration command therefore **refuses to import** if an existing entry is already recorded:

- Inventory: if the member already has an inventory post or link, nothing is replaced, deleted, or moved.
- Trading Post: if the member already has a saved card (including a pending deletion), nothing is overwritten.
- Importing an old/manual source does **not** delete the source post.
- A member must currently be in the server and cannot be a bot.

Imported Trading Posts use the selected member's `ownerId` and existing **Edit my card**, **Delete my card**, and interest controls. Imported inventory entries reference the member's `discordUserId` profile so they can subsequently replace their own inventory video with the normal inventory workflow. There is no separate inventory delete button in the current bot.

The inventory importer verifies an uploaded playable attachment, and both forms use owner-and-admin bound one-use tokens. If an import partially publishes, it preserves the new post or saved card for inspection rather than deleting potentially irreplaceable media.

## Replit checks

1. Switch to `feature/admin-import-member-listings`, `git pull`, `npm test`.
2. Register commands using the **test bot credentials**: `node register-commands.js`; then restart the Replit bot.
3. Use `/admin-import inventory member:@TestMember` with a video file. Confirm video plays in the inventory channel, the member is credited, and their **profile and Trading Post link to it**.
4. Test a different member with a video URL instead of a file. Confirm the link appears on the bot's attributed post.
5. Use `/admin-import trading member:@TestMember` and enter looking-for/willing-to-trade text. The selected member should see their own name/style and be able to **Edit my card**, toggle Interest DMs, and **Delete my card**.
6. Re-run both commands for the same member: they must reject existing items, not overwrite them. Test with a member whose Trading Post deletion is pending.
7. Re-test ordinary member-created inventory videos and Trading Posts to ensure they still work. Do **not** delete old source messages until after you've personally verified the migrated replacements.

No merge, Wispbyte deployment or destructive source-message changes without separate approval.
