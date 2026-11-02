import GuildConfig from "../models/GuildConfig.js";
import CardRelease from "../models/CardRelease.js";
import { publishCardDrop } from "../commands/cards.js";

export const AUTO_DROP_DEFAULT_MINUTES = 60;
export const AUTO_DROP_MINUTES_MIN = 15;
export const AUTO_DROP_MINUTES_MAX = 1440;

// Automatic drops are opt-in per server, and the next due time is durable.
// Existing guilds remain disabled until a server manager explicitly opts in.
export async function configureAutomaticDrops({ guildId, enabled, minutes, now = new Date() }) {
  if (!guildId || typeof enabled !== "boolean") throw Error("Specify a server and whether automatic drops are enabled.");
  const config = await GuildConfig.findOne({ guildId }).lean();
  if (!config?.hatchemChannelId) throw Error("Set up the Hatchem channel before enabling automatic drops.");
  const interval = minutes ?? config.hatchemAutoDropMinutes ?? AUTO_DROP_DEFAULT_MINUTES;
  if (!Number.isInteger(interval) || interval < AUTO_DROP_MINUTES_MIN || interval > AUTO_DROP_MINUTES_MAX)
    throw Error("Choose an interval between 15 and 1440 whole minutes.");
  const next = enabled ? new Date(now.getTime() + interval * 60_000) : null;
  await GuildConfig.updateOne({ guildId }, { $set: {
    hatchemAutoDropsEnabled: enabled,
    hatchemAutoDropMinutes: interval,
    hatchemNextAutoDropAt: next,
  } });
  return { enabled, minutes: interval, nextAt: next };
}

export function chooseAutomaticDropRelease(releases, allowTest = false) {
  return releases.find(r => !r.releaseId.startsWith("test-")) ||
    (allowTest ? releases.find(r => r.releaseId === "test-s1-r1") : null) || null;
}

// A conditional write on the GuildConfig row is the cross-process scheduler lock.
// Every due window is claimed before sending, so restarts/parallel bot processes
// cannot duplicate an egg. If Discord fails, log it and retry next window.
export async function reconcileAutomaticCardDrops(client, now = new Date()) {
  if (process.env.ENABLE_CARD_GAME_TEST !== "1") return 0;
  const configs = await GuildConfig.find({
    hatchemAutoDropsEnabled: true,
    hatchemNextAutoDropAt: { $lte: now },
    hatchemChannelId: { $ne: "" },
  }).select("guildId hatchemChannelId hatchemAutoDropMinutes").lean();
  if (!configs.length) return 0;
  const releases = await CardRelease.find({ status: "active" })
    .select("releaseId").sort({ createdAt: -1, _id: -1 }).limit(40).lean();
  const selected = chooseAutomaticDropRelease(releases, true);
  if (!selected) return 0;

  let published = 0;
  for (const config of configs) {
    const interval = config.hatchemAutoDropMinutes || AUTO_DROP_DEFAULT_MINUTES;
    if (!Number.isInteger(interval) || interval < AUTO_DROP_MINUTES_MIN || interval > AUTO_DROP_MINUTES_MAX) {
      console.error("[Hatchem] Invalid automatic drop interval for server", config.guildId);
      continue;
    }
    const claimed = await GuildConfig.findOneAndUpdate({
      guildId: config.guildId,
      hatchemAutoDropsEnabled: true,
      hatchemNextAutoDropAt: { $lte: now },
    }, { $set: { hatchemNextAutoDropAt: new Date(now.getTime() + interval * 60_000) } },
    { returnDocument: "after" }).lean();
    if (!claimed) continue;
    try {
      const channel = await client.channels.fetch(claimed.hatchemChannelId);
      if (!channel || channel.guildId !== claimed.guildId || typeof channel.send !== "function")
        throw Error("Configured Hatchem channel is missing or not sendable.");
      await publishCardDrop({
        user: { id: client.user.id },
        guildId: claimed.guildId,
        channelId: channel.id,
        channel,
        editReply: async message => { throw Error(typeof message === "string" ? message : "Automatic drop was rejected."); },
        suppressSuccessDropReply: async () => null,
      }, { releaseId: selected.releaseId, testMode: false, automated: true });
      published++;
    } catch (error) {
      console.error("[Hatchem] Automatic egg failed in server " + config.guildId + ":", error);
    }
  }
  return published;
}
