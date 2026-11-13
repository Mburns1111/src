import {
 ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle,
 EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
 StringSelectMenuBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {requireGuild} from "./shared.js";
import {UserFacingError} from "./errors.js";

export const data=new SlashCommandBuilder().setName("help")
 .setDescription("Open the bot's private Public or Staff help center");

export const PUBLIC_TOPICS=Object.freeze([
 {id:"home",label:"Getting Started"},
 {id:"listings",label:"Listings & Trading"},
 {id:"shop",label:"Shop & Points"},
 {id:"cards",label:"Collectible Cards"},
 {id:"giveaways",label:"Giveaways"},
 {id:"games",label:"Games & Activities"},
]);
const STAFF_GROUPS = [
 { label: "Server setup", topics: [
  {"id":"ssetup","label":"Bot Setup"}
 ] },
 { label: "Giveaways", topics: [
  {"id":"sgiveaways","label":"Run a Giveaway"},
  {"id":"sactivity","label":"Track Activity"},
  {"id":"sarchives","label":"Archive Records"}
 ] },
 { label: "Other staff tools", topics: [
  {"id":"scards","label":"Hatchem Cards"},
  {"id":"spoints","label":"Points & Shop"},
  {"id":"spings","label":"Scheduled Pings"},
  {"id":"sgames","label":"Party Games"}
 ] }
];
export const STAFF_TOPICS = Object.freeze(STAFF_GROUPS.flatMap(group => group.topics));
export const HELP_TOPICS=Object.freeze([
 {id:"root",label:"Help Home"},{id:"public",label:"Public Help"},
 {id:"staff",label:"Staff Help"},{id:"commands",label:"Command Index"},
 ...PUBLIC_TOPICS,...STAFF_TOPICS,
]);
const VALID=new Set(HELP_TOPICS.map(x=>x.id));
const STAFF_IDS=new Set(["staff",...STAFF_TOPICS.map(x=>x.id)]);
const PUBLIC_IDS=new Set(["public",...PUBLIC_TOPICS.map(x=>x.id)]);
const CONTENT=Object.freeze({
 "root": [
  "✦ AM Isa · Help Center",
  "Choose **Public Help**, **Staff Help**, or **Command Index** below. Everything opens privately.",
  []
 ],
 "public": [
  "✦ Public Help",
  "Choose a topic from the dropdown. Member features use buttons in their assigned channels.",
  []
 ],
 "staff": [
  "✦ Staff Help",
  "Complete Bot Setup first. Select a topic from the grouped dropdowns. Staff commands have their own permission checks.",
  [
   [
    "Server Setup",
    "Bot Setup"
   ],
   [
    "Giveaways",
    "Run a Giveaway · Track Activity · Archive Records"
   ],
   [
    "Other Staff Tools",
    "Hatchem Cards · Points & Shop · Scheduled Pings · Party Games"
   ]
  ]
 ],
 "home": [
  "Getting Started",
  "Welcome to **AM Isa!** The bot helps you create profiles, share your Adopt Me collections, trade with other members, earn Points, and participate in games and giveaways.",
  [
   [
    "1. Member Profiles",
    "Create and customize your profile using the buttons in the **Member Profiles** channel."
   ],
   [
    "2. Inventory Showcase",
    "Share your Adopt Me inventory using the buttons in the **Inventory Showcase** channel. You can also link your inventory to your profile."
   ],
   [
    "3. Explore the Bot",
    "Use the buttons in each channel to access trading, the shop, collectible cards, games, and giveaways."
   ],
   [
    "4. Need Help?",
    "Select a topic from the Help menu to learn more about each feature."
   ]
  ]
 ],
 "listings": [
  "Listings & Trading",
  "Members can share their Adopt Me houses, outfits, and trading information using the buttons in the corresponding channels.",
  [
   [
    "1. Create Listings",
    "Use the channel buttons to create:\n• House Listings\n• Outfit Listings\n• Trading Posts\n• Trade Voting posts"
   ],
   [
    "2. Manage Your Listings",
    "Use **My House Listings** or **My Outfit Listings** to find and manage your existing posts."
   ],
   [
    "3. Photos & Videos",
    "Add photos or videos to your listings. Use the photo navigation buttons to browse uploaded images."
   ],
   [
    "4. Interest & Updates",
    "Members can show interest using the buttons on a post. Listing owners can edit and update their published listings."
   ]
  ]
 ],
 "shop": [
  "Shop & Points",
  "Earn **AM Isa Points** through server participation and spend them on profile customizations.",
  [
   [
    "1. Browse the Shop",
    "Visit the **Shop** channel and use the buttons to browse available items."
   ],
   [
    "2. Customize Your Profile",
    "Purchase backgrounds, frames, fonts, colors, stickers, and other decorations. You can preview items before buying them."
   ],
   [
    "3. Check Your Points",
    "Use **See Balance** to check how many Points you have."
   ],
   [
    "4. Hatchem Shop",
    "Hatchem has its own shop where you can spend Points on extra grabs and drops. Access it through the Hatchem game."
   ]
  ]
 ],
 "cards": [
  "Collectible Cards — Hatchem",
  "Hatchem is a collectible card game where members hatch eggs, collect unique pet cards, and build their collections.",
  [
   [
    "1. Getting Started",
    "Visit the **Hatchem** channel and follow the registration instructions to begin collecting cards."
   ],
   [
    "2. Collect Cards",
    "Participate in egg drops, grab cards, and grow your collection."
   ],
   [
    "3. Manage Your Collection",
    "Trade, gift, upgrade, and organize your cards using Hatchem's game controls."
   ],
   [
    "4. Hatchem Shop",
    "Spend AM Isa Points on extra grabs and drops through Hatchem's independent shop."
   ],
   [
    "5. Need Help?",
    "Type `.tutorial` for the beginner guide or `.help` for the full Hatchem command list in the Hatchem channel."
   ],
   [
    "Disclaimer",
    "*Hatchem is an independent fan-made game and is not affiliated with, endorsed by, or sponsored by Roblox or Adopt Me.*"
   ]
  ]
 ],
 "giveaways": [
  "Giveaways",
  "Participate in giveaways for a chance to win prizes! Each giveaway type has its own entry requirements.",
  [
   [
    "1. Regular Giveaways",
    "Use **Enter Giveaway** on the regular giveaway post. Some giveaways require a particular server role; follow the instructions on that post. Activity opt-in is separate and not required for regular giveaways.\n\nThe server-wide **Giveaway Banned** role prevents entry into every prize giveaway."
   ],
   [
    "2. Activity Giveaways",
    "Find **Activity Giveaway Participation** at the bottom of the **Activity Giveaway List** and press **Opt In**. No Discord role is required for activity participation, and there is no entry button for each giveaway; qualifying messages enter you automatically.\n\nUse **Opt Out** to stop tracking. If you opt in again, earlier activity does not carry over. **My Status** shows your current choice.\n\n**Giveaway Banned role:** Receiving it revokes your opt-in. After staff remove the role, you must manually press **Opt In** again to start fresh."
   ],
   [
    "3. Court's Trials",
    "Press **Join Trial** on an open Court's Trial. Staff start the contest; story-based eliminations continue until the ranked prize winners are decided in a **Royal Verdict**.\n\nSome Trials require an entry role. The Giveaway Banned role prevents joining or winning."
   ],
   [
    "4. Check Your Progress",
    "Use **Check My Progress** on an activity giveaway to see your qualifying messages and requirements privately. Progress counts over the entire posted activity period, not per day unless an active-day goal is also shown.\n\nIf you are not opted in, use the participation panel below the Activity Giveaway List."
   ],
   [
    "5. Claiming Prizes",
    "**Winners must submit a claim using the button below the winner announcement before the claim deadline, or the prize is forfeited.** Opening a ticket alone does not submit your claim.\n\nPress **Enter Ticket Claim info** and provide your **ticket number** and the **Discord message link** to that ticket. Staff verify your claim and deliver prizes manually. If a winner misses the deadline, the bot may select a replacement.\n\nOlder staff-managed Court's Trials may use a different claim process; follow that Trial's announcement."
   ]
  ]
 ],
 "games": [
  "Games & Activities",
  "Join community games and activities for fun, friendly competition, and opportunities to earn rewards!",
  [
   [
    "1. Party Games",
    "Join staff-hosted games through the buttons in the **Party Games** channel.\n\n**Current Game: Court of Chaos**\nA Jackbox-style game where players submit creative or funny answers to private prompts, then vote on each other's responses. Games last three rounds."
   ],
   [
    "2. Activity Rewards",
    "Some games and server activities may award AM Isa Points when enabled by staff."
   ]
  ]
 ],
 "commands": [
  "Command Index",
  "Registered bot commands are listed here for reference. Viewing the index does not grant access to restricted commands. Most member features use channel buttons, while Hatchem has its own `.help` guide.",
  []
 ],
 "ssetup": [
  "Staff · Bot Setup",
  "Create the channels you need, then run guided setup to assign them. Initial setup must be completed before using the bot's other features.",
  [
   [
    "1. Bot Commands & Shared Archives · PRIVATE / Required",
    "**Required:**\n• **Bot Commands Channel** — Create a private text channel for setup, administration, and general bot management.\n• **Access** — Give authorized staff and the bot access; hide it from @everyone.\n\n• **Shared Staff Archives Channel** — A second required private channel for completed giveaway, Court\'s Trial and scheduled-ping records. It must be separate from Bot Commands and active giveaway staff controls.\n\n**Bot Commands, Shared Staff Archives and Server Time Zone are all mandatory in `/setup general`.** All bot setup commands must be run in this channel (Bot Commands)."
   ],
   [
    "2. Profiles, Trading, Shop & Points · PUBLIC",
    "**Public channels (as needed):**\n• Member Profiles\n• Inventory Showcase\n• House Listings\n• Outfit Listings\n• Trading Posts\n• Trade Voting\n• Shop\n\nThese channels allow members to create and share their Adopt Me profiles, inventories, houses, outfits, and trading information. Configure these channels with `/setup general`."
   ],
   [
    "3. Hatchem Cards · PUBLIC",
    "**Required setup:**\n• **Hatchem Channel** — A public text channel for the card game.\n• **Collector Role** — A role the bot has permission to assign to members.\n\n**Setup command:** `/setup cards`\n\nMembers automatically receive the Collector role when they register for Hatchem."
   ],
   [
    "4. Party Games · PUBLIC",
    "**Required setup:**\n• **Party Games Channel** — A public text channel for hosting game sessions and displaying results.\n\n**Setup command:** `/setup general`\n\n**Current Game: Court of Chaos**\nA Jackbox-style party game where players submit creative or funny answers to private prompts, then vote on each other's responses. Games last three rounds, with winners determined by votes. Staff can award prizes and choose from several prompt categories."
   ],
   [
    "5. Giveaways & Court's Trials · PUBLIC and PRIVATE",
    "**Required public channels:**\n• **Regular Giveaways** — Entry posts and results.\n• **Activity Giveaway List** — Posters, progress, and the Opt In / Opt Out participation panel.\n• **Activity Winners** — Winner announcements and claim buttons.\n• **Court's Trials** — Signups, eliminations and Royal Verdicts.\n\n**Required private channels:**\n• **Giveaway Staff Controls** — Staff directory, previews, claims and delivery.\n• **Shared Staff Archives** — Assigned once under `/setup general`; stores completed/cancelled giveaway and Scheduled Pings records.\n\n**Required Giveaway Banned role:** Shared punishment across all three giveaway types; overrides entry and activity opt-in. An unbanned member must opt in again.\n\n**Activity opt-in:** MongoDB stores consent; no participation role is required.\n\n**Other roles:** Optional Giveaway Manager, regular entry role, and shared giveaway ping role. No participation role is required.\n\n**Setup:** `/setup giveaways` · `/setup activity-giveaways` · `/setup trials`"
   ],
   [
    "6. Bot Permissions",
    "Give the bot **View Channel**, **Send Messages** and **Embed Links** in assigned channels. Use **Read Message History** and **Attach Files** where needed, especially for archiving and banners.\n\n**Activity counting:** The bot needs **View Channel** access to every channel included in activity tracking."
   ],
   [
    "7. Setup Order",
    "First run `/setup general` to assign the required private **Bot Commands** and **Shared Staff Archives** channels and choose your **Server Time Zone**.\n\nSelect **Bot Commands**, **Shared Staff Archives**, and the **Server Time Zone** in `/setup general`. The optional **Scheduled Pings Dashboard** is a private staff channel with permanent management buttons.\n\nThen configure the features you use:\n1. `/setup cards` — Hatchem.\n2. `/setup giveaways` — Regular giveaways, shared Banned role and staff controls (the archive is set in General).\n3. `/setup activity-giveaways` — Activity list, winners, shared settings.\n4. `/setup trials` — Court's Trials.\n\nSet the **required Giveaway Banned role** in the regular or activity giveaway setup before creating any prize giveaways or Trials. Rerun setup to change future defaults.\n\nUse private **Bot Commands** for staff commands; public participation uses buttons."
   ]
  ]
 ],
 "sgiveaways": [
  "Staff · Run a Giveaway",
  "Host regular, activity, or Court's Trial giveaways. Manage active events and claims in private staff controls.",
  [
   [
    "1. Choose a Giveaway Type",
    "• **Regular** — `/giveaway start`: members click **Enter Giveaway**; optional required entry role.\n• **Activity** — `/giveaway activity`: members press **Opt In** at the Activity Giveaway List. Qualifying messages give automatic entry; no entry button or participation role per giveaway.\n• **Court's Trial** — `/trial start`: members join a timed elimination contest.\n\nComplete the matching server setup first. The **required Giveaway Banned role** always blocks participation and prizes across all three; staff cannot disable it per giveaway.\n\n**Winner Cooldown** is a separate, optional **ON/OFF** setting on regular and activity giveaways, default **OFF**. If ON, active cooldowns are silently excluded at drawing and rerolls. Court's Trials ignore cooldowns."
   ],
   [
    "Court's Trials — Fast-Paced Giveaways",
    "**Court's Trials** run in their own public channel, separate from regular and activity giveaways. Members press **Join Trial**, and staff select **Start Trial**. The bot posts randomized eliminations and a ranked **Royal Verdict**.\n\n**Private channels:** Shared Giveaway Staff Controls and Shared Staff Archives. Assign the archive in `/setup general`, then configure Trials with `/setup trials` in Bot Commands."
   ],
   [
    "2. Create and Post",
    "In private **Bot Commands**, start a guided giveaway and choose a title, prize, description, duration, number of winners and any requirements. Regular giveaways can use a required entry role, show/hide role instructions, and specify rules.\n\n**Activity extras:** Message goals, active days, channel/phrase/mention filters, weighted bonus roles, optional staff approval and repeat schedule. Bonus roles add extra drawing chances (up to +20 per role); **each member can win only once**.\n\nYou can select or upload reusable **banners**, customize ticket-claim instructions and deadlines, and choose Winner Cooldown ON/OFF. A **shared giveaway ping role** can announce new events.\n\nReview the private preview before choosing **Post Giveaway**."
   ],
   [
    "3. Manage Active Giveaways",
    "Use the **private Giveaway Staff Controls** channel. Its sticky directory lists active giveaways, upcoming activity schedules, and claim-pending events, with links to each staff record.\n\nStaff can **View Entrants**, review activity qualification, edit open settings, end early, cancel with a reason, and approve/decline manual-review activity drawings.\n\nAfter a drawing, staff can **Manual Reroll** a winning place or **Disable Further Rerolls**. The directory's **Winner Cooldowns** button shows active server-wide cooldowns and lets staff correct or remove them.\n\nIf nobody qualifies or no eligible replacement remains, the bot records **No Eligible Winner**; it does not require an unused claim."
   ],
   [
    "4. Giveaway Status Indicators",
    "🟦 **In Progress** — Entries or activity are being counted.\n🟨 **Claim Pending** — Awaiting a winner ticket claim.\n🟩 **Claim Completed** — Ticket claim submitted, **not yet delivered**.\n🟥 **No Eligible Winner** — Nobody qualified or no replacement remains.\n⬜ **Archived / Removed** — Staff record finalized.\n\n**Winner checks:** The bot verifies current server membership and required roles, applies the mandatory Banned role, and checks optional winner cooldowns before awarding or rerolling.\n\n**Automatic rerolls:** Unclaimed prize places may be rerolled after their deadline (default maximum **2 per place**, configurable; staff can disable further rerolls). Each replacement gets a new claim deadline.\n\n**Prize delivery:** A completed claim does not mean delivery is confirmed. Staff use **Confirm Prizes Delivered** only after all prizes are given."
   ],
   [
    "5. Archive a Giveaway",
    "After current winners submit their ticket claims and receive their prizes, staff select **Confirm Prizes Delivered**, then **Archive Giveaway**. Otherwise, cancel with a reason.\n\n**Apply Cooldown** appears beside Archive for delivered regular/activity giveaways. Privately select one, several or all winners, enter **1–365 days**, preview the expiration and confirm. Time starts at confirmed prize delivery; it survives archiving. Applying a shorter period never reduces a longer existing cooldown.\n\nThe staff **Winner Cooldowns** manager can view, correct or remove cooldowns even after archiving. Cooldowns are not the punishment Banned role.\n\n**On archive:** Regular public giveaway posts are removed; activity winner results and Court's Trial Royal Verdicts stay public. Staff history, claims, delivery, rerolls and settings are preserved privately."
   ]
  ]
 ],
 "sactivity": [
  "Staff · Track Activity",
  "Use `/setup activity-giveaways` to choose the public Activity Giveaway List, where the bot maintains its Opt In / Opt Out panel. Create activity giveaways with `/giveaway activity` in private Bot Commands.",
  [
   [
    "Activity Participation · REQUIRED",
    "Members explicitly press **Opt In** on the permanent participation panel at the bottom of the **Activity Giveaway List**. MongoDB stores their choice; **No Discord role** is needed for activity participation. **My Status** reports whether they are opted in.\n\n**Opt Out** stops new activity tracking and excludes them from drawings. Rejoining starts a **fresh counting window**: previous messages do not carry over.\n\n**Giveaway Banned role:** Receiving it revokes MongoDB opt-in. Removing the role does not restore participation; the member must press **Opt In** again. The bot checks message activity, role updates when enabled, and periodically reconciles missed bans.\n\nThe panel is kept below new activity listings and refreshed beneath later chat with a posting cooldown."
   ],
   [
    "1. Set the Requirements",
    "Use `/giveaway activity` in private Bot Commands.\n\n**Activity goals:**\n• **Messages:** Total qualifying messages across the **entire activity period**, not per day.\n• **Active days:** Optional number of separate days with a matching message (minimum 1).\n• **Length:** Minimum characters in each counted message, excluding mentions.\n• **Channels:** All eligible server channels or a selected channel.\n• **Filters:** Exact word/phrase, member mention, or both. Phrase matching ignores capitalization but preserves spelling/word order.\n\nYou can choose **multiple winners**, add weighted **bonus roles** (extra chances; one prize per member), enable private staff approval and select whether to announce an empty result. Only opted-in, unbanned members count."
   ],
   [
    "2. Review the Schedule",
    "Choose the counting start/end and announcement time. Periods may be **24 hours, weekly (midnight Eastern boundaries), or custom hours/days**.\n\nSet the giveaway to run **once, every 24 hours, weekly or at a custom repeat interval**, with a limited number of repeats or indefinitely. The wizard checks that scheduled periods do not overlap.\n\nFor repeating giveaways, the private preview lists the **next two scheduled periods** with their exact starts and ends. Staff can review/edit the plan before publishing.\n\n**Winner Cooldown ON/OFF** is saved with a recurring series. Opt-in is server-wide; members don't opt in separately for each giveaway."
   ],
   [
    "3. Check Progress",
    "Members press **Check My Progress** on an activity listing to see their own qualifying totals privately.\n\nIn **Giveaway Staff Controls**, use **Preview Qualifying Members** and **Refresh Progress** to see members who have started working toward requirements, whether they qualify, and the criteria they still need. **Members with no recorded activity are omitted.**\n\nStaff may review channel, message-count, active-day, word/phrase, mention and minimum-length requirements, plus edit upcoming schedules and eligible settings.\n\nMembers who **opt out** or receive the Banned role are excluded from live previews and drawings. Activity is counted only within each member's current opt-in window."
   ],
   [
    "4. Manual Approval",
    "Once counting ends, the bot checks who meets the activity requirements and is **still opted in**, in the Discord server and not Giveaway Banned.\n\nWith **manual approval ON**, staff use the private **Approve & Draw** or **Decline Drawing** buttons before public results. Weighted bonus roles affect odds, but members cannot win more than once in that drawing.\n\nIf **Winner Cooldown** is ON, members with active cooldowns are **silently skipped** at approval, drawing and rerolls. Cooldowns do not stop their activity logging.\n\nStaff can choose whether the bot announces **No Eligible Winner** when nobody qualifies. If no winner is selected, no prize-claim instructions are posted."
   ]
  ]
 ],
 "sarchives": [
  "Staff · Archive Records",
  "Completed and cancelled giveaway history and finished Scheduled Pings records are stored in the required private Shared Staff Archives channel.",
  [
   [
    "1. Archive or Cancel",
    "**Archive:** When all current winners have submitted valid claims and staff have delivered every prize, use **Confirm Prizes Delivered** and then **Archive Giveaway** in private Giveaway Staff Controls. Claims alone are not proof of delivery.\n\n**Cancel:** If a giveaway cannot be completed or no eligible winner remains, staff can cancel it with a reason and preserve the record.\n\nAfter delivery, regular and activity staff records also offer **Apply Cooldown** beside Archive. This is optional, does not happen automatically, and remains separate from the required Giveaway Banned role."
   ],
   [
    "2. Preserved Information",
    "The private **Shared Staff Archives** channel preserves:\n• Giveaway settings, requirements and participants.\n• Winner placements, claim tickets, ticket-message links and timestamps.\n• Prize-delivery confirmation, staff actions and cancellation reasons.\n• Manual/automatic reroll history and no-eligible outcomes.\n• Final activity progress snapshots and relevant review records.\n• Full giveaway data in an attached JSON record.\n\n**Only regular giveaways are deleted from their public channel when archived.** Activity winner announcements and Court's Trial Royal Verdicts remain public."
   ],
   [
    "3. Archive Setup",
    "**Required:** A private **Shared Staff Archives** channel, different from the private Giveaway Staff Controls channel and hidden from @everyone. The bot needs permission to post embeds and attach records.\n\nAssign the shared channel once in **`/setup general`**. Giveaways, activity giveaways and Trials use it automatically; their individual setup flows cannot change it.\n\nThe bot saves the archived staff record **before** removing its earlier private staff message. It does not erase the archived history when public listings are removed."
   ]
  ]
 ],
 "spings": [
    "Staff · Scheduled Pings",
    "Create saved schedule templates and activate them in one destination channel at a time. Management uses permanent buttons in a private Scheduled Pings dashboard.",
    [
      ["1. Setup", "Run `/setup general` to select the mandatory **Shared Staff Archives** channel, server-wide **Server Time Zone**, and optional private **Scheduled Pings Dashboard** channel. Bot Commands remains mandatory."],
      ["2. Saved Templates", "Use **Create Template** in the dashboard to create one Ping Group at a time. Add more groups as needed. Each group supports up to ten roles and its own recurrence and messages. Templates do not send anything until activated."],
      ["3. Activate & Manage", "Choose **Saved Templates** to make an independent copy. Select one destination channel, enter the start date and local clock time (using the saved server time zone), review future pings, and activate. Every X hours is elapsed time; every X days stays at the same local clock time across daylight saving. Use the dashboard to pause, edit, resume or end a schedule."],
      ["4. Archives", "The dashboard shows active schedules, upcoming pings, and delivery alerts. When a schedule ends, the shared archive preserves messages, settings, failures and staff edits. If a send is in flight or the archive is unavailable, it displays Archive Pending and retries automatically."]
    ]
  ],
 "scards": [
  "Staff · Hatchem Cards",
  "Hatchem registration, Points integration, and member help.",
  [
   [
    "Hatchem Cards",
    "**Required setup:**\n• **Hatchem Channel** — A public channel for the collectible card game.\n• **Collector Role** — A role the bot can assign to registered players.\n\nComplete `/setup general` first.\n\n**Setup command:** `/setup cards` — Run in private **Bot Commands**.\n\n**Points Integration:** Members can spend AM Isa Points on extra grabs and drops. **Points must be enabled for these purchases.** Hatchem's shop is independent of the main customization shop.\n\n**Member Help:** Type `.tutorial` or `.help` in the Hatchem channel."
   ]
  ]
 ],
 "spoints": [
  "Staff · Points & Shop",
  "Manage server Points and the profile customization storefront.",
  [
   [
    "1. Points System & Settings",
    "**AM Isa Points** are the server's virtual currency, earned through participation and activities. Members spend them on profile customization, decorative items, and extra Hatchem grabs and drops.\n\n**The Points system must be enabled for purchases to work.**\n\n**Staff Commands:**\n• `/points-admin settings` — View and manage Points rewards and settings.\n• `/points-admin activity-status` — Review activity-based earnings.\n\nRun these in private **Bot Commands**."
   ],
   [
    "2. Manage Points",
    "**Award Points:**\n• `/points-admin grant` — Award Points to one member.\n• `/points-admin grant-multiple` — Award Points to multiple members.\nInclude a reason so transactions can be reviewed.\n\n**Review Points:**\n• `/points-admin history` — Member transaction history.\n• `/points-admin audit` — Transactions across the server.\n\nRun these in private **Bot Commands**."
   ],
   [
    "3. Storefront",
    "Assign the public **Shop** channel using `/setup general`.\n\nMembers can browse:\n• Profile backgrounds and frames\n• Fonts, colors, and decorative items\n• Other profile customizations\n\nMembers can check their Points balance through shop controls.\n\n**Hatchem has its own independent shop**, which only requires the Points system to be enabled and does not depend on the main customization shop."
   ]
  ]
 ],
 "sgames": [
  "Staff · Party Games",
  "Staff-hosted games run in the assigned public Party Games channel.",
  [
   [
    "1. Setup",
    "**Required:**\n• **Party Games Channel** — A public channel for hosting game sessions and displaying results.\n\n**Setup command:** `/setup general` — Run in private **Bot Commands**.\n\n**Court of Chaos** is currently available: a Jackbox-style game where members submit creative answers and vote."
   ],
   [
    "2. Hosting a Game",
    "Run `/party host` in private **Bot Commands** to create a game lobby.\n\n• **Choose a Game** — Select Court of Chaos.\n• **Player Signup** — Members join before the game begins.\n• **Start Party** — Host starts when ready.\n• **Game Controls** — `/party status`, `/party pause`, `/party resume`.\n\nThe game runs in the assigned public **Party Games** channel."
   ]
  ]
 ]
});

export function helpStaffAccess(interaction,config){
 if(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return true;
 const roles=interaction.member?.roles;
 const assigned=roles?.cache?.values?.()||[];
 // Reuse a Giveaway Manager role already assigned in Discord. A saved role ID,
 // if present from earlier configuration, remains supported too.
 const roleId=config?.giveawayManagerRoleId;
 if(roleId&&(roles?.cache?.has?.(roleId)||
    (Array.isArray(roles)&&roles.includes(roleId))||
    (Array.isArray(roles?.value)&&roles.value.includes(roleId))))return true;
 for(const role of assigned)
   if(/^giveaway[\s-]*managers?$/i.test(String(role?.name||"").trim()))return true;
 if(Array.isArray(roles)){
   for(const role of roles){
     const resolved=interaction.guild?.roles?.cache?.get?.(role);
     if(/^giveaway[\s-]*managers?$/i.test(String(resolved?.name||"").trim()))return true;
   }
 }
 return false;
}
function buttons(items,selected,ownerId){
 const rows=[];
 for(let i=0;i<items.length;i+=5)
  rows.push(new ActionRowBuilder().addComponents(items.slice(i,i+5).map(item=>
   new ButtonBuilder().setCustomId("help:topic:"+item.id+":"+ownerId)
    .setLabel(item.label).setStyle(item.id===selected?ButtonStyle.Primary:ButtonStyle.Secondary)
    .setDisabled(item.id===selected))));
 return rows;
}
const SELECT_GROUPS=Object.freeze({
 public:PUBLIC_TOPICS,
 server:STAFF_GROUPS[0].topics,
 giveaways:STAFF_GROUPS[1].topics,
 tools:STAFF_GROUPS[2].topics,
});
function topicDropdown(scope,ownerId,selected){
 const titles={public:"Choose a Public Help topic",server:"Server Setup",
  giveaways:"Giveaways",tools:"Other Staff Tools"};
 return new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId("help:select:"+scope+":"+ownerId)
   .setPlaceholder(titles[scope])
   .addOptions(SELECT_GROUPS[scope].map(item=>({
    label:item.label,value:item.id,default:item.id===selected,
   }))));
}
function topicNav(topicId,ownerId){
 if(topicId==="root")return buttons([
   {id:"public",label:"Public Help"},
   {id:"staff",label:"Staff Help"},
   {id:"commands",label:"Command Index"},
  ],topicId,ownerId);
 if(topicId==="commands")return buttons([{id:"root",label:"Help Home"}],topicId,ownerId);
 if(topicId==="public"||PUBLIC_IDS.has(topicId))return [
  topicDropdown("public",ownerId,topicId),
  ...buttons([{id:"public",label:"Public Help"},{id:"root",label:"Help Home"}],topicId,ownerId),
 ];
 return [
  topicDropdown("server",ownerId,topicId),
  topicDropdown("giveaways",ownerId,topicId),
  topicDropdown("tools",ownerId,topicId),
  ...buttons([{id:"staff",label:"Staff Help"},{id:"root",label:"Help Home"}],topicId,ownerId),
 ];
}
function formatCommand(command){
 const lines=["• /"+command.name+" — "+(command.description||"Bot command")];
 for(const option of command.options||[]){
  if(option.type===ApplicationCommandOptionType.Subcommand)
   lines.push("  /"+command.name+" "+option.name+" — "+(option.description||"Subcommand"));
  else if(option.type===ApplicationCommandOptionType.SubcommandGroup)
   for(const sub of option.options||[])
    if(sub.type===ApplicationCommandOptionType.Subcommand)
     lines.push("  /"+command.name+" "+option.name+" "+sub.name+" — "+(sub.description||"Subcommand"));
 }
 return lines;
}
async function currentServerCommands(i){
 try{
  const [global,guild]=await Promise.all([
   i.client.application.commands.fetch(),i.guild.commands.fetch()]);
  const commands=new Map();
  for(const cmd of global.values())commands.set(cmd.name,cmd);
  for(const cmd of guild.values())commands.set(cmd.name,cmd);
  return [...commands.values()].sort((a,b)=>a.name.localeCompare(b.name)).flatMap(formatCommand);
 }catch(error){
  console.warn("Could not fetch registered commands for /help:",error);
  return ["I couldn't load the registered command list. Please try this topic again."];
 }
}
const COMMAND_LINES_PER_PAGE=16;
export function helpTopicPayload(topicId,ownerId,commandLines=[],commandPage=0,serverConfig=null){
 if(!VALID.has(topicId)||!/^\d{17,20}$/.test(String(ownerId||"")))
  throw new UserFacingError("That help menu is no longer available. Run /help again.");
 const [title,description,fields]=CONTENT[topicId];
 const embed=new EmbedBuilder().setColor(STAFF_IDS.has(topicId)?0x2ecc71:0x5865f2)
  .setTitle(title).setDescription(description);
 for(const [name,value] of fields){
  embed.addFields({name,value});
  if(topicId==="giveaways"&&name==="2. Activity Giveaways"){
   const instructions="Use **Opt In** on the permanent participation panel below the Activity Giveaway List. The bot stores your choice privately; no Discord role is required.";
   embed.addFields({name:"How to opt in on this server",value:instructions});
  }
 }
 let nav=topicNav(topicId,ownerId);
 if(topicId==="commands"){
  const pages=Math.max(1,Math.ceil(commandLines.length/COMMAND_LINES_PER_PAGE));
  const page=Math.min(Math.max(0,Number(commandPage)||0),pages-1);
  const lines=commandLines.slice(page*COMMAND_LINES_PER_PAGE,(page+1)*COMMAND_LINES_PER_PAGE);
  embed.setFooter({text:"Page "+(page+1)+" of "+pages+" · Commands shown for reference"});
  let section="",index=1;
  for(const line of lines){
   const safe=String(line).slice(0,240);
   if(section&&section.length+safe.length+1>920){
    embed.addFields({name:"Commands · "+index++,value:section});section="";
   }
   section+=(section?"\n":"")+safe;
  }
  if(section)embed.addFields({name:"Commands · "+index,value:section});
  if(!commandLines.length)embed.addFields({name:"Commands",value:"No command list is available right now."});
  if(pages>1){
   const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("help:page:"+(page-1)+":"+ownerId)
     .setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    new ButtonBuilder().setCustomId("help:page:"+(page+1)+":"+ownerId)
     .setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page===pages-1));
   nav=[row,...nav];
  }
 }
 return {embeds:[embed],components:nav,allowedMentions:{parse:[]}};
}
async function showTopic(i,topic,ownerId,commandPage=0){
 const lines=topic==="commands"?await currentServerCommands(i):[];
 let serverConfig=null;
 if(topic==="giveaways"){
  // Participation instructions are the same for every server; the panel is in its configured activity list.
 }
 await i.editReply(helpTopicPayload(topic,ownerId,lines,commandPage,serverConfig));
}
export async function execute(interaction){
 requireGuild(interaction);
 if(!interaction.deferred&&!interaction.replied)
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
 await showTopic(interaction,"root",interaction.user.id);
}
async function checkHelpStaffAccess(interaction,topic){
 if(!STAFF_IDS.has(topic))return;
 const config=await GuildConfig.findOne({guildId:interaction.guildId})
  .select("giveawayManagerRoleId").lean();
 if(!helpStaffAccess(interaction,config))
  throw new UserFacingError("Staff Help is available only to authorized bot staff and assigned Giveaway Managers.");
}
export async function handleHelpTopicButton(interaction){
 const parts=String(interaction.customId||"").split(":");
 const topic=parts[2],owner=parts[3];
 const isTopic=parts.length===4&&parts[0]==="help"&&parts[1]==="topic"&&VALID.has(topic);
 const isPage=parts.length===4&&parts[0]==="help"&&parts[1]==="page"&&/^\d{1,5}$/.test(topic);
 if((!isTopic&&!isPage)||owner!==interaction.user.id)
  throw new UserFacingError("That help menu belongs to another member or has expired. Run /help again.");
 requireGuild(interaction);
 if(isTopic)await checkHelpStaffAccess(interaction,topic);
 await interaction.deferUpdate();
 await showTopic(interaction,isPage?"commands":topic,interaction.user.id,isPage?Number(topic):0);
 return true;
}
export async function handleHelpTopicSelect(interaction){
 const parts=String(interaction.customId||"").split(":");
 const scope=parts[2],owner=parts[3],topic=interaction.values?.[0];
 if(parts.length!==4||parts[0]!=="help"||parts[1]!=="select"||
    !Object.hasOwn(SELECT_GROUPS,scope)||owner!==interaction.user.id||
    !SELECT_GROUPS[scope].some(item=>item.id===topic))
  throw new UserFacingError("That help menu belongs to another member or has expired. Run /help again.");
 requireGuild(interaction);
 await checkHelpStaffAccess(interaction,topic);
 await interaction.deferUpdate();
 await showTopic(interaction,topic,interaction.user.id);
 return true;
}
