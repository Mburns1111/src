# Permanent Discord giveaways — test checklist

Development branch: `feature/permanent-giveaways`. This is a separate, general AM Isa Bot feature; it does not depend on the unmerged Hatchem card-game branch.

## Assigned channels (set once per server)

Use **`/setup giveaways`** and **`/setup trials`** to select separate public event channels and a shared private staff channel:

- **giveaways**: all standard `/giveaway start` announcements, entry buttons, winner results and rerolls.
- **survival_trials**: `/trial start` signups, every live elimination post, final winners and rerolls.

Both event types need their own public channel before hosting. Each guided setup includes the **same single Giveaway Notification Role** picker for regular giveaways, activity giveaways and Court's Trials. Changing it anywhere updates all event types; clearing it disables the ping across all three. Existing notification settings are recognized. If old settings disagree, the legacy regular giveaway ping role takes precedence until the shared role is changed in guided setup. The default role is separate from any entry eligibility requirement. The other channel's assignment remains unchanged if you change only one. The bot refuses to assign the same channel to both types. Running an event command in another channel does not change the destination; no per-event channel override is offered. Changing an assignment affects **new events only**; existing giveaways and their history remain in the channels where they were created.

Give the development bot **View Channel, Send Messages, Embed Links, Attach Files, Read Message History** in each assigned channel. Announcement channels are supported alongside ordinary text channels. Re-register slash commands after pulling this change.

## Commands

- `/giveaway start` — opens the regular giveaway creation wizard in the configured commands channel. Answer the prompts for title, prize, optional description/rules, duration, winners, role requirements, claims and banner. Review and preview before pressing **Post Giveaway**.
- `/giveaway list` — recent **standard** giveaway IDs, status, and direct message links
- `/giveaway entrants id:<ID-or-message-link> page:<optional>` — private staff roster of anyone entered in a giveaway **or trial**, 25 users per page
- `/trial entrants id:<ID-or-message-link> page:<optional>` — private staff roster of trial contestants only
- `/giveaway end id:<giveaway-ID-or-message-link>` — finish now
- `/giveaway reroll id:<giveaway-ID-or-message-link> winner:<1-based-position>` — replace one winner

**Notifications:** The bot pings **only** the single shared Giveaway Notification Role, **once** in the original signup/announcement message. Results, rerolls, button clicks and each individual elimination do not ping the role again. For a real ping, the role must be mentionable or the bot must have **Mention @everyone, @here, and All Roles** permission; otherwise Discord can show the tag without sending notifications. Never use `@everyone` or `@here` as event roles. Staff must have **Manage Server** or the configured **Giveaway Manager** role for giveaway commands and staff controls. The bot needs permission to View Channel, Send Messages, Embed Links, Read Message History, and edit its own announcements. Entrants need no commands or special permissions, unless a required role is configured.

## Empty drawings and unclaimed prizes

A giveaway that closes with **no entrants or eligible winners** must finish as **No eligible winner**. The public announcement is edited in place and remains visible; it is not automatically deleted. The active-only staff directory may stop listing it because it is no longer active, but its permanent public post and individual private staff record remain.

If a winner does **not** submit the ticket number and ticket message link before their deadline, automatic claim checking attempts to choose an **unused, eligible server member**, up to the configured maximum of two automatic rerolls (unless staff selected a different limit). **Two is a maximum, not a guaranteed number:** if nobody else entered or remains eligible, no replacement can be selected. That prize place is finalized as **No eligible winner — claim forfeited, no replacement available**. The original assignment remains in the private audit history; the public claim deadline, ticket directions, forfeit warning, and claim button are removed once no open claims remain.

This applies to regular giveaways, activity giveaways, and ticket-enabled Court's Trials. The original result/listing and Royal Verdict stay visible until a staff member explicitly chooses **Delete Listing** in its private staff record and confirms `DELETE`. A deleted completed listing retains its database audit record. For activity giveaways, the separate winner-results announcement is kept when the activity-list poster is deleted; for Trials, the Royal Verdict is kept when the original signup listing is removed.

## Claim windows, tickets and time conversion

For **regular giveaways**, `/giveaway start` asks for a ticket claim deadline of 1–720 hours in its guided wizard and offers Custom Minutes or Custom Days up to six calendar months. For **Court’s Trials**, `/trial start` accepts optional `claim_minutes` (1–43200 minutes), so staff can enter short windows such as 5, 15, or 30 minutes. Court's Trials also accept `claim_instructions` (up to 400 characters for host-specific notes, such as Roblox username requirements). The window begins at the **actual** winner announcement, not when entries opened. Older trial records saved with `claim_hours` continue to display their original hour-based deadlines; existing values are not silently reinterpreted as minutes. The signup announcement previews the claim window and the host's note. The regular giveaway's finished announcement or the Court's separate Royal Verdict displays the exact deadline using Discord's `<t:...:F>` and `<t:...:R>` syntax, so each reader sees the deadline in their own local time zone.

For any event with winners, its finished results also instruct members to **open a ticket in the server**, include 2–3 dates/times they can collect their prize, and use the [HammerTime Discord timestamp converter](https://hammertime.cyou) to generate time-zone-aware Discord timestamps for their availability. These are *instructions* only: this feature does not create tickets, verify time slots, automatically forfeit prizes or contact users automatically. Staff still handle prize delivery and any disputes. If the relevant `claim_hours` (giveaway) or `claim_minutes` (trial) option is omitted, there is no bot-defined claim deadline (but the ticket instructions still appear). Rerolls preserve the original draw's claim deadline rather than starting a new global window; staff can extend deadlines manually if necessary.

## Expected behavior

First configure the public and private staff channels through `/setup giveaways` and `/setup trials`. Run `/giveaway start` from the commands channel, complete the guided wizard, and verify the post appears in the saved standard-giveaway channel, not the command channel. Then run `/trial start` and verify the signup and elimination messages go to the separate trial channel. Confirm an unset channel produces a clear setup error rather than posting elsewhere.

1. Start a giveaway in the assigned regular-giveaway channel. The bot posts one announcement with title, prize, rules, host, ending time and an **Enter**, **Leave**, **Entry Count** control. If a regular-giveaway ping role is configured, only that role is mentioned in the **initial** message.
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

Use `/trial start` for a **full, one-contestant-at-a-time** elimination event. It has its own command group, separate from `/giveaway`. The original signup panel remains visible and a **second permanent Royal Verdict** is sent after the last elimination. Rerolling edits that verdict rather than sending a new one. The verdict also shows the original champion's **Trials Entered** and **Trials Won** totals for this Discord server. Entry totals come from saved trial registrations (including cancelled trials). A win counts only the **original last survivor** of a completed trial; prize-place rerolls do not add a championship win. The completed trial is included in the totals.

- `/trial start title:<title> prize:<prize> pace:<2|3|5> signup_minutes:<1–1440> winners:<1–10> rules:<optional> role:<optional> claim_minutes:<optional 1–43200> claim_instructions:<optional>`
- Click **Start Trial (Staff)** on the original trial signup post to lock entrants and begin the event; there is no `/trial launch` slash command.
- `/trial cancel id:<giveaway-ID-or-message-link>` — stop and archive a trial (no prize winners)
- `/trial reroll` — after the final survivor is announced, reroll a prize place from entrants who have not already received a prize; the original champion and reroll history remain visible

**Signup window** defaults to 15 minutes, which is separate from the game duration. Players can join, leave and see the live contestant count before entries close; staff can launch early or after signups close. Two entrants are required to launch; at most 120 unique entrants are allowed per trial. Staff can stop a trial during the event. Only staff with Manage Server or the Giveaway Manager role can click **Start Trial (Staff)**.

**Presentation:** Each elimination posts a single Canvas-generated Cryptic Court **PNG card** containing the portraits above the original event story, plus the eliminated/remaining status. The Discord embed normally contains only that picture and a tiny restart-safe event marker in the footer. If image generation or upload fails, the bot posts a readable text-and-status embed instead. **Every elimination gets a matching original PNG portrait attachment:** two contestants with Discord avatars on a dark-pink gothic **VS** card for duels, or one **Fallen** portrait for solo eliminations. Both now use **pointed Gothic arch portraits**, blackened stone, iron thorns, antique gold, and muted dusty-rose detailing (not cartoon flowers or circular avatar medallions). Solo cards give the eliminated player a large, asymmetric portrait beside a prominent **FALLEN** verdict; duel cards show two facing arch portraits with a steel-blade **VS** divider. Names use large, high-contrast type for Discord mobile viewing. Discord usernames or royal avatar silhouettes are used when Discord portraits are unavailable. If rendering fails, the event still posts as a text-only embed, preserving the match and restart marker. The signup post and final results are also embeds, with ornate royal headers and footers. A dedicated **Trial Complete** message posts after the final elimination, with the original champion, ranked prize winners, prize, and staff delivery reminder. There are **220 unique event texts** (110 solo and 110 duel): the original 120 plus 100 mildly autumn-themed scenes (50 solo and 50 duel). Orchard mysteries, lanterns, harvest banquets, scarecrows, and pumpkins are blended into the regular Gothic Court deck throughout the year. Templates are dealt without replacement: none repeat in a single trial, and original template IDs stay stable.

**Game flow:** The bot freezes the contestant list with an atomic database update, randomizes the eliminations once, and posts an original gothic-court solo event or duel for each elimination. Each victim is unique; duel opponents are still alive when the event occurs. Each post says how many contestants remain. Eliminations are published individually at **5 seconds (default), or optionally 2 or 3 seconds** apart. The final survivor is 1st place; for multiple prizes, the last eliminated is 2nd, the next is 3rd, etc. Elimination posts remain in the channel, and the original announcement is edited with full prize details, original champion, ranked winners, final entry count, and reroll history.

**Crash recovery:** The game stores every planned event, current step, and stable message markers in MongoDB. After a restart it resumes from the next unsent elimination, normally reusing previously posted event messages if they were sent just before a crash. The bot checks every second and leases each step to prevent overlapping workers. Live counts are in the individual elimination posts; the original giveaway message is updated at launch and at completion. The last 100 messages are checked when recovering an uncommitted send, so recovery after unusually heavy channel traffic cannot absolutely guarantee no duplicate event posts. Results are never intentionally deleted. No TikTok verification or Roblox prize fulfillment occurs.

### Additional Discord tests

1. Start `/trial start` with 2-second pace and 2–5 entrants. Confirm the staff-only **Start Trial** button, one entry per user, Leave and Contestants buttons. The single shared giveaway notification role is pinged once on initial signup but not on any elimination or final verdict.
2. Test **Start Trial (Staff)** with fewer than two entrants (a clear private error), then with two members (saved trial must enter running status, and the button disappears). Have two moderators press Start at once; only one game should begin. If the signup embed cannot be edited after the database starts the trial, the bot must say that the game **started and was saved**, not report a failed entry.
3. Watch every elimination. Verify each is a separate bot message with a unique victim, valid duel opponent, and decreasing survivor count. **Check each contains the pink/gothic PNG image:** two Discord user portraits with VS on duels, a single fallen portrait on solo events. Confirm Discord displays the embedded image correctly and the uploaded file survives restarts. No contestant should be eliminated twice.
4. Verify the winner is the final survivor; with `winners:3`, the runner-up and third place are the final two eliminated players.
5. Restart the bot midway through a trial. Verify it keeps the same plan, picks up at the correct elimination, and eventually edits the **original** post with the archived results.
6. Test Cancel while signup is open and during a running game. The original announcement should remain visible and record no winners.
7. Test signup deadline without launching: no new entries after the deadline, but staff can still start the trial.
8. Test optional required roles and role-free entry. Confirm non-staff can't start/cancel.
9. Test a prize reroll after completion. The archived message must retain the original champion and prior winner history, while the prize list updates.
10. Verify ordinary `/giveaway start` giveaways still end automatically by timer and are not treated as survival trials.
11. Verify the regal **Royal Verdict** appears as a new post after the last elimination, while the original signup post updates to archived results. Only one verdict should appear, including after restarting the bot or rerolling a prize place.
   - Check that the same winner's Trials Entered and Trials Won totals increase across separate completed trials, remain unchanged on re-render, and **do not increase** for a rerolled prize recipient.
12. Check the private `/giveaway entrants` and `/trial entrants` command outputs, empty rosters, and pagination at more than 25 entrants.

**Development:** This mode is on `feature/permanent-giveaways` in draft PR #24, not merged or deployed. When testing from Replit, use the correct development-bot token and database, then run `node register-commands.js` to refresh `/giveaway` and `/trial` options (including removal of the old slash launch command).


## Per-giveaway display text

During **/setup giveaways**, the final **Review** offers a gray **Edit Giveaway Display** button. This opens an interactive preview of the actual public embed, with buttons to edit the **Open Giveaway Title**, **Winner Announcement Title**, **Entry Story**, and **Winner Story**. Each edit opens a Discord text-input modal and refreshes the preview immediately. **Preview Open / Preview Winners** switches between the two post states. **Default** buttons restore original fox headings or story independently, while **Discard Changes** cancels the display draft. **Confirm Text** accepts the edited template into the unsaved setup draft; the final **Save Settings** stores it server-wide in MongoDB. Activity giveaways and Court's Trials do not inherit the regular giveaway template.

Every future **/giveaway start** post snapshots the currently saved server template at creation. Changing or clearing the template in a later **/setup giveaways** does **not** retroactively alter existing giveaways. The event creation preview shows the inherited template, but it has no per-event flavor editor. The wording may include `{host}` and `{winners}` placeholders, while arbitrary typed @mentions are neutralized. The embed still renders real prize, entry role, deadline, winner and claim details, and required buttons; no-eligible-winner announcements retain their mandatory safety/status wording. Nothing is posted publicly during setup or preview.

## Regular giveaway results channel

**/setup giveaways** configures two separate public locations: **Giveaway List** (regular entry post while open) and **Giveaway Winners** (completed results). The winners channel setting is shared with **/setup activity-giveaways**: staff see and may adjust the same saved destination in either guided setup. Both public channels must be distinct from staff controls and the private archive.

When a regular giveaway is drawn, the bot reposts its completed announcement, winner list and ticket-claim button to **Giveaway Winners**. Discord does not support moving a message in place: the bot saves the new channel and message IDs in the giveaway database, updates the private staff record link, and removes the old entry post from **Giveaway List**. All claim and reroll actions use the new canonical message IDs. The announcement role is **not pinged again** on results. Failure to repost leaves the old entry post untouched for retry; failure to delete the original is retried without republishing duplicate winners. Earlier unfinished giveaways without a saved destination can use the current configured winners channel, and servers that have not yet configured Winners retain the previous in-place behavior until setup is completed. Changing the Winners channel does not retroactively move completed giveaways.

Archiving a completed regular giveaway still removes its regular public result post after staff confirm prize delivery. Activity winners and Trial Royal Verdicts continue to remain public, as previously configured.


## Active winner cooldowns and the Enter Giveaway button

When staff configure **Winner Cooldown check: ON** for a regular giveaway, **Enter Giveaway** now rejects members with an active cooldown and privately shows the expiry. The current entrants list stays accurate: applying a cooldown removes any entries those members already had in open, enabled regular giveaways, and a background sweep removes stale entries from before this feature was enabled. Eligibility is also checked again when drawing and rerolling winners. **Winner Cooldown check: OFF** means the optional restriction does not apply to that giveaway. Activity giveaways filter at draw/approval, while Court's Trials remain exempt. Expired or removed cooldowns no longer block entry; members may join again while an enabled giveaway is still open. The permanent Giveaway Banned role remains independent and always blocks participation.
