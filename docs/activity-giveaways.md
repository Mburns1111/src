# Activity giveaways — saved plans, watched channels, prize queues and ticket claims

**Development only:** `feature/activity-giveaways-complete`. Do not merge into main or deploy to Wispbyte without approval.

## Setup workflow

1. Assign the public destination with `/setup channels giveaways:#giveaways`. This is where standard giveaway posts and automatic activity drawing results appear.
2. Save one watched channel at a time:
   - `/giveaway watch-save name:QOTD channel:#question-of-the-day min_chars:25 messages:1 days:3`
   - `/giveaway watch-save name:Art channel:#art-sharing min_chars:10 messages:1 days:2`
   - `/giveaway watch-list` shows all saved rules. Reuse `watch-save` with the same name to edit just that rule.
3. Create an independent one-time or recurring drawing plan:
   - `/giveaway plan-create name:QOTD-Weekly title:QOTD Activity Prize watch:QOTD announce_at:2026-11-11 19:00 prize:Diamond Egg recurring:true claim_hours:48 winners:1`
   - `/giveaway plan-create name:Art-Monthly title:Art Community Prize watch:Art announce_at:2026-11-14 19:00 prize:Art Prize recurring:false claim_hours:24`
   - For general activity use `watch:general`, which checks any eligible server channel.
4. Maintain the prize list:
   - `/giveaway prize-add name:QOTD-Weekly prize:Copy Cat`
   - `/giveaway prize-edit name:QOTD-Weekly position:2 prize:Neon Cat`
   - `/giveaway prize-move name:QOTD-Weekly from:2 to:1`
   - `/giveaway prize-remove name:QOTD-Weekly position:2`
   - `/giveaway plan-view name:QOTD-Weekly` to review the ordered prize list, next prize, active status, claim period and next announcement.
   - `/giveaway plan-list` lists all plans; `/giveaway plan-edit` edits title, watched rule, next scheduled time, recurrence, prize cycling, enabled status, winner count, and claim hours.
5. To modify one giveaway **before its winners are drawn**, use `/giveaway edit-prize id:<ID> prize:<updated prize>`. The original giveaway record and entered members remain in place.

`announce_at` uses **YYYY-MM-DD HH:mm Eastern time**. A recurring plan repeats **weekly on the same weekday and clock time**. It does not automatically repeat daily or monthly. Its `repeat_prizes` option determines whether the ordered prize list cycles after the final prize. It defaults to true. No prize is consumed when a scheduled drawing finds zero eligible members.

## Weekly activity eligibility

- Activity weeks run Wednesday 00:00 to the next Wednesday 00:00 **America/New_York** (including DST). Each drawing uses the last completed week as of its scheduled announcement.
- General activity defaults to one message of at least one character on any one day of that week.
- Named watches count messages **only in their saved channel**, using its minimum character count, messages per active day and distinct active-day requirement. Example: QOTD can require a 25+ character answer on three separate days in the week.
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
- Drawings missed by at least a full week of bot downtime are skipped without consuming a prize to avoid announcement floods.
- The 30-second giveaway sweep handles due schedules, winner announcements and claim expiry rerolls.
- Submitted claims, prize snapshots, winner history and reroll history persist in MongoDB; older giveaway data is preserved. Drafts and finished posts are not deleted during ordinary operation.
- For manual testing, use a **separate development Discord bot and database**, and restore future-dated plans before enabling recurrence.

## Replit test checklist

1. Pull the feature branch and run `npm test`.
2. Run `node register-commands.js` to refresh the new subcommands; restart the Replit development bot.
3. Save two named watches, list both, and update only one. Verify both remain saved.
4. Post messages just below/above a watch's character threshold on three different days (use test date records where necessary); confirm only qualified messages count and the Wednesday boundary works.
5. Create a one-time plan, verify it draws automatically at its set Eastern time and keeps a permanent announcement.
6. Create a recurring plan with two prizes, run two simulated weekly cycles, confirm prizes rotate and neither week is drawn twice.
7. Edit, reorder and remove future prizes; confirm prior finished drawing prizes and winners do not change.
8. Create a short claim-window test. Submit ticket number and link as a winner; confirm the message updates, duplicate submission is blocked and no automatic reroll happens for that place.
9. Let an unclaimed winning place expire, confirm a new eligible winner is chosen, prior winner is excluded and the replacement gets their own claim deadline.
10. Test no available replacement, simultaneous submissions/rerolls, expired winner leaving Discord, bot restart during drawing, and a bot downtime gap over one week.
11. Confirm ordinary button-entry giveaways, original prize/claim display, and Court's Trial functionality are not regressed.
12. **Do not merge or deploy** until Discord tests are confirmed by the owner.
