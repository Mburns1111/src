import {PermissionFlagsBits} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";

// Giveaway Manager is a *guild-scoped, role-based* delegation. It grants only
// giveaway / Trial operations, never /setup or unrelated server administration.
// Never trust a role ID from user input; it must match the guild's saved config.
export function memberCanManageGiveaways(interaction,config){
  if(interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild))return true;
  const roleId=String(config?.giveawayManagerRoleId||"");
  if(!roleId||!interaction?.guildId)return false;
  const roles=interaction.member?.roles;
  if(Array.isArray(roles))return roles.includes(roleId);
  if(roles?.cache?.has)return roles.cache.has(roleId);
  if(typeof roles?.has==="function")return roles.has(roleId);
  return false;
}

export async function canManageGiveaways(interaction,{config=null}={}){
  if(interaction?.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild))return true;
  if(!interaction?.guildId)return false;
  const settings=config||await GuildConfig.findOne({guildId:interaction.guildId})
    .select("giveawayManagerRoleId").lean();
  if(!settings?.giveawayManagerRoleId)return false;
  if(memberCanManageGiveaways(interaction,settings))return true;
  // Some test/partial Discord interactions have no member-role collection.
  // Check a fresh guild member when the interaction does not include roles.
  // If the interaction includes roles and the role is missing, deny directly.
  if(interaction.member?.roles!=null)return false;
  const member=await interaction.guild?.members?.fetch?.({user:interaction.user?.id,force:true})
    .catch(()=>null);
  return Boolean(member?.roles?.cache?.has?.(settings.giveawayManagerRoleId));
}

export const giveawayManagerPermissionMessage=
  "You need **Manage Server** or the configured **Giveaway Manager** role to manage giveaways.";
