import {createHash} from "node:crypto";
import {EmbedBuilder} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";

const MARKER="AM Isa · Active Giveaway Index";
const link=(guildId,channelId,messageId)=>`https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
const safe=value=>String(value||"Giveaway").replace(/[\r\n]+/g," ").replace(/[@`*_~|<>\[\]]/g,"").slice(0,90);
const time=date=>`<t:${Math.floor(new Date(date).getTime()/1000)}:R>`;
const row=(name,url,when)=>`• [${safe(name)}](${url})${when?" · "+time(when):""}`;

/** A pinned, single-message directory replaces /giveaway list.
 * It links to existing public announcements; it never makes new entry buttons.
 * Entries are resolved fresh from MongoDB so finished/paused events disappear.
 */
export function activeGiveawayIndexEmbed({standard=[],trials=[],plans=[],activities=[]}={}){
 const sections=[
   ["🎁 Regular giveaways",standard],
   ["✨ Activity giveaways", [...plans,...activities]],
   ["⚔️ Court's Trials",trials],
 ];
 const lines=["Choose a giveaway below to open its announcement.",""];
 let displayed=0;
 // Discord embeds allow 4096 description characters. Leave room for headings/footer
 // and signal truncation rather than posting a second unpinned directory.
 for(const [heading,items] of sections){
   if(!items.length)continue;
   const next=["**"+heading+"**"];
   for(const item of items){
     const entry=row(item.title,item.url,item.endsAt);
     if(lines.join("\n").length+next.join("\n").length+entry.length+120>3900)break;
     next.push(entry);displayed++;
   }
   if(next.length>1)lines.push(...next,"");
 }
 if(!displayed)lines.push("No giveaways are accepting entries right now.");
 const total=sections.reduce((n,[,items])=>n+items.length,0);
 if(displayed<total)lines.push(`*Showing ${displayed} of ${total} active giveaways.*`);
 return new EmbedBuilder().setColor(0xb47e99)
   .setTitle("✦ Current Giveaways")
   .setDescription(lines.join("\n").slice(0,4096))
   .setFooter({text:MARKER});
}

export async function activeGiveawayIndexData(guildId,now=new Date()){
 const [records,plans]=await Promise.all([
   Giveaway.find({guildId,status:{$in:["open","preparing","running"]},
     endsAt:{$gt:now},messageId:{$nin:["",null]}})
     .sort({endsAt:1}).limit(150).lean(),
   GiveawayPlan.find({guildId,status:"active",listMessageId:{$nin:["",null]}})
     .sort({nextRunAt:1}).limit(150).lean(),
 ]);
 const standard=[],trials=[],activities=[];
 for(const record of records){
   const item={title:record.title,url:link(guildId,record.channelId,record.messageId),endsAt:record.endsAt};
   if(record.mode==="survival"){
     // Court's Trials in progress have an expired signup time but remain live.
     trials.push(item);
   }else if(record.mode==="activity")activities.push(item);
   else standard.push(item);
 }
 // Include running trials even when signup deadline has passed.
 const running=await Giveaway.find({guildId,mode:"survival",status:"running",
   messageId:{$nin:["",null]}}).sort({endsAt:-1}).limit(50).lean();
 const seen=new Set(trials.map(t=>t.url));
 for(const item of running){
   const url=link(guildId,item.channelId,item.messageId);
   if(!seen.has(url)){trials.push({title:item.title,url});seen.add(url);}
 }
 const savedPlans=plans.filter(plan=>plan.listChannelId&&plan.listMessageId).map(plan=>({
   title:plan.title,url:link(guildId,plan.listChannelId,plan.listMessageId),endsAt:plan.nextRunAt,
 }));
 return {standard,trials,activities,plans:savedPlans};
}

export async function reconcileActiveGiveawayIndex(client,{guildId=null,now=new Date()}={}){
 const configs=await GuildConfig.find({
   ...(guildId?{guildId}:{}),activityGiveawayListChannelId:{$nin:["",null]},
 }).select("guildId activityGiveawayListChannelId giveawayIndexMessageId giveawayIndexChannelId giveawayIndexFingerprint giveawayEmbedColor").lean();
 for(const config of configs){
   try{
     const channel=await client.channels.fetch(config.activityGiveawayListChannelId);
     if(!channel?.send||!channel.messages?.fetch)continue;
     const data=await activeGiveawayIndexData(config.guildId,now);
     const embed=activeGiveawayIndexEmbed(data);
     if(/^#[0-9a-fA-F]{6}$/.test(config.giveawayEmbedColor||""))
       embed.setColor(parseInt(config.giveawayEmbedColor.slice(1),16));
     const fingerprint=createHash("sha256").update(JSON.stringify(embed.toJSON())).digest("hex");
     const stored=config.giveawayIndexChannelId===channel.id&&config.giveawayIndexMessageId;
     // No Discord read/edit when the directory is unchanged. This runs in the
     // existing giveaway sweep, but updates happen only after a real change.
     if(stored&&config.giveawayIndexFingerprint===fingerprint)continue;
     let message=stored?await channel.messages.fetch(config.giveawayIndexMessageId).catch(e=>{
       if(e.code===10008)return null;throw e;
     }):null;
     if(!message){
       const recent=await channel.messages.fetch({limit:100});
       message=recent.find(m=>m.author?.id===client.user?.id&&
         m.embeds?.some(e=>e.footer?.text===MARKER))||null;
     }
     if(message){
       if(message.author?.id!==client.user?.id)throw Error("Giveaway index belongs to another author.");
       await message.edit({embeds:[embed],allowedMentions:{parse:[]}});
     }else{
       message=await channel.send({embeds:[embed],allowedMentions:{parse:[]}});
     }
     // A pin is persistent and does not bump/repost the message. If Manage
     // Messages isn't granted, the index still works but cannot be pinned.
     if(!message.pinned&&message.pin){
       try{await message.pin();}catch(e){console.error("[Giveaways] Index pin needs Manage Messages:",e);}
     }
     await GuildConfig.updateOne({guildId:config.guildId},{$set:{
       giveawayIndexChannelId:channel.id,giveawayIndexMessageId:message.id,
       giveawayIndexFingerprint:fingerprint,
     }});
   }catch(e){console.error("[Giveaways] Giveaway index sync failed:",config.guildId,e);}
 }
 return configs.length;
}
