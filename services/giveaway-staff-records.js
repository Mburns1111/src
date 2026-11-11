import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,ModalBuilder,
  TextInputBuilder,TextInputStyle,MessageFlags,PermissionFlagsBits,StringSelectMenuBuilder} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {automaticRerollLimit,automaticRerollsUsed,winnerClaimDeadline,winnerHasClaim,hasOutstandingTicketClaims,giveawayHasNoEligibleWinner} from "./giveaway-claims.js";
import {completedGiveawayCanDeleteListing} from "./giveaway-listing-lifecycle.js";
import {GuidedActivitySeries} from "./guided-activity.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "./giveaway-manager-permissions.js";
import {closeGiveaway,rerollGiveaway,publishGiveawayResult} from "./giveaways.js";
import {beginSurvivalTrial,publishSurvivalAnnouncement} from "./survival-giveaways.js";
import {ensureBannerRegistered} from "./giveaway-banners.js";
import {maxRegularGiveawayMinutes} from "./giveaways.js";
import {giveawayStaffEditableFields,giveawayStaffEditMenuOptions,
  giveawayStaffEditModal,validateGiveawayStaffEdit} from "./giveaway-staff-edit.js";

const idText=id=>String(id||"");
const unix=date=>Math.floor(new Date(date).getTime()/1000);
const when=date=>date&&Number.isFinite(+new Date(date))?"<t:"+unix(date)+":F>":"Not recorded";
const safe=s=>String(s||"").replace(/@everyone|@here/g,"[mention]").slice(0,900);
const btn=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export const staffRecordMarker=record=>"Giveaway staff record · "+idText(record._id);

export const STAFF_ENTRANTS_PER_PAGE=25;
export function giveawayStaffEntrantsPage(record,page=0){
  if(!Number.isSafeInteger(page)||page<0)throw Error("Invalid entrant page.");
  const entrants=[...new Set((record.entrantIds||[]).filter(Boolean).map(String))];
  const totalPages=Math.max(1,Math.ceil(entrants.length/STAFF_ENTRANTS_PER_PAGE));
  if(page>=totalPages)throw Error("That entrant page is no longer available.");
  const first=page*STAFF_ENTRANTS_PER_PAGE;
  const rows=entrants.slice(first,first+STAFF_ENTRANTS_PER_PAGE)
    .map((id,i)=>(first+i+1)+". <@"+id+"> (\`"+id+"\`)");
  const title=record.mode==="survival"?"Court's Trial contestants":
    record.mode==="activity"?"Activity giveaway entrants":"Regular giveaway entrants";
  const note=record.mode==="activity"&&record.status==="open"
    ?"Activity entries are computed when counting ends. Use **Preview qualifying members** on the staff record to see current progress."
    :"";
  const content=[
    "**"+title+" — "+safe(record.title||"Giveaway").slice(0,120)+"**",
    "**Total:** "+entrants.length+" · **Page:** "+(page+1)+"/"+totalPages+
      " · **Status:** "+record.status,
    "",
    ...(rows.length?rows:["No members have entered or been selected as entrants."]),
    ...(note?["",note]:[]),
  ].join("\n").slice(0,1900);
  const controls=[];
  if(page>0)controls.push(btn("giveawaystaff:entrants:"+record._id+":"+(page-1),"Previous"));
  if(page+1<totalPages)controls.push(btn("giveawaystaff:entrants:"+record._id+":"+(page+1),"Next"));
  return {
    content,components:controls.length?
      [new ActionRowBuilder().addComponents(controls)]:[],
    allowedMentions:{parse:[]},
  };
}

// Staff records are scannable from the embed title, status line and border.
// Priority matters: a publicly removed/archived listing is always GRAY,
// regardless of whether its previous state was pending, claimed or no-winner.
export function giveawayStaffStatusMarker(record){
  if(record.publicListingRemovedAt||record.status==="cancelled"){
    const cancelled=record.status==="cancelled";
    if(cancelled)return {text:"⬜ **CANCELLED — PUBLIC LISTING REMOVED** ⬜",
      title:"⬜ CANCELLED · Giveaway staff archive",color:0x777777};
    return record.mode==="survival"
      ? {text:"⬜ **COURT'S TRIAL ARCHIVED — ROYAL VERDICT PRESERVED** ⬜",
         title:"⬜ ARCHIVED TRIAL · Giveaway staff record",color:0x777777}
      : {text:"⬜ **COMPLETED — PUBLIC LISTING DELETED** ⬜",
         title:"⬜ ARCHIVED · Giveaway staff record",color:0x777777};
  }
  if(["open","preparing","running","pending_review","closing"].includes(record.status))
    return {text:"🟦 **GIVEAWAY IN PROGRESS** 🟦",title:"🟦 IN PROGRESS · Giveaway staff record",color:0x3498DB};
  if(!["ended","rerolling"].includes(record.status))return null;
  if(giveawayHasNoEligibleWinner(record))
    return {text:"🟥 **ENDED — NO ELIGIBLE WINNER** 🟥",title:"🟥 NO ELIGIBLE WINNER · Giveaway staff record",color:0xE74C3C};
  if(record.mode==="survival"&&!record.trialTicketClaimsEnabled)
    return {text:"🟨 **ENDED — STAFF PRIZE FOLLOW-UP REQUIRED** 🟨",title:"🟨 STAFF CLAIM FOLLOW-UP · Giveaway staff record",color:0xF1C40F};
  if(hasOutstandingTicketClaims(record)||record.status==="rerolling")
    return {text:"🟨 **WINNER CLAIM PENDING** 🟨",title:"🟨 CLAIM PENDING · Giveaway staff record",color:0xF1C40F};
  if((record.winnerIds||[]).some((id,slot)=>id&&winnerHasClaim(record,slot)))
    return {text:"🟩 **CLAIM COMPLETED** 🟩",title:"🟩 CLAIM COMPLETED · Giveaway staff record",color:0x2ECC71};
  return null;
}


function claimStatus(record,slot,{now=new Date()}={}){
 const id=record.winnerIds?.[slot];
 const claimed=record.winnerClaims?.find(c=>c.slot===slot&&c.userId===id);
 const resolved=(record.claimResolvedSlots||[]).includes(slot);
 const deadline=winnerClaimDeadline(record,slot);
 const title="**Place "+(slot+1)+"** · <@"+id+">";
 // Ticket number, message link and submission time are shown below once in
 // dedicated private claim fields. Do not repeat them in the main body.
 if(claimed)return title+" — ✅ **Claim submitted**";
 if(resolved)return title+" — **No eligible winner — forfeited / no replacement**\nClaim deadline: **Expired**";
 return [title+" — **Not claimed**",
   "Claim deadline: "+(deadline?
     deadline<=now?"**Expired**":when(deadline)+" (<t:"+unix(deadline)+":R>)":"Not applicable"),
 ].join("\n");
}

export function giveawayStaffRecordPayload(record,{series=null,archived=false}={}){
 const cancelled=record.status==="cancelled";
 const completedAndRemoved=record.status==="ended"&&Boolean(record.publicListingRemovedAt);
 const statusMarker=giveawayStaffStatusMarker(record);
 const statuses={open:"Open",pending_review:"Awaiting staff approval",closing:"Selecting winners",
   ended:"Ended — claims being tracked",rerolling:"Replacing a winner",running:"Trial running",
   preparing:"Trial preparing",cancelled:"Cancelled · public post removed"};
 const lines=[
   ...(statusMarker?[statusMarker.text,""]:[]),
   "**"+safe(record.title||"Giveaway").slice(0,170)+"**",
   "**Type:** "+(record.mode==="survival"?"Court's Trial":record.mode==="activity"?"Activity giveaway":"Regular giveaway"),
   "**Prize:** "+safe(record.prize||"").slice(0,500),
   "**Host:** <@"+record.creatorId+">",
   "**Status:** "+(completedAndRemoved?(record.mode==="survival"?"Trial archived — Royal Verdict preserved":"Completed — public listing deleted"):statuses[record.status]||record.status),
   "**Scheduled end:** "+when(record.endsAt),
   "**Giveaway ID:** \`"+record._id+"\`",
 ];
 if(completedAndRemoved){
   const trialArchived=record.mode==="survival";
   lines.push("",trialArchived?"**COURT'S TRIAL ARCHIVED — ROYAL VERDICT PRESERVED**":"**COMPLETED — PUBLIC LISTING DELETED**",
     (trialArchived?"**Archived by:** ":"**Deleted by:** ")+(record.publicListingRemovedBy?"<@"+record.publicListingRemovedBy+">":"Not recorded"),
     (trialArchived?"**Archived at:** ":"**Deleted at:** ")+when(record.publicListingRemovedAt),
     trialArchived
       ? "*Trial signups are closed. The Royal Verdict remains public and the staff record retains the full prize history.*"
       : "*The giveaway ended normally. Winners, claims and results remain in the staff archive; it was not cancelled.*");
 }
 if(cancelled){
   lines.push("","**CANCELLED AND REMOVED FROM PUBLIC VIEW**",
     "**Cancelled by:** "+(record.staffCancelledBy?"<@"+record.staffCancelledBy+">":"Not recorded"),
     "**Cancelled at:** "+when(record.staffCancelledAt||record.updatedAt),
     "**Reason:** "+safe(record.staffCancelReason||"Reason unavailable for older cancellation"));
 }else{
   if(record.status==="open")lines.push("**Entries:** "+(record.entrantIds?.length||0));
   if(giveawayHasNoEligibleWinner(record))
     lines.push("","🏁 **Final outcome: No eligible winner.**",
       (record.winnerIds||[]).length
         ? "*The claim window expired and no eligible replacement remained.*"
         : "*No eligible members entered or qualified.*",
       completedAndRemoved
         ? "*The public listing was deleted by staff; this private record preserves the outcome.*"
         : "*The public result remains visible until staff explicitly use Delete Listing.*");
   if(record.winnerIds?.length){
     lines.push("",record.mode==="survival"&&!record.trialTicketClaimsEnabled?"**Court\'s Trial winners — staff-managed prize claims**":"**Current winners and ticket claims**");
     for(let slot=0;slot<record.winnerIds.length;slot++)
       lines.push(record.mode==="survival"&&!record.trialTicketClaimsEnabled?"**Place "+(slot+1)+"** · <@"+record.winnerIds[slot]+"> — delivery coordinated by staff":claimStatus(record,slot));
   }
   if(record.mode!=="survival"||record.trialTicketClaimsEnabled)
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
   if(record.status==="ended"&&!completedAndRemoved&&record.winnerIds?.length&&
      !completedGiveawayCanDeleteListing(record))
     lines.push("**Delete Listing:** Available when every current winner has submitted a ticket claim, or each remaining unclaimed prize place is past its deadline with no rerolls left.");
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
 controls.push(btn("giveawaystaff:entrants:"+record._id+":0",
   record.mode==="survival"?"View Contestants":"View Entrants",ButtonStyle.Primary));
 if(record.guidedSeries&&record.status!=="cancelled"){
   controls.push(btn("activitystaff:view:"+record._id+":0","Preview qualifying members"));
   if(record.status==="open"){
     controls.push(btn("activitystaff:edit:"+record._id,"Edit Giveaway",ButtonStyle.Primary));
     controls.push(btn("activitystaff:end:"+record._id,"End Early",ButtonStyle.Success));
   }
   if(series?.enabled)controls.push(btn("activitystaff:pause:"+record._id,"Stop future repeats"));
 }
 if(!cancelled&&!completedAndRemoved){
   if(record.status==="open"&&!record.guidedSeries){
     controls.push(btn("giveawaystaff:edit:"+record._id,"Edit Giveaway",ButtonStyle.Primary));
     controls.push(btn("giveawaystaff:end:"+record._id,
       record.mode==="survival"?"Start Trial Early":"End Early",ButtonStyle.Success));
   }else if(record.mode==="survival"&&record.status==="running"){
     controls.push(btn("giveawaystaff:end:"+record._id,"Finish Trial Early",ButtonStyle.Success));
   }
   if(record.status==="ended"){
     if(completedGiveawayCanDeleteListing(record))
       controls.push(btn("giveawaystaff:remove:"+record._id,"Archive Giveaway",ButtonStyle.Secondary));
     if(hasOutstandingTicketClaims(record))
       controls.push(btn("giveawaystaff:reroll:"+record._id,"Manual Reroll",ButtonStyle.Primary));
     if(!completedGiveawayCanDeleteListing(record)&&
       (record.mode!=="survival"||record.trialTicketClaimsEnabled)&&record.autoRerollClaims)
       controls.push(btn("giveawaystaff:stop:"+record._id,"Disable Further Rerolls",ButtonStyle.Secondary));
   }else if(["open","pending_review","running"].includes(record.status))
     controls.push(btn("giveawaystaff:cancel:"+record._id,"Cancel & Remove Giveaway",ButtonStyle.Danger));
 }
 if(!archived && (cancelled || completedAndRemoved))
   controls.push(btn("giveawaystaff:remove:"+record._id,"Move to Archive",ButtonStyle.Secondary));
 const components=[];
 for(let i=0;i<controls.length;i+=5)
   components.push(new ActionRowBuilder().addComponents(controls.slice(i,i+5)));
 return {
  embeds:[new EmbedBuilder().setColor(statusMarker?.color??(cancelled?0x777777:0x896b88))
    .setTitle(statusMarker?.title||(cancelled?"📁 Cancelled giveaway · staff archive":"📋 Giveaway staff record"))
    .setDescription(lines.join("\n").slice(0,4000))
    .addFields(claimFields)
    .setFooter({text:staffRecordMarker(record)})],
  components,allowedMentions:{parse:[]}
 };
}
export async function requirePrivateGiveawayStaffChannel(guild,config){
  const channelId=config?.activityGiveawayReviewChannelId;
  if(!channelId)throw Error("Configure a private staff giveaway channel with /setup giveaways or /setup activity-giveaways before posting giveaways.");
  const channel=await guild.channels.fetch(channelId).catch(()=>null);
  if(!channel?.send||!channel?.messages?.fetch)
    throw Error("The private giveaway staff channel is missing or the bot cannot send there.");
  if(channel.permissionsFor?.(guild.roles?.everyone)?.has(PermissionFlagsBits.ViewChannel))
    throw Error("The giveaway staff channel must be hidden from @everyone.");
  const permissions=channel.permissionsFor?.(guild.members?.me);
  for(const perm of [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]){
    if(permissions&&!permissions.has(perm))
      throw Error("The bot needs View Channel, Send Messages and Embed Links permissions in the private staff channel.");
  }
  return channel;
}
export async function ensureGiveawayStaffRecord(client,record){
 if(!record||["draft","publishing","failed"].includes(record.status))return false;
 const config=await GuildConfig.findOne({guildId:record.guildId})
   .select("activityGiveawayReviewChannelId giveawayArchiveChannelId").lean();
 const settled=Boolean(record.publicListingRemovedAt)||record.status==="cancelled";
 const archiveId=config?.giveawayArchiveChannelId;
 const channelId=settled&&archiveId?archiveId:config?.activityGiveawayReviewChannelId;
 const isArchive=Boolean(settled&&archiveId);
 const oldChannelId=record.staffCardChannelId;
 const oldMessageId=record.staffCardId;
 if(!channelId)return false;
 const channel=await client.channels.fetch(channelId);
 if(!channel?.send||!channel.messages?.fetch)
   throw Error("The configured private giveaway staff channel cannot receive records.");
 if(channel.guild?.roles?.everyone &&
    channel.permissionsFor?.(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
   throw Error("The giveaway staff channel must not be accessible to @everyone.");
 const series=record.guidedSeries?await GuidedActivitySeries.findById(record.guidedSeries).lean():null;
 const payload=giveawayStaffRecordPayload(record,{series,archived:isArchive});
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
   if(before!==after||oldFields!==newFields||existing?.title!==payload.embeds[0].data.title||
      existing?.color!==payload.embeds[0].data.color||
      existing?.footer?.text!==staffRecordMarker(record)||oldButtons!==newButtons)
     await message.edit(payload);
 }else{
   message=await channel.send(payload);
 }
 if(record.staffCardId!==message.id||record.staffCardChannelId!==channelId)
   await Giveaway.updateOne({_id:record._id,guildId:record.guildId},
     {$set:{staffCardId:message.id,staffCardChannelId:channelId}});
 // Move only after the archive post is saved and its ID persisted.
 // Never delete a record we did not author; a failed deletion can be retried.
 if(isArchive&&oldMessageId&&oldChannelId&&
    (oldMessageId!==message.id||oldChannelId!==channelId)){
   try{
     const previousChannel=await client.channels.fetch(oldChannelId);
     const previous=await previousChannel?.messages?.fetch(oldMessageId).catch(error=>{
       if(error.code===10008)return null;
       throw error;
     });
     if(previous&&previous.author?.id===client.user?.id)await previous.delete();
   }catch(error){console.warn("[Giveaways] Archive created but old staff card cleanup failed:",String(record._id),error);}
 }
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
 const archives=await Giveaway.find({
   $or:[{status:"cancelled"},{status:"ended",publicListingRemovedAt:{$ne:null}}],
 }).sort({updatedAt:-1}).limit(limit).lean();
 for(const record of [...new Map([...missing,...active,...archives].map(x=>[String(x._id),x])).values()]){
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
 const removed=await Giveaway.find({status:"ended",publicListingRemovedAt:{$ne:null},
   // The separate activity winner announcement and Trial finale are preserved
   // on completed listings, so they must not cause perpetual cleanup retries.
   $or:[{listMessageId:{$type:"string",$ne:""}},
     {mode:{$in:["standard","survival"]},messageId:{$type:"string",$ne:""}}]
 }).sort({updatedAt:-1}).limit(limit).lean();
 for(const record of removed){
   try{await removeGiveawayPublicPosts(client,record);}
   catch(error){console.error("[Giveaways] Completed listing cleanup failed:",record._id,error);}
 }
 return missing.length+active.length+cancelled.length+removed.length;
}

export async function removeGiveawayPublicPosts(client,record){
 if(record.status!=="cancelled"&&!(record.status==="ended"&&record.publicListingRemovedAt))
   throw Error("Public posts can only be removed after a cancellation or authorized completed-listing deletion.");
 const completed=record.status==="ended";
 const targets=[
   [record.listChannelId,record.listMessageId],
   // Activity winners are announced in a different channel; that result
   // message is not an activity-list entry. Preserve it when completed.
   ...(!completed||record.mode!=="activity"?[[record.channelId,record.messageId]]:[]),
   // The Court's Trial Royal Verdict is a separate result announcement and
   // must remain accessible after its signup listing has been removed.
   ...(!completed&&record.mode==="survival"?[[record.channelId,record.finaleMessageId]]:[])
 ];
 const unique=new Set();
 for(const [channelId,messageId] of targets){
   if(!channelId||!messageId)continue;
   const key=channelId+":"+messageId;
   if(unique.has(key))continue;unique.add(key);
   try{
     const channel=await client.channels.fetch(channelId);
     if(!channel?.messages?.fetch)throw Error("The public giveaway channel could not be accessed.");
     const msg=await channel.messages.fetch(messageId).catch(err=>{
       if(err.code===10008)return null;
       throw err;
     });
     if(msg&&msg.author?.id!==client.user?.id)
       throw Error("The public giveaway post belongs to another user or bot.");
     if(msg)await msg.delete();
   }catch(error){
     console.error("[Giveaways] Couldn't remove public post:",key,error);
     throw error;
   }
 }
 await Giveaway.updateOne({_id:record._id,status:record.status,
   ...(completed?{publicListingRemovedAt:{$ne:null}}:{})},
   {$set:{
     listChannelId:"",listMessageId:"",listFingerprint:"",
     ...(!completed||record.mode!=="activity"?{messageId:null}:{}),
     ...(!completed?{finaleMessageId:""}:{}),
   }});
}
export async function handleGiveawayStaffAction(interaction){
 const ephemeral={flags:MessageFlags.Ephemeral};
 try{
   if(!await canManageGiveaways(interaction))
     return interaction.reply({content:giveawayManagerPermissionMessage,...ephemeral});
   const match=/^giveawaystaff:(stop|cancel|confirmcancel|remove|confirmremove|entrants|end|confirmend|edit|editselect|editsave|reroll|rerollselect|confirmreroll|abort):([0-9a-f]{24})(?::([A-Za-z0-9]+))?$/.exec(interaction.customId);
   if(!match)return interaction.reply({content:"Unknown staff action.",...ephemeral});
   const [,action,id,pageText]=match;
   const record=await Giveaway.findOne({_id:id,guildId:interaction.guildId,
     staffCardChannelId:interaction.channelId}).lean();
   if(!record)return interaction.reply({content:"This staff record was not found.",...ephemeral});
   if(["stop","cancel","remove","end","edit","reroll"].includes(action) &&
      record.staffCardId!==interaction.message?.id)
     return interaction.reply({content:"Use the current staff record for this giveaway.",...ephemeral});
   if(action==="entrants"){
     const page=Number(pageText);
     const fromStaffRecord=record.staffCardId===interaction.message?.id;
     const fromEphemeral=interaction.message?.flags?.has?.(MessageFlags.Ephemeral)===true &&
       interaction.message?.author?.id===interaction.client?.user?.id;
     if(!fromStaffRecord&&!fromEphemeral)
       return interaction.reply({content:"Use the current staff record or its private entrant pages.",...ephemeral});
     if(fromStaffRecord&&page!==0)
       return interaction.reply({content:"Open the entrant list from its first page.",...ephemeral});
     const payload=giveawayStaffEntrantsPage(record,page);
     return fromStaffRecord?interaction.reply({...payload,...ephemeral}):
       interaction.update(payload);
   }
   if(action==="edit"){
     const options=giveawayStaffEditMenuOptions(record);
     if(!options.length)
       return interaction.reply({content:"This giveaway is no longer editable. Results and original claim records are preserved.",...ephemeral});
     return interaction.reply({content:"**Edit this giveaway** · Choose one setting. The public listing will update without another giveaway ping.",
       components:[new ActionRowBuilder().addComponents(
         new StringSelectMenuBuilder().setCustomId("giveawaystaff:editselect:"+id)
           .setPlaceholder("Choose a setting to edit").addOptions(options))],...ephemeral});
   }
   if(action==="editselect"){
     const field=interaction.values?.[0];
     if(!giveawayStaffEditableFields(record).includes(field))
       return interaction.reply({content:"That setting is no longer available for editing.",...ephemeral});
     return interaction.showModal(giveawayStaffEditModal(record,field));
   }
   if(action==="editsave"){
     await interaction.deferReply(ephemeral);
     const change=validateGiveawayStaffEdit(record,pageText,
       interaction.fields.getTextInputValue("value"));
     if(change.bannerNameKey)
       change.bannerNameKey=await ensureBannerRegistered(record.guildId,change.bannerNameKey);
     const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
       mode:record.mode,status:"open",publicListingRemovedAt:null},
       {$set:{...change,renderedAt:null},$inc:{renderVersion:1}},
       {returnDocument:"after"}).lean();
     if(!updated)return interaction.editReply("This giveaway has already closed or changed.");
     try{
       if(updated.mode==="survival")await publishSurvivalAnnouncement(interaction.client,updated);
       else await publishGiveawayResult(interaction.client,updated);
     }catch(error){console.error("[Giveaways] Staff edited event; public refresh pending:",error);}
     await ensureGiveawayStaffRecord(interaction.client,updated);
     return interaction.editReply("Giveaway **"+pageText+"** updated. Entries are preserved and no new notification ping was sent.");
   }
   if(action==="end"){
     if(record.status!=="open"&&!(record.mode==="survival"&&record.status==="running"))
       return interaction.reply({content:"This giveaway has already finished or is being finalized.",...ephemeral});
     const text=record.mode==="survival"?
       record.status==="open"
         ?"End Trial signup early and begin the elimination game now? At least two contestants must have joined."
         :"Finish this Trial early? Remaining eliminations will continue at the quickest supported pace (2 seconds each), preserving the final Royal Verdict.":
       "End this giveaway now? Entries will close immediately and winners will be drawn. This does not cancel or delete the giveaway.";
     return interaction.reply({content:"**"+text+"**",
       components:[new ActionRowBuilder().addComponents(
         btn("giveawaystaff:confirmend:"+id,"Confirm End Early",ButtonStyle.Danger),
         btn("giveawaystaff:abort:"+id,"Keep Giveaway"))],...ephemeral});
   }
   if(action==="confirmend"){
     await interaction.deferReply(ephemeral);
     if(record.mode==="survival"){
       if(record.status==="open"){
         const started=await beginSurvivalTrial({id,guildId:interaction.guildId,now:new Date()});
         await publishSurvivalAnnouncement(interaction.client,started);
         await ensureGiveawayStaffRecord(interaction.client,started);
         return interaction.editReply("Trial signups closed. The Court's Trial is starting now.");
       }
       if(record.status!=="running")return interaction.editReply("This Trial has already closed.");
       const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
         mode:"survival",status:"running"},
         {$set:{speedSeconds:2,nextEventAt:new Date()}},
         {returnDocument:"after"}).lean();
       if(!updated)return interaction.editReply("Another staff member already finished this Trial.");
       await ensureGiveawayStaffRecord(interaction.client,updated);
       return interaction.editReply("The Trial is finishing early. Remaining eliminations will continue at 2-second intervals; the Royal Verdict will appear when they finish.");
     }
     if(record.guidedSeries)return interaction.editReply("Use the activity giveaway's End Early button to stop counting and preserve its approval flow.");
     if(record.status!=="open")return interaction.editReply("This giveaway is already closed.");
     const now=new Date();
     const marked=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
       status:"open",mode:record.mode},
       {$set:{endsAt:now,staffEndedEarly:true,staffEndedBy:interaction.user.id}},
       {returnDocument:"after"}).lean();
     if(!marked)return interaction.editReply("Another staff member already closed this giveaway.");
     const ended=await closeGiveaway({id,guildId:interaction.guildId,now,client:interaction.client});
     if(ended?.status==="ended")await publishGiveawayResult(interaction.client,ended);
     return interaction.editReply(ended?.status==="ended"?
       "Giveaway ended early. Results are saved and the public post was updated.":
       "Counting stopped. The giveaway is being finalized.");
   }
   if(action==="reroll"){
     if(record.status!=="ended"||record.publicListingRemovedAt||
       !hasOutstandingTicketClaims(record))
       return interaction.reply({content:"A manual reroll is only available while waiting for a current winner to claim.",...ephemeral});
     const slots=(record.winnerIds||[]).map((userId,slot)=>({userId,slot}))
       .filter(({slot,userId})=>userId&&!winnerHasClaim(record,slot)&&
         !(record.claimResolvedSlots||[]).includes(slot));
     if(!slots.length)return interaction.reply({content:"There are no open unclaimed prize places to reroll.",...ephemeral});
     return interaction.reply({content:"**Manual reroll** · Choose the unclaimed winner position to replace. The old winner will lose the right to claim this place.",
       components:[new ActionRowBuilder().addComponents(
         new StringSelectMenuBuilder().setCustomId("giveawaystaff:rerollselect:"+id)
           .setPlaceholder("Choose an unclaimed prize place")
           .addOptions(slots.map(({userId,slot})=>({label:"Place "+(slot+1),
             description:"Current winner "+userId,value:String(slot)}))))],...ephemeral});
   }
   if(action==="rerollselect"){
     const slot=Number(interaction.values?.[0]);
     if(!Number.isSafeInteger(slot)||slot<0||slot>9)
       return interaction.reply({content:"Choose an existing unclaimed prize place.",...ephemeral});
     if(record.status!=="ended"||winnerHasClaim(record,slot)||
       (record.claimResolvedSlots||[]).includes(slot)||!record.winnerIds?.[slot])
       return interaction.reply({content:"This winning place is not awaiting a claim.",...ephemeral});
     return interaction.update({content:"**Reroll place "+(slot+1)+"?** This permanently replaces its current unclaimed winner if another eligible member is available.",
       components:[new ActionRowBuilder().addComponents(
         btn("giveawaystaff:confirmreroll:"+id+":"+slot,"Confirm Manual Reroll",ButtonStyle.Danger))],
       allowedMentions:{parse:[]}});
   }
   if(action==="confirmreroll"){
     await interaction.deferReply(ephemeral);
     const slot=Number(pageText);
     if(!Number.isSafeInteger(slot)||!record.winnerIds?.[slot]||
       record.status!=="ended"||record.publicListingRemovedAt||
       winnerHasClaim(record,slot)||(record.claimResolvedSlots||[]).includes(slot))
       return interaction.editReply("This prize place is no longer awaiting a claim.");
     const updated=await rerollGiveaway({id,guildId:interaction.guildId,
       staffId:interaction.user.id,slot,reason:"staff",client:interaction.client});
     if(updated?.status!=="ended")return interaction.editReply("Reroll saved; result finalization is pending.");
     await publishGiveawayResult(interaction.client,updated);
     return interaction.editReply("Manual reroll completed for place "+(slot+1)+
       ". The new winner receives a fresh claim period; public results and staff records were updated.");
   }
   if(action==="abort")
     return interaction.reply({content:"No changes made.",...ephemeral});

   if(action==="cancel"){
     if(!["open","pending_review","running"].includes(record.status))
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
   if(action==="remove"){
     if(!((record.status==="ended"&&completedGiveawayCanDeleteListing(record))||record.publicListingRemovedAt||record.status==="cancelled"))
       return interaction.reply({content:"A completed giveaway can only be removed when no winners were selected, or each prize place has a submitted ticket claim or has passed its deadline with no rerolls left.",...ephemeral});
     return interaction.showModal(new ModalBuilder()
       .setCustomId("giveawaystaff:confirmremove:"+id)
       .setTitle(record.mode==="survival"?"Archive completed Court's Trial":"Delete completed giveaway listing")
       .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
         .setCustomId("confirm")
         .setLabel("Type ARCHIVE to confirm")
         .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(7))));
   }
   await interaction.deferReply(ephemeral);
   if(action==="confirmremove"){
     if(interaction.fields.getTextInputValue("confirm").trim().toUpperCase()!=="ARCHIVE")
       return interaction.editReply("Archive not confirmed. Type ARCHIVE to proceed.");
     const config=await GuildConfig.findOne({guildId:record.guildId})
       .select("giveawayArchiveChannelId activityGiveawayReviewChannelId").lean();
     if(!config?.giveawayArchiveChannelId||config.giveawayArchiveChannelId===config.activityGiveawayReviewChannelId)
       return interaction.editReply("Set a separate private archive channel using /setup archives first.");
     const archiveChannel=await interaction.client.channels.fetch(config.giveawayArchiveChannelId).catch(()=>null);
     if(!archiveChannel?.send||!archiveChannel.messages?.fetch||
        archiveChannel.permissionsFor?.(archiveChannel.guild?.roles?.everyone)?.has(PermissionFlagsBits.ViewChannel))
       return interaction.editReply("The archive channel is missing, unavailable, or visible to @everyone.");
     if(record.status!=="cancelled"&&!record.publicListingRemovedAt){
       if(!completedGiveawayCanDeleteListing(record))
         return interaction.editReply("Claim deadlines or rerolls are still pending. Archive is available after each winning place is settled.");
       const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
         status:"ended",publicListingRemovedAt:null,renderVersion:record.renderVersion??0},
         {$set:{publicListingRemovedAt:new Date(),publicListingRemovedBy:interaction.user.id,
           claimCheckAt:null,renderedAt:new Date()},
          $inc:{renderVersion:1}},{returnDocument:"after"}).lean();
       if(!updated)return interaction.editReply("The giveaway changed. Refresh its staff record.");
       record=updated;
     }
     let cleanupError=null;
     try{
       if(record.status==="ended")await removeGiveawayPublicPosts(interaction.client,record);
     }catch(error){cleanupError=error;}
     try{await ensureGiveawayStaffRecord(interaction.client,record);}
     catch(error){
       console.error("[Giveaways] Archiving staff record failed:",error);
       return interaction.editReply("The giveaway has been marked for archiving, but the archive post could not be created. The bot will retry. Do not delete the original staff record.");
     }
     return interaction.editReply(cleanupError
       ?"Staff record moved to the archive channel, but removing the public listing failed. The bot will retry cleanup."
       :"Giveaway archived in <#"+config.giveawayArchiveChannelId+">. Winner, claim and reroll history is preserved.");
   }
   if(action==="stop"){
     if(record.publicListingRemovedAt||(record.mode==="survival"&&!record.trialTicketClaimsEnabled)||record.status!=="ended"||!record.autoRerollClaims)
       return interaction.editReply("Automatic claim rerolls are not active on this giveaway.");
     const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
       status:"ended",autoRerollClaims:true,publicListingRemovedAt:null},
       {$set:{autoRerollClaims:false,claimCheckAt:null,renderedAt:null},$inc:{renderVersion:1}},
       {returnDocument:"after"}).lean();
     if(!updated)return interaction.editReply("Another staff member already changed this giveaway.");
     await ensureGiveawayStaffRecord(interaction.client,updated);
     return interaction.editReply("Further automatic claim rerolls have been disabled. Current submitted claims remain saved.");
   }
   if(!["open","pending_review","running"].includes(record.status))
     return interaction.editReply("Only active giveaways may be cancelled. Completed giveaways use Delete Listing after claims are submitted.");
   if(interaction.fields.getTextInputValue("confirm").trim().toUpperCase()!=="CANCEL")
     return interaction.editReply("Cancellation not confirmed. Type CANCEL to proceed.");
   const reason=interaction.fields.getTextInputValue("reason").trim();
   if(reason.length<3)return interaction.editReply("A cancellation reason of at least three characters is required.");
   const updated=await Giveaway.findOneAndUpdate({_id:id,guildId:interaction.guildId,
     status:{$in:["open","pending_review","running"]}},
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
