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
- `.create-tag cute` saves a reusable tag even when no cards have it; `.tags` lists saved tags.
- `.tag cute` tags your **newest owned card** (including Neon/Mega upgrades).
- `.tag abys cute` tags the newest owned Abyssinian Cat using the first four letters of its name; `.untag abys` removes that tag.
- `.tag KmwP7 Favorites` targets a specific owned card ID. Use quotes for spaces in a tag: `.tag "My Favorite"` or `.tag abys "My Favorite"`.
- Pet names, tag names, and unambiguous owned card-ID references can be entered in any capitalization. If two owned card IDs differ only in case, use the exact spelling shown in your collection.
- `.untag KmwP7`, `.tag-multiple Favorites ID1,ID2`, `.untag-multiple ID1,ID2`, `.delete-tag Favorites`
- `.stats KmwP7`, `.view KmwP7`

Typed commands reuse the same underlying card business rules, validation, database and existing Discord component handlers as slash commands. Responses to typed commands are visible in the Hatchem channel. Confirmation buttons still validate the requesting member.

**Not implemented:** card `trade` and `burn` actions. Typing these will reply that the feature is not ready, without changing ownership or consuming cards. These will be wired to Hatchem when their corresponding gameplay systems exist.

Slash-command autocomplete is confined to Hatchem. Typed messages do not show Discord slash-command autocomplete while composing; they accept the full pet name or card ID.

## Caveats

- A privileged Message Content Intent must be enabled both in the Developer Portal and in Replit; merely assigning a channel does not grant it.
- The Hatchem channel is configured independently of the ordinary command channel.
- Pet names and tag names are case-insensitive; five-character IDs accept case-insensitive input only when one owned card matches. Exact IDs are still permanently case-sensitive internally and never renamed.
- A four-letter pet prefix must identify one distinct pet you currently own. If several pets match, type more of the name or use a card ID; if you own multiple copies of the same pet, the newest is selected.
- Multiword tags used without a card selector should be quoted, e.g. `.tag "My Favorites"`.
- This is the Replit development bot, not Wispbyte production.

## Tagging pet names with spaces

- `.tag cute` targets only one newest currently owned card.
- `.tag 2d do cute` or `.tag "2D Doggy" cute` tags **every owned 2D Doggy**, across all releases and upgrade stages.
- `.tag abys cute` tags every owned Abyssinian Cat; `.untag abys` removes their tags.
- `.tag KxQOo cute` tags **only that one card ID**.
- `.tag 2d do "Very Cute"` or `.tag 2d do -- Very Cute` supports a spaced pet name and multiword tag.
- `.tag "Very Cute"` tags the newest card without specifying a pet.
- Individual card IDs and copies remain distinct in collection views; pet-name tagging writes the same tag to each copy.
- Slash `/cards tag` and `/cards untag` now suggest owned pet groups and individual card IDs. Typed dot commands cannot show Discord autocomplete.

## Collection, views and tag confirmation (October 29)

- `.collection cute` opens the public collection pre-filtered by saved tag `cute`; `.collection @member cute` filters the mentioned member's collection. The `/cards collection` slash command also has an optional tag field.
- `.view KxQOo` or `/cards view card_id:KxQOo` renders the card image. The former `.preview` user command was renamed to `view`.
- `.tag 2d do cute` when there are multiple owned 2D Doggy copies opens a confirmation with the total matching cards, count whose tags change, unique IDs, upgrade stages and release-level frame names. Choose **Apply to all** or select **one specific ID** from the dropdown. Changes happen only on confirmation.
- `.tag KxQOo cute` directly tags one owned ID; `.tag cute` directly tags the newest owned card if no name is given.
- **Every `.untag` request is confirmed**, including one-card IDs and `/cards untag-multiple`. The prompt shows how many cards would lose a tag, with options for all or a specific copy when multiple cards match. Cancelling leaves all tags untouched.
- The bot presently stores frames as **release-level frame artwork**, not distinct per-copy frame equipment. Confirmation can display the release's frame key and card upgrade stage. Per-copy applied decorative frames require a future card customization model.
- Upgrade confirmation warns that decorations applied to consumed originals do not transfer. Four original IDs are consumed and replaced by one new upgrade ID.
- Confirmation expires after two minutes or on process restart. Only the member who requested the change can use the buttons.

- When a specified five-character ID has other owned copies of the same pet, the confirmation includes an **Only selected ID** button and an **All copies** button.
