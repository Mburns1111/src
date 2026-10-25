# Phase 6 — Member help and discoverability

## Scope
Keep the current gallery and video arrangement **exactly as tested**: native video attachments appear above the styled card, while photos are displayed in the card. Do not move media, migrate collections, remove attachments, or alter any public listing.

## First slice: private /help navigation

- Replace the long feature list shown by /help with a concise private guide containing **Start here**, **Listings**, **Shop**, **Points**, and **Commands** buttons.
- Members can switch topics on the same ephemeral help response, with no extra public messages and no database updates.
- Describe existing member-facing features accurately: **My house listings**, **My outfit listings**, **Choose photo**, native videos above cards, the shop directory, customizing appearance, and checking Points with **/shop balance**.
- Keep the live registered-command list accessible on the Commands topic, including server-specific overrides, subcommands, and administrator setup guidance. Network failures use a friendly fallback instead of breaking the entire guide.
- Buttons are tied to the initiating member and reject invalid or outdated topics.

## Replit smoke test

1. Pull `feature/phase-6-member-help`, run `npm run check:source` and `npm test`, then restart the bot.
2. Run `/help`: it should open a **private** help menu containing five navigation buttons.
3. Click Listings, Shop, Points, Commands, and Start here. Confirm each changes the same private help response and no message appears in the public channel.
4. Read the Listings instructions and confirm they match the existing functioning house/outfit buttons and gallery controls.
5. Use the existing house/outfit controls, shop and profile once to ensure they still work. No media or customization should change simply from opening help.

No merge or Wispbyte deployment until explicit user approval.
