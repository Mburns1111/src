# Phase 5 — Member experience

## First slice: direct gallery photo selection
- House and outfit public cards retain the same image, Previous/Next buttons, photo counter, and seller/member actions, plus a **Choose photo** button.
- Choosing opens a private numbered dropdown; members can jump to a photo with one selection, without creating additional public gallery messages.
- Selection updates the same listing card, just like the existing arrows. It validates guild, active listing, original message ID and a currently valid photo number before changing the saved page.
- Older galleries with more than 25 photos receive a 25-item window around the current page; the familiar arrows remain usable.
- Videos and original stored gallery images are never deleted or moved by the picker.

## Test in Replit
1. Switch to the Phase 5 branch and run \`npm run check:source\`, \`npm test\`, and \`npm start\`.
2. Open an outfit with at least three photos; click **Choose photo** and choose the last photo. Confirm the original public card changes and the dropdown closes.
3. Repeat with a house listing. Try Previous/Next afterward.
4. Have another member use the picker; confirm that the public gallery updates for everyone and existing Interested / seller controls continue working.
5. Confirm photos and videos are preserved; switching pages must not remove attachments.
6. Check a one-photo or video-only listing: it should not show navigation controls.

No Wispbyte deployment or merging without explicit approval.
