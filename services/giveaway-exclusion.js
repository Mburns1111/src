import GuildConfig from "../models/GuildConfig.js";

// Exclusion applies only to regular and activity giveaways, never Court's Trials.
// Each giveaway can opt out; the server-wide role is checked at drawing time.
export function giveawayExclusionEnabled(record){
 return record?.mode!=="survival" && record?.enforceExclusionRole!==false;
}
export function memberPassesGiveawayExclusion(member,roleId,record){
 if(!roleId||!giveawayExclusionEnabled(record))return true;
 // A failed or incomplete role check must never grant an excluded member a win.
 return Boolean(member?.roles?.cache && !member.roles.cache.has(roleId));
}
export async function configuredGiveawayExclusionRole(guildId,record){
 if(!giveawayExclusionEnabled(record))return "";
 const config=await GuildConfig.findOne({guildId})
   .select("giveawayExcludedRoleId").lean();
 return String(config?.giveawayExcludedRoleId||"");
}
