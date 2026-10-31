# Hatchem — Discord testing after October 30 changes

Development bot and test server **908522799285538817** only. Two accounts: **A = Lilly**, **B = Jentho**. Keep all production deployments and merging separate.

## Observed in screenshots before these fixes

- **PASS (before update)** — An unregistered account tried `.drop` and received a registration reminder.
- **PASS (before update)** — A registered player used `.drop` and got a three-card egg with Grab buttons.
- **PASS (before update)** — `.cooldowns` displayed the drop timer and per-server grab timer.
- **PASS (before update)** — A public two-person trade panel opened and accepted a card offer. Attempted Review with the opposite side empty was refused (changed now: gifts allowed).
- **PASS (before update)** — `.collection` listed owned cards and `.tag` applied a tag to one card.
- **BUG (fixed in code, needs retest)** — Drop was allowed after local Card role was removed.
- **BUG (fixed in code, needs retest)** — Drop sent a redundant extra reply below the egg.
- **BUG (fixed in code, needs retest)** — Collection showed only eight cards per page.
- **BUG (fixed in code, needs retest)** — Tagging with an uncreated tag, such as `noooo`, succeeded.
- **NEEDS RETEST** — Trade UI was difficult to read and the receiver had no cards, preventing final-confirmation testing. Two-column gift UI added.
- **NEEDS RETEST** — Owner test-drop release autocomplete and owner-only command visibility.

## Short two-account verification — perform in order

### A. Register and permissions

- [ ] Remove B's Card role, then type `.drop` as B. It must refuse and link the **actual #hatchems** channel. No cooldown should be spent.
- [ ] B runs `.register`: Card role is granted. Run twice and verify no duplicate account or loss of cards.
- [ ] B can then `.drop`. Only the egg image, cards, and Grab buttons appear: **no second bot reply** underneath on success.
- [ ] Repeat the role removal, but try a Grab button and `.trade @A`: both must refuse until B re-registers.
- [ ] Registering or joining another server must not automatically give the role there. The same global collection follows B.

### B. Drops and grabs

- [ ] A drops twice quickly: the second attempt shows the remaining **15-minute global cooldown**.
- [ ] B clicks a card and then checks `.cooldowns`: five minutes in that server.
- [ ] B attempts to grab a second player-egg card before cooldown ends: refused.
- [ ] A and B compete for a card: verify the winner gets one ID, loser gets their grab opportunity back.
- [ ] A as drop creator displaces B from a slot: B can choose another slot if still open.
- [ ] Test two servers: drop cooldown is global; grab cooldowns are **per-server**.
- [ ] Restart the bot mid-cooldown and verify neither timer resets or awards duplicate cards.
- [ ] Owner-only `/cards-owner test-drop` auto-suggests active test releases and does not spend cooldowns.

### C. Gifts — **giver confirms once; recipient never confirms**

- [ ] A runs `.give @B CARDID` and sees a compact single-sided card summary with Send Gift / Cancel / View Cards.
- [ ] B cannot confirm or cancel A's gift. Only A can press Send Gift.
- [ ] A presses Send Gift **once**: card transfers immediately to B and retains its original ID, rarity, upgrade stage and release. Old personal tag clears.
- [ ] `.give @B ID1 ID2` sends multiple cards with one sender confirmation; Cancel moves nothing.
- [ ] `.give @B tag:cute` selects all owned cards carrying a **created** tag. Uncreated tag names must be rejected.
- [ ] Completed gift receipt no longer warns about cards being "no longer owned." Expired gift confirmation cannot move cards.
- [ ] The recipient does not need to click, approve, or add cards.

- [ ] View Cards displays a private list of complete gift details, with working pagination when sending many cards. Public gift panel stays short and cute.
- [ ] After completing the gift, the old panel shows a compact Gift Sent receipt and the public Gift sent announcement remains visible.

### D. Trade panel

- [ ] A types `.trade @B` after B has cards. Panel has **A and B displayed side by side**, clear separator lines around confirmation progress, and Add buttons labelled by their Discord display names.
- [ ] Both players can add cards only on their own side.
- [ ] Add 6+ IDs to a single offer: no five-card limit; use Next/Previous to view additional cards.
- [ ] In Add/Edit enter `tag:cute` on its own line to select every owned card carrying that created tag.
- [ ] To add more cards to a large offer, put `+ ID1 ID2` in Add/Edit to **append**; omit `+` to **replace** the offer.
- [ ] Check that rarity, stage, IDs, release, frame and base-pet value appear correctly; unknown values read **Not reviewed**.
- [ ] One member changes an offer after Review: both Review and Confirm indicators reset.
- [ ] Both Review, then both Final Confirm: **no transfer until all four approvals**.
- [ ] A third member cannot edit, cancel, approve, or redirect another player's trade.
- [ ] An expired/cancelled trade does not change ownership. A card offered in two simultaneous trades cannot be transferred twice.

### E. Collections and tags

- [ ] `.collection` shows **10 cards per page**; with 18 cards it should have two pages.
- [ ] `.collection cute` and `.collection @B cute` filter accurately.
- [ ] `.view CARDID` displays the correct image.
- [ ] Try `.tag noooo`, `.tag random`, `.tag bunny`, or **any other uncreated name**: all refuse with an instruction to `.createtag NAME`. No cards change. Previously auto-created legacy names also require an explicit `.createtag` once.
- [ ] Run `.createtag noooo` then `.tag noooo`: it now works. The rule is **every tag name, not just noooo**. If you want to keep using old `cute` tags, run `.createtag cute` once; existing labels on cards are preserved.
- [ ] `.createtag Very Cute` followed by `.tag Very Cute 2D Doggy` works without quotation marks.
- [ ] Tag one ID, all owned copies of a pet, and several explicit IDs. Confirm the selection counts.
- [ ] `.untag` always asks for confirmation and shows the number of affected cards. Cancel leaves tags unchanged.
- [ ] A cannot tag B's cards, and B cannot approve A's private tag confirmation.

### F. Owner permissions and remaining advanced tests

- [ ] After `node register-commands.js`, regular users do not see test-drop/artwork subcommands in public `/cards`.
- [ ] Owner management lives under `/cards-owner`, registered **only in the configured test guild**, and defaults to hidden from normal members. Discord administrators may still see the restricted command, but owner-ID checks must prevent execution.
- [ ] `/cards-owner test-drop` suggests valid test releases while typing.
- [ ] An ordinary server administrator cannot create/inspect global releases or alter owner-only artwork.
- [ ] Four matching Normal cards upgrade to Neon; four matching Neon cards upgrade to Mega; warning about losing decorations is displayed.
- [ ] Cancelled upgrades and double-clicked confirmations never duplicate or partially consume cards.

### G. Five-character card IDs and command names

- [ ] New cards received from drops, upgrades, and gifts have **five letters/digits** with no hyphens or underscores; already-owned historical IDs may retain a hyphen or underscore and must still work.
- [ ] New `.createtag`, `.tagmultiple`, `.untagmultiple`, and `.deletetag` work without hyphens; older spellings are supported as compatibility aliases.
- [ ] Try an unknown tag, then run `.createtag random` and `.tag random`: the same newest currently owned card receives it. A failed tag command must not have modified card order or ownership.

## G. Burning cards for rarity dust — new feature, all Discord tests pending

- [ ] Run .burn without any ID. It should show safe usage, not burn the newest card.
- [ ] Check .dust first. All five rarity balances should display accurately.
- [ ] Run .burn CARDID. Confirm the preview shows that exact pet, rarity, upgrade stage, ID, and potential dust.
- [ ] Click Keep Cards. Verify the card remains owned and no dust was credited.
- [ ] Repeat and click Burn 1 Card. The card leaves the active collection and the matching rarity dust balance increases.
- [ ] Burn two or more untagged IDs in one confirmation. The reward total must correctly combine their rarities.
- [ ] Tag a card **favorites** or **cute**. Burning it must be refused until it is untagged using the existing confirmation.
- [ ] Create `.createtag burn`, apply it to several owned cards, then run `.burn tag:burn`. The preview must list exactly the burn-tagged cards, with no untagged or other-tag cards selected.
- [ ] `.burn tag:cute`, `.burn tag:burned`, and `.burn tag:burn ID1` must all be refused; only the exact `tag:burn` selector is accepted.
- [ ] Run `.burn CARDID` on a card tagged `burn`; it should be eligible without untagging. Cancel once to ensure nothing changes.
- [ ] Try burning an ID belonging to another user, a duplicated ID, or a malformed ID. All must be rejected.
- [ ] Account B attempts to confirm Account A's burn. It must not change any cards or balances.
- [ ] Try the same confirmation twice or restart the bot and reuse the old button. No double reward.
- [ ] Offer a card in a trade, then burn it before confirming the trade. The trade must fail without partially transferring cards.
- [ ] Burn a Normal, Neon and Mega of the same rarity when available: rewards are **1, 5 and 23** rarity dust respectively.
- [ ] Confirm .stats on another copy of the same pet/release shows completed burns in its lifecycle count.

## Not implemented yet

- Final owner activation/retirement of real global releases.
- Actual per-copy decorative frame equipment or adjusted Neon/Mega market values.
- Spending dust for upgraded-card substitutions and Points-based boosts. Burning for dust is implemented in development, with Discord testing still pending.

Keep unchecked items pending until observed in Discord. Automated CI tests validate code but do not substitute for these two-account tests.
