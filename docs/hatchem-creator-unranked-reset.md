# Hatchem creator-only achievement reset

The live Hatchem creator (the Discord account matching
`CARD_GAME_OWNER_DISCORD_ID`) is **unranked** whenever
`ENABLE_CARD_GAME=1` and `ENABLE_CARD_GAME_TEST` is off.
The development/test bot still permits creator achievement testing.

## One-time live reset

1. Deploy the tested update to the private production bot, retaining the
   ordinary Wispbyte startup and existing configuration.
2. In that server's configured Hatchem channel, the configured creator types
   `.creatorreset preview`. This is read-only and shows how many creator
   badges/events/acquisitions will be cleared and which outstanding achievement
   bonus extras can safely be forfeited.
3. Only after checking that preview, the creator types
   `.creatorreset CONFIRM` (uppercase, exact).
4. Reopen `.achievements`: it should show zero earned achievements and
   **Creator account · unranked**. Future gameplay still earns and trades real
   cards, but never mints creator achievement events, ranks or reward extras.

The command is not registered as a slash command and does not require command
re-registration. It is not listed in player help and refuses non-owners and
non-production installations.

## Reset boundaries

The reset runs inside one MongoDB transaction and serializes with achievement
granting via the existing AchievementControl clock guard. It deletes **only**
the creator's CardAchievement badges, AchievementEvent records and CardAcquisition
history, plus release-first tokens owned by the creator. Per-key global
discovery counters are reconciled to the highest *remaining* rank, without
editing any other user's badge or number. If the creator was the sole discoverer,
that key can start at #1 for a regular player again; a released creator-held
release-first bonus can be earned by a subsequent qualifying player.

The reset forfeits outstanding achievement extras conservatively: the current
bonus balance minus **all historical Points-purchased extra units** is the
maximum eligible for forfeiture, capped by achievement rewards. This preserves
all possible paid extras, even if some achievement rewards were already spent.
If any purchase record is unparseable, no bonus extras are debited. Any
unidentifiable residual bonus extras remain to avoid confiscating paid actions.

The reset does **not** change CardCopy ownership, card IDs, pet art, upgrades,
locks, dust, tags, registration, Points balances or ledger, cooldowns,
other players' achievements, active Series 1 release, secret configurations or
the immutable `CARD_ACHIEVEMENTS_START_AT` clock. Previously sent public
announcements or private messages cannot be automatically retracted.

The reset is intentionally irreversible from Discord, and safe to repeat: a
second confirmation sees zero remaining creator achievement records.
