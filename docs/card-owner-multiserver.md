# Hatchem owner settings, server setup, and multi-server cooldowns

**Development branch only. Not deployed or merged.**

## Single bot owner

Set `CARD_GAME_OWNER_DISCORD_ID` to the owner's numeric Discord **user ID** in Replit Secrets. This is the *same environment variable name and value* to add to Wispbyte's environment-variable/Secrets interface later, after separately approving a production deployment. Do not put the ID into source code or GitHub. No token, password, or server/guild ID is needed for this setting. Discord Developer Mode → right-click your own account → Copy User ID.

**Fail-closed:** If the secret is unset, empty, invalid, or a different Discord account, nobody (not even a server administrator) may run owner-only card artwork commands, test drops, or release-inspection commands. No server-role or manager-permission bypass.

## Permissions and commands

- `/cards-admin setup-role role:@Card`: a manager with Manage Server chooses the local Card role; the bot must have Manage Roles and be above that role in the hierarchy. This only saves `GuildConfig.cardRoleId`. Actual automatic role assignment awaits collector registration.
- `/cards-owner releases [page]`: only the configured owner can inspect global release names, IDs, and status; response is private.
- `/cards-owner inspect release:<id> [page]`: only the owner can inspect global pet lineup, weights, approved/enabled state and hatch odds; response is private.
- `/cards-owner create-series id:series-1 name:"Series 1"`: owner creates a global series in draft.
- `/cards-owner create-release series:series-1 id:s1-r1 name:"Release 1" egg:"Release 1 Egg"`: owner creates an **empty draft** release with the standard 26/26/26/14/8 odds. It is shared across all servers, but no cards are automatically seeded or made available.
- `/cards-owner add-pet release:s1-r1 pet:Cow weight:1`: adds one master-catalog pet by canonical ID or exact name as disabled with missing artwork. Unknown-rarity pets are blocked from assignment.
- `/cards-owner add-pets release:s1-r1 pets:"cow, unicorn, Abyssinian Cat"`: add up to **100 canonical IDs or exact pet names in one operation**. The bot validates every pet and commits the whole batch transactionally; duplicates or unknown rarities reject the entire batch.
- `/cards-owner remove-pet release:s1-r1 pet:cow`: removes only an unapproved, disabled draft pet.
- `/cards-owner edit-release release:s1-r1 name:"New Name"`: changes an existing draft release/egg display name.
- `/cards-owner set-weight release:s1-r1 pet:cow weight:2`: adjusts one draft pet relative hatch weight (0 disables its chance).
- `/cards-owner set-odds release:s1-r1 common:26 uncommon:26 rare:26 ultra_rare:14 legendary:8`: sets all rarity percentages; they must sum to 100.
- `/cards-owner release-check release:s1-r1`: read-only readiness summary; missing enabled/approved cards and empty rarities are flagged.
- Existing `/cards test-drop`, `/cards egg-art-upload`, `/cards art-upload`, `art-assign`, `art-list`, `art-info`, and `art-review` are now **owner-only**, not manager-only.
- `/setup channels hatchem:#channel` remains available to local server managers as part of the existing channel configuration. No permission changes to unrelated profiles, listings, or Points commands.

These commands are currently registered only in the development test guild when `ENABLE_CARD_GAME_TEST=1`; this is not a production rollout. Draft release creation and editing are implemented in the development branch. **Release activation/retirement and player registration are not yet implemented**; no new real releases are published or made hatchable automatically.

## Global releases, separate local server settings

A single CardSeries/CardRelease/CardDefinition catalog belongs to the bot, rather than separate pet rosters for each Discord server. Only the owner can manage the release catalog. The existing `CardCopy` origin guild remains recorded, with a global player collection.

## Cooldowns (foundation service; not yet applied to player drops)

- **Normal manual drops:** 15 minutes per player, globally across every server. `cardCooldownIdentity({action:"drop",discordUserId,...})` deliberately uses a single `drop:global:<user-id>` document.
- **Normal grabs:** 5 minutes per player **per server**. `cardCooldownIdentity({action:"grab",discordUserId,guildId})` uses a different `grab:<guild-id>:<user-id>` document for each server.
- Cooldowns live in MongoDB, not JavaScript timers or Replit memory. The service uses conditional updates and unique document IDs to protect concurrent actions and survive restarts.
- **Important:** Currently, only the cooldown **model and service** exist. They are not yet wired to regular player `.drop` or grab actions because these flows are still test-mode/manager-only. Do not describe the cooldowns as active in Discord yet.
- Future extra-drop/extra-grab consumables should be applied transactionally only when a valid player action uses them. Owner test drops must not consume normal player cooldowns.

## Testing and rollout

1. In Replit Secrets add `CARD_GAME_OWNER_DISCORD_ID` (your own Discord user ID) and retain `ENABLE_CARD_GAME_TEST=1`.
2. Pull `feature/card-game-foundation`, run `npm test`, and re-register slash commands with `node register-commands.js`.
3. Restart the **development** bot and test private `/cards-owner releases`, `/cards-owner inspect`, and local `/cards-admin setup-role`. Create a draft series and release, add one pet, try a short batch of two or three distinct pets, inspect it, and use release-check. Confirm that no drop is created and the card is disabled.
4. Confirm that a different manager account cannot inspect release rosters, change card art, or trigger the test drops.
5. Do not merge to main or deploy/restart Wispbyte without separate explicit owner approval.
