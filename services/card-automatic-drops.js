import {isCardGameEnabled,isCardGameTestMode} from "./card-game-mode.js";
import GuildConfig from "../models/GuildConfig.js";
import CardRelease from "../models/CardRelease.js";
import CardDrop from "../models/CardDrop.js";
import { qualifyingMessageText } from "./activity-rewards.js";
import { publishCardDrop } from "../commands/cards.js";

export const ACTIVITY_WINDOW_MS = 10 * 60_000;
export const ACTIVITY_MESSAGES_REQUIRED = 12;
export const ACTIVITY_MEMBERS_REQUIRED = 3;
export const ACTIVITY_USER_COOLDOWN_MS = 60_000;
export const ACTIVITY_ROLL_COOLDOWN_MS = 10 * 60_000;
export const ACTIVITY_CHANCE = 0.20;
export const ACTIVITY_BONUS_COOLDOWN_MS = 30 * 60_000;
export const AUTOMATIC_EGG_SPACING_MS = 15 * 60_000;

export function chooseAutomaticDropRelease(releases, allowTest = false) {
  return releases.find(r => !r.releaseId.startsWith("test-")) ||
    (allowTest ? releases.find(r => r.releaseId === "test-s1-r1") : null) || null;
}

function lastEggIsOldEnough(now) {
  return { $not: { $gt: new Date(now.getTime() - AUTOMATIC_EGG_SPACING_MS) } };
}

async function chooseCurrentRelease() {
  const releases = await CardRelease.find({ status: "active" })
    .select("releaseId").sort({ createdAt: -1, _id: -1 }).limit(40).lean();
  return chooseAutomaticDropRelease(releases, isCardGameTestMode());
}

async function hasOpenCardEgg(guildId, now) {
  // Never put an automatic egg on top of an ongoing player or test egg.
  return Boolean(await CardDrop.exists({
    guildId, status: "open", expiresAt: { $gt: now },
  }));
}

async function sendAutomaticEgg(client, config, releaseId) {
  const channel = await client.channels.fetch(config.hatchemChannelId);
  if (!channel || channel.guildId !== config.guildId || typeof channel.send !== "function")
    throw Error("Configured Hatchem channel is missing or cannot receive messages.");
  // Do not post an unannounced activity egg if the saved role was deleted
  // or no longer belongs to this server. Discord receives an explicit
  // allowedMentions.roles whitelist on the initial notification only.
  const role = await channel.guild?.roles?.fetch(config.cardRoleId).catch(() => null);
  if (!role || role.guild.id !== config.guildId)
    throw Error("Configured Hatchem Card role is missing; run /cards-admin setup-role.");
  await publishCardDrop({
    user: { id: client.user.id },
    guildId: config.guildId,
    channelId: channel.id,
    channel,
    editReply: async message => {
      throw Error(typeof message === "string" ? message : "Automatic drop was rejected.");
    },
    suppressSuccessDropReply: async () => null,
  }, { releaseId, testMode: false, automated: true, roleId: config.cardRoleId });
}

// Activity is observed in memory only. Message content is neither retained
// nor recorded: keep just user IDs and timestamps for the rolling 10m window.
// Per-member pacing plus 3 distinct people prevent one spammer generating eggs.
// Persistent MongoDB limits below remain authoritative across bot processes.
const activity = new Map();
const MAX_ACTIVITY_GUILDS = 500;
const MAX_EVENTS_PER_GUILD = 150;
export function clearAutomaticDropActivityForTests() { activity.clear(); }

export function observeAutomaticDropActivity(message, now = new Date()) {
  if (!message?.guildId || !message.author?.id || message.author.bot ||
      message.webhookId || message.system || !qualifyingMessageText(message.content))
    return false;

  for (const [id, state] of activity) {
    if (state.updatedAt < now.getTime() - ACTIVITY_WINDOW_MS) activity.delete(id);
  }
  let state = activity.get(message.guildId);
  if (!state) {
    if (activity.size >= MAX_ACTIVITY_GUILDS) activity.delete(activity.keys().next().value);
    state = { events: [], lastPerUser: new Map(), lastRollAt: 0, updatedAt: 0 };
    activity.set(message.guildId, state);
  }
  const ts = now.getTime();
  state.updatedAt = ts;
  state.events = state.events.filter(e => e.at > ts - ACTIVITY_WINDOW_MS);
  for (const [id, time] of state.lastPerUser)
    if (time <= ts - ACTIVITY_USER_COOLDOWN_MS) state.lastPerUser.delete(id);
  if (ts - (state.lastPerUser.get(message.author.id) || 0) < ACTIVITY_USER_COOLDOWN_MS)
    return false;
  state.lastPerUser.set(message.author.id, ts);
  state.events.push({ userId: message.author.id, at: ts });
  if (state.events.length > MAX_EVENTS_PER_GUILD)
    state.events.splice(0, state.events.length - MAX_EVENTS_PER_GUILD);

  if (state.events.length < ACTIVITY_MESSAGES_REQUIRED ||
      new Set(state.events.map(e => e.userId)).size < ACTIVITY_MEMBERS_REQUIRED ||
      ts - state.lastRollAt < ACTIVITY_ROLL_COOLDOWN_MS) return false;
  state.events = [];
  state.lastRollAt = ts;
  return true; // One chance roll, not one guaranteed egg.
}

// Each qualifying burst gets one 20% chance. At most one successful activity
// egg every 30m in a server. Player-created drops remain independent.
export async function maybePublishActivityEgg(client, message, {
  now = new Date(), random = Math.random,
} = {}) {
  if (!isCardGameEnabled()) return false;
  if (isCardGameTestMode() && message.guildId !== process.env.DISCORD_GUILD_ID) return false;
  if (!observeAutomaticDropActivity(message, now)) return false;
  if (random() >= ACTIVITY_CHANCE) return false;
  if (await hasOpenCardEgg(message.guildId, now)) return false;
  const release = await chooseCurrentRelease();
  if (!release) return false;

  const claimed = await GuildConfig.findOneAndUpdate({
    guildId: message.guildId,
    hatchemChannelId: { $type: "string", $ne: "" },
    cardRoleId: { $type: "string", $ne: "" },
    hatchemLastAutoDropAt: lastEggIsOldEnough(now),
    hatchemNextActivityDropAt: { $not: { $gt: now } },
  }, { $set: {
    hatchemNextActivityDropAt: new Date(now.getTime() + ACTIVITY_BONUS_COOLDOWN_MS),
    hatchemLastAutoDropAt: now,
  } }, { returnDocument: "after" }).lean();
  if (!claimed) return false;
  try {
    await sendAutomaticEgg(client, claimed, release.releaseId);
    return true;
  } catch (error) {
    console.error("[Hatchem] Activity bonus egg failed in server " + message.guildId + ":", error);
    return false;
  }
}
