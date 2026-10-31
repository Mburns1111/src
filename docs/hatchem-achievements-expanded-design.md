# Hatchem — Expanded Achievements & Bonus Actions (design; NOT activated)

**Status:** This is the agreed direction and proposed expanded achievement catalog, **not an implementation or a promise that rewards are currently credited**. Current `services/card-achievements.js` still contains ten badges and no bonus-cooldown token awards. Before members test rewards, implement this spec and test one-time award/refund behavior on the development branch. Do not merge into `main` or deploy to Wispbyte without approval.

## Reward tiers

| Tier | Award per newly unlocked achievement | Meaning |
| --- | --- | --- |
| Basic 🌱 | +1 bonus grab | One additional eligible grab while five-minute per-guild grab cooldown is active |
| Medium ⭐ | +1 bonus drop | One additional player egg drop while global 15-minute drop cooldown is active |
| Advanced 👑 | +2 bonus grabs and +1 bonus drop | Permanent stored bonus uses until spent |

Each milestone unlocks **once per Discord collector**, not once per server. Bonus uses are global persistent wallet balances. They do not permanently shorten cooldowns, cannot bypass the one-entry-per-egg restriction, and must not be consumed when the normal cooldown is free. Failed drops, displaced grab entrants, and losing entries must refund their bonus in the same way as ordinary action cooldowns, without double refunds. Owner/test drops **do not count** toward achievements or consume bonuses. Do not award currency Points.

## Basic 🌱 — +1 bonus grab each (10)

| ID | Title | Requirement |
| --- | --- | --- |
| first-hatch | 🥚 First Hatch | Win first card from a player egg |
| ten-grabs | 🐣 Egg Enthusiast | Win 10 cards from player eggs |
| first-drop | 🪺 Egg Starter | Create first player egg drop |
| ten-drops | 🌻 Egg Gardener | Create 10 player egg drops |
| first-trade | 🤝 Trading Partners | Complete first two-sided trade |
| first-gift | 💝 Generous Heart | Send first completed gift |
| first-burn | 🔥 First Sparks | Burn first physical card |
| first-neon | ✨ Neon Alchemist | Create first Neon |
| five-pet-types | 🐾 New Faces | Acquire five distinct pet designs |
| first-lock | 🔒 Keeper | Lock a card for the first time (requires a persisted lock event, not only the current lock boolean) |

## Medium ⭐ — +1 bonus drop each (12)

| ID | Title | Requirement |
| --- | --- | --- |
| all-rarities | 🌈 Taste the Rainbow | Acquire at least one card in all five rarities |
| ten-of-a-kind | 🃏 Ten of a Kind | Acquire **10 distinct physical copies** of one pet design from the same release, over time |
| twenty-five-pets | 📚 Curious Collector | Acquire 25 different pet designs |
| five-trades | ⚖️ Trusted Trader | Complete five two-sided trades |
| five-gifts | 🎁 Gift Giver | Send five gifts |
| ten-burns | 🪵 Ember Keeper | Burn 10 physical cards |
| three-neons | 💡 Neon Crafter | Create three Neons |
| first-mega | 🌌 Mega Magic | Create first Mega Neon |
| legendary-grab | 💛 Golden Find | Win a Legendary from a player drop |
| ten-legendary-grabs | 🦁 Legend Seeker | Win 10 Legendary cards in player drops |
| three-gift-recipients | 🎀 Making Friends | Send completed gifts to 3 distinct members |
| twenty-five-drops | 🌺 Egg Planter | Create 25 player egg drops |

## Advanced 👑 — +2 bonus grabs and +1 bonus drop each (12)

| ID | Title | Requirement |
| --- | --- | --- |
| full-release-{releaseId} | 👑 Egg Completionist | Acquire one of **every enabled pet card design within one specific release**; awarded separately for each release |
| hundred-pet-types | 🌍 World Collector | Acquire 100 distinct pet designs across releases |
| ten-neons | 🌟 Neon Artisan | Create 10 Neons |
| three-megas | 🌠 Mega Crafter | Create three Mega Neons |
| twenty-trades | 👑 Trade Master | Complete 20 two-sided trades |
| twenty-gifts | 🌷 Giving Tree | Send 20 completed gifts |
| fifty-burns | 🔥 Eternal Flame | Burn 50 physical cards |
| ten-distinct-legendaries | 💎 Legendary Library | Acquire 10 different Legendary pet designs |
| rainbow-neons | 🎇 Neon Spectrum | Currently own a Neon of each of the five rarities |
| triple-stages | 🪄 Evolution Set | Currently own Normal, Neon, and Mega Neon of the **same release pet design** |
| ultra-collector | 🧸 Pet Parade | Currently own 75 distinct pet designs |
| five-megas | 🦋 Mega Menagerie | Create five Mega Neons |

## Secret achievements — Weird and special badges (12; hidden until earned)

**All twelve achievements in this section are SECRET TO EVERYONE EXCEPT THEIR DISCOVERERS.** The exact names and triggers in this owner/developer document must **never appear in public messages or public lists**, including after discovery. Once a player earns a secret, **that player privately learns its actual name, what they did to unlock it, and their reward**. The player may share that information by word of mouth; Hatchem itself never reveals it publicly. Ordinary Basic/Medium/Advanced achievements, release-completion goals, recurring 50-grab/drop milestones, and reviewed high-value collection goals remain visible.

| Secret title (private to discoverers) | Unlock condition (private to discoverers) | Internal reward tier |
| --- | --- | --- |
| 🧩 Matchy Matchy | A player egg reveals three instances of the same pet design (creator only; award for dropping the egg) | Medium |
| 🎰 Triple Trouble | A player egg reveals three different rarities | Basic |
| 🪅 Copycat | Send two physical copies of the same pet in one completed gift | Basic |
| 🧡 Friends Everywhere | Send gifts to five different recipients | Medium |
| 🔠 Alphabet Soup | Currently own five different pet designs whose names start with the same letter | Medium |
| 🍀 Lucky Seven | Acquire seven distinct physical copies of one pet design across its lifetime | Medium |
| 🧷 Precious Cargo | Have ten cards locked at the same time | Medium |
| 🔥 Beautiful Disaster | Burn a Mega Neon | Advanced |
| 🪄 Alchemy Is Expensive | Complete a dust-assisted Mega Neon upgrade | Advanced |
| 🍳 Full Breakfast | Complete a successful grab, create a player egg drop, and complete a trade on the **same UTC calendar date** | Medium |
| 👀 Twins Again | Acquire two distinct Legendary copies of the same pet from player drops | Medium |
| 🕯️ Vintage Keeper | Currently own a card from a retired release | Advanced |

### Secret achievement discovery and presentation rules

- While locked, the player's `.achievements` interface shows **🔒 Permanent Secrets: 0/12 discovered** alongside compact per-release counts (or the actual discovered counts) and a single **❔ Undiscovered secrets** summary. It must **not** show twelve repeated `???` rows, individual clues, progress bars, titles, emojis, goals, rarity/value criteria, tier labels, or reward previews. Keep the main list compact.
- Once earned, show the **full secret name, emoji, specific unlock condition, achievement date, and bonus earned to that collector only**, via an ephemeral response or direct message. The collector can always review these details later **privately**. Undiscovered secrets remain completely hidden; public surfaces show only anonymous secret numbers.
- On unlock, send **two distinct notices**: **(1) public:** a collector discovered a secret, optionally with their Hall of Fame position and anonymous secret number, **without naming or explaining it**; **(2) private/ephemeral to the collector:** the *actual* achievement title, emoji, description of what triggered it, and earned bonus. Example private message: **✨ Secret discovered! 🧩 Matchy Matchy — Your egg revealed three of the same pet. Reward: +1 bonus drop.** If private delivery fails, do not lose the badge/reward and let the collector view those details privately later.
- Secret status is **per collector**, not per server. Discovering the badge once reveals it across all participating guilds, with a one-time reward. One person revealing a secret must not reveal its requirements or progress in another collector's `.achievements` UI.
- **Public announcement on every secret unlock is allowed**: **🔮 Lilly discovered a secret Hatchem achievement!** First/Second/Third Discoverer announcements may also show an opaque category/number, e.g. **Series 1 · Secret 04**, with the member's rank. **No public title, emoji that identifies the secret, criteria, hint, tier, or reward.** Players can tell others voluntarily; the bot does not confirm solutions publicly.
- Treat secret status as **presentation metadata** (e.g. `hiddenUntilEarned: true`), not a different reward calculation. Detection, durable granting, and audit still run normally, including automatically on eligible events; do not require opening the achievements menu.
- Do not expose secret goals via command autocomplete, public help, preview panels, completion percentages for specific hidden achievements, or a JSON dump of the public achievements list. Server-side developer configuration may keep the full definitions.
- Rewards follow the existing internal tier for each secret. **Only earned secrets contribute bonus grabs/drops**. No hint or progress notifications before discovery. Secret unlocks never revoke.
- Manual test with two users: A gets the **public generic announcement** and sees a **private name, exact condition, and reward**; B sees only a generic secret count; public Hall of Fame displays anonymous IDs and discoverer ranks. Duplicate triggers must not duplicate announcements, ranks, or awards; a restart preserves independent unlock history.

## 🏛️ Secret Achievement Hall of Fame (proposed; not implemented)

Each secret has a **global first-discoverer record** across all participating Hatchem servers. Celebrate the first **three distinct collectors**, with permanent placements: 🥇 **First Discoverer**, 🥈 **Second Discoverer**, and 🥉 **Third Discoverer**. Later players can earn the same badge and tier reward but do not displace those three. A separate Hall of Fame applies to **every secret**, including secrets added for future releases.

- **Before anyone discovers it:** do not reveal its name, emoji, criteria, reward, or individual Hall of Fame slot. Show only an aggregate count of undiscovered secrets.
- **After the first discovery:** display only a stable, anonymous secret number within its category, e.g. `Permanent · Secret 04` or `Series 1 · Secret 02`, with first/second/third discoverer names and dates. **Never reveal its real title, emoji, trigger, criteria, or reward** on the public Hall of Fame, even after all three places are filled.
- Proposed commands: **\`.halloffame\`** or **\`.hof\`**, with a release selector or browsable release categories. The current live code does **not** have these commands yet.
- The winner privately receives the **true achievement name, complete unlock explanation, and normal tier reward**. Public unlock/rank announcements reveal **only** that a secret was earned, the discoverer's display name, and (if ranked) an anonymous numbered secret and rank—without @mention pings. Hall of Fame entries use durable Discord IDs internally so renaming or leaving a guild does not erase history.
- Use the **actual achievement-completion event time**, not the time the member first opens \`.achievements\`, to establish order. Atomically claim rank slots with a unique database constraint per \`(achievementKey, rank)\`, and prohibit duplicate placements for \`(achievementKey, discordUserId)\`. Handle simultaneous events deterministically and prevent retries/restarts from awarding rank or bonus rewards twice.
- The achievement's **full identity** should be namespaced by release where applicable: e.g. \`secret:global:matchy-matchy\` versus \`secret:test-s1-r1:midnight-visitor\`. Distinct release-specific achievements cannot overwrite or reuse older Hall of Fame ranks.
- Early test achievements are not automatically eligible for retroactive world-first rankings. Begin official ranking only when durable event logging and achievement rewards are activated; clearly distinguish test data from official records.
- Rankings are **permanent and archival**. Old releases and their first discoverers remain visible long after an egg is retired.

Example public panel, only **after** the secret has been discovered:

> 🏛️ **Hatchem · Secret Hall of Fame**
>
> 🔒 **Permanent · Secret 04**
>
> 🥇 First Discoverer: Lilly · Oct 31, 2026
>
> 🥈 Second Discoverer: Jentho · Nov 1, 2026
>
> 🥉 Third Discoverer: Not yet discovered
>
> ❔ 11 permanent secrets remain undiscovered

*Names and dates above are illustrative only, not live achievements.*

## 🥚 New Secret Achievements With Every Egg Release (proposed)

**Add new secret achievements for EVERY release** while retaining the **12 permanent global secrets**. Start with a default of **six additional themed secrets per release** (two Basic, two Medium, two Advanced); larger special/holiday releases may have more. These are **new, distinct achievements**—not resets of previous release goals. Each uses the same bonus-grab/drop rewards associated with its tier and gets its own independent first/second/third Hall of Fame rankings.

**Creation and lifetime rules:**

1. Author, review, and freeze the release-specific secret list *before* activating that release. Each has a unique key tied to its immutable \`releaseId\`, a tier, a private trigger definition, and an explicit availability policy.
2. Design conditions tied to the egg's **pets, artwork, season, rarity, card combinations, or unusual player behavior**—not just six ordinary high-count milestones. Keep conditions realistically achievable given that egg's card roster and drop rules. Avoid rewards requiring unapproved artwork or unpublished card values.
3. Include a mix of **during-release discoveries** (must happen while the egg is active) and **legacy discoveries** (still achievable using that release's cards after retirement). Make this distinction explicit in the private definition. Do not invalidate already earned badges when a release retires.
4. Each release's Hall of Fame starts with empty slots. Old discoverers never lose rank. The public Hall of Fame can be filtered by **Current Release**, **Past Releases**, and **Permanent Secrets**, and shows only **opaque numbered entries** for already-discovered secrets; their real names and criteria remain hidden forever.
5. Players' \`.achievements\` menus should show one compact aggregate, e.g. **🔒 Permanent Secrets: 2/12 · Series 1 Secrets: 1/6**, without listing individual undiscovered challenges, hints, tier rewards, or progress. When a release is retired, keep earned and archived release achievements accessible.
6. If a secret's trigger is no longer possible, show it as **archived**, not still earnable. Do not delete earned badges or ranks.
7. Preserve first-discovery competition across all guilds. Prevent gaming via multi-accounts and repeated trades to the extent practical using exact card IDs and server-side event history. No manually granted rank from player commands.
8. Before official launch, test simultaneous achievements on two users, rewards exactly once, old ranks persisting across a release change, secret descriptions not leaking through command results, and whether retired-release achievements remain visible.

### Example themes for six Series 1 secrets (owner-only ideas, not finalized)

These are **concepts**, not currently enabled achievements. The final titles, pets, requirements, and availability windows should be chosen after the Series 1 roster and approved artwork are locked.

| Hidden concept | Secret triggering idea | Tier |
| --- | --- | --- |
| 🐣 Early Bird | Be among the first collectors to grab a Series 1 card during the official launch window | Basic |
| 🧩 Strange Neighbors | Acquire an unusual combination of two specific Series 1 pet designs | Basic |
| 🎨 Hidden Detail | Collect a specific artist-approved art/variant combination from Series 1 | Medium |
| 🌗 Day and Night | Complete two complementary Series 1 collection actions at different times | Medium |
| 💠 Rarity Ritual | Upgrade a themed group of Series 1 pets across stages | Advanced |
| 👑 Egg's Secret | Achieve a rare, roster-specific Series 1 card combination | Advanced |

*These examples are developer-only. Their names, descriptions, and triggers must never leak into public help or the Hall of Fame, even after the first unlock. Word of mouth is player-directed; the bot does not confirm solutions.*

### Public secrecy / private discovery rule (overrides all other wording)

**Hatchem never publishes secret names or solutions in a public channel, including after discovery or an egg's retirement.** A public notice **does** celebrate each secret being earned, and Hall of Fame placements remain public with anonymous numbered IDs. **The successful collector privately receives the actual secret name, the exact requirement they met, and the earned bonus**, and may view that information later in a **private/ephemeral** achievements screen or DM. Members are free to discuss discoveries by word of mouth; Hatchem does not automatically disclose them to other players. The text-command implementation must **not** print earned secret details as a normal public channel reply.

## Reviewed high-value card achievements (4; DO NOT substitute rarity)

A base-pet value is ONLY `CardDefinition.valueReview.valueScore` when a reviewed score is present. The game does not presently guarantee score coverage or a fixed scale. **Never invent numeric score thresholds or a Neon/Mega value multiplier.** Use release-relative ranking of reviewed card definitions, with at least **20 distinct reviewed definitions** in that release before evaluating a high-value award. Ties at the threshold qualify. No value achievement is granted on unreviewed/placeholder scores.

| Title | Requirement | Tier |
| --- | --- | --- |
| 💠 Diamond in the Rough | Acquire a card whose reviewed base value is in the top 20% of one eligible release | Medium |
| 💎 Crown Jewel | Acquire a card in the top 10% of one eligible release's reviewed scores | Advanced |
| 🔮 Treasure Trove | Currently own three **distinct pet designs** that individually qualify for top 20% reviewed scores | Advanced |
| 🌟 High-Stakes Trade | Receive a top-10%-reviewed pet from a completed two-sided trade (not a gift) | Advanced |

## Recurring player-drop and successful-grab achievements: EVERY 50, forever

Two independent progress tracks, using **all-time successful CardClaim winners** for grabs, and **player-generated CardDrop records** for drops. Do not count admin/test drops, unsuccessful entries, or cards merely received by trade/gift. Issue exactly one unique award for each threshold per action (`grab-50`, `grab-100`, etc., `drop-50`, `drop-100`, etc.). Milestones do not stop at 200, 500 or 1000; calculate the next threshold dynamically. In `.achievements`, show the nearest upcoming threshold and recent earned milestones, rather than flooding Discord with a never-ending list.

| Threshold for each of grab/drop separately | Tier | Award per milestone |
| --- | --- | --- |
| 50, 100, 150 | Basic | +1 bonus grab |
| 200, 250, 300, 350, 400, 450 | Medium | +1 bonus drop |
| 500, 550, 600… (every 50 indefinitely) | Advanced | +2 bonus grabs, +1 bonus drop |

## Definitions and anti-farming rules

1. **One of every type** means every **pet/card definition in the same release**, not every individual 5-character card ID, upgrade stage or every Adopt Me pet in the full catalog. Use a **frozen/announced release roster**; future editorial additions should not silently invalidate a previously earned completion badge. There is also a separate achievement for one of every rarity.
2. **Ten of a Kind** means acquiring ten *distinct physical copies* of the exact pet design/release, not entering the same public card ID ten times. Upgrades, burning, or trading away cards must NOT erase lifetime progress. Reacquiring the exact same ID does not count twice.
3. Lifetime acquisition needs a new **per-owner, per-copy acquisition ledger** capturing original successful grabs, gift receipts, trade receipts and future admin-issued copies. The current live `CardCopy.ownerDiscordUserId` is **not sufficient** to reconstruct all previous owners; avoid awarding retroactive full-release/ten-copy claims from ownership alone. Seed only verifiable historical data (e.g. recorded claims/transactions), without guessing missing past owners.
4. **Currently own** is explicitly used where the challenge is a displayable collection. Counts exclude burned/consumed copies. Locks count only while active; lock event badges need a separate audit trigger.
5. Completed trade/gift counting is on saved `CardTrade` status = completed. Never reward canceled/expired offers. Counting actions involving different partners is explicitly stated where needed. Repeated trading of the same card cannot count toward lifetime *acquisition* milestones more than once.
6. Repeated milestone grants and bonus credits require an **idempotent transactional reward ledger**, including existing achievements earned before the reward system existed. Current `CardAchievement` rows have no reward-granted state; migrate/settle once only, not on every `.achievements` refresh. Any unlock initiated by a player action must be durable even across restarts. To avoid spikes, show claim/earn notification without mass-pinging.
7. High-value thresholds can shift as reviews are updated; **once earned, badges remain earned**. A current collection badge can display its current progress without revoking already unlocked badge/reward.
8. All user-facing event/achievement bonuses are tracked in MongoDB, across all guilds. Must be validated with two accounts, duplicate interactions, rollback/restart, refunds, and concurrent actions before production.

**Total proposed catalog:** 10 basic + 12 medium + 12 advanced + **12 permanent secrets** + 4 visible reviewed-value = 50 named achievement definitions, **plus six new secret achievements by default per release**, unbounded grab/drop milestones, and one per release completion. The existing ten implemented badges are unchanged; secret detection/UI, Hall of Fame rankings, and bonus awards are not yet activated.
