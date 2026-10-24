# Points Earning System — Phase 1

**Branch:** `feature/points-earning`. The completed Classic Shop remains unchanged on `main`. Phase 1 awards milestones only; message, voice, Arclo invite, poll and giveaway rewards are **NOT active** until later phases.

## Economy targets

Based on the cheapest **paid** items: 75 Points background + 50 panel + 125 frame + 125 font + 50 sticker = **425 Points**. Free items and Text Colors are excluded from this comparison.

The proposed Phase 2 earning budget is **425 repeatable-activity Points during a member's first seven days**, before one-time milestones, then approximately **225 Points each subsequent week**. To make 425 realistically attainable without rewarding spam, repeatable qualifying activities will earn **2× normal activity Points during the first seven days**, subject to the 425 total cap. One-time achievements are neither multiplied nor included in that activity cap. That lets a member purchase the 425-Point starter collection during week one, and then work toward an 800–1,000 Point artist item over roughly four or five further weeks after spending their starter Points. These limits are targets, **not implemented earners** yet.

Future Arclo invitations: 40 Points per successfully attributed invite, credited only after the new member stays seven days, with at most two rewarded referrals per inviter per calendar month. Arclo runs its own invite, activity and giveaway trackers. Phase 3 must confirm a verifiable data interface or admin review flow **before crediting** Arclo events; do not assume a public Arclo API exists.

## Phase 1 one-time milestones

| Key | Completion requirement | Default Points |
| --- | --- | ---: |
| shopFirstBrowse | Successfully opens their permanent private shop DM | 15 |
| profileFirstCustomization | Saves a changed, non-default appearance or uses Equip All | 40 |
| houseFirstListing | Publishes their first house listing | 20 |
| outfitFirstListing | Publishes their first outfit listing | 20 |
| tradeFirstListing | Publishes their first trade-vote post | 20 |
| tradingPostFirstPublished | Publishes their first Trading Post | 20 |
| inventoryFirstPost | Publishes their first inventory video **or** adds inventory album photos | 20 |

Updates, repeated views, edits and reposts are not rewarded again. Staff can change the amount of any milestone (0–500) or pause milestones per server.

## Ledger and credits

`PointsLedger` tracks **earning credits from Phase 1 forward**, using a unique `guildId + discordUserId + eventKey` index. Each award inserts one receipt and increments the **existing** `PointsWallet.balance` in the same MongoDB transaction. This requires a transaction-capable MongoDB deployment (as used by the Classic Shop's Purchase All).

Existing shop balances and purchases do not change. The ledger is an **earning history from rollout**, not a retroactively reconstructed history of all previous spending or manual test-balance changes.

Milestones use permanent keys `milestone:<key>`. Manual staff awards have keys tied to the specific Discord interaction ID, and record the responsible moderator and reason. A missed reward never reverses an already successfully published post or a saved profile.

## Manager commands

Use `node register-commands.js` on the test bot after deploying this branch to register `/points-admin`.

- `/points-admin settings`: current default/overridden milestone rewards and future earning targets
- `/points-admin milestone achievement:<key> points:<0-500>`: adjust the *next unclaimed* grant
- `/points-admin toggle enabled:<true|false>`: pause or restart milestone awarding
- `/points-admin grant member:<user> points:<1-250> reason:<text>`: reward member help or event participation; audited
- `/points-admin history member:<user>`: last ten earning receipts and current wallet balance
- `/points-admin backfill member:<user>`: preview previously completed milestone evidence with **no changes**
- `/points-admin backfill member:<user> apply:true`: issue only qualifying, as-yet-unclaimed milestones

These controls require **Manage Server**. The member-facing Points balance remains in the public storefront and private shop; Phase 1 adds no duplicate `/balance` command.

### Previous test balance command

`/test-points` is now **disabled and omitted from command registration by default**. If you still need it on your isolated Replit test bot, set `ENABLE_TEST_POINTS=1` and re-register commands. Never enable this unaudited balance override on the live bot; use `/points-admin grant` for legitimate moderator awards.

## Bulk backfill of existing members

A dry-run-first database script can review all member IDs present in historical bot records:

```bash
# Replit / test MongoDB, with DISCORD_GUILD_ID and MONGODB_URI configured
node scripts/backfill-points-milestones.js
# After reviewing output AND verifying database/server:
node scripts/backfill-points-milestones.js --apply
```

It scans saved permanent shop DMs, currently saved non-default appearance profiles, published house/outfit/trade posts, Trading Posts and inventory video/album posts. Because this standalone script has no Discord member gateway, **review dry-run results and do not apply rewards for accounts that have left the server**; the interactive admin backfill does verify current membership. Claims remain idempotent even if the script is rerun.

**Limitation:** deleted posts or customized profiles later reset to default may no longer have evidence. Nothing attempts to infer historical activity from untrusted text. Owners can make an audited manual award when they have other reliable evidence. Dry runs do not credit Points, and no backfill runs automatically at startup.

## Test checklist

- [ ] Register `/points-admin` in the test guild; check that regular members cannot access admin actions
- [ ] Open a new member's DM shop once; check +15 Points in the existing shop balance; opening again gives nothing
- [ ] Customize and save a visible non-default profile; check +40 once; merely opening/discarding editor gives nothing
- [ ] Publish first completed house/outfit/trade/Trading Post; grant occurs **after** a real post is stored
- [ ] Post inventory photos or video; first of either earns +20, later posts and replacements do not
- [ ] Verify manual grant receipts show member, reason, actor, and correct Points balance
- [ ] Run `backfill` without apply and confirm balances do not move; apply once and verify another apply does nothing
- [ ] Toggle milestones off and verify no awards are issued; restore on and check configured amounts
- [ ] Check existing Classic Shop Purchase All and individual purchasing still work
- [ ] Verify no message, voice, invite, poll or giveaway auto-rewards occur yet
