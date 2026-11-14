# Giveaways and Court's Trials — guided setup, activity tracking, staff controls, and claims

**Updated:** November 10, 2026, following giveaway/Trial testing feedback.  
**Development branch:** `feature/trials-guided-setup` (based on `feature/activity-giveaways-complete`). **Documentation only**; this page is not proof of Discord testing or production deployment. Do not merge into `main` or deploy to Wispbyte without the owner's approval.

## Which setup and commands to use

Configure the server through the current guided commands:

1. `/setup general` — set the bot **commands channel** first; unrelated modules are optional.
2. `/setup giveaways` — set regular giveaway channels and shared defaults.
3. `/setup activity-giveaways` — set the **public activity directory**, the **separate activity winners/results channel**, a **private staff/review channel**, and the **bot-managed Opt In / Opt Out participation panel**. Set claim instructions/defaults and notification settings here.
4. `/setup trials` — set the Court's Trials channel, trial eligibility/claim defaults, and related settings.
5. Start a regular giveaway with `/giveaway start`, or start an activity giveaway with **`/giveaway activity`**. Both use guided setup; `/trial start` starts a Court's Trial.

**Create and answer the activity wizard in the configured commands channel, not in DMs or in the private staff-record channel.** The bot prompts in that channel, then posts the confirmed giveaway to the public activity list and creates its private staff record. Staff should use the on-message controls to manage it.

The old `/setup channels` path is retained only for compatibility with already cached interactions; it is not the current setup method. The old `/giveaway watch-save`, `watch-list`, `watch-delete`, `plan-create`, `plan-edit`, `plan-view`, `plan-list`, `prize-*`, and record-management slash commands are **not the current advertised creation/management workflow**. Previously saved watches, schedules, records, and prize histories must be preserved; do not delete legacy data as part of setup.

### Public and staff destinations

- **Public activity directory:** displays the prize, title, optional giveaway description, the real activity requirements, activity start/end, announcement time and results channel; no public list of qualifying members. Qualifying members enter **automatically** — there is no manual entry button.
- **Activity winners/results channel:** receives the actual result (or a configured no-winner result). Do not add claim directions when nobody was selected as a winner.
- **Private staff/review channel:** receives a staff record with progress preview and management buttons, then updates with winners, claim deadlines, submitted ticket details and reroll history. Staff-only claim information belongs here, not in redundant public text.
- **Existing regular giveaways and Trials:** retain their separately configured destinations. The Court's Trial Royal Verdict remains public after staff archive the trial.

For a **one-time guided activity giveaway**, its directory post remains visible after drawing, including while a winner has a claim pending, until staff deliberately use **Delete Listing** when that action becomes eligible. Ending a giveaway is not the same as deleting its listing. A recurring plan's ongoing directory listing can be updated for new rounds; legacy schedules and completed posts should not be silently discarded.

## Internal activity participation (no Discord role)

The bot maintains a **per-server MongoDB opt-in list**. The public **Activity Giveaway List** has one permanent participation panel at the bottom with **Opt In**, **Opt Out**, and **My Status** buttons. Members click **Opt In** before their messages can count. The bot checks that active consent record before saving a guided receipt or a legacy giveaway minute count; members without active consent are not logged for activity giveaways. No Discord role is assigned, and regular giveaway eligibility, ping, bonus, or Giveaway Manager roles are unaffected.

Opting out immediately stops new tracking and removes the member from live progress previews and winner selection. A later opt-in starts a **new** counting window; only the new session can qualify. Guided receipts use exact message timestamps, and minute-level counter records filter out earlier sessions. The activity listing footer reminds users to opt in. The panel is a **bottom-of-channel sticky**: it is automatically moved down after new giveaway posters, and the recurring sweep moves it beneath newer chat when at least ten minutes have elapsed since the last bump. The bot sends the replacement before removing the old panel and retains only the latest button panel. It does **not** require pinning a Discord message. Historical staff archives preserve past records.

Activity opt-in is **independent of regular giveaways, Court's Trials, Points and Hatchem**. Existing activity giveaways can keep their schedules and counting requirements; the old participation-role setting is ignored by the new system.

## Required Giveaway Banned role — server-wide punishment

The **Giveaway Banned role** must be selected in either `/setup giveaways` or `/setup activity-giveaways` before giveaway setup can be saved. It is a single shared role: the bot does not create or assign it. Staff apply and remove the Discord role manually as a punishment, so there is no time limit, cooldown, or per-giveaway switch.

When a member receives the Giveaway Banned role, the bot **revokes their existing MongoDB activity opt-in**, recording why the current consent window ended. Removing the role **does not automatically opt them back in**. They must personally press **Opt In** again; previous activity cannot carry over. The bot checks bans when a member sends an activity message, on an available member-update event, and in incremental background reconciliation that catches missed updates or bot downtime. For immediate gateway member-update events, enable the optional Guild Members Intent both in the Discord Developer Portal and with `ENABLE_GUILD_MEMBERS_INTENT=1`; periodic checks work without it.

Members holding this role are **blocked from entering regular giveaways and Court's Trials**. Members cannot opt in to activity giveaways, and even previously opted-in members stop generating activity giveaway logs while banned. Previously saved activity cannot make them eligible; the ban is checked again before every regular/activity draw, reroll and Court's Trial start. Banned members are omitted from current staff activity progress. Existing announcements need no public ban message; entry attempts receive a private explanation.

Any change to the banned role in server setup applies to all giveaways; no active giveaway can opt out. This is **entirely separate from the optional winner cooldown system** (which remains a design, not implemented).

## Winner cooldowns (separate from punishment bans)

Regular and activity giveaways have an optional **Winner Cooldown check**, which defaults **OFF** and can be toggled ON or OFF per giveaway. Guided recurring activity giveaways carry this option forward into each repeat; legacy scheduled plans store it as well. Staff can edit the setting on an open giveaway. **Court's Trials never use winner cooldowns.** The required Giveaway Banned role is always enforced, regardless of the cooldown setting.

Once staff confirm all prizes delivered, the private staff record shows **Apply Cooldown** beside **Archive Giveaway**. For one winner, the bot opens a duration modal; for multiple winners, staff can select one, several or all. A staff member enters a whole number of days (1–365), reviews the named winners and exact expiration, then confirms. The countdown starts at the **prize-delivery confirmation timestamp** rather than the date staff archive or click Apply. Cooldowns are not created automatically.

Each server/member has one effective MongoDB cooldown with a private application/removal/correction audit. A new application cannot accidentally shorten a longer existing restriction. Cooldowns expire automatically when checked; the bot silently removes active cooldown members from the **winner drawing pool** and from subsequent manual or automatic rerolls when that giveaway has cooldown enforcement ON. No public reroll, announcement, tracking penalty or activity-log change occurs. The final check also happens upon staff approval, if manual drawing approval is enabled. No eligible members produces the existing no-eligible-winner behavior.

After applying a cooldown, the staff record offers **Manage Cooldowns** while it remains active. The private **Active Giveaway Directory** has **Winner Cooldowns** for server-wide active-member lookup, manual correction of remaining days and immediate removal; those actions work even after the source giveaway is archived. All changes are auditable. Archive never resets a cooldown. The staff management controls do not change the separate Discord Giveaway Banned role.

## Guided activity giveaway: counting rules

### Message target means the total for the whole activity period

**The message goal is a TOTAL, not a per-active-day quota.** For example, choosing **50 qualifying messages** for a weekly activity means 50 matching messages **across that one weekly activity window**. It does **not** mean 50 each day or 50 multiplied by the number of active days.

- The wizard offers **1, 3, 5, 10, 20**, or **Custom number**. Custom totals may be **1–10,000**; the minimum goal is **1**.
- **Distinct active days** are a separate optional condition. If the activity requires three different days, a member must contribute at least one qualifying message on three distinct days **and** reach the total-message goal during the full period. It is still **not a daily message quota**.
- **Minimum characters per message** is yet another independent option: none / 5 / 10 / 25 / 50 / Custom (1–2,000). The length rule applies to each counted message; explicit member mentions do not satisfy a custom text-length threshold.
- The wizard can count messages in **all eligible server channels** or **one chosen channel**.
- Optional matching filters are **Any message**, **Member ping**, **Word or phrase**, or **Ping and phrase**. A required member ping must be a real explicit user mention; a plain name or role ping is insufficient. Phrase spelling and word order must match; capitalization does not matter. When both are selected, the **same counted message** must meet both rules.
- **Activity Participation is mandatory.** In `/setup activity-giveaways`, staff must select a dedicated opt-in role (and may provide instructions for where to obtain it). Members must actively obtain this role **before** any messages count. Without the role, neither guided activity receipts nor legacy activity giveaway counters record their messages. This is **not** the optional regular giveaway eligibility role configured through `/setup giveaways`.
- No individual activity giveaway can disable, hide, or replace the Activity Participation requirement. The creation wizard automatically uses the server's current opt-in role and displays how to obtain it. Regular giveaways and Court's Trials keep their own independent eligibility settings.
- Removing Activity Participation stops new activity logging and excludes the member from staff previews and subsequent winner draws/rerolls; restoring it only counts newly sent messages. If staff change the configured participation role, open guided activity periods restart counting to avoid carrying over messages from the previous role. Old receipt records remain subject to their normal expiry, not retroactively redistributed.
- Older saved activity schedules continue to work only with a configured participation role. Their historical counters cannot be assumed consented: the bot restricts legacy calculations to the post-configuration minute-level activity window.
- Bots, webhooks and otherwise ineligible messages are excluded. Activity counts are recorded as qualifying events/counters rather than storing message bodies; a change in important matching conditions can restart the current activity window instead of retroactively counting prior messages.

**Progress preview:** The staff-only **Preview qualifying members** button displays members with recorded participation since the current activity started, including qualifying and not-yet-qualifying progress. It omits people with **no recorded activity** in that window; it should never list the entire server membership just to show zeros. Each person appears once, even if they sent many messages or met several filters. A private **Check My Progress** button can be enabled for members (on by default in the guided activity wizard); it shows only the requesting person's progress.

### Activity window and announcement

The guided wizard offers:

- **24 hours**, **Weekly** (choose week start and end weekdays, at midnight Eastern), **Custom days**, or **Custom hours**.
- Counting begins when staff confirm **Create activity**; future repeating occurrences get their own windows. Activity from an earlier occurrence is not a new entry in the next occurrence.
- Draw/announce **when counting ends**, or at a chosen later date/time in **America/New_York**.
- One winner or several (wizard supports **1–10**).
- An optional description separate from the giveaway title, prize and activity requirements.
- Optional staff approval, role-based bonus chances, custom claim instructions/window, claim reroll limit, banners, member progress and no-winner announcements.

**Winner selection:** Every qualifying member is **one distinct entrant**; 50 messages or multiple qualifying pings are not 50 tickets. Bonus roles add drawing *weight*, not extra member entries. Multiple matching bonus roles can add their weights, but a member cannot win two places in the same draw. The bot checks that a selected member is still in the Discord server before announcing them.

**Optional manual approval:** When enabled, qualification is collected at draw time but the bot waits for private staff **Approve & Draw** or **Decline**. Declining does not consume the prize. Default approval is **off**. Staff previews should show people making progress without including all inactive members.

### Repeat scheduling

After setting the giveaway, staff choose **One time**, **Every 24 hours**, **Every week**, or a **Custom interval** in minutes, hours or days. For repeatable giveaways, choose:

- **Forever (until staff stops it)**, or
- **Custom number of additional repeats** (**1–1,000**). The first giveaway is not counted as an additional repeat: **2 repeats = 3 giveaways total**.

The **confirmation preview**, before Create activity, includes the next **up to two** repeating occurrences with their **start and end** times. The exact number shown depends on how many repeats are configured. Repeats have independent activity windows and should not overlap in ways that count the same activity twice. Staff can stop future repeats without cancelling the current occurrence.

A legacy saved `GiveawayPlan` may use older day/week/fixed-hour schedule and prize-rotation rules. Those records are preserved for compatibility; do **not** confuse their old `plan-*` interface with the current guided repeat wizard. The current wizard's prize is repeated as configured; it does not expose the legacy `prize-add` / `prize-move` command workflow.

## Staff-only management buttons

Use the private staff record, not an old slash-command management workflow:

| When | Available action | Meaning |
| --- | --- | --- |
| During activity collection | **Preview qualifying members** | See active members who are qualified or making progress; inactive members are omitted. |
| During an open giveaway | **View Entrants** / **View Contestants** | Review the recorded member list privately. |
| During an open giveaway | **Edit Giveaway** | Change supported settings through the private staff controls. Changes are not a second giveaway. |
| During an open giveaway | **End Early** | Confirm ending early and proceed through the normal drawing/approval, announcement and claim workflow. Do not treat it as cancellation. |
| During an open giveaway | **Cancel Giveaway** | Confirm cancellation, select no winners, and remove the public listing while preserving staff history. |
| While a recurring series is active | **Stop future repeats** | Stop creating later occurrences without cancelling the current activity. |
| After winners are selected, while claims are outstanding | **Manual Reroll** | Choose an unclaimed winner position and confirm replacement, if another eligible member is available. |
| Once a finished regular/activity giveaway is eligible for removal | **Delete Listing** | Remove its public listing, **not** the giveaway's winner/claim history. |
| For a completed Court's Trial | **Archive Trial** | Close the signup/listing and preserve the public Royal Verdict and private history. **Do not label it Delete Trial.** |

For Trials, staff can **Start Trial Early** or **Finish Trial Early** when the corresponding live state allows it. Trial contestant views and archived Royal Verdicts remain distinct from ordinary activity qualification.

**Delete Listing is not available while a current winner still has a live unclaimed deadline or possible rerolls.** A giveaway with no eligible winner, or with all claims submitted/remaining places exhausted, can become removable. Staff must intentionally remove the public listing; the private historical record remains.

### Staff record statuses and colors

| Color | Status | Rule |
| --- | --- | --- |
| **Blue** | In progress | Entries are collecting, the draw is preparing, or staff approval is pending. |
| **Yellow** | Winner claim pending | At least one selected winner has not yet submitted a valid claim; includes reroll in progress. For older staff-managed Trials, staff follow-up is shown separately. |
| **Green** | Claim completed | All current prize places are resolved and at least one current winner submitted a ticket claim. This is **not** proof the Roblox prize was delivered. |
| **Red** | No eligible winner | No selected eligible winner remains, including cases where unclaimed places have exhausted replacement options. |
| **Gray** | Cancelled / archived / listing deleted | Public listing has been removed or the Trial archived. This **overrides** an earlier yellow/green/red state. |

Claim deadlines that have passed display **Expired** instead of an endlessly negative relative countdown. Ticket number, link, submission time and reroll history are shown in private staff fields rather than repeated throughout the main staff message. Claims update the staff record; the result should not duplicate winner text or long explanations of reroll mechanics.

## Winner claims and automatic rerolls

- Winners open their own normal support tickets. **The bot does not create tickets, validate prize delivery or hand out Roblox items.**
- The active winner submits the ticket **number and Discord message URL** with the giveaway's claim button; merely opening a ticket does not register a bot claim.
- Guided activity and regular giveaways normally give **12 hours** to claim, with a guided custom setting (1–720 hours). Each replacement winner has their own fresh deadline.
- Guided activity giveaways can set the **maximum automatic rerolls per unclaimed position** (0–10; default 2), with staff able to intervene manually while a claim is pending. Automatic expiry should not reroll someone who already submitted the required ticket information.
- When the deadline passes without a claim, an unused eligible entrant may replace that winner. Previous winners cannot win the same place again. If no eligible replacement remains, the place is forfeited and marked **Expired**; staff may remove the listing when eligible.
- **When no winner is selected, do not publish claim instructions or claim-window information.** A no-winner result may be announced if that option is enabled, without consuming the prize.
- New Trials configured through `/setup trials` may use ticket-claim handling and optional automatic rerolls; **older Trials keep their prior staff-managed claim behavior**. The current `/trial start` supports `claim_minutes` (minute-based window), while earlier stored Trial durations in hours remain valid for existing records.
- Public result messages should be concise: do not repeat the winner list in multiple places or include unnecessary reroll/process explanations. A claim submission confirms the ticket information was recorded, **not** prize delivery.

## Banners, prize details and privacy

- Register a reusable image with the `/giveaway banner-*` actions (PNG/JPG/WebP/GIF, maximum 4 MB). Banners are stored for reuse rather than relying on a temporary Discord upload URL.
- The guided activity wizard can choose a saved banner, upload and register a new one in the **commands channel**, or keep the server default. Changes in selection must not erase other draft settings.
- A custom **Giveaway Details** paragraph may be entered separately from the prize/title (up to 1,000 characters); include it in public listing and staff/preview/result where supported.
- Bonus roles can award 1–20 additional chances each (up to 20 configured bonus roles); chances add, but a winner is selected only once.
- Staff review and ticket details belong in a permission-restricted channel. Public directory listings do not show staff-only qualification rosters, ticket URLs, raw administration data, or confidential notes.
- A saved prize/claim history is never deleted by editing a description, archiving a Trial, or clearing a finished directory card.

## Legacy watches and plans — retained but not the current UX

Older saved `GiveawayWatchRule` / `GiveawayPlan` records may still use a previous calendar day, a completed Wednesday–Wednesday week, custom historical windows, separately saved watches, and independent prize queues. Those records should continue to function without silently changing their historical thresholds.

**Important distinction:** In legacy rules, a `minimumMessages` / `per_day` value may be a **separate optional per-active-day condition**, alongside a `minimumTotalMessages` total and `activeDays`. Do not describe that legacy extra condition as the meaning of the new guided wizard's **message goal**. The guided message goal always means the **whole activity period total**.

Legacy dates, reviews, role bonuses and prize queues are historical implementation details, not instructions to create new giveaways through retired `/giveaway watch-save` or `/giveaway plan-create` commands. If a saved legacy plan needs specialized maintenance, inspect its retained data and compatible staff controls instead of guessing a currently registered slash command.

## Replit and Discord verification checklist

1. From the separate development environment, fetch the branch, run `npm test`, and register the current slash commands before restarting the test bot.
2. Run `/setup general`, `/setup giveaways`, `/setup activity-giveaways` and `/setup trials` as applicable; confirm channel visibility, private staff review access and the shared notification role.
3. Start `/giveaway activity` in the **commands channel**. Confirm wizard steps remain there (not DMs) and confirmation creates one public activity-directory entry **plus** one private staff record.
4. Choose **50 total messages** and 3 active days. Confirm 50 matching messages across the full period qualify once, while fewer than 3 distinct days do not. Check the minimum of 1, custom goal, and optional per-message character length.
5. Test a real member ping, exact phrase, combined ping + phrase, all channels versus one chosen channel, and required role; no matching data should be fabricated from earlier chat.
6. Test daily, weekly, custom-hour/day activity periods; one-time, 24-hour, weekly and custom-interval repetition. Check Forever and a custom number of repeats, plus the **next two start/end** preview lines.
7. Use **Preview qualifying members**. Confirm active qualifying and active not-yet-qualifying members appear, but members with zero recorded messages during the activity do not.
8. Edit, End Early, Cancel, Stop future repeats and View Entrants from private staff controls. End Early must use the ordinary winner/claim path; Cancel must not draw winners. Confirm private staff state updates.
9. Confirm a one-time giveaway stays in the public directory **after drawing and throughout pending claims**. Test manual reroll while unclaimed, automatic reroll at expiration, submitted ticket claims, no replacement available, and removal only via eligible **Delete Listing**.
10. Confirm status colors: blue in progress, yellow pending, green claim submitted, red no eligible winner and **gray after cancellation/archive/deletion**. Expired deadlines must say **Expired**, not count below zero.
11. Test zero eligible members: optional no-winner public result, no claim information and no consumed prize. Verify public result is compact and staff detail is not duplicated.
12. Check Court's Trial **Archive Trial** (not Delete), Royal Verdict persistence, minute-based claim option, and old Trial compatibility.
13. Simulate restarts and concurrent actions to ensure no repeated draw, double claim or lost staff/history records. Check regular giveaway and other bot features for regression.
14. **Do not merge into `main`, update AM-bot, or restart Wispbyte** without separate explicit approval. Passing automated tests is not the same as completing Discord testing.

### Development pull commands

```bash
git fetch origin
git switch feature/trials-guided-setup
git pull --ff-only origin feature/trials-guided-setup
npm test
node register-commands.js
```

Restart the **Replit test bot** only after confirming the development token/database. No production deployment is implied.


**Entry blocking with winner cooldowns:** When a regular giveaway's **Winner Cooldown check** is **ON**, anyone with an active server-wide winner cooldown is refused by **Enter Giveaway** and receives a private message showing when their cooldown expires. Existing entries are removed when staff apply a cooldown to a member, and the periodic sweep also cleans up entries saved before this fix. The giveaway draw and rerolls continue excluding cooled-down members. **OFF** retains the deliberate opt-out and allows participation despite cooldowns. Activity giveaways have no Enter button, so they continue filtering at drawing/approval; Court's Trials are never affected. This restriction is separate from the non-optional Giveaway Banned role.
