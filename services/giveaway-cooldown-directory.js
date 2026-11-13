import {
 ActionRowBuilder,ButtonBuilder,ButtonStyle,UserSelectMenuBuilder,
 ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,
} from "discord.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {
 activeCooldownFor,removeGiveawayWinnerCooldown,adjustGiveawayWinnerCooldown,
 cooldownExpiration,
} from "./giveaway-cooldowns.js";

const ephemeral={flags:MessageFlags.Ephemeral};
const btn=(id,label,style=ButtonStyle.Secondary)=>
 new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row=(...controls)=>new ActionRowBuilder().addComponents(controls);
const unix=date=>Math.floor(+new Date(date)/1000);
const idFor=(action,...pieces)=>"giveawaydir:"+action+pieces.map(x=>":"+x).join("");

function memberManager(id,record){
 return {
  content:"**Member winner cooldown**\n<@"+id+">\n"+
   "**Expires:** <t:"+unix(record.expiresAt)+":F> (<t:"+unix(record.expiresAt)+":R>)\n"+
   "**Most recent source giveaway:** `"+String(record.sourceGiveawayId||"unknown")+"`\n"+
   "**Applied by:** "+(record.appliedBy?"<@"+record.appliedBy+">":"Not recorded")+
   "\n\nStaff can edit the remaining days or remove the cooldown. "+
   "These actions never assign/remove the separate Giveaway Banned role.",
  components:[row(
   btn(idFor("cooldownedit",id),"Edit Cooldown",ButtonStyle.Primary),
   btn(idFor("cooldownremove",id),"Remove Cooldown",ButtonStyle.Danger))],
  allowedMentions:{parse:[]},...ephemeral,
 };
}
export async function handleGiveawayCooldownDirectoryAction(interaction){
 const match=/^giveawaydir:(cooldowns|cooldownpage|cooldownmember|cooldownedit|cooldowneditdays|cooldownconfirmedit|cooldownremove|cooldownconfirmremove)(?::(\d{1,22}))?(?::(\d{1,3}))?$/.exec(interaction.customId);
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
   "\n\nSelect a member below to view, correct or remove their cooldown. Expired cooldowns automatically stop restricting drawings.";
  const controls=[row(new UserSelectMenuBuilder()
   .setCustomId(idFor("cooldownmember"))
   .setPlaceholder("Find a member by Discord name").setMinValues(1).setMaxValues(1))];
  const pagination=[];
  if(page>0)pagination.push(btn(idFor("cooldownpage",page-1),"Previous"));
  if(records.length>20)pagination.push(btn(idFor("cooldownpage",page+1),"Next"));
  if(pagination.length)controls.push(row(...pagination));
  return interaction.reply({content,components:controls,allowedMentions:{parse:[]},...ephemeral});
 }
 if(action==="cooldownmember"){
  const userId=interaction.values?.[0];
  if(!/^\d{15,22}$/.test(userId||""))
   return interaction.reply({content:"Select one valid Discord member.",...ephemeral});
  const active=await activeCooldownFor(guildId,userId);
  return interaction.reply(active?memberManager(userId,active):
   {content:"<@"+userId+"> has no active winner cooldown.",allowedMentions:{parse:[]},...ephemeral});
 }
 if(!/^\d{15,22}$/.test(arg||""))
  return interaction.reply({content:"Invalid member selection.",...ephemeral});
 const active=await activeCooldownFor(guildId,arg);
 if(!active)
  return interaction.reply({content:"That member's cooldown is already expired or removed.",...ephemeral});
 if(action==="cooldownremove"){
  return interaction.reply({content:"**Confirm cooldown removal** for <@"+arg+">?\n"+
    "It currently expires <t:"+unix(active.expiresAt)+":F>. Removing it immediately allows wins in cooldown-enabled giveaways, if the member meets the other rules.",
   components:[row(btn(idFor("cooldownconfirmremove",arg),"Confirm Removal",ButtonStyle.Danger))],
   allowedMentions:{parse:[]},...ephemeral});
 }
 if(action==="cooldownconfirmremove"){
  await interaction.deferReply(ephemeral);
  const removed=await removeGiveawayWinnerCooldown({guildId,userId:arg,staffId});
  return interaction.editReply(removed?
   "Cooldown removed for <@"+arg+">. The Giveaway Banned role is unchanged.":
   "That member's cooldown is no longer active.");
 }
 if(action==="cooldownedit"){
  return interaction.showModal(new ModalBuilder()
   .setCustomId(idFor("cooldowneditdays",arg))
   .setTitle("Edit Winner Cooldown")
   .addComponents(row(new TextInputBuilder().setCustomId("days")
    .setLabel("Days remaining from today (1–365)")
    .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3)
    .setPlaceholder("Example: 3").setRequired(true))));
 }
 if(action==="cooldowneditdays"){
  const raw=interaction.fields?.getTextInputValue("days")?.trim()||"";
  if(!/^\d{1,3}$/.test(raw)||Number(raw)<1||Number(raw)>365)
   return interaction.reply({content:"Enter a whole number of remaining days from 1 to 365.",...ephemeral});
  const days=Number(raw),estimated=cooldownExpiration(new Date(),days);
  return interaction.reply({content:"**Confirm cooldown edit**\n"+
   "Member: <@"+arg+">\nNew duration: "+days+" day(s) **remaining from now**\n"+
   "New expiration: <t:"+unix(estimated)+":F>\n"+
   "**Note:** Editing can shorten or extend the cooldown. The change will be recorded in MongoDB.",
   components:[row(btn(idFor("cooldownconfirmedit",arg,days),"Confirm Edit",ButtonStyle.Primary))],
   allowedMentions:{parse:[]},...ephemeral});
 }
 if(action==="cooldownconfirmedit"){
  await interaction.deferReply(ephemeral);
  const days=Number(daysText);
  if(!/^\d{1,3}$/.test(daysText||"")||days<1||days>365)
   return interaction.editReply("Invalid remaining duration.");
  const updated=await adjustGiveawayWinnerCooldown({guildId,userId:arg,staffId,daysRemaining:days});
  return interaction.editReply(updated?
   "Cooldown updated for <@"+arg+">. New expiry: <t:"+unix(updated.expiresAt)+":F>. The audit record is preserved.":
   "The cooldown expired or was removed before your correction.");
 }
 return interaction.reply({content:"Unknown cooldown management action.",...ephemeral});
}
