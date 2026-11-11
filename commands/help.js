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
  {"id":"ssetup","label":"Set Up Channels"}
 ] },
 { label: "Giveaways", topics: [
  {"id":"sgiveaways","label":"Run a Giveaway"},
  {"id":"sactivity","label":"Track Activity"},
  {"id":"sarchives","label":"Archive Records"}
 ] },
 { label: "Other staff tools", topics: [
  {"id":"scards","label":"Hatchem Cards"},
  {"id":"spoints","label":"Points & Shop"},
  {"id":"sgames","label":"Party Games & Trials"}
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
 staff:["✦ Staff Help","Choose a task below. Each command uses its own permission checks.",
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
 ssetup:["Staff · Set Up Channels","Start here when adding the bot or enabling a new feature. General setup requires Manage Server.",[
  ["1. Create the channels in Discord","Start with a member-accessible commands channel. Create the destinations for the features you use. For profiles and trading, these are profiles, inventory showcase, house listings, outfit listings, trade voting and Trading Post. Shop, Hatchem and party games each have their own channel."],
  ["2. Prepare giveaway channels","Public destinations are regular giveaways, the activity list, activity winners and Court’s Trial. For staff, create a private giveaway controls channel. If you use archives, give them a separate private channel. Hide both staff channels from @everyone and allow the bot access."],
  ["3. Give the bot access","Allow View Channel, Send Messages and Embed Links in assigned channels. Allow Read Message History and Attach Files where the bot updates posts or shares media, including the archive."],
  ["4. Assign channels to the bot","Run `/setup channels` and set `commands` first. You can run setup again to assign other destinations. For giveaway defaults and the Giveaway Manager role, continue with **Run a Giveaway**."],
 ]],
 sgiveaways:["Staff · Run a Giveaway","Use the commands channel to set defaults and create a giveaway. Follow it afterward in the private staff controls channel.",[
  ["Configure defaults","With Manage Server, use `/setup giveaways` for regular giveaways or `/setup activity-giveaways` for activity giveaways. Review channels, claim instructions and defaults before saving."],
  ["Create the giveaway","For a regular giveaway, use `/giveaway start` and enter the prize and entry details. For an activity giveaway, use `/giveaway activity` and follow the prompts. Open **Track Activity** for qualification and draw details."],
  ["Find a giveaway in progress","Open the active directory in staff controls and select the giveaway’s record. Blue means active, yellow needs attention, green means claimed or delivered, and red means closed. Read the record for its exact status."],
  ["Confirm delivery","After winners claim and all prizes have been handed out, select **Confirm Prizes Delivered** on the staff record. You can add a private Discord proof link. See **Archive Records** to file the finished giveaway."],
 ]],
 sactivity:["Staff · Track Activity","Start with `/giveaway activity` in the commands channel. Members qualify through their server activity.",[
  ["Set the requirements","Choose the channels to watch and the total messages required across the activity period. If members must participate on multiple days, set the active-days requirement separately. You can also require a phrase or a mention of a specific member."],
  ["Review the schedule","Check the start and end times before posting. For repeating giveaways, check the upcoming periods shown in the preview."],
  ["Check progress","Members can use **Check My Progress** on the activity post. In staff controls, use **Preview qualifying members** to see who qualifies and who is still working toward the requirements. The preview leaves out members who have not posted since the activity started. Use **Refresh Progress** for an updated count."],
  ["Review the draw","The bot uses qualifying members at draw time. If manual approval is enabled, review the draw in staff controls. When nobody wins, there is no prize to claim."],
 ]],
 sarchives:["Staff · Archive Records","Use the private staff record when a giveaway is finished.",[
  ["Check the status","Closed, cancelled, no-winner, forfeited and delivered giveaways can become eligible. For a claimed prize, confirm delivery after handing out the prize."],
  ["Archive the giveaway","Select **Archive Giveaway** on the eligible record. One click files it in the configured private archives channel."],
  ["Look up a past giveaway","The archive records who archived it and why it finished, along with winner and claim history, any delivery proof, activity totals and a JSON snapshot."],
 ]],
 scards:["Staff · Hatchem Cards","Use the server’s Hatchem channel for registration, drops and player help.",[
  ["Assign the card role","Set the `hatchem` channel with `/setup channels`. Use `/cards-admin setup-role` to select the server’s card role."],
  ["Manage releases","Bot owners can use `/cards-owner releases` to review releases and `/cards-owner create-release` to prepare a new one."],
  ["Help a player","Direct members to `.tutorial` for the beginner walkthrough or `.help` for collection, trade and upgrade commands in the Hatchem channel."],
 ]],
 spoints:["Staff · Points & Shop","Use `/points-admin` for server rewards and the shop channel for purchases.",[
  ["Check reward settings","Use `/points-admin settings` to review the server configuration and `/points-admin activity-status` to see the repeatable Points a member has earned this period."],
  ["Award Points","Use `/points-admin grant` for one member or `/points-admin grant-multiple` for a group. Include the reason for the award."],
  ["Review an award","Use `/points-admin history` for one member or `/points-admin audit` to review transactions across the server."],
  ["Open the storefront","Assign the `shop` channel with `/setup channels`. Members can use `/shop browse` to preview purchases and `/shop balance` to check their Points."],
 ]],
 sgames:["Staff · Party Games & Trials","Use the commands channel to launch an event in its assigned game channel.",[
  ["Host a party game","Assign `party_games` with `/setup channels`. Use `/party host` to open signup and `/party status` to check the session. During play, use `/party pause` and `/party resume` as needed."],
  ["Run a Court’s Trial","Assign `survival_trials` with `/setup channels`. Use `/trial start` to set the prize and open signup. Use `/trial list` to find a trial or `/trial entrants` to review its players."],
 ]],
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
    .setLabel(item.label).setStyle(item.id===selected?ButtonStyle.Primary:ButtonStyle.Secondary)
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
