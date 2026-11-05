# Hatchem Series 1 — controlled launch readiness (November 4, 2026)

**Goal:** Prepare the official 108-card `s1-r1` egg for a later explicit launch.
**This checklist does not grant permission to deploy, activate an egg, merge a PR,
register production commands, or edit Wispbyte.**

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
2. **Review card values.** The top-20%/top-10% achievements require
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
   **Implementation is still required** for the Series 1 themed conditions:
   map the agreed challenges to actual enabled `CardDefinition._id` values
   and their supported event/collection triggers. Any unsupported triggers
   require implementation/testing rather than deleting an approved badge.
   Store the private exact secret configuration **outside this PUBLIC repo**.
   The minimum count for Series 1 is **56 distinct achievement keys** (49
   global fixed + 1 Series 1 completion + 6 Series 1 secrets), **plus
   unbounded recurring milestone keys**.
4. **Freeze the exact 108-card completion roster and secret config** from
   the private JSON after review (see commands below). This does not
   activate the release. The new preflight rejects missing/stale rosters
   or secret IDs that do not belong to the enabled release.
5. **Choose an explicit ISO launch timestamp with timezone** and configure
   `CARD_ACHIEVEMENTS_START_AT` in the eventual **authorized** runtime.
   Record it once; changing an established timestamp can cause the
   achievement engine to reject startup. Do not backdate to include
   development/test activity. Test eggs remain ineligible.
6. **Confirm one or more server Hatchem channels and local Card roles.**
   Verify bot role hierarchy, message/attachment permissions, Message
   Content intent and the owner ID. Verify the main live token/database
   separation and keep `ENABLE_CARD_GAME_TEST` and `ENABLE_CARD_GAME`
   mutually exclusive.
7. **Finish realistic Discord regression testing** on the development bot.
   Automated CI does not prove database transactional correctness with
   multiple concurrent users. The specific remaining user-reported cases
   include dust-assisted upgrades, locks, history, public show, the bonus
   shop, automatic wild eggs, release-secret achievements and simultaneous
   first-discovery bonuses; retest grab/drop cooldown refunds, restarts,
   and registration/role security.
8. **Resolve private-secret source exposure.** The old global secret
   definitions currently live in readable repository source. UI secrecy
   does not conceal definitions from people who inspect a public repo.
   Before launch decide whether to move those definitions into controlled
   private configuration or restrict source access.
9. After read-only checks pass and manual tests are recorded, get **separate
   explicit approvals** for merging tested code, Wispbyte deployment,
   registering global commands and finally activating `s1-r1`.
   Each step must be verified independently.

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

```bash
# Use a PRIVATE file outside tracked repository files:
node scripts/configure-card-achievements.js /path/to/private-s1-secrets.json

# Only after confirming the dry-run and exact approved requirements:
node scripts/configure-card-achievements.js /path/to/private-s1-secrets.json --apply
```

The first command performs **no database writes**. Applying freezes
configuration in a MongoDB transaction but **never activates the game**.
Never paste secrets into public GitHub issues, PRs, logs or shared channels.
Dry-run results list counts and generic errors, not secret names.

The **achievement list is already selected** and must not be reopened or
trimmed. Remaining work concerns implementing/testing the full agreed set,
mapping the six themed challenges to the approved Series 1 pet records,
freezing their private configuration, reviewing pet values, and selecting
the **launch timestamp**. The game is **not yet launch-ready**.
