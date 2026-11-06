import GiveawayActivityCount from "../models/GiveawayActivityCount.js";

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
export async function recordGiveawayMessage(message) {
  if (!message.guildId || !message.author?.id || message.author.bot || message.webhookId ||
      !message.channelId || !message.channel?.isTextBased?.()) return;
  const length=messageCharacterCount(message);
  if (!length) return;
  const date=message.createdAt || new Date();
  const day=easternDay(date).day;
  await GiveawayActivityCount.updateOne(
    {guildId:message.guildId,userId:message.author.id,channelId:message.channelId,day},
    {$inc:{count:1,[`lengths.${length}`]:1},$setOnInsert:{week:activityWeek(date)}},{upsert:true});
}
export function qualifyingActivityPipeline({guildId,type,channelIds=[],minimum=1,days=1,minimumChars=0,week=completedActivityWeek(),day=null}) {
  if (!["channels","general"].includes(type)) throw Error("Invalid activity scope.");
  if (type==="channels" && !channelIds.length) throw Error("Choose a watched channel.");
  if (!Number.isInteger(minimumChars) || minimumChars < 0 || minimumChars > 2000) throw Error("Character count must be 0–2000.");
  if(day!==null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Invalid activity day.");
  if(day!==null && days!==1) throw Error("Daily activity can require only one active day.");
  const match={guildId,...(day!==null?{day}:{week}),...(type==="channels"?{channelId:{$in:channelIds}}:{})};
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
    {$group:{_id:"$_id.userId",activeDays:{$sum:{$cond:[{$gte:["$messages",minimum]},1,0]}}}},
    {$match:{activeDays:{$gte:days}}},
  ];
}
export async function qualifyingActivity(options) {
  const rows=await GiveawayActivityCount.aggregate(qualifyingActivityPipeline(options));
  return rows.map(r=>r._id);
}
