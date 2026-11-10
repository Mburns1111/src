## Hourly sticky staff giveaway directory (replaces `/giveaway list`)

The **private staff giveaway channel**, configured by `activity_review`, hosts an **Active Giveaway Directory · Staff** sticky message. This is **not** an announcement in the public `activity_giveaway_list` channel. It includes active regular giveaways, Court's Trials, activity giveaways, recurring activity schedules, staff reviews awaiting a drawing, and finished drawings still awaiting winner claims/staff prize follow-up. Entries link to the public post, and include an individual staff record link when available. Cancelled, fully resolved, and archived drawings do not clutter the current index; their original private records remain intact. Previously created public sticky indexes are removed when the bot moves the directory to the staff channel. Individual public giveaway announcement cards are **not deleted**.

The bot edits the directory when its contents change. **Once every hour**, it checks the newest message in the staff channel; only when the sticky is no longer last does it post a replacement at the bottom and delete its previous copy. The sticky is **not pinned**. The bot needs **Manage Messages** in the private staff channel to remove old sticky copies. The `/giveaway list` command is replaced by the staff directory; `/trial list` remains for historical lookups.

# Activity giveaways — saved plans, watched channels, prize queues and ticket claims

**Development only:** `feature/activity-giveaways-complete`. Do not merge into main or deploy to Wispbyte without approval.

## Setup workflow

1. Configure **three separate channels** with `/setup channels giveaways:#regular-giveaways activity_giveaway_list:#active-giveaways activity_winners:#activity-winners`. The first is for existing button-entry giveaways, the second is a member-visible directory, and the third is where automatic activity drawing results and ticket-claim buttons are announced.
   - Optional: `/setup channels activity_review:#private-giveaway-reviews` for staff approval. Review cards are never posted publicly.\n   - The public directory gets one live embed **per active scheduled activity plan or confirmed one-off activity giveaway**. It shows the current/upcoming prize, watched channel, qualifying message count/conditions, period, next winner announcement time and results channel. It does **not** reveal entrants or winners before the draw.
   - Recurring plans reuse/edit their own directory message each cycle; changing a plan/prize updates that listing. Paused, completed and concluded giveaways are cleared from the directory while finished results remain preserved in the **separate** winners channel.
   - The bot synchronizes directory posts automatically on startup and every giveaway sweep, including recovery after restarts. Ensure it can send/edit embeds and upload images in both channels.
   - Older standard giveaways and Court's Trials retain their existing assigned channels.
2. Save one watched channel at a time:
   - Daily QOTD: `/giveaway watch-save name:QOTD channel:#question-of-the-day period:daily min_chars:25 messages:1`
   - Weekly discussion: `/giveaway watch-save name:Discussion channel:#discussion period:weekly min_chars:20 messages:50`
   - `/giveaway watch-list` shows all saved rules. Reuse `watch-save` with the same name to edit **only** that rule. When editing an existing watch, omitted settings are preserved.
3. Create an independent one-time or recurring drawing plan:
   - Daily QOTD: `/giveaway plan-create name:QOTD-Daily title:QOTD Daily Prize watch:QOTD announce_at:2026-11-11 19:00 prize:Diamond Egg repeat:daily period:daily claim_hours:12 winners:1`
   - Weekly: `/giveaway plan-create name:Weekly-Activity title:Weekly Activity Prize watch:Discussion announce_at:2026-11-11 19:00 prize:Copy Cat repeat:weekly period:weekly claim_hours:12`
   - Once at a specified time: `/giveaway plan-create name:Art-OneTime title:Art Prize watch:general announce_at:2026-11-14 19:00 prize:Art Prize repeat:once period:daily claim_hours:24`
   - Fixed elapsed intervals: `/giveaway plan-create name:Interval-QOTD title:QOTD Interval Prize watch:QOTD announce_at:2026-11-11 19:00 prize:Egg repeat:interval interval_hours:36 period:daily`
   - For general activity use `watch:general`, which checks any eligible server channel. Add `messages:50` to `plan-create` to require 50 total messages across the chosen period. Plan-specific message counts can be edited later without changing a saved watch.
4. Maintain the prize list:
   - `/giveaway prize-add name:QOTD-Weekly prize:Copy Cat`
   - `/giveaway prize-edit name:QOTD-Weekly position:2 prize:Neon Cat`
   - `/giveaway prize-move name:QOTD-Weekly from:2 to:1`
   - `/giveaway prize-remove name:QOTD-Weekly position:2`
   - `/giveaway plan-view name:QOTD-Weekly` to review the ordered prize list, next prize, active status, claim period and next announcement.
   - `/giveaway plan-list` lists all plans; `/giveaway plan-edit` edits title, watched rule, next scheduled time, recurrence, prize cycling, enabled status, winner count, and claim hours.
5. To modify one giveaway **before its winners are drawn**, use `/giveaway edit-prize id:<ID> prize:<updated prize>`. The original giveaway record and entered members remain in place.

`announce_at` is the **first draw's exact date and time**, written `YYYY-MM-DD HH:mm` **Eastern time**. Each plan has independent settings:

- **Activity window (`period`)**: `daily` checks *exactly the previous Eastern calendar day* (00:00 to the following 00:00, not a rolling 24 hours). `weekly` checks *exactly the last completed Wednesday-to-Wednesday week*. The period is frozen into each saved drawing.
- **Drawing schedule (`repeat`)**: `once` runs on the chosen date/time; `daily` repeats at the same Eastern wall-clock time each day; `weekly` repeats on the same weekday and Eastern wall-clock time; `interval` repeats after `interval_hours` elapsed hours, measured as fixed elapsed time.
- **Interval safety**: for daily eligibility, intervals must be **24–720 hours**; for weekly eligibility, **168–720 hours**. This prevents repeated drawings from counting the same activity window. `daily` recurrence cannot use a `weekly` activity window.
- **Prize cycling**: `repeat_prizes` determines whether the ordered prize list cycles after the last prize (default true). No prize is consumed when a scheduled draw finds zero eligible members.

All start times and day boundaries use `America/New_York` and handle daylight-saving changes. Daily and weekly same-clock-time recurrences keep the Eastern clock time; fixed-hour intervals may shift their Eastern clock time when DST changes. You may update the next announcement, schedule, or activity period later with `/giveaway plan-edit` without changing past drawings.

## Optional staff approval, private member progress, role weights and custom windows

The following settings are **per giveaway** and are not forced on all servers.

### Staff-only approval before drawing

- `/setup channels activity_review:#private-giveaway-reviews` configures a **separate private staff channel**. Restrict channel visibility for @everyone; the bot rejects a publicly visible review channel when it can inspect channel permissions.
- `/giveaway plan-create ... review:true` or `/giveaway plan-edit name:... review:true` enables review; omission defaults **off** for newly created plans.
- At the scheduled drawing time the bot **does not choose or announce winners yet**. It snapshots qualifying member IDs (one per member) and posts a staff review embed with the requirements, prize, number of active members, number eligible/not eligible, and qualifying member mentions, capped at a 20-member preview. The ineligible count is based on distinct active participants; it can include people who have left the server.
- A staff member with **Manage Server** presses **Approve & Draw** to select distinct winners and announce them in the separate `activity_winners` channel; **Decline Drawing** cancels without using a prize. Only one approval can succeed.
- The review request remains recoverable after restarts. The next schedule cycle begins when a reviewed result is finalized.
- One-off `/giveaway activity ... review:true` supports the same option. Its existing creation confirmation is separate from this optional pre-draw staff review.

### Member progress button (on by default)

- New guided activity giveaways and saved plans turn on **Check My Progress by default**. Staff can turn it off in the guided setup with **Member progress**, or specify `progress:false` in `plan-create` / `plan-edit`. Existing saved giveaways keep their previous setting unless edited.
- Any server member may click **Check My Progress**, including members who have posted zero messages. No staff role or prior qualification is required. Each person privately sees only their own `qualifying messages / target`, relevant active-day threshold, provisional chances if qualified, and the current activity window. No one else's data is returned.
- For each saved plan, the progress button checks the **exact activity window associated with its next scheduled drawing**. This may be ongoing, already completed (for a drawing later today), or upcoming. The private reply shows the relevant window boundaries. For custom windows it checks activity from the configured start up through the current time or cutoff.

### One-time custom activity start and cutoff

- Add `starts_at:YYYY-MM-DD HH:mm` and `ends_at:YYYY-MM-DD HH:mm` to a one-time `plan-create` or `/giveaway activity`. Both are in Eastern time and use the exact minute.
- The custom cutoff must be later than the start and no later than the scheduled winner announcement time. Custom windows are **one-time only**, to avoid repeating the same dates on daily or weekly plans.
- `plan-edit` supports changing either endpoint (provided the full range remains valid), plus `clear_window:true` to revert to the default previous day/week.
- A future custom window **collects entries until its cutoff**; creating the giveaway does not freeze an empty entrant list. Messages are counted using persisted per-minute counter summaries.
- Record retention is 90 days. The selected start cannot be more than 89 days old. Counters do not backfill Discord chat that predates the new bot code running.

### One entry per member, multiple role-based chances

- All activity types (general messages, QOTD participation, special phrases, @member tags) **qualify the user at most once**. Five valid tags are not five entries; 50 valid chat messages merely meets a 50-message goal.
- If staff want role advantages, register any number of separate bonus roles (up to 20) against a saved watch or a plan using the distinct staff-only command:
  - `/giveaway-role bonus-add target:watch name:QOTD role:@VIP extra:2`
  - `/giveaway-role bonus-add target:watch name:QOTD role:@Supporter extra:3`
  - `/giveaway-role bonus-add target:plan name:Weekly-Activity role:@Contributor extra:1`
  - `/giveaway-role bonus-list target:watch name:QOTD` and `/giveaway-role bonus-remove target:watch name:QOTD role:@VIP`\n  - `/giveaway-role bonus-add target:event name:<Giveaway ID> role:@VIP extra:2` — customize an individual **one-off activity giveaway** until its draw; the private setup preview shows its ID.
- Each one-off drawing can also receive its own role bonuses using `target:event`; future rounds of named plans use `target:plan` or inherited `target:watch`.\n- A qualified member has **one base chance**, plus every applicable unique bonus role's extra chances. For example, VIP +2 and Supporter +3 provides weight **6**, not six eligible-member records.
- A plan can use bonuses inherited from its saved watch plus plan-specific bonuses; if the same role appears on both, the plan setting overrides the watch setting.
- Weighted draws sample **distinct winners without replacement** and snapshot weights for fair rerolls. No member can win twice in one drawing, even with several roles.

### Zero-qualifier result announcements

- New scheduled plans default `announce_empty:true`: if no member qualifies, the bot posts a **no winner selected** result in the winners channel, keeps the prize in the rotation and advances to the next schedule.
- Set `announce_empty:false` to keep zero-qualifier scheduled outcomes private instead (without consuming a prize).
- One-time activity giveaways also report no qualifying members in their result rather than failing to create.

## Giveaway presentation and staff progress (development)

The Cryptic Court remains the default presentation, with a decorative registered banner and a compact Discord embed. Staff may change the server-wide embed accent with `/giveaway color-default hex:#B47E99` and restore the default with `/giveaway color-clear`. Registered banner uploads and per-plan banner selection remain supported. Setting a color does not alter eligibility, prizes, role weights or claims. The color is shared by public giveaway listings and regular/activity result embeds, not Court's Trials.

For activity giveaway staff records, the bot publishes **two separate messages** in the configured private staff channel: the existing management/claim record and an adjacent **Member Activity & Qualification** overview. It shows the counts for members with recorded activity and concise samples of qualified/in-progress members; members with zero recorded activity are omitted. Staff may open a private paginated qualified or in-progress roster, select an individual member, or use the member-search picker. Staff member lookups and rosters never post new permanent chat messages.

The second message refreshes at most once each Eastern calendar day while the activity is open, or when a moderator presses **Refresh Progress** (60-second refresh cooldown). Status transitions can also cause an update. The bot keeps collecting activity counters continuously; display refresh timing does **not** control winner eligibility or the draw. No new Discord progress-message fetch is needed between scheduled refreshes when the saved message ID is already present.

Each recurring drawing receives its own two permanent private staff messages (management plus qualification summary) for record keeping. Earlier drawing posts stay available to staff alongside their saved winner, claim and reroll history. The public recurring giveaway listing continues to reuse its existing message, showing at most two most-recent winning members with their draw dates; drawings with zero winners do not add names to that section.

Winner result embeds use a Court-themed title for activity drawings. A zero-winner result does not include ticket-claim instructions, and an actual winner retains claim and reroll controls.

## Registered giveaway embed banners

Use a one-time image upload to register a reusable banner; the bot stores the image in MongoDB rather than trusting a temporary signed upload URL.

- `/giveaway banner-save name:Roses image:[upload PNG/JPG/WebP/GIF]` — register or replace a named banner (maximum 4 MB)
- `/giveaway banner-list` — review registered images and the default selection
- `/giveaway banner-default name:Roses` — select the server-wide default banner on standard and activity giveaway embeds
- `/giveaway banner-clear` — remove the default while keeping saved assets
- `/giveaway banner-remove name:Roses` — remove an unused asset (first change the default or any active plan using it)
- On `/giveaway plan-create` or `plan-edit`, specify `banner:Roses` for a particular giveaway; on `plan-edit`, `banner:default` returns to the server default.
- One-off `/giveaway activity` and ordinary `/giveaway start` accept an optional `banner` registered name. If omitted, they inherit the server default.

The registered banner is displayed above the details as the embed image in both public directory listings and the final winners/results post. **Court's Trials are not changed.**

## Configurable activity counts and mention/phrase challenges

Each watch uses staff-defined thresholds rather than a fixed message quota:

- `messages`: **total qualifying messages within the selected activity period** (for example, 50 messages in the previous Eastern calendar day, or 50 messages anywhere in the last completed Wednesday–Wednesday week).
- `period`: daily or weekly. Daily messages from Tuesday do not roll over into Wednesday, and weekly drawings exclude earlier weeks.
- `min_chars`: optional minimum length for each message; command-style messages, bots and webhooks do not count.
- `per_day` and `days`: **optional additional** minimum/day and minimum distinct active days. These are not imposed when only a total target is provided.
- `mention_member`: optional explicit Discord member mention required in each counted message, e.g., tag Tina in #general. Plain-text names, @role pings and reply-only notifications do not count.
- `phrase`: optional case-insensitive text that must appear in the same message (e.g., "you are wonderful"). If both mention and phrase are configured, both must match for the message to count.
- `clear_mention:true` and `clear_phrase:true` remove existing challenge requirements. Editing matching requirements starts a new counter version so old messages cannot qualify under the changed challenge.

Examples:
- `/giveaway watch-save name:Chat-50 channel:#general period:weekly messages:50 min_chars:10 days:1`
- `/giveaway watch-save name:Compliment channel:#general period:daily messages:1 mention_member:@Tina phrase:you are wonderful min_chars:5`
- `/giveaway watch-save name:QOTD channel:#qotd period:daily messages:1 min_chars:25`

All watched-message counts are accumulated by the bot as messages arrive and checked against the selected **completed** activity period. The bot records counts, not message bodies. A phrase check verifies the words, not whether a free-form answer is factually correct.

## Daily and weekly activity eligibility

- **Daily QOTD example:** Wednesday's drawing checks **Tuesday only**. Thursday's drawing checks **Wednesday only**. Entries from Tuesday are **not** included in Thursday's drawing. Every daily window is a separate Eastern calendar day, 00:00–00:00. No current-day incomplete data is used.
- **Weekly example:** Wednesday 00:00 to next Wednesday 00:00 in **America/New_York** (including DST). Weekly drawings use only the last fully completed Wednesday-to-Wednesday period.
- General activity defaults to one message of at least one character on one active day in the chosen daily or weekly window.
- Named watches count messages **only in their saved channel**, with the configured minimum message length and messages per active day. Daily windows require one active day. Weekly windows may require activity on 1–7 different days (for example, three days with 25+ character QOTD messages).
- A watched channel may have its own default period. When creating a plan, `period` can override that default without changing the watched rule or other plans. Every scheduled drawing uses its saved period, not an accumulating total.
- One-time `/giveaway activity` supports `period:daily` or `period:weekly`, and inherits a named watch's default period when not supplied.
- Bots, webhooks, blank messages and commands starting with `/` or `.` do not count. Message contents are never saved in this counter. Only daily counts and character-length buckets are stored.
- Tracking starts when the updated bot is running. Earlier messages cannot be reconstructed from the counter, and older rows created before length tracking lack length details; do not assume they qualify for new length thresholds.
- Staff set up saved watches separately. Creating a QOTD plan does not replace an Art plan. A plan referencing a deleted/missing watch cannot draw until it is repaired.

## Giveaway details

Creators can add an optional **Giveaway Details** description, separate from the title, prize and qualification rules (maximum 1,000 characters). The guided activity wizard asks after the prize whether to **Write giveaway details** or **Skip description**. To edit, use **Edit settings → Giveaway Details** in the final preview; the details are saved into each repeating giveaway. They appear on the public activity listing, staff preview and winner result. Other giveaway types can supply `description:` when using `/giveaway start`, `/trial start`, or `/giveaway plan-create`. Saved plans can be revised using `/giveaway plan-edit name:... description:...` or `clear_description:true`. Existing giveaways without descriptions display normally.

## Winner tickets and claim deadlines

In guided activity setup, staff can use a saved banner, register a new one directly, or return to the giveaway preview without losing settings. Upload PNG, JPG, WebP or GIF images (up to 4 MB) in the commands channel. Existing banners appear as quick-select buttons; the uploaded filename can autofill a new banner name. Once registered, the image is saved for reuse. Message targets are **totals for the activity period**, not daily quotas.

- Winners **must create their normal server support ticket themselves**. The bot does not create support tickets or deliver Roblox prizes.
- The finished giveaway shows **File Ticket Claim**. Only currently selected winners can use the button. The modal requests **ticket number** and **HTTPS link**.
- Accepted ticket claims are recorded with the winning position, member ID, submission timestamp and link. The announcement displays the filed ticket details; this may make the ticket link visible even to members who cannot read the private ticket.
- New standard giveaways, one-off `/giveaway activity`, and saved giveaway plans default to a **12-hour claim window** with automatic claim rerolls; an explicit `claim_hours` overrides the default. Plans default to **12 hours**, adjustable from 1 to 720 hours. Existing historical giveaways are **not retroactively switched** to automatic rerolling.
- If the deadline expires without a ticket claim, an unused eligible entrant is selected as a replacement. Previously selected winners are excluded; the replacement gets a fresh claim window. If no unused entrants remain, that place is labeled expired.
- Filing a ticket **prevents automatic reroll**, not manual host review. The bot only records claims; it does not verify that a ticket's contents are legitimate or that a prize was delivered.
- Court's Trial (`/trial`) also defaults to **12 hours** to claim, with an optional `claim_minutes` override. Trial deadlines are informational, and staff manage trial rerolls manually; automatic ticket-claim rerolls apply to standard and activity giveaways.

## Reliability and safety

- The bot checks member presence through Discord before scheduled activity drawing results.
- Each scheduled drawing is keyed uniquely to its plan and run time; startup reconciliation reuses a drawing after a restart and never deliberately redraws that occurrence.
- Previously drawn daily or weekly activity periods cannot be awarded a second time by the same plan, even if its schedule is edited.
- Daily drawings more than 24 hours overdue and weekly drawings more than seven days overdue are skipped without consuming a prize. Missed occurrences are fast-forwarded without posting a backlog after long downtime.
- The 30-second giveaway sweep handles due schedules, winner announcements and claim expiry rerolls.
- Submitted claims, prize snapshots, winner history and reroll history persist in MongoDB; older giveaway data is preserved. Drafts and finished posts are not deleted during ordinary operation.
- For manual testing, use a **separate development Discord bot and database**, and restore future-dated plans before enabling recurrence.

## Replit test checklist

1. Pull the feature branch and run `npm test`.
2. Run `node register-commands.js` to refresh the new subcommands; restart the Replit development bot.
3. Save a daily QOTD watch and weekly discussion watch, list both, and update one. Verify both remain saved. Confirm new plan listings appear only in `#active-giveaways`.
4. Check the daily QOTD watch on Wednesday: it must include only Tuesday's qualifying messages. Check again Thursday: it must include only Wednesday's qualifying messages (not Tuesday's). Test messages just below/above the length threshold. Verify Eastern midnight and both DST transitions.
5. Register a banner, set it as default, create a one-time activity plan, and verify its banner appears in the public list. At draw time confirm the finished result posts only in `#activity-winners`, and the active list entry disappears.
6. Create two recurring plans: daily QOTD and weekly discussion. Verify independent eligible entrants and rotating prizes; one day's entries must never accumulate into the next. Test a fixed-hour interval schedule and verify no activity period is drawn twice.
7. Edit, reorder and remove future prizes; confirm the public directory updates in place without creating duplicate posts. Check that past drawing prizes/winners are unchanged, and a completed plan is removed from the directory.
8. Create a short claim-window test. Submit ticket number and link as a winner from the announcement in `#activity-winners`; confirm that winner post updates, duplicate submission is blocked, and no automatic reroll happens for that place.
9. Let an unclaimed winning place expire, confirm a new eligible winner is chosen, prior winner is excluded and the replacement gets their own claim deadline.
10. Test no available replacement, simultaneous submissions/rerolls, expired winner leaving Discord, bot restart during drawing, and a bot downtime gap over one week.
11. Confirm ordinary button-entry giveaways, original prize/claim display, and Court's Trial functionality are not regressed.
12. **Do not merge or deploy** until Discord tests are confirmed by the owner.


## Public activity giveaway presentation

The public activity directory is a member-facing giveaway card. The embed shows the creator's title (Discord member/channel mentions remain clickable), prize, optional **Giveaway Details**, the actual entry requirements, activity period, winner count, draw time, recurring cadence when relevant, and the channel where results appear. Minimum character counts and active-day requirements are shown only when greater than the baseline. Staff-only configuration, raw IDs, locked-entry explanations, and other internal details are omitted. A short reference remains in the footer so reconciliations can recognize existing posts. The **Check My Progress** button stays available when progress is enabled; saved artwork remains the embed banner. Current public listings are edited in place by the normal reconciliation sweep.

## Guided activity staff controls

The staff-only preview cards have **Preview qualifying members**, **Edit Giveaway**, **End Early**, and **Cancel Giveaway**, with **Stop future repeats** shown when a recurring series is active. Staff must hold **Manage Server**. End Early and Cancel require confirmation; editing is a private dropdown/modal workflow. All three actions affect only the current giveaway, not future cycles. Ending early closes activity tracking and draws qualified members (or queues manual review); cancellation draws no winners and removes the public listing. Ending, cancelling, and editing refresh the private staff card. Previously posted staff cards gain these controls through reconciliation after an update.
