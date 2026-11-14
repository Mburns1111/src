import {
 ActionRowBuilder,ButtonBuilder,ButtonStyle,UserSelectMenuBuilder,
 ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,
} from "discord.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {showTemporaryPanel,acknowledgeTemporaryAction,finishTemporaryAction} from "./temporary-interaction-controls.js";
import {
 activeCooldownFor,removeGiveawayWinnerCooldown,adjustGiveawayWinnerCooldown,
 assignManualWinnerCooldown,cooldownExpiration,
} from "./giveaway-cooldowns.js";

const ephemeral={flags:MessageFlags.Ephemeral};
const btn=(id,label,style=ButtonStyle.Secondary)=>
 new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row=(...controls)=>new ActionRowBuilder().addComponents(controls);
const unix=date=>Math.floor(+new Date(date)/1000);
const idFor=(action,...pieces)=>"giveawaydir:"+action+pieces.map(x=>":"+x).join("");
const validMember=id=>/^\d{15,22}$/.test(id||"");
const panelReply=(interaction,payload)=>{
 const {flags:_ignored,...message}=payload;
 // Message updates cannot set ephemeral flags; only first-time replies can.
 return showTemporaryPanel(interaction,message);
};
const noCooldownPanel=id=>({
 content:"<@"+id+"> has no active winner cooldown.\n\nStaff may assign a new cooldown without a prior giveaway win. The expiry will start from confirmation.",
 components:[row(btn(idFor("cooldownadd",id),"Add Cooldown",ButtonStyle.Primary))],
 allowedMentions:{parse:[]}
});
function memberManager(id,record){
 return {
  content:"**Member winner cooldown**\n<@"+id+">\n"+
   "**Expires:** <t:"+unix(record.expiresAt)+":F> (<t:"+unix(record.expiresAt)+":R>)\n"+
   (record.sourceGiveawayId==="staff-manual"?"**Source:** Staff-assigned cooldown\n":
    "**Most recent source giveaway:** `"+String(record.sourceGiveawayId||"unknown")+"`\n")+
   "**Applied by:** "+(record.appliedBy?"<@"+record.appliedBy+">":"Not recorded")+
   "\n\nStaff may correct the remaining time or remove this cooldown. "+
   "These actions never assign/remove the separate Giveaway Banned role.",
  components:[row(
   btn(idFor("cooldownedit",id),"Correct Expiry",ButtonStyle.Primary),
   btn(idFor("cooldownremove",id),"Remove Cooldown",ButtonStyle.Danger))],
  allowedMentions:{parse:[]},
 };
}
export async function handleGiveawayCooldownDirectoryAction(interaction){
 const match=/^giveawaydir:(cooldowns|cooldownpage|cooldownmember|cooldownadd|cooldownadddays|cooldownconfirmadd|cooldownmemberback|cooldownedit|cooldowneditdays|cooldownconfirmedit|cooldownremove|cooldownconfirmremove)(?::(\d{1,22}))?(?::(\d{1,3}))?$/.exec(interaction.customId);
 if(!match)return interaction.reply({content:"Unknown cooldown management action.",...ephemeral});
 const [,action,arg,daysText]=match;
 const guildId=interaction.guildId,staffId=interaction.user.id;
 if(action==="cooldowns"||action==="cooldownpage"){
  const page=action==="cooldowns"?0:Number(arg||0),now=new Date();
  if(page>10000)return interaction.reply({content:"That page is too far away.",...ephemeral});
  const records=await GiveawayWinnerCooldown.find({
   guildId,expiresAt:{$gt:now},
  }).sort({expiresAt:1}).skip(page*20).limit(21).lean();
  const listed=records.slice(0,20);
  const content="**Active Giveaway Winner Cooldowns · Staff**\n"+
   (listed.length?listed.map((r,i)=>(page*20+i+1)+". <@"+r.userId+"> · expires <t:"+unix(r.expiresAt)+":F>").join("\n"):
    "No active winner cooldowns on this page.")+
   "\n\nSelect a member below to view, adjust, remove, or **add** a cooldown. Expired cooldowns stop blocking entries in enabled regular giveaways and winner draws.";
  const controls=[row(new UserSelectMenuBuilder()
   .setCustomId(idFor("cooldownmember"))
   .setPlaceholder("Find a member by Discord name").setMinValues(1).setMaxValues(1))];
  const pagination=[];
  if(page>0)pagination.push(btn(idFor("cooldownpage",page-1),"Previous"));
  if(records.length>20)pagination.push(btn(idFor("cooldownpage",page+1),"Next"));
  if(pagination.length)controls.push(row(...pagination));
  const payload={content,components:controls,allowedMentions:{parse:[]}};
  // The entry button is on the permanent private directory; do NOT edit that
  // directory. Subsequent selections update the same ephemeral panel.
  return action==="cooldowns"?
    interaction.reply({...payload,...ephemeral}):panelReply(interaction,payload);
 }
 if(action==="cooldownmember"){
  const userId=interaction.values?.[0];
  if(!validMember(userId))
   return panelReply(interaction,{content:"Select one valid Discord member.",components:[],allowedMentions:{parse:[]}});
  const active=await activeCooldownFor(guildId,userId);
  return panelReply(interaction,active?memberManager(userId,active):noCooldownPanel(userId));
 }
 if(!validMember(arg))
  return interaction.reply({content:"Invalid member selection.",...ephemeral});
 const active=await activeCooldownFor(guildId,arg);
 if(action==="cooldownadd" && !active){
   return interaction.showModal(new ModalBuilder()
     .setCustomId(idFor("cooldownadddays",arg))
     .setTitle("Add Winner Cooldown")
     .addComponents(row(new TextInputBuilder().setCustomId("days")
       .setLabel("Cooldown days from now (1–365)")
       .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3)
       .setPlaceholder("Example: 3").setRequired(true))));
 }
 if(action==="cooldownadddays"){
  const raw=interaction.fields?.getTextInputValue("days")?.trim()||"";
  if(!/^\d{1,3}$/.test(raw)||Number(raw)<1||Number(raw)>365)
   return panelReply(interaction,{content:"Enter a whole number from 1 to 365 days.",components:[]});
  if(active)
   return panelReply(interaction,{content:"This member already has an active cooldown. Use Correct Expiry instead.",components:[]});
  const days=Number(raw),expiresAt=cooldownExpiration(new Date(),days);
  return panelReply(interaction,{content:"**Confirm new winner cooldown**\n"+
   "Member: <@"+arg+">\nDuration: **"+days+" day(s)** from confirmation"+
   "\nExpected expiration: <t:"+unix(expiresAt)+":F>"+
   "\n\nThis applies server-wide to cooldown-enabled regular/activity giveaways. It does not assign the Giveaway Banned role.",
   components:[row(btn(idFor("cooldownconfirmadd",arg,days),"Confirm New Cooldown",ButtonStyle.Success),
     btn(idFor("cooldownmemberback",arg),"Cancel"))],
   allowedMentions:{parse:[]},...ephemeral});
 }
 if(action==="cooldownconfirmadd"){
  const days=Number(daysText);
  if(!/^\d{1,3}$/.test(daysText||"")||days<1||days>365)
   return panelReply(interaction,{content:"Invalid cooldown duration.",components:[]});
  if(active)
   return panelReply(interaction,{content:"A cooldown was added by another staff member. Use Correct Expiry.",components:[]});
  await acknowledgeTemporaryAction(interaction);
  const applied=await assignManualWinnerCooldown({guildId,userId:arg,staffId,days});
  return finishTemporaryAction(interaction,{content:"✅ New winner cooldown saved for <@"+arg+">.\n"+
   "Expires: <t:"+unix(applied.expiresAt)+":F> (<t:"+unix(applied.expiresAt)+":R>)"+
   (applied.cleanupWarning?"\nExisting giveaway entries will be cleaned up on the next sweep.":"")+
   "\n\nStaff action recorded. The Giveaway Banned role is unchanged.",
   components:[],allowedMentions:{parse:[]}});
 }
 if(action==="cooldownmemberback")return panelReply(interaction,active?memberManager(arg,active):noCooldownPanel(arg));
 if(!active)
  return panelReply(interaction,noCooldownPanel(arg));
 if(action==="cooldownremove"){
  return panelReply(interaction,{content:"**Confirm cooldown removal** for <@"+arg+">?\n"+
    "It currently expires <t:"+unix(active.expiresAt)+":F>. Removing it immediately allows wins in cooldown-enabled giveaways, if the member meets the other rules.",
   components:[row(btn(idFor("cooldownconfirmremove",arg),"Confirm Removal",ButtonStyle.Danger))],
   allowedMentions:{parse:[]}});
 }
 if(action==="cooldownconfirmremove"){
  await acknowledgeTemporaryAction(interaction);
  const removed=await removeGiveawayWinnerCooldown({guildId,userId:arg,staffId});
  return finishTemporaryAction(interaction,{content:removed?
    "Cooldown removed for <@"+arg+">. The Giveaway Banned role is unchanged.":
    "That member's cooldown is no longer active.",
    components:[],allowedMentions:{parse:[]}});
 }
 if(action==="cooldownedit"){
  return interaction.showModal(new ModalBuilder()
   .setCustomId(idFor("cooldowneditdays",arg))
   .setTitle("Correct Cooldown Duration")
   .addComponents(row(new TextInputBuilder().setCustomId("days")
    .setLabel("Days remaining from today (1–365)")
    .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3)
    .setPlaceholder("Example: 3").setRequired(true))));
 }
 if(action==="cooldowneditdays"){
  const raw=interaction.fields?.getTextInputValue("days")?.trim()||"";
  if(!/^\d{1,3}$/.test(raw)||Number(raw)<1||Number(raw)>365)
   return panelReply(interaction,{content:"Enter a whole number of remaining days from 1 to 365.",components:[]});
  const days=Number(raw),estimated=cooldownExpiration(new Date(),days);
  return panelReply(interaction,{content:"**Confirm staff correction**\n"+
   "Member: <@"+arg+">\nNew duration: "+days+" day(s) **remaining from now**\n"+
   "New expiration: <t:"+unix(estimated)+":F>\n"+
   "**Note:** This correction can shorten an existing cooldown. The action will be recorded in MongoDB.",
   components:[row(btn(idFor("cooldownconfirmedit",arg,days),"Confirm Correction",ButtonStyle.Danger))],
   allowedMentions:{parse:[]},...ephemeral});
 }
 if(action==="cooldownconfirmedit"){
  await acknowledgeTemporaryAction(interaction);
  const days=Number(daysText);
  if(!/^\d{1,3}$/.test(daysText||"")||days<1||days>365)
   return finishTemporaryAction(interaction,{content:"Invalid remaining duration.",components:[]});
  const updated=await adjustGiveawayWinnerCooldown({guildId,userId:arg,staffId,daysRemaining:days});
  return finishTemporaryAction(interaction,{content:updated?
   "Cooldown corrected for <@"+arg+">. New expiry: <t:"+unix(updated.expiresAt)+":F>. The audit record is preserved.":
   "The cooldown expired or was removed before your correction.",
   components:[],allowedMentions:{parse:[]}});
 }
 return interaction.reply({content:"Unknown cooldown management action.",...ephemeral});
}
