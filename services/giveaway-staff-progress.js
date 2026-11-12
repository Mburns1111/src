import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,PermissionFlagsBits,UserSelectMenuBuilder} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";
import {qualifyingActivityPipeline,qualifyingWatchRulePipeline} from "./giveaway-activity-counter.js";
import {activityRoster} from "./guided-activity.js";

const marker=id=>"Activity staff progress · "+id;
const dayKey=date=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const button=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const time=date=>date?"<t:"+Math.floor(+new Date(date)/1000)+":f>":"Not recorded";

export async function activityProgressRows(record,guild){
 if(!guild?.members?.fetch)throw Error("Discord membership verification is required for activity progress.");
 const config=await GuildConfig.findOne({guildId:record.guildId})
   .select("activityParticipationRoleId activityParticipationRoleConfiguredAt").lean();
 const roleId=config?.activityParticipationRoleId;
 if(!roleId)return [];
 if(record.guidedSeries){
   if(record.requiredRoleId!==roleId)return [];
   const rows=await activityRoster(record,null,guild);
   return rows.filter(r=>r.messages>0).map(r=>({userId:String(r._id),messages:r.messages,days:r.days,qualified:r.qualified}));
 }
 const periodStart=record.activityStartAt||record.customActivityStartAt;
 const end=record.activityEndAt||record.customActivityEndAt;
 if(!periodStart||!end||!config.activityParticipationRoleConfiguredAt)return [];
 const start=new Date(Math.max(+new Date(periodStart),
   Math.ceil(+new Date(config.activityParticipationRoleConfiguredAt)/60000)*60000));
 if(start>=new Date(end))return [];
 const minimum=Math.max(1,record.activityMinimum||1);
 const target=Math.max(1,record.activityMinTotalMessages||minimum);
 const days=Math.max(1,record.activityDays||1);
 const rule=record.activityRuleId?await GiveawayWatchRule.findById(record.activityRuleId).lean():null;
 const special=Boolean(record.activityRequiredMentionUserId||record.activityRequiredPhrase);
 if(special&&!rule)throw Error("Watched phrase/mention rule is unavailable for staff progress.");
 const pipeline=special?qualifyingWatchRulePipeline({
   guildId:record.guildId,rule,startAt:start,endAt:end,minimum,days,minimumTotalMessages:target,
 }):qualifyingActivityPipeline({
   guildId:record.guildId,type:record.activityChannelIds?.length?"channels":"general",
   channelIds:record.activityChannelIds||[],minimum,days,
   minimumChars:record.activityMinChars||0,minimumTotalMessages:target,
   startAt:start,endAt:end,
 });
 pipeline.pop(); // Keep partial progress: do not filter out members still working.
 const Model=special?GiveawayActivityRuleMinuteCount:GiveawayActivityMinuteCount;
 const rows=await Model.aggregate(pipeline);
 const verified=await Promise.all(rows.map(async row=>{
   const member=await guild.members.fetch({user:row._id,force:true}).catch(()=>null);
   return Boolean(member?.roles?.cache?.has(roleId));
 }));
 return rows.filter((r,n)=>r.totalMessages>0&&verified[n]).map(r=>({
   userId:String(r._id),messages:r.totalMessages,days:r.activeDays,
   qualified:r.totalMessages>=target&&r.activeDays>=days,
 })).sort((a,b)=>Number(b.qualified)-Number(a.qualified)||b.messages-a.messages||a.userId.localeCompare(b.userId));
}
export function progressPanelPayload(record,rows,at=new Date()){
 const eligible=rows.filter(r=>r.qualified),pending=rows.filter(r=>!r.qualified);
 const target=record.activityMinTotalMessages||record.activityMinimum||1;
 const sample=(items)=>items.slice(0,3).map(r=>"<@"+r.userId+"> · "+r.messages+"/"+target).join("\n")||"None yet";
 const lines=[
   "**"+String(record.title||"Giveaway").slice(0,120)+"**",
   "**Activity period:** "+time(record.activityStartAt||record.customActivityStartAt)+" – "+time(record.activityEndAt||record.customActivityEndAt),
   "**Active:** "+rows.length+" · **Qualified:** "+eligible.length+" · **In progress:** "+pending.length,
   "",
   "**✓ Qualified**",sample(eligible),"","**◷ In progress**",sample(pending),
   "",
   "*Members without recorded activity are omitted.*",
   "**Last updated:** "+time(at),
 ].join("\n").slice(0,3950);
 return {embeds:[new EmbedBuilder().setTitle("✦ Member Activity & Qualification")
   .setColor(0x896b88).setDescription(lines).setFooter({text:marker(record._id)})],
   components:[new ActionRowBuilder().addComponents(
      button("activitystaff:qualified:"+record._id+":0","Qualified Members"),
      button("activitystaff:progress:"+record._id+":0","In Progress"),
      button("activitystaff:refresh:"+record._id,"Refresh Progress",ButtonStyle.Primary)),
     new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
       .setCustomId("activitystaff:find:"+record._id)
       .setPlaceholder("Find a member · View individual progress").setMinValues(1).setMaxValues(1))],
   allowedMentions:{parse:[]}};
}
export async function ensureStaffProgressPanel(client,record,channel,{force=false,now=new Date()}={}){
 if(record.mode!=="activity"||record.status==="cancelled")return false;
 const current=record.staffProgressRefreshedAt?new Date(record.staffProgressRefreshedAt):null;
 const due=force||!current||(record.status==="open"&&dayKey(current)!==dayKey(now))||
   (record.staffProgressStatus||"")!==record.status;
 if(!due && record.staffProgressMessageId)return true; // No Discord API work between scheduled refreshes.
 let message=record.staffProgressMessageId?await channel.messages.fetch(record.staffProgressMessageId).catch(e=>{
   if(e.code===10008)return null;throw e;
 }):null;
 if(!message){
   const recent=await channel.messages.fetch({limit:100});
   message=recent.find(m=>m.author?.id===client.user?.id&&m.embeds?.some(e=>e.footer?.text===marker(record._id)))||null;
 }
 if(message&&message.author?.id!==client.user?.id)throw Error("Progress message does not belong to this bot.");
 if(!due&&message)return true;
 const guild=channel.guild || await client.guilds?.fetch?.(record.guildId);
 const rows=await activityProgressRows(record,guild);
 const payload=progressPanelPayload(record,rows,now);
 if(message)await message.edit(payload);
 else message=await channel.send(payload);
 await Giveaway.updateOne({_id:record._id,guildId:record.guildId},{$set:{
   staffProgressMessageId:message.id,staffProgressRefreshedAt:now,staffProgressStatus:record.status,
 }});
 return true;
}
export async function handleStaffProgressRefresh(interaction){
 const ephemeral={flags:MessageFlags.Ephemeral};
 if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
   return interaction.reply({content:"Manage Server permission required.",...ephemeral});
 const id=/^activitystaff:refresh:([a-f0-9]{24})$/.exec(interaction.customId)?.[1];
 if(!id)return interaction.reply({content:"Invalid refresh control.",...ephemeral});
 await interaction.deferReply(ephemeral);
 const record=await Giveaway.findOne({_id:id,guildId:interaction.guildId,staffCardChannelId:interaction.channelId}).lean();
 if(!record||record.staffProgressMessageId!==interaction.message.id)
   return interaction.editReply("This is not the current giveaway progress panel.");
 try{
   await ensureStaffProgressPanel(interaction.client,record,interaction.channel,{force:true});
   return interaction.editReply("Shared giveaway progress refreshed.");
 }catch(error){
   console.error("[Giveaways] Staff progress refresh failed:",error);
   return interaction.editReply("Could not refresh progress. Please try again.");
 }
}
