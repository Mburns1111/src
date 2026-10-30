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
- `.drop` — owner-only test egg release `test-s1-r1`; `drop test-other-release` also accepts a test release ID
- `.collection` or `collection @member` — public, invoker-controlled collection browser
- `.upgrade 2D Doggy` or `.upgrade KmwP7` — auto-select four matching cards, with confirmation and public upgraded-card artwork
- `.create-tag cute` saves a reusable tag, even when no cards have it; `.tags` lists saved tags.
- `.tag "cute"` or `.tag cute` tags the newest currently owned card.
- `.tag "cute" Abyssinian Cat` or `.tag "cute" abys` targets every owned copy of that pet (with one/all confirmation if multiple).
- `.tag "cute" KxQOo` targets one owned ID; when you have other versions of the pet, choose **Only this ID** or **All copies** in confirmation.
- `.tag "cute" KxQOo Abc12 Def34` or `.tag "cute" KxQOo,Abc12,Def34` applies the tag to **only the listed card IDs**, after count-based confirmation. Maximum 20 IDs per batch.
- `.tag "Very Cute" 2D Doggy` assigns a tag containing spaces to a pet name containing spaces. The tag is always first.
- Pet names and tags ignore capitalization. Public card IDs keep their original exact spelling, but can be typed in any capitalization when unambiguous.
- `.untag 2D Doggy`, `.untag KxQOo`, `.untag-multiple KxQOo,Abc12` require confirmation before changing tags.
- `.tag-multiple Favorites KxQOo,Abc12` remains available for compatibility, but use the new `.tag "Favorites" KxQOo Abc12` for a unified workflow.
- `.delete-tag Favorites` deletes the named tag after confirmation. `.stats KxQOo` and `.view KxQOo` show stats or an image.

Typed commands reuse the same underlying card business rules, validation, database and existing Discord component handlers as slash commands. Responses to typed commands are visible in the Hatchem channel. Confirmation buttons still validate the requesting member.

**Not implemented:** card `trade` and `burn` actions. Typing these will reply that the feature is not ready, without changing ownership or consuming cards. These will be wired to Hatchem when their corresponding gameplay systems exist.

Slash-command autocomplete is confined to Hatchem. Typed messages do not show Discord slash-command autocomplete while composing; they accept the full pet name or card ID.

## Caveats

- A privileged Message Content Intent must be enabled both in the Developer Portal and in Replit; merely assigning a channel does not grant it.
- The Hatchem channel is configured independently of the ordinary command channel.
- Pet names and tag names are case-insensitive; five-character IDs accept case-insensitive input only when one owned card matches. Exact IDs are still permanently case-sensitive internally and never renamed.
- A four-letter pet prefix must identify one distinct pet you currently own. If several pets match, type more of the name or use a card ID. A pet-name tag can affect all copies once confirmed.
- Write the tag first; quote tags containing spaces, e.g. `.tag "My Favorites" Abyssinian Cat`.
- This is the Replit development bot, not Wispbyte production.

## Collection, views and tag confirmation (October 29)

- `.collection cute` opens the public collection pre-filtered by saved tag `cute`; `.collection @member cute` filters the mentioned member's collection. The `/cards collection` slash command also has an optional tag field.
- `.view KxQOo` or `/cards view card_id:KxQOo` renders the card image. The former `.preview` user command was renamed to `view`.
- `.tag "cute" 2d do` when there are multiple owned 2D Doggy copies opens a confirmation with the total matching cards, count whose tags change, unique IDs, upgrade stages and release-level frame names. Choose **Apply to all** or select **one specific ID** from the dropdown. Changes happen only on confirmation.
- `.tag "cute" KxQOo` directly tags one owned ID; `.tag cute` directly tags the newest owned card if no name is given.
- **Every `.untag` request is confirmed**, including one-card IDs and `/cards untag-multiple`. The prompt shows how many cards would lose a tag, with options for all or a specific copy when multiple cards match. Cancelling leaves all tags untouched.
- The bot presently stores frames as **release-level frame artwork**, not distinct per-copy frame equipment. Confirmation can display the release's frame key and card upgrade stage. Per-copy applied decorative frames require a future card customization model.
- Upgrade confirmation warns that decorations applied to consumed originals do not transfer. Four original IDs are consumed and replaced by one new upgrade ID.
- Confirmation expires after two minutes or on process restart. Only the member who requested the change can use the buttons.

- When a specified five-character ID has other owned copies of the same pet, the confirmation includes an **Only selected ID** button and an **All copies** button.
