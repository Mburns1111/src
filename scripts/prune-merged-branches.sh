#!/usr/bin/env bash
# Dry-run by default; pass --apply to prune verified remote branches.
# Does not merge code or deploy production.
set -euo pipefail
mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]]; then
  echo "Usage: bash scripts/prune-merged-branches.sh [--dry-run|--apply]" >&2
  exit 2
fi
remote="$(git remote get-url origin)"
case "$remote" in
  *github.com/Mburns1111/src|*github.com/Mburns1111/src.git|*github.com:Mburns1111/src|*github.com:Mburns1111/src.git) ;;
  *) echo "Refusing to prune: origin is not Mburns1111/src ($remote)." >&2; exit 1 ;;
esac
git fetch origin refs/heads/main:refs/remotes/origin/main
obsolete=(
  feature/admin-import-member-listings
  feature/listing-appearance
  feature/phase-5-planning
  feature/phase-6-member-help
  feature/phase-7-listing-details-dm
  feature/points-earning
  feature/profile-appearance-editor
  feature/profile-compact-header-larger-bio
  feature/shared-post-style
  fix/coverage-aware-readable-symbols
  fix/decorative-unicode-font-fallback
  fix/message-scan-channel-exclusions
  fix/phase-1-data-protection
  fix/phase-2-media-safety
  fix/phase-3-operational-reliability
  fix/profile-decorative-symbol-runs
  fix/profile-name-rendering
  fix/real-emoji-and-readable-decorations
  perf/phase-4-responsiveness
)
removed=0; skipped=0
for branch in "${obsolete[@]}"; do
  if ! git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1; then
    echo "SKIP $branch: branch already absent"; ((skipped += 1)); continue
  fi
  git fetch origin "$branch:refs/remotes/origin/$branch"
  if ! git merge-base --is-ancestor "origin/$branch" "origin/main"; then
    echo "PROTECT $branch: contains commits not in origin/main"; ((skipped += 1)); continue
  fi
  if [[ "$mode" == "--apply" ]]; then
    echo "DELETE remote origin/$branch"
    git push origin --delete "$branch"
    ((removed += 1))
  else
    echo "SAFE-TO-DELETE origin/$branch"
  fi
done
echo "Mode: $mode; deleted: $removed; skipped: $skipped."
echo "Preserved: main, feature/pet-catalog, feature/card-game-foundation, Artwork-Credit, feature/egg-artwork-credits."
