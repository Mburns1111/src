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
 sgiveaways:["Staff · Run a Giveaway","Host regular, activity, or Court’s Trial giveaways. Follow active events and claims in private staff controls.",[["1. Choose a Type","**Regular:** `/giveaway start` for entry-button giveaways. **Activity:** `/giveaway activity` for participation-based qualification. **Court’s Trial:** `/trial start` for fast-paced eliminations. Complete the matching guided setup first."],["2. Create and Post","Use the commands channel to choose the prize, requirements, timing, winners and available settings. Review before posting. The bot publishes the announcement to the assigned public channel."],["3. Manage Active Giveaways","Open the **Active Giveaway Directory** in private staff controls, then select the giveaway’s staff record. Available controls may include entrants, qualifying-member previews, edits, early ending, cancellation and draw review."],["4. Winners and Claims","🟦 In Progress · 🟨 Claim Pending/staff follow-up · 🟩 Claim Completed · 🟥 No Eligible Winner · ⬜ Archived/Removed. Green after a claim only means **Claim Completed**; delivery must be confirmed separately. Staff verify all claims, hand out every prize, then use **Confirm Prizes Delivered**."],["5. Archive","Only after **every winner has claimed** and staff have used **Confirm Prizes Delivered** can a completed giveaway be archived. Otherwise, use **Cancel Giveaway** with a reason. Archiving removes the public regular giveaway listing; activity winners remain announced in the Activity Winners channel; Court’s Trial Royal Verdicts remain visible."]]],
 sactivity:["Staff · Track Activity","Start with `/giveaway activity` in the commands channel. Members qualify through their server activity.",[
  ["Set the requirements","Choose the channels to watch and the total messages required across the activity period. If members must participate on multiple days, set the active-days requirement separately. You can also require a phrase or a mention of a specific member."],
  ["Review the schedule","Check the start and end times before posting. For repeating giveaways, check the upcoming periods shown in the preview."],
  ["Check progress","Members can use **Check My Progress** on the activity post. In staff controls, use **Preview qualifying members** to see who qualifies and who is still working toward the requirements. The preview leaves out members who have not posted since the activity started. Use **Refresh Progress** for an updated count."],
  ["Review the draw","The bot uses qualifying members at draw time. If manual approval is enabled, review the draw in staff controls. When nobody wins, there is no prize to claim."],
 ]],
 sarchives:["Staff · Archive Records","Completed giveaway history is stored in the required private archive channel.",[["When to archive","Completed prize giveaways require **all winner claims** and a separate **Confirm Prizes Delivered** action before archiving. If a prize cannot be delivered or claimed, staff cancel the giveaway with a reason. Giveaways with no eligible winner have no claim to submit and can be cancelled."],["Move a record","Once delivery is confirmed, choose **Archive Giveaway**. Staff records move into the required private archive and the active directory updates. Cancelled giveaway records can also be moved there."],["Preserved information","The private archive retains winner/entrant details, claims, rerolls and available review history. Regular giveaway listings are removed upon archive. Activity results are posted in the separate **Activity Winners** channel when the giveaway ends and remain visible after archive; Court’s Trial Royal Verdicts also remain public."],["Setup","Select the same **required private archive channel** in `/setup giveaways`, `/setup activity-giveaways`, or `/setup trials`."]]],
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
export function helpTopicPayload(topicId,ownerId,commandLines=[],commandPage=0){
 if(!VALID.has(topicId)||!/^\d{17,20}$/.test(String(ownerId||"")))
  throw new UserFacingError("That help menu is no longer available. Run /help again.");
 const [title,description,fields]=CONTENT[topicId];
 const embed=new EmbedBuilder().setColor(STAFF_IDS.has(topicId)?0x2ecc71:0x5865f2)
  .setTitle(title).setDescription(description);
 for(const [name,value] of fields)embed.addFields({name,value});
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
 await i.editReply(helpTopicPayload(topic,ownerId,lines,commandPage));
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
