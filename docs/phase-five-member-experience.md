# Phase 5 — Member experience

## First slice: direct gallery photo selection
- House and outfit public cards retain the same image, Previous/Next buttons, photo counter, and seller/member actions, plus a **Choose photo** button.
- Choosing opens a private numbered dropdown; members can jump to a photo with one selection, without creating additional public gallery messages.
- Selection updates the same listing card, just like the existing arrows. It validates guild, active listing, original message ID and a currently valid photo number before changing the saved page.
- Older galleries with more than 25 photos receive a 25-item window around the current page; the familiar arrows remain usable.
- Videos and original stored gallery images are never deleted or moved by the picker.

## Test in Replit
1. Switch to the Phase 5 branch and run `npm run check:source`, `npm test`, and `npm start`.
2. Open an outfit with at least three photos; click **Choose photo** and choose the last photo. Confirm the original public card changes and the dropdown closes.
3. Repeat with a house listing. Try Previous/Next afterward.
4. Have another member use the picker; confirm that the public gallery updates for everyone and existing Interested / seller controls continue working.
5. Confirm photos and videos are preserved; switching pages must not remove attachments.
6. Check a one-photo or video-only listing: it should not show navigation controls.

No Wispbyte deployment or merging without explicit approval.


## Second slice: find my published listings
- The permanent house/outfit entry panel now includes **My house listings** or **My outfit listings**, alongside the existing Start listing button.
- Members get a private directory of **their own active published** posts, with direct links. No new posts, data mutations, or server-wide list of other sellers.
- Lists are newest-first, eight links per page, with owner-restricted Previous/Next navigation; inactive, missing and staged listings are excluded.
- Each entry links to the existing public Discord message. The existing Interested, Remove listing, Mark sold, and photo chooser controls remain on that post; they are not duplicated or invoked by the directory.
- If a previously saved Discord message has disappeared, its link may not resolve until normal reconciliation archives it. The directory itself never deletes the listing or its media.

### Replit check for directory
1. Restart the test bot so its normal channel-entry maintenance updates the buttons in the configured house/outfit channels.
2. Click **My house listings** and **My outfit listings**; verify the private links lead to the correct public posts and only your active listings are shown.
3. Use Previous/Next if you have more than eight active posts; another member should not see your private directory.
4. Confirm the original Start a listing buttons still create forms, and videos/photos/interest controls on the linked posts are unchanged.
