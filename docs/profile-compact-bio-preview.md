# Profile card preview — compact header and taller About Me

## Layout changes (no member data changed)
- Remove the redundant `Discord: username` line from the profile image. Keep the member's **preferred display name** as the heading and their **Roblox username** as the sole line below it.
- Shorten the top-right translucent/header region from approximately 240 to 155–158 pixels high.
- Shift the About Me panel up and grow its text area (from about 100–126 pixels tall to about 197–210 pixels tall, depending on style).
- Allow the bio renderer to wrap up to eight lines using an adaptive minimum font size. Extremely long biographies can still be ellipsized instead of overlapping photo or stickers.
- Preserve avatar, server roles, trade status, photo/page position, purchased background/frame/sticker appearance, and all MongoDB data. No change to other types of post.

## Replit preview
1. Switch to `feature/profile-compact-header-larger-bio`, run `npm test` then `npm start`.
2. Open **Customize Profile** in the server/shop to get the existing private DM preview. It should display the new layout without changing the public post until saved.
3. Check a profile with a long About Me. The header should show **display name + Roblox name**, but **no separate Discord username**.
4. Compare a purchased background with the free/default background; both now have more bio room.
5. Confirm the About Me panel stays above the member's photos, and neither role text nor stickers have moved.
6. Only if you like the result, approve merging separately from the admin migration PR. No Wispbyte deployment is included.

This is a **stacked branch** based on `feature/admin-import-member-listings` so you can preview it in Replit without losing the already tested admin-import work. Its draft PR targets that branch, not `main`, until the parent migration branch is merged.
