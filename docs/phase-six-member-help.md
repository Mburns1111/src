# Help Center — Public and Staff navigation

This replaces the original five-button /help layout on the development branch.

- **/help** starts with two private buttons: **Public Help** and **Staff Help**.
- Public Help contains **Getting Started**, **Listings & Trading**, **Shop & Points**, **Collectible Cards**, **Giveaways**, **Games & Activities**, and **Commands**.
- Staff Help contains **Giveaway Management**, **Activity Tracking**, **Giveaway Archives**, **Card Management**, **Points & Shop**, **Games**, and **Bot Setup**.
- Each system has **Back to Systems** and **Help Home**, updating the original ephemeral response. The command directory is loaded live from Discord.
- **Staff Help access:** Discord Administrator / Manage Server, or the explicitly configured Giveaway Manager role. Managers do not need Manage Server to read the help pages. Access is checked on every staff navigation click, not just on /help creation.
- An authorized admin can assign or clear the giveaway manager help role in **/setup channels giveaway_manager:@Role** or with **clear_giveaway_manager:true**. Existing Discord application command permissions remain separate; granting help access does **not** grant Discord command or action permissions.
- Every page is read-only. No public posts, shop changes, prizes, profile changes, or giveaway state changes occur when browsing Help.
- Staff guides describe actual features: total activity messages per period, manual progress refresh without cooldown, claim versus delivery, optional delivery proof and one-click archive eligibility.

## Replit verification
1. Pull `feature/activity-giveaways-complete`, restart the development bot.
2. Run `/help` in the command channel; verify **Public Help** and **Staff Help**.
3. Follow each Public system button, then **Back to Systems** and **Help Home**.
4. As a normal member, select **Staff Help** and confirm access is denied.
5. Assign a Giveaway Manager role with `/setup channels giveaway_manager`; as a member with that role but without Manage Server, open Staff Help and its giveaway pages.
6. Verify a member without that role still cannot open staff pages or bypass them via old button IDs.
7. Ensure opening a help page does not execute a privileged management action.

Nothing is merged to production without approval.
