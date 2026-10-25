# Admin migration — Member-owned house and outfit listings

## Goal
Support migration from manually authored posts into the bot's standard house/outfit listing system **without giving ownership to the admin**. A migrated post is authored on Discord by the bot, but the displayed seller and the MongoDB owner are the **selected member**.

## Workflow
1. An authorized server manager runs `/admin-import house member:@Member` or `/admin-import outfit member:@Member`. Manager permissions are checked both when opening and submitting the form.
2. The bot opens a one-use modal where the admin enters the original listing details and **uploads the existing photos/videos** (1–10 combined, no more than 9 native videos so the styled card has space).
3. The original poster must still be in the Discord server. The bot reads **that member's** Discord display name, Roblox profile name, and purchased profile appearance.
4. The bot creates the listing in the configured house/outfit channel and saves the selected member as `ownerId`. It records the importing manager in `importedById` for audit.
5. The same existing photo archival, video verification, staging/restart recovery and styled-card functions handle this post. Videos continue to appear **above** the styled card.
6. Once posted, the member can see the listing through **My Listings**, edit its details in DMs, customize it, adjust interest DMs, and mark it sold/remove it. Other members can mark interest; the notification goes to the owner.
7. Because this is an import of an old listing, it **does not award a new first-listing milestone** or create a profile for the admin.

## Safety boundaries
- Import never deletes or edits the old/manual source post. Admins should manually remove it **only after verifying the replacement**.
- The command uses a one-use 20-minute modal ticket (validated against the admin and guild) to avoid accidental duplicate submissions.
- If a Discord upload is interrupted, the attempted bot post and any archived staging record are left in place. The error response includes the link and instructs the manager to inspect it before retrying.
- Only house and outfit posts are included in this first release. Profiles, Trading Posts, and votes are not imported.
- A member must be in the server at import time. No impersonation of the member's actual Discord-authored messages occurs; the post is from the bot with the member's attribution.

## Replit smoke test
1. On the test bot branch, **run the existing command-registration script** before testing the new slash command. Check `package.json` for the project's registration script.
2. As a manager, run `/admin-import house member:@TestMember`, fill the form, and attach a real photo or video.
3. Verify the selected member (not the manager) is named as seller, owns the listing in **My house listings**, and can use **Edit details**, **Interest DMs**, and **Mark sold**.
4. Repeat for `/admin-import outfit member:@TestMember` and verify **My outfit listings**, **Remove listing**, and the displayed price. Include a video to verify it remains **above** the styled card.
5. Verify the manager cannot submit an expired form twice and non-managers do not have permission to execute the command.
6. Confirm an actual member's ordinary `/house` and `/outfit` creation still works and that all existing photos and videos remain unchanged.
7. Only migrate valuable old posts after reviewing the test results; this is an **additive** migration, not a transfer/delete operation.

No merge to `main`, no Wispbyte deployment and no destructive migration without explicit approval.
