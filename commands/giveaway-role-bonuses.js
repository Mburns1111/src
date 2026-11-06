import GiveawayPlan,{planNameKey} from "../models/GiveawayPlan.js";
import GiveawayWatchRule,{watchNameKey} from "../models/GiveawayWatchRule.js";
import {normalizeRoleBonuses} from "../services/giveaway-role-weights.js";
import {publishActivityPlanListing} from "../services/giveaway-directory.js";

export const ROLE_BONUS_OPERATIONS=new Set(["bonus-add","bonus-remove","bonus-list"]);
export function addGiveawayRoleBonusCommands(builder){
 return builder
  .addSubcommand(c=>c.setName("bonus-add").setDescription("Add or update an extra-drawing-chances role on a watch or plan")
    .addStringOption(o=>o.setName("target").setDescription("Save role bonus on watch or specific plan").setRequired(true)
      .addChoices({name:"Saved watch",value:"watch"},{name:"Giveaway plan",value:"plan"}))
    .addStringOption(o=>o.setName("name").setDescription("Saved watch or plan name").setRequired(true))
    .addRoleOption(o=>o.setName("role").setDescription("Role awarding additional chances").setRequired(true))
    .addIntegerOption(o=>o.setName("extra").setDescription("Additional chances above the base 1 (1–20)").setRequired(true).setMinValue(1).setMaxValue(20)))
  .addSubcommand(c=>c.setName("bonus-remove").setDescription("Remove a role's additional chances")
    .addStringOption(o=>o.setName("target").setDescription("Edit saved watch or plan").setRequired(true)
      .addChoices({name:"Saved watch",value:"watch"},{name:"Giveaway plan",value:"plan"}))
    .addStringOption(o=>o.setName("name").setDescription("Saved watch or plan name").setRequired(true))
    .addRoleOption(o=>o.setName("role").setDescription("Role to remove").setRequired(true)))
  .addSubcommand(c=>c.setName("bonus-list").setDescription("Review all role-based drawing chance bonuses")
    .addStringOption(o=>o.setName("target").setDescription("Saved watch or plan").setRequired(true)
      .addChoices({name:"Saved watch",value:"watch"},{name:"Giveaway plan",value:"plan"}))
    .addStringOption(o=>o.setName("name").setDescription("Saved watch or plan name").setRequired(true)));
}
export async function executeGiveawayRoleBonusAdmin(interaction){
 const op=interaction.options.getSubcommand();
 if(!ROLE_BONUS_OPERATIONS.has(op))throw Error("Unknown role bonus action.");
 const target=interaction.options.getString("target",true);
 const Model=target==="plan"?GiveawayPlan:GiveawayWatchRule;
 const key=target==="plan"?planNameKey(interaction.options.getString("name",true)):
   watchNameKey(interaction.options.getString("name",true));
 const record=await Model.findOne({guildId:interaction.guildId,nameKey:key});
 if(!record)throw Error("That saved watch or giveaway plan does not exist.");
 const current=normalizeRoleBonuses(record.roleBonuses||[]);
 if(op==="bonus-list")return interaction.editReply({content:current.length?
   `**${record.name} — role-based chances**\n`+current.map(b=>`• <@&${b.roleId}>: +${b.extraEntries} chances`).join("\n")+
   "\nEach qualifying member remains one unique entrant; bonuses stack on role matches."
   :`No bonus roles for ${record.name}. Every qualifying member has one chance.`,
   allowedMentions:{parse:[]}});
 const role=interaction.options.getRole("role",true);
 const updated=current.filter(b=>b.roleId!==role.id);
 if(op==="bonus-add")updated.push({roleId:role.id,extraEntries:interaction.options.getInteger("extra",true)});
 if(op==="bonus-remove" && updated.length===current.length)
   throw Error("That role does not have a bonus on this watch or plan.");
 record.roleBonuses=normalizeRoleBonuses(updated);
 await record.save();
 if(target==="plan"){
   try {await publishActivityPlanListing(interaction.client,record);}
   catch(error){console.error("[Giveaways] Role update directory refresh will retry:",error);}
 }
 return interaction.editReply({content:`Updated **${record.name}**: ${record.roleBonuses.length} bonus role(s). Each qualified member can win only once; every role's extra chances add to their draw weight.`,
   allowedMentions:{parse:[]}});
}
