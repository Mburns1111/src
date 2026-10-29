// One Discord user owns release-wide card settings across all guilds.
// This is a Discord user ID (snowflake), NOT a password, token, or role ID.
export const CARD_OWNER_ENV_KEY = "CARD_GAME_OWNER_DISCORD_ID";

export function isCardGameOwner(discordUserId, env = process.env) {
  const configuredId = String(env?.[CARD_OWNER_ENV_KEY] ?? "").trim();
  return /^\d{17,20}$/.test(configuredId) && String(discordUserId ?? "") === configuredId;
}

export function assertCardGameOwner(discordUserId, env = process.env) {
  if (!isCardGameOwner(discordUserId, env)) {
    throw new Error("Only the card-game owner can manage releases or artwork. Check the owner ID secret if you are the owner.");
  }
}
