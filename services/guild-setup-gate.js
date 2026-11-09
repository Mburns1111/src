// A GuildConfig can exist before setup because unrelated features create it.
export function guildSetupComplete(config) {
  return Boolean(config?.initialSetupCompletedAt || config?.commandChannelId);
}

// Old Trial channels were saved with /setup channels: keep those guilds working.
export function trialSetupComplete(config) {
  return guildSetupComplete(config) &&
    Boolean(config?.trialSetupCompletedAt || config?.survivalTrialChannelId);
}
