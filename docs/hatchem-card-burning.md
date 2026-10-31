# Hatchem card burning — development

**Branch:** `feature/card-game-foundation`. This feature is currently enabled only where `ENABLE_CARD_GAME_TEST=1`, and it has not been merged into `main` or deployed to Wispbyte.

## Commands and safety

- `.burn CARDID` — select exactly one owned card for destruction.
- `.burn CARDID CARDID` — select multiple owned copies, up to 50 per confirmation. Every card must have a five-character public ID; old IDs containing `-` or `_` remain valid.
- `/cards burn card_ids:...` — equivalent slash command, with ID autocomplete (including adding more IDs).
- `.dust` or `/cards dust` — show the global collector's rarity-specific dust balance.
- The player must be explicitly registered in the current server and still have its configured Card role to initiate or confirm a burn.
- **No automatic burning** and **no burn-by-pet-name**. Only explicitly supplied card IDs are eligible.
- Any card with a tag is **protected** from burning. Use `.untag CARDID` first (with its own confirmation); this intentionally protects favorites.
- All selected IDs must currently be owned by the requesting user, must be distinct, and must be untagged. The confirmation shows each ID, pet name, rarity, and upgrade stage (first 12 if a large selection), the total number and the dust to be awarded.
- The owner must click **Burn N Cards** in the two-minute preview. Cancel uses **Keep Cards**, and does not change ownership or dust. Someone else clicking must get a private refusal.
- After success, copies change to `state: burned`, remain in historical records with their original unique IDs, and no longer appear in active collections. `consumedAt` records the time.
- Burning writes one `CardLifecycleEvent` record **per burned card** with event type `burn`, so `.stats CARDID` can count completed burns by card definition. All card changes, audit records and dust awards are inside **one MongoDB transaction**. A failed or repeated confirmation cannot partially burn copies or credit dust twice. Existing trade offers referencing cards burned elsewhere cannot complete after this: final trade checks card ownership and state.

## Provisional dust earnings

Dust has five separate rarity balances in the global `CardCollector` model. **The actual dust economics have not been finalized.** Until the owner decides the rewards, dev testing uses a simple conversion:

| Burned upgrade stage | Dust received in that card's rarity |
| --- | ---: |
| Normal | 1 |
| Neon | 4 |
| Mega Neon | 16 |

Example: burning two Rare Normals and one Rare Neon awards **6 Rare Dust**. Burning a Legendary Normal awards **1 Legendary Dust**.

The foundation separately proposes rarity dust *substitution* costs for upgrades; **those are not enabled** by burning. Dust cannot be spent yet. Do not present the provisional rewards as finalized market values or live game prices.

## Suggested two-account Discord tests

1. [ ] On the development bot, update from `feature/card-game-foundation`, run `npm test`, `node register-commands.js`, then start the bot. Confirm both collectors have used `.register`.
2. [ ] `.burn` with no ID shows the syntax; no card is affected.
3. [ ] `.burn CARDID` shows a confirmation with the correct card, stage, rarity, and dust reward. Before clicking, check `.collection` and `.dust`: nothing should have changed.
4. [ ] Press **Keep Cards**. Verify no card removed and no dust added.
5. [ ] Repeat and press **Burn 1 Card**. Verify the card disappears from the active collection, the correct rarity dust increases exactly once, and `.stats` for another copy of that release shows one more recorded burn.
6. [ ] Attempt to click the old confirmation again; it must not add more dust.
7. [ ] A tagged card must be refused before confirmation. Untag it using the normal confirmed untag flow, then burn it.
8. [ ] Try selecting a card belonging to the other account, a malformed ID, or the same ID twice. All must be refused without changing anything.
9. [ ] With two different untagged cards, run `.burn ID1 ID2`. Confirm the preview lists both and sums their dust by rarity.
10. [ ] Burn a Neon (4 dust) and a Mega Neon (16 dust) when available; confirm the correct rarity.
11. [ ] Have Account B click Account A's burn button. Only A must be able to burn A's cards.
12. [ ] Remove the Card role before confirming a burn; confirmation must be refused.
13. [ ] Start a burn preview, transfer one offered card to another user in a separate trade/gift, then try to burn. The whole burn must fail and award **no** dust.
14. [ ] Start a trade with a card, then burn it in another message before final trade confirmation. The trade must fail without moving other cards.
15. [ ] Let a confirmation expire (two minutes) or restart the bot during a preview; the old preview must no longer be usable.
16. [ ] Check that `.dust` is shared across servers and survives bot restarts. Collectors do not gain dust by creating, trading or gifting cards.

All tests above are pending manual Discord verification, not automatically marked complete.
