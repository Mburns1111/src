# Hatchem — progression, protection, trade history and card sharing

**Development-only branch:** `feature/card-game-foundation`. All changes remain out of `main` and Wispbyte. After pulling, use `npm test`, `node register-commands.js`, then start the Replit dev bot. New public slash subcommands are added ONLY to the configured test guild.

## 1. Dust-assisted upgrades

- Normal upgrades still work with **four matching physical copies**: `.upgrade CARDID`.
- Use `.dustupgrade CARDID` or `.upgrade CARDID dust` when you own **one, two, or three unlocked physical copies** of the same pet, release, and stage. The bot selects the matching copies and previews exactly what would be consumed.
- `/cards upgrade card:CARDID use_dust:true` or `/cards dustupgrade card:CARDID` offers the same operation via slash commands.
- The minimum is **one real card**. Dust cannot conjure a pet you never acquired. Four physical copies must use the ordinary upgrade, without dust.
- Each missing **Normal** card costs matching-rarity dust: Common **2**, Uncommon **2**, Rare **3**, Ultra-Rare **3**, Legendary **4**. Each missing **Neon** costs five times that: **10 / 10 / 15 / 15 / 20** dust per missing Neon, respectively. Burn rewards are unchanged: **1 / 5 / 23** dust for Normal / Neon / Mega Neon.
- The owner must confirm within 90 seconds. Within one MongoDB transaction: recheck all physical copy IDs are still owned, unlocked, and matching; conditionally subtract the exact rarity dust; consume the real copies; mint the new Neon/Mega with a new public ID; and write a lifecycle audit entry including dust spent. If any step fails, **none** of the cards or dust changes.
- Cancel has no effect. Re-clicking an old confirmation cannot debit dust twice.
- Locked cards cannot be selected or consumed by either upgrade type.

## 2. Card locks

- `.lock CARDID` or `/cards lock card_id:CARDID` permanently marks a currently owned card as **locked**.
- `.unlock CARDID` or `/cards unlock card_id:CARDID` removes the protection.
- **Locked cards cannot be burned (even if tagged burn), offered in a trade, gifted, or consumed in either type of upgrade**. Lock state is rechecked by each atomic ownership transaction, so locking a card after an offer or burn/upgrade preview also stops it.
- Locks are per-copy and persist across bot restarts, tags, and other cards. They show as **🔒** in `.collection`.
- Other members cannot lock/unlock your cards. Calling `.lock` twice is harmless; unlock also remains idempotent.

## 3. Gift and trade history

- `.history` / `/cards history` shows the last 12 **completed** transfers the user participated in. Lists **sent and received card IDs**, date, partner, and whether it was a gift sent, gift received, or normal trade.
- Data comes from the already-persisted `CardTrade` records, including previously completed gifts/trades. No new duplicate transfer-history store or migration is required.
- Cancelled, expired, and still-open offers are omitted. You can only fetch your own history.
- Personal tag labels are cleared by completed transfers as before, and history retains the actual original public IDs.

## 4. Achievements

- `.achievements` / `/cards achievements` shows ten milestones: First Hatch (1 grab), Egg Enthusiast (10 grabs), Dedicated Collector (50 grabs), Generous Heart (1 gift sent), Gift Giver (5 gifts sent), Trading Partners (1 completed trade), Trade Expert (10 completed trades), First Sparks (1 burned card), Neon Alchemist (first Neon upgrade), Mega Magic (first Mega upgrade).
- Progress derives from MongoDB `CardClaim`, completed `CardTrade`, and lifecycle records. Existing activity therefore counts.
- Earned achievements are written once to `CardAchievement` with a unique collector+key index. **Badge recognition only** in this phase; it does not grant server points or change card ownership/dust. The command refreshes milestones from actual activity when opened.
- Users can view progress toward unearned badges.

## 5. Public card sharing

- `.show Pet Name` searches the pet catalog's existing CardDefinition releases and posts a standard card preview **publicly in the Hatchem channel**, without claiming the member owns it. The display card is clearly a preview, not a minted ID.
- `/cards show pet:...` provides **native Discord autocomplete** with matching pet name, rarity and release, helping disambiguate names; entering a longer name also works.
- Discord does not support native autocomplete while typing free-form `.show` text. Ambiguous typed queries return potential matching pet names and suggest `/cards show` for selection.
- The artwork shown comes from approved/configured card assets where available. A test release may still show the existing placeholder until art is approved.

## 6. Public Hatchem inventory dashboard

- Type `.inventory` or use `/cards inventory` **inside the configured Hatchem channel**. Both post an ordinary **public** inventory embed; no private response or DM is used for the inventory.
- The dashboard shows the requesting member's **Extra Grabs, Extra Drops, owned total (Normal/Neon/Mega Neon), server Points, and five rarity dust balances**. Card counts exclude cards that were burned, consumed, or transferred away.
- Bonuses, card ownership, and dust follow the collector across servers; Points come **only from this Discord server**. The snapshot refreshes each time the command is run, rather than automatically updating old messages.
- The public inventory has three buttons: **Collection** opens that member's existing public, interactive collection browser; **Achievements** opens their existing **private** achievements screen; and **Hatchem Shop** opens their existing **private** purchase menu. Only the inventory owner can operate the buttons. Others can run their own `.inventory`.
- Discord allows at most 25 `/cards` subcommands. To add `/cards inventory`, the redundant `/cards tag-multiple` shortcut was removed. Use `/cards tag tag:NAME card_ids:ID1,ID2` instead, or the existing typed `.tagmultiple` alias. No underlying bulk-tag functionality was removed; `/cards untag-multiple` remains.
- After updating the development branch, run `node register-commands.js` again so Discord sees the new slash option. No production release or merge was performed.

### Discord inventory checks

- [ ] After purchasing one Extra Grab and one Extra Drop, `.inventory` in Hatchem shows both updated balances and the server Points balance reduced by 30.
- [ ] `/cards inventory` posts visibly in Hatchem, rather than responding ephemerally.
- [ ] Burn or gift a test card, then run `.inventory` again. Only **currently owned** cards count; totals and stages match `.collection`.
- [ ] Compare all five dust balances against `.dust`; compare extras against `.shop`.
- [ ] Press Collection on your own inventory: it opens a public collection with functioning filters. Press Achievements and Hatchem Shop: their detailed screens open privately, as before.
- [ ] Another member pressing any of the three inventory buttons is refused privately and cannot edit/open the original owner's screens.
- [ ] Re-run inventory from a second server (if available): global card/dust/bonus counts match, but Points reflect that server's wallet.

## Fresh two-account testing sequence

- [ ] Both users run `.history` and `.achievements` **before** trying new activity; existing completed gifts and grabs should appear correctly.
- [ ] Lock one card. Confirm the 🔒 indicator in `.collection`. Try `.burn CARDID`, `.give @B CARDID`, and adding the ID to a trade—each must refuse.
- [ ] With one locked and three unlocked matching cards, ordinary `.upgrade` cannot consume the locked fourth. `.dustupgrade` may use unlocked copies and correctly quote a missing-card cost.
- [ ] Unlock the card and confirm it can be offered or upgraded again.
- [ ] Check `.dust`. Use `.dustupgrade CARDID` on 1–3 matching copies; check the exact pet, IDs, missing count, rarity and cost in the preview.
- [ ] Cancel. Verify original cards and dust remain intact.
- [ ] Repeat and confirm. Verify one correctly upgraded copy appears, only the listed originals are consumed, and the rarity dust decreased by exactly the displayed amount.
- [ ] Attempt a dust upgrade without enough rarity dust, with a locked card, with a Mega, and with four copies: each should explain the refusal and change nothing.
- [ ] Open a dust upgrade preview, then gift/lock one selected copy before confirming; confirmation must fail without charging dust or consuming any cards.
- [ ] Make a new gift and trade; both users' `.history` should show their respective sent/received original card IDs. Open/cancelled trades must not appear.
- [ ] Open `.achievements` again; earned achievements should reflect previous grabs, gifts, trades, burns and upgrades. Repeated calls must not give duplicate awards or change Points.
- [ ] Run `.show Abyssinian Cat`; a public image should appear. Try a partial ambiguous pet name to see suggestions, and `/cards show` autocomplete.
- [ ] Have Account B try `.lock` on an ID owned by Account A. Must refuse.
- [ ] Verify all changes persist after restarting the development bot.

**Note:** This checklist is pending Discord testing. Passing automated Node tests does not confirm the actual Discord UI, live MongoDB transactions, or guild command registration.
