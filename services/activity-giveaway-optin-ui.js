import {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import {setActivityParticipation} from "./activity-participation.js";

const marker="Activity Giveaway Participation · opt-in panel v1";
const queues=new Map();

export function activityOptInPanelPayload(){
 return {embeds:[new EmbedBuilder()
  .setColor(0xb47e99)
  .setTitle("🥀 Activity Giveaway Participation")
  .setDescription(
   "Want to take part in activity giveaways? **Opt In** to allow the bot to count your qualifying server messages for activity giveaways. "+
   "Only messages sent while you are opted in count. Meeting the requirements enters you automatically.\n\n"+
   "**Opt Out** whenever you like. New messages stop counting immediately, and you cannot win activity giveaways while opted out. "+
   "If you opt back in, you start a new counting window; older messages do not carry over.\n\n"+
   "No Discord role is required. Other server activity, Points, and games are unaffected.")
  .setFooter({text:marker})],
  components:[new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("activity-optin:in").setLabel("Opt In").setStyle(ButtonStyle.Success),
   new ButtonBuilder().setCustomId("activity-optin:out").setLabel("Opt Out").setStyle(ButtonStyle.Secondary),
   new ButtonBuilder().setCustomId("activity-optin:status").setLabel("My Status").setStyle(ButtonStyle.Primary))],
  allowedMentions:{parse:[]}};
}
async function ownedPanel(channel,client,config){
 const id=config?.activityParticipationPanelMessageId;
 if(id&&config.activityParticipationPanelChannelId===channel.id){
  const msg=await channel.messages.fetch(id).catch(e=>{
   if(e?.code===10008)return null;
   throw e;
  });
  if(msg?.author?.id===client.user?.id)return msg;
 }
 const recent=await channel.messages.fetch({limit:100});
 return recent?.find?.(m=>m.author?.id===client.user?.id &&
  m.embeds?.some(e=>e.footer?.text?.startsWith("Activity Giveaway Participation · opt-in panel")))||null;
}
async function ensure(client,guildId,{bump=false}={}){
 const config=await GuildConfig.findOne({guildId})
  .select("activityGiveawayListChannelId activityParticipationPanelChannelId activityParticipationPanelMessageId").lean();
 if(!config?.activityGiveawayListChannelId)return false;
 const channel=await client.channels.fetch(config.activityGiveawayListChannelId);
 if(!channel?.send||!channel?.messages?.fetch)throw Error("Activity giveaway list channel is unavailable.");
 const previous=await ownedPanel(channel,client,config);
 const payload=activityOptInPanelPayload();
 if(previous&&!bump){
  if(!previous.embeds?.some(e=>e.footer?.text===marker))await previous.edit(payload);
  if(config.activityParticipationPanelMessageId!==previous.id ||
     config.activityParticipationPanelChannelId!==channel.id)
   await GuildConfig.updateOne({guildId},{$set:{
    activityParticipationPanelChannelId:channel.id,
    activityParticipationPanelMessageId:previous.id}});
  return true;
 }
 // Publish the replacement before deleting the old one. If the process
 // crashes here, a later reconciliation can recover the newest panel.
 const posted=await channel.send(payload);
 await GuildConfig.updateOne({guildId},{$set:{
  activityParticipationPanelChannelId:channel.id,
  activityParticipationPanelMessageId:posted.id}});
 if(previous?.id!==posted.id)await previous?.delete().catch(error=>
  console.warn("[Giveaways] Old participation panel cleanup failed:",error));
 if(config.activityParticipationPanelChannelId &&
    config.activityParticipationPanelChannelId!==channel.id &&
    config.activityParticipationPanelMessageId){
  const prior=await client.channels.fetch(config.activityParticipationPanelChannelId).catch(()=>null);
  const old=await prior?.messages?.fetch(config.activityParticipationPanelMessageId).catch(()=>null);
  if(old?.author?.id===client.user?.id)await old.delete().catch(()=>{});
 }
 return true;
}
export async function ensureActivityOptInPanel(client,guildId,options={}){
 const prior=queues.get(guildId)||Promise.resolve();
 const pending=prior.catch(()=>{}).then(()=>ensure(client,guildId,options));
 queues.set(guildId,pending);
 try{return await pending;}
 finally{if(queues.get(guildId)===pending)queues.delete(guildId);}
}
export async function reconcileActivityOptInPanels(client){
 const configs=await GuildConfig.find({
  activityGiveawayListChannelId:{$type:"string",$ne:""},
 }).select("guildId").lean();
 for(const {guildId} of configs){
  try{await ensureActivityOptInPanel(client,guildId);}
  catch(error){console.error("[Giveaways] Activity participation panel failed:",guildId,error);}
 }
}
export async function handleActivityOptInButton(interaction){
 const action=/^activity-optin:(in|out|status)$/.exec(interaction.customId)?.[1];
 if(!action||!interaction.guildId)return interaction.reply({
  content:"This participation button is invalid.",flags:MessageFlags.Ephemeral});
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try{
  const config=await GuildConfig.findOne({guildId:interaction.guildId})
   .select("activityGiveawayListChannelId activityParticipationPanelChannelId activityParticipationPanelMessageId").lean();
  if(config?.activityGiveawayListChannelId!==interaction.channelId ||
     config.activityParticipationPanelMessageId!==interaction.message?.id)
   return interaction.editReply("That activity participation panel has been replaced. Use the newest panel at the bottom of the Activity Giveaway List.");
  if(action==="status"){
   const p=await ActivityGiveawayOptIn.findOne({
    guildId:interaction.guildId,userId:interaction.user.id}).lean();
   return interaction.editReply(p?.active
    ?"✅ You are **opted in** to activity giveaways. Your current counting window began <t:"+Math.floor(+new Date(p.optedInAt)/1000)+":F>. Only qualifying messages sent while opted in count."
    :"You are **not opted in** to activity giveaways. Select **Opt In** below the activity listings to begin counting future messages.");
  }
  const result=await setActivityParticipation(interaction.guildId,interaction.user.id,action==="in");
  if(action==="in")return interaction.editReply(result.changed
   ?"✅ You are now **opted in**. Qualifying messages sent from now on can count toward activity giveaways. No role was assigned."
   :"✅ You're already opted in. Your current counting window and progress are unchanged.");
  return interaction.editReply(result.changed
   ?"You have **opted out**. New activity messages will not be recorded for giveaways and you cannot win activity giveaways while opted out. You may opt in again at any time."
   :"You're already opted out. No new giveaway activity is being recorded.");
 }catch(error){
  console.error("[Giveaways] Activity opt-in update failed:",error);
  return interaction.editReply("I couldn't update your activity participation. Please try again.");
 }
}
