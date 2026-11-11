import {
 ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle,
 EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
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
 {id:"commands",label:"Commands"},
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
  {"id":"sgames","label":"Party Games"}
 ] }
];
export const STAFF_TOPICS = Object.freeze(STAFF_GROUPS.flatMap(group => group.topics));
export const HELP_TOPICS=Object.freeze([
 {id:"root",label:"Help Home"},{id:"public",label:"Public Help"},
 {id:"staff",label:"Staff Help"},...PUBLIC_TOPICS,...STAFF_TOPICS,
]);
const VALID=new Set(HELP_TOPICS.map(x=>x.id));
const STAFF_IDS=new Set(["staff",...STAFF_TOPICS.map(x=>x.id)]);
const PUBLIC_IDS=new Set(["public",...PUBLIC_TOPICS.map(x=>x.id)]);
const CONTENT=Object.freeze({
 root:["✦ AM Isa · Help Center","Choose **Public Help** for member guides or **Staff Help** for authorized management guides. Everything opens privately." ,[]],
 public:["✦ Public Help","Choose a system below to see how its features work. Most member actions use buttons in their assigned channels.",[]],
 staff:["✦ Staff Help","**Complete Bot Setup first.** Create and assign channels before using the bot’s other systems. Each command uses its own permission checks.",
  STAFF_GROUPS.map(group => [group.label, group.topics.map(topic => topic.label).join(" · ")])],
 home:["Getting Started","Start with the permanent buttons in each server channel.",[
  ["Profiles","Create or edit your profile from the profile-channel buttons or use **/profile**."],
  ["Inventory","Add inventory media through the inventory channel; your profile can also show inventory links."],
  ["Find help","Choose a system below to learn its buttons and commands. Help pages never change your settings."],
 ]],
 listings:["Houses, Outfits & Trading","Use the buttons in the matching listing channel.",[
  ["Create","Start a house listing, outfit listing, trade vote, or Trading Post card from its channel."],
  ["Find your posts","Use **My house listings** or **My outfit listings** to open your existing posts."],
  ["Photos and video","Use Previous, Next or Choose photo. Uploaded native video appears above the card."],
  ["Interest and updates","Mark interest with the post buttons; listing owners can update their own published items."],
 ]],
 shop:["Shop & Points","Preview before spending. Purchases use the server's Points system.",[
  ["Shop","Use the shop channel or **/shop browse**. Choose a category and item."],
  ["Appearance","Browse backgrounds, frames, panels, fonts, colors and stickers; previewing does not purchase an item."],
  ["Points","Check **/shop balance**. Earned points and enabled participation rewards depend on server configuration."],
 ]],
 cards:["Collectible Cards · Hatchem","The card game has its own channel and in-game help.",[
  ["Begin","Open the card-game channel and follow registration and tutorial controls."],
  ["Collect","Use egg drops and grabs to collect pets, then view your collection."],
  ["Manage cards","Use the card game's menus for trading, gifting, upgrading, burning and the card shop."],
  ["More Hatchem help","Type `.help` in the Hatchem channel to open the full card-game command guide. You can also type `.tutorial` there for the beginner walkthrough."],
 ]],
 giveaways:["Giveaways","Entries and qualification depend on the giveaway type.",[
  ["Activity giveaways","Meet the listed message and activity requirements during the entire activity period. No manual entry button is needed."],
  ["Regular giveaways","Follow the entry buttons and any eligibility requirements shown on the post."],
  ["Progress","Use **Check My Progress** when available to see how close you are."],
  ["Winners","If selected, follow the result post's ticket-claim instructions. Claiming is not the same as prize delivery."],
 ]],
 games:["Games & Activities","Discover the party and trial games hosted in your server.",[
  ["Party games","Join games through the party-game channel when staff opens a session."],
  ["Court's Trials","Follow the trial announcement and its entry rules. Staff coordinate prize claims."],
  ["Activity rewards","Some events may also award Points when enabled by staff."],
 ]],
 commands:["Registered Commands","Current commands are loaded from Discord. Available commands and permissions depend on your server.",[]],
 ssetup:["Staff · Bot Setup","Create the channels you need, then run guided setup to assign them. The initial setup must be completed before using the bot’s other features.",[["1. Bot Commands · PRIVATE / Required","Create a private **Bot Commands** text channel for setup, administration and general bot management. Give authorized staff and the bot access, and hide it from @everyone. Use it for setup commands and normal administrative commands."],["2. Profiles, Trading, Shop & Points · PUBLIC","Create public channels as needed for **Member Profiles**, **Inventory Showcase**, **House Listings**, **Outfit Listings**, **Trading Posts**, **Trade Voting**, and **Shop**. These are one member-facing system. Points rewards and balances do not need a separate channel. Configure these with `/setup general`."],["3. Hatchem Cards · PUBLIC","Create a **Hatchem** card-game channel and a manageable **Collector** role, then configure them with `/setup cards`. Registration grants the Collector role."],["4. Party Games · PUBLIC","Create a public **Party Games** channel for sessions and results. Assign it through `/setup general`."],["5. Giveaways & Court’s Trials · PUBLIC and PRIVATE","Public: **Regular Giveaways**, **Activity Giveaway List**, **Activity Winners**, and **Court’s Trials**. Private and **required**: **Giveaway Staff Controls** and **Giveaway Archives**. Hide both private channels from @everyone. Each giveaway setup asks for the same archive channel."],["6. Bot Permissions","The bot needs View Channel, Send Messages and Embed Links in assigned channels. Allow Read Message History, Attach Files and role management where needed. Keep private staff controls and archives separate from each other and from every public giveaway channel."],["7. Setup Order","Run `/setup general` first to assign the required private commands channel. Then run only what you use: `/setup cards`, `/setup giveaways`, `/setup activity-giveaways`, `/setup trials`. Reopen these options whenever you need to change settings."]]],
 sgiveaways:["Staff · Run a Giveaway","Host regular, activity, or Court’s Trial giveaways. Follow active events and claims in private staff controls.",[["1. Choose a Type","**Regular:** `/giveaway start` for entry-button giveaways. **Activity:** `/giveaway activity` for participation-based qualification. **Court’s Trial:** `/trial start` for fast-paced eliminations. Complete the matching guided setup first."],["2. Create and Post","Use the commands channel to choose the prize, requirements, timing, winners and available settings. Review before posting. The bot publishes the announcement to the assigned public channel."],["3. Manage Active Giveaways","Open the **Active Giveaway Directory** in private staff controls, then select the giveaway’s staff record. Available controls may include entrants, qualifying-member previews, edits, early ending, cancellation and draw review."],["4. Winners and Claims","🟦 In Progress · 🟨 Claim Pending/staff follow-up · 🟩 Claim Completed · 🟥 No Eligible Winner · ⬜ Archived/Removed. Green means claim completion, **not prize delivery**. Review private ticket claims and eligible rerolls; staff hand out prizes separately."],["5. Archive","Once winner claims and rerolls are resolved, choose **Archive Giveaway** on the staff record. Staff history moves to the required private archive channel. Refer to **Archive Records** for details."]]],
 sactivity:["Staff · Track Activity","Start with `/giveaway activity` in the commands channel. Members qualify through their server activity.",[
  ["Set the requirements","Choose the channels to watch and the total messages required across the activity period. If members must participate on multiple days, set the active-days requirement separately. You can also require a phrase or a mention of a specific member."],
  ["Review the schedule","Check the start and end times before posting. For repeating giveaways, check the upcoming periods shown in the preview."],
  ["Check progress","Members can use **Check My Progress** on the activity post. In staff controls, use **Preview qualifying members** to see who qualifies and who is still working toward the requirements. The preview leaves out members who have not posted since the activity started. Use **Refresh Progress** for an updated count."],
  ["Review the draw","The bot uses qualifying members at draw time. If manual approval is enabled, review the draw in staff controls. When nobody wins, there is no prize to claim."],
 ]],
 sarchives:["Staff · Archive Records","Completed giveaway history is stored in the required private archive channel.",[["When to archive","Archive once all winner claims and rerolls are settled. Cancelled events and giveaways with no eligible winners are also preserved."],["Move a record","Choose **Archive Giveaway** on the current staff record. The private staff history moves to the separately assigned archive channel, and the active giveaway directory updates."],["Preserved information","The private archive retains winner/entrant details, claims, rerolls and available review history. Completed activity winner announcements and Court’s Trial verdicts remain visible where applicable."],["Setup","Select the same **required private archive channel** in `/setup giveaways`, `/setup activity-giveaways`, or `/setup trials`."]]],
 scards:["Staff · Hatchem Cards","Manage Hatchem registration, releases and member help.",[["Setup","Use `/setup cards` to select the Hatchem channel, Collector registration role and wild-egg setting. Complete `/setup general` first."],["Releases","Bot owners can use `/cards-owner releases` and `/cards-owner create-release` to manage card releases."],["Member help","Players can type `.tutorial` or `.help` in the Hatchem channel."]]],
 spoints:["Staff · Points & Shop","Manage Points rewards and the storefront.",[["Settings","Use `/points-admin settings` to review rewards and `/points-admin activity-status` to review activity earnings."],["Award Points","Use `/points-admin grant` or `/points-admin grant-multiple` and include the reason."],["Review Points","Use `/points-admin history` for a member or `/points-admin audit` for transactions."],["Storefront","Assign the public shop channel with `/setup general`. Members browse appearance items and check Points through the shop controls."]]],
 sgames:["Staff · Party Games","Use the commands channel to host sessions in the assigned party-game channel.",[["Setup","Assign **Party Games** using `/setup general`."],["Hosting","Use `/party host` to open a session and `/party status` to monitor it. During a game use `/party pause` or `/party resume`."],["Court’s Trials","Court’s Trials are fast-paced giveaways. See **Run a Giveaway** and `/setup trials`, rather than Party Games."]]],

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
 for(let i=0;i<items.length;i+=5){
  rows.push(new ActionRowBuilder().addComponents(items.slice(i,i+5).map(item=>
   new ButtonBuilder().setCustomId("help:topic:"+item.id+":"+ownerId)
    .setLabel(item.label).setStyle(item.id==="ssetup"||item.id===selected?ButtonStyle.Primary:ButtonStyle.Secondary)
    .setDisabled(item.id===selected))));
 }
 return rows;
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
export function helpTopicPayload(topicId,ownerId,commandLines=[]){
 if(!VALID.has(topicId)||!/^\d{17,20}$/.test(String(ownerId||"")))
  throw new UserFacingError("That help menu is no longer available. Run /help again.");
 const [title,description,fields]=CONTENT[topicId];
 const embed=new EmbedBuilder().setColor(STAFF_IDS.has(topicId)?0x2ecc71:0x5865f2)
  .setTitle(title).setDescription(description);
 for(const [name,value] of fields)embed.addFields({name,value});
 if(topicId==="commands"){
  let section="",index=1;
  for(const line of commandLines.slice(0,65)){
   if((section+"\n"+line).length>850){
    embed.addFields({name:"Commands · "+index++,value:section});section="";
   }
   section+=(section?"\n":"")+line.slice(0,830);
   if(index>17)break;
  }
  if(section)embed.addFields({name:"Commands · "+index,value:section});
  if(!commandLines.length)embed.addFields({name:"Commands",value:"No command list is available right now."});
 }
 let nav=[];
 if(topicId==="root")nav=[{id:"public",label:"Public Help"},{id:"staff",label:"Staff Help"}];
 else if(topicId==="public")nav=[...PUBLIC_TOPICS,{id:"root",label:"Home"}];
 else if(topicId==="staff"){
  const rows=STAFF_GROUPS.flatMap(group=>buttons(group.topics,topicId,ownerId));
  rows.push(...buttons([{id:"root",label:"Help Home"}],topicId,ownerId));
  return {embeds:[embed],components:rows,allowedMentions:{parse:[]}};
 }
 else nav=[{id:PUBLIC_IDS.has(topicId)?"public":"staff",label:PUBLIC_IDS.has(topicId)?"Back to Systems":"Back to Staff Help"},{id:"root",label:"Help Home"}];
 return {embeds:[embed],components:buttons(nav,topicId,ownerId),allowedMentions:{parse:[]}};
}
async function showTopic(i,topic,ownerId){
 const lines=topic==="commands"?await currentServerCommands(i):[];
 await i.editReply(helpTopicPayload(topic,ownerId,lines));
}
export async function execute(interaction){
 requireGuild(interaction);
 if(!interaction.deferred&&!interaction.replied)await interaction.deferReply({flags:MessageFlags.Ephemeral});
 await showTopic(interaction,"root",interaction.user.id);
}
export async function handleHelpTopicButton(interaction){
 const parts=String(interaction.customId||"").split(":");
 if(parts.length!==4||parts[0]!=="help"||parts[1]!=="topic"||
    !VALID.has(parts[2])||parts[3]!==interaction.user.id)
  throw new UserFacingError("That help menu belongs to another member or has expired. Run /help again.");
 requireGuild(interaction);
 if(STAFF_IDS.has(parts[2])){
  const config=await GuildConfig.findOne({guildId:interaction.guildId})
   .select("giveawayManagerRoleId").lean();
  if(!helpStaffAccess(interaction,config))
   throw new UserFacingError("Staff Help is available only to authorized bot staff and assigned Giveaway Managers.");
 }
 await interaction.deferUpdate();
 await showTopic(interaction,parts[2],interaction.user.id);
 return true;
}
