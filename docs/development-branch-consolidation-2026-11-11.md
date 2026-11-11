# AM Isa — consolidated development branch (11 November 2026)

## Canonical development branch

`integration/active-development-2026-11-11` in `Mburns1111/src`.

**Development only.** Nothing has been merged into `main`, `Mburns1111/AM-bot` or Wispbyte. Do not deploy before the full test suite and Discord smoke tests. The integration PR merges below were into the development integration branch, not production.

## Consolidated feature branches

The following PRs were merged into this development branch and their source heads are now ancestors (0 commits ahead):

- #42 — Activity giveaways, reconciled with the modern guided setup and the final delivery/archival rules
- #50 — Court of Chaos party-game logic
- #51 — Hatchem artwork previews, official release audit and import tooling
- #52 — Hatchem six-page tutorial: private **Learn to Play** buttons instead of DMs
- #53 — Egg artwork credits and active reference catalog
- #54 — Historical artwork research and Series 1 roster sources, preserved without replacing the completed release catalog
- #43–49 — Creator Shared, secret-achievement labels, trade image links, Series 1 enablement/reuse, owner art credits, batch artwork review and expanded Court's Trial stories

Previous standalone PRs #25, #38, #40 and #41 were closed after their changes were incorporated into integration.

## Owner-approved workflow rules

1. **Regular giveaway archive** — only when all current winners have submitted their valid claim forms **and** staff use **Confirm Prizes Delivered**. Optional proof is a Discord message link; staff action and time are recorded. An undelivered, unclaimed, forfeited, or no-winner giveaway uses **Cancel Giveaway** with a staff reason instead of being archived as completed.
2. **Public results** — archiving a completed *regular* giveaway deletes its public entry/listing. Activity giveaways post winner results in the separate **Activity Winners** channel when they end; those results are retained when the activity list entry is archived. Court's Trial Royal Verdicts are preserved.
3. **Private channels** — Bot Commands is staff-private. Each of the three giveaway setups chooses the **same required private archive**, separate from the active staff controls and public giveaway channels. Standalone `/setup archives` is retired.
4. **Hatchem** — tutorial stays in the Hatchem channel as a private interactive button view, not in DMs.
5. **Artwork** — first-release artwork is completed. The current 108-card Series 1 artwork/release state is preserved; historical artist outreach and source notes are retained separately. No release activation or artwork rewriting has been performed.

## Additional integration details

- Restored expanded Public Help and Staff Help, blue **Bot Setup** button, bot-wide setup instructions.
- Added model fields for delivery confirmation and archive/staff progress metadata.
- Kept newer commands and guided wizards when the older activity branch conflicted with modern setup. Detailed original activity branch documentation is stored as **historical reference only** in `docs/activity-giveaways-branch-history.md` to avoid reviving obsolete setup commands.
- Activity branch's archive, staff progress and index modules and tests were retained. Existing live staff-directory and current guided activity routing were not replaced wholesale during consolidation.

## Older superseded branch lines to inspect before deletion

- `feature/activity-giveaways` — superseded by the newer complete activity giveaway branch; diverged history includes older aggregate counters and compatibility code.
- `release/hatchem-prep-2026-11-04` — superseded release candidate; compare with the finished Series 1 state before deleting.
- Every other fully contained feature branch (0 commits ahead of integration) can be retired once development tests pass and no collaborator needs it.

**Remote branch deletion is not completed.** The GitHub connector has no branch-deletion action. Do not delete divergent branches before unique code/history has been verified, and never delete `main` or the integration branch.

## Run validation on the Replit development bot

```bash
git fetch origin
git switch -c integration/active-development-2026-11-11 --track origin/integration/active-development-2026-11-11
npm install
npm test
node register-commands.js
npm start
```

If the branch already exists locally:

```bash
git switch integration/active-development-2026-11-11
git pull --ff-only origin integration/active-development-2026-11-11
npm test
```

Important Discord checks: setup private-channel validation; regular, activity and Trial creation; activity winner announcements; staff preview and sticky directory; winner ticket claim; prize delivery confirmation; cancellation and archive; public post retention/removal; Hatchem tutorial private buttons; Series 1 art credit/release previews. The full automated suite has **not** been run in this environment.
