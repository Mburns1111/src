# Card Collection Browser — Development

The `/cards collection` command opens a **private, interactive collection** on the development bot when `ENABLE_CARD_GAME_TEST=1`. This does not modify the public drop layout or production commands.

## Player workflow
1. Use `/cards collection` to see the total owned collection and eight cards per page.
2. Choose a rarity, release, or sort order with the dropdowns.
3. Select a card to display its full 900×1260 portrait image with its saved ID, artist credit, stage, and art layers.
4. Use **Back to collection**, **Previous**, **Next**, or **Close**.

- Results contain only copies with the invoking Discord user's `state: owned`.
- Card selections repeat ownership checks; users cannot open other members' private cards.
- Menus expire after 15 minutes of inactivity. Reopen the slash command to start again.
- Session state is held in memory and is intentionally lost on a bot restart.
- The release dropdown currently lists up to 24 releases; unlimited release browsing would require a searchable selector later.
- Collections of any size are paginated in MongoDB (8 at a time) rather than sending thousands of Discord components.
- Existing `/cards preview`, `/cards tag`, `/cards stats`, and `/cards test-drop` remain supported.

## Test
Pull the dev branch and run `npm test`, `node register-commands.js` if not yet registered, then `npm start`.
Use `/cards collection` after grabbing test cards. Verify rarity sort, release selection, next/previous, and card inspection.
No new artwork is required to test; placeholders render normally.


## Public collection lookup (new)

- \`/cards collection\` posts the invoking member's collection publicly.
- \`/cards collection member:@someone\` posts that member's collection in the channel.
- Every member can see the list and selected full-card images.
- **Only the person who executed the slash command** can use the dropdowns. Unauthorized interactions receive a private message and do not change the public post.
- The displayed cards, rarity choices, release options, and tags all come from the **selected member's owned cards**, not from the command invoker's inventory.
- After pulling, run \`node register-commands.js\` once to register the new optional member argument. Other commands keep their private responses.
