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
7. Staff runs /party start. Members use My Prompt & Answer, then Submit or Edit Answer in the private modal.
8. With 2+ players, after 90 seconds, noncontestants and spectators vote via the buttons (30 seconds per batch, two matchups per batch). Solo games skip voting and show their submitted answer.
9. Observe each reveal (8 seconds) and the 10-second intermission after rounds 1 and 2. The game ends after round 3.
10. Review the leaderboard. If rewards were enabled, check /points-admin history and audit. Verify each eligible member earns +5 completion (including solo participants with two submitted answers); placement bonuses are +10/+6/+3 only for games with multiple competitors. No more than two rewarded games per UTC date.

## Staff controls

- /setup channels party_games:#your-channel: save the dedicated Party Games channel, without changing the other channels
- /party status: phase, players and remaining time
- /party pause: stop automatic phase advances
- /party resume: resume from saved time remaining
- /party extend: add 30 seconds during answers or voting
- /party skip: advance the current phase immediately
- /party remove-answer player:@Member: remove answer before its matchup scores
- /party end: cancel the active session; no Points rewards

Only members with Manage Server can use /party commands. Regular members and spectators use the buttons. The bot displays all public results in one edited lobby message and uses private Discord responses/modal forms to avoid spamming the channel.

## Regression checks

- A non-staff member cannot host, start, pause or cancel.
- Only lobby members can answer; all server members except matchup contestants can vote.
- Answers are hidden until voting. Votes are hidden until the reveal.
- A vote can be changed until the deadline without increasing the ballot count.
- No answer means forfeit (no matchup points when fewer than two valid answers remain).
- One player creates a solo showcase (no vote buttons, no competitive points, no placement bonus).
- Two players compete head-to-head; three players share one three-person matchup.
- Larger odd lobbies produce one three-contestant matchup.
- Two simultaneous joins/answers/votes don't duplicate membership or ballots.
- A staff-removed answer disappears from vote options before its result is scored.
- Bot restart during answering, voting, and reveal resumes safely.
- Cancelled games do not pay rewards.
- Reward settlement is idempotent across startup retries. Missing eligible reward ledger entries are retried.
- A completed session allows a new lobby in the same guild; other guilds remain independent.
- Existing giveaways, Hatchem, Points and listings still work.

## Timing notes

Each game is three rounds. Each participant writes one answer per round. Answers are open for 90 seconds; with 2+ players, voting happens in two-matchup 30-second batches; verdict display lasts 8 seconds; intermission lasts 10 seconds. Solo games skip the vote phase entirely. Games with 20 players will take significantly longer than games with 1–3. The timer advances in one 5-second reconciliation sweep, so deadlines may be a few seconds late. Displayed times use Discord relative timestamps.

## Player counts and rewards

Staff can start whenever at least one member joins; there is **no minimum group size** beyond having someone to play. A one-player game is a prompt-and-reveal showcase rather than a head-to-head contest, so it does not award a competitive placement. Completion Points remain possible after two submitted answers and are still limited to two rewarded games per UTC day. A two-player game works normally with outside audience votes; if no votes are cast, the round points split evenly.

## Duplicate Replit processes and interaction timeout checks

Use Replit's Stop button first. In Replit Shell run `ps -eo pid,ppid,args | grep -E '[n]ode .*index\.js|[n]pm (start|run)'`. If there are leftover bot processes, use `kill PID` for each verified **bot** PID. Do not use `pkill node` because that can terminate unrelated Replit services. Restart once, with one Run button OR one `npm start`, not both. Startup logs include the process PID. If Discord shows "The application did not respond", check the Replit logs for `Interaction failed`, `Unknown interaction`, `DiscordAPIError`, or another bot PID. After fixes, restart and re-register using development credentials.

## Important limitations in first iteration

- 90 original prompts are included as a starter pack (30 per category).
- Staff permissions currently mean Manage Server; a separate Game Night Host role is not yet configurable.
- The session is intended for a single active game per server; an event playlist and lobby replay are future enhancements.
- Player answer moderation is basic: link/mass-mention rejection plus staff removal. Continue using Discord AutoMod and human staff oversight.
- Points rewards may be delayed until the reconciliation sweep completes. Any payout failures are retried.
- Session state has automated unit tests, but a full end-to-end multi-user Discord test must be completed before production approval.
