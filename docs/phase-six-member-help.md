# AM Isa Help Center — current development design

The `/help` command opens a private, read-only navigation panel. No help interaction changes server configuration, profile media or public listings.

## Main menu

Choose **Public Help** or **Staff Help**.

**Public Help** topics: Getting Started, Listings & Trading, Shop & Points, Collectible Cards, Giveaways, Games & Activities, and Registered Commands. The Commands topic lists Discord-registered slash commands.

**Staff Help** groups:
- Server setup: blue **Bot Setup** button, prominently labeled as the first step.
- Giveaways: Run a Giveaway, Track Activity, Archive Records.
- Other staff tools: Hatchem Cards, Points & Shop, Party Games.

Only authorized staff can open Staff Help. The giveaway-manager role is allowed to read Staff Help, but the actual `/setup` command still requires Manage Server permission.

## Bot Setup guide

1. Mandatory **private Bot Commands** channel, hidden from `@everyone`, for staff setup and administration.
2. Public Profiles, Trading, Shop & Points channels grouped as one member system.
3. Public Hatchem channel and Collector registration role.
4. Public Party Games channel.
5. Giveaway public channels (regular, activity list, activity winners and Court's Trials) plus separate **private staff controls** and **required private archive** channels.
6. Required bot permissions, followed by setup order.

Use `/setup general` first, then feature-specific `/setup cards`, `/setup giveaways`, `/setup activity-giveaways`, or `/setup trials`. Each of the three giveaway setup flows includes the required shared private archive channel. There is no separate `/setup archives` menu option.

## Giveaway help

Run a Giveaway includes regular, activity and Court's Trial giveaways. Status colors distinguish running, pending claims, completed claims, no eligible winners, and archived records. **Claim completed is not synonymous with prize delivered.** Staff use the active private directory and staff records to manage events and archive settled records.

## Smoke-test checklist (development bot only)

1. Run `/help` and verify it stays private. Open Public Help and all seven topics.
2. Open Staff Help. Verify **Bot Setup** is the blue button and setup-first notice appears.
3. Open Bot Setup and confirm all seven sections, private commands, public vs private channels, and mandatory archive wording.
4. Open Run a Giveaway. Confirm all three types and current claim-status wording.
5. Verify ordinary members cannot access Staff Help, but access to public help remains available.
6. Use `/setup general` to choose a staff-only commands channel and verify a channel visible to `@everyone` is rejected.
7. Use each giveaway setup to choose the same separate private archive and verify it is saved and shown in the review.
8. Ensure profile/gallery media, video order, purchases and published listings remain unchanged by reading help.

No merge into `main` or Wispbyte deployment until all integration conflicts and tests are resolved.
