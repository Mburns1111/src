# Guided server setup (development only)

Source: `feature/scheduled-pings-shared-archive`. Development feature; do not deploy or merge without approval.

**Activity giveaways now use an internal MongoDB Opt In / Opt Out panel beneath the Activity Giveaway List. No Discord role is required for participation.**

## Setup commands

| Command | What it configures | Required fields |
|---|---|---|
| `/setup general` | Required private Bot Commands and Shared Staff Archives channels; optional Scheduled Pings private dashboard, profiles, listings, shops and party games | Private commands and separate shared archive **mandatory** |
| `/setup giveaways` | Standard giveaway channel, private staff records, roles, claims, rerolls and banners; uses shared archive | Public giveaway channel and private staff controls; run General first |
| `/setup activity-giveaways` | Activity list, winners, staff review and giveaway options; uses shared archive | Public activity list, public winners and private staff controls; run General first |
| `/setup trials` | Court's Trial channels, roles, claims, rerolls and banners; uses shared archive | Trial channel and private staff controls; run General first |
| `/setup cards` | Hatchem game channel, Collector role, activity-based wild egg toggle | Requires General commands channel; Hatchem channel and manageable Collector role |

`/setup channels` and `/setup archives` have been **retired from Discord's command menu**. Existing MongoDB channel IDs and notification settings are preserved; use `/setup general` to change shared archive and the relevant guided setup for each feature to change its own settings. Previously saved guild setups remain recognized without requiring reconfiguration.

Guided flows send numbered messages in the invoking channel, require Manage Server, have Back/Cancel/Keep or Skip actions, support review and editing prior to Save, and store settings only on final Save. The commands channel must be hidden from `@everyone` and writable by the bot. Public member actions operate through their designated feature channels and buttons. The administrator needs to use the configured private commands channel for follow-up setup; a never-configured server can start `/setup general` from its initial administrative text channel.

## Shared giveaway archive channel

`/setup general` includes the **required** shared private archive picker immediately after Bot Commands. All giveaway types, Court\'s Trials and Scheduled Pings use the same `giveawayArchiveChannelId` in GuildConfig. Each feature-specific setup reads the saved archive, but cannot replace it. Existing archive history remains intact.

The private staff controls and private archive channels must be separate from each other and from all public giveaway and Trial channels, hidden from `@everyone`, and writable by the bot. The general setup cannot be saved without a valid archive. Existing archived records and giveaway histories are not deleted when the archive destination changes.

## Separate activity giveaway opt-in role

`/setup activity-giveaways` requires the server manager to choose a distinct **Activity Giveaway List opt-in panel**. This role is exclusively for opt-in message tracking for activity giveaways. The optional **regular giveaway entry/eligibility role** under `/setup giveaways` remains independent. A regular giveaway can still require no eligibility role, but an activity giveaway **cannot** disable its participation role.

The bot checks for Activity Participation before storing guided activity receipts or updating legacy message counters. No role means no giveaway activity record; role removal immediately stops new counting and disqualifies the member from future drawings and rerolls. Activity participation is unrelated to normal Points or Hatchem tracking. Public activity announcements state how to obtain the role.

When configuring an activity role for the first time or switching to a different role, open guided activities restart their counting periods, preserving historical records without counting old-role activity. Older plans use only the post-opt-in minute-level counter window and may have no eligible members in their first partial period.

## Optional features and Skip behavior

After the mandatory **private staff commands channel and shared private archives channel** in General setup, every remaining step is optional. The Scheduled Pings dashboard is an optional private channel. **Skip / disable this feature** saves an empty channel assignment so that feature is not configured; **Keep current** preserves an already configured channel. Disabling a feature does not erase profiles, purchases, claims, member inventories or past Discord messages. Staff can return to `/setup general` later to configure or move a feature. For an existing server, a previously posted button in an old channel can remain visible; it is not deleted simply because a feature is skipped.

Giveaways, activity giveaways, Trials and Hatchem use **separate** setup commands and are not required for a General-only server. A giveaway-only server may skip every General optional step, then run `/setup giveaways` or `/setup activity-giveaways`. A card-only server may do the same, then run `/setup cards`. General does not force profiles, the shop or the other game modules.

Slash commands other than `/setup` are blocked before initial setup. The bot also recognizes legacy servers with an existing commands channel. Hatchem player commands require both its local channel and Card role. Auto eggs additionally honor the saved **Enable wild activity eggs** switch; turning it off does not disable manual `.drop` actions. Hatch odds and activity thresholds remain the existing global values.

## Banner selection and upload in every giveaway setup

The **Default banner** step in `/setup giveaways`, `/setup activity-giveaways` and `/setup trials` lists registered banners for the current server (up to 40 names). Staff may select one from the dropdown (first 25), type an exact saved name, leave the current selection, clear the default, or choose **Upload New Banner**. When none exist, the setup prominently offers the upload action rather than asking staff to leave setup.

To upload, post a PNG, JPG, WebP or GIF **under 4 MB** as an attachment in the same command channel. The optional message text becomes the banner's name; otherwise the image filename (without extension) is used. Names must have 1–60 characters and cannot be `default`. The bot saves reusable image bytes in the server's MongoDB banner catalog and selects the new banner for this setup. Reusing an existing name replaces that banner's stored image. Invalid uploads keep the wizard at its upload step so staff can retry.

A completed banner selection or upload moves to **Review & Save**, or returns there directly when editing from review. It must never restart at Step 1. The separate `/giveaway activity` creation wizard also supports registering an image, including an **Upload New Banner** shortcut from the saved-banner list. Uploading a banner by itself does not save or change the other setup fields; staff must still choose **Save Setup** at the final review.

## Court's Trial defaults

The new Trial flow uses separate default eligibility role/instructions, role-instruction visibility, the shared giveaway notification role (pinged at signup only), minute-based claim window (1–43,200 minutes), staff ticket instructions, rerolls (0–10), and saved banner artwork. Each `/trial start` may override supported defaults. Configuring Trials does not change regular/activity claim and eligibility defaults, but the single shared giveaway ping role is intentionally updated for every giveaway type.

New Trials use the regular giveaway claim ticket form after the final Royal Verdict: a winner submits a ticket number and exact Discord ticket message link before the deadline. Those details appear **only in staff records**, never in public result text. Once the claim is saved, the bot edits the existing public result message to show **Claim submitted** without the claimed winner's pending deadline. For a single winner, this removes the general claim deadline, how-to-claim, ticket submission and forfeiture instructions, as well as the claim button. For multiple winners, those instructions and the button remain only while another current winner is awaiting a claim; they disappear after every place is submitted or definitively resolved. Regular and activity giveaway results behave the same way. A replacement winner after a reroll receives fresh instructions. The original winner list and private ticket records are retained. Automatic expiry rerolls follow the saved limit; staff can stop them. Existing old Trial records preserve their original staff-managed claim behavior. Prizes are still delivered manually by staff.

## Giveaway Manager role (delegated staff permissions)

Under **/setup giveaways**, **/setup activity-giveaways**, or **/setup trials**, a server manager with **Manage Server** may choose an optional **Giveaway Manager** role or clear it. The role is shared across regular giveaways, activity giveaways and Court's Trials; it is not a member-entry eligibility role or a notification/ping role.

A member with this configured role may run `/giveaway`, `/giveaway-role` and `/trial` in their previously authorized channels. They may also use the associated staff controls: create activity giveaways, edit and end early, approve drawings, launch Trials, view qualifying-member previews and the sticky directory, reroll winners, disable automatic rerolls, cancel active giveaways and delete eligible completed listings. The permission check happens server-side on every command or staff interaction, so removing the member's role removes their ability to act.

The new role **does not** grant `/setup`, access to other bot administrative features, or the Discord **Manage Server** permission. Only Manage Server staff can choose or clear the delegated role through guided setup. Giving a user the role does not bypass channel restrictions; **also grant the Giveaway Manager role View Channel access to the private staff giveaway channel in Discord's channel permissions**. A member with the role who lacks staff-channel access can still run authorized Trial commands in the configured Trial channel.

Because Discord previously registered the giveaway and Trial slash commands as Manage Server–only, **re-register the slash commands on the development bot once after pulling** (`node register-commands.js`, using development token/client ID) so users with the new role can see and invoke them. Discord may list the commands to other members as well; the bot rejects anyone without the configured role or Manage Server before processing an action.

## Staff entrant lists and clear claim-status markers

Each giveaway now has a permanent **private staff record** with a **View Entrants** button (or **View Contestants** for Court's Trials), including cancelled and completed archives. The list is staff-only, ephemeral, 25 members per page, with **Previous** and **Next** buttons; it includes each Discord mention and ID but cannot ping those members. Active activity giveaways are message-counter based, so their final entrant list may be empty until the draw; use the existing **Preview qualifying members** control while counting is in progress. The sticky **Active Giveaway Directory** links to the private staff record first when available and adds a separate **Public post** link.

Private staff records use one prominent status color in the embed title, status line and border. **🟦 IN PROGRESS** covers active giveaways, activity drawings awaiting review, and Trials that are preparing/running. After results: **🟨 CLAIM PENDING** means at least one current winner needs to submit a ticket claim (or a legacy Trial needs staff follow-up); **🟩 CLAIM COMPLETED** means every remaining claim is resolved and at least one valid claim was submitted; **🟥 NO ELIGIBLE WINNER** means no prize place has an eligible winner. **⬜ GRAY — ARCHIVED** takes priority over all other colors as soon as staff use **Delete Listing** to remove a completed public announcement; cancellations also appear gray. A removed giveaway never continues showing the earlier yellow, green or red status, even though its private staff record retains claim results and winner history.

If a regular or activity giveaway has no eligible winner after the draw or exhausted claims, its **public** announcement and activity listing now show only the giveaway title, prize, a short **No eligible winner** result, and the end time, keeping the saved banner and identifier. Court's Trials use an equally concise no-eligible-prize Royal Verdict, while still naming the original **Last Survivor** for the historical Court record. Private staff records retain all entrants, claim history, rerolls, and deletion controls. Ending without a winner never silently deletes the public listing; it stays until a staff member chooses **Delete Listing**.

## Prize-claim and role instructions: where to see and edit them

**Server-wide defaults:** Run `/setup giveaways` or `/setup activity-giveaways` in the designated commands channel. The **Claim instructions** step now displays the full wording winners will receive, whether it is saved custom text or the built-in default. Choose **Write / Edit Server Instructions**, type your wording in that same channel (up to 1,000 characters), and select **Save Settings** at review. You can also use the **Edit Claim Instructions** shortcut directly from the setup review. **Use Built-in Default** intentionally clears your saved custom instructions; **Keep Saved** leaves them as-is. Regular and activity giveaways share this saved default. `/setup trials` has a separate Trial default with the same visible wording and an **Edit Claim Instructions** shortcut.

**Per-giveaway overrides:** `/giveaway start` displays the actual selected claim instructions—including the built-in text if no custom default exists—before giving choices to **Use Server Default**, **Write Custom Instructions**, or keep the selection. It also displays the current instructions for obtaining an entry role and permits custom per-giveaway role instructions. The final review shows the selected wording, and **Preview Announcement** shows it exactly as members will receive it. The `/giveaway activity` creation wizard similarly displays the current actual claim instructions before offering its default/custom choices and includes them in review.

Custom text is saved to the giveaway when posted, but changing it on one giveaway does not change server-wide defaults. The bot separately adds the required ticket number, Discord message link, deadline and forfeiture warning. Existing giveaway claim settings are unchanged unless staff explicitly choose **Apply to Existing** in server setup.

## Guided regular giveaway creation and simplified command menu

`/giveaway start` now opens a **guided, channel-based wizard**, the same basic interaction style as `/giveaway activity`. Staff with Manage Server or the configured Giveaway Manager role may start it in the **configured commands channel only**. The private giveaway staff channel is reserved for staff records and button actions. It requires the development bot's **Message Content Intent** (including `ENABLE_MESSAGE_CONTENT_INTENT=1`) to receive typed answers and banner uploads.

The wizard collects: giveaway title, prize text, optional details, entry duration (presets, custom minutes or custom days, up to six calendar months), winner count (1–10), required entry role (server default / none / chosen role), role instruction visibility, optional rules, claim deadline (1–720 hours), custom/default ticket instructions, and a saved or uploaded banner. The shared giveaway notification role is inherited from server setup and is never selected independently for an individual giveaway.

Before posting, **Review** displays all choices, offers an **Edit** menu, and offers **Preview Announcement** in the current command channel. The preview has disabled entry buttons and does not ping anyone or create a giveaway. **Post Giveaway** re-checks staff permission, creates the regular giveaway in the configured public channel, sends the shared role notification once and creates a private staff record; **Cancel** does not post anything. The wizard expires after 30 minutes of inactivity; it never uses DMs.

The reusable banner actions are nested under **`/giveaway banner`**: `save`, `list`, `default`, `clear`, and `remove`. Existing saved banners and default settings are unchanged. The eight older `/giveaway plan-*` and `/giveaway prize-*` editing commands have been removed from the public slash-command menu. **Use `/giveaway activity` for one-time and repeating activity giveaways.** The existing scheduling engine, saved schedules and previous giveaway records are intentionally retained, not deleted or silently disabled. Old cached plan slash interactions display a migration hint. Retiring those commands does not automatically migrate old plans or remove watched channel rules.

Because both the `/giveaway start` options and available subcommands changed, run `node register-commands.js` with the development bot's token and client ID **once after pulling the branch**, then restart Replit. Do not run it using the production bot's credentials.

## Giveaway and Trial command channels

Staff with Manage Server or the configured Giveaway Manager role run `/giveaway` and `/giveaway-role` **only in the designated bot commands channel**. This includes `/giveaway start` and `/giveaway activity`: their guided, text-and-button wizards remain in the commands channel, keeping the private giveaway staff channel free for staff records and review actions.

Staff with Manage Server or the configured Giveaway Manager role may use `/trial` in the bot commands channel or the separate Court's Trial channel configured under `/setup trials`, but **never** in the private giveaway staff channel. All unrelated commands keep their existing channel limits.

Giveaway commands and setup wizards stay in the commands channel; Trial slash commands can also run in the separate Trial channel. The private staff giveaway channel is for records, reviews, and action buttons—not slash commands or typed setup prompts. Public giveaway and Trial announcements still publish to their configured channels. No permissions are loosened for non-staff members.

## Private staff giveaway directory (automatic sticky)

The existing **private staff giveaway channel** selected by `/setup giveaways` or `/setup activity-giveaways` automatically receives an **Active Giveaway Directory**. There is no extra setup command or separate channel to configure.

- It includes regular giveaways, activity giveaways, Court's Trials and active recurring activity giveaway schedules.
- Each item shows the giveaway title, type, status and a direct Discord message link. Activity giveaways link to their public activity listing when available, falling back to the private staff record during approval. Recurring plans link to their public schedule poster.
- Finished and cancelled giveaways are removed from this **active directory** automatically, but their individual staff records and public completed giveaway listings are not deleted by this change. **Delete Listing** remains a separate manual action.
- The directory is refreshed by the normal giveaway sweep (approximately every 30 seconds). It edits in place on status changes and reposts near the bottom after additional staff messages, with a ten-minute repost cooldown; old directory messages are deleted after the new one is safely sent.
- A directory with more than 15 items shows **Next page**. Staff use the private, ephemeral pagination buttons without changing the main sticky message. When there are no active giveaways, the directory clearly says so.
- The bot never pings staff while updating this directory and refuses to post to a staff channel visible to @everyone.

## Completed giveaways — Delete Listing, not cancellation

The private staff record shows **Cancel & Remove Giveaway** only while a giveaway is still live. A completed event (`status: ended`) instead receives **Delete Listing** when every prize place has reached a terminal state:

- Nobody was selected as a winner, **or**
- Every current winner has submitted their ticket number and Discord ticket message link, **or**
- Every remaining unclaimed place is past its claim deadline and has **no rerolls left** (the configured limit was exhausted, set to zero, or the bot confirmed no eligible replacements remained). Mixed claimed/exhausted places also qualify.

A place with an open claim window or remaining replacement chances keeps the listing protected. If a reroll changes the winner, an earlier winner's ticket does not count for the replacement.

Delete Listing has a separate **DELETE** confirmation. It removes the giveaway's original public listing, keeps the database record and private staff archive, records who deleted the listing and when, and leaves the event marked **ended** — **never cancelled**. For activity giveaways it removes the activity-directory listing **without removing the separate winner announcement**. For Court's Trials it removes the signup announcement **without removing the separate Royal Verdict**. The activity-directory sweep now keeps ended one-off listings visible until staff deletes them. Cleanup retries after temporary Discord failures. No future claim rerolls or announcements are triggered for a deleted completed listing.

## Replit test workflow

Stop the test bot before switching code:

```bash
git fetch origin
git switch feature/trials-guided-setup
git pull --ff-only origin feature/trials-guided-setup
npm test
node register-commands.js
npm start
```

**Warning:** `node register-commands.js` replaces the target Discord application's command list. Verify you are using the development bot's token, client ID and test guild before re-registering. For Hatchem game testing, the existing test mode and message-content intent requirements still apply.

Discord checklist:

1. In a new test guild, try a non-setup slash command. It must direct staff to initial setup.
2. Run `/setup general`. Verify the first step requires a commands channel, every later step can be skipped, and the saved setup summary has the intended channels. Confirm unconfigured features do not post their entry panels.
3. Run `/setup cards`. Choose a manageable Collector role beneath the bot, assign a Hatchem channel, and try both disabled/enabled wild eggs. Register in Hatchem, use `.drop`, and confirm old global cooldowns and owned cards are unchanged.
4. Run `/setup trials`. Pick a separate Trial channel and private staff channel; choose the shared giveaway ping role, claims, and rerolls; preview the Royal Verdict and save. Verify notifications occur only once. The minimum of two trial contestants is unchanged.
5. Create a short Trial and let it finish. The winner's ticket form must accept only their claim and privately display it to staff. A second member cannot submit on their behalf. Verify automatic replacement (when enabled), saved history, and a Trial without remaining eligible replacements.
6. Re-open each setup and change one setting; verify unrelated features and historical giveaway/Trial records are unchanged.
7. Test restart recovery. Do not merge or deploy to production without explicit authorization.

## Scheduled Pings staff dashboard

Select an optional private Scheduled Pings dashboard channel in `/setup general`. The bot maintains one permanent message there with controls for creating templates, managing schedules and reviewing history. Each active schedule sends pings to exactly one independently selected channel. Finished schedules are archived in the shared archive chosen in General Setup. The bot must have View Channel, Send Messages and Read Message History in its management channel; Pin Messages is optional.
