# Hatchem registration — explicit member opt-in

**Development branch only; not merged/deployed to Wispbyte.**

## Member workflow

1. A server manager sets up the Hatchem channel with `/setup channels hatchem` and sets its local collector role with `/cards-admin setup-role role:@Card`. The bot needs `Manage Roles`, and its role must be above the selected Card role.
2. A member explicitly types `.register` in **that server's Hatchem channel**, or uses `/cards register` there. **No automatic registration or role assignment on member join**.
3. The bot validates its role permissions, assigns the configured **local** Card role, and creates or upgrades the user's **global** `CardCollector` record. The registration event adds that server's ID to `registeredGuildIds` and sets `registeredAt` if it was previously unset.
4. The member can use `.drop` (15-minute **global** cooldown), grab cards in that server (5-minute **per-server** cooldown), `.cooldowns`, and their existing global collection.
5. If they join a second participating server, they must explicitly run `.register` **there too**. Their inventory, tags, upgrades and dust stay global, while the Card role and registration eligibility are recorded separately for each server.

Re-running `.register` does not create another collector, reset drops/grabs/cooldowns, or erase previously collected cards, saved tags, or dust. It repairs a missing local Card role if it was removed. Old testers who earned cards before this change keep those cards but must opt in with `.register` to participate in **regular player** drops/grabs.

## Security and permissions

- Only `.register` / `/cards register` assigns the locally configured Card role. It is **not** assigned automatically when a member joins, drops an egg, grabs a test card, or receives a card.
- Roles are rejected if missing, integration-managed, `@everyone`, or Administrator-enabled. The bot refuses when it lacks `Manage Roles` or proper hierarchy.
- If role assignment fails, it does not mark the player as registered. If MongoDB persistence fails, it attempts to roll back a newly granted role.
- Each member can register only their **own** Discord identity through an interaction or typed command; no user ID is accepted as an argument.
- Member drops and member egg grabs check `registeredAt` and `registeredGuildIds` before claiming cooldowns. A Card role granted manually by an administrator, or an old test-award collector record, does not bypass explicit registration.
- **Owner-only test drops** and their test-entry flows stay separate, to avoid interrupting test fixtures.

## Discord tests

- [ ] Run `.drop` **before** `.register`: should tell the player to register; should not spend the drop cooldown.
- [ ] Run `.register` before configuring a Card role: should show a helpful setup error and not record registration.
- [ ] Set the role with `/cards-admin setup-role`, then run `.register`. Card role appears and welcome message offers `.drop`, `.cooldowns`, `.collection`.
- [ ] Run `.register` a second time: already-registered message, no duplicate account or loss of cards.
- [ ] Remove the Card role manually, then run `.register` again: role is re-granted.
- [ ] An existing tester with cards registers: existing cards remain and they can now drop.
- [ ] Try `.register` in a different participating server: that server grants only its own configured Card role, with the same global collection.
- [ ] Try player `.drop` or grabbing in server B before registering in B: denied without spending a cooldown.
- [ ] Turn off bot Manage Roles or move the bot role below Card (development server): registration fails safely without marking the account as registered.
- [ ] Test concurrent/duplicate requests and failed Discord role updates with multiple accounts.

Registration is only a prerequisite for **member gameplay**. Global release activation and production launch are later stages; all currently applied work remains in `feature/card-game-foundation`.
