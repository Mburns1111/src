// Regular and activity giveaways have independent notification-role defaults.
// giveawayPingRoleId is the earlier single-role field. Keep reading it for
// existing guilds that configured notifications before the guided setup.
export function regularGiveawayNotificationRoleIds(config){
  const saved=Array.isArray(config?.giveawayNotificationRoleIds)
    ?config.giveawayNotificationRoleIds:[];
  if(saved.length)return [...new Set(saved.filter(Boolean))].slice(0,10);
  return config?.giveawayPingRoleId?[String(config.giveawayPingRoleId)]:[];
}

export function regularGiveawayNotificationFields(roles){
  const normalized=[...new Set((roles||[]).filter(Boolean))].slice(0,10);
  return {
    giveawayNotificationRoleIds:normalized,
    // Update the old field too, so older consumers/records still see the first role.
    giveawayPingRoleId:normalized[0]||"",
  };
}
