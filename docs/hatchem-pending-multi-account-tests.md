# Hatchem — pending Discord tests requiring multiple accounts

Saved 2026-10-29 on the development branch. **Manual results are not recorded as passed unless explicitly evidenced.** This is a holding checklist for when additional test Discord accounts are available. Use development bot only, do not deploy production.

## Confirmed observations from owner screenshots (single account)

- `/cards-owner create-release` with `series:series-test-1` returned 'Create the series first'. The parent series must be created with `/cards-owner create-series id:series-test-1` before creating the release; no release was created by that failed command.
- `.collection` displayed an owned collection and card IDs, and the `cute` tag was visible on one Abyssinian Cat.
- `.tag 2d do cute` previously returned 'No pet matches that name'. Parser fixes are committed but require fresh Discord testing.
- Owner reports most other single-account commands work; specific checked boxes from the in-chat checklist are not accessible in this file, so unverified cases remain pending.

## Pending after update — primary account

- [ ] Re-register slash commands on the development bot and confirm `/cards view` replaces `/cards preview`.
- [ ] `.view KxQOo` and `/cards view` open the intended card image.
- [ ] `.collection cute` opens a filtered collection and displays only copies tagged `cute`; `.collection @member cute` works as intended.
- [ ] `.tag 2d do cute` shows copy count, ID/stage/release/frame details, and 'all' or 'one' selection when multiple 2D Doggys are owned.
- [ ] Choosing a single card ID affects only that copy; choosing All applies to every currently owned copy of the named pet. Other pets must remain unchanged.
- [ ] `.tag KxQOo cute`: if the owner has other copies of the same pet, the bot asks **Only KxQOo** versus **All copies**; select only KxQOo and verify no other IDs change. If only one copy exists, the ID is tagged directly.
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

## Deferred — features not yet ready for Discord tests

- [ ] Normal player `.drop`: one global 15-minute cooldown per user across servers (service exists, player flow not yet wired).
- [ ] Grabs: five-minute per-user cooldown separate for each server (service exists, player flow not yet wired).
- [ ] Automatic Card role grant at collector registration (registration is not implemented).
- [ ] Global release activation/retirement with approved-artwork readiness checks (not yet implemented).
- [ ] Public trading, burning, dust, and purchases (not yet implemented).

## Test report format

Record the date, development commit hash, command, testing accounts, expected outcome, actual outcome and Discord/Replit error or screenshot for each failed or passed case. Leave unchecked items pending until tested.
