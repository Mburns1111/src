# Hatchem — pending Discord tests requiring multiple accounts

Saved 2026-10-29 on the development branch. **Manual results are not recorded as passed unless explicitly evidenced.** This is a holding checklist for when additional test Discord accounts are available. Use development bot only, do not deploy production.

## Confirmed observations from owner screenshots (single account)

- `/cards-owner create-release` with `series:series-test-1` returned 'Create the series first'. The parent series must be created with `/cards-owner create-series id:series-test-1` before creating the release; no release was created by that failed command.
- `.collection` displayed an owned collection and card IDs, and the `cute` tag was visible on one Abyssinian Cat.
- `.tag cute 2d do` previously returned 'No pet matches that name'. Parser fixes are committed but require fresh Discord testing.
- Owner reports most other single-account commands work; specific checked boxes from the in-chat checklist are not accessible in this file, so unverified cases remain pending.

## Pending after update — primary account

- [ ] Re-register slash commands on the development bot and confirm `/cards view` replaces `/cards preview`.
- [ ] `.view KxQOo` and `/cards view` open the intended card image.
- [ ] `.collection cute` opens a filtered collection and displays only copies tagged `cute`; `.collection @member cute` works as intended.
- [ ] `.tag cute 2d do` shows copy count, ID/stage/release/frame details, and 'all' or 'one' selection when multiple 2D Doggys are owned.
- [ ] Choosing a single card ID affects only that copy; choosing All applies to every currently owned copy of the named pet. Other pets must remain unchanged.
- [ ] `.tag cute KxQOo`: if the owner has other copies of the same pet, the bot asks **Only KxQOo** versus **All copies**; select only KxQOo and verify no other IDs change. If only one copy exists, the ID is tagged directly.
- [ ] `.tag cute KxQOo Abc12 Def34` asks for confirmation with the number of owned IDs that would change; confirmation tags only those IDs.
- [ ] `.create-tag Very Cute` followed by `.tag Very Cute 2D Doggy` recognizes the full saved tag name without quotes; confirmation changes only the expected pet copies.
- [ ] If `Very` and `Very Cute` are both saved, `.tag Very Cute KxQOo` selects the longer `Very Cute` tag without quotes.

- [ ] `.tag Very Cute 2D Doggy` accepts tag names and pet names containing spaces.
- [ ] Entering an unknown or someone else's ID in a multi-ID batch changes none of the cards.
- [ ] `.untag 2D Doggy` requires confirmation with number of affected cards before changing tags; selecting Cancel leaves all existing tags in place.
- [ ] `.untag KxQOo` requires confirmation; if multiple matching pet copies exist, compare **Only this ID** and **All copies**. Verify displayed affected-card count matches cards that actually have tags.
- [ ] `/cards untag-multiple` also shows the affected-card count and requires confirmation; Cancel must not change any tags.
- [ ] Old/expired tag confirmations and changed card ownership/tags fail without overwriting new changes.
- [ ] `/cards-owner create-series` followed by `create-release` succeeds, and autocomplete offers already-created series/release IDs and catalog pets.
- [ ] Upgrade confirmation explicitly warns that decorations/frames on consumed cards will not transfer.

## Requires two or more Discord accounts

- [ ] Only the configured owner ID can inspect release rosters and access `/cards-owner` management; another server Administrator/Manage Server member is rejected.
- [ ] Non-owner server manager can configure `/cards-admin setup-role` only in their own server, without changing global releases.
- [ ] Non-owner server manager cannot use test drops or card-artwork upload/list/review/assign.
- [ ] Non-owner trying to press the original owner's tag confirmation button or select menu gets a private error and cannot modify the owner's response or cards.
- [ ] Another member can browse `.collection @member` / `/cards collection member` publicly but only the opener controls that interactive collection menu.
- [ ] With two entrants selecting the same open drop card, determine that only the correctly selected guest wins and receives a unique card ID.
- [ ] When the drop creator chooses a contested slot, earlier entrants are released and may enter another slot; creator receives their chosen card.
- [ ] Two guests cannot enter more than one slot in one egg, including simultaneous requests.
- [ ] On drop expiry, repeated settlement or bot restart does not duplicate copies or grant more than one winner per slot.
- [ ] Confirm that another user cannot confirm, cancel, or redirect somebody else's pending Neon upgrade.
- [ ] Two users' global collections remain distinct across participating servers.

## Explicit collector registration — multi-account testing (added October 29)

- [ ] An unregistered member's `.drop` is denied with `.register` instructions; no cooldown spent.
- [ ] After admin sets `/cards-admin setup-role`, a member can run `.register` to receive only the local Card role and create a global collector account.
- [ ] Running `.register` twice does not duplicate anything, reset cooldowns, or overwrite cards/tags/dust.
- [ ] An old test collector with existing cards has to run `.register` once to participate; all old cards remain.
- [ ] When a member registers in Server A, they cannot use player drops/grabs in Server B until they explicitly run `.register` in Server B. Each server grants its own Card role.
- [ ] A normal role manually granted by a manager does not count as explicit collector registration.
- [ ] Failed role assignment (missing Manage Roles/bot hierarchy) does not register the user.
- [ ] Attempting registration for someone else is impossible: `.register` does not accept a target account.
- [ ] A manager cannot configure a Card role with Administrator permission.
- [ ] Membership joins must never automatically assign Card roles; a player must register themselves.

## Development player-drop and grab cooldown tests (added October 29)

- [ ] Two accounts in the same guild can use `.drop` independently; each gets a 15-minute personal cooldown.
- [ ] A member cannot drop again immediately or bypass the 15-minute cooldown by using another guild; another member is unaffected.
- [ ] `.cooldowns` reports the exact drop availability globally and grab availability for the current server, without consuming either.
- [ ] A valid grab entry reserves the five-minute cooldown in that server; another grab in that server is blocked while active.
- [ ] The same member may grab in Server B even with a five-minute grab cooldown active in Server A.
- [ ] Losing an egg draw refunds the grab cooldown after settlement; winners retain the five-minute cooldown.
- [ ] Creator choosing a contested slot releases displaced entrants and refunds their grab cooldown immediately so they can choose again.
- [ ] A failed, expired, duplicated, or invalid grab does not spend a cooldown.
- [ ] Two simultaneous drop commands in separate servers create at most one member egg.
- [ ] A bot restart does not reset a live drop or grab cooldown, double-mint a winning copy, or leave a losing entrant's cooldown permanently reserved.
- [ ] Owner-only `/cards test-drop` does not consume regular player cooldowns and remains inaccessible to other administrators.

## Deferred — features not yet ready for Discord tests

- [x] Normal player `.drop` cooldown code wired on the development branch; **Discord multi-server testing still pending above**.
- [x] Grab cooldown code wired on the development branch; **Discord multi-server testing still pending above**.
- [x] Explicit `.register` now assigns the locally configured Card role in the development branch; **Discord tests above still pending**.
- [ ] Global release activation/retirement with approved-artwork readiness checks (not yet implemented).
- [x] Player-to-player trading code implemented on development branch (double-confirm, atomic transfers); **two-account Discord tests still pending**. See `docs/hatchem-complete-two-account-test-plan.md`.
- [ ] Burning, spending dust, and purchases remain unimplemented.

## Test report format

Record the date, development commit hash, command, testing accounts, expected outcome, actual outcome and Discord/Replit error or screenshot for each failed or passed case. Leave unchecked items pending until tested.
\n## Consolidated verification plan\n\nThe full pending test checklist, including new trade safety scenarios and the earlier registration/drop/grab/collection/tag/upgrade/owner tests, is maintained in `docs/hatchem-complete-two-account-test-plan.md`.\n