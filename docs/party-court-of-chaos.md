# Court of Chaos — Development Test Guide

**Development branch:** feature/party-court-of-chaos  
**Draft PR:** #28  
**Release status:** Not merged or deployed. Replit/Discord smoke tests required.

## Staff gameplay

The feature is intentionally separate from the Hatchem card game. It uses the existing MongoDB connection and AM Isa Points ledger but does not alter card ownership, card roles, shop inventory or listings.

Use a development bot token, development MongoDB database and test Discord server. Verify values without exposing credentials.

1. Stop the Replit test bot.
2. Check out the development branch and run tests.
3. Run the existing **register-commands.js** to register /party with the *development* Discord application only. The script replaces the application command lists; confirm the token, application ID, and guild ID first.
4. Restart the test bot.
5. Create a Discord text channel for games, then run /setup channels party_games:#your-channel. As staff with Manage Server, use **/party start** or **/party host**. Both commands offer a game option; if left blank, a private **Choose your Party Game** dropdown appears. Select Court of Chaos to create the signup lobby. /party host also accepts optional category and rewards settings. Neither command launches Round 1.
6. Have 1–20 accounts use Join; Leave and rejoin; try the 21st account. Test separate 1-, 2- and 3-player games.
7. Only after members have joined, the **staff member who created the lobby** clicks **Start Party** beside Join and Leave to begin Round 1. **/party start creates the signup lobby; it never skips signup.** Other admins and members cannot start somebody else's lobby, and at least one player must have joined. Every player then gets **two different prompts per round** through My Prompts & Answers and submits each answer with its own button/modal. Submitting from a modal should **edit the same private two-question panel** to show **Saved for Round 1**, the submitted answer, and the saved/unsaved status of both questions. It must **not** send an additional ephemeral confirmation that leaves the earlier panel stale. Staff can use /party status to see the number of saved submissions without viewing private answers.
8. After the **full 90-second answer period**, with 2+ players, each question is shown individually with **30 seconds to read and vote**. With one player, both prompts are revealed without voting. The timer does NOT end early when all answers have been submitted.
9. Each question creates a **new Discord voting message**, left in the channel as a permanent record. When voting ends, the bot edits **that question's own post** to show the answers, voters' result/points, and removes its buttons. After the 8-second reveal the bot **sends a new message** for the following question rather than overwriting the previous one. At the end of rounds 1 and 2 the bot posts a **new standings / Start Next Round message**; staff can click after the minimum 10-second break or run `/party next`. Round 3 ends with a separate final standings message.
10. Review the leaderboard. If rewards were enabled, check /points-admin history and audit. Verify each eligible member earns +5 completion (including solo participants with two submitted answers); placement bonuses are +10/+6/+3 only for games with multiple competitors. No more than two rewarded games per UTC date.

## Staff controls

- /setup channels party_games:#your-channel: save the dedicated Party Games channel, without changing the other channels
- /party start with game selection: opens a **private game-selection menu** if no game is specified, or creates the selected game's signup lobby directly. The game option is optional only because the private picker provides the alternative. Court of Chaos is the only available choice. It never starts the answering timer.
- /party status: phase, players and remaining time
- /party next: staff starts the next round after the 10-second break; also available as a staff-only button in the Party Games message
- /party pause: stop automatic phase advances
- /party resume: resume from saved time remaining
- /party extend: add 30 seconds during answers or voting
- /party skip: advance an active answering/voting/reveal phase; it never skips the staff-only next-round action
- /party remove-answer player:@Member: remove answer before its matchup scores
- /party end: cancel the active session; no Points rewards

Only members with Manage Server can use /party commands. Regular members and spectators use buttons. The original lobby message stays as the lobby's record and is archived without buttons on game start. Each round's answer period has its own post; every question gets a new voting post, updated in place to its final result. The bot creates separate round-break and final-standing posts; previous rounds are never overwritten by later rounds. The private answer forms remain ephemeral. Public game history will create significantly more messages in the designated Party Games channel.

## Regression checks

- A non-staff member cannot create a lobby, launch the round, pause or cancel. **Only the original lobby host can use the Start Party button to begin Round 1**, even when another member has Manage Server permissions. Other staff controls retain their existing permissions.
- Only lobby members can answer; all server members except matchup contestants can vote.
- Answers are hidden until voting. Votes are hidden until the reveal.
- A vote can be changed until the deadline without increasing the ballot count.
- No answer means forfeit (no matchup points when fewer than two valid answers remain).
- One player gets two solo showcases (no vote buttons, no competitive points, no placement bonus).
- Two players receive two separate head-to-head prompts per round; three players share two different three-person prompts per round.
- Larger odd lobbies produce one three-contestant matchup **in each of the two rotations**, allowing everyone two appearances per round.
- Two simultaneous joins/answers/votes don't duplicate membership or ballots.
- A staff-removed answer disappears from vote options before its result is scored.
- Bot restart during answering, voting, and reveal resumes safely. Every permanent post is tracked by a unique game/stage key in MongoDB. Interrupted sends can be rediscovered via a stage marker in recent channel history. Verify that repeated sweeps do **not** create extra voting posts.
- Cancelled games do not pay rewards.
- Reward settlement is idempotent across startup retries. Missing eligible reward ledger entries are retried.
- A completed session allows a new lobby in the same guild; other guilds remain independent.
- Existing giveaways, Hatchem, Points and listings still work.

## Timing notes

Each game is three rounds. Each participant writes **two answers per round**, one for each distinct prompt and matchup rotation. The lobby, entry window, individual questions/results, round breaks and final standings create an ordered record of new Discord messages. Answers remain open for the full **90 seconds**; voting begins automatically when that period ends. With 2+ players, **one question is shown at a time, for 30 seconds of voting each**; the reveal lasts 8 seconds. Solo players receive two 8-second reveals without voting. Following rounds 1 and 2, a **minimum 10-second intermission** is followed by an indefinite staff-controlled wait: only an admin pressing **Start Next Round** (or `/party next`) begins the next timed round. With 20 players, there are 20 voting questions per round, so a full three-round game will take considerably longer than with small rosters. A 5-second sweeper means timer transitions may be a few seconds late. Discord relative timestamps are used.

## Player counts and rewards

Staff can start whenever at least one member joins; there is **no minimum group size** beyond having someone to play. Each player participates in two matchups per round. A one-player game is a prompt-and-reveal showcase rather than a head-to-head contest, so it does not award a competitive placement. Completion Points remain possible after two submitted answers and are still limited to two rewarded games per UTC day. A two-player game works normally with outside audience votes; if no votes are cast, the round points split evenly.

## Duplicate Replit processes and interaction timeout checks

Use Replit's Stop button first. In Replit Shell run `ps -eo pid,ppid,args | grep -E '[n]ode .*index\.js|[n]pm (start|run)'`. If there are leftover bot processes, use `kill PID` for each verified **bot** PID. Do not use `pkill node` because that can terminate unrelated Replit services. Restart once, with one Run button OR one `npm start`, not both. Startup logs include the process PID. If Discord shows "The application did not respond", check the Replit logs for `Interaction failed`, `Unknown interaction`, `DiscordAPIError`, or another bot PID. After fixes, restart and re-register using development credentials.

## Important limitations in first iteration

- 90 original prompts are included as a starter pack (30 per category).
- Staff permissions currently mean Manage Server; a separate Game Night Host role is not yet configurable.
- The session is intended for a single active game per server; an event playlist and lobby replay are future enhancements.
- Player answer moderation is basic: link/mass-mention rejection plus staff removal. Continue using Discord AutoMod and human staff oversight.
- Points rewards may be delayed until the reconciliation sweep completes. Any payout failures are retried.
- Session state has automated unit tests, but a full end-to-end multi-user Discord test must be completed before production approval.

## Permanent public game history

The game no longer edits the original lobby message through all phases. Instead:

1. On `/party start` or `/party host`, staff chooses **Court of Chaos** using the optional slash `game` field or the private game picker. Only **after selection** does a signup lobby post appear with **Join, Leave, Start Party** buttons. The lobby stays open indefinitely until the staff user who created it presses **Start Party**. Only then are the lobby buttons removed and the answering phase opened in a new message.
2. A **new round-answering post** provides a private prompt button and 90-second entry countdown. When the entry period closes, that post is marked closed; it stays visible.
3. Every question is **its own new public voting message** with 30 seconds of voting. When the timer closes, **the same question message** is edited to display its answer results, names and points, and the vote controls are removed.
4. After the 8-second reveal, another question begins in **a new message**. Nothing in the previous question is replaced or erased.
5. A new round-standings post contains the staff-only **Start Next Round** button. When staff begins the next round, the completed round post remains, but the obsolete button is removed.
6. Round 3 ends with a new permanent final-standings post. Cancellation also gets its own record.

The bot records the Discord message ID for each stage in MongoDB, so normal restart/reconciliation will edit the correct historical question rather than overwriting a different one. If a send is interrupted before its ID is saved, the bot searches recent channel messages for the session/stage marker before attempting a replacement. Keep the Party Games channel writable/readable to the bot. Previous games using the old single-message format are not retroactively reconstructed if their matchups were never recorded.

## Initial lobby start permissions and game selection

- A lobby shows the host's mention plus three buttons: **Join**, **Leave**, and **Start Party**. The Start Party button is visible to everyone, but only the user who created that lobby **and still has Manage Server permission** may use it. Everyone else gets a private denial without starting the game.
- Both `/party start` and `/party host` let staff choose the game in a slash-command `game` field, or via the **private dropdown** when that field is omitted. A game must be chosen; it never silently defaults to Court of Chaos. Round 1 starts only when the original host clicks **Start Party**.
- The game-selection step creates no lobby until a game is chosen. The resulting signup lobby starts with zero joined members and no countdown. The **Start Party** button is the separate, host-only action that requires at least one joined player and begins Round 1. Both actions guard against an existing active lobby/game. Staff retain their existing round-management commands.
- This change adds a slash-command option, so run **`node register-commands.js`** on the **development bot** after pulling the branch. Do not run the development registration against the live application's credentials.

## Game picker checks

- Run `/party start` without specifying `game`; it should show a private dropdown titled **Choose your Party Game**, not automatically create a Court of Chaos lobby.
- Select **Court of Chaos**. Only now should a public signup lobby with **Join / Leave / Start Party** appear in the configured Party Games channel. The lobby has zero players and no countdown.
- Run `/party host` without specifying a game; it must also show the picker, preserving any requested category and rewards settings.
- If the slash-command `game` option was explicitly supplied, that already counts as choosing the game; there is no need to choose twice.
- A different staff member cannot use someone else's private picker. Invalid selections must not create a lobby.
- Re-register slash commands in Replit using the development bot's token and application ID, then restart. Discord can cache old command definitions; reload the client if stale options remain.

## Entry confirmation and private-message cleanup (Nov 2)

- Entry is **90 seconds for two prompts**, and the duration is anchored to the time the public answering message actually appears. The bot must not shorten the timer when answers are submitted early.
- Use **My Prompts & Answers** once. Both questions and their saved/unsaved statuses appear in **one private panel**. Tap **Answer Question 1**, submit its modal, and expect that same panel to update showing Question 1 as saved and Question 2 as pending. Repeat for Question 2; the same panel should show **both saved**.
- A modal opened from the private prompt panel acknowledges with a message update rather than posting a second private confirmation. This avoids contradictory stale ephemeral messages. Older client modal behavior with no originating message still uses a private fallback reply.
- When time expires, the public entry post is closed and each separate public vote question appears normally (30 seconds to read/vote). The private message is only a submission interface, not the public answer record.
- Regression test the two-modal sequence on desktop Discord and mobile Discord, including editing a previously saved answer and clicking the panel again to read the stored values.

## Public Discord embeds and quiet signup

- All public Court posts now use **Discord embeds**, including the open signup lobby, closed lobby, each timed 90-second entry post, each 30-second voting question, the in-place revealed answer/vote/points result, the between-round standings, final standings and cancellation record.
- Embed colors distinguish lobby/round entry/voting/result/standings. The public message body is empty; the game/stage recovery identifier lives in the **embed footer**, keeping the Discord channel more readable. The publisher can still find messages created by older code, where the marker was in the message body.
- The **Join** button silently acknowledges a successful signup: the member appears in the updated lobby embed instead of receiving a redundant private `You joined` notice. If signup is closed, full, or they have already joined, the bot still gives a private explanation.
- The **Leave** button retains its existing acknowledgement for clarity; the public lobby embed updates the player list as before.
- Saved-answer panels and modals remain private; only public game-history posts are changed to embeds. Do not remove permanent question/result messages when changing the visual layout.
- Regression tests cover all public phases as embeds, silent join, private error replies, multi-question voting, recovery markers, and restored history after a restart. Run a two-player Discord playtest before merging.

## November 2: UI polish, private panel cleanup, and a manual prize

- **Round start buttons are quiet.** Clicking **Start Party** or **Start Next Round** updates the public game record without sending an additional private "Round started" confirmation. Failed permissions, stale buttons or too-early starts still get a private explanation.
- The private **My Prompts & Answers** panel displays both questions. Once a response is stored, its edit button changes from **blue to green**, while unanswered questions stay blue.
- The bot retains only short-lived ephemeral interaction handles in memory to call `deleteReply()` when the 90-second answer period ends (or staff ends the game). Opening a newer prompt panel deletes the older one. This is **best effort**: if the bot restarts, the interaction expires, or Discord has already dismissed a private reply, it may not be removable remotely. Private answers and interaction tokens are **not saved to MongoDB** for this feature. Errors do not stop gameplay.
- The voting question itself is now the **large embed title**, with **Answer A / Answer B** as separate readable fields and the countdown in the description. The round and matchup positions are in the footer. The recovery identifier remains there in abbreviated form, so restarts still recover existing posts.
- Game scores from voting are **not** the same as AM Isa Points currency. The final embed explicitly describes the Points rewards: **+5 Points** for qualified completion (2 or more rounds), **+10 first**, **+6 second**, **+3 third** placement bonuses, limited to **two rewarded games per UTC day**.
- A party's **original host** may run `/party prize message:<custom text>` while the game is active. This adds an optional **first-place prize** announcement to the final standings, with winner mentions. Example: `/party prize message:Winner receives a Mystery Egg!`. The bot **does not automatically transfer Roblox pets, eggs or other physical/in-game prizes**; staff arrange fulfillment. The prize text is limited to 300 characters without links or mass mentions. This separate command works after selecting the game via a private picker.
- The extra `/party prize` subcommand **requires rerunning `node register-commands.js`** using Replit development bot credentials, followed by restarting the bot.
