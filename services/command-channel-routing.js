// Slash-command channel permissions. Special-purpose commands keep the
// established commands channel as an option, with an additional configured
// channel for staff giveaway administration and Court's Trials.
const giveawayNames=new Set(["giveaway","giveaway-role"]);

export function allowedCommandChannels(commandName,config){
  const ids=[config?.commandChannelId];
  if(giveawayNames.has(commandName))ids.push(config?.activityGiveawayReviewChannelId);
  else if(commandName==="trial")ids.push(config?.survivalTrialChannelId);
  return [...new Set(ids.filter(Boolean))];
}

export function commandChannelRestriction(commandName,channelId,config){
  const allowed=allowedCommandChannels(commandName,config);
  if(!allowed.length || allowed.includes(channelId))return null;
  if(giveawayNames.has(commandName))
    return "Use giveaway commands in "+allowed.map(id=>"<#"+id+">").join(" or ")+".";
  if(commandName==="trial")
    return "Use Court's Trial commands in "+allowed.map(id=>"<#"+id+">").join(" or ")+".";
  return "Please use bot commands in <#"+config.commandChannelId+">.";
}
