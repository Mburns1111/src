// One explicit switch for Hatchem gameplay, separate from the development
// tools. Production is opt-in and NEVER inferred from the deployment host.
export function cardGameMode(env = process.env) {
  const test = env.ENABLE_CARD_GAME_TEST === "1";
  const production = env.ENABLE_CARD_GAME === "1";
  if (test && production) throw Error(
    "Choose exactly one Hatchem mode: ENABLE_CARD_GAME_TEST=1 for development, or ENABLE_CARD_GAME=1 for production."
  );
  return test ? "test" : production ? "production" : "disabled";
}
export const isCardGameEnabled = (env = process.env) => cardGameMode(env) !== "disabled";
export const isCardGameTestMode = (env = process.env) => cardGameMode(env) === "test";
export const isCardGameProductionMode = (env = process.env) => cardGameMode(env) === "production";

// A production launch must be explicit, correctly configured and able to
// receive the dot-prefixed commands. No production activation happens here.
export function validateCardGameMode(env = process.env) {
  const mode = cardGameMode(env);
  if (mode !== "production") return mode;
  if (!/^\d{17,20}$/.test(String(env.CARD_GAME_OWNER_DISCORD_ID || "")))
    throw Error("Production Hatchem requires CARD_GAME_OWNER_DISCORD_ID (17–20 digits).");
  if (env.ENABLE_MESSAGE_CONTENT_INTENT !== "1")
    throw Error("Production Hatchem requires ENABLE_MESSAGE_CONTENT_INTENT=1 and the privileged intent enabled in the Discord Developer Portal.");
  return mode;
}
