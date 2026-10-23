import MemberDmPanel from "../models/MemberDmPanel.js";
import { UserFacingError } from "../commands/errors.js";

// Prevent two fast clicks from creating duplicate messages in one running bot.
const openingPanels = new Map();

export function dmPanelUrl(channelId, messageId) {
  return `https://discord.com/channels/@me/${channelId}/${messageId}`;
}

export async function getOrCreateDmPanel({ guildId, user, kind, makeInitial, adoptExisting }) {
  const key = `${guildId}:${user.id}:${kind}`;
  if (openingPanels.has(key)) return openingPanels.get(key);
  const task = (async () => {
    const criteria = { guildId, discordUserId: user.id, kind };
    const stored = await MemberDmPanel.findOne(criteria);
    const channel = await user.createDM();

    if (stored?.messageId && stored.channelId === channel.id) {
      try {
        const message = await channel.messages.fetch(stored.messageId);
        if (message.author.id === channel.client.user.id) {
          return { message, panel: stored, created: false };
        }
      } catch (error) {
        if (![10008, 10003].includes(Number(error?.code))) throw error;
      }
    }

    // Adopt an earlier shop DM on upgrade if the bot already sent one. The
    // predicate must identify a message belonging to this same guild.
    if (!stored && adoptExisting) {
      const recent = await channel.messages.fetch({ limit: 50 });
      const found = recent.find(message =>
        message.author.id === channel.client.user.id && adoptExisting(message));
      if (found) {
        const panel = await MemberDmPanel.findOneAndUpdate(criteria, {
          $set: { channelId: channel.id, messageId: found.id },
        }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
        return { message: found, panel, created: false, adopted: true };
      }
    }

    // Only render and send new content if the old DM message is actually gone.
    const { payload, fields = {} } = await makeInitial();
    let message;
    try {
      message = await channel.send(payload);
    } catch (error) {
      if (Number(error?.code) === 50007) {
        throw new UserFacingError(
          "I couldn't send you a DM. Please allow direct messages from this server and try again.",
        );
      }
      throw error;
    }
    const panel = await MemberDmPanel.findOneAndUpdate(criteria, {
      $set: { channelId: channel.id, messageId: message.id, ...fields },
    }, { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
    return { message, panel, created: true };
  })();
  openingPanels.set(key, task);
  try {
    return await task;
  } finally {
    if (openingPanels.get(key) === task) openingPanels.delete(key);
  }
}
