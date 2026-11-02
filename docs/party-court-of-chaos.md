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
5. Create a Discord text channel for games, then run /setup channels party_games:#your-channel. As staff with Manage Server, use /party host (category and rewards optional). The lobby always posts in the configured channel, regardless of where the command was used.
6. Have 1–20 accounts use Join; Leave and rejoin; try the 21st account. Test separate 1-, 2- and 3-player games.
7. Staff runs /party start. Every player gets **two different prompts per round** through My Prompts & Answers and submits each answer with its own button/modal. The modal reply must say **Saved for Round 1** and show exactly what was stored. Clicking My Prompt & Answer again must display **Your saved answer**. Staff can use /party status to see the number of saved submissions without viewing private answers.
8. After the **full 60-second answer period**, with 2+ players, each question is shown individually with **30 seconds to read and vote**. With one player, both prompts are revealed without voting. The timer does NOT end early when all answers have been submitted.
9. Observe each reveal (8 seconds). After rounds 1 and 2 there is a **minimum 10-second break**, then staff must click **Start Next Round** on the game post (or use `/party next`). The next round **never starts automatically**. Round 3 ends with the final standings.
10. Review the leaderboard. If rewards were enabled, check /points-admin history and audit. Verify each eligible member earns +5 completion (including solo participants with two submitted answers); placement bonuses are +10/+6/+3 only for games with multiple competitors. No more than two rewarded games per UTC date.

## Staff controls

- /setup channels party_games:#your-channel: save the dedicated Party Games channel, without changing the other channels
- /party status: phase, players and remaining time
- /party next: staff starts the next round after the 10-second break; also available as a staff-only button in the Party Games message
- /party pause: stop automatic phase advances
- /party resume: resume from saved time remaining
- /party extend: add 30 seconds during answers or voting
- /party skip: advance an active answering/voting/reveal phase; it never skips the staff-only next-round action
- /party remove-answer player:@Member: remove answer before its matchup scores
- /party end: cancel the active session; no Points rewards

Only members with Manage Server can use /party commands. Regular members and spectators use the buttons. The bot displays all public results in one edited lobby message and uses private Discord responses/modal forms to avoid spamming the channel.

## Regression checks

- A non-staff member cannot host, start, pause or cancel.
- Only lobby members can answer; all server members except matchup contestants can vote.
- Answers are hidden until voting. Votes are hidden until the reveal.
- A vote can be changed until the deadline without increasing the ballot count.
- No answer means forfeit (no matchup points when fewer than two valid answers remain).
- One player gets two solo showcases (no vote buttons, no competitive points, no placement bonus).
- Two players receive two separate head-to-head prompts per round; three players share two different three-person prompts per round.
- Larger odd lobbies produce one three-contestant matchup **in each of the two rotations**, allowing everyone two appearances per round.
- Two simultaneous joins/answers/votes don't duplicate membership or ballots.
- A staff-removed answer disappears from vote options before its result is scored.
- Bot restart during answering, voting, and reveal resumes safely.
- Cancelled games do not pay rewards.
- Reward settlement is idempotent across startup retries. Missing eligible reward ledger entries are retried.
- A completed session allows a new lobby in the same guild; other guilds remain independent.
- Existing giveaways, Hatchem, Points and listings still work.

## Timing notes

Each game is three rounds. Each participant writes **two answers per round**, one for each distinct prompt and matchup rotation. Answers remain open for the full **60 seconds**; voting begins automatically when that period ends. With 2+ players, **one question is shown at a time, for 30 seconds of voting each**; the reveal lasts 8 seconds. Solo players receive two 8-second reveals without voting. Following rounds 1 and 2, a **minimum 10-second intermission** is followed by an indefinite staff-controlled wait: only an admin pressing **Start Next Round** (or `/party next`) begins the next timed round. With 20 players, there are 20 voting questions per round, so a full three-round game will take considerably longer than with small rosters. A 5-second sweeper means timer transitions may be a few seconds late. Discord relative timestamps are used.

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
