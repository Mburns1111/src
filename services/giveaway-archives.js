import {giveawayArchiveOutcome} from "./giveaway-claims.js";
import {AttachmentBuilder,EmbedBuilder,PermissionFlagsBits} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {activityProgressRows,progressPanelPayload} from "./giveaway-staff-progress.js";

export function giveawayReadyToArchive(record){
 return Boolean(giveawayArchiveOutcome(record));
}
const asDate=date=>date?new Date(date):new Date();
const marker=record=>"Archived giveaway activity · "+record._id;
const archiveNote=(record,at)=>[
  "**Archived at:** <t:"+Math.floor(+at/1000)+":F>",
  "**Outcome:** "+giveawayArchiveOutcome(record),
  ...(record.prizeDeliveredBy?["**Delivery confirmed by:** <@"+record.prizeDeliveredBy+">"]:[]),
  ...(record.prizeDeliveryProofUrl?["**Proof:** <"+record.prizeDeliveryProofUrl+">"]:[]),
  ...(record.staffCancelledBy?["**Cancelled by:** <@"+record.staffCancelledBy+">"]:[]),
  ...(record.archiveRequestedBy?["**Archive approved by:** <@"+record.archiveRequestedBy+">"]:[]),
  ...(record.archiveRequestedReason?["**Archive reason:** "+record.archiveRequestedReason.slice(0,450)]:[]),
  "**Original giveaway ID:** `"+record._id+"`",
].join("\n");

async function verifiedPrivateChannel(client,channelId){
 const channel=await client.channels.fetch(channelId);
 if(!channel?.send||!channel.messages?.fetch)throw Error("Giveaway archive channel is unavailable.");
 if(channel.guild?.roles?.everyone &&
    channel.permissionsFor?.(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
   throw Error("Giveaway archive channel must be hidden from @everyone.");
 const botMember=channel.guild?.members?.me;
 const perms=botMember?channel.permissionsFor?.(botMember):null;
 if(perms && [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,
   PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.AttachFiles,
   PermissionFlagsBits.ReadMessageHistory].some(p=>!perms.has(p)))
   throw Error("The bot needs View Channel, Send Messages, Embed Links, Attach Files and Read Message History in giveaway Archives.");
 return channel;
}
async function findOwnedMessage(channel,id,client,footer){
 let message=id?await channel.messages.fetch(id).catch(e=>{
   if(e.code===10008)return null;throw e;
 }):null;
 if(!message){
   const recent=await channel.messages.fetch({limit:100});
   message=recent.find(m=>m.author?.id===client.user?.id &&
     m.embeds?.some(e=>e.footer?.text===footer))||null;
 }
 if(message&&(message.author?.id!==client.user?.id||
   !message.embeds?.some(embed=>embed.footer?.text===footer)))
   throw Error("Archive message identity mismatch; refusing to treat an unrelated post as the saved giveaway record.");
 return message;
}
async function deleteOldMessage(client,channelId,id,archiveChannelId,record,{progress=false}={}){
 if(!channelId||!id||channelId===archiveChannelId)return;
 const channel=await client.channels.fetch(channelId).catch(error=>{
   if(error.code===10003)return null;
   throw error;
 });
 if(!channel)return;
 if(!channel.messages?.fetch)throw Error("Cannot read the original staff channel for archive cleanup.");
 const message=await channel.messages.fetch(id).catch(e=>{
   if(e.code===10008)return null;throw e;
 });
 if(!message)return;
 const expected=progress?
   ["Activity staff progress · "+record._id]:
   ["Giveaway staff record · "+record._id,"Activity staff preview · "+record._id];
 if(message.author?.id!==client.user?.id||
    !message.embeds?.some(embed=>expected.includes(embed.footer?.text)))
   throw Error("Active staff post identity mismatch; refusing to delete an unrelated Discord message.");
 await message.delete();
}

/** Make independent archive copies before deleting any active staff messages.
 * The raw saved giveaway snapshot preserves entrants, claims, rerolls, settings
 * and moderation history. Archival is restart-safe using stored message IDs.
 */
const transfers=new Map();
/** Coalesce overlapping scheduler and moderator archive requests. */
export async function archiveGiveawayStaffRecord(client,record,options={}){
 const id=String(record?._id||"");
 if(transfers.has(id))return transfers.get(id);
 const work=performArchiveTransfer(client,record,options);
 transfers.set(id,work);
 try{return await work;}finally{transfers.delete(id);}
}
async function performArchiveTransfer(client,record,{staffPayload}={}){
 if(!giveawayReadyToArchive(record))return false;
 const config=await GuildConfig.findOne({guildId:record.guildId})
   .select("giveawayArchiveChannelId activityGiveawayReviewChannelId").lean();
 if(!config?.giveawayArchiveChannelId)return false;
 if(config.giveawayArchiveChannelId===config.activityGiveawayReviewChannelId)
   throw Error("Giveaway Archives and active staff channel must be different.");
 const channel=await verifiedPrivateChannel(client,config.giveawayArchiveChannelId);
 const at=asDate(record.archivedAt||record.archiveRequestedAt);
 const oldCardChannel=record.staffCardChannelId||config.activityGiveawayReviewChannelId;
 const oldCardId=record.staffCardId;
 const oldProgressId=record.staffProgressMessageId;
 const mainMarker="Giveaway archive · "+record._id;

 let snapshotRows=null;
 let archive=await findOwnedMessage(channel,record.archiveCardId,client,mainMarker);
 if(!archive){
   if(!staffPayload)throw Error("A saved staff record is required to archive a giveaway.");
   if(record.mode==="activity"){
     // Do not remove the active record if the final activity counts cannot be read.
     snapshotRows=await activityProgressRows(record,null,{historical:true});
   }
   const snapshot={archivedAt:at.toISOString(),giveaway:record,
     activityProgress:snapshotRows||[]};
   const bytes=Buffer.from(JSON.stringify(snapshot,null,2));
   // Discord permits file uploads up to at least 8 MB. Keep the full original
   // Mongo document intact even when a larger roster cannot fit in one file.
   if(bytes.length>7_500_000)throw Error("Giveaway archive record exceeds the safe attachment limit.");
   const embeds=staffPayload.embeds.map(embed=>EmbedBuilder.from(embed));
   embeds[0].addFields({name:"Archive details",value:archiveNote(record,at).slice(0,1024)});
   embeds[0].setTitle("📁 Archived giveaway · complete staff record");
   embeds[0].setFooter({text:mainMarker});
   archive=await channel.send({embeds,files:[new AttachmentBuilder(bytes,{
     name:"giveaway-"+record._id+"-archive.json",
   })],allowedMentions:{parse:[]},components:[]});
   await Giveaway.updateOne({_id:record._id,guildId:record.guildId},
     {$set:{archiveCardId:archive.id,archivedAt:at,
       archiveReason:record.archiveRequestedReason||"Approved staff archive",
       archivedBy:record.archiveRequestedBy||"system"}});
 }

 let archiveProgressId=record.archiveProgressMessageId||"";
 if(record.mode==="activity"){
   let progress=await findOwnedMessage(channel,archiveProgressId,client,marker(record));
   if(!progress){
     let summary=null;
     if(!snapshotRows){
       snapshotRows=await activityProgressRows(record,null,{historical:true});
     }
     if(snapshotRows)summary=progressPanelPayload(record,snapshotRows,at).embeds[0];
     if(!summary && oldProgressId && oldCardChannel){
       const source=await client.channels.fetch(oldCardChannel).catch(()=>null);
       const old=await source?.messages?.fetch(oldProgressId).catch(()=>null);
       if(old?.author?.id===client.user?.id&&old.embeds?.length)
         summary=EmbedBuilder.from(old.embeds[0]);
     }
     if(!summary)summary=progressPanelPayload(record,[],at).embeds[0];
     summary.setTitle("📁 Archived member activity · final snapshot")
       .setFooter({text:marker(record)});
     progress=await channel.send({embeds:[summary],allowedMentions:{parse:[]},components:[]});
   }
   archiveProgressId=progress.id;
   if(record.archiveProgressMessageId!==progress.id)
     await Giveaway.updateOne({_id:record._id,guildId:record.guildId},
       {$set:{archiveProgressMessageId:progress.id}});
 }
 // Both archive messages are safely saved before active staff posts are removed.
 await Giveaway.updateOne({_id:record._id,guildId:record.guildId},
   {$set:{archivedAt:at,archiveCardId:archive.id,
     archiveProgressMessageId:archiveProgressId}});
 await deleteOldMessage(client,oldCardChannel,oldProgressId,channel.id,record,{progress:true});
 await deleteOldMessage(client,oldCardChannel,oldCardId,channel.id,record);
 await Giveaway.updateOne({_id:record._id,guildId:record.guildId},
   {$set:{archiveMovedAt:new Date()}});
 return true;
}
