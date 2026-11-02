# Why Discord showed duplicate slash commands

The former registration script put the same ordinary commands into both
global **application commands** and **guild commands**. Discord can display two
entries for the same slash command name even if the bot only has one process.

The updated `register-commands.js` always publishes ordinary commands
globally. In a development guild, the guild-specific registration list contains
only test-mode Hatchem commands when `ENABLE_CARD_GAME_TEST=1`. Otherwise it
is empty. The guild-specific PUT is intentional: it clears obsolete duplicate
guild registrations without deleting global commands.

## Apply to the development bot

1. Confirm Replit uses the development Discord application's
   `DISCORD_TOKEN` and matching `DISCORD_CLIENT_ID`. Do not print these values.
2. Stop any duplicate Replit bot instances.
3. Update the development branch and run `npm test`.
4. Run `node register-commands.js` once using the development credentials.
   The script replaces **both** the application's global command set and the
   specified test guild's command set, so **never run it against the live
   Wispbyte application's token**.
5. Restart the single development bot. Discord may cache the command menu for
   some time; refresh Discord if both entries are briefly visible.

If the duplicates remain after synchronization, inspect whether **two distinct
bot applications** are installed in the guild and whether the command entries
show different application names/icons. This registration fix can only clean up
the command scopes for the development app it authenticates as.

This change does not merge to production or affect any currently running bot.
