import mongoose from "mongoose";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {ensureGiveawayStaffRecord} from "./giveaway-staff-records.js";
import {DEFAULT_CLAIM_HOURS} from "./giveaway-claims.js";
import { currentActivityDay, messageCharacterCount, messageMatchesGiveawayWatch } from "./giveaway-activity-counter.js";
import { easternMidnight, shiftCalendarDay, nextWeeklyAnnouncement } from "./giveaway-plan-time.js";

export const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hour = 3600000;
const seriesSchema = new mongoose.Schema({
  guildId: { type: String, required: true }, settings: { type: Object, required: true },
  nextStart: Date, enabled: { type: Boolean, default: true },
});
seriesSchema.index({enabled:1, nextStart:1, guildId:1});
const Series = mongoose.models.GuidedActivitySeries || mongoose.model("GuidedActivitySeries", seriesSchema);
export const GuidedActivitySeries=Series;

// A delivery ID makes Gateway retries harmless. Never retain the message body.
const receiptSchema = new mongoose.Schema({
  _id: String, event: mongoose.Schema.Types.ObjectId, user: String, day: String,
  matches: Boolean, at: Date, expires: Date,
});
receiptSchema.index({event:1, user:1, day:1});
receiptSchema.index({expires:1}, {expireAfterSeconds:0});
const Receipt = mongoose.models.GuidedActivityReceipt || mongoose.model("GuidedActivityReceipt", receiptSchema);

function nextBoundary(start, weekday) {
  const local = currentActivityDay(start);
  const current = new Date(local + "T12:00:00Z").getUTCDay();
  return easternMidnight(shiftCalendarDay(local, (weekday - current + 7) % 7 || 7));
}
export function windowEnd(settings, start) {
  if (settings.period === "weekly") return nextBoundary(start, settings.endDay);
  return new Date(start.getTime() + settings.hours * hour);
}
export function nextOpening(settings, start) {
  if (settings.repeat === "weekly") {
    if (settings.period === "weekly") {
      const end = windowEnd(settings, start);
      if (settings.startDay === settings.endDay) return end;
      return nextBoundary(end, settings.startDay);
    }
    return nextWeeklyAnnouncement(start);
  }
  const minutes = settings.repeat === "daily" ? 1440 : settings.interval;
  return new Date(start.getTime() + minutes * 60000);
}
export function repeatText(settings) {
  if (settings.repeat === "once") return "One time";
  if (settings.repeat === "daily") return "Every 24 hours";
  if (settings.repeat === "weekly") return "Every week";
  return 'Every ' + settings.amount + ' ' + settings.unit;
}
export function maxActiveDays(start,end) {
  const first = Date.parse(currentActivityDay(start));
  const last = Date.parse(currentActivityDay(new Date(end.getTime()-1)));
  return end-start <= 24*hour ? 1 : 1 + Math.round((last-first)/(24*hour));
}

// Total messages are counted across the full window; active-day spread is separate.
export function guidedActivityRequirements(settings){
  return {activityMinimum:1,activityDays:settings.days,activityMinTotalMessages:settings.minimum};
}
export function qualifiesForGuidedActivity(row,event){
  return row.days>=event.activityDays &&
    row.messages>=(event.activityMinTotalMessages || event.activityMinimum*event.activityDays);
}
async function materialize(series,start,first=false) {
  const s = series.settings, end = windowEnd(s,start);
  const config = await GuildConfig.findOne({guildId:series.guildId}).lean();
  if (!config?.activityGiveawayWinnersChannelId) throw Error("Set the activity winners channel in /setup channels.");
  const query = first ? {_id:series._id} : {guidedSeries:series._id,activityStartAt:start};
  try {
    return await Giveaway.findOneAndUpdate(query, {$setOnInsert:{
      guildId:series.guildId, guidedSeries:series._id, creatorId:s.creator, channelId:config.activityGiveawayWinnersChannelId,
      title:s.title, prize:s.prize, description:s.description||"", mode:"activity", status:"open", winnerCount:s.winners,
      activityType:s.channel?"channels":"general", activityChannelIds:s.channel?[s.channel]:[],
      activityStartAt:start, activityEndAt:end, customActivityStartAt:start,customActivityEndAt:end,
      endsAt:new Date(end.getTime()+s.delay), ...guidedActivityRequirements(s),
      activityMinChars:1,
      activityRequiredMentionUserId:s.mention || "", activityRequiredPhrase:s.phrase || "",
      requireStaffReview:s.approval, roleBonuses:s.bonuses || [], progressEnabled:Boolean(s.progress),
      requiredRoleId:s.requiredRoleId||"",requiredRoleInstructions:s.requiredRoleInstructions||"",
      showRequiredRoleInstructions:s.showRequiredRoleInstructions!==false,
      claimWindowHours:s.claimHours ?? DEFAULT_CLAIM_HOURS, autoRerollClaims:true, bannerNameKey:s.banner || "",
      claimInstructions:s.claimInstructions||"",maxAutoRerolls:s.maxAutoRerolls??2,
      notificationRoleIds:s.notificationRoleIds||[],announceEmptyResults:s.announceEmptyResults!==false,
    }},{upsert:true,new:true}).lean();
  } catch(error) {
    if(error.code!==11000)throw error;
    return Giveaway.findOne(query).lean();
  }
}
export async function createGuidedActivity(id,guildId,settings,start) {
  // Keep the first opening durable until its giveaway has been saved.
  const series = await Series.findOneAndUpdate({_id:id},{$setOnInsert:{
    guildId,settings:{...settings,firstStart:start},nextStart:start,
  }},{upsert:true,new:true}).lean();
  const firstStart = new Date(series.settings.firstStart);
  const record = await materialize(series,firstStart,true);
  await advance(series,firstStart);
  return record;
}
function advance(series,start) {
  const nextStart = series.settings.repeat==="once"?null:nextOpening(series.settings,start);
  return Series.updateOne({_id:series._id,nextStart:start},{$set:{nextStart,enabled:Boolean(nextStart)}});
}
export async function openDueActivities(now=new Date(),guildId) {
  const due = await Series.find({enabled:true,nextStart:{$type:"date",$lte:now},...(guildId?{guildId}:{})}).lean();
  for (const series of due) {
    let start = new Date(series.nextStart);
    // Recover the current window after downtime without announcing missed cycles.
    if(series.settings.repeat!=="once" && windowEnd(series.settings,start)<=now) {
      if(series.settings.repeat!=="weekly"){
        const step=nextOpening(series.settings,start)-start;
        start=new Date(+start+Math.floor((now-start)/step)*step);
      }else{
        while(nextOpening(series.settings,start)<=now)start=nextOpening(series.settings,start);
      }
    }
    if(windowEnd(series.settings,start)>now || +start===+new Date(series.settings.firstStart))
      await materialize(series,start,+start===+new Date(series.settings.firstStart));
    const nextStart=series.settings.repeat==="once"?null:nextOpening(series.settings,start);
    await Series.updateOne({_id:series._id,nextStart:series.nextStart},{$set:{nextStart,enabled:Boolean(nextStart)}});
  }
}
export function guidedMessageMatches(event,message) {
  return messageMatchesGiveawayWatch(message,{
    requiredMentionUserId:event.activityRequiredMentionUserId,
    requiredPhrase:event.activityRequiredPhrase,
    minimumChars:event.activityRequiredMentionUserId && !event.activityRequiredPhrase ? 0 : 1,
  });
}
export async function recordGuidedMessage(message) {
  if(!message.guildId || message.author?.bot || message.webhookId || !messageCharacterCount(message))return;
  const time=message.createdAt;
  await openDueActivities(time,message.guildId);
  const events=await Giveaway.find({
    guildId:message.guildId,guidedSeries:{$type:"objectId"},status:"open",
    activityStartAt:{$lte:time},activityEndAt:{$gt:time},
    $or:[{activityType:"general"},{activityChannelIds:message.channelId}],
  }).lean();
  let roleMember;
  for(const event of events){
    // Required role: check membership before creating activity receipts.
    if(event.requiredRoleId){
      if(roleMember===undefined)
        roleMember=await message.guild?.members.fetch({user:message.author.id,force:true}).catch(()=>null) || null;
      if(!roleMember?.roles?.cache?.has(event.requiredRoleId))continue;
    }
    const matches=guidedMessageMatches(event,message);
    await Receipt.updateOne({_id:event._id+":"+message.id},{$setOnInsert:{
      event:event._id,user:message.author.id,day:currentActivityDay(time),matches:Boolean(matches),at:time,
      expires:new Date(+event.endsAt+90*24*hour),
    }},{upsert:true});
  }
}
// Changing a live watch channel, member ping or phrase starts a new qualifying
// window. Previous receipts remain for audit/TTL but are excluded by message time.
// No historical messages are downloaded or replayed.
export async function resetGuidedActivityCriteria(event,changes,when=new Date()){
  if(event.status!=="open")throw Error("Only an active giveaway can restart counting.");
  if(new Date(event.activityEndAt)<=when)throw Error("The activity has already reached its cutoff.");
  if(event.activityDays>maxActiveDays(when,new Date(event.activityEndAt)))
    throw Error("Not enough active days remain. Lower the active-day requirement or extend the deadline first.");
  return Giveaway.findOneAndUpdate({_id:event._id,guildId:event.guildId,status:"open"},
    {$set:{...changes,activityStartAt:when,customActivityStartAt:when,activityResetAt:when}},
    {returnDocument:"after"}).lean();
}

export async function activityRoster(event,user) {
  const short=event.activityEndAt-event.activityStartAt<=24*hour;
  const rows=await Receipt.aggregate([
    {$match:{event:event._id,...(user?{user}:{}),
      ...(event.activityResetAt?{at:{$gte:new Date(event.activityResetAt)}}:{})}},
    {$group:{_id:{user:"$user",day:short?{$literal:"window"}:"$day"},matches:{$sum:{$cond:["$matches",1,0]}}}},
    {$group:{_id:"$_id.user",messages:{$sum:"$matches"},days:{$sum:{$cond:[{$gte:["$matches",event.activityMinimum]},1,0]}}}},
    {$sort:{days:-1,messages:-1,_id:1}},
  ]);
  return rows.map(row=>({...row,qualified:qualifiesForGuidedActivity(row,event)}));
}

const btn=(id,label,style=ButtonStyle.Secondary)=>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export function guidedStaffCardPayload(event,series=null) {
  const marker="Activity staff preview · "+event._id;
  const status=event.status==="open"?"Collecting activity":
    event.status==="pending_review"?"Awaiting staff drawing approval":
    event.status==="cancelled"?"Cancelled — no winners will be drawn":
    event.status==="ended"?(event.staffEndedEarly?"Ended early":"Completed"):
    event.status==="closing"?"Finalizing winner draw":String(event.status);
  const controls=[btn("activitystaff:view:"+event._id+":0","Preview qualifying members")];
  if(event.status==="open"){
    controls.push(btn("activitystaff:edit:"+event._id,"Edit Giveaway",ButtonStyle.Primary));
    controls.push(btn("activitystaff:end:"+event._id,"End Early",ButtonStyle.Success));
    controls.push(btn("activitystaff:cancel:"+event._id,"Cancel Giveaway",ButtonStyle.Danger));
  }
  if(series?.enabled)controls.push(btn("activitystaff:pause:"+event._id,"Stop future repeats"));
  const text="**"+String(event.title||"Giveaway").slice(0,180)+"**\n"+
    String(event.prize||"").slice(0,800)+
    (event.description?"\n**Giveaway Details:**\n"+String(event.description).slice(0,1000):"")+
    "\n**Status:** "+status+
    "\nStaff can check current activity here. Manual approval is "+
    (event.requireStaffReview?"on.":"off.")+
    (series?.enabled?" Future repeats are active.":"");
  return {embeds:[{footer:{text:marker},description:text.slice(0,3900)}],
    components:[new ActionRowBuilder().addComponents(controls)],
    allowedMentions:{parse:[]}};
}
export async function ensureStaffCard(client,event) {
  return ensureGiveawayStaffRecord(client,event);
}
export async function staffPreview(i) {
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return i.editReply("Only Manage Server staff can view activity.");
  const [,action,id,rawPage,extraPage]=i.customId.split(":");
  const event=await Giveaway.findOne({_id:id,guildId:i.guildId,staffCardChannelId:i.channelId}).lean();
  if(!event)return i.editReply("This staff preview is unavailable.");
  if(action==="pause"){
    await Series.updateOne({_id:event.guidedSeries},{$set:{enabled:false,nextStart:null}});
    await ensureStaffCard(i.client,event);
    return i.editReply("Future repeats stopped. The current activity will finish as scheduled.");
  }
  const {activityProgressRows}=await import("./giveaway-staff-progress.js");
  const rows=await activityProgressRows(event);
  const mode=action==="progress"?"progress":action==="member"&&rawPage==="progress"?"progress":"qualified";
  const filtered=rows.filter(row=>mode==="qualified"?row.qualified:!row.qualified);
  const pageValue=action==="member"?Number(extraPage):Number(rawPage);
  const pages=Math.max(1,Math.ceil(filtered.length/10));
  const page=Math.min(Math.max(0,pageValue||0),pages-1);
  const required=event.activityMinTotalMessages||event.activityMinimum||1;
  const requiredDays=Math.max(1,event.activityDays||1);
  if(action==="find"){
    const userId=i.values?.[0];
    if(!userId)return i.editReply("Select a member to view progress.");
    const found=rows.find(row=>row.userId===userId);
    return i.editReply({content:[
      "**Member progress · <@"+userId+">**",
      "**Status:** "+(found?(found.qualified?"Qualified":"Still in progress"):"No recorded qualifying activity"),
      "**Qualifying messages:** "+(found?.messages||0)+" / "+required+" during this activity period",
      ...(requiredDays>1?["**Active days:** "+(found?.days||0)+" / "+requiredDays]:[]),
    ].join("\n"),allowedMentions:{parse:[]}});
  }
  if(action==="member"){
    const userId=i.values?.[0];
    const member=filtered.find(row=>row.userId===userId);
    if(!member)return i.editReply("This member is no longer in the selected progress list.");
    const label=member.qualified?"Qualified":"Still in progress";
    return i.editReply({content:[
      "**Member progress · <@"+userId+">**",
      "**Status:** "+label,
      "**Qualifying messages:** "+member.messages+" / "+required+" during this activity period",
      ...(requiredDays>1?["**Active days:** "+member.days+" / "+requiredDays]:[]),
      "**Activity start:** <t:"+Math.floor(+new Date(event.activityStartAt)/1000)+":f>",
      "**Activity end:** <t:"+Math.floor(+new Date(event.activityEndAt)/1000)+":f>",
    ].join("\n"),components:[new ActionRowBuilder().addComponents(
      btn("activitystaff:"+mode+":"+id+":"+page,"Back to "+(mode==="qualified"?"Qualified":"In Progress")))],
      allowedMentions:{parse:[]}});
  }
  const buttons=[
    btn("activitystaff:qualified:"+id+":0","Qualified ("+rows.filter(r=>r.qualified).length+")"),
    btn("activitystaff:progress:"+id+":0","In Progress ("+rows.filter(r=>!r.qualified).length+")"),
  ];
  if(page>0)buttons.push(btn("activitystaff:"+mode+":"+id+":"+(page-1),"Previous"));
  if(page+1<pages)buttons.push(btn("activitystaff:"+mode+":"+id+":"+(page+1),"Next"));
  const lines=filtered.slice(page*10,page*10+10).map(r=>
    "<@"+r.userId+"> · "+r.messages+"/"+required+" qualifying messages"+
    (requiredDays>1?" · "+r.days+"/"+requiredDays+" days":""));
  const content=[
    "**"+event.title+" · "+(mode==="qualified"?"Qualified Members":"In Progress")+"**",
    "**Participants with activity:** "+rows.length+" · **Qualified:** "+rows.filter(r=>r.qualified).length+
      " · **Still working:** "+rows.filter(r=>!r.qualified).length,
    "",...(lines.length?lines:["No members in this category."]),
    "", "*Only members with recorded activity are listed.*",
    "Page "+(page+1)+" of "+pages,
  ].join("\n");
  const components=[new ActionRowBuilder().addComponents(buttons)];
  if(lines.length){
    const {StringSelectMenuBuilder}=await import("discord.js");
    const select=new StringSelectMenuBuilder().setCustomId("activitystaff:member:"+id+":"+mode+":"+page)
      .setPlaceholder("Choose a member to view details")
      .addOptions(filtered.slice(page*10,page*10+10).map(r=>({
        label:r.userId,description:r.messages+" matching messages",value:r.userId,
      })));
    components.push(new ActionRowBuilder().addComponents(select));
  }
  return i.editReply({content,allowedMentions:{parse:[]},components});
}
