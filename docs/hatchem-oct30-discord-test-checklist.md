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

### C. Give cards (lets B test trading even with zero cards)

- [ ] A runs `.give @B CARDID`. Confirm the two-column panel shows one offered card on A's side and **zero** on B's side.
- [ ] Both press Review (1/2), one at a time. No cards should move yet.
- [ ] Both press Confirm (2/2), one at a time. Only after the last press does the card move to B.
- [ ] Verify B's `.collection` now contains that original ID, upgrade level and release. A no longer owns it. Old personal tag is cleared.
- [ ] Use `.give @B ID1 ID2` to send multiple cards and `.give @B tag:cute` to select **all cards you own with that created tag**.
- [ ] Try `.give @B tag:uncreated`: must refuse, without taking any cards.
- [ ] Cancel another gift before final confirmation: both collections remain unchanged.

### D. Trade panel

- [ ] A types `.trade @B` after B has cards. Panel has **A and B displayed side by side**, with Add buttons labelled by their Discord display names.
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
- [ ] Try `.tag noooo`, `.tag random`, `.tag bunny`, or **any other uncreated name**: all refuse with an instruction to `.create-tag NAME`. No cards change.
- [ ] Run `.create-tag noooo` then `.tag noooo`: it now works. The rule is **any tag, not just noooo**.
- [ ] `.create-tag Very Cute` followed by `.tag Very Cute 2D Doggy` works without quotation marks.
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

## Not implemented yet

- Final owner activation/retirement of real global releases.
- Actual per-copy decorative frame equipment or adjusted Neon/Mega market values.
- Burning, spending dust and Points-based boosts.

Keep unchecked items pending until observed in Discord. Automated CI tests validate code but do not substitute for these two-account tests.
