# Hatchem Series 1 — controlled launch readiness (November 4, 2026)

**Goal:** Prepare the official 108-card `s1-r1` egg for a later explicit launch.
**This checklist does not grant permission to deploy, activate an egg, merge a PR,
register production commands, or edit Wispbyte.**

> **Owner-reported Replit verification — November 5, 2026:** The official
> `s1-r1` draft passed a read-only audit for 108/108 enabled/hatchable,
> approved card and egg artwork, and 20/20 guest-art attribution links.
> A later owner-run `--verify` compared the PRIVATE six-secret JSON to
> the frozen MongoDB configuration and returned
> `privateSecretsInFile:6`, `privateSecretsInDatabase:6`,
> `frozenRosterCards:108`, `approvedRosterCards:108`,
> `rosterMatchesApproved:true`, `secretsMatchPrivateFile:true`,
> `verified:true`, `mismatches:[]`, `changesMade:false`.
> **The exact secret configuration and 108-card completion roster are now
> VERIFIED; do not reapply or overwrite them.** Remaining launch blockers:
> launch clock/reward season and separate merge/deployment/activation
> approvals. The owner confirmed all manual gameplay tests complete;
> trading-value reviews were completed in the November 5 import below.
> The owner explicitly accepted the public-source visibility of the 12
> permanent secret definitions. Release remains draft; no deployment
> or activation approved.
>
> **Owner-reported value import — November 5, 2026:** The 108-pet,
> two-source review file was checked first (`pendingReviews:108`,
> `reviewedAfter:108`, `valueAchievementCoverageReady:true`,
> `databaseChanged:false`), then imported to Replit MongoDB
> (`reviewsAdded:108`, `eggRemainsDraft:true`,
> `rarityAndHatchWeightsUnchanged:true`). The subsequent official read-only
> audit reports `reviewedValueCards:108`, `achievementWarnings:[]`,
> 108/108 hatchable approved pet art, approved egg art, all six secrets,
> and 108 frozen designs. **Artwork, roster, secret definitions and reviewed
> trading values are complete; do not re-import or re-freeze them.**
> The only remaining audit blockers are the intentionally unset official
> achievement clock (`CARD_ACHIEVEMENTS_START_AT`) and reward season
> (`CARD_REWARD_SEASON_RELEASE=s1-r1`); set these only during the authorized
> launch process. **The owner confirms the Discord gameplay and reward
> tests are complete.** Permanent-secret source visibility has been
> disclosed and accepted by the owner (see item 8).
>
## Current verified source state

- The current `main` code includes Hatchem (merged through PR #31) and subsequent
  108-card artwork credit/review/enablement tooling (PRs #32–#34). GitHub CI for
  `main` at `0aa2a3b` passed. This does **not** establish the current live DB state.
- The owner-approved roster has **108 cards**, comprising **88 Lilly illustrations**
  and **20 credited guest-artist illustrations**. Hedgehog and Vampire Dragon are
  intentionally out. Normal/Neon/Mega art can be replaced later via approved
  immutable assets without changing card ownership or IDs.
- The reviewed pet and shared-layer assets, official egg artwork, and release
  state must be checked **against the chosen database** using the read-only
  `scripts/audit-hatchem-release.js`. Never infer that a merged script was run
  or that a reported past dry-run equals current production state.
- Gameplay extras are already implemented: **Extra Grab = 10 Points**,
  **Extra Drop = 20 Points** in the current source.
- Achievements: **49 permanent global definitions** (37 visible including
  four value-dependent, 12 hidden), **one dynamic completion badge per
  release**, **at least six private release-specific secrets**, plus
  unlimited recurring grab/drop milestones every 50.
- This branch adds stricter achievement readiness checks; **it does not set
  any achievement launch date or write private secrets into Git**.

## Blockers before approving a public activation

1. **Review current database** with `node scripts/audit-hatchem-release.js --release=s1-r1 --expected=108`.
   It must report exactly 108 enabled/approved cards and an approved official egg
   and shared artwork. Missing artist credits, guest profile links, or license
   reviews are blockers. Review the provenance evidence outside public Discord.
2. **COMPLETE — Review card values.** The top-20%/top-10% achievements require
   source-dated `CardDefinition.valueReview` records. At least **20 reviewed
   Series 1 definitions** are necessary for these to work; full 108-card
   coverage is preferable before launch to avoid biased rankings.
   Never substitute official rarity for reviewed trading value or invent
   a market score.
3. **Implement EVERY previously logged achievement — selection is CLOSED**.
   The owner has repeatedly confirmed that **all proposed surprise/secret
   achievements** and **every recorded regular achievement** are included,
   without a vote, shortlist, substitutions, or asking again. This means
   all 37 fixed visible achievements, all 12 permanent hidden achievements,
   the Series 1 release-completion achievement, all six previously discussed
   Series 1 themed secrets (minimum two Basic, two Medium, two Advanced),
   and unlimited recurring grab/drop milestones every 50. Future release
   secrets are additional, never replacements. Existing code for fixed
   achievements must remain intact.
   **The owner has finalized all six Series 1 pet combinations.**
   Source now supports their acquisition, ownership, Neon and Mega triggers;
   the private JSON has all approved pet IDs and stable anonymous keys.
   The owner has verified the private file against the frozen MongoDB
   configuration: **all six exact conditions and all 108 design IDs match**.
   Do not repeat the frozen-roster write. Store the full secret file
   **outside this PUBLIC repo**.
   The minimum count for Series 1 is **56 distinct achievement keys** (49
   global fixed + 1 Series 1 completion + 6 Series 1 secrets), **plus
   unbounded recurring milestone keys**.
4. **COMPLETE — Frozen roster and secret config.** Replit verification
   confirmed all six exact private definitions and the frozen 108-card
   completion roster match the approved release. Do not run `--apply`
   again or unfreeze the draft release.
5. **Choose an explicit ISO launch timestamp with timezone** and configure
   `CARD_ACHIEVEMENTS_START_AT` in the eventual **authorized** runtime.
   Set `CARD_REWARD_SEASON_RELEASE=s1-r1` at the same time: without an
   explicit current season, general actions can silently miss their
   release-first extra-grab reward. The Series 1 activation gate now
   verifies the reward-season setting. Record the launch timestamp once;
   changing an established timestamp can cause the achievement engine to
   reject startup. Do not backdate to include development/test activity.
   Test eggs remain ineligible.
6. **Confirm one or more server Hatchem channels and local Card roles.**
   Verify bot role hierarchy, message/attachment permissions, Message
   Content intent and the owner ID. Verify the main live token/database
   separation and keep `ENABLE_CARD_GAME_TEST` and `ENABLE_CARD_GAME`
   mutually exclusive.
7. **COMPLETE — Discord regression testing (owner-confirmed).**
   On November 5, 2026, the owner explicitly confirmed that *all gameplay
   tests had already been completed*, correcting an outdated testing list.
   This includes the previously flagged categories of dust-assisted
   upgrades, locks, history, public show, bonus shop purchases, automatic
   wild eggs, release achievements and first-discovery cases, alongside
   previously completed trading, gifts, burning, normal upgrades, tags,
   collection, registration, role security and owner controls. This is
   owner attestation, not an independently captured Discord test log.
   **Do not request another test pass merely because old checkboxes remain
   open in historical notes.**
8. **OWNER-ACCEPTED — Permanent secret source exposure.** The owner
   understands that the **production** `AM-bot` repository is private
   while the **development** `src` repository is public, and that the
   12 permanent global secret conditions remain readable in the public
   development source. The six Series 1 secrets stay in private, ignored
   configuration and have been independently verified against MongoDB.
   On November 5, the owner explicitly chose not to restructure the
   permanent-secret code because casual community players are unlikely
   to search the public source. This is a documented acceptance of that
   exposure risk, **not** a claim that the source has become private.
   Do not reopen this as an activation blocker unless the owner changes
   that decision.
9. After read-only checks pass and owner testing is recorded, get **separate
   explicit approvals** for merging tested code, Wispbyte deployment,
   registering global commands and finally activating `s1-r1`.
   Each step must be verified independently.

## Safe owner review of Series 1 trading values

The original read-only audit reported **0 source-dated reviewed values**;
this was resolved by the November 5 import of **108/108 source-dated
reviews**, confirmed by the follow-up audit. The four value-based
achievements now have complete reviewed coverage. It does **not** invalidate
the approved pet rarity, existing release hatch weights, or official art.
The owner previously chose to compare multiple trading-value sources
rather than assign value using Adopt Me rarity alone. Do not replace this
with invented numeric scores or automatically reuse hatch weights.

The new owner workflow provides a complete 108-pet template and preserves
two independently published source URLs per reviewed score:

```bash
# First command creates a PRIVATE local file; no Mongo writes.
node scripts/review-series1-card-values.js --export .hatchem-private/series1-values.json

# Fill reviewMethod (common numeric scoring methodology), and enter
# for each reviewed pet: numeric score, TWO HTTPS sources from distinct
# websites, and actual review date as ISO timestamp with timezone.
# Unreviewed entries stay null/empty, not guessed.

# This command only verifies the draft roster and review evidence.
node scripts/review-series1-card-values.js --check .hatchem-private/series1-values.json

# Only after manual source review and explicit approval:
# Applies reviewed values IN A TRANSACTION on the development bot ONLY.
node scripts/review-series1-card-values.js --apply .hatchem-private/series1-values.json
```

The script refuses to overwrite a previously reviewed numeric score,
alter the rarity/odds, or update a release other than the 108-card
`s1-r1` draft. It requires **two independent sources** per score and
counts reviewed values; a minimum of 20 is required for the value
achievements to work, while reviewing **all 108** before launch is
preferable to avoid biased top-10%/top-20% rankings. Export, check and
apply do not activate cards, register production commands, or launch eggs.
Do not share credential-bearing URLs or commit the private review JSON.

## Safe preparation on the Replit development bot

```bash
git fetch origin
git switch feature/hatchem-launch-readiness
git pull --ff-only origin feature/hatchem-launch-readiness
npm test
node scripts/audit-hatchem-release.js --release=s1-r1 --expected=108
```

The audit is read-only and can report NOT READY while the secret roster,
reviewed values or achievement start date are incomplete. Do not treat this
as a request to set a speculative date.

### Private secret configuration, after owner review

The six Series 1 surprise achievements are **approved in full**, not a shortlist.
The achievement engine already supports the four combinations of **lifetime
acquisition**, **current ownership**, **currently owned Neon** and **currently
owned Mega** that those challenges require. A private configuration file
maps the exact selected pet IDs to immutable MongoDB card definition IDs.
It is **not** an ordinary public JSON seed and must never be checked into
source control. The ignored `.hatchem-private/` folder is provided for local
Replit preparation, or use a file outside the checkout.

Each private secret may specify an array `petIds` **or** `definitionIds`.
The authoring script resolves `petIds` from the approved, enabled
`s1-r1` roster and rejects unknown, duplicate, disabled, test-release or
unapproved cards. The exact solutions stay private; console errors only
show a numbered generic slot. The DB continues to store immutable
`definitionIds` and preserves the same award/rank engine. The source
contains no actual secret names or pet solutions.

**Final owner decision:** All six secret concepts and every associated
pet/stage combination have been approved. The PRIVATE
`Hatchem-Series1-Private-Achievements.json` now contains all six records
with no placeholders. The public GitHub repo intentionally does not
contain secret titles, detailed conditions or pet combinations. The
Replit database audit still reports **0 configured secrets** and **0
frozen-roster cards** because the approved file has not yet been applied.
First run the read-only secret dry-run against the actual draft release;
only then explicitly freeze it with `--apply`.

```bash
# Use a PRIVATE file outside tracked repository files:
node scripts/configure-card-achievements.js .hatchem-private/series1-secrets.json

# Only after confirming the dry-run and exact approved requirements:
node scripts/configure-card-achievements.js .hatchem-private/series1-secrets.json --apply
```

The first command performs **no database writes**. Applying freezes
configuration in a MongoDB transaction but **never activates the game**.

If `--apply` says **"Only an unfrozen official draft release may be
configured"**, do **not** retry or reset the release. The roster may already
have been frozen. The read-only audit reports the counts; to confirm the
six stored secret names, conditions, pet IDs, tiers, availability policies
and their display order match the private owner file **exactly** (without
printing them), use:

```bash
node scripts/configure-card-achievements.js .hatchem-private/series1-secrets.json --verify
```

A successful comparison prints `"verified": true`, both `rosterMatchesApproved`
and `secretsMatchPrivateFile` as `true`, and `"changesMade": false`.
A mismatch produces only generic diagnostics; it never prints private
solutions, writes to MongoDB or removes a frozen roster.
Never paste secrets into public GitHub issues, PRs, logs or shared channels.
Dry-run results list counts and generic errors, not secret names.

The **achievement list and all six themed combinations are finalized**;
do not ask the owner to reselect them. Their frozen configuration and
108 reviewed pet values were verified against Replit MongoDB, and the
owner has confirmed Discord gameplay tests complete and accepted
the disclosed public-source visibility risk of the 12 permanent global
secret definitions. Remaining launch work: choose the immutable **actual
launch timestamp**, configure the reward season, and obtain separate
merge, deployment and activation approvals. The game remains **draft
and inactive**.
