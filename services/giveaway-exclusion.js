import GuildConfig from "../models/GuildConfig.js";

// A configured Giveaway Banned Role is an unconditional server-wide punishment.
// It does not expire, is not a giveaway cooldown, and cannot be overridden for
// individual events. Court's Trials are also prize giveaways.
export const giveawayBanMessage="You cannot enter giveaways while you have the server's Giveaway Banned role. Contact the server staff if you have questions.";

export async function configuredGiveawayBanRole(guildId,{required=false}={}){
 const config=await GuildConfig.findOne({guildId}).select("giveawayExcludedRoleId").lean();
 const roleId=String(config?.giveawayExcludedRoleId||"");
 if(required&&!roleId)throw Error("Set the required Giveaway Banned role in /setup giveaways or /setup activity-giveaways first.");
 return roleId;
}
export function memberPassesGiveawayBan(member,roleId){
 return !roleId?Boolean(member):Boolean(member?.roles?.cache && !member.roles.cache.has(roleId));
}
export async function isGiveawayBanned(guildId,member,roleId){
 const banned=roleId??await configuredGiveawayBanRole(guildId);
 return Boolean(banned && member?.roles?.cache?.has(banned));
}
export async function requireMemberNotBanned(guild,userId,{required=false}={}){
 if(!guild?.id)throw Error("A Discord server is required to check giveaway restrictions.");
 const roleId=await configuredGiveawayBanRole(guild.id,{required});
 if(!roleId)return null; // legacy giveaways created before mandatory setup.
 const member=await guild.members.fetch({user:userId,force:true});
 if(!member?.roles?.cache)throw Error("Could not verify giveaway eligibility for this member.");
 return member.roles.cache.has(roleId)?giveawayBanMessage:null;
}
