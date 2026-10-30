# Hatchem — Full Two-Account Discord Testing Checklist

**UPDATE (October 30):** Use the shorter, current `docs/hatchem-oct30-discord-test-checklist.md` for the latest commands and screenshot-based results. This older plan reflects the original five-card trade limit and two-sided mandatory offers; both requirements have changed.

**Saved:** 2026-10-29. **Branch:** `feature/card-game-foundation` (development only). **Test guild:** 908522799285538817. Do not merge or deploy to Wispbyte until separately approved.

## Preparation / Replit (Account A = owner, Account B = test member)

- [ ] Stop the old bot process in Replit, pull the development branch, run `npm test`, re-register slash commands, then start only one bot process.
- [ ] Confirm `ENABLE_CARD_GAME_TEST=1`, `DISCORD_GUILD_ID=908522799285538817`, and `CARD_GAME_OWNER_DISCORD_ID` is your numeric user ID, not the bot ID.
- [ ] Configure one Hatchem channel using `/setup channels hatchem`, and one local safe Card role using `/cards-admin setup-role`. The bot has Manage Roles and its role is higher than the Card role.
- [ ] Both Discord accounts can use the configured Hatchem channel. Give test Account B enough cards to trade through legitimate test drops before starting trade tests.
- [ ] Record the commit SHA, command, account, observed response, and any screenshots for failed cases.

## 1. Registration (Account A + B)

- [ ] A tries `.drop` before registering: bot says use `.register` and does not spend cooldown.
- [ ] A uses `.register`: receives the local Card role, global collector record and welcome.
- [ ] A uses `.register` again: no duplicate record, cooldown reset, or duplicate role.
- [ ] A checks `.collection`: existing cards, tags and Neon/Mega upgrades are preserved.
- [ ] A removes own Card role manually (as administrator) and runs `.register`: role is restored.
- [ ] B uses `.register` and receives their own Card role; B's collection is separate.
- [ ] B without a configured role (in another testing guild): gets a helpful error, not a false registration.
- [ ] Bot without Manage Roles or sufficient role hierarchy: registration fails safely.
- [ ] A cannot register B with an argument: `.register` only acts on the caller.
- [ ] Register in Server A only; Server B requires a separate `.register` while preserving the global collection.
- [ ] Card role does **not** assign automatically when joining a guild, browsing a collection, or grabbing a **test** drop.

## 2. Normal player drops and grab cooldowns

- [ ] A types `.cooldowns` before playing; global drop and local grab show Ready when eligible.
- [ ] A types `.drop`: one three-card egg appears in Hatchem, for a 75-second entry window.
- [ ] A tries a second `.drop` immediately: refused with the remaining time, no duplicate egg.
- [ ] B's drop cooldown remains independent of A's.
- [ ] B clicks Grab in a **player** egg after registering: slot entry accepted; five-minute cooldown starts for this server.
- [ ] B tries to enter a second card in that egg: refused and no extra card minted.
- [ ] B tries to grab in another player egg before cooldown expires: refused without losing cards.
- [ ] A (egg creator) grabs a card: creator selection takes priority.
- [ ] A displaces B from the same slot: B's grab cooldown is refunded; B may attempt another slot.
- [ ] A and B compete for an uncontested slot: at expiry, exactly one winner receives a unique five-character ID.
- [ ] Loser gets grab availability back after settlement; winner retains five-minute cooldown.
- [ ] A cannot bypass global drop cooldown by changing Discord servers.
- [ ] A can independently use a grab cooldown in Server B despite an active grab cooldown in Server A, after explicitly registering in B.
- [ ] `.cooldowns` is read-only and does not renew either timer.
- [ ] Expired grab buttons cannot award cards even if the message still appears clickable.
- [ ] After restarting the development bot, cooldowns and in-progress claims remain correct; awards are not duplicated.
- [ ] Owner-only `/cards test-drop` works without consuming ordinary player drop/grab cooldowns.
- [ ] B, even with Manage Server, cannot run owner test drops.
- [ ] Two nearly simultaneous .drop calls for A (including two servers) create at most one player egg.

## 3. Trading: interface, details and permission checks

- [ ] Both accounts explicitly `.register` before attempting a trade.
- [ ] A types `.trade @B`: a public embedded trade panel appears with both participant names and **two Add/Edit buttons**.
- [ ] Slash `/cards trade member:@B` opens the same workflow.
- [ ] The embed has separate offers for A and B, Review (1/2), Final Confirm (2/2), and Cancel.
- [ ] A can open only Player 1's Add/Edit modal; B can open only Player 2's.
- [ ] A uses Add/Edit and offers one card by five-character ID: the panel displays its pet name, ID, rarity, series, release, Normal/Neon/Mega stage, release-level frame, tag and reviewed value score where available.
- [ ] B offers one or more cards; the panel shows the correct information for **both** accounts.
- [ ] Cards with no reviewed score show **Value: not reviewed**; no invented prices, Robux or cash values.
- [ ] Totals say incomplete when any offered card lacks a reviewed value; when all reviewed, the score sum is correct.
- [ ] A adds up to 5 card IDs and sees all listed; entering a 6th refuses the entire change.
- [ ] IDs with spaces, newlines or commas work; malformed/duplicate IDs are refused.
- [ ] A attempts to offer a card belonging to B or an already-traded/burned/consumed card: rejected.
- [ ] A changes their offer using Add/Edit; the offer is replaced, not silently appended, and all approvals reset.
- [ ] A clears the modal field to remove all offered cards; neither player can review an empty-sided trade.
- [ ] A cannot trade with self, bots, or nonmembers; neither A nor B can trade before registering locally.
- [ ] C (an unrelated account) cannot edit, review, finalize or cancel the trade, or affect any card.
- [ ] Verify the trade panel cannot be controlled from another guild or a copied/custom forged component ID.

## 4. Trading: two confirmation rounds and atomic swaps

- [ ] Before both players add a card, pressing Review refuses the trade.
- [ ] A presses **Review (1/2)**: only A's review indicator changes; no card ownership changes.
- [ ] B presses **Review (1/2)**: both review indicators become checked; final confirmation is enabled.
- [ ] A presses **Final Confirm (2/2)**: only A's final indicator changes; neither inventory changes yet.
- [ ] B presses **Final Confirm (2/2)**: all cards swap owners together, exactly once.
- [ ] After trade, A and B check `.collection`: incoming cards appear with their **original unique IDs**, exact stage and release; outgoing cards disappear.
- [ ] Personal tags on transferred cards are cleared, and the previous owner's saved tag names remain intact.
- [ ] Completed trade message says Completed and has no active buttons.
- [ ] Pressing a stale confirmation again does not swap cards a second time.
- [ ] Complete first reviews, then change A or B's offer: BOTH review and final indicators reset; previous approvals cannot finalize the edited offer.
- [ ] Either participant presses Cancel before completion: trade closes without transferring any cards.
- [ ] After 10 minutes, an incomplete trade expires and cannot be confirmed. Bot sweep removes active buttons, including after restart.
- [ ] Open two concurrent trades including the same offered card: only the trade that validly completes can move it; the other must fail safely.
- [ ] Offer a card, then consume it in an upgrade or transfer it elsewhere before final confirmation: trade fails with **no partial transfer**.
- [ ] Try two simultaneous final confirmations: at most one completed ownership swap.
- [ ] Restart Replit mid-trade; review/offer state persists in MongoDB; expired trades close; no card moves without all four approvals.
- [ ] If a card has a tag, different upgrade stage or special frame, all current attributes are displayed accurately. Per-copy decorative frame equipment is **not yet implemented**; the display currently shows release frame.

## 5. Collection, tagging and card viewing

- [ ] `.collection` opens own collection; `.collection @B` opens B's collection without editing B's cards.
- [ ] `.collection cute` filters to the correct saved tag, including multiple owned pet copies.
- [ ] `.collection @B cute` filters B's public collection by that tag.
- [ ] `.view CARDID` renders correct card portrait (replaces older `.preview`).
- [ ] `.create-tag Very Cute`, `.tags`, and `.tag Very Cute 2D Doggy` work without quotes or case sensitivity.
- [ ] `.tag cute 2D Doggy` offers one/all choices when multiple copies exist; selecting All tags every owned copy of that pet.
- [ ] `.tag cute CARDID` offers **Only this ID** versus **All copies** if duplicates exist.
- [ ] `.tag cute ID1 ID2 ID3` tags only the listed card IDs after count-based confirmation.
- [ ] `.untag 2D Doggy` shows the exact affected total and asks for confirmation; Cancel changes nothing.
- [ ] `.untag CARDID` and `/cards untag-multiple` also require confirmation.
- [ ] Other accounts cannot press A's tag/untag confirmation buttons or control A's collection browser.
- [ ] Expired tag confirmations and cards traded away before tag approval cannot overwrite ownership or apply tags incorrectly.
- [ ] Cards received in a trade can be tagged by the new owner and no longer altered by the old owner.

## 6. Upgrades, stats and first releases

- [ ] With four matching Normal cards of the SAME pet, release and stage, `.upgrade` previews the exact four IDs.
- [ ] Upgrade confirmation explicitly states **all decorative frames on consumed cards are removed** and do not transfer.
- [ ] Cancel upgrade changes nothing; confirm creates one new Neon ID and consumes the four originals.
- [ ] With four matching Neon cards, upgrading creates one Mega Neon; stage/release mismatches are rejected.
- [ ] A second member cannot approve A's pending upgrade.
- [ ] `.stats CARDID` reports appropriate collectors/burn/upgrade statistics.
- [ ] Owner-only `/cards-owner create-series`, `create-release`, `add-pet`, `add-pets`, `inspect`, `set-weight`, `set-odds` and `release-check` work with autocomplete.
- [ ] Rarity percentages must total 100; duplicate pets and missing official rarities are rejected.
- [ ] A draft egg cannot be hatched as a real active release without owner activation and approved art.
- [ ] Owner-only artwork upload/review/assignment cannot be used by a server administrator.
- [ ] Verify no unauthorized command grants access to owner-only global release rosters.

## Deferred / NOT implemented yet

- [ ] Owner activation, pause and retirement of real global egg releases.
- [ ] Finalized market value review for every pet; trade UI shows reviewed scores or **unrated**.
- [ ] Per-copy frame/decorative equipment and corresponding trade presentation.
- [ ] Burning for dust, purchased extra drops/grabs and other Points integration.
- [ ] Cross-server multi-account load and failure/recovery testing before production.

**Important:** These are **pending manual tests**, not claims that the Discord behavior has been verified. Automated unit tests are separate. Run all checks on the Replit development bot, not Wispbyte.
