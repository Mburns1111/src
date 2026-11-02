# Hatchem — random and activity-based automatic egg drops

**Status:** Implemented on development branch `feature/card-game-foundation`; globally fixed rules for every server with a configured Hatchem channel and Card role. Do not deploy to Wispbyte until the bot is explicitly approved for production.

## Timing

- **Timed eggs:** Every configured server receives an automatic egg at a random interval of **45–75 minutes**, independently per server. The next due timestamp is stored in `GuildConfig.hatchemNextAutoDropAt`; restart does not cause a second immediate egg or reset the timing window.
- **Activity bonus eggs:** Genuine chat activity across the server can trigger extra eggs, separate from the timed cycle. Once **12 substantial messages from at least 3 different human members within 10 minutes** qualify, Hatchem makes a **20% chance roll**. A roll can be attempted at most once every 10 minutes.
- **Anti-spam:** At most one qualifying message per member per 60 seconds. Bots, webhooks, system messages, dot/slash commands, short messages, and URL/mention-only messages do not count. The bot keeps only user IDs and timestamps in short-lived memory, not chat content. Restarting clears the in-memory activity window, not the durable drop timing.
- **Spacing:** All automatic eggs in one server must be separated by at least **15 minutes**; bonus eggs have an additional **30-minute cooldown** after a successful bonus roll. The timed schedule is **not reset** by bonus eggs; a due timed drop waits if another automatic egg was too recent.
- **Visibility and ping:** All automatic eggs appear in the configured Hatchem channel and mention **that server\'s Card role**; only this role is whitelisted in Discord allowed mentions. The bot must have permission to mention it (or the role must be mentionable) for notifications. Conversation activity elsewhere in the same server can trigger bonus eggs. An active egg release and suitable approved artwork are required.

## Existing gameplay

- Three visible cards per egg, 75-second entry window. No automatic egg creator gets a guaranteed pick.
- `.drop` remains available to registered players, with the existing **15-minute global player drop cooldown** and purchased Extra Drops.
- Entry to automatic eggs requires registration and the local Card role. **5-minute grab cooldown per server** applies; losing/invalid/displaced reservations follow the existing refund logic. Automatic eggs never consume anyone's player drop allowance or purchased Extra Drops.
- The real release must be approved and active for real rewards. The existing `test-s1-r1` fallback is development-only and never earns official achievements.

## Server setup

There is **no server-level auto-drop toggle or rate setting**. The global 45–75 minute random schedule and activity bonus rules apply identically in every server where Hatchem has a configured channel and local Card role. `/cards-admin setup-role` remains available for server managers to choose their local registration/ping role, but it cannot change automatic drops. Each server keeps its own due timestamps and activity counts. Slash command changes require re-running `node register-commands.js` on Replit. Official release activation remains owner-only.

All scheduling uses durable conditional MongoDB writes to avoid duplicate automatic eggs from competing bot processes. If a Discord send fails after the slot is claimed, that one attempt can be missed rather than producing duplicate messages; the next interval remains scheduled.

## Manual Discord checks before production

1. Set `ENABLE_CARD_GAME_TEST=1`, pull the development branch, re-register slash commands, restart the test bot.
2. Confirm no `auto-drops` server-manager command exists. A server with a configured Hatchem channel and Card role should get a due time 45–75 minutes after its first scheduler initialization.
3. Verify one automatic egg posts in Hatchem on schedule, **pings only the local Card role**, contains three rendered cards, and closes after 75 seconds without a creator priority pick.
4. Verify registration, per-server grab cooldown and loser refunds for automatic eggs. Neither player drop cooldowns nor purchased drop tokens should change.
5. Generate normal conversation from three members. Only substantial, paced messages count; bots, short chatter and commands do not count. On a lucky 20% roll, a bonus egg may appear, but is not guaranteed.
6. Verify the 15-minute global spacing between automatic eggs, 30-minute activity bonus limit, and independent 45–75m schedule.
7. Restart the bot and verify the stored due time is preserved. Confirm the scheduler does not post eggs to servers with no configured Hatchem channel or Card role.
8. Test in a second Discord server: **same fixed rules**, independently randomized timing and activity, with a ping of the second server\'s own Card role.

**Achievement tracking** remains intentionally postponed to the official live launch: test egg releases cannot earn progress.
