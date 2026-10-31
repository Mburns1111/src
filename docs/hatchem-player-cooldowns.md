# Hatchem member drops and grabs — development implementation

**Scope:** SRC development branch. This is a player cooldown system, **not an automatic scheduler that posts drops at 15-minute intervals**. Members type `.drop` themselves. A global collectible release must be active. Test fixture `test-s1-r1` may be selected on the development bot if no non-test release is active.

## Commands

- `.drop` and `/cards drop`: Player drops an egg containing three visible cards. Drop window: **75 seconds**; entries compete for cards under the existing rules.
- `.cooldowns` and `/cards cooldowns`: Private status for next global drop and next grab **in this server**. Discord relative timestamps show when to return.
- `/cards test-drop release:test-s1-r1`: **owner-only** testing, unchanged. Does **not** spend a member drop cooldown.
- `.collection`, `.tag`, `.view`, `.upgrade`: existing card commands.

## Timing and cross-server rules

- **Drop:** 15 minutes per Discord user, **globally** across all servers using the same bot/database. Starts when a player egg is accepted and posted. Changing servers does not bypass it.
- **Grab:** 5 minutes per Discord user, **per server**, claimed at valid entry into a member egg. A collector can participate in another server independently.
- If an entrant **wins**, the grab cooldown remains until it expires.
- If an entrant **loses** the draw, their grab cooldown is refunded when the drop settles.
- If the **drop creator displaces** an entrant by claiming the same slot, the displaced member's grab cooldown is returned immediately; they may choose an open slot again.
- If the entry fails (expired egg, invalid slot, already entered), the reservation is refunded.
- Owner test eggs remain unrestricted for test participants: their clicks do not spend the normal cooldowns.
- Both timers are stored in MongoDB, not memory; they survive bot restarts and are checked across instances. Conditional writes and unique IDs block simultaneous overlapping claims; refunds use the originating drop ID so they cannot clear a newer cooldown.
- Cooldown status is read-only: checking does not consume or renew anything.

## Release selection and rights

Development player drops choose the newest active non-test global release, or fall back to active `test-s1-r1` if no non-test release is available. This is a temporary selection rule until owner activation and explicit multi-release selection are implemented. The test fixture can hatch `test-placeholder` art **only in development mode**. Real releases must use approved enabled card designs.

As before, the system is gated by `ENABLE_CARD_GAME_TEST=1` and is currently registered only for the development guild. This feature does not authorize or publish incomplete art or deploy to Wispbyte.

## Collector registration — explicit opt-in implemented

The local Card role is configured by a manager through `/cards-admin setup-role role:@Card`. The member then **must** type `.register` (or `/cards register`) in each participating server's Hatchem channel. This alone creates/reuses the global collector and assigns that server's local Card role. There is no role auto-assignment on join or from collecting cards.

Regular player drops and player-egg grabs are gated on explicit registration in the **current** server. The bot checks the global `CardCollector.registeredAt` plus the current guild in `registeredGuildIds`; having pre-existing cards, or being manually assigned a Card role, doesn't bypass registration. Test drops and their test entries stay separate for development.

Refer to `docs/hatchem-registration.md` for behavior and test cases.

## Replit test checklist

1. Stop older development processes; pull `feature/card-game-foundation`, run `npm test`, then `node register-commands.js` and `npm start`. Keep `ENABLE_CARD_GAME_TEST=1`, `DISCORD_GUILD_ID`, and the separate development bot token set.
2. Verify the seeded development release `test-s1-r1` is active and has eligible card art, and the Hatchem channel is configured.
3. Player runs `.register` and receives the configured local Card role, then types `.cooldowns`: both should say Ready now before use.
4. Player types `.drop`: exactly one 3-card egg appears, and `.cooldowns` shows next global drop in 15 minutes.
5. Player immediately tries another `.drop`: no second egg appears; it shows the remaining global time.
6. A different member enters with Grab: `.cooldowns` in that server now shows five minutes. Repeated entry should be refused.
7. When the draw settles, check that winners keep a five-minute cooldown and losing entrants become Ready now. Verify card IDs are minted only for winners.
8. Start another egg, let a guest enter one slot, then let the creator choose that slot. Guest's cooldown must be refunded and they should be able to choose another slot.
9. Test drop, grab, restart recovery, and simultaneous interactions in **two servers and two accounts**. Confirm drop limit follows the player globally but grab limit is separate per guild. Follow the saved multi-account test checklist.
10. Confirm `/cards test-drop` stays owner-only and does not spend either normal player drop cooldown or participants' grab cooldowns.

Do not merge the Card Game Foundation PR into `main` or deploy Wispbyte without explicit user approval.
