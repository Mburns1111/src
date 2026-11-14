import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,PermissionFlagsBits,UserSelectMenuBuilder} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "./giveaway-manager-permissions.js";
import {configuredGiveawayBanRole,memberPassesGiveawayBan} from "./giveaway-exclusion.js";

import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";
import {qualifyingActivityPipeline,qualifyingWatchRulePipeline} from "./giveaway-activity-counter.js";
import {activityRoster} from "./guided-activity.js";

const marker=id=>"Activity staff progress · "+id;
const dayKey=date=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const button=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const time=date=>date?"<t:"+Math.floor(+new Date(date)/1000)+":f>":"Not recorded";

export async function activityProgressRows(record,guild=null,{historical=false}={}){
 // The active staff panel shows only currently opted-in members; finalized
 // archival snapshots preserve what was recorded during the giveaway.
 if(!historical&&!guild?.members?.fetch)
   throw Error("Discord membership verification is required for live activity progress.");

 if(record.guidedSeries){
   const rows=await activityRoster(record,null,historical?null:guild,{historical});
   return rows.filter(r=>r.messages>0).map(r=>({userId:String(r._id),messages:r.messages,days:r.days,qualified:r.qualified}));
 }
 const periodStart=record.activityStartAt||record.customActivityStartAt;
 const end=record.activityEndAt||record.customActivityEndAt;
 if(!periodStart||!end)return [];
 const start=new Date(periodStart);
 if(start>=new Date(end))return [];
 const minimum=Math.max(1,record.activityMinimum||1);
 const target=Math.max(1,record.activityMinTotalMessages||minimum);
 const days=Math.max(1,record.activityDays||1);
 const rule=record.activityRuleId?await GiveawayWatchRule.findById(record.activityRuleId).lean():null;
 const special=Boolean(record.activityRequiredMentionUserId||record.activityRequiredPhrase);
 if(special&&!rule)throw Error("Watched phrase/mention rule is unavailable for staff progress.");
 const pipeline=special?qualifyingWatchRulePipeline({
   guildId:record.guildId,rule,startAt:start,endAt:end,minimum,days,minimumTotalMessages:target,
   consent:!historical,
 }):qualifyingActivityPipeline({
   guildId:record.guildId,type:record.activityChannelIds?.length?"channels":"general",
   channelIds:record.activityChannelIds||[],minimum,days,
   minimumChars:record.activityMinChars||0,minimumTotalMessages:target,
   startAt:start,endAt:end,consent:!historical,
 });
 pipeline.pop(); // Keep partial progress: do not filter out members still working.
 const Model=special?GiveawayActivityRuleMinuteCount:GiveawayActivityMinuteCount;
 const rows=await Model.aggregate(pipeline);
 const bannedRoleId=historical?"":await configuredGiveawayBanRole(record.guildId);
 const verified=historical?rows.map(()=>true):await Promise.all(rows.map(async row=>{
   const member=await guild.members.fetch({user:row._id,force:true}).catch(()=>null);
   return Boolean(member&&!member.user?.bot&&memberPassesGiveawayBan(member,bannedRoleId));
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
 const due=force||!current||(record.status==="open"&&now-current>=60_000)||
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
 if(!await canManageGiveaways(interaction))
   return interaction.reply({content:giveawayManagerPermissionMessage,...ephemeral});
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

// Staff buttons use the same roster and filters as the working member preview.
export async function handleStaffProgressAction(interaction){
 const match=/^activitystaff:(qualified|progress|find|refresh):([a-f0-9]{24})(?::(\d{1,4}))?$/.exec(interaction.customId);
 const ephemeral={flags:MessageFlags.Ephemeral};
 if(!match)return interaction.reply({content:"Unknown activity progress action.",...ephemeral});
 if(!await canManageGiveaways(interaction))
   return interaction.reply({content:giveawayManagerPermissionMessage,...ephemeral});
 const [,action,id,pageText]=match;
 if(action==="refresh")return handleStaffProgressRefresh(interaction);
 await interaction.deferReply(ephemeral);
 try{
   const record=await Giveaway.findOne({_id:id,guildId:interaction.guildId,
     staffCardChannelId:interaction.channelId,mode:"activity"}).lean();
   if(!record)return interaction.editReply("This activity staff record is unavailable.");
   const fromPanel=record.staffProgressMessageId===interaction.message?.id;
   const fromPrivatePage=interaction.message?.flags?.has?.(MessageFlags.Ephemeral)===true&&
     interaction.message?.author?.id===interaction.client.user?.id;
   if(!fromPanel&&!fromPrivatePage)
     return interaction.editReply("Use the current Member Activity & Qualification panel.");
   const rows=await activityProgressRows(record,interaction.guild);
   if(action==="find"){
     const userId=interaction.values?.[0];
     const found=rows.find(row=>row.userId===userId);
     if(!found)return interaction.editReply("That member has no recorded activity in this giveaway.");
     const target=Math.max(1,record.activityMinTotalMessages||record.activityMinimum||1);
     return interaction.editReply({content:"**Member progress** · <@"+userId+">\n"+
       (found.qualified?"Qualified":"In progress")+" · "+found.messages+"/"+target+
       " matching messages · "+found.days+" active day(s)",allowedMentions:{parse:[]}});
   }
   const filtered=rows.filter(row=>action==="qualified"?row.qualified:!row.qualified);
   const page=Math.min(Math.max(0,Number(pageText)||0),Math.max(0,Math.ceil(filtered.length/20)-1));
   const target=Math.max(1,record.activityMinTotalMessages||record.activityMinimum||1);
   const lines=filtered.slice(page*20,(page+1)*20).map((row,i)=>
     (page*20+i+1)+". <@"+row.userId+"> · "+row.messages+"/"+target+" messages · "+row.days+" day(s)");
   const controls=[];
   if(page>0)controls.push(button("activitystaff:"+action+":"+id+":"+(page-1),"Previous"));
   if((page+1)*20<filtered.length)controls.push(button("activitystaff:"+action+":"+id+":"+(page+1),"Next"));
   return interaction.editReply({content:"**"+(action==="qualified"?"Qualified Members":"In Progress")+
     " — "+String(record.title||"Activity giveaway").slice(0,100)+"**\n"+
     "Total: "+filtered.length+" · Page "+(page+1)+"/"+Math.max(1,Math.ceil(filtered.length/20))+"\n\n"+
     (lines.join("\n")||"None yet."),
     ...(controls.length?{components:[new ActionRowBuilder().addComponents(controls)]}:{components:[]}),
     allowedMentions:{parse:[]}});
 }catch(error){
   console.error("[Giveaways] Staff activity progress action failed:",error);
   return interaction.editReply("Could not load activity progress. Please try again.");
 }
}
