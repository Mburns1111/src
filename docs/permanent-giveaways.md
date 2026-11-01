# Permanent Discord giveaways — test checklist

Development branch: `feature/permanent-giveaways`. This is a separate, general AM Isa Bot feature; it does not depend on the unmerged Hatchem card-game branch.

## Assigned channels (set once per server)

Use `/setup channels giveaways:#giveaways survival_trials:#court-trials` to save **two different** Discord channels:

- **giveaways**: all standard `/giveaway start` announcements, entry buttons, winner results and rerolls.
- **survival_trials**: `/trial start` signups, every live elimination post, final winners and rerolls.

Both fields are optional when updating other server settings, but you must configure the corresponding channel before starting that kind of event. The other channel's assignment remains unchanged if you change only one. The bot refuses to assign the same channel to both types. Running an event command in another channel does not change the destination; no per-event channel override is offered. Changing an assignment affects **new events only**; existing giveaways and their history remain in the channels where they were created.

Give the development bot **View Channel, Send Messages, Embed Links, Read Message History** in each assigned channel. Announcement channels are supported alongside ordinary text channels. Re-register slash commands after pulling this change.

## Commands

- `/giveaway start title:<title> prize:<prize> minutes:<1–20160> winners:<1–10> rules:<optional> role:<optional>`
- `/giveaway list` — recent **standard** giveaway IDs, status, and direct message links
- `/giveaway entrants id:<ID-or-message-link> page:<optional>` — private staff roster of anyone entered in a giveaway **or trial**, 25 users per page
- `/trial entrants id:<ID-or-message-link> page:<optional>` — private staff roster of trial contestants only
- `/giveaway end id:<giveaway-ID-or-message-link>` — finish now
- `/giveaway reroll id:<giveaway-ID-or-message-link> winner:<1-based-position>` — replace one winner

Staff must have Manage Server. The bot needs permission to View Channel, Send Messages, Embed Links, Read Message History, and edit its own announcements. Entrants need no commands or special permissions, unless a required role is configured.

## Expected behavior

First assign the two channels with `/setup channels`. Run `/giveaway start` from a **different** command channel and verify the post appears in the saved standard-giveaway channel, not the command channel. Then run `/trial start` and verify the signup and elimination messages go to the separate trial channel. Confirm an unset channel produces a clear setup error rather than posting elsewhere.

1. Start a giveaway in the assigned regular-giveaway channel. The bot posts one announcement with title, prize, rules, host, ending time and an **Enter**, **Leave**, **Entry Count** control.
2. Try entering twice. Both attempts must produce a private response, but only one entry must be saved. Joining costs no Points.
3. Test leaving/re-entering, the live Entry Count, optional required-role rejection and the fact that staff commands are not available to regular members.
4. Stop the development bot during a running giveaway, restart after the deadline, and verify that the same message changes to **Ended** with winners and final entrant count. The bot must not delete the giveaway message.
5. Create a giveaway with two or more members and multiple winners; verify distinct winners.
6. Use `/giveaway end` early; repeating End must **not** select another winner.
7. Use `/giveaway reroll` for one winner. Verify the previous winner, replacement, and reroll history remain visible in the **same** message. A replacement must not select a current or earlier winner.
8. Re-run the bot and verify archived results persist. Test a late Enter/Leave against an expired message; entry must be denied.
9. Test with zero entrants; the final message should explicitly state there were no winners.
10. Check `/giveaway list`, and test staff End/Reroll using both the giveaway ID and the original message link.

## Behavior and limits

- The bot **never deletes a finished giveaway** and keeps its database record. Regular giveaways are hosted in-character by the mischievous fox: it recruits accomplices to steal the prize from the host's pocket, while keeping the real prize and winner details clear. Rewards are never actually transferred by this story text.
- Prize fulfillment is **manual**. The bot does not transfer real Adopt Me pets or confirm TikTok follows. Optional external requirements in the Rules field are informational and must be checked by staff.
- Results are selected with cryptographic randomness from unique recorded entrants. If there are fewer entrants than winner slots, it awards only the available number.
- Rerolls exclude previous winners and keep an audit trail. They do not deliver prizes or undo previously delivered prizes.
- The public active post does not update on every click. Entrants can use **Entry Count** to see the live count privately. The final public post contains the exact total.
- Automatic endings run on a 30-second sweep, with restart recovery. An offline bot cannot close giveaways while offline; it reconciles them after reconnecting.
- No production deployment or merge until the user explicitly approves.

## Live elimination mode: The Court's Trial

Use `/trial start` for a **full, one-contestant-at-a-time** elimination event. It has its own command group, separate from `/giveaway`. The original signup panel remains visible and a **second permanent Royal Verdict** is sent after the last elimination. Rerolling edits that verdict rather than sending a new one.

- `/trial start title:<title> prize:<prize> pace:<2|3|5> signup_minutes:<1–1440> winners:<1–10> rules:<optional> role:<optional>`
- `/trial launch id:<giveaway-ID-or-message-link>` — manually freeze the list and start the game
- Or use **Start Trial (Staff)** on the original giveaway post
- `/trial cancel id:<giveaway-ID-or-message-link>` — stop and archive a trial (no prize winners)
- `/trial reroll` — after the final survivor is announced, reroll a prize place from entrants who have not already received a prize; the original champion and reroll history remain visible

**Signup window** defaults to 15 minutes, which is separate from the game duration. Players can join, leave and see the live contestant count before entries close; staff can launch early or after signups close. Two entrants are required to launch; at most 120 unique entrants are allowed per trial. Staff can stop a trial during the event.

**Presentation:** Each individual elimination is a Discord embed with a Cryptic Court header, its original event story, eliminated contestant, survivor count, and an event identifier in the footer. The signup post and final results are also embeds, with ornate royal headers and footers. A dedicated **Trial Complete** message posts after the final elimination, with the original champion, ranked prize winners, prize, and staff delivery reminder. There are **120 unique event texts** (60 solo and 60 duel), dealt without replacement within each trial: no repeated scenario in one 120-person game.

**Game flow:** The bot freezes the contestant list with an atomic database update, randomizes the eliminations once, and posts an original gothic-court solo event or duel for each elimination. Each victim is unique; duel opponents are still alive when the event occurs. Each post says how many contestants remain. Eliminations are published individually at **5 seconds (default), or optionally 2 or 3 seconds** apart. The final survivor is 1st place; for multiple prizes, the last eliminated is 2nd, the next is 3rd, etc. Elimination posts remain in the channel, and the original announcement is edited with full prize details, original champion, ranked winners, final entry count, and reroll history.

**Crash recovery:** The game stores every planned event, current step, and stable message markers in MongoDB. After a restart it resumes from the next unsent elimination, normally reusing previously posted event messages if they were sent just before a crash. The bot checks every second and leases each step to prevent overlapping workers. Live counts are in the individual elimination posts; the original giveaway message is updated at launch and at completion. The last 100 messages are checked when recovering an uncommitted send, so recovery after unusually heavy channel traffic cannot absolutely guarantee no duplicate event posts. Results are never intentionally deleted. No TikTok verification or Roblox prize fulfillment occurs.

### Additional Discord tests

1. Start `/trial start` with 2-second pace and 2–5 entrants. Confirm the staff-only **Start Trial** button, one entry per user, Leave and Contestants buttons.
2. Have two moderators press Start at once. Exactly one game should begin; no entries accepted once startup begins.
3. Watch every elimination. Verify each is a separate bot message with a unique victim, valid duel opponent, and decreasing survivor count. No contestant should be eliminated twice.
4. Verify the winner is the final survivor; with `winners:3`, the runner-up and third place are the final two eliminated players.
5. Restart the bot midway through a trial. Verify it keeps the same plan, picks up at the correct elimination, and eventually edits the **original** post with the archived results.
6. Test Cancel while signup is open and during a running game. The original announcement should remain visible and record no winners.
7. Test signup deadline without launching: no new entries after the deadline, but staff can still start the trial.
8. Test optional required roles and role-free entry. Confirm non-staff can't start/cancel.
9. Test a prize reroll after completion. The archived message must retain the original champion and prior winner history, while the prize list updates.
10. Verify ordinary `/giveaway start` giveaways still end automatically by timer and are not treated as survival trials.
11. Verify the regal **Royal Verdict** appears as a new post after the last elimination, while the original signup post updates to archived results. Only one verdict should appear, including after restarting the bot or rerolling a prize place.
12. Check the private `/giveaway entrants` and `/trial entrants` command outputs, empty rosters, and pagination at more than 25 entrants.

**Development:** This mode is on `feature/permanent-giveaways` in draft PR #24, not merged or deployed. When testing from Replit, use the correct development-bot token and database, then run `node register-commands.js` to refresh `/giveaway` options.
