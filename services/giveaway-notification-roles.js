// One shared giveaway announcement role across regular giveaways, activity
// giveaways (including recurring plans) and Court's Trials.
//
// Read old fields for existing guilds so deployments never require resetting
// configuration. The historical regular giveaway role wins if older settings
// contain different roles; administrators can change it in any guided setup.
export function sharedGiveawayPingRoleId(config){
  if(config?.giveawayPingRoleId)return String(config.giveawayPingRoleId);
  for(const roles of [config?.giveawayNotificationRoleIds,
    config?.activityNotificationRoleIds,config?.trialNotificationRoleIds]){
    if(Array.isArray(roles)&&roles.find(Boolean))return String(roles.find(Boolean));
  }
  return config?.survivalTrialPingRoleId?String(config.survivalTrialPingRoleId):"";
}

export function sharedGiveawayNotificationFields(roleId){
  const id=String(roleId||"");
  const roles=id?[id]:[];
  return {
    giveawayPingRoleId:id,
    giveawayNotificationRoleIds:roles,
    activityNotificationRoleIds:roles,
    trialNotificationRoleIds:roles,
    survivalTrialPingRoleId:id,
  };
}

// Maintained as an alias for existing imports, but never returns >1 role.
export function regularGiveawayNotificationRoleIds(config){
  const role=sharedGiveawayPingRoleId(config);
  return role?[role]:[];
}
export function regularGiveawayNotificationFields(roles){
  return sharedGiveawayNotificationFields(Array.isArray(roles)?roles[0]:roles);
}
