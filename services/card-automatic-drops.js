import { randomInt } from "node:crypto";
import {isCardGameEnabled,isCardGameTestMode} from "./card-game-mode.js";
import GuildConfig from "../models/GuildConfig.js";
import CardRelease from "../models/CardRelease.js";
import CardDrop from "../models/CardDrop.js";
import { qualifyingMessageText } from "./activity-rewards.js";
import { publishCardDrop } from "../commands/cards.js";

// The two systems are independent: every server gets a timed egg every
// 45-75 minutes, plus an occasional extra egg for genuine conversation.
export const AUTO_DROP_MIN_MINUTES = 45;
export const AUTO_DROP_MAX_MINUTES = 75;
export const ACTIVITY_WINDOW_MS = 10 * 60_000;
export const ACTIVITY_MESSAGES_REQUIRED = 12;
export const ACTIVITY_MEMBERS_REQUIRED = 3;
export const ACTIVITY_USER_COOLDOWN_MS = 60_000;
export const ACTIVITY_ROLL_COOLDOWN_MS = 10 * 60_000;
export const ACTIVITY_CHANCE = 0.20;
export const ACTIVITY_BONUS_COOLDOWN_MS = 30 * 60_000;
export const AUTOMATIC_EGG_SPACING_MS = 15 * 60_000;

export function nextTimedDrop(now = new Date(), randint = randomInt) {
  const minutes = randint(AUTO_DROP_MIN_MINUTES, AUTO_DROP_MAX_MINUTES + 1);
  return new Date(now.getTime() + minutes * 60_000);
}

// Every server that has both a Hatchem channel and Card role uses the same
// fixed game rules automatically. Server managers cannot alter drop frequency
// or disable the system. A conditional update initializes only missing due
// times, so restarts and parallel workers never reset the current schedule.
export async function initializeAutomaticDropSchedules(now = new Date()) {
  const configs = await GuildConfig.find({
    hatchemChannelId: { $type: "string", $ne: "" },
    cardRoleId: { $type: "string", $ne: "" },
    hatchemNextAutoDropAt: null,
  }).select("guildId").limit(100).lean();
  let initialized = 0;
  for (const config of configs) {
    const result = await GuildConfig.updateOne({
      guildId: config.guildId,
      hatchemChannelId: { $type: "string", $ne: "" },
      cardRoleId: { $type: "string", $ne: "" },
      hatchemNextAutoDropAt: null,
    }, { $set: { hatchemNextAutoDropAt: nextTimedDrop(now) } });
    initialized += result.modifiedCount || 0;
  }
  return initialized;
}

export function chooseAutomaticDropRelease(releases, allowTest = false) {
  return releases.find(r => !r.releaseId.startsWith("test-")) ||
    (allowTest ? releases.find(r => r.releaseId === "test-s1-r1") : null) || null;
}

// Shared, conditional MongoDB writes ensure that parallel bot processes and
// reconnects cannot claim the same timed slot or activity reward window.
// The last-post check spaces timed and activity eggs at least 15 minutes apart.
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

// The timed schedule remains independent of bonuses. If another auto egg is
// open or was posted in the last 15 minutes, the due slot stays due until it
// can safely post. A failed send never creates an endless immediate retry.
export async function reconcileAutomaticCardDrops(client, now = new Date()) {
  if (!isCardGameEnabled()) return 0;
  await initializeAutomaticDropSchedules(now);
  const configs = await GuildConfig.find({
    hatchemNextAutoDropAt: { $lte: now },
    hatchemChannelId: { $type: "string", $ne: "" },
    cardRoleId: { $type: "string", $ne: "" },
  }).select("guildId hatchemChannelId cardRoleId").lean();
  if (!configs.length) return 0;
  const release = await chooseCurrentRelease();
  if (!release) return 0;

  let published = 0;
  for (const config of configs) {
    try {
      if (await hasOpenCardEgg(config.guildId, now)) continue;
      const claimed = await GuildConfig.findOneAndUpdate({
        guildId: config.guildId,
        hatchemChannelId: { $type: "string", $ne: "" },
        cardRoleId: { $type: "string", $ne: "" },
        hatchemNextAutoDropAt: { $lte: now },
        hatchemLastAutoDropAt: lastEggIsOldEnough(now),
      }, { $set: {
        hatchemNextAutoDropAt: nextTimedDrop(now),
        hatchemLastAutoDropAt: now,
      } }, { returnDocument: "after" }).lean();
      if (!claimed) continue;
      await sendAutomaticEgg(client, claimed, release.releaseId);
      published++;
    } catch (error) {
      console.error("[Hatchem] Timed egg failed in server " + config.guildId + ":", error);
    }
  }
  return published;
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

// A successful qualifying burst produces one 20% chance. At most one
// activity bonus every 30m per server; and no two auto eggs within 15m.
export async function maybePublishActivityEgg(client, message, {
  now = new Date(), random = Math.random,
} = {}) {
  if (!isCardGameEnabled()) return false;
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
