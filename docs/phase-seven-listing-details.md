# Phase 7 — Simple house and outfit details editor

## Scope
- Add **Edit details** to the existing house/outfit listing actions, keeping **Interested**, notification settings, previous/next, photo selection, and seller removal controls.
- Members may also open the editor directly from a private **My house listings / My outfit listings** directory dropdown, including for older posts whose public buttons have not yet been refreshed.
- The editor opens a **temporary private DM** with a styled image preview using the existing card renderer and current saved gallery page.
- **Edit details** opens a prefilled modal for title, description, and house asking/estimated prices or optional outfit cost.
- **Save changes** validates listing ownership, active published state, server membership, and original bot-owned public message; saves only allowed text/price fields and refreshes the existing public card.
- **Discard** removes the temporary editor and preserves the public post. An unfinished draft is kept in MongoDB between bot restarts.
- Appearance customization stays in the existing DM style editor. Media uploads and video placement are **not** editable in this phase.
- Failed public-card refresh after a successful Mongo save is reported explicitly and the draft editor stays open for retry.
- Only one details editor per guild/member at a time. A second selection gives a link to finish or discard the first.

## Replit smoke test
1. Switch to `feature/phase-7-listing-details-dm`, run `npm run check:source` and `npm test`, then start the bot.
2. Open **My house listings**, choose **Edit one of these listings in DMs**, and use the DM link to open the styled private preview.
3. Choose **Edit details**, modify the house title, description, asking price and estimated value. Verify the DM preview changes but **the public post does not**.
4. Choose **Discard** on a test listing and confirm that its public title, description, prices, gallery, videos and style are unchanged.
5. Reopen the editor and choose **Save changes**. Check that the original public post updates *in place* and still has all videos (above the card), photos, gallery controls and customization.
6. Repeat with an outfit, including leaving its optional cost blank.
7. Try editing a different member's post and ensure ownership is rejected without changing anything.
8. Check **Edit details** under freshly refreshed house/outfit posts. Confirm creating new listings, interest buttons, and photo navigation still work.

No merge to main or Wispbyte deployment without explicit approval.
