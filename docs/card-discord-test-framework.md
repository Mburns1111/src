# Initial card-game test setup (development only)

**Never merge or deploy this feature branch to production without separate approval.**

The framework is disabled unless `ENABLE_CARD_GAME_TEST=1`. It adds no automatic recurring drops.

## Replit test procedure

1. Fetch and switch the Replit **development** bot to `feature/card-game-foundation`, then run `npm install` and `npm test`.
2. Set `ENABLE_CARD_GAME_TEST=1` in the dev bot secrets. Keep it unset on Wispbyte. Use a separate development Discord application/token. Set `DISCORD_GUILD_ID` to your test server.
3. Run `node scripts/seed-card-test-release.js` to preview a fixture with 2 existing verified pets of each rarity. It is read-only by default.
4. If the list looks correct, run `CARD_GAME_TEST_SEED_APPROVED=YES node scripts/seed-card-test-release.js --apply` once. This adds `test-series-1`, `test-s1-r1`, and 10 explicitly labeled `test-placeholder` card definitions. **Use a development MongoDB database if possible**. The script will not overwrite existing seed objects.
5. Run `node register-commands.js` for the test bot. `/cards` is only registered in the configured test guild, not in global commands; existing other commands still use the repository's original global registration.
6. Start the development bot and run `/cards test-drop release:test-s1-r1` in a channel where the bot can post. Only managers with Manage Server can run it.
7. Three text cards appear for 75 seconds. Test grabbing from different accounts, double-clicking, clicking the same slot simultaneously, claiming a second card in the same drop, expired buttons, and `/cards collection` counts.
8. Disable the flag to stop further testing. The test collection records remain in the test database.

## Boundaries and unfinished features

- The pet catalog and user profile collections are not modified by the source changes.
- Test placeholders are **not** approved artist art and only enter hatches in the explicit test mode. Production art approval is separate.
- There is no egg animation or card-image renderer yet: testing uses text reveals and Discord buttons.
- No timed automatic drops, grab cooldown across drops, dust burning, upgrades, public trade, artist art uploads or member gallery yet.
- MongoDB transactions require a replica set (e.g. MongoDB Atlas); the test database must support transactions.
- A claim's MongoDB transaction is authoritative. Buttons can remain visually active after the 75-second deadline, but those claims will be rejected.
- /cards collection presently shows counts for at most the first 200 items.
- Never use production Discord token or a production card-release ID for these trials.
