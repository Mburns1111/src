import {SlashCommandBuilder,PermissionFlagsBits} from "discord.js";
import GiveawayPlan,{planNameKey} from "../models/GiveawayPlan.js";
import GiveawayWatchRule,{watchNameKey} from "../models/GiveawayWatchRule.js";
import Giveaway from "../models/Giveaway.js";
import {normalizeRoleBonuses} from "../services/giveaway-role-weights.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "../services/giveaway-manager-permissions.js";
import {publishActivityPlanListing,publishActivityOneOffListing} from "../services/giveaway-directory.js";

export const ROLE_BONUS_OPERATIONS=new Set(["bonus-add","bonus-remove","bonus-list"]);
export const data=addGiveawayRoleBonusCommands(new SlashCommandBuilder()
 .setName("giveaway-role").setDescription("Manage weighted role chances on saved activity giveaways")
 );
export function addGiveawayRoleBonusCommands(builder){
 return builder
  .addSubcommand(c=>c.setName("bonus-add").setDescription("Add or update an extra-drawing-chances role on a watch or plan")
    .addStringOption(o=>o.setName("target").setDescription("Save role bonus on watch or specific plan").setRequired(true)
      .addChoices({name:"Saved watch",value:"watch"},{name:"Giveaway plan",value:"plan"},{name:"One-time activity giveaway",value:"event"}))
    .addStringOption(o=>o.setName("name").setDescription("Saved watch, plan name or one-time giveaway ID").setRequired(true))
    .addRoleOption(o=>o.setName("role").setDescription("Role awarding additional chances").setRequired(true))
    .addIntegerOption(o=>o.setName("extra").setDescription("Additional chances above the base 1 (1–20)").setRequired(true).setMinValue(1).setMaxValue(20)))
  .addSubcommand(c=>c.setName("bonus-remove").setDescription("Remove a role's additional chances")
    .addStringOption(o=>o.setName("target").setDescription("Edit saved watch or plan").setRequired(true)
      .addChoices({name:"Saved watch",value:"watch"},{name:"Giveaway plan",value:"plan"},{name:"One-time activity giveaway",value:"event"}))
    .addStringOption(o=>o.setName("name").setDescription("Saved watch or plan name").setRequired(true))
    .addRoleOption(o=>o.setName("role").setDescription("Role to remove").setRequired(true)))
  .addSubcommand(c=>c.setName("bonus-list").setDescription("Review all role-based drawing chance bonuses")
    .addStringOption(o=>o.setName("target").setDescription("Saved watch or plan").setRequired(true)
      .addChoices({name:"Saved watch",value:"watch"},{name:"Giveaway plan",value:"plan"},{name:"One-time activity giveaway",value:"event"}))
    .addStringOption(o=>o.setName("name").setDescription("Saved watch or plan name").setRequired(true)));
}
export async function executeGiveawayRoleBonusAdmin(interaction){
 if(!interaction.guildId||!await canManageGiveaways(interaction))
   return interaction.editReply(giveawayManagerPermissionMessage);
 const op=interaction.options.getSubcommand();
 if(!ROLE_BONUS_OPERATIONS.has(op))throw Error("Unknown role bonus action.");
 const target=interaction.options.getString("target",true);
 const Model=target==="plan"?GiveawayPlan:target==="event"?Giveaway:GiveawayWatchRule;
 const raw=interaction.options.getString("name",true).trim();
 const key=target==="plan"?planNameKey(raw):watchNameKey(raw);
 const query=target==="event"?{
   guildId:interaction.guildId,_id:/^[0-9a-f]{24}$/i.test(raw)?raw:null,mode:"activity",
 }:{guildId:interaction.guildId,nameKey:key};
 const record=await Model.findOne(query);
 if(!record)throw Error("That saved watch, plan or activity giveaway does not exist.");
 if(target==="event" && !["draft","open"].includes(record.status) && op!=="bonus-list")
   throw Error("Role bonuses are locked after a one-time giveaway reaches its drawing cutoff.");
 const current=normalizeRoleBonuses(record.roleBonuses||[]);
 if(op==="bonus-list")return interaction.editReply({content:current.length?
   `**${record.name||record.title} — role-based chances**\n`+current.map(b=>`• <@&${b.roleId}>: +${b.extraEntries} chances`).join("\n")+
   "\nEach qualifying member remains one unique entrant; bonuses stack on role matches."
   :`No bonus roles for ${record.name||record.title}. Every qualifying member has one chance.`,
   allowedMentions:{parse:[]}});
 const role=interaction.options.getRole("role",true);
 const updated=current.filter(b=>b.roleId!==role.id);
 if(op==="bonus-add")updated.push({roleId:role.id,extraEntries:interaction.options.getInteger("extra",true)});
 if(op==="bonus-remove" && updated.length===current.length)
   throw Error("That role does not have a bonus on this watch or plan.");
 record.roleBonuses=normalizeRoleBonuses(updated);
 await record.save();
 if(target==="plan"||target==="event"){
   try {
     if(target==="plan")await publishActivityPlanListing(interaction.client,record);
     else if(record.status==="open")await publishActivityOneOffListing(interaction.client,record);
   }catch(error){console.error("[Giveaways] Role update directory refresh will retry:",error);}
 }
 return interaction.editReply({content:`Updated **${record.name||record.title}**: ${record.roleBonuses.length} bonus role(s). Each qualified member can win only once; every role's extra chances add to their draw weight.`,
   allowedMentions:{parse:[]}});
}
