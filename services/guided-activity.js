import mongoose from "mongoose";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "./giveaway-manager-permissions.js";
import GuildConfig from "../models/GuildConfig.js";
import {sharedGiveawayPingRoleId} from "./giveaway-notification-roles.js";
import {ensureGiveawayStaffRecord} from "./giveaway-staff-records.js";
import {DEFAULT_CLAIM_HOURS} from "./giveaway-claims.js";
import { currentActivityDay, messageCharacterCount, messageMatchesGiveawayWatch } from "./giveaway-activity-counter.js";
import { easternMidnight, shiftCalendarDay, nextWeeklyAnnouncement } from "./giveaway-plan-time.js";
import {eligibleActivityParticipant} from "./activity-participation.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";

export const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hour = 3600000;
const seriesSchema = new mongoose.Schema({
  guildId: { type: String, required: true }, settings: { type: Object, required: true },
  nextStart: Date, enabled: { type: Boolean, default: true },
  // Counts successful additional giveaway occurrences after the first.
  repeatCount:{type:Number,default:0},
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
  if(settings.repeat==="once")return "One time";
  const cadence=settings.repeat==="daily"?"Every 24 hours":
    settings.repeat==="weekly"?"Every week":'Every '+settings.amount+' '+settings.unit;
  return cadence+(Number.isSafeInteger(settings.maxRepeats)&&settings.maxRepeats>=1
    ?" · "+settings.maxRepeats+" additional repeats":" · Forever until stopped");
}
export function canRepeatGuidedActivity(settings,repeatCount=0){
  return settings.repeat!=="once" &&
    (settings.maxRepeats==null || repeatCount<settings.maxRepeats);
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
  if (!config?.activityGiveawayWinnersChannelId) throw Error("Set the activity winners channel in /setup activity-giveaways.");

  const query = first ? {_id:series._id} : {guidedSeries:series._id,activityStartAt:start};
  try {
    return await Giveaway.findOneAndUpdate(query, {$setOnInsert:{
      guildId:series.guildId, guidedSeries:series._id, creatorId:s.creator, channelId:config.activityGiveawayWinnersChannelId,
      title:s.title, prize:s.prize, description:s.description||"", mode:"activity", status:"open", winnerCount:s.winners,
      activityType:s.channel?"channels":"general", activityChannelIds:s.channel?[s.channel]:[],
      activityStartAt:start, activityEndAt:end, customActivityStartAt:start,customActivityEndAt:end,
      endsAt:new Date(end.getTime()+s.delay), ...guidedActivityRequirements(s),
      activityMinChars:Number.isSafeInteger(s.minChars)&&s.minChars>=1&&s.minChars<=2000?s.minChars:1,
      activityRequiredMentionUserId:s.mention || "", activityRequiredPhrase:s.phrase || "",
      requireStaffReview:s.approval, roleBonuses:s.bonuses || [], progressEnabled:Boolean(s.progress),
      enforceExclusionRole:s.enforceExclusionRole!==false,
      // Activity participation is recorded by MongoDB opt-in, not a role.
      claimWindowHours:s.claimHours ?? DEFAULT_CLAIM_HOURS, autoRerollClaims:true, bannerNameKey:s.banner || "",
      claimInstructions:s.claimInstructions||"",maxAutoRerolls:s.maxAutoRerolls??2,
      notificationRoleIds:sharedGiveawayPingRoleId(config)?[sharedGiveawayPingRoleId(config)]:[],announceEmptyResults:s.announceEmptyResults!==false,
    }},{upsert:true,new:true}).lean();
  } catch(error) {
    if(error.code!==11000)throw error;
    return Giveaway.findOne(query).lean();
  }
}
export async function createGuidedActivity(id,guildId,settings,start) {
  // Keep the first opening durable until its giveaway has been saved.
  const series = await Series.findOneAndUpdate({_id:id},{$setOnInsert:{
    guildId,settings:{...settings,firstStart:start},nextStart:start,repeatCount:0,
  }},{upsert:true,new:true}).lean();
  const firstStart = new Date(series.settings.firstStart);
  const record = await materialize(series,firstStart,true);
  await advance(series,firstStart);
  return record;
}
function advance(series,start) {
  const nextStart=canRepeatGuidedActivity(series.settings,series.repeatCount||0)?
    nextOpening(series.settings,start):null;
  return Series.updateOne({_id:series._id,nextStart:start},
    {$set:{nextStart,enabled:Boolean(nextStart)}});
}
export async function openDueActivities(now=new Date(),guildId) {
  const due = await Series.find({enabled:true,nextStart:{$type:"date",$lte:now},...(guildId?{guildId}:{})}).lean();
  for (const series of due) {
    if(!canRepeatGuidedActivity(series.settings,series.repeatCount||0)){
      await Series.updateOne({_id:series._id,nextStart:series.nextStart},
        {$set:{nextStart:null,enabled:false}});
      continue;
    }
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
    const first=+start===+new Date(series.settings.firstStart);
    const shouldMaterialize=windowEnd(series.settings,start)>now||first;
    if(shouldMaterialize)await materialize(series,start,first);
    const repeatCount=(series.repeatCount||0)+(shouldMaterialize&&!first?1:0);
    const nextStart=canRepeatGuidedActivity(series.settings,repeatCount)?
      nextOpening(series.settings,start):null;
    await Series.updateOne({_id:series._id,nextStart:series.nextStart},
      {$set:{nextStart,enabled:Boolean(nextStart),repeatCount}});
  }
}
export function guidedMessageMatches(event,message) {
  return messageMatchesGiveawayWatch(message,{
    requiredMentionUserId:event.activityRequiredMentionUserId,
    requiredPhrase:event.activityRequiredPhrase,
    // Length is based on meaningful text after stripping explicit @mentions.
    // The configured threshold applies even if the event requires a ping.
    minimumChars:Number.isSafeInteger(event.activityMinChars)&&event.activityMinChars>1?
      event.activityMinChars:
      // With the default "No length minimum", an explicit member ping alone
      // remains eligible as before; custom thresholds always require text.
      event.activityRequiredMentionUserId&&!event.activityRequiredPhrase?0:1,
  });
}
export async function recordGuidedMessage(message) {
  if(!message.guildId || message.author?.bot || message.webhookId || !messageCharacterCount(message))return;
  if(!await eligibleActivityParticipant(message))return;
  const time=message.createdAt;
  await openDueActivities(time,message.guildId);
  const events=await Giveaway.find({
    guildId:message.guildId,guidedSeries:{$type:"objectId"},status:"open",
    activityStartAt:{$lte:time},activityEndAt:{$gt:time},
    $or:[{activityType:"general"},{activityChannelIds:message.channelId}],
  }).lean();
  for(const event of events){
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

export async function activityRoster(event,user=null,guild=null,{historical=false}={}) {
  const short=event.activityEndAt-event.activityStartAt<=24*hour;
  const rows=await Receipt.aggregate([
    {$match:{event:event._id,...(user?{user}:{}),
      ...(event.activityResetAt?{at:{$gte:new Date(event.activityResetAt)}}:{})}},
    ...(historical?[]:[
      {$lookup:{from:ActivityGiveawayOptIn.collection.name,localField:"user",foreignField:"userId",
        as:"activityConsent",pipeline:[{$match:{guildId:event.guildId,active:true}}]}},
      {$unwind:"$activityConsent"},
      {$match:{$expr:{$gte:["$at","$activityConsent.optedInAt"]}}},
    ]),
    {$group:{_id:{user:"$user",day:short?{$literal:"window"}:"$day"},matches:{$sum:{$cond:["$matches",1,0]}}}},
    {$group:{_id:"$_id.user",messages:{$sum:"$matches"},days:{$sum:{$cond:[{$gte:["$matches",event.activityMinimum]},1,0]}}}},
    {$sort:{days:-1,messages:-1,_id:1}},
  ]);
  let visible=rows;
  if(guild){
    const checks=await Promise.all(rows.map(async row=>{
      const member=await guild.members.fetch({user:row._id,force:true}).catch(()=>null);
      return Boolean(member&&!member.user?.bot);
    }));
    visible=rows.filter((_,n)=>checks[n]);
  }
  return visible.map(row=>({...row,qualified:qualifiesForGuidedActivity(row,event)}));
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
  if(!await canManageGiveaways(i))return i.editReply(giveawayManagerPermissionMessage);
  const [,action,id,rawPage]=i.customId.split(":");
  const event=await Giveaway.findOne({_id:id,guildId:i.guildId,staffCardChannelId:i.channelId}).lean();
  if(!event)return i.editReply("This staff preview is unavailable.");
  if(action==="pause"){
    await Series.updateOne({_id:event.guidedSeries},{$set:{enabled:false,nextStart:null}});
    await ensureStaffCard(i.client,event);
    return i.editReply("Future repeats stopped. The current activity will finish as scheduled.");
  }
  const rows=await activityRoster(event,null,i.guild);
  const page=Math.min(Number(rawPage)||0,Math.max(0,Math.ceil(rows.length/12)-1));
  const controls=[];
  if(page>0)controls.push(btn('activitystaff:view:'+id+':'+(page-1),"Previous"));
  if((page+1)*12<rows.length)controls.push(btn('activitystaff:view:'+id+':'+(page+1),"Next"));
  const qualified=rows.filter(r=>r.qualified).length;
  const lines=rows.slice(page*12,page*12+12).map(r=>
    (r.qualified?"Qualified":"Not yet qualified")+' · <@'+r._id+'> · '+r.messages+' matching message(s)'+(event.activityDays>1?' · '+r.days+'/'+event.activityDays+' active days':''));
  return i.editReply({content:['**'+event.title+'**',qualified+' qualified · '+(rows.length-qualified)+' not yet qualified', 'Goal · '+(event.activityMinTotalMessages||event.activityMinimum)+' matching message(s) total during the activity period'+(event.activityDays>1?' · at least one on '+event.activityDays+' different days':''),...lines,
    rows.length?'Page '+(page+1)+' of '+Math.ceil(rows.length/12):"No members have posted in the watched channels during this activity."].join('\n'),
    allowedMentions:{parse:[]},components:controls.length?[new ActionRowBuilder().addComponents(controls)]:[]});
}
