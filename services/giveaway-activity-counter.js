import {eligibleActivityParticipant} from "./activity-participation.js";
import GiveawayActivityCount from "../models/GiveawayActivityCount.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import GiveawayActivityRuleCount from "../models/GiveawayActivityRuleCount.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";

const formatter = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"});
function easternDay(date) {
  const p=Object.fromEntries(formatter.formatToParts(date).map(x=>[x.type,x.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,weekday:p.weekday};
}
export function activityWeek(date=new Date()) {
  const {day,weekday}=easternDay(date);
  const shift=({Sun:4,Mon:5,Tue:6,Wed:0,Thu:1,Fri:2,Sat:3})[weekday];
  const midnight=new Date(day+"T12:00:00Z");
  midnight.setUTCDate(midnight.getUTCDate()-shift);
  return midnight.toISOString().slice(0,10);
}
export function currentActivityDay(date=new Date()) { return easternDay(date).day; }
export function previousActivityDay(date=new Date()) {
  const {day}=easternDay(date);
  const noon=new Date(day+"T12:00:00Z");
  noon.setUTCDate(noon.getUTCDate()-1);
  return noon.toISOString().slice(0,10);
}
export function completedActivityWeek(date=new Date()) {
  const week=activityWeek(date);
  const d=new Date(week+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()-7);
  return d.toISOString().slice(0,10);
}
export function messageCharacterCount(message) {
  const content=String(message?.content || "").trim();
  // A command is not an answer to QOTD or a community conversation.
  if (!content || /^[/.]/.test(content)) return 0;
  return Math.min(2000, [...content].length);
}
// Discord's explicit user-mention markup identifies actual @member tags.
const TAG=/\u003c@!?\d{17,20}\u003e/g;
export function giveawayMessageText(message) {
  return String(message?.content || "").replace(TAG," ").replace(/\s+/g," ").trim();
}
export function messageMatchesGiveawayWatch(message,rule) {
  if (!message?.guildId || !message?.author?.id || message.author.bot || message.webhookId)
    return false;
  const mentionId=String(rule?.requiredMentionUserId || "");
  if(mentionId) {
    if (!/^\d{17,20}$/.test(mentionId) || message.author.id===mentionId)
      return false; // No self-mentions and no invalid target.
    const raw=String(message.content||"");
    if (!raw.includes(`<@${mentionId}>`) && !raw.includes(`<@!${mentionId}>`))
      return false; // Replies, display names and role pings are not explicit member tags.
    if (message.mentions?.users?.has && !message.mentions.users.has(mentionId))
      return false;
  }
  const phrase=String(rule?.requiredPhrase||"").trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
  const text=giveawayMessageText(message);
  // An explicit member ping is itself a qualifying message when no other text
  // is required. The ping is stripped before the ordinary character count.
  if (!text) return Boolean(mentionId) && !phrase && (rule?.minimumChars??1)<=1;
  if (/^[/.]/.test(text)) return false;
  if(phrase) {
    // Exact spelling and word order, case-insensitive. Substrings of longer
    // words and misspellings must not qualify.
    const literal=phrase.replace(/[.*+?^$()|[\]\\]/g, char=>"\\"+char);
    const exactPhrase=new RegExp("(^|[^\\p{L}\\p{N}_])"+literal+"(?=$|[^\\p{L}\\p{N}_])","u");
    if(!exactPhrase.test(text.toLocaleLowerCase("en-US")))return false;
  }
  return [...text].length >= (rule?.minimumChars??1);
}
export async function recordGiveawayMessage(message) {
  if (!message.guildId || !message.author?.id || message.author.bot || message.webhookId ||
      !message.channelId || !message.channel?.isTextBased?.()) return;
  // Legacy watches must also respect the explicit opt-in before writing.
  if(!await eligibleActivityParticipant(message))return;
  const length=messageCharacterCount(message);
  if (!length) return;
  const date=message.createdAt || new Date();
  const day=easternDay(date).day;
  const week=activityWeek(date);
  const minute=new Date(Math.floor(date.getTime()/60000)*60000);
  await GiveawayActivityMinuteCount.updateOne(
    {guildId:message.guildId,userId:message.author.id,channelId:message.channelId,minute},
    {$inc:{count:1,[`lengths.${length}`]:1},$setOnInsert:{day}},{upsert:true});
  await GiveawayActivityCount.updateOne(
    {guildId:message.guildId,userId:message.author.id,channelId:message.channelId,day},
    {$inc:{count:1,[`lengths.${length}`]:1},$setOnInsert:{week}},{upsert:true});
  // Only targeted/phrase rules need content-aware matching. Ordinary message
  // rules continue using the existing length histogram, with no extra writes.
  const rules=await GiveawayWatchRule.find({
    guildId:message.guildId,channelId:message.channelId,
    $or:[{requiredMentionUserId:{$type:"string",$ne:""}},
      {requiredPhrase:{$type:"string",$ne:""}}],
  }).lean();
  await Promise.all(rules.filter(rule=>messageMatchesGiveawayWatch(message,rule)).map(async rule=>{
    const id={guildId:message.guildId,ruleId:rule._id,criteriaVersion:rule.criteriaVersion||0,
      userId:message.author.id};
    await Promise.all([
      GiveawayActivityRuleCount.updateOne({...id,day},
        {$inc:{count:1},$setOnInsert:{week}},{upsert:true}),
      GiveawayActivityRuleMinuteCount.updateOne({...id,minute},
        {$inc:{count:1},$setOnInsert:{day}},{upsert:true}),
    ]);
  }));
}
export function qualifyingActivityPipeline({guildId,type,channelIds=[],minimum=1,days=1,minimumChars=0,
  minimumTotalMessages=0,week=completedActivityWeek(),day=null,startAt=null,endAt=null,userId=null}) {
  if (!["channels","general"].includes(type)) throw Error("Invalid activity scope.");
  if (type==="channels" && !channelIds.length) throw Error("Choose a watched channel.");
  if (!Number.isInteger(minimumChars) || minimumChars < 0 || minimumChars > 2000) throw Error("Character count must be 0–2000.");
  if(day!==null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Invalid activity day.");
  if(day!==null && days!==1) throw Error("Daily activity can require only one active day.");
  const custom=startAt!==null && endAt!==null;
  if((startAt!==null)!==(endAt!==null))throw Error("A custom activity window needs both endpoints.");
  if(custom && new Date(startAt)>=new Date(endAt))throw Error("Activity end must be after start.");
  const match={guildId,...(custom?{minute:{$gte:new Date(startAt),$lt:new Date(endAt)}}:day!==null?{day}:{week}),
    ...(userId?{userId}:{}),
    ...(type==="channels"?{channelId:{$in:channelIds}}:{})};
  const messages=minimumChars===0 ? "$count" : {
    $sum:{$map:{
      input:{$filter:{
        input:{$objectToArray:{$ifNull:["$lengths",{}]}},
        as:"bucket",cond:{$gte:[{$toInt:"$$bucket.k"},minimumChars]},
      }},
      as:"bucket",in:"$$bucket.v",
    }},
  };
  return [
    {$match:match},
    {$project:{userId:1,day:1,messages}},
    {$group:{_id:{userId:"$userId",day:"$day"},messages:{$sum:"$messages"}}},
    {$group:{_id:"$_id.userId",totalMessages:{$sum:"$messages"},
      activeDays:{$sum:{$cond:[{$gte:["$messages",minimum]},1,0]}}}},
    {$match:{activeDays:{$gte:days},
      ...(minimumTotalMessages>0?{totalMessages:{$gte:minimumTotalMessages}}:{})}},
  ];
}
export async function qualifyingActivity(options) {
  const Model=options.startAt&&options.endAt?GiveawayActivityMinuteCount:GiveawayActivityCount;
  const rows=await Model.aggregate(qualifyingActivityPipeline(options));
  return rows.map(r=>r._id);
}

/** Aggregate only messages matching a saved member-mention / phrase challenge.
 * The daily and weekly scopes use the same boundaries as regular activity. */
export function qualifyingWatchRulePipeline({guildId,rule,day=null,week=completedActivityWeek(),
    minimum=rule.minimumMessages||1,days=rule.activeDays||1,
    minimumTotalMessages=rule.minimumTotalMessages||0,startAt=null,endAt=null,userId=null}) {
  if(day!==null && days!==1) throw Error("Daily watches require a single active day.");
  if((startAt!==null)!==(endAt!==null))throw Error("A custom watch window needs both endpoints.");
  const match={guildId,ruleId:rule._id,criteriaVersion:rule.criteriaVersion||0,
    ...(userId?{userId}:{}),
    ...(startAt!==null?{minute:{$gte:new Date(startAt),$lt:new Date(endAt)}}:day!==null?{day}:{week})};
  return [
    {$match:match},
    {$group:{_id:{userId:"$userId",day:"$day"},messages:{$sum:"$count"}}},
    {$group:{_id:"$_id.userId",totalMessages:{$sum:"$messages"},
      activeDays:{$sum:{$cond:[{$gte:["$messages",minimum]},1,0]}}}},
    {$match:{activeDays:{$gte:days},
      ...(minimumTotalMessages>0?{totalMessages:{$gte:minimumTotalMessages}}:{})}},
  ];
}
export async function qualifyingWatchActivity({guildId,rule,period="weekly",
    key,minimum=rule.minimumMessages||1,days=rule.activeDays||1,
    minimumChars=rule.minimumChars??1,minimumTotalMessages=rule.minimumTotalMessages||0,
    startAt=null,endAt=null,userId=null}) {
  const custom=startAt!==null&&endAt!==null;
  const window=custom?{startAt,endAt}:(period==="daily"?{day:key}:{week:key});
  const params={guildId,type:"channels",channelIds:[rule.channelId],
    minimum,days,minimumChars,minimumTotalMessages,userId,...window};
  if(!rule.requiredMentionUserId && !rule.requiredPhrase)
    return qualifyingActivity(params);
  const model=custom?GiveawayActivityRuleMinuteCount:GiveawayActivityRuleCount;
  const rows=await model.aggregate(qualifyingWatchRulePipeline({
    guildId,rule,minimum,days,minimumTotalMessages,userId,...window,
  }));
  return rows.map(row=>row._id);
}

/** Member-only progress without exposing anyone else's counts or any message text. */
export async function memberActivityProgress({guildId,userId,rule=null,type="general",
  channelIds=[],minimum=1,days=1,minimumChars=1,minimumTotalMessages=1,
  period="daily",key,startAt=null,endAt=null}) {
  const window=startAt&&endAt?{startAt,endAt}:(period==="daily"?{day:key}:{week:key});
  const watched=rule&&Boolean(rule.requiredMentionUserId||rule.requiredPhrase);
  const pipeline=watched?qualifyingWatchRulePipeline({
    guildId,rule,minimum,days,minimumTotalMessages,userId,...window,
  }):qualifyingActivityPipeline({guildId,userId,
    type:rule?"channels":type,channelIds:rule?[rule.channelId]:channelIds,
    minimum,days,minimumChars,minimumTotalMessages,...window});
  // Remove the qualifying threshold to return partial progress for every member.
  pipeline.pop();
  const Model=watched?(startAt&&endAt?GiveawayActivityRuleMinuteCount:GiveawayActivityRuleCount):
    (startAt&&endAt?GiveawayActivityMinuteCount:GiveawayActivityCount);
  const [progress]=await Model.aggregate(pipeline);
  return {messages:progress?.totalMessages||0,activeDays:progress?.activeDays||0,
    target:minimumTotalMessages,requiredDays:days,
    qualified:(progress?.totalMessages||0)>=minimumTotalMessages &&
      (progress?.activeDays||0)>=days};
}

/** Number of distinct members who posted in the checked scope, before staff
 * requirements. Count summaries only; no message bodies are loaded. */
export async function countActivityParticipants({guildId,type="general",channelIds=[],
  period="weekly",key=null,startAt=null,endAt=null}){
  const custom=startAt!==null && endAt!==null;
  const window=custom?{minute:{$gte:new Date(startAt),$lt:new Date(endAt)}}:
    period==="daily"?{day:key}:{week:key};
  const match={guildId,...window,
    ...(type==="channels"?{channelId:{$in:channelIds}}:{})};
  const model=custom?GiveawayActivityMinuteCount:GiveawayActivityCount;
  const ids=await model.distinct("userId",match);
  return ids.length;
}
