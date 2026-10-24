# Points ledger operations and ~700-member capacity review

Scope: `feature/points-earning` development branch. This is a **code and workload review**, plus synthetic tests, **not** a claim that Wispbyte/MongoDB capacity has been load-tested. Keep `main` and the live bot unchanged until tested.

## Storage design

- **PointsLedger** is a MongoDB collection, NOT a growing JSON/text file on Wispbyte. One immutable earning receipt per successful credit. Fields: guild/member ID, unique event key, kind, positive amount, human-readable reason, source/event ID, staff actor ID for manually issued credits, and MongoDB `createdAt`/`updatedAt`.
- Award code creates a receipt and increments `PointsWallet.balance` **inside one MongoDB transaction**. A unique compound ledger index (`guildId, discordUserId, eventKey`) prevents re-crediting the same message, voice block, poll, or manual event reference. This requires a transaction-capable MongoDB deployment, as already used by the shop.
- MongoDB writes are durable assuming the MongoDB service and backups are configured appropriately. **Application console logs are supplemental and may be rotated**, and are *not* the audit source of truth.
- The ledger currently tracks **credits**, NOT debits from purchasing shop items. Balance cannot be calculated by subtracting ledger credits alone. A future full economy reconciliation should log purchases/refunds/adjustments as separate signed wallet transactions or otherwise derive them from the shop purchase records.
- No automatic receipt purging, retention deadline, or archival exists. Keep raw earning receipts until a deliberate retention/archive plan and verified backup exists; deleting entries without reworking idempotency could allow repeat rewards.

## Read-only commands for managers

- `/points-admin audit days:1` (1–90 days; defaults to 1): Points issued, award count, unique members rewarded, totals by reward type, five largest earners. Filter by `type` and/or `member`. Executes an indexed time-window MongoDB aggregation, grouping by **member and reward type**, rather than retrieving every receipt into Node memory.
- `/points-admin audit-export days:7` (defaults to 7): Ephemeral CSV attachment with UTC timestamp, guild/member IDs, kind, positive Points amount, reason, source ID, moderator actor ID, and event key. Optional type/member filters. Reads in **500-record cursor batches** and refuses to send **incomplete** results: 25,000 receipts or 5 MiB is the ceiling for one file. For bigger periods, split by shorter days, member, and type. Import snowflake ID columns as **text** in spreadsheets to preserve 17–21 digits.
- `/points-admin history member:@... ` displays the 10 latest credits, and `/points-admin activity-status` displays the current activity accounting total. Reports do not identify shop deductions.
- Operational shell command: `node scripts/points-ledger-health.js` (with `MONGODB_URI` set). **Read-only**, prints approximate ledger and wallet counts, seven-day award count, expected indexes, and storage/index sizes if `collStats` is permitted. Never paste database connection strings or credentials into chat.

## Indexes checked in this branch

- Unique: `guildId + discordUserId + eventKey` — prevents duplicate rewards.
- `guildId + discordUserId + createdAt(desc)` — member history / member audit.
- `guildId + createdAt(desc)` — guild-wide time-window reports and CSV.
- `guildId + kind + createdAt(desc)` — filtered message/voice/poll/manual audits.

The additional indexes improve reads at the cost of disk and slightly higher write overhead. **Confirm the indexes have actually been built on the live MongoDB deployment** before large queries; defining a Mongoose index in code alone does not prove production build completion.

## Workload scenario: 100 very active + 600 semi-active

The table is an illustrative **scenario, not a measured throughput guarantee**:

| Member group | Earned message awards | Eligible voice awards | Ledger receipts/day |
| --- | --- | --- | --- |
| 100 highly active | Up to 48/day each (30-minute spacing across 24h) | 24/day each (4 qualifying voice hours) | 7,200 |
| 600 semi-active | 4/day each | Average 6/week each (1 qualifying voice hour/week) | ~2,914 |
| **Combined** | | | **~10,114/day** |

This is around **3.7 million new earning receipts per year**, excluding milestones, giveaways and poll rewards. Volume scales with *credited actions*, not just server member count. The true storage usage depends on BSON document sizes, strings, index sizes, MongoDB compression, backups, and retention. The health script gives actual numbers after testing; do not assume a fixed MB/member or a specific hosting tier is sufficient.

The second source of load is minute-level voice tracking. It uses about **two progress writes per eligible user-minute**, plus a transaction for each 10-minute credit. At 100 concurrently eligible members, that is roughly 200 small progress writes/minute before award work. The old loop processed them sequentially; now it processes up to **10 concurrent members** (not 100 uncontrolled requests), and warns when a voice cycle exceeds 45 seconds. A tick overlapping the next minute intentionally skips the later tick, so **monitor warnings and resulting missed minute-credit time**. Voice gateway and DB performance must be tested together on the actual hosting setup.

## Production readiness / verification plan

1. **Back up MongoDB first.** Confirm what cluster, tier, available storage, memory/CPU, write limits and backup schedule the live Wispbyte bot will use. Ensure test and production MongoDB URIs point at the **intended separate databases**; do not assume test receipts transfer to live.
2. With the development bot, confirm the 1-Point regular voice reward, 2-Point newcomer voice reward, and message 30-minute cooldown. Test `audit` and `audit-export` for 1 day and 7 days. Cross-check CSV row totals against the report, allowing for credits occurring between the two commands.
3. Run the read-only health script and inspect **actual index presence and storage bytes**. Confirm all four ledger indexes, especially the guild/time and guild/type/time indexes. Monitor MongoDB slow queries, write latency, connections, disk utilization, and Wispbyte process CPU/memory.
4. Load-test a **copy** of the schema on a throwaway MongoDB database against a realistic simulated workload (e.g. 700 distinct users, 10k awards/day equivalents and concurrent voice ticks). Measure p50/p95 transaction latency, audit response latency, CSV memory peak and rate of errors. The in-repo unit tests use fakes and **do not** substitute for this step.
5. Start the real bot with a limited group, review daily `audit`, check duplicates/anomalies, then grow toward 100 and 700 members with alerts. Use one-day CSV exports during the initial rollout.
6. Decide how long to keep the ledger and how to **archive old receipts without enabling old event keys to pay twice**. Do not simply add a TTL index to the immutable ledger. If purchasing/deduction reconciliation matters, add signed wallet transaction logging before labeling the audit a complete financial balance trail.

## Capacity limitations to keep visible

- Disk space and transaction throughput depend on the actual MongoDB deployment. This code review cannot verify Atlas tier, available capacity, backups, or Wispbyte performance.
- A 90-day all-member audit scans only the indexed time window, but a large period still has database query cost. Use shorter windows for routine reports, and filtered CSV batches. Single Discord interactions can expire if DB queries take too long.
- CSV export is intentionally bounded; it will give an actionable error rather than returning a truncated file.
- 10 concurrent voice workers helps at ~100 active people, but a sustained 700-member simultaneous voice load or high DB latency can still exceed the minute cadence; monitor the `[Points] Voice tick required ...` warnings.
- The audit currently covers **Points issued**. To investigate unexpected balance changes after purchases, compare the ledger with shop transactions; a unified debit-and-credit audit is a separate enhancement.
