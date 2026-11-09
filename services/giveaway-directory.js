import {ensureStaffCard} from "./guided-activity.js";
import {createHash} from "node:crypto";
import {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import {attachGiveawayBanner,getGiveawayBanner,giveawayBannerBytes} from "./giveaway-banners.js";

const stamp=date=>Math.floor(new Date(date).getTime()/1000);
const clean=(value,max=500)=>String(value||"").replace(/[@`*_~|<>]/g,"").slice(0,max);
// Embed titles cannot resolve Discord mentions; put user-written titles in embed descriptions.
const displayTitle=value=>String(value||"Giveaway").replace(/[\r\n]+/g," ").slice(0,180);
const messageLink=(guildId,channelId,messageId)=>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

// The activity list is a public giveaway poster, not a debug/status report.
// Keep the host's title in the description so Discord user/channel mentions resolve.
const winnerLabel=count=>count===1?"1 winner":String(count)+" winners";
const shortRef=id=>"#"+String(id||"").slice(-8);
const humanRepeat=plan=>{
  const mode=plan.repeatMode || (plan.recurring?"weekly":"once");
  if(mode==="interval")return "Every "+(plan.intervalMinutes/60)+" hours";
  if(mode==="daily")return "Every day";
  if(mode==="weekly")return "Every week";
  return "";
};
const qualifyChannel=channels=>channels.length?channels.join(", "):"any eligible server channel";
const giveawayDetails=value=>value?["",String(value).slice(0,1000)]:[];
const memberSafeText=(value,max=180)=>String(value||"").replace(/[\r\n]+/g," ").slice(0,max);

export function activityPlanListingEmbed(plan,rule,{winnerChannelId=""}={}) {
  const period=plan.activityPeriod||"weekly";
  const minimum=plan.minimumTotalMessages??rule?.minimumTotalMessages??1;
  const channel=rule?.channelId?"<#"+rule.channelId+">":"any eligible server channel";
  const prize=plan.prizes?.[plan.nextPrizeIndex]||"Prize to be announced";
  const bonus=[...new Map([...(rule?.roleBonuses||[]),...(plan.roleBonuses||[])]
    .map(b=>[b.roleId,b])).values()];
  const qualifier=[
    "• Send **"+minimum+" qualifying "+(minimum===1?"message":"messages")+"** in "+channel+".",
  ];
  if(rule?.minimumChars>1)qualifier.push("• Each message must have at least **"+rule.minimumChars+" characters**.");
  if(rule?.minimumMessages>1)qualifier.push("• Send at least **"+rule.minimumMessages+" messages** on each qualifying day.");
  if(period==="weekly"&&rule?.activeDays>1)qualifier.push("• Be active on **"+rule.activeDays+" different days**.");
  if(rule?.requiredMentionUserId)qualifier.push("• Tag <@"+rule.requiredMentionUserId+">.");
  if(rule?.requiredPhrase)qualifier.push("• Include the exact phrase **"+memberSafeText(rule.requiredPhrase,120)+"**. **Spelling and word order must match; capitals do not matter.**");
  if(bonus.length)qualifier.push("• Bonus chances: "+
    bonus.map(b=>"<@&"+b.roleId+"> +"+b.extraEntries).join(", ")+".");
  const custom=plan.customActivityStartAt&&plan.customActivityEndAt;
  const activity=custom
    ? "From <t:"+stamp(plan.customActivityStartAt)+":f> until <t:"+stamp(plan.customActivityEndAt)+":f>"
    : period==="daily"?"Previous calendar day (Eastern)":"Previous Wednesday–Wednesday week (Eastern)";
  const repeat=humanRepeat(plan);
  const text=[
    "**"+displayTitle(plan.title)+"**",
    "",
    "🎁 **Prize**",
    String(prize).slice(0,650),
    ...giveawayDetails(plan.description),
    "",
    "✨ **How to qualify**",
    ...qualifier,
    "🗓️ **Activity period:** "+activity,
    "",
    "🏆 **"+winnerLabel(plan.winnerCount||1)+"** · Draws <t:"+stamp(plan.nextRunAt)+":F> (<t:"+stamp(plan.nextRunAt)+":R>)",
    ...(repeat?["🔁 **Repeats:** "+repeat]:[]),
    ...(winnerChannelId?["📣 **Winners announced in:** <#"+winnerChannelId+">"]:[]),
    ...(plan.requireStaffReview?["*Winners are confirmed after staff review.*"]:[]),
    "",
    "*Qualify automatically — no entry button needed.*",
  ].join("\n").slice(0,3900);
  return new EmbedBuilder().setColor(0xb47e99)
    .setTitle("🎁 Giveaway alert!")
    .setDescription(text)
    .setFooter({text:"✦ Automatic entry · "+shortRef(plan._id)});
}
export function activityOneOffListingEmbed(record) {
  const guided=Boolean(record.guidedSeries);
  const minimum=record.activityMinTotalMessages||record.activityMinimum||1;
  const channels=(record.activityChannelIds||[]).map(id=>"<#"+id+">");
  const qualifier=[
    "• Send **"+minimum+" matching "+(minimum===1?"message":"messages")+"** in "+
      qualifyChannel(channels)+" during this activity.",
  ];
  if(record.requiredRoleId)qualifier.push("• **Required role:** <@&"+record.requiredRoleId+">. "+
    (record.requiredRoleInstructions?"**Where to get it:** "+String(record.requiredRoleInstructions).slice(0,500):"Ask staff how to obtain this role."));
  if(record.activityMinChars>1)qualifier.push("• Each message must have at least **"+record.activityMinChars+" characters**.");
  if(!guided&&record.activityMinimum>1)
    qualifier.push("• At least **"+record.activityMinimum+" messages** on each qualifying day.");
  if(record.activityDays>1)qualifier.push("• Be active on **"+record.activityDays+" different days**.");
  if(record.activityRequiredMentionUserId)
    qualifier.push("• Tag <@"+record.activityRequiredMentionUserId+">.");
  if(record.activityRequiredPhrase)
    qualifier.push("• Include the exact phrase **"+memberSafeText(record.activityRequiredPhrase,120)+"**. **Spelling and word order must match; capitals do not matter.**");
  if(record.roleBonuses?.length)
    qualifier.push("• Bonus chances: "+record.roleBonuses.map(b=>"<@&"+b.roleId+"> +"+b.extraEntries).join(", ")+".");
  const start=record.activityStartAt||record.customActivityStartAt;
  const close=record.activityEndAt||record.customActivityEndAt;
  const draw=record.endsAt;
  const validStart=start&&Number.isFinite(new Date(start).getTime());
  const validClose=close&&Number.isFinite(new Date(close).getTime());
  const validDraw=draw&&Number.isFinite(new Date(draw).getTime());
  const sameTime=validClose&&validDraw&&+new Date(close)===+new Date(draw);
  const lines=[
    "**"+displayTitle(record.title)+"**",
    "",
    "🎁 **Prize**",
    String(record.prize||"Prize to be announced").slice(0,650),
    ...giveawayDetails(record.description),
    "",
    "✨ **How to qualify**",
    ...qualifier,
    "",
    ...(validStart&&validClose?[
      "🗓️ **Activity:** <t:"+stamp(start)+":f> – <t:"+stamp(close)+":f>",
    ]:[]),
    ...(sameTime?[
      "🏆 **"+winnerLabel(record.winnerCount||1)+"** · Ends and draws <t:"+stamp(draw)+":F> (<t:"+stamp(draw)+":R>)",
    ]:validDraw?[
      "🏆 **"+winnerLabel(record.winnerCount||1)+"** · Draws <t:"+stamp(draw)+":F> (<t:"+stamp(draw)+":R>)",
    ]:[]),
    ...(record.channelId?["📣 **Winners announced in:** <#"+record.channelId+">"]:[]),
    ...(record.requireStaffReview?["*Winners are confirmed after staff review.*"]:[]),
    "",
    "*Qualify automatically — no entry button needed.*",
  ];
  return new EmbedBuilder().setColor(0xb47e99)
    .setTitle("🎁 Giveaway alert!")
    .setDescription(lines.join("\n").slice(0,3900))
    .setFooter({text:"✦ Automatic entry · "+shortRef(record._id)});
}

// Footer carries only a short reference for members; the full identifier stays
// in the database and button custom ID. Reconciliation also recognizes legacy
// footers when recovering posts sent immediately before a crash.
function matchingFooter(kind,id){
  return shortRef(id);
}
function oldMatchingFooter(kind,id){
  return kind==="plan"?"Activity Giveaway Plan ID: "+id:"Activity Giveaway ID: "+id;
}

async function findListingMessage(channel,client,item,kind) {
  if(item.listChannelId===channel.id && item.listMessageId){
    const existing=await channel.messages.fetch(item.listMessageId).catch(error=>{
      if(error.code===10008)return null;
      throw error;
    });
    if(existing?.author?.id===client.user.id)return existing;
  }
  // A retry after a crash may have posted before the saved Mongo message ID.
  const recent=await channel.messages.fetch({limit:100});
  return recent.find(m=>m.author?.id===client.user.id &&
    m.embeds?.some(e=>e.footer?.text?.includes(matchingFooter(kind,item._id)) ||
      e.footer?.text?.includes(oldMatchingFooter(kind,item._id))))||null;
}
async function deleteListing(client,item,Model) {
  if(!item.listMessageId || !item.listChannelId)return false;
  const channel=await client.channels.fetch(item.listChannelId);
  if(channel?.messages?.fetch){
    const message=await channel.messages.fetch(item.listMessageId).catch(error=>{
      if(error.code===10008)return null;
      throw error;
    });
    if(message && message.author?.id===client.user.id)await message.delete();
  }
  await Model.updateOne({_id:item._id},
    {$set:{listChannelId:"",listMessageId:"",listFingerprint:""}});
  return true;
}
async function syncListing(client,item,kind,{now=new Date()}={}) {
  const isPlan=kind==="plan";
  const Model=isPlan?GiveawayPlan:Giveaway;
  const visible=isPlan?item.status==="active":
    item.mode==="activity"&&item.status==="open"&&new Date(item.endsAt)>now;
  if(!visible)return deleteListing(client,item,Model);
  const config=await GuildConfig.findOne({guildId:item.guildId})
    .select("activityGiveawayListChannelId activityGiveawayWinnersChannelId").lean();
  const channelId=config?.activityGiveawayListChannelId;
  if(!channelId)return false;
  if(!config?.activityGiveawayWinnersChannelId)return false;
  if(channelId===config.activityGiveawayWinnersChannelId)
    throw Error("Giveaway list and winners cannot share a channel.");
  const channel=await client.channels.fetch(channelId);
  if(!channel?.send || !channel.messages?.fetch)throw Error("Activity giveaway directory channel is inaccessible.");
  const rule=isPlan && item.watchNameKey!=="general"
    ?await GiveawayWatchRule.findOne({guildId:item.guildId,nameKey:item.watchNameKey}).lean()
    :null;
  const banner=await getGiveawayBanner(item.guildId,item.bannerNameKey);
  const embed=isPlan ? activityPlanListingEmbed(item,rule,{
    winnerChannelId:config.activityGiveawayWinnersChannelId,
  }) : activityOneOffListingEmbed(item);
  const payload=attachGiveawayBanner({embeds:[embed],allowedMentions:{parse:[]},attachments:[]},banner);
  if(item.progressEnabled && (isPlan||item.status==="open")){
    payload.components=[new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`activity-progress:${isPlan?"plan":"event"}:${item._id}`)
        .setLabel("Check My Progress").setStyle(ButtonStyle.Primary),
    )];
  }
  const fingerprint=createHash("sha256").update(JSON.stringify({
    embed:embed.toJSON(),bannerNameKey:banner?.nameKey||"",bannerUpdatedAt:banner?.updatedAt||null,
    imageBytes:giveawayBannerBytes(banner)?.length||0,channelId,progressEnabled:item.progressEnabled||false,
  })).digest("hex");
  const existing=await findListingMessage(channel,client,item,kind);
  if(!existing) {
    // Notify each chosen role only on the initial post; updates never repeat pings.
    const roles=[...new Set(item.notificationRoleIds||[])].slice(0,10);
    if(roles.length){
      payload.content=roles.map(id=>"<@&"+id+">").join(" ");
      payload.allowedMentions={parse:[],roles};
    }
    const message=await channel.send(payload);
    await Model.updateOne({_id:item._id},{$set:{
      listMessageId:message.id,listChannelId:channel.id,listFingerprint:fingerprint,
    }});
  }else {
    if(item.listChannelId!==channel.id || item.listFingerprint!==fingerprint)
      await existing.edit(payload);
    if(item.listChannelId!==channel.id || item.listMessageId!==existing.id ||
        item.listFingerprint!==fingerprint)
      await Model.updateOne({_id:item._id},{$set:{
        listMessageId:existing.id,listChannelId:channel.id,listFingerprint:fingerprint,
      }});
  }
  if(item.listChannelId && item.listChannelId!==channel.id && item.listMessageId){
    // Directory moved: remove the old promotional post, never the actual result.
    try {
      const oldChannel=await client.channels.fetch(item.listChannelId);
      const oldPost=await oldChannel?.messages?.fetch(item.listMessageId).catch(()=>null);
      if(oldPost?.author?.id===client.user.id)await oldPost.delete();
    }catch(error){console.error("[Giveaways] Old directory post cleanup failed:",error);}
  }
  return true;
}
export async function publishActivityPlanListing(client,plan,{now=new Date()}={}) {
  return syncListing(client,plan,"plan",{now});
}
export async function publishActivityOneOffListing(client,record,{now=new Date()}={}) {
  return syncListing(client,record,"one-off",{now});
}
export async function reconcileActivityGiveawayListings(client,{now=new Date(),limit=0,guildId=null}={}) {
  const [plans,oneOff]=await Promise.all([
    GiveawayPlan.find({...(guildId?{guildId}:{}),$or:[{status:"active"},{listMessageId:{$gt:""}}]}).limit(limit).lean(),
    Giveaway.find({...(guildId?{guildId}:{}),mode:"activity",scheduleId:null,
      $or:[{status:"open"},{listMessageId:{$gt:""}}]}).limit(limit).lean(),
  ]);
  for(const plan of plans) {
    try {await publishActivityPlanListing(client,plan,{now});}
    catch(error){console.error("[Giveaways] Activity plan directory sync failed:",plan.name,error);}
  }
  for(const record of oneOff){
    try{
      const publishers=[publishActivityOneOffListing(client,record,{now})];
      if(record.guidedSeries)publishers.push(ensureStaffCard(client,record));
      for(const result of await Promise.allSettled(publishers))
        if(result.status==="rejected")console.error("[Giveaways] Activity channel post failed:",record._id,result.reason);
    }
    catch(error){console.error("[Giveaways] One-time activity directory sync failed:",String(record._id),error);}
  }
  return plans.length+oneOff.length;
}
