import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,ModalBuilder,
  TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {automaticRerollLimit,automaticRerollsUsed,winnerClaimDeadline} from "./giveaway-claims.js";
import {GuidedActivitySeries} from "./guided-activity.js";

const idText=id=>String(id||"");
const unix=date=>Math.floor(new Date(date).getTime()/1000);
const when=date=>date&&Number.isFinite(+new Date(date))?"<t:"+unix(date)+":F>":"Not recorded";
const safe=s=>String(s||"").replace(/@everyone|@here/g,"[mention]").slice(0,900);
const btn=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export const staffRecordMarker=record=>"Giveaway staff record · "+idText(record._id);

function claimStatus(record,slot){
 const id=record.winnerIds?.[slot];
 const claimed=record.winnerClaims?.find(c=>c.slot===slot&&c.userId===id);
 const deadline=winnerClaimDeadline(record,slot);
 const used=automaticRerollsUsed(record,slot),remaining=Math.max(0,automaticRerollLimit(record)-used);
 const rerolls=record.mode==="survival"?"Court's Trial: staff managed":
   record.autoRerollClaims?"Automatic rerolls left: **"+remaining+"** of "+automaticRerollLimit(record):
   "Automatic rerolls: **Disabled**";
 const title="**Place "+(slot+1)+"** · <@"+id+">";
 if(claimed)return [
   title+" — **Claim submitted** at "+when(claimed.submittedAt),
   "Ticket number: \`"+safe(claimed.ticketNumber).replace(/\`/g,"")+"\`",
   "Ticket message: <"+String(claimed.ticketUrl||"").replace(/[<>]/g,"")+">",
   rerolls
 ].join("\n");
 return [
   title+" — "+((record.claimResolvedSlots||[]).includes(slot)?"**Forfeited / no replacement**":"**Not claimed**"),
   "Claim deadline: "+(deadline?when(deadline)+" (<t:"+unix(deadline)+":R>)":"Not applicable"),
   rerolls
 ].join("\n");
}

export function giveawayStaffRecordPayload(record,{series=null}={}){
 const cancelled=record.status==="cancelled";
 const statuses={open:"Open",pending_review:"Awaiting staff approval",closing:"Selecting winners",
   ended:"Ended — claims being tracked",rerolling:"Replacing a winner",running:"Trial running",
   preparing:"Trial preparing",cancelled:"Cancelled · public post removed"};
 const lines=[
   "**"+safe(record.title||"Giveaway").slice(0,170)+"**",
   "**Type:** "+(record.mode==="survival"?"Court's Trial":record.mode==="activity"?"Activity giveaway":"Regular giveaway"),
   "**Prize:** "+safe(record.prize||"").slice(0,500),
   "**Host:** <@"+record.creatorId+">",
   "**Status:** "+(statuses[record.status]||record.status),
   "**Scheduled end:** "+when(record.endsAt),
   "**Giveaway ID:** \`"+record._id+"\`",
 ];
 if(cancelled){
   lines.push("","**CANCELLED AND REMOVED FROM PUBLIC VIEW**",
     "**Cancelled by:** "+(record.staffCancelledBy?"<@"+record.staffCancelledBy+">":"Not recorded"),
     "**Cancelled at:** "+when(record.staffCancelledAt||record.updatedAt),
     "**Reason:** "+safe(record.staffCancelReason||"Reason unavailable for older cancellation"));
 }else{
   if(record.status==="open")lines.push("**Entries:** "+(record.entrantIds?.length||0));
   if(record.winnerIds?.length){
     lines.push("","**Current winners and ticket claims**");
     for(let slot=0;slot<record.winnerIds.length;slot++)lines.push(claimStatus(record,slot));
   }else if(["ended","rerolling"].includes(record.status))
     lines.push("","**No eligible winners were selected.**");
   if(record.mode!=="survival")
     lines.push("","**Automatic rerolls:** "+(record.autoRerollClaims?"Enabled":"Disabled")+
       " · Maximum "+automaticRerollLimit(record)+" per winning place");
   if(record.rerollHistory?.length){
     lines.push("","**Reroll history**");
     for(const h of record.rerollHistory.slice(-12))
       lines.push("Place "+(h.slot+1)+" · <@"+h.previousId+"> → <@"+h.replacementId+">"+
         " · "+(h.reason==="claim-expired"?"Automatic": "Staff")+
         " · "+when(h.at));
   }
   if(record.staffEndedEarly)lines.push("**Ended early by:** <@"+record.staffEndedBy+">");
 }
 // Ticket message links are placed in dedicated fields so they are never
 // truncated when a giveaway has multiple winners or a long staff timeline.
 const claimFields=(record.winnerClaims||[]).slice(-20).map((claim,index)=>({
   name:"Ticket claim · Place "+(Number(claim.slot)+1)+(record.winnerIds?.[claim.slot]!==claim.userId?" · earlier winner":""),
   value:"**Winner:** <@"+claim.userId+">\n**Submitted:** "+when(claim.submittedAt)+
     "\n**Ticket:** \`"+safe(claim.ticketNumber).replace(/\`/g,"")+"\`"+
     "\n**Discord message:** <"+String(claim.ticketUrl||"").replace(/[<>]/g,"")+">",
   inline:false
 }));
 const controls=[];
 if(record.guidedSeries&&record.status!=="cancelled"){
   controls.push(btn("activitystaff:view:"+record._id+":0","Preview qualifying members"));
   if(record.status==="open"){
     controls.push(btn("activitystaff:edit:"+record._id,"Edit Giveaway",ButtonStyle.Primary));
     controls.push(btn("activitystaff:end:"+record._id,"End Early",ButtonStyle.Success));
   }
   if(series?.enabled)controls.push(btn("activitystaff:pause:"+record._id,"Stop future repeats"));
 }
 if(!cancelled){
   if(record.mode!=="survival"&&record.autoRerollClaims&&record.status==="ended")
     controls.push(btn("giveawaystaff:stop:"+record._id,"Disable Further Rerolls",ButtonStyle.Secondary));
   if(["open","pending_review","ended","running"].includes(record.status))
     controls.push(btn("giveawaystaff:cancel:"+record._id,"Cancel & Remove Giveaway",ButtonStyle.Danger));
 }
 const components=[];
 for(let i=0;i<controls.length;i+=5)
   components.push(new ActionRowBuilder().addComponents(controls.slice(i,i+5)));
 return {
  embeds:[new EmbedBuilder().setColor(cancelled?0x777777:0x896b88)
    .setTitle(cancelled?"📁 Cancelled giveaway · staff archive":"📋 Giveaway staff record")
    .setDescription(lines.join("\n").slice(0,4000))
    .addFields(claimFields)
    .setFooter({text:staffRecordMarker(record)})],
  components,allowedMentions:{parse:[]}
 };
}
export async function ensureGiveawayStaffRecord(client,record){
 if(!record||["draft","publishing","failed"].includes(record.status))return false;
 const config=await GuildConfig.findOne({guildId:record.guildId})
   .select("activityGiveawayReviewChannelId").lean();
 const channelId=config?.activityGiveawayReviewChannelId;
 if(!channelId)return false;
 const channel=await client.channels.fetch(channelId);
 if(!channel?.send||!channel.messages?.fetch)
   throw Error("The configured private giveaway staff channel cannot receive records.");
 if(channel.guild?.roles?.everyone &&
    channel.permissionsFor?.(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
   throw Error("The giveaway staff channel must not be accessible to @everyone.");
 const series=record.guidedSeries?await GuidedActivitySeries.findById(record.guidedSeries).lean():null;
 const payload=giveawayStaffRecordPayload(record,{series});
 let message=record.staffCardId&&record.staffCardChannelId===channelId?
   await channel.messages.fetch(record.staffCardId).catch(error=>{
     if(error.code===10008)return null;
     throw error;
   }):null;
 if(!message){
   const recent=await channel.messages.fetch({limit:100});
   message=recent.find(m=>m.author?.id===client.user?.id &&
     m.embeds?.some(e=>[staffRecordMarker(record),"Activity staff preview · "+record._id].includes(e.footer?.text)))||null;
 }
 if(message){
   if(message.author?.id!==client.user?.id)throw Error("Existing staff record belongs to another user.");
   const existing=message.embeds?.[0];
   const before=existing?.description||"";
   const after=payload.embeds[0].data.description;
   const oldButtons=(message.components||[]).flatMap(row=>row.components||[]).map(b=>b.customId||b.data?.custom_id).join("|");
   const oldFields=JSON.stringify(existing?.fields||[]);
   const newFields=JSON.stringify(payload.embeds[0].data.fields||[]);
   const newButtons=payload.components.flatMap(row=>row.components).map(b=>b.data.custom_id).join("|");
   if(before!==after||oldFields!==newFields||existing?.footer?.text!==staffRecordMarker(record)||oldButtons!==newButtons)
     await message.edit(payload);
 }else{
   message=await channel.send(payload);
 }
 if(record.staffCardId!==message.id||record.staffCardChannelId!==channelId)
   await Giveaway.updateOne({_id:record._id,guildId:record.guildId},
     {$set:{staffCardId:message.id,staffCardChannelId:channelId}});
 return true;
}
export async function reconcileGiveawayStaffRecords(client,{limit=50}={}){
 // Prioritize unposted records, including existing/ended giveaways. Keep audit records forever.
 const missing=await Giveaway.find({
   status:{$nin:["draft","publishing","failed"]},
   $or:[{staffCardId:""},{staffCardId:{$exists:false}},{staffCardChannelId:""}]
 }).sort({createdAt:-1}).limit(limit).lean();
 const active=await Giveaway.find({
   status:{$in:["open","closing","rerolling","pending_review","running","ended"]},
   staffCardId:{$ne:""},staffCardChannelId:{$ne:""}
 }).sort({updatedAt:-1}).limit(limit).lean();
 for(const record of [...new Map([...missing,...active].map(x=>[String(x._id),x])).values()]){
   try{await ensureGiveawayStaffRecord(client,record);}
   catch(error){console.error("[Giveaways] Staff record sync failed:",String(record._id),error);}
 }
  const cancelled=await Giveaway.find({status:"cancelled",
    $or:[{messageId:{$type:"string",$ne:""}},{listMessageId:{$type:"string",$ne:""}}]
  }).sort({updatedAt:-1}).limit(limit).lean();
  for(const record of cancelled){
    try{await ensureGiveawayStaffRecord(client,record);await removeGiveawayPublicPosts(client,record);}
    catch(error){console.error("[Giveaways] Cancelled public post cleanup failed:",record._id,error);}
  }
 return missing.length+active.length+cancelled.length;
}

export async function removeGiveawayPublicPosts(client,record){
 const targets=[
   [record.listChannelId,record.listMessageId],
   [record.channelId,record.messageId],
   ...(record.mode==="survival"?[[record.channelId,record.finaleMessageId]]:[])
 ];
 const unique=new Set();
 for(const [channelId,messageId] of targets){
   if(!channelId||!messageId)continue;
   const key=channelId+":"+messageId;
   if(unique.has(key))continue;unique.add(key);
   try{
     const channel=await client.channels.fetch(channelId);
     const msg=await channel?.messages?.fetch(messageId).catch(err=>{
       if(err.code===10008)return null;
       throw err;
     });
     if(msg?.author?.id===client.user?.id)await msg.delete();
   }catch(error){
     console.error("[Giveaways] Couldn't remove public cancelled post:",key,error);
     throw error;
   }
 }
 await Giveaway.updateOne({_id:record._id,status:"cancelled"},
   {$set:{listChannelId:"",listMessageId:"",listFingerprint:"",messageId:null,finaleMessageId:""}});
}
export async function handleGiveawayStaffAction(interaction){
 const ephemeral={flags:MessageFlags.Ephemeral};
 try{
   if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
     return interaction.reply({content:"Manage Server permission is required.",...ephemeral});
   const match=/^giveawaystaff:(stop|cancel|confirmcancel):([0-9a-f]{24})$/.exec(interaction.customId);
   if(!match)return interaction.reply({content:"Unknown staff action.",...ephemeral});
   const [,action,id]=match;
   const record=await Giveaway.findOne({_id:id,guildId:interaction.guildId,
     staffCardChannelId:interaction.channelId}).lean();
   if(!record)return interaction.reply({content:"This staff record was not found.",...ephemeral});
   if(action!=="confirmcancel" && record.staffCardId!==interaction.message?.id)
     return interaction.reply({content:"Use the current staff record for this giveaway.",...ephemeral});
   if(action==="cancel"){
     if(!["open","pending_review","ended","running"].includes(record.status))
       return interaction.reply({content:"This giveaway is not eligible for cancellation.",...ephemeral});
     return interaction.showModal(new ModalBuilder()
       .setCustomId("giveawaystaff:confirmcancel:"+id)
       .setTitle("Cancel and remove giveaway")
       .addComponents(
         new ActionRowBuilder().addComponents(new TextInputBuilder()
           .setCustomId("reason").setLabel("Why is this giveaway being cancelled?")
           .setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(500).setRequired(true)),
         new ActionRowBuilder().addComponents(new TextInputBuilder()
           .setCustomId("confirm").setLabel("Type CANCEL to confirm deletion")
           .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6))
       ));
   }
   await interaction.deferReply(ephemeral);
   if(action==="stop"){
     if(record.mode==="survival"||record.status!=="ended"||!record.autoRerollClaims)
       return interaction.editReply("Automatic claim rerolls are not active on this giveaway.");
     const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
       status:"ended",autoRerollClaims:true},
       {$set:{autoRerollClaims:false,claimCheckAt:null,renderedAt:null},$inc:{renderVersion:1}},
       {returnDocument:"after"}).lean();
     if(!updated)return interaction.editReply("Another staff member already changed this giveaway.");
     await ensureGiveawayStaffRecord(interaction.client,updated);
     return interaction.editReply("Further automatic claim rerolls have been disabled. Current submitted claims remain saved.");
   }
   if(interaction.fields.getTextInputValue("confirm").trim().toUpperCase()!=="CANCEL")
     return interaction.editReply("Cancellation not confirmed. Type CANCEL to proceed.");
   const reason=interaction.fields.getTextInputValue("reason").trim();
   if(reason.length<3)return interaction.editReply("A cancellation reason of at least three characters is required.");
   const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
     status:{$in:["open","pending_review","ended","running"]}},
     {$set:{status:"cancelled",staffCancelledBy:interaction.user.id,
       staffCancelledAt:new Date(),staffCancelReason:reason,
       autoRerollClaims:false,claimCheckAt:null,renderedAt:new Date()},
       $inc:{renderVersion:1}},{returnDocument:"after"}).lean();
   if(!updated)return interaction.editReply("This giveaway was already changed or cancelled.");
   // Record the reason and staff identity before removing anything public.
   await ensureGiveawayStaffRecord(interaction.client,updated);
   try{await removeGiveawayPublicPosts(interaction.client,updated);}
   catch(error){return interaction.editReply("Cancellation saved and recorded privately. The public post could not be removed; check bot permissions and retry cleanup.");}
   return interaction.editReply("Giveaway cancelled and removed from public listings. The staff record retains who cancelled it, when, and why.");
 }catch(error){
   console.error("[Giveaways] Staff record action failed:",error);
   const content="Couldn't complete that staff action: "+String(error.message||error).slice(0,350);
   if(interaction.replied||interaction.deferred)return interaction.editReply(content);
   return interaction.reply({content,...ephemeral});
 }
}
