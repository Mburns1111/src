# Hatchem card trading — development

**Location:** configured Hatchem channel only. **Account eligibility:** both traders must explicitly `.register` in the same server. **Access:** development branch `feature/card-game-foundation`, gated by `ENABLE_CARD_GAME_TEST=1`. No Wispbyte deployment.

## How players trade

1. Type `.trade @member` or use `/cards trade member:@member`. The bot posts a **public embed** showing both players and their offers.
2. Each user has their own **Add/Edit Player 1** / **Add/Edit Player 2** button. Clicking their own button opens a modal. Enter five-character card IDs, separated by spaces, commas, or new lines. There is **no arbitrary five-card limit**: the panel is paginated and larger offers can be appended in batches by starting a modal input with `+`. Add a line `tag:cute` or `tag:Very Cute` to select all owned cards with a tag previously saved through `.createtag`. Reopen Add/Edit to change or remove cards. Blank input clears that user's offer.
3. The panel displays offers **side by side**, paginated four cards per side per page, with member names on each Add button. Card details include ID, name, rarity, release, stage, frame, artist where available, and reviewed base-pet value. Personal tags are cleared when cards change hands.
4. **Values:** the catalog stores an optional `CardDefinition.valueReview.valueScore` and `sourceName`. Display as a **reviewed base-pet score** if recorded, or **not reviewed** if missing. **Do not invent** real-world market values, Robux, Bucks, or Neon/Mega multipliers. Total base-pet score is labeled **incomplete** if any card has no reviewed score.
5. **Trades:** both traders press **Review (1/2)**, then both press **Final Confirm (2/2)**. Trading requires both participants to approve twice, even when one side is empty.
6. **Gifts:** `.give @member ID1 ID2` or `.give @member tag:cute` opens a **single sender-only confirmation**. Only the giver clicks Confirm Gift or Cancel Gift. The receiver does not need to press anything.
7. On success, both sets of card IDs retain their original IDs and card upgrades while the global owner IDs change together, **transactionally**. Personal tags are cleared. The completed embed has disabled/removed buttons.
8. Either player can **Cancel** before completion, or the trade expires after **10 minutes**. Expired panels are disabled by the regular card sweep, even after bot restarts.

## Data integrity

- A participant cannot edit the other's side. Nonparticipants cannot edit, review, cancel or finalize. Both participants must be members of the same guild and registered there. A user cannot trade with themselves or a bot.
- At least one side must contain owned cards. An empty opposite side is allowed for gifts, using `.give @member CARDID CARDID` or `.give @member tag:cute`. There is no five-card cap; offers can be added in batches, and each card ID can appear once.
- Version-checked trade edits prevent concurrent offer changes from silently preserving old approvals.
- At final confirmation, **MongoDB transaction** rechecks each card's ownership and `state=owned`. Any card consumed, burned, sold or traded elsewhere aborts **the entire transaction**. Concurrent attempts cannot transfer the same card twice. Final trade status and card ownership changes commit together.
- No card data is transferred or lost when a trade is cancelled or expires. The `CardTrade` record keeps the completed card IDs and participants as an audit trail.
- Owner-only release permissions, player drop cooldowns and per-server grab cooldowns are independent of trading.

## Ready for manual testing

Use the complete checklist in `docs/hatchem-complete-two-account-test-plan.md`, including your previously pending **registration, drops/grabs, tags, Neon upgrades, artwork/release controls, and multi-server tests**.

The full two-account trade cycle must be validated from two actual Discord accounts before this is considered live-ready. Source automated tests do **not** prove Discord UI or network behavior.

## Explicit tag creation

All new tag assignments and trade/gift tag selectors require a tag saved using `.createtag NAME`. Earlier versions automatically saved tag names when `.tag` was used, so older names must be explicitly saved once again before applying them. Previously tagged cards retain their labels and remain filterable.
