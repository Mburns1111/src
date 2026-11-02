# Hatchem — activity-only wild egg drops

**Scope:** Hatchem in `Mburns1111/src`. These rules are identical for every participating server. The feature remains behind the explicit Hatchem test/production mode switches; do not deploy to Wispbyte without owner approval.

## Activity-only eggs (no timed scheduler)

- There are **no automatic eggs every 45–75 minutes**. The previous random-timer worker has been removed. Old `GuildConfig.hatchemNextAutoDropAt` values may remain in MongoDB, but nothing reads or acts on those timestamps.
- Once **12 meaningful human messages from at least 3 separate members within a rolling 10-minute window** qualify in a guild, Hatchem makes **one 20% chance roll** for a wild egg. A roll is a *chance*, not a guaranteed drop.
- At most **one qualifying message per member per 60 seconds** is counted. Bots, webhooks, system posts, commands, very short messages, and URL/mention-only chatter do not count. The game keeps only recent member IDs and times in memory, not messages.
- The activity engine gets **at most one chance roll in any 10-minute period** per guild. After a successful roll, **30 minutes** must pass before another activity egg can succeed. It also enforces a 15-minute minimum since the last automatic egg for safety. A restart clears the in-memory activity window but does not reset persistent successful-drop cooldowns.
- An active release, suitable approved artwork, a configured Hatchem channel and a real configured Card role are required. Development test fixtures remain restricted to the test guild; live mode only uses official active releases.

## Notifications and egg edits

- Wild eggs post in the server's **Hatchem channel**, even if activity occurred in other channels.
- **The first egg message pings that guild's configured Card role** (set using `/cards-admin setup-role`). The bot validates the role exists and whitelists just its role ID in Discord's `allowedMentions.roles`; no users or @everyone are pinged.
- If someone enters a card or the egg closes, the refreshed message **keeps the visible Card role mention**, but uses `allowedMentions: { parse: [] }` to avoid notifying everyone again. The old code removed the mention from updated messages, making it appear as though the role was never tagged.
- A bot with Administrator permission can mention that role even if the role itself is not publicly mentionable. For real push notifications, members must still have role mention notifications enabled in their Discord settings.

## Existing player actions stay unchanged

- Three visible cards per egg, 75-second grab window, and random draw; no player gets creator priority on wild eggs.
- Registered members can still type `.drop` every 15 minutes globally and purchase Extra Drops with Points. **Player-initiated eggs do not ping the Card role** and do not depend on server activity.
- Grabs still have a 5-minute per-guild cooldown; losing or rejected entries are refunded. Wild eggs do not spend anyone's player drop allowances.
- Rarity, art approval, collection, upgrading, dust, shop, and achievements remain unchanged.

## Manual Discord checks

1. Restart the development bot on the new branch. No need to re-register slash commands because no command signatures changed.
2. Confirm it **never** publishes an egg merely because 45–75 minutes have elapsed, even if `hatchemNextAutoDropAt` contains an old due time.
3. Confirm the server has the Hatchem channel and Card role configured. Send genuine paced chat from at least three people until a 20% activity roll succeeds (this may take multiple activity windows).
4. The wild egg should mention exactly the configured **Card role** immediately on posting. Then enter a grab and let the egg close; its message should **still display the role mention**, with no second notification.
5. Confirm a manually created `.drop` does **not** ping that role, and that activity cannot create overlapping eggs or spend extra personal drop allowances.
6. Check that another participating server has the same rules but its own activity counts, cooldowns, and Card role.

**Release-specific secret achievements and official pet art checks are deferred until art is ready.**
