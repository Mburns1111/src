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

export function activityPlanListingEmbed(plan,rule,{winnerChannelId=""}={}) {
  const period=plan.activityPeriod||"weekly";
  const minimum=plan.minimumTotalMessages??rule?.minimumTotalMessages??1;
  const activityChannel=rule?.channelId?`<#${rule.channelId}>`:"Eligible server text channels";
  const instruction=[
    `**Watch:** ${activityChannel}`,
    `**Activity window:** ${period==="daily"?"Previous full calendar day (Eastern)":"Previous Wednesday–Wednesday week (Eastern)"}`,
    `**Requirement:** ${minimum} qualifying message${minimum===1?"":"s"} total`,
    `**Message length:** ${rule?.minimumChars??1}+ characters`,
  ];
  if(rule?.minimumMessages>1)instruction.push(`**Messages per active day:** ${rule.minimumMessages}`);
  if(period==="weekly" && rule?.activeDays>1)instruction.push(`**Different active days:** ${rule.activeDays}`);
  if(rule?.requiredMentionUserId)instruction.push(`**Must tag:** <@${rule.requiredMentionUserId}>`);
  if(rule?.requiredPhrase)instruction.push(`**Must include:** ${clean(rule.requiredPhrase,120)}`);
  const prize=plan.prizes?.[plan.nextPrizeIndex]||"Prize to be announced";
  const bonuses=[...new Map([...(rule?.roleBonuses||[]),...(plan.roleBonuses||[])].map(b=>[b.roleId,b])).values()];
  const custom=plan.customActivityStartAt&&plan.customActivityEndAt;
  if(custom){
    instruction[1]=`**Activity window:** <t:${stamp(plan.customActivityStartAt)}:F> to <t:${stamp(plan.customActivityEndAt)}:F>`;
  }
  if(bonuses.length)instruction.push("**Bonus drawing chances:** "+
    bonuses.map(b=>`<@&${b.roleId}> +${b.extraEntries}`).join(", ")+" (add together; unique winner)");
  if(plan.requireStaffReview)instruction.push("**Winner publication:** After staff approval");
  const description=[
    `**${displayTitle(plan.title)}**`,"",
    `**Prize:** ${clean(prize,600)}`,"",
    ...(plan.description?["**Giveaway Details:**",String(plan.description).slice(0,1000),""]:[]),
    ...instruction,"",
    `**Winner announcement:** <t:${stamp(plan.nextRunAt)}:F> (<t:${stamp(plan.nextRunAt)}:R>)`,
    `**Winners:** ${plan.winnerCount||1}`,
    ...(winnerChannelId?[`**Results will be posted in:** <#${winnerChannelId}>`]:[]),
    `**Repeats:** ${plan.repeatMode==="interval"?`Every ${plan.intervalMinutes/60} hours`:plan.repeatMode==="daily"?"Daily":plan.repeatMode==="weekly"||(!plan.repeatMode&&plan.recurring)?"Weekly":"One time"}`,
    "", "*Qualifying messages are tracked automatically. No entry button is needed.*",
  ].join("\n").slice(0,3900);
  return new EmbedBuilder().setColor(0xb47e99)
    .setTitle("🎁 Activity Giveaway")
    .setDescription(description)
    .setFooter({text:`Activity Giveaway Plan ID: ${plan._id}`});
}
export function activityOneOffListingEmbed(record) {
  const daily=record.activityPeriod==="daily";
  const channels=(record.activityChannelIds||[]).map(id=>`<#${id}>`);
  const parts=[
    `**${displayTitle(record.title)}**`,"",
    `**Prize:** ${clean(record.prize,650)}`,"",
    `**Watch:** ${channels.length?channels.join(", "):"Eligible server text channels"}`,
    `**Activity period:** ${daily?"Previous full Eastern calendar day":"Previous Wednesday–Wednesday week"}`,
    `**Requirement:** ${record.activityMinTotalMessages||1} qualifying message(s) total`,
    `**Length:** ${record.activityMinChars||1}+ characters`,
  ];
  if(record.guidedSeries) {
    parts[4]=`**To qualify:** Send ${record.activityMinTotalMessages||record.activityMinimum} matching message(s) total during this activity.`;
    if(record.activityDays>1)parts.push(`**Different active days:** At least one matching message on ${record.activityDays} days`);
  }
  if(!record.guidedSeries && record.activityMinimum>1)parts.push(`**Per active day:** ${record.activityMinimum} message(s)`);
  if(!record.guidedSeries && record.activityDays>1)parts.push(`**Active days required:** ${record.activityDays}`);
  if(record.activityRequiredMentionUserId)parts.push(`**Must tag:** <@${record.activityRequiredMentionUserId}>`);
  if(record.activityRequiredPhrase)parts.push(`**Must include:** ${clean(record.activityRequiredPhrase,120)}`);
  if(record.customActivityStartAt&&record.customActivityEndAt)
    parts[3]=`**Activity window:** <t:${stamp(record.customActivityStartAt)}:F> to <t:${stamp(record.customActivityEndAt)}:F>`;
  if(record.description)parts.splice(2,0,"**Giveaway Details:**",String(record.description).slice(0,1000),"");
  if(record.roleBonuses?.length)
    parts.push("**Bonus chances:** "+record.roleBonuses.map(b=>`<@&${b.roleId}> +${b.extraEntries}`).join(", "));
  if(record.requireStaffReview)parts.push("**Winner publication:** After staff approval");
  parts.push("",`**Winner announcement:** <t:${stamp(record.endsAt)}:F> (<t:${stamp(record.endsAt)}:R>)`,
    `**Winners:** ${record.winnerCount||1}`,`**Results will be posted in:** <#${record.channelId}>`,"",
    "*This giveaway has automatic, locked entries. No entry button is needed.*");
  return new EmbedBuilder().setColor(0xb47e99)
    .setTitle("🎁 Activity Giveaway")
    .setDescription(parts.join("\n").slice(0,3900))
    .setFooter({text:`Activity Giveaway ID: ${record._id}`});
}

function matchingFooter(kind,id){
  return kind==="plan"?`Activity Giveaway Plan ID: ${id}`:`Activity Giveaway ID: ${id}`;
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
    m.embeds?.some(e=>e.footer?.text?.includes(matchingFooter(kind,item._id))))||null;
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
      if(record.guidedSeries && !record.staffCardId)publishers.push(ensureStaffCard(client,record));
      for(const result of await Promise.allSettled(publishers))
        if(result.status==="rejected")console.error("[Giveaways] Activity channel post failed:",record._id,result.reason);
    }
    catch(error){console.error("[Giveaways] One-time activity directory sync failed:",String(record._id),error);}
  }
  return plans.length+oneOff.length;
}
