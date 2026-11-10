import {createHash} from "node:crypto";
import {EmbedBuilder} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {winnerHasClaim} from "./giveaway-claims.js";

const MARKER="AM Isa · Active Giveaway Index";
const LEGACY_MARKER="AM Isa · Active Giveaway Index";
const link=(guildId,channelId,messageId)=>`https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
const safe=value=>String(value||"Giveaway").replace(/[\r\n]+/g," ").replace(/[@`*_~|<>\[\]]/g,"").slice(0,90);
const relative=date=>date&&Number.isFinite(+new Date(date))?`<t:${Math.floor(+new Date(date)/1000)}:R>`:"";
const hasPublicPost=record=>Boolean(record.channelId&&record.messageId);
const hasOutstandingClaims=record=>
  (record.winnerIds||[]).some((_,slot)=>!winnerHasClaim(record,slot)&&
    !(record.claimResolvedSlots||[]).includes(slot));
const claimOrActivityStatus=record=>{
  if(record.status==="ended" || record.status==="rerolling")
    return hasOutstandingClaims(record)?"Waiting for winner claim":"Claim submitted — staff follow-up";
  if(record.status==="pending_review")return "Awaiting staff approval";
  if(record.status==="closing")return "Drawing winners";
  if(record.status==="running")return "Trial in progress";
  if(record.status==="preparing")return "Trial preparing";
  return "Open for entries";
};
const typeName=record=>record.mode==="survival"?"Court's Trial":
  record.mode==="activity"?"Activity":"Regular";

export const GIVEAWAY_INDEX_STICKY_INTERVAL_MS=60*60*1000;

/** Staff-only sticky directory with all actionable drawings and schedules.
 * Settled records remain in their individual permanent staff messages.
 */
export function activeGiveawayIndexEmbed({records=[],plans=[]}={}){
 const candidates=[
   ...records.map(record=>({
     name:record.title,type:typeName(record),status:claimOrActivityStatus(record),
     url:link(record.guildId,record.channelId,record.messageId),
     until:record.status==="open"?record.endsAt:null,
     staffUrl:record.staffCardChannelId&&record.staffCardId?
       link(record.guildId,record.staffCardChannelId,record.staffCardId):"",
   })),
   ...plans.map(plan=>({
     name:plan.title,type:"Activity schedule",status:"Ongoing schedule",
     url:link(plan.guildId,plan.listChannelId,plan.listMessageId),
     until:plan.nextRunAt,
   })),
 ];
 const lines=[`**${candidates.length} active or pending giveaways / schedules**`,""];
 let displayed=0;
 for(const item of candidates){
   const entry=`${displayed+1}. **${safe(item.name)}** · ${item.type}\n🟨 ${item.status}${item.until?" · "+relative(item.until):""}${item.staffUrl?" · [Open staff record]("+item.staffUrl+")":""} · [Public post](${item.url})`;
   if(lines.join("\n").length+entry.length+225>3890)break;
   lines.push(entry);displayed++;
 }
 if(!displayed)lines.push("No active giveaways, outstanding winner claims, or ongoing schedules.");
 if(displayed<candidates.length)lines.push(`*Showing ${displayed} of ${candidates.length} records.*`);
 lines.push("","*Includes active giveaways, pending claims, and ongoing schedules. Settled and archived giveaways stay in their private staff records.*");
 return new EmbedBuilder().setColor(0x896b88)
   .setTitle("📌 Active Giveaway Directory · Staff")
   .setDescription(lines.join("\n").slice(0,4096))
   .setFooter({text:MARKER});
}

export async function activeGiveawayIndexData(guildId,now=new Date()){
 const [all,plans]=await Promise.all([
   Giveaway.find({guildId,status:{$in:[
     "open","preparing","running","closing","pending_review","rerolling","ended",
   ]}}).sort({createdAt:-1}).limit(400).lean(),
   GiveawayPlan.find({guildId,status:"active"}).sort({nextRunAt:1}).limit(150).lean(),
 ]);
 const records=all.filter(record=>{
   if(!hasPublicPost(record)||!["open","preparing","running","closing","pending_review","rerolling","ended"].includes(record.status))return false;
   if(record.status==="ended" || record.status==="rerolling")
     return (record.winnerIds||[]).some((_,slot)=>
       !(record.claimResolvedSlots||[]).includes(slot));
   return true;
 });
 return {records,plans:plans.filter(plan=>plan.listChannelId&&plan.listMessageId)};
}

async function fetchStored(channel,id){
 return channel.messages.fetch(id).catch(error=>{
   if(error.code===10008)return null;
   throw error;
 });
}
async function removeWrongChannelIndex(client,config,targetChannelId){
 const oldChannelId=config.giveawayIndexChannelId;
 const oldMessageId=config.giveawayIndexMessageId;
 if(!oldChannelId||!oldMessageId||oldChannelId===targetChannelId)return;
 const oldChannel=await client.channels.fetch(oldChannelId).catch(()=>null);
 if(!oldChannel?.messages?.fetch)return;
 const previous=await fetchStored(oldChannel,oldMessageId);
 if(!previous||previous.author?.id!==client.user?.id||
   !previous.embeds?.some(e=>e.footer?.text===LEGACY_MARKER))return;
 try{await previous.delete();}
 catch(error){console.error("[Giveaways] Could not remove old public index:",error);}
}

/** Edit for meaningful content changes; check the last message only hourly.
 * A new position is achieved by sending a replacement then deleting the old
 * bot-owned index, never pinning or moving anyone else's message.
 */
export async function reconcileActiveGiveawayIndex(client,{guildId=null,now=new Date()}={}){
 const configs=await GuildConfig.find({
   ...(guildId?{guildId}:{}),activityGiveawayReviewChannelId:{$nin:["",null]},
 }).select("guildId activityGiveawayReviewChannelId giveawayIndexMessageId giveawayIndexChannelId giveawayIndexFingerprint giveawayIndexCheckedAt").lean();
 for(const config of configs){
   try{
     const targetId=config.activityGiveawayReviewChannelId;
     const channel=await client.channels.fetch(targetId);
     if(!channel?.send||!channel.messages?.fetch)continue;
     // Remove only our old index, not the individual public giveaway listings.
     await removeWrongChannelIndex(client,config,targetId);
     const embed=activeGiveawayIndexEmbed(await activeGiveawayIndexData(config.guildId,now));
     const payload={embeds:[embed],allowedMentions:{parse:[]}};
     const fingerprint=createHash("sha256").update(JSON.stringify(embed.toJSON())).digest("hex");
     const stored=config.giveawayIndexChannelId===channel.id&&config.giveawayIndexMessageId;
     const changed=!stored||config.giveawayIndexFingerprint!==fingerprint;
     const lastCheck=+new Date(config.giveawayIndexCheckedAt||0);
     const checkPosition=!stored||!Number.isFinite(lastCheck)||
       now.getTime()-lastCheck>=GIVEAWAY_INDEX_STICKY_INTERVAL_MS;
     if(!changed&&!checkPosition)continue;
     let message=stored?await fetchStored(channel,config.giveawayIndexMessageId):null;
     if(!message){
       const recent=await channel.messages.fetch({limit:100});
       message=recent.find(m=>m.author?.id===client.user?.id&&
         m.embeds?.some(e=>e.footer?.text===MARKER))||null;
     }
     if(message&&message.author?.id!==client.user?.id)
       throw Error("Giveaway staff index belongs to another author.");
     let lastId=null;
     if(checkPosition){
       const latest=await channel.messages.fetch({limit:1});
       lastId=latest.first?.()?.id||latest.values?.().next().value?.id||null;
     }
     const displaced=Boolean(message&&checkPosition&&lastId&&lastId!==message.id);
     if(!message||displaced){
       const replacement=await channel.send(payload);
       await GuildConfig.updateOne({guildId:config.guildId},{$set:{
         giveawayIndexChannelId:channel.id,giveawayIndexMessageId:replacement.id,
         giveawayIndexFingerprint:fingerprint,giveawayIndexCheckedAt:now,
       }});
       if(message){
         try{await message.delete();}
         catch(error){console.error("[Giveaways] Could not remove superseded staff index:",error);}
       }
     }else{
       if(changed)await message.edit(payload);
       if(message.pinned&&message.unpin){
         try{await message.unpin();}catch(error){
           console.error("[Giveaways] Could not unpin legacy staff index:",error);
         }
       }
       await GuildConfig.updateOne({guildId:config.guildId},{$set:{
         giveawayIndexChannelId:channel.id,giveawayIndexMessageId:message.id,
         giveawayIndexFingerprint:fingerprint,
         ...(checkPosition?{giveawayIndexCheckedAt:now}:{}),
       }});
     }
   }catch(error){console.error("[Giveaways] Staff sticky directory sync failed:",config.guildId,error);}
 }
 return configs.length;
}
