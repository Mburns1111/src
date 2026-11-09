import mongoose from "mongoose";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
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

// A delivery ID makes Gateway retries harmless. Never retain the message body.
const receiptSchema = new mongoose.Schema({
  _id: String, event: mongoose.Schema.Types.ObjectId, user: String, day: String,
  matches: Boolean, expires: Date,
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
      title:s.title, prize:s.prize, mode:"activity", status:"open", winnerCount:s.winners,
      activityType:s.channel?"channels":"general", activityChannelIds:s.channel?[s.channel]:[],
      activityStartAt:start, activityEndAt:end, customActivityStartAt:start,customActivityEndAt:end,
      endsAt:new Date(end.getTime()+s.delay), ...guidedActivityRequirements(s),
      activityMinChars:1,
      activityRequiredMentionUserId:s.mention || "", activityRequiredPhrase:s.phrase || "",
      requireStaffReview:s.approval, roleBonuses:s.bonuses || [], progressEnabled:Boolean(s.progress),
      claimWindowHours:s.claimHours ?? DEFAULT_CLAIM_HOURS, autoRerollClaims:true, bannerNameKey:s.banner || "",
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
export async function recordGuidedMessage(message) {
  if(!message.guildId || message.author?.bot || message.webhookId || !messageCharacterCount(message))return;
  const time=message.createdAt;
  await openDueActivities(time,message.guildId);
  const events=await Giveaway.find({
    guildId:message.guildId,guidedSeries:{$type:"objectId"},status:"open",
    activityStartAt:{$lte:time},activityEndAt:{$gt:time},
    $or:[{activityType:"general"},{activityChannelIds:message.channelId}],
  }).lean();
  for(const event of events){
    const matches=messageMatchesGiveawayWatch(message,{
      requiredMentionUserId:event.activityRequiredMentionUserId,requiredPhrase:event.activityRequiredPhrase,
      minimumChars:event.activityRequiredMentionUserId && !event.activityRequiredPhrase ? 0 : 1,
    }) || (event.activityRequiredMentionUserId && !event.activityRequiredPhrase &&
      message.author.id!==event.activityRequiredMentionUserId &&
      message.mentions.users.has(event.activityRequiredMentionUserId) &&
      new RegExp('<@!?'+event.activityRequiredMentionUserId+'>').test(message.content) &&
      /^<@!?\d+>$/.test(message.content.trim()));
    await Receipt.updateOne({_id:event._id+":"+message.id},{$setOnInsert:{
      event:event._id,user:message.author.id,day:currentActivityDay(time),matches:Boolean(matches),
      expires:new Date(+event.endsAt+90*24*hour),
    }},{upsert:true});
  }
}
export async function activityRoster(event,user) {
  const short=event.activityEndAt-event.activityStartAt<=24*hour;
  const rows=await Receipt.aggregate([
    {$match:{event:event._id,...(user?{user}:{})}},
    {$group:{_id:{user:"$user",day:short?{$literal:"window"}:"$day"},matches:{$sum:{$cond:["$matches",1,0]}}}},
    {$group:{_id:"$_id.user",messages:{$sum:"$matches"},days:{$sum:{$cond:[{$gte:["$matches",event.activityMinimum]},1,0]}}}},
    {$sort:{days:-1,messages:-1,_id:1}},
  ]);
  return rows.map(row=>({...row,qualified:qualifiesForGuidedActivity(row,event)}));
}

const btn=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
export async function ensureStaffCard(client,event) {
  if(event.staffCardId)return;
  const config=await GuildConfig.findOne({guildId:event.guildId}).lean();
  const channel=await client.channels.fetch(config?.activityGiveawayReviewChannelId);
  if(!channel?.send || channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
    throw Error("Set a staff-only activity_review channel.");
  const controls=[btn("activitystaff:view:"+event._id+":0","Preview qualifying members")];
  const series=await Series.findById(event.guidedSeries).lean();
  if(series?.enabled)controls.push(btn("activitystaff:pause:"+event._id,"Stop future repeats"));
  const marker="Activity staff preview · "+event._id;
  const recent=await channel.messages.fetch({limit:50});
  const existing=recent.find(m=>m.author.id===client.user.id && m.embeds.some(e=>e.footer?.text===marker));
  const message=existing || await channel.send({embeds:[{footer:{text:marker},description:'**'+event.title+'**\n'+event.prize.slice(0,800)+'\nStaff can check current activity here. Manual approval is '+(event.requireStaffReview?"on.":"off.")}],
    components:[new ActionRowBuilder().addComponents(controls)],allowedMentions:{parse:[]},
    nonce:event._id.toString(),enforceNonce:true});
  await Giveaway.updateOne({_id:event._id},{$set:{staffCardId:message.id,staffCardChannelId:channel.id}});
}
export async function staffPreview(i) {
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))return i.editReply("Only Manage Server staff can view activity.");
  const [,action,id,rawPage]=i.customId.split(":");
  const event=await Giveaway.findOne({_id:id,guildId:i.guildId,staffCardChannelId:i.channelId}).lean();
  if(!event)return i.editReply("This staff preview is unavailable.");
  if(action==="pause"){
    await Series.updateOne({_id:event.guidedSeries},{$set:{enabled:false,nextStart:null}});
    return i.editReply("Future repeats stopped. The current activity will finish as scheduled.");
  }
  const rows=await activityRoster(event);
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
