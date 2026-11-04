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
export function completedActivityWeek(date=new Date()) {
  const week=activityWeek(date);
  const d=new Date(week+"T12:00:00Z");
  d.setUTCDate(d.getUTCDate()-7);
  return d.toISOString().slice(0,10);
}
export async function recordGiveawayMessage(message) {
  if (!message.guildId || !message.author?.id || message.author.bot || message.webhookId ||
      !message.channelId || !message.channel?.isTextBased?.()) return;
  const date=message.createdAt || new Date();
  const day=easternDay(date).day;
  await GiveawayActivityCount.updateOne(
    {guildId:message.guildId,userId:message.author.id,channelId:message.channelId,day},
    {$inc:{count:1},$setOnInsert:{week:activityWeek(date)}},{upsert:true});
}
export async function qualifyingActivity({guildId,type,channelIds=[],minimum=1,days=1,week=completedActivityWeek()}) {
  const match={guildId,week,...(type==="channels"?{channelId:{$in:channelIds}}:{})};
  const rows=await GiveawayActivityCount.aggregate([
    {$match:match},
    {$group:{_id:{userId:"$userId",day:"$day"},messages:{$sum:"$count"}}},
    {$group:{_id:"$_id.userId",messages:{$sum:"$messages"},activeDays:{$sum:{$cond:[{$gte:["$messages",minimum]},1,0]}}}},
    {$match:{activeDays:{$gte:days}}},
  ]);
  return rows.map(r=>r._id);
}
