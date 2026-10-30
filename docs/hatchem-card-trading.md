# Hatchem card trading — development

**Location:** configured Hatchem channel only. **Account eligibility:** both traders must explicitly `.register` in the same server. **Access:** development branch `feature/card-game-foundation`, gated by `ENABLE_CARD_GAME_TEST=1`. No Wispbyte deployment.

## How players trade

1. Type `.trade @member` or use `/cards trade member:@member`. The bot posts a **public embed** showing both players and their offers.
2. Each user has their own **Add/Edit Player 1** / **Add/Edit Player 2** button. Clicking their own button opens a modal. Enter **up to five** owned five-character card IDs, separated by spaces, commas, or new lines. Reopen Add/Edit to change or remove cards. Blank input clears that user's offer.
3. The panel displays **each card separately**, with ID, pet name, rarity, series, release, Normal/Neon/Mega stage, release frame, art credit, card source/origin where present, and optional personal tag. The tag is cleared if that card changes hands.
4. **Values:** the catalog stores an optional `CardDefinition.valueReview.valueScore` and `sourceName`. Display as a **reviewed base-pet score** if recorded, or **not reviewed** if missing. **Do not invent** real-world market values, Robux, Bucks, or Neon/Mega multipliers. Total base-pet score is labeled **incomplete** if any card has no reviewed score.
5. **Confirmation 1 (review):** both traders press **Review (1/2)** after each side offers at least one card. When both have reviewed, the **Final Confirm (2/2)** button unlocks.
6. **Confirmation 2 (final):** each trader presses **Final Confirm (2/2)**. **No cards transfer until both have completed both steps.** Any change to either offer resets both users' review and final approvals.
7. On success, both sets of card IDs retain their original IDs and card upgrades while the global owner IDs change together, **transactionally**. Personal tags are cleared. The completed embed has disabled/removed buttons.
8. Either player can **Cancel** before completion, or the trade expires after **10 minutes**. Expired panels are disabled by the regular card sweep, even after bot restarts.

## Data integrity

- A participant cannot edit the other's side. Nonparticipants cannot edit, review, cancel or finalize. Both participants must be members of the same guild and registered there. A user cannot trade with themselves or a bot.
- Both offers must contain at least one card. Each offer is limited to five unique IDs. IDs must currently be owned by the person offering them.
- Version-checked trade edits prevent concurrent offer changes from silently preserving old approvals.
- At final confirmation, **MongoDB transaction** rechecks each card's ownership and `state=owned`. Any card consumed, burned, sold or traded elsewhere aborts **the entire transaction**. Concurrent attempts cannot transfer the same card twice. Final trade status and card ownership changes commit together.
- No card data is transferred or lost when a trade is cancelled or expires. The `CardTrade` record keeps the completed card IDs and participants as an audit trail.
- Owner-only release permissions, player drop cooldowns and per-server grab cooldowns are independent of trading.

## Ready for manual testing

Use the complete checklist in `docs/hatchem-complete-two-account-test-plan.md`, including your previously pending **registration, drops/grabs, tags, Neon upgrades, artwork/release controls, and multi-server tests**.

The full two-account trade cycle must be validated from two actual Discord accounts before this is considered live-ready. Source automated tests do **not** prove Discord UI or network behavior.
