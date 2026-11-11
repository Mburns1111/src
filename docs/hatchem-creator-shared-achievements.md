# Hatchem: shared Creator achievements (production)

In the **production** Hatchem game only, the Discord account configured by
`CARD_GAME_OWNER_DISCORD_ID` may earn and track badges as **Creator · Shared**.
The creator does not occupy numbered player discovery places, Secret Hall of
Fame medals or first-in-release bonus slots. Future creator badge grants award
zero Extra Grabs/Drops. The Replit/test mode keeps normal ranked testing.

## Safeguards and one-time conversion

**Do not use the former `.creatorreset CONFIRM` command.** It was destructive;
that command and its code have been removed in this update.

1. Deploy this change to the correct production instance only after verifying
   tests and GitHub merge. Do not change the active Series 1 egg or achievement
   start time (`CARD_ACHIEVEMENTS_START_AT`).
2. Back up the MongoDB achievements and collector records before converting.
3. In the configured Hatchem channel, the actual creator types
   `.creatorshare preview`. This only displays counts: creator badges, ranked
   places, preserved event/acquisition records, existing player ranks affected,
   and release-first slots potentially reassigned.
4. Review the preview. Type `.creatorshare CONFIRM` (uppercase exact) to
   perform a single transactional migration.
5. Open `.achievements` and `.hof` to verify creator badges are marked
   **Creator · Shared** and player Hall of Fame ranks are member-only.

The `.creatorshare` command is owner-only and production-only, excluded from
member help. It is a dot command: no slash-command registration is necessary.
Repeating CONFIRM does not grant duplicate bonuses.

## Precise conversion behavior

- Keep every creator achievement badge, unlock date, recorded achievement event,
  acquisition/progress record, historical reward count, and earned bonus balance.
- Clear only the creator's numeric rank and release-first flag, marking their
  existing awards as creator-shared. Do not send delayed ranked notices for
  already-earned creator awards.
- For each achievement previously numbered for the creator, compact remaining
  members' ranks in their existing order to 1, 2, 3, etc. No member loses an
  earned achievement, original unlock time or original reward.
- Release any creator-held first-in-release token. If another member already
  earned the same achievement for that release, award the oldest qualifying
  member **one additional Extra Grab** and mark them as release-first; otherwise
  leave the slot free for the first future eligible player. Existing member
  rewards are not paid again. Previously sent Discord messages are not edited.
- Preserve Points wallets/ledgers, owned cards/IDs, dust, tags, locks, normal
  upgrades, bonus shop purchases, release configuration, secret definitions and
  the immutable official achievement start clock.

Everything happens in a MongoDB transaction under the achievement clock guard.
On any failure the entire conversion rolls back. New creator achievements
continue to track progress and appear in private `.achievements`, but never
claim player ranks or receive new achievement bonuses. The creator may still
collect cards, trade, gift, upgrade and use Points-funded extras normally.
