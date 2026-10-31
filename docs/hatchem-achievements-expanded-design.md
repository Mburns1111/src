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

**All twelve achievements in this section are SECRET.** The titles, emojis, requirements, progress, tier, and reward amounts in this design document are **owner/developer reference only**; they must never appear in the player-facing achievements menu or player-facing autocomplete before a member has unlocked that specific achievement. Ordinary Basic/Medium/Advanced achievements, release-completion goals, recurring 50-grab/drop milestones, and reviewed high-value collection goals remain visible.

| Internal title (revealed after unlock) | Internal unlock rule (hidden before unlock) | Internal reward tier |
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

- While locked, the player's `.achievements` interface shows **🔒 Secret Achievements: 0/12 discovered** (or the real discovered count) and a single **❔ Undiscovered secrets** summary. It must **not** show twelve repeated `???` rows, individual clues, progress bars, titles, emojis, goals, rarity/value criteria, tier labels, or reward previews. Keep the main list compact.
- Once a secret is earned, reveal its **name, emoji, description, tier, and the bonus grab/drop award** in that collector's achievements list. Move it into the discovered-secret section. Keep other secrets hidden.
- On unlock, send the collector a short message such as: **✨ Secret achievement discovered! 🧩 Matchy Matchy — +1 bonus drop.** Respect channel permissions and avoid @everyone / role pings. If the notification fails, preserve the earned badge and reward, and reveal it the next time the member opens `.achievements`.
- Secret status is **per collector**, not per server. Discovering the badge once reveals it across all participating guilds, with a one-time reward. One person revealing a secret must not reveal its requirements or progress in another collector's `.achievements` UI.
- Server-wide announcement is optional later; for initial launch, default to a **private/ephemeral unlocked notification** so secrets stay discoverable by other players. Players may share their achievement screenshots themselves.
- Treat secret status as **presentation metadata** (e.g. `hiddenUntilEarned: true`), not a different reward calculation. Detection, durable granting, and audit still run normally, including automatically on eligible events; do not require opening the achievements menu.
- Do not expose secret goals via command autocomplete, public help, preview panels, completion percentages for specific hidden achievements, or a JSON dump of the public achievements list. Server-side developer configuration may keep the full definitions.
- Rewards follow the existing internal tier for each secret. **Only earned secrets contribute bonus grabs/drops**. No hint or progress notifications before discovery. Secret unlocks never revoke.
- Manual test with two users: A unlocks a secret and sees its details/reward, B still sees only a secret count, duplicate events do not duplicate the reward, and a bot restart preserves each player's independent reveal state.

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

**Total proposed catalog:** 10 basic + 12 medium + 12 advanced + **12 secret** + 4 visible reviewed-value = 50 named achievement definitions, plus unbounded grab/drop milestones, plus one per release completion. The existing ten implemented badges are unchanged; secret achievement detection/UI and bonus awards are not yet activated.
