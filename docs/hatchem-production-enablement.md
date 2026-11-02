# Hatchem production-enablement handoff (November 2, 2026)

**Status:** Production-capable code is prepared on the **development branch** `feature/card-game-foundation` only. **Not launched. Do not merge, deploy to Wispbyte, register production commands, or alter the live bot's environment until the owner explicitly approves launch.** Remaining card art, final pet selection, secret achievements and live testing are intentionally deferred until the artwork is complete.

## Three explicit modes

| Environment | Gameplay | Commands | Egg releases |
| --- | --- | --- | --- |
| Neither flag set | Off | No Hatchem slash commands | No scheduled eggs |
| `ENABLE_CARD_GAME_TEST=1` | Dev/test enabled | Guild-only Hatchem commands in `DISCORD_GUILD_ID`; includes test-art tools | Test fixtures allowed; scheduled and chat-triggered eggs restricted to the test guild |
| `ENABLE_CARD_GAME=1` | Real game enabled | Global `/cards`, `/cards-admin`, `/cards-owner`, `/cards-release` | Only approved, active official releases; no test fallback |

Never set both flags to `1`; startup/registration rejects conflicting modes. The live switch does not set any release to active, publish an egg, configure achievements, merge branches or deploy code by itself.

## Production command safety

- Global `/cards` registers ordinary player features: registration, player drops, trading, gifts, shop extras, collection, burning, upgrades and stats.
- Global `/cards-admin setup-role` is for server managers to select that server's **Card role**. It does not let managers alter universal egg rates.
- `/cards-owner` and `/cards-release` remain restricted by the configured `CARD_GAME_OWNER_DISCORD_ID`, *not* by the server Administrator permission. These commands also have restrictive default Discord command permissions.
- Live owner art-library tools remain available: `art-upload`, `art-list`, `art-info`, `art-review`; official art is assigned with `/cards-release assign-art`. Official egg banner uploads and permission review live in `/cards-release egg-upload` and `egg-review`.
- **Excluded from production registration and guarded at runtime:** `test-drop`, `egg-art-upload` (test egg artwork), `art-assign` (test-only direct assignments). Production release selection also excludes `test-*` releases, and unapproved test placeholder art is never eligible.
- The `ENABLE_CARD_GAME_TEST=1` bot retains these dev-only owner tools in the single configured testing guild. Regular production command registration never exposes them globally.

## Safeguards and future launch requirements

`ENABLE_CARD_GAME=1` also requires:

1. `CARD_GAME_OWNER_DISCORD_ID` with the actual owner Discord user ID.
2. `ENABLE_MESSAGE_CONTENT_INTENT=1` and the matching privileged Message Content intent in the Discord Developer Portal, so dot commands work.
3. The ordinary runtime secrets `DISCORD_TOKEN`, `MONGODB_URI` and (for command registration) `DISCORD_CLIENT_ID`.
4. Valid official releases. A release remains **draft** until art and secret-achievement readiness checks pass and the owner explicitly activates it. No official egg is configured by the production-mode switch.
5. Correct per-server Hatchem channel and local Card role. Once a release is active, the bot posts regular randomized eggs and activity bonus eggs with the universal schedule; no local on/off or frequency control.
6. Set and verify `CARD_ACHIEVEMENTS_START_AT` before the official launch after artwork is finalized. This immutable launch boundary is **not automatically set** by enabling production mode. Test releases and prelaunch actions do not count for achievement ranking.
7. Confirm the intended MongoDB database, separate development and production bot tokens, and deployment branch before performing live actions.

Purchased Extra Grabs/Drops continue working whenever the real Hatchem game is enabled, **even if achievement launch date is not configured yet**. Their cooldown and refund accounting uses the existing MongoDB transaction-backed bonus-action path in both modes.

## After art is done — owner-held checklist

- Finalize the egg/pet list and artist review; upload and assign final credits and approved artwork.
- Author/freeze the six release-specific secrets and configure the official achievement start date correctly.
- Check official release readiness, run the postponed Discord tests, and explicitly approve activation.
- Only then request the controlled merge/deployment to Wispbyte and global slash-command registration. Replit keeps `ENABLE_CARD_GAME_TEST=1` for development; the live environment will use `ENABLE_CARD_GAME=1` instead. Do not change these flags before launch approval.

The existing non-Hatchem profile, trading post, housing, outfit, shop and Points commands are unaffected.
