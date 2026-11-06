# Activity giveaways — saved plans, watched channels, prize queues and ticket claims

**Development only:** `feature/activity-giveaways-complete`. Do not merge into main or deploy to Wispbyte without approval.

## Setup workflow

1. Assign the public destination with `/setup channels giveaways:#giveaways`. This is where standard giveaway posts and automatic activity drawing results appear.
2. Save one watched channel at a time:
   - Daily QOTD: `/giveaway watch-save name:QOTD channel:#question-of-the-day period:daily min_chars:25 messages:1`
   - Weekly discussion: `/giveaway watch-save name:Discussion channel:#discussion period:weekly min_chars:20 messages:50`
   - `/giveaway watch-list` shows all saved rules. Reuse `watch-save` with the same name to edit **only** that rule. When editing an existing watch, omitted settings are preserved.
3. Create an independent one-time or recurring drawing plan:
   - Daily QOTD: `/giveaway plan-create name:QOTD-Daily title:QOTD Daily Prize watch:QOTD announce_at:2026-11-11 19:00 prize:Diamond Egg repeat:daily period:daily claim_hours:48 winners:1`
   - Weekly: `/giveaway plan-create name:Weekly-Activity title:Weekly Activity Prize watch:Discussion announce_at:2026-11-11 19:00 prize:Copy Cat repeat:weekly period:weekly claim_hours:48`
   - Once at a specified time: `/giveaway plan-create name:Art-OneTime title:Art Prize watch:general announce_at:2026-11-14 19:00 prize:Art Prize repeat:once period:daily claim_hours:24`
   - Fixed elapsed intervals: `/giveaway plan-create name:Interval-QOTD title:QOTD Interval Prize watch:QOTD announce_at:2026-11-11 19:00 prize:Egg repeat:interval interval_hours:36 period:daily`
   - For general activity use `watch:general`, which checks any eligible server channel.
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

## Winner tickets and claim deadlines

- Winners **must create their normal server support ticket themselves**. The bot does not create support tickets or deliver Roblox prizes.
- The finished giveaway shows **File Ticket Claim**. Only currently selected winners can use the button. The modal requests **ticket number** and **HTTPS link**.
- Accepted ticket claims are recorded with the winning position, member ID, submission timestamp and link. The announcement displays the filed ticket details; this may make the ticket link visible even to members who cannot read the private ticket.
- New standard giveaways with `claim_hours`, one-off `/giveaway activity`, and saved giveaway plans can enforce automatic claim rerolls. Plans default to **48 hours**, adjustable from 1 to 720 hours. Existing historical giveaways are **not retroactively switched** to automatic rerolling.
- If the deadline expires without a ticket claim, an unused eligible entrant is selected as a replacement. Previously selected winners are excluded; the replacement gets a fresh claim window. If no unused entrants remain, that place is labeled expired.
- Filing a ticket **prevents automatic reroll**, not manual host review. The bot only records claims; it does not verify that a ticket's contents are legitimate or that a prize was delivered.
- Court's Trial (`/trial`) claim deadline and manual reroll behavior remain unchanged; automatic ticket claim enforcement is for standard and activity giveaways.

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
3. Save a daily QOTD watch and weekly discussion watch, list both, and update one. Verify both remain saved.
4. Check the daily QOTD watch on Wednesday: it must include only Tuesday's qualifying messages. Check again Thursday: it must include only Wednesday's qualifying messages (not Tuesday's). Test messages just below/above the length threshold. Verify Eastern midnight and both DST transitions.
5. Create a one-time plan, verify it draws automatically at its set Eastern time and keeps a permanent announcement.
6. Create two recurring plans: daily QOTD and weekly discussion. Verify independent eligible entrants and rotating prizes; one day's entries must never accumulate into the next. Test a fixed-hour interval schedule and verify no activity period is drawn twice.
7. Edit, reorder and remove future prizes; confirm prior finished drawing prizes and winners do not change.
8. Create a short claim-window test. Submit ticket number and link as a winner; confirm the message updates, duplicate submission is blocked and no automatic reroll happens for that place.
9. Let an unclaimed winning place expire, confirm a new eligible winner is chosen, prior winner is excluded and the replacement gets their own claim deadline.
10. Test no available replacement, simultaneous submissions/rerolls, expired winner leaving Discord, bot restart during drawing, and a bot downtime gap over one week.
11. Confirm ordinary button-entry giveaways, original prize/claim display, and Court's Trial functionality are not regressed.
12. **Do not merge or deploy** until Discord tests are confirmed by the owner.
