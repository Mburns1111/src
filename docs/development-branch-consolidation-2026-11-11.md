# Development branch consolidation — 2026-11-11

## Canonical development candidate
`integration/active-development-2026-11-11` in `Mburns1111/src`.

**NOT production-ready.** `main` and Wispbyte have not been updated. No Discord smoke tests or complete npm test run have been performed on this integrated head. Re-register Discord slash commands on the development bot after validation.

## Integrated (commit ancestry verified)

This branch contains the guided general/Trials/card setup from `feature/trials-guided-setup` as its starting point and now also includes:

- Hatchem Creator Shared achievements, from `feature/hatchem-creator-shared-achievements-20261105` (integration PR #43)
- Earned secret achievement labeling, from `fix/hatchem-secret-achievement-label` (PR #44)
- Trade-vote uploads and image links, from `feature/trade-vote-image-sources` (PR #45)
- Series 1 card enablement and egg reuse plan, from `feature/hatchem-series1-enablement-egg-reuse` (PR #46)
- Series 1 owner-art credits, from `feature/hatchem-owner-art-credits` (PR #47)
- Series 1 artwork batch review, from `feature/hatchem-series1-batch-review` (PR #48)
- Additional Court's Trial event stories, from `feature/trial-event-expansion-100` (PR #49)
- New required shared giveaway archive configuration in `/setup giveaways`, `/setup activity-giveaways`, and `/setup trials`; removes `/setup archives` from registered slash commands
- Expanded public/staff help restored from the activity-giveaway branch and rewritten to prioritize a blue **Bot Setup** button, private commands channel, full-system channel organization, and updated giveaway/claim/archive guidance

The older PRs #25, #38, #40 and #41 were closed after their associated code was confirmed in integration. GitHub history remains available.

## Not yet consolidated — preserve these branches

Do **not** delete the following based on age alone; GitHub reports divergent commits or conflicts.

- `feature/activity-giveaways-complete`: integration PR #42, **merge conflict** across giveaway/setup/help/staff code; newer activity giveaways still need careful reconciliation with guided Trial/general setup. The restored staff help is a selective port, **not** a complete merge of this branch.
- `feature/party-court-of-chaos`: integration PR #50, **merge conflict**. Verify game engine and setup compatibility.
- `feature/card-release-art-preview`: integration PR #51, **merge conflict**. Preserve artwork previews and Series 1 art sources.
- `feature/hatchem-player-tutorial`: integration PR #52, **merge conflict**. Reconcile tutorial against newer guided card setup.
- `feature/egg-artwork-credits`: integration PR #53, **merge conflict**. Reconcile artwork-credit history.
- `Artwork-Credit`: still divergent; audit against the dedicated egg/artwork branches.
- `release/hatchem-prep-2026-11-04`: still divergent; audit unique release prep/fixes before retirement.
- `feature/activity-giveaways`: older activity branch but still divergent; compare against `feature/activity-giveaways-complete` before retirement.

The original activity giveaway PR #39 remains open until its unique work has been integrated.

## Branches fully contained in integration (safe from a commit-history standpoint)

These branches currently have **0 commits ahead** of the integrated branch and do not need to remain as separate development lines:

- `feature/card-game-foundation`
- `feature/hatchem-launch-readiness`
- `feature/permanent-giveaways`
- `feature/pet-catalog`
- `feature/hatchem-unranked-creator-reset-20261105` (superseded by non-destructive Creator Shared)
- `fix/hatchem-activity-only-role-ping`
- `fix/hatchem-guide-layout-20261105`
- `feature/trials-guided-setup`
- `feature/hatchem-creator-shared-achievements-20261105`
- `fix/hatchem-secret-achievement-label`
- `feature/trade-vote-image-sources`
- `feature/hatchem-series1-enablement-egg-reuse`
- `feature/hatchem-owner-art-credits`
- `feature/hatchem-series1-batch-review`
- `feature/trial-event-expansion-100`

Branch deletion has **not** been performed: the available GitHub connector can close PRs, create branches and merge PRs, but does not provide a branch-ref deletion action. Delete only these fully contained branches through GitHub's Branches UI or an authorized git push after confirming development runs and no collaborators depend on them.

## Validation and Replit

```bash
git fetch origin
git switch -c integration/active-development-2026-11-11 --track origin/integration/active-development-2026-11-11
npm install
npm test
node register-commands.js
npm start
```

For an existing local branch with that name, use `git switch integration/active-development-2026-11-11` then `git pull --ff-only origin integration/active-development-2026-11-11`.

Complete the conflict-resolution PRs, run automated checks and verify Discord setup/giveaway/trial/card/party controls on the development bot before considering a production PR.
