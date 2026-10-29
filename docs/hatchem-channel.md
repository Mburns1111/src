# Hatchem — channel setup and typed card commands

**Development branch only.** Production is not changed.

## First-time setup

1. In the Discord Developer Portal, open the development bot under **Bot** and enable **Message Content Intent** (privileged gateway intent).
2. In Replit Secrets, set `ENABLE_MESSAGE_CONTENT_INTENT=1` and keep `ENABLE_CARD_GAME_TEST=1`. Without both, typed Hatchem messages will not be received/processed. Restart the bot after changing Secrets.
3. Pull the dev branch, run `npm test`, `node register-commands.js`, and `npm start`.
4. Use `/setup channels hatchem:#your-hatchem-channel` as a server manager. The existing setup command saves the chosen channel and posts a short Hatchem help guide. Run setup again to move the channel.

**Scope:** Only messages starting with a dot (`.`) in the configured channel process Hatchem typed commands. Normal chat is ignored without a database command lookup. Slash `/cards` commands are redirected to Hatchem if a channel is configured. Other existing profile/shop/listing commands retain their own routing. Typing a Hatchem command in another channel does nothing. Unprefixed words such as `drop` or `collection` are ordinary chat and will not be treated as commands.

## Supported typed commands

- `.help` — show full list
- `.drop` — manager-only test egg release `test-s1-r1`; `drop test-other-release` also accepts a test release ID
- `.collection` or `collection @member` — public, invoker-controlled collection browser
- `.upgrade 2D Doggy` or `.upgrade KmwP7` — auto-select four matching cards, with confirmation and public upgraded-card artwork
- `.tag KmwP7 Favorites` or `.tag Favorites` (last grabbed card)
- `.untag KmwP7`, `.tag-multiple Favorites ID1,ID2`, `.untag-multiple ID1,ID2`, `.delete-tag Favorites`
- `.stats KmwP7`, `.preview KmwP7`

Typed commands reuse the same underlying card business rules, validation, database and existing Discord component handlers as slash commands. Responses to typed commands are visible in the Hatchem channel. Confirmation buttons still validate the requesting member.

**Not implemented:** card `trade` and `burn` actions. Typing these will reply that the feature is not ready, without changing ownership or consuming cards. These will be wired to Hatchem when their corresponding gameplay systems exist.

Slash-command autocomplete is confined to Hatchem. Typed messages do not show Discord slash-command autocomplete while composing; they accept the full pet name or card ID.

## Caveats

- A privileged Message Content Intent must be enabled both in the Developer Portal and in Replit; merely assigning a channel does not grant it.
- The Hatchem channel is configured independently of the ordinary command channel.
- Card IDs are case-sensitive; pet names are not.
- This is the Replit development bot, not Wispbyte production.
