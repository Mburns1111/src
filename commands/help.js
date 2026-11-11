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
export const STAFF_TOPICS=Object.freeze([
 {id:"sgiveaways",label:"Giveaway Management"},
 {id:"sactivity",label:"Activity Tracking"},
 {id:"sarchives",label:"Giveaway Archives"},
 {id:"scards",label:"Card Management"},
 {id:"spoints",label:"Points & Shop"},
 {id:"sgames",label:"Games"},
 {id:"ssetup",label:"Bot Setup"},
]);
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
 staff:["✦ Staff Help","Guides for authorized server staff. Viewing these pages does not grant command or moderation privileges.",[]],
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
 sgiveaways:["Staff · Giveaway Management","Create and manage giveaways through the configured command channel and staff records.",[
  ["Before system setup","First configure the general bot and commands channel with **/setup channels**."],
  ["Set up","Then use **/setup giveaways** or **/setup activity-giveaways** for guided giveaway settings."],
  ["Channels — public","**Regular giveaway posts** (manual entry); **Activity giveaway list** (activity posters and progress); **Activity winners** (results and claims); **Court's Trial** (trial signup and results, if used). Keep separate public channels for each enabled type."],
  ["Channels — staff","**Commands channel** (run setup and staff commands); **Private staff controls** (progress, approvals, giveaway records); **Private Archives** (completed records, optional but recommended). Staff controls and Archives must be hidden from @everyone and use separate channels."],
  ["Bot permissions","In public giveaway, activity list, winners and staff channels: **View Channel**, **Send Messages**, **Embed Links**. For the separate Archives channel, also grant **Attach Files** and **Read Message History**. Allow these last two in staff/public giveaway channels too for normal message updates and history lookup."],
  ["Staff access","**/setup giveaways** and **/setup activity-giveaways** currently require Manage Server permission. Giveaway Manager access to Staff Help does not override permission checks on actual staff commands."],
  ["Staff records","Review the active directory and each giveaway's separate staff record. Colors: blue active, yellow needs attention, green claimed/delivered, red closed."],
  ["Claims and delivery","Winner claims are separate from delivery. After all prizes are handed out, use **Confirm Prizes Delivered**; an optional private Discord proof link can be added."],
 ]],
 sactivity:["Staff · Activity Tracking","Qualification is counted over each activity period, not per active day unless a separate active-days requirement was configured.",[
  ["Requirements","Choose watched channels, total messages, optional active days, phrases or mentions."],
  ["Progress","Use **Preview qualifying members** and **Refresh Progress** on staff records. Manual refresh has no cooldown."],
  ["Draws","Use activity review and scheduled drawing controls; unqualified members are not entered automatically."],
 ]],
 sarchives:["Staff · Giveaway Archives","Archiving is always a separate moderator action, not automatic on completion.",[
  ["Eligibility","Closed, cancelled, no-winner, forfeited, or delivered giveaways can become archive-eligible."],
  ["Archive Giveaway","Click once on the eligible staff record. The bot saves the actor and completion reason without another confirmation form."],
  ["Records","The private archive keeps winner/claim history, delivery proof when supplied, activity totals, and a full JSON snapshot."],
 ]],
 scards:["Staff · Card Management","Card management controls are restricted to the permissions assigned for each command.",[
  ["Before system setup","First configure the general bot and commands channel with **/setup channels**."],
  ["Setup","Then use authorized card management commands to configure the Card role and launch content."],
  ["Operations","Review drop, card catalog, trade and upgrade controls in the staff card-game commands."],
  ["Permissions","Having access to this guide does not grant permission to manage cards."],
 ]],
 spoints:["Staff · Points & Shop","Use the existing administrator tools for audited Points and shop management.",[
  ["Points","Use authorized **/points-admin** commands to review and manage eligible awards."],
  ["Shop","Manage catalog items using your configured shop/owner controls."],
  ["Audit","Keep prize and participation changes attributable to an authorized staff member."],
 ]],
 sgames:["Staff · Games","Manage sessions through the server's game commands and configured channel.",[
  ["Before system setup","First configure the general bot and commands channel with **/setup channels**."],
  ["Party games","Then use authorized **/party** controls to configure and host a session."],
  ["Court's Trial","Use the trial administration commands and keep results in their assigned channel."],
 ]],
 ssetup:["Staff · Bot Setup","Setup requires its own Discord command permissions.",[
  ["Start here","Run **/setup channels** first to configure the general bot and choose the commands channel. After that, configure individual systems."],
  ["Giveaway managers","Use your existing giveaway manager assignment from giveaway setup. There is no separate Help-only role to configure."],
  ["Security","Staff Help is read-only. Editing the server or running commands still requires the permissions enforced by those actions."],
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
 else if(topicId==="staff")nav=[...STAFF_TOPICS,{id:"root",label:"Home"}];
 else nav=[{id:PUBLIC_IDS.has(topicId)?"public":"staff",label:"Back to Systems"},{id:"root",label:"Help Home"}];
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
