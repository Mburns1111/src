// Keep public bot commands and guided giveaway creation in the dedicated
// commands channel. The private giveaway staff channel is reserved for staff
// records, approval controls and the sticky directory, not slash commands.
const giveawayNames=new Set(["giveaway","giveaway-role"]);

export function allowedCommandChannels(commandName,config){
  const ids=[config?.commandChannelId];
  // Court's Trials have their own dedicated public Trial channel as before;
  // they are not permitted in the private giveaway staff channel.
  if(commandName==="trial")ids.push(config?.survivalTrialChannelId);
  return [...new Set(ids.filter(Boolean))];
}

export function commandChannelRestriction(commandName,channelId,config){
  const allowed=allowedCommandChannels(commandName,config);
  if(!allowed.length||allowed.includes(channelId))return null;
  if(giveawayNames.has(commandName))
    return "Use giveaway commands in "+allowed.map(id=>"<#"+id+">").join(" or ")+
      ". The private giveaway staff channel is for records and staff buttons only.";
  if(commandName==="trial")
    return "Use Court's Trial commands in "+allowed.map(id=>"<#"+id+">").join(" or ")+".";
  return "Please use bot commands in <#"+config.commandChannelId+">.";
}
