# Points Earning System — Phase 1

**Branch:** `feature/points-earning`. The completed Classic Shop remains unchanged on `main`. Phase 1 awards milestones only; message, voice, Arclo invite, poll and giveaway rewards are **NOT active** until later phases.

## Economy targets

Based on the cheapest **paid** items: 75 Points background + 50 panel + 125 frame + 125 font + 50 sticker = **425 Points**. Free items and Text Colors are excluded from this comparison.

**Current earning policy:** the 425-Point Classic starter basket is a shop price benchmark, **not a Points cap**. Qualifying activity can continue earning without a daily, weekly, or first-seven-days total limit. Messages and voice earn at **2× normal rates during a member's first seven days**, then return to normal rates. Approved native polls retain their separate 15-Point-per-week participation safeguard, but never prevent further chat or voice earnings. The older proposal of 425 Points in week one and 225 Points in later weeks has been superseded by this uncapped policy; see `docs/points-phase-two.md`.

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

### Native poll event correction and manual sync

Discord.js does not define `Events.Raw` in its supported `Events` enum. The original listener did not receive poll-vote events, even though the bot could fetch the poll message. We now use the supported `Events.MessagePollVoteAdd` and `Events.MessagePollVoteRemove` callbacks, with `GuildMessages` and poll/message partial support.

**To test an existing poll (including one created before the test bot restarted):**

1. Pull this branch, run `node register-commands.js` with the test bot token/application ID, and restart the Replit bot.
2. Run `/points-observe sync link:<native poll message link>`. It fetches Discord's voter list for every answer and deduplicates member IDs. The result reports the **current number of verified voters** and does not award Points.
3. Run `/points-observe report link:<same link>` to confirm the stored count.
4. Remove your vote in Discord, then run `/points-observe sync` again. The expected current voter count is zero, provided no one else voted. The live removal event should also update records when delivered.
5. Only native Discord polls can use `sync`. Arclo polls still lack verified participant identities.

Sync fetches all voter pages before updating records and has a safety limit of 2,000 voters per answer. A failed fetch does not delete stored votes. For accurate current results, run sync again if members change votes while the fetch is in progress. The test bot must have View Channel and Read Message History; Message Content was already enabled for the Arclo diagnostic, although raw native vote events do not themselves require it.

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


## Active test-only native poll Points and manual group awards

The native poll event listener was verified in the test server (vote → 1, remove → 0, manual sync → 1). Points rewards are now **active on this development branch for staff-approved native Discord polls only**. `main` and Wispbyte are not changed.

**Automatic poll rewards:**
- Every eligible member receives **5 Points for their first vote on an approved native poll**, visible in their existing shop balance and in `/points-admin history`.
- Poll rewards are **capped at 15 Points per member per UTC Monday–Sunday week**, with a single atomic counter across all approved polls. Polls that would exceed the cap award nothing.
- No member can receive more than **one payout per poll**, including after removing/recasting/changing answers or restarting the bot. Paid Points are not clawed back if someone later removes their vote.
- Manager approval is required for **each individual native poll**: `/points-admin poll-approve link:<poll message link>`. Approval also syncs the current voter list and awards anyone eligible who has already voted. An approved poll's later votes earn automatically.
- `/points-admin poll-disable link:<poll message link>` halts future rewards without removing existing credits. Arclo polls and giveaways never award automatically.
- `/points-observe voters link:<poll message link>` lists up to 30 current voters by Discord account and indicates whether each received +5 Points. `/points-observe report` also shows total paid to members for that poll. `/points-observe sync` reconciles votes and pays any newly verified eligible participants **only if the poll is approved**.
- Repeatable chat and voice earnings are now **uncapped**, with a 2× first-seven-days multiplier. Staff-approved poll votes still pay 5 Points, at most 15 poll Points per UTC week, without limiting chat or voice earnings.

**Multi-member staff awards** are provided through `/points-admin grant-multiple`:
- `members`: paste 1–20 Discord member mentions or user IDs, separated by commas, spaces or newlines. Members are checked in the current guild and bot accounts are rejected.
- `points`: 1–250 **per recipient**.
- `reason`: **Giveaway**, **Participation**, **Server Event**, **Helping Others**, or **Other**.
- `note`: optional context, e.g. "Halloween giveaway" or "art contest".
- `reference`: optional, unique event ID, e.g. `oct24-halloween-giveaway`. **Use the same reference when retrying or adding missing recipients** to avoid paying someone twice for the same event. Without a reference, each newly submitted grant command is considered a new payment.

Grants show how many members were credited, skipped as duplicates or failed. Every credited member receives a separate audit receipt identifying the moderator, award reason, amount and event reference. Staff-issued giveaway/event/helpfulness awards do not consume poll weekly caps.

### Recommended manual tests

1. On Replit, `git pull --ff-only origin feature/points-earning`, `npm install`, `node register-commands.js`, `npm start`. Confirm the test bot's MongoDB and token are **not** production credentials.
2. Run `/points-admin settings`; check that approved native poll rewards are listed as active at 5 Points, maximum 15/week.
3. For a test poll, run `/points-admin poll-approve` and paste the poll message link. If you've already voted, approving and syncing the poll should award the first 5 Points immediately.
4. Check `/points-observe voters` for your Discord account with **+5 Points awarded**, `/points-admin history member:<yourself>` for a `poll` credit, and the existing shop balance.
5. Remove your vote, vote again, and run sync. You **must not** earn another 5 Points for the same poll.
6. For weekly limits, approve and participate in **three other unique polls**; only three total polls per UTC week may credit Points. Fourth returns no Points.
7. Use `/points-admin grant-multiple` for one test member with reason Giveaway, 5 Points and a distinctive reference. Retry with the same reference; the second attempt must be marked already credited.
8. For a real group award, use 2+ real members and reason Giveaway/Participation. Arclo giveaway results are still reviewed by staff, **not** automatically imported.
9. Turn an approved poll off via `poll-disable` and confirm votes on it no longer award additional members.
