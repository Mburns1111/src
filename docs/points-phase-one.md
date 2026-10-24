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


## Observation-only poll and giveaway experiment

New staff command: `/points-observe`, available only to members with **Manage Server**. Restart the Replit test bot and run `node register-commands.js` with test application credentials. The bot listens to Discord's native guild poll vote events using `GuildMessagePolls` (no privileged Message Content intent is requested).

- `/points-observe inspect link:<message URL>` — tests whether AM Isa can fetch the linked message; reports visible embeds/buttons/native poll objects without claiming participant access
- `/points-observe register type:Arclo poll link:<message URL>` — records an existing Arclo poll
- `/points-observe register type:Arclo giveaway link:<message URL>` — records an existing Arclo giveaway
- `/points-observe register type:Arclo results panel link:<message URL>` — tests an accessible, public panel message, if Arclo created one
- `/points-observe report link:<message URL>` — shows observed native voters (deduplicated across multiple answers), or states clearly that Arclo participant identities are not available
- `/points-observe list` — shows recent tracked Discord polls and registered Arclo messages

### Why Arclo message inspection previously showed zero embeds/buttons

Discord masks a third-party message's `content`, `embeds`, `components`, and `poll` fields when the app lacks the privileged **Message Content intent**. A successfully fetched message and Arclo author ID prove the channel is accessible, not that message content is exposed.

**Optional diagnostic on the isolated TEST bot:**

1. Open the **test bot's own application** in the [Discord Developer Portal](https://discord.com/developers/applications), open **Bot → Privileged Gateway Intents**, and enable **Message Content Intent** (subject to Discord eligibility/approval).
2. Set Replit environment variable `ENABLE_MESSAGE_CONTENT_INTENT=1` (do not set it on live Wispbyte).
3. Pull this dev branch, restart the test bot, then run `/points-observe inspect` on the **original public Arclo giveaway/poll message** and any separately posted public results message.
4. The inspection now reports whether the diagnostic gateway request was enabled. Compare visible embed and button counts before and after. If counts are still zero, confirm you used the test application, the toggle is enabled, and the link points to a public message rather than an ephemeral private panel.

The bot **does not store message bodies**, only visibility counts and source metadata. Message Content access might expose an Arclo public giveaway counter or results; it **cannot intercept joins/votes directed to Arclo**, expose Arclo's dashboard database, or fetch ephemeral replies visible only to the clicking member. Once tested, remove the environment variable if no longer needed.

**Native Discord polls:** Observes gateway `MESSAGE_POLL_VOTE_ADD` and `MESSAGE_POLL_VOTE_REMOVE`; one user is counted once per poll even with multiple answers. Records only events received while the test bot is running. Restarting preserves records, but absent events and votes cast before observation begins are not reconstructed. Native vote event delivery requires the app's Gateway permission and the bot remaining connected.

**Arclo polls and giveaways:** Each is registered by its *actual Discord message link*. AM Isa fetches the visible message, checks the author is another bot and matches prior Arclo sources, and records metadata only. Clicking buttons on Arclo messages sends interactions **to Arclo, not to AM Isa**. The presence of a giveaway counter, winners announcement, or a viewable panel cannot establish individual members' eligible entries or poll votes.

If you granted AM Isa's Discord role permission to view a results channel, `inspect` may successfully fetch that channel's public message. A dashboard page grant is for **human dashboard access** and is not a machine-to-machine API. If Arclo's participant panel appears only as an **ephemeral** reply when you click a button, other bots cannot fetch it at all. Never scrape another app's private interactions or impersonate members to retrieve them.

**No Points are issued by the observer.** It does not read general message text, reactions or voice chat, and does not request Discord's Message Content intent.

### Test sequence

1. Use the test application and the `feature/points-earning` branch; restart and register the `/points-observe` command.
2. Create a native Discord poll and vote once. Run `/points-observe report` on the poll's message link: expect one observed voter. Change/remove your vote and inspect again. Multiple choices must not multiply the participant count.
3. Run `/points-observe inspect` on your Arclo poll and giveaway links, followed by `register` with each corresponding type.
4. After Arclo ends the giveaway, inspect the results-panel **Discord message link**, if one exists. Note whether AM Isa can fetch it and whether embeds or buttons are exposed. Inaccessible/ephemeral results cannot be used as award evidence.
5. Check `/points-observe list`; restart the test bot and confirm registered observations remain in MongoDB.
6. Verify `/points-admin history` and wallet balance haven't changed due to these observations.

**Future integration decision:** Native polls can be a verified participation source once we add rewards and caps. Arclo entries require an official source-supported export/API or an audited manual verification process before anyone receives Points.
