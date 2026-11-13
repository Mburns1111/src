import {
 ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,
 TextInputStyle,StringSelectMenuBuilder,MessageFlags,
} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {showTemporaryPanel,acknowledgeTemporaryAction,finishTemporaryAction,isTemporaryPanel} from "./temporary-interaction-controls.js";
import {
 applyGiveawayWinnerCooldown,removeGiveawayWinnerCooldown,
 cooldownExpiration,MAX_GIVEAWAY_COOLDOWN_DAYS,removeActiveCooldownEntries,
} from "./giveaway-cooldowns.js";

const ephemeral={flags:MessageFlags.Ephemeral};
const button=(customId,label,style=ButtonStyle.Secondary)=>
 new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const row=(...buttons)=>new ActionRowBuilder().addComponents(buttons);
const idFor=(action,id,slots="",days="")=>
 "giveawaystaff:"+action+":"+id+(slots?":"+slots:"")+(days?":"+days:"");
const unix=date=>Math.floor(+new Date(date)/1000);
const isDelivered=record=>
 record.mode!=="survival"&&record.status==="ended"&&
 Boolean(record.prizeDeliveredAt)&&
 (record.winnerIds||[]).length>0;

function slotsFromToken(token,record){
 if(!/^[0-9]{1,10}$/.test(token||""))
  throw Error("Choose one or more winner positions.");
 const unique=[...new Set([...token].map(Number))].sort((a,b)=>a-b);
 if(unique.some(slot=>!record.winnerIds?.[slot]))throw Error("A selected winner has changed. Open the latest staff record.");
 return unique;
}
const tokenFromSlots=slots=>[...new Set(slots)].sort((a,b)=>a-b).join("");
function daysModal(record,token,fromPrivatePicker=false){
 return new ModalBuilder()
  .setCustomId(idFor("cooldowndays",record._id,token,fromPrivatePicker?"p":""))
  .setTitle("Apply Giveaway Winner Cooldown")
  .addComponents(row(new TextInputBuilder()
   .setCustomId("days").setLabel("Cooldown duration (days, 1–365)")
   .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1)
   .setMaxLength(3).setPlaceholder("Example: 7")));
}
function statuses(record,docs,now){
 const current=new Map(docs.map(d=>[String(d.userId),d]));
 return (record.winnerIds||[]).map((id,slot)=>{
  const found=current.get(String(id));
  const status=found&&new Date(found.expiresAt)>now?
   "Active until <t:"+unix(found.expiresAt)+":F>":
   "No active cooldown";
  return "**Place "+(slot+1)+"** · <@"+id+"> — "+status;
 }).join("\n");
}
async function showSelection(interaction,record,{remove=false}={}){
 const now=new Date(),ids=[...new Set(record.winnerIds||[])];
 const current=await GiveawayWinnerCooldown.find({
  guildId:record.guildId,userId:{$in:ids},expiresAt:{$gt:now},
 }).lean();
 const available=remove?new Set(current.map(c=>String(c.userId))):new Set(ids.map(String));
 const choices=(record.winnerIds||[]).map((userId,slot)=>({userId,slot}))
  .filter(x=>available.has(String(x.userId)));
 if(!choices.length)return showTemporaryPanel(interaction,{content:remove?
  "None of this giveaway's winners currently has an active cooldown.":
  "This giveaway has no winners eligible for cooldown management."});
 if(choices.length===1){
  const token=String(choices[0].slot);
  if(!remove)return interaction.showModal(daysModal(record,token,isTemporaryPanel(interaction)));
  return showTemporaryPanel(interaction,{content:"Remove the active server-wide winner cooldown for <@"+choices[0].userId+">? This takes effect immediately.",
   components:[row(button(idFor("cooldownconfirmremove",record._id,token),
    "Confirm Removal",ButtonStyle.Danger))],allowedMentions:{parse:[]}});
 }
 const select=new StringSelectMenuBuilder()
  .setCustomId(idFor(remove?"cooldownremovechoose":"cooldownselect",record._id))
  .setPlaceholder(remove?"Choose a winner to remove cooldown":"Choose one, several, or all winners")
  .setMinValues(1).setMaxValues(remove?1:choices.length)
  .addOptions(choices.map(({userId,slot})=>({
   label:"Place "+(slot+1)+" · "+userId,
   value:String(slot),
  })));
 const text=remove?"Select a member whose active cooldown you want to remove. Removal applies server-wide.":
  "Select the winners to receive a cooldown. You may choose **one, several, or all**. All selected winners will receive the same number of days.";
 return showTemporaryPanel(interaction,{content:"**Winner Cooldowns**\n"+statuses(record,current,now)+
  "\n\n"+text,components:[row(select)],allowedMentions:{parse:[]}});
}

export async function handleGiveawayCooldownAction(interaction,record,action,slotToken,daysToken,{refresh}={}){
 if(!isDelivered(record))
  return interaction.reply({content:"Winner cooldowns may be applied only after all prizes are confirmed delivered and before archiving. Court's Trials do not use winner cooldowns.",...ephemeral});
 const id=String(record._id);
 if(action==="cooldown"){
  if((record.cooldownAssignments||[]).length){
   const members=[...new Set(record.winnerIds.map(String))];
   const active=await GiveawayWinnerCooldown.find({
    guildId:record.guildId,userId:{$in:members},expiresAt:{$gt:new Date()},
   }).lean();
   return showTemporaryPanel(interaction,{content:"**Manage winner cooldowns**\n"+
     statuses(record,active,new Date())+
     "\n\nCooldown-enabled regular giveaways block new entries and remove existing entries; regular/activity draws exclude active cooldowns. Court's Trials and the mandatory Giveaway Banned role remain unaffected.",
     components:[row(
      button(idFor("cooldowncreate",id),"Apply / Extend",ButtonStyle.Primary),
      button(idFor("cooldownremove",id),"Remove Cooldown",ButtonStyle.Danger))],
     allowedMentions:{parse:[]}});
  }
  return showSelection(interaction,record);
 }
 if(action==="cooldowncreate")return showSelection(interaction,record);
 if(action==="cooldownremove")return showSelection(interaction,record,{remove:true});
 if(action==="cooldownselect"){
  const selected=interaction.values?.map(Number)||[];
  const token=tokenFromSlots(selected);
  slotsFromToken(token,record);
  return interaction.showModal(daysModal(record,token,true));
 }
 if(action==="cooldowndays"){
  const slots=slotsFromToken(slotToken,record);
  const raw=interaction.fields?.getTextInputValue("days")?.trim()||"";
  if(!/^\d{1,3}$/.test(raw)||!Number.isSafeInteger(Number(raw))||
    Number(raw)<1||Number(raw)>MAX_GIVEAWAY_COOLDOWN_DAYS)
   return interaction.reply({content:"Enter a whole number of cooldown days from 1 to 365.",...ephemeral});
  const days=Number(raw),expiresAt=cooldownExpiration(record.prizeDeliveredAt,days);
  if(expiresAt<=new Date())return interaction.reply({content:"That duration would have expired already, because cooldowns start at **confirmed prize delivery**, not today. Choose a longer duration.",...ephemeral});
  const ids=slots.map(slot=>record.winnerIds[slot]);
  const active=await GiveawayWinnerCooldown.find({
   guildId:record.guildId,userId:{$in:ids},expiresAt:{$gt:new Date()},
  }).lean();
  const conflict=active.length?"\n\n**Existing cooldowns:**\n"+
   active.map(c=>"<@"+c.userId+"> expires <t:"+unix(c.expiresAt)+":F>").join("\n")+
   "\nThe bot will **never shorten** an existing longer cooldown.":"";
  const payload={content:"**Confirm Giveaway Winner Cooldown**\n"+
    "Winner(s): "+ids.map(id=>"<@"+id+">").join(", ")+"\n"+
    "Cooldown: **"+days+" day"+(days===1?"":"s")+"**\n"+
    "Starts: <t:"+unix(record.prizeDeliveredAt)+":F> (prize delivery)\n"+
    "Requested expiry: <t:"+unix(expiresAt)+":F>"+
    conflict+"\n\nApply this server-wide winner cooldown?",
   components:[row(button(idFor("cooldownapply",id,slotToken,String(days)),
     "Confirm Cooldown",ButtonStyle.Success),
    button(idFor("abort",id),"Cancel"))],allowedMentions:{parse:[]}};
  return daysToken==="p"&&typeof interaction.update==="function"?
   interaction.update(payload):interaction.reply({...payload,...ephemeral});
 }
 if(action==="cooldownapply"){
  await acknowledgeTemporaryAction(interaction);
  const days=Number(daysToken);
  const slots=slotsFromToken(slotToken,record);
  if(!/^[1-9]\d{0,2}$/.test(daysToken||"")||days>MAX_GIVEAWAY_COOLDOWN_DAYS)
   return finishTemporaryAction(interaction,"Invalid cooldown duration.");
  const latest=await Giveaway.findOne({_id:id,guildId:interaction.guildId}).lean();
  if(!isDelivered(latest) || +new Date(latest.prizeDeliveredAt)!==+new Date(record.prizeDeliveredAt) ||
     slots.some(n=>latest.winnerIds?.[n]!==record.winnerIds?.[n]))
   return finishTemporaryAction(interaction,"Prize delivery or winner positions changed. Please open the latest staff record.");
  const now=new Date(),applied=[];
  for(const slot of slots){
   const userId=latest.winnerIds[slot];
   const result=await applyGiveawayWinnerCooldown({
    guildId:record.guildId,userId,sourceGiveawayId:id,
    deliveredAt:latest.prizeDeliveredAt,staffId:interaction.user.id,days,now,
   });
   applied.push({userId,days,expiresAt:result.expiresAt,
    appliedBy:interaction.user.id,appliedAt:now});
  }
  const updated=await Giveaway.findOneAndUpdate({
   _id:id,guildId:record.guildId,status:"ended",prizeDeliveredAt:latest.prizeDeliveredAt,
  },{$push:{cooldownAssignments:{$each:applied}}},{new:true}).lean();
  let removedEntries=0,cleanupFailed=false;
  try{
   removedEntries=await removeActiveCooldownEntries(record.guildId,applied.map(x=>x.userId),{now});
  }catch(error){
   cleanupFailed=true;
   console.error("[Giveaways] Cooldown saved, existing entry cleanup will retry:",error);
  }
  if(updated&&refresh)await refresh(updated);
  return finishTemporaryAction(interaction,{content:"✅ **Winner cooldown saved.**\n"+
   applied.map(c=>"<@"+c.userId+"> · "+days+" day(s) · expires <t:"+unix(c.expiresAt)+":F>").join("\n")+
   "\n\n"+(removedEntries?"Removed entries from **"+removedEntries+"** open, cooldown-enabled regular giveaway(s).\n":"")+(cleanupFailed?"Older entries will be cleared by the automatic retry.\n":"")+
   "Cooldown-enabled regular giveaways now block entries until expiry; regular/activity drawings also exclude active cooldowns. The ban role is unaffected.",
   allowedMentions:{parse:[]}});
 }
 if(action==="cooldownremovechoose"){
  const token=tokenFromSlots(interaction.values?.map(Number)||[]);
  const slots=slotsFromToken(token,record);
  if(slots.length!==1)return interaction.reply({content:"Choose one member to remove a cooldown.",...ephemeral});
  const userId=record.winnerIds[slots[0]];
  const current=await GiveawayWinnerCooldown.findOne({
   guildId:record.guildId,userId,expiresAt:{$gt:new Date()},
  }).lean();
  if(!current)return interaction.reply({content:"That member no longer has an active winner cooldown.",...ephemeral});
  return interaction.update({content:"Remove the **server-wide** cooldown for <@"+userId+">? The active cooldown ends immediately (currently expires <t:"+unix(current.expiresAt)+":F>).",
   components:[row(button(idFor("cooldownconfirmremove",id,token),"Confirm Removal",ButtonStyle.Danger))],
   allowedMentions:{parse:[]}});
 }
 if(action==="cooldownconfirmremove"){
  const slots=slotsFromToken(slotToken,record);
  if(slots.length!==1)return interaction.reply({content:"Choose one winner.",...ephemeral});
  await acknowledgeTemporaryAction(interaction);
  const userId=record.winnerIds[slots[0]];
  const removed=await removeGiveawayWinnerCooldown({
   guildId:record.guildId,userId,staffId:interaction.user.id});
  return finishTemporaryAction(interaction,removed?
   "Winner cooldown removed for <@"+userId+">. This removal applies server-wide; it does not change the Giveaway Banned role.":
   "That member has no active winner cooldown to remove.");
 }
 return interaction.reply({content:"Unknown cooldown action.",...ephemeral});
}
