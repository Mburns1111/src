import mongoose from "mongoose";
import {gzipSync} from "node:zlib";
import {ActionRowBuilder,AttachmentBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import PingTemplate from "../models/PingTemplate.js";
import PingSchedule from "../models/PingSchedule.js";
import PingDelivery from "../models/PingDelivery.js";
import PingAudit from "../models/PingAudit.js";
import {addServerCalendarDays,formatServerClock,validateServerTimeZone} from "./schedule-timezone.js";

const HOUR=60*60_000;
const DAY=24*HOUR;
const MAX_EVENTS=4000;
const nowMs=d=>new Date(d).getTime();
const ts=d=>"<t:"+Math.floor(nowMs(d)/1000)+":f>";
const short=s=>String(s||"").slice(0,150);
export const pingDashboardButtons=()=>[
 new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("pings:root:create").setLabel("Create Template").setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId("pings:root:templates").setLabel("Saved Templates").setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId("pings:root:active").setLabel("Manage Schedules").setStyle(ButtonStyle.Secondary)
 ),
 new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("pings:root:upcoming").setLabel("View Full Schedule").setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId("pings:root:archives").setLabel("View Archives").setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId("pings:root:alerts").setLabel("Delivery Alerts").setStyle(ButtonStyle.Secondary)
 )
];

// Template drafts may have no content yet. A schedule still must have text or
// role mentions before a delivery can be planned or activated.
// Templates may have no messages. Activated schedules must have a valid
// delivery mode, and per-ping text may not be missing from any occurrence.
export function normalizePingGroup(g,{allowEmpty=false}={}){
 const roles=[...new Set((g.roleIds||[]).map(String).filter(Boolean))];
 const messages=(g.messages||[]).map(x=>String(x).trim()).filter(Boolean);
 const perPingMessages=(g.perPingMessages||[]).map(x=>String(x||"").trim());
 const messageMode=g.messageMode|| (messages.length?"rotate":"roles");
 if(!["single","rotate","per-ping","roles"].includes(messageMode))
   throw Error("Choose a valid Ping Group message mode.");
 const group={
  name:String(g.name||"Ping Group").trim().slice(0,60),
  repeatMode:["once","hours","days"].includes(g.repeatMode)?g.repeatMode:"hours",
  interval:Number(g.interval??12),durationDays:Number(g.durationDays??7),
  offsetHours:Number(g.offsetHours??0),roleIds:roles,messages,perPingMessages,messageMode
 };
 if(!Number.isInteger(group.interval)||group.interval<1||group.interval>720)
   throw Error("Repeat interval must be a whole number from 1 to 720.");
 if(!Number.isInteger(group.durationDays)||group.durationDays<1||group.durationDays>365)
   throw Error("Duration must be 1–365 days.");
 if(!Number.isInteger(group.offsetHours)||group.offsetHours<0||group.offsetHours>720)
   throw Error("Start delay must be 0–720 hours.");
 if(roles.length>10)throw Error("Choose no more than 10 roles per Ping Group.");
 if(messages.length>20)throw Error("A Ping Group supports up to 20 rotating messages.");
 if(perPingMessages.length>4000)throw Error("A Ping Group cannot contain more than 4,000 individual messages.");
 if([...messages,...perPingMessages].some(x=>x.length+roles.length*24>1900))
   throw Error("Message text and role mentions together must fit in 1,900 characters.");
 if(!allowEmpty){
  if(messageMode==="roles"&&!roles.length)
   throw Error("Enter message text or select at least one role.");
  if(["single","rotate"].includes(messageMode)&&!messages.length)
   throw Error("Enter message text for this Ping Group.");
  if(messageMode==="per-ping"&&!perPingMessages.some(Boolean))
   throw Error("Enter a different message for each ping in this Ping Group.");
 }
 return group;
}
export function scheduleGroupEnd(startAt,durationDays,timeZone="UTC"){
 return addServerCalendarDays(startAt,durationDays,validateServerTimeZone(timeZone));
}
export function planPingDeliveries(groups,startAt,{timeZone="UTC",allowIncomplete=false}={}){
 const start=nowMs(startAt);
 const zone=validateServerTimeZone(timeZone);
 if(!Number.isFinite(start))throw Error("Invalid schedule start time.");
 const events=[];
 const normalized=groups.map(g=>normalizePingGroup(g,{allowEmpty:allowIncomplete}));
 if(normalized.length<1||normalized.length>10)throw Error("Choose 1–10 Ping Groups.");
 for(let groupIndex=0;groupIndex<normalized.length;groupIndex++){
  const group=normalized[groupIndex];
  const until=nowMs(scheduleGroupEnd(start,group.durationDays,zone));
  const first=start+group.offsetHours*HOUR;
  const every=group.interval*HOUR;
  const before=events.length;
  for(let ordinal=0;;ordinal++){
   const time=group.repeatMode==="days"
    ?nowMs(addServerCalendarDays(first,ordinal*group.interval,zone))
    :first+ordinal*every;
   if(time>=until)break;
   if(events.length>=MAX_EVENTS)throw Error("Too many scheduled pings. Reduce the duration or frequency (maximum "+MAX_EVENTS+").");
   const content=group.messageMode==="per-ping"
    ?group.perPingMessages[ordinal]||""
    :group.messageMode==="roles"?""
    :group.messages.length?group.messages[(group.messageMode==="single"?0:ordinal%group.messages.length)]:"";
   if(!allowIncomplete&&group.messageMode==="per-ping"&&!content)
    throw Error("Ping Group "+(groupIndex+1)+" needs text for individual ping #"+(ordinal+1)+".");
   if(!allowIncomplete&&!content&&!group.roleIds.length)
    throw Error("Ping Group "+(groupIndex+1)+" has an empty ping #"+(ordinal+1)+".");
   events.push({groupIndex,ordinal,dueAt:new Date(time),roleIds:group.roleIds,content});
   if(group.repeatMode==="once")break;
  }
  if(events.length===before)throw Error("Ping Group "+(groupIndex+1)+" ("+group.name+") has no messages within its duration. Reduce its start delay or increase its duration.");
 }
 events.sort((a,b)=>nowMs(a.dueAt)-nowMs(b.dueAt)||a.groupIndex-b.groupIndex);
 return events.map((event,i)=>({...event,sequence:i+1}));
}
export async function validatePingDestination(guild,id,roleIds=[]){
 const channel=await guild.channels.fetch(id).catch(()=>null);
 if(!channel?.isTextBased?.()||!channel.send)throw Error("Choose a text channel where the bot can post.");
 const bot=await guild.members.fetchMe();
 const permissions=channel.permissionsFor(bot);
 for(const permission of [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages])
  if(!permissions?.has(permission))throw Error("The bot cannot view or send messages in the selected destination.");
 for(const roleId of [...new Set(roleIds)]){
  const role=await guild.roles.fetch(roleId).catch(()=>null);
  if(!role||role.id===guild.id)throw Error("A selected ping role no longer exists. Update the template.");
  if(!role.mentionable&&!permissions?.has(PermissionFlagsBits.MentionEveryone))
   throw Error("The bot cannot mention role "+role.name+". Make it mentionable or grant the bot permission to mention roles.");
 }
 return channel;
}
export async function logPingChange(scheduleId,guildId,actorId,event,details={}){
 return PingAudit.create({scheduleId,guildId,actorId,event,details});
}
export async function activatePingSchedule({guild,template,channelId,startAt,actorId,overrides={},timeZone="UTC",scheduleId=new mongoose.Types.ObjectId()}){
 const identity={_id:scheduleId,guildId:guild.id,activatedBy:actorId};
 const existing=await PingSchedule.findOne(identity);
 if(existing)return existing;
 const groups=(overrides.groups||template.groups).map(g=>({...g.toObject?.()||g}));
 const zone=validateServerTimeZone(timeZone);
 const events=planPingDeliveries(groups,startAt,{timeZone:zone});
 const overridesBySequence=new Map((overrides.events||[]).map(x=>[Number(x.sequence),x]));
 for(const event of events){
  const override=overridesBySequence.get(event.sequence);
  if(!override)continue;
  if(override.content!==undefined)event.content=String(override.content).trim();
  if(override.roleIds!==undefined)event.roleIds=[...new Set(override.roleIds.map(String))];
  if(override.dueAt!==undefined)event.dueAt=new Date(override.dueAt);
  if(event.roleIds.length>10||event.content.length+event.roleIds.length*24>1900||(!event.content&&!event.roleIds.length))
   throw Error("An edited ping is invalid. Keep text and role mentions within Discord limits.");
  if(!Number.isFinite(nowMs(event.dueAt)))throw Error("Invalid individual ping time.");
 }
 if(!events.length)throw Error("The schedule does not contain any future pings.");
 await validatePingDestination(guild,channelId,[...new Set(events.flatMap(e=>e.roleIds||[]))]);
 const start=new Date(startAt);
 if(start.getTime()<Date.now()-60_000)throw Error("The start time must be in the future.");
 const end=new Date(Math.max(...groups.map(g=>nowMs(scheduleGroupEnd(start,g.durationDays,zone)))));
 const session=await mongoose.startSession();
 let schedule;
 try {
  await session.withTransaction(async()=>{
   const [record]=await PingSchedule.create([{
    _id:scheduleId,guildId:guild.id,templateId:template._id,templateName:template.name,
    name:overrides.name||template.name,destinationChannelId:channelId,timeZone:zone,
    createdBy:template.createdBy,activatedBy:actorId,status:"active",
    groups,startsAt:start,endsAt:end,plannedCount:events.length,
   }],{session});
   schedule=record;
   await PingDelivery.insertMany(events.map(e=>({
    guildId:guild.id,scheduleId:record._id,...e,
   })),{session,ordered:true});
   await PingAudit.create([{guildId:guild.id,scheduleId:record._id,actorId,
    event:"activated",details:{templateId:String(template._id),channelId,startAt:start,timeZone:zone,groups,plannedCount:events.length}}],{session});
  });
 }catch(error){
  if(error.code!==11000)throw error;
  schedule=await PingSchedule.findOne(identity);
  if(!schedule)throw error;
 }finally{await session.endSession();}
 return schedule;
}

// In the pinned staff dashboard, show one line per upcoming ping:
// destination channel, roles, abbreviated text, then the scheduled date/time.
// Preserve the incoming chronological order; do not group into channel headings.
export function dashboardUpcomingLines(deliveries,schedules,defaultZone="UTC"){
 return deliveries.map(delivery=>{
  const schedule=schedules.get(String(delivery.scheduleId));
  const channel=schedule?.destinationChannelId?"<#"+schedule.destinationChannelId+">":"(channel unavailable)";
  const roles=delivery.roleIds?.length
   ?delivery.roleIds.map(id=>"<@&"+id+">").join(" "):"No roles";
  const message=String(delivery.content||"").replace(/\\s+/g," ").trim();
  const preview=message.length>65?message.slice(0,64)+"…":message||"(role-only)";
  return "• "+channel+" "+roles+" · "+preview+" — "+
   formatServerClock(delivery.dueAt,schedule?.timeZone||defaultZone);
 });
}
async function dashboardPayload(guildId){
 const active=await PingSchedule.find({guildId,status:{$in:["active","paused"]}}).sort({startsAt:1}).limit(6).lean();
 const everyActive=await PingSchedule.find({guildId,status:"active"}).select("_id name timeZone destinationChannelId").lean();
 const config=await GuildConfig.findOne({guildId}).select("serverTimeZone").lean();
 const configuredZone=config?.serverTimeZone||"UTC";
 const totals=await PingSchedule.aggregate([
  {$match:{guildId,status:{$in:["active","paused"]}}},
  {$group:{_id:"$status",count:{$sum:1},sent:{$sum:"$sentCount"}}},
 ]);
 const counts=Object.fromEntries(totals.map(x=>[x._id,x]));
 const due=await PingDelivery.find({guildId,status:"pending",
  scheduleId:{$in:everyActive.map(x=>x._id)}})
  .sort({dueAt:1}).limit(5).lean();
 const scheduleNames=new Map(everyActive.map(x=>[String(x._id),x]));
 const watchIds=await PingSchedule.distinct("_id",{guildId,status:{$in:["active","paused","ended","completed"]}});
 const alerts=await PingDelivery.find({guildId,scheduleId:{$in:watchIds},
  $or:[{status:"failed"},{status:"skipped",error:/Missed while offline/}]})
  .sort({updatedAt:-1}).limit(3).lean();
 const awaitingArchive=await PingSchedule.countDocuments({guildId,status:{$in:["ended","completed"]},archiveMessageId:""});
 const lines=["**✦ Scheduled Pings — Staff Dashboard**",
  "Saved templates, recurring role mentions and message delivery history.",
  "Server time zone: **"+configuredZone+"**",
  "",
  "**Overview:** "+(counts.active?.count||0)+" active · "+(counts.paused?.count||0)+" paused · "+totals.reduce((n,x)=>n+x.sent,0)+" sent",
  "",
  "**Active Schedules**"];
 if(!active.length)lines.push("No active schedules.");
 for(const s of active){
  lines.push((s.status==="paused"?"⏸️ ":"🟦 ")+"**"+short(s.name)+"** — <#"+s.destinationChannelId+">",
   String(s.sentCount||0)+"/"+s.plannedCount+" sent · "+s.groups.length+" groups · Ends "+formatServerClock(s.endsAt,s.timeZone||configuredZone));
 }
 if((counts.active?.count||0)+(counts.paused?.count||0)>active.length)
  lines.push("…plus "+((counts.active?.count||0)+(counts.paused?.count||0)-active.length)+" more schedules. Use Manage Schedules for the full list.");
 lines.push("","**Next Scheduled Pings**");
 if(!due.length)lines.push("No upcoming pings.");
 lines.push(...dashboardUpcomingLines(due,scheduleNames,configuredZone));
 if(alerts.length){
  lines.push("","**⚠ Delivery Attention**");
  for(const e of alerts)lines.push("• Ping #"+e.sequence+" · "+short(e.error||"Failed to send").slice(0,84));
 }
 if(awaitingArchive)lines.push("","**Archive pending:** "+awaitingArchive+" schedule(s). The bot will retry automatically.");
 lines.push("","*Staff only · Use the buttons below to create or manage schedules.*");
 return {content:lines.join("\n").slice(0,1950),components:pingDashboardButtons(),
   allowedMentions:{parse:[]}};
}
export async function ensurePingDashboard(client,guildId){
 const config=await GuildConfig.findOne({guildId}).lean();
 if(!config?.scheduledPingsChannelId)return null;
 const guild=await client.guilds.fetch(guildId);
 const channel=await guild.channels.fetch(config.scheduledPingsChannelId).catch(()=>null);
 if(!channel?.send||channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
  throw Error("Scheduled Pings dashboard channel must be private and writable.");
 const bot=await guild.members.fetchMe();
 const perms=channel.permissionsFor(bot);
 for(const permission of [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory])
  if(!perms?.has(permission))throw Error("Bot needs View Channel, Send Messages and Read Message History in the private Scheduled Pings channel.");
 let message=config.scheduledPingsDashboardMessageId
  ?await channel.messages.fetch(config.scheduledPingsDashboardMessageId).catch(()=>null):null;
 if(message&&message.author.id!==client.user.id)message=null;
 const payload=await dashboardPayload(guildId);
 if(message){
  if(message.content!==payload.content)await message.edit(payload);
 }else{
  message=await channel.send(payload);
  await GuildConfig.updateOne({guildId},{$set:{scheduledPingsDashboardMessageId:message.id}});
  if(perms.has(PermissionFlagsBits.ManageMessages))await message.pin().catch(()=>{});
 }
 return message;
}
export async function refreshPingDashboard(client,guildId){
 try{return await ensurePingDashboard(client,guildId);}
 catch(error){console.error("[Scheduled Pings] Dashboard update failed for "+guildId,error);return null;}
}

async function sendOne(client,delivery,now){
 const locked=await PingDelivery.findOneAndUpdate({_id:delivery._id,status:"pending"},
  {$set:{status:"sending",processingStartedAt:now}},{new:true}).lean();
 if(!locked)return false;
 try{
  const s=await PingSchedule.findById(locked.scheduleId).lean();
  if(!s||s.status!=="active"){
   await PingDelivery.updateOne({_id:locked._id,status:"sending"},{$set:{status:"skipped",error:"Schedule was no longer active."}});
   if(s)await PingSchedule.updateOne({_id:s._id},{$inc:{skippedCount:1}});
   return true;
  }
  const guild=await client.guilds.fetch(s.guildId);
  const channel=await validatePingDestination(guild,s.destinationChannelId,locked.roleIds);
  const text=locked.roleIds.map(id=>"<@&"+id+">").join(" ")+(locked.content? (locked.roleIds.length?"\n":"")+locked.content:"");
  if(!text.trim())throw Error("No roles or message text left to send.");
  const message=await channel.send({content:text,allowedMentions:{parse:[],roles:locked.roleIds}});
  await PingDelivery.updateOne({_id:locked._id,status:"sending"},{$set:{
   status:"sent",sentAt:new Date(),messageId:message.id,messageUrl:message.url,
  }});
  await PingSchedule.updateOne({_id:s._id},{$inc:{sentCount:1}});
 }catch(error){
  // A Discord send may have succeeded just before a connection broke. Preserve
  // a clear audit trail and do not resend automatically.
  await PingDelivery.updateOne({_id:locked._id,status:"sending"},{$set:{
   status:"failed",error:String(error.message||error).slice(0,800),
  }});
  await PingSchedule.updateOne({_id:locked.scheduleId},{$inc:{failedCount:1}});
  console.error("[Scheduled Pings] Delivery failed:",locked._id,error);
 }
 return true;
}
async function completeIfFinished(scheduleId,client){
 const s=await PingSchedule.findById(scheduleId).lean();
 if(!s||s.status!=="active")return;
 const remaining=await PingDelivery.countDocuments({scheduleId,status:{$in:["pending","sending"]}});
 if(remaining)return;
 const changed=await PingSchedule.findOneAndUpdate({_id:s._id,status:"active"},
  {$set:{status:"completed",stoppedAt:new Date()}},{new:true}).lean();
 if(changed){
  await logPingChange(changed._id,changed.guildId,"system","completed",{});
  await refreshPingDashboard(client,changed.guildId);
 }
}
export async function reconcilePingSchedules(client,{now=new Date()}={}){
 // An ambiguous in-flight send must never be silently retransmitted after a restart.
 const ambiguous=await PingDelivery.find({status:"sending",processingStartedAt:{$lt:new Date(now.getTime()-10*60_000)}}).limit(30).lean();
 for(const event of ambiguous){
  const result=await PingDelivery.updateOne({_id:event._id,status:"sending"},
   {$set:{status:"failed",error:"Uncertain delivery after interrupted send; not automatically retried to prevent duplicate mentions."}});
  if(result.modifiedCount)await PingSchedule.updateOne({_id:event.scheduleId},{$inc:{failedCount:1}});
 }
 const activeIds=await PingSchedule.distinct("_id",{status:"active"});
 const due=await PingDelivery.find({scheduleId:{$in:activeIds},status:"pending",dueAt:{$lte:now}}).sort({dueAt:1}).limit(50).lean();
 const changedGuilds=new Set(),changedSchedules=new Set();
 for(const event of due){
  const s=await PingSchedule.findById(event.scheduleId).select("status guildId").lean();
  if(!s){await PingDelivery.updateOne({_id:event._id},{$set:{status:"skipped",error:"Schedule missing"}});continue;}
  if(s.status!=="active")continue; // Keep paused schedules dormant.
  if(nowMs(event.dueAt)<now.getTime()-20*60_000){
   const changed=await PingDelivery.updateOne({_id:event._id,status:"pending"},
    {$set:{status:"skipped",error:"Missed while offline; not backfilled to avoid mass mentions."}});
   if(changed.modifiedCount)await PingSchedule.updateOne({_id:event.scheduleId},{$inc:{skippedCount:1}});
  }else await sendOne(client,event,now);
  changedGuilds.add(s.guildId);changedSchedules.add(String(event.scheduleId));
 }
 for(const event of ambiguous){changedSchedules.add(String(event.scheduleId));changedGuilds.add(event.guildId);}
 for(const scheduleId of changedSchedules)await completeIfFinished(scheduleId,client);
 // Also handle a schedule where every future delivery was removed by an edit.
 const ending=await PingSchedule.find({status:"active",endsAt:{$lte:now}}).limit(50).select("_id guildId").lean();
 for(const s of ending){await completeIfFinished(s._id,client);changedGuilds.add(s.guildId);}
 for(const guildId of changedGuilds)await refreshPingDashboard(client,guildId);
 const completed=await PingSchedule.find({status:{$in:["completed","ended"]},archiveMessageId:""}).limit(10).lean();
 for(const schedule of completed)await archivePingSchedule(client,schedule).catch(err=>console.error("[Scheduled Pings] Archive pending:",err));
 return {processed:due.length,archived:completed.length};
}

export async function archivePingSchedule(client,schedule){
 if(schedule.archiveMessageId||!["completed","ended"].includes(schedule.status))return null;
 const leaseUntil=new Date(Date.now()+120_000);
 // At most one worker may publish an archive at a time.
 const locked=await PingSchedule.findOneAndUpdate({
  _id:schedule._id,archiveMessageId:"",status:{$in:["completed","ended"]},
  $or:[{archiveLeaseUntil:null},{archiveLeaseUntil:{$lte:new Date()}}],
 },{$set:{archiveLeaseUntil:leaseUntil}},{new:true}).lean();
 if(!locked)return null;
 try{
  // A staff end can race a Discord send already underway. The archive must
  // never claim final statistics until all such sends have resolved.
  const outstanding=await PingDelivery.countDocuments({
   scheduleId:locked._id,status:{$in:["pending","sending"]},
  });
  if(outstanding)return null;
  const config=await GuildConfig.findOne({guildId:locked.guildId}).lean();
  if(!config?.giveawayArchiveChannelId)throw Error("No shared archive is configured; archive remains pending.");
  const guild=await client.guilds.fetch(locked.guildId);
  const channel=await guild.channels.fetch(config.giveawayArchiveChannelId);
  if(!channel?.send)throw Error("Shared archive is inaccessible.");
  const deliveries=await PingDelivery.find({scheduleId:locked._id}).sort({sequence:1}).lean();
  const edits=await PingAudit.find({scheduleId:locked._id}).sort({createdAt:1}).lean();
  const counts={
   planned:deliveries.length,sent:deliveries.filter(d=>d.status==="sent").length,
   failed:deliveries.filter(d=>d.status==="failed").length,
   skipped:deliveries.filter(d=>d.status==="skipped").length,
  };
  const report={
   scheduleId:String(locked._id),status:locked.status,
   name:locked.name,template:locked.templateName,
   createdBy:locked.createdBy,activatedBy:locked.activatedBy,
   destinationChannelId:locked.destinationChannelId,timeZone:locked.timeZone||"UTC",
   startsAt:locked.startsAt,endsAt:locked.endsAt,stoppedAt:locked.stoppedAt,
   stopReason:locked.stopReason,groups:locked.groups,counts,
   deliveries:deliveries.map(d=>({
    sequence:d.sequence,groupIndex:d.groupIndex,dueAt:d.dueAt,
    sentAt:d.sentAt,roleIds:d.roleIds,content:d.content,
    status:d.status,messageId:d.messageId,messageUrl:d.messageUrl,error:d.error,
    changedBy:d.changedBy,
   })),
   changeHistory:edits.map(e=>({at:e.createdAt,by:e.actorId,event:e.event,details:e.details})),
  };
  const json=JSON.stringify(report,null,2);
  const summary="**🗄️ Scheduled Pings Archive — "+short(locked.name)+"**\n"+
   "**Schedule ID:** "+String(locked._id)+"\n"+
   "**Status:** "+locked.status+"\n"+
   "**Created by:** <@"+locked.createdBy+"> · **Activated by:** <@"+locked.activatedBy+">\n"+
   "**Destination:** <#"+locked.destinationChannelId+">\n"+
   "**Time zone:** "+(locked.timeZone||"UTC")+"\n"+
   "**Ran:** "+ts(locked.startsAt)+" to "+ts(locked.stoppedAt||locked.endsAt)+"\n"+
   "**Ping Groups:** "+locked.groups.length+
   " · **Sent:** "+counts.sent+" · **Failed:** "+counts.failed+" · **Skipped:** "+counts.skipped+
   "\n**Staff changes:** "+edits.filter(e=>e.event!=="activated").length+
   "\nComplete role mentions, message texts, send links, timestamps and modifications are attached.";
  // A crashed process may have already sent the archive before recording the
  // Discord message ID; recover it rather than posting a duplicate.
  const recent=await channel.messages.fetch({limit:100}).catch(()=>null);
  let message=recent?.find(m=>m.author?.id===client.user.id&&
   m.content?.includes("**Schedule ID:** "+String(locked._id)));
  if(!message){
   let bytes=Buffer.from(json,"utf8");
   let extension=".json";
   if(bytes.length>7_000_000){bytes=gzipSync(bytes,{level:9});extension=".json.gz";}
   if(bytes.length>7_000_000)throw Error("Archive exceeds attachment limit; MongoDB retains all records.");
   message=await channel.send({content:summary+(extension.endsWith(".gz")?"\nJSON log is gzip-compressed.":""),
    files:[new AttachmentBuilder(bytes,{name:"scheduled-pings-"+String(locked._id)+extension})],
    allowedMentions:{parse:[]}});
  }
  await PingSchedule.updateOne({_id:locked._id,archiveMessageId:"",archiveLeaseUntil:leaseUntil},{$set:{
   archiveMessageId:message.id,archivedAt:new Date(),status:"archived",archiveLeaseUntil:null,
  }});
  await refreshPingDashboard(client,locked.guildId);
  return message;
 }finally{
  // Keep the schedule retriable if posting fails or deliveries are in-flight.
  await PingSchedule.updateOne({_id:locked._id,archiveLeaseUntil:leaseUntil},
   {$set:{archiveLeaseUntil:null}});
 }
}

export async function pausePingSchedule(client,schedule,actorId){
 const updated=await PingSchedule.findOneAndUpdate({_id:schedule._id,status:"active"},
  {$set:{status:"paused"}},{new:true});
 if(!updated)throw Error("This schedule is not active.");
 await logPingChange(schedule._id,schedule.guildId,actorId,"paused",{});
 await refreshPingDashboard(client,schedule.guildId);
 return updated;
}
export async function resumePingSchedule(client,schedule,actorId){
 const session=await mongoose.startSession();
 let updated;
 try{
  await session.withTransaction(async()=>{
   const paused=await PingSchedule.findOne({_id:schedule._id,status:"paused"}).session(session);
   if(!paused)throw Error("This schedule is not paused.");
   // Skip past-due entries before the schedule becomes active, so the timer
   // cannot race the Resume button and send a backlog of missed pings.
   const missed=await PingDelivery.updateMany({scheduleId:schedule._id,status:"pending",dueAt:{$lt:new Date()}},
    {$set:{status:"skipped",error:"Skipped while paused."}},{session});
   paused.status="active";
   paused.skippedCount+=(missed.modifiedCount||0);
   updated=await paused.save({session});
   await PingAudit.create([{scheduleId:schedule._id,guildId:schedule.guildId,
    actorId,event:"resumed",details:{skipped:missed.modifiedCount||0}}],{session});
  });
 }finally{await session.endSession();}
 await completeIfFinished(schedule._id,client);
 await refreshPingDashboard(client,schedule.guildId);
 return updated;
}
export async function endPingSchedule(client,schedule,actorId,reason){
 const result=await PingSchedule.findOneAndUpdate({_id:schedule._id,status:{$in:["active","paused"]}},
  {$set:{status:"ended",stoppedAt:new Date(),stopReason:String(reason).slice(0,500)}},{new:true});
 if(!result)throw Error("This schedule already ended.");
 const changed=await PingDelivery.updateMany({scheduleId:schedule._id,status:"pending"},
  {$set:{status:"skipped",error:"Ended early by staff."}});
 if(changed.modifiedCount)await PingSchedule.updateOne({_id:schedule._id},{$inc:{skippedCount:changed.modifiedCount}});
 await logPingChange(schedule._id,schedule.guildId,actorId,"ended early",{reason,skipped:changed.modifiedCount});
 try{await archivePingSchedule(client,result);}
 catch(error){console.error("[Scheduled Pings] Schedule ended, archive pending:",error);}
 await refreshPingDashboard(client,schedule.guildId);
 return result;
}

export async function extendPingSchedule(client,schedule,actorId,extraDays){
 if(!Number.isInteger(extraDays)||extraDays<1||extraDays>365)
  throw Error("Choose 1–365 additional days.");
 if(!["active","paused"].includes(schedule.status))
  throw Error("This schedule cannot be extended because it is already closed.");
 const existingGroups=schedule.groups.map(g=>({...g,roleIds:[...g.roleIds],messages:[...g.messages]}));
 const nextGroups=existingGroups.map(g=>({...g,durationDays:g.durationDays+extraDays}));
 if(nextGroups.some(g=>g.durationDays>365))
  throw Error("The new group duration would exceed 365 days.");
 const zone=validateServerTimeZone(schedule.timeZone||"UTC");
 const nextPlan=planPingDeliveries(nextGroups,schedule.startsAt,{timeZone:zone});
 const start=new Date(schedule.startsAt).getTime();
 const newlyAdded=nextPlan.filter(e=>e.dueAt.getTime()>=
  nowMs(scheduleGroupEnd(start,existingGroups[e.groupIndex].durationDays,zone)));
 if(!newlyAdded.length)throw Error("There are no additional messages within the extension.");
 const session=await mongoose.startSession();
 try{
  await session.withTransaction(async()=>{
   const current=await PingSchedule.findOne({_id:schedule._id,
     status:{$in:["active","paused"]},endsAt:schedule.endsAt}).session(session);
   if(!current)throw Error("The schedule changed while you were editing. Refresh it.");
   const last=await PingDelivery.findOne({scheduleId:schedule._id}).sort({sequence:-1}).session(session);
   let sequence=(last?.sequence||0);
   await PingDelivery.insertMany(newlyAdded.map(e=>({...e,
    sequence:++sequence,guildId:schedule.guildId,scheduleId:schedule._id
   })),{session,ordered:true});
   current.groups=nextGroups;
   current.endsAt=new Date(Math.max(...nextGroups.map(g=>nowMs(scheduleGroupEnd(start,g.durationDays,zone)))));
   current.plannedCount+=newlyAdded.length;
   await current.save({session});
   await PingAudit.create([{guildId:schedule.guildId,scheduleId:schedule._id,
    actorId,event:"extended",details:{additionalDays:extraDays,
     oldEndAt:schedule.endsAt,newEndAt:current.endsAt,addedPings:newlyAdded.length}}],{session});
  });
 }finally{await session.endSession();}
 await refreshPingDashboard(client,schedule.guildId);
 return newlyAdded.length;
}

export async function changeFuturePing(client,schedule,event,actorId,{content,roleIds,dueAt}){
 if(!["active","paused"].includes(schedule.status))throw Error("This schedule is closed.");
 if(event.status!=="pending"||new Date(event.dueAt)<=new Date())throw Error("Only future pending pings can be edited.");
 const after={
  content:content===undefined?event.content:String(content).trim(),
  roleIds:roleIds===undefined?event.roleIds:[...new Set(roleIds.map(String))],
  dueAt:dueAt===undefined?event.dueAt:new Date(dueAt),
 };
 if(after.roleIds.length>10||after.content.length+after.roleIds.length*24>1900)
  throw Error("Too many roles or too much text.");
 if(!after.roleIds.length&&!after.content)throw Error("A ping needs text or at least one role.");
 if(new Date(after.dueAt)<=new Date())throw Error("Choose a future posting time.");
 const guild=await client.guilds.fetch(schedule.guildId);
 await validatePingDestination(guild,schedule.destinationChannelId,after.roleIds);
 const before={content:event.content,roleIds:event.roleIds,dueAt:event.dueAt};
 const session=await mongoose.startSession();
 let updated;
 try{
  await session.withTransaction(async()=>{
   updated=await PingDelivery.findOneAndUpdate({_id:event._id,status:"pending",dueAt:event.dueAt},
    {$set:{...after,changedBy:actorId}},{new:true,session});
   if(!updated)throw Error("This ping changed while you were editing. Please reload.");
   await PingAudit.create([{scheduleId:schedule._id,guildId:schedule.guildId,actorId,
    event:"edited future ping",details:{sequence:event.sequence,before,after}}],{session});
  });
 }finally{await session.endSession();}
 await refreshPingDashboard(client,schedule.guildId);
 return updated;
}
