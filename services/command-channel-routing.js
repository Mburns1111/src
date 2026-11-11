// Public slash commands have their own home channels; staff tools use the
// private commands channel. Buttons and Hatchem text prefixes are separate.
const giveawayNames = new Set(["giveaway", "giveaway-role"]);
export function allowedCommandChannels(commandName, config) {
  if (commandName === "help") return []; // Unrestricted in server channels.
  if (commandName === "shop") return [config?.shopChannelId].filter(Boolean);
  if (commandName === "cards") return [config?.hatchemChannelId].filter(Boolean);
  return [config?.commandChannelId].filter(Boolean);
}
export function commandChannelRestriction(commandName, channelId, config) {
  if (commandName === "help") return null;
  if (commandName === "shop" && !config?.shopChannelId)
    return "The shop is not configured. Ask staff to run /setup general.";
  const allowed = allowedCommandChannels(commandName, config);
  // Initial setup must still be possible before a commands channel exists.
  if (!allowed.length) return null;
  if (allowed.includes(channelId)) return null;
  if (commandName === "shop") return "Use /shop browse in <#" + config.shopChannelId + ">.";
  if (commandName === "cards") return "Use Hatchem commands in <#" + config.hatchemChannelId + ">.";
  if (giveawayNames.has(commandName))
    return "Use giveaway staff commands in <#" + config.commandChannelId + ">.";
  return "Please use staff commands in <#" + config.commandChannelId + ">.";
}
