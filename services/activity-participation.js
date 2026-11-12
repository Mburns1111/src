import GuildConfig from "../models/GuildConfig.js";

// Activity giveaways are opt-in. A missing setting, failed role lookup or
// missing role always means "do not record". This is independent of the
// optional regular giveaway entry role and of the notification/ping role.
const messageChecks = new WeakMap();

export function activityParticipationRole(config) {
  return String(config?.activityParticipationRoleId||"");
}

export function memberHasActivityParticipationRole(member, roleId) {
  return Boolean(roleId && member?.roles?.cache?.has(roleId));
}

export async function eligibleActivityParticipant(message) {
  if(!message?.guildId || !message?.guild?.members || !message?.author?.id ||
     message.author.bot || message.webhookId)return null;
  let pending=messageChecks.get(message);
  if(!pending){
    pending=(async()=>{
      const config=await GuildConfig.findOne({guildId:message.guildId})
        .select("activityParticipationRoleId").lean();
      const roleId=activityParticipationRole(config);
      if(!roleId)return null;
      // Force-fetch current roles so removing the opt-in role stops activity
      // counting even when an old GuildMember cache entry is still present.
      const member=await message.guild.members.fetch({user:message.author.id,force:true})
        .catch(()=>null);
      return memberHasActivityParticipationRole(member,roleId)?{roleId,member}:null;
    })();
    messageChecks.set(message,pending);
  }
  return pending;
}
