# Card-game foundation — draft, not live

## Gameplay decisions
- One egg artwork and pet pool per release, nested under a series.
- A drop selects its release, automatically hatches **three visible cards**, then opens grab competition.
- The egg is not awarded or stored; players know which cards they can grab.
- Per-card rarity odds: Common 26%, Uncommon 26%, Rare 26%, Ultra-Rare 14%, Legendary 8%.
- Card selection within each rarity uses staff-reviewed positive hatch weights inspired by relative trading values. Values are not scraped live; source and date can be recorded on definitions.
- Unlimited copies. Individual card copies have separate ownership and can be burned or consumed.
- Four matching normal cards become one neon; four matching neons become one mega. Consumed inputs must be logged and removed atomically when upgrade service is implemented.
- Dust is rarity-specific; substituting one card costs proposed dust by rarity: Common 8, Uncommon 6, Rare 4, Ultra-Rare 4, Legendary 4. At least one actual matching pet card is needed. Dust burn rewards and upgraded-card dust values are not finalized.
- A release is initially **draft**; a card is not hatchable until art is **approved** and it is explicitly enabled.
- Missing rarities in a release are renormalized among available ones; before activation, staff should audit that the effective odds are acceptable.
- New collectors, grabs, dust, trade and admin interaction wiring are not implemented by this foundation commit.

## Collections
- PetCatalog: factual pet master, unchanged.
- CardSeries / CardRelease: series and releases, egg design and rarity percentages.
- CardDefinition: pet assigned to release, approved art, rarity, weighted odds. No print limit.
- CardCollector: global Discord collector identity and dust wallet.
- CardCopy: owned instances, including state, upgrade level and originating guild.

## Safe rollout
This commit adds schemas and a pure tested hatch engine only. No automatic jobs, live slash commands, Discord posts, catalog modifications, profile modifications or database writes. Future drop/grab code must persist a precomputed reveal **before** accepting interactions, use unique drop/claim guards and transactions for transfer/upgrade/burning.
