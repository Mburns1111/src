
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";

const entryLocks = new Map();

export async function ensureChannelEntry(
  guild,
  channel,
  { channelField, messageField, customId, label, description, moveToBottom = false, extraButtons = [] },
) {
  const key = `${guild.id}:${channelField}`;
  const currentLock = entryLocks.get(key);

  if (currentLock) {
    await currentLock;
    return ensureChannelEntry(guild, channel, {
      channelField,
      messageField,
      customId,
      label,
      description,
      moveToBottom,
      extraButtons,
    });
  }

  const operation = ensureChannelEntryOnce(guild, channel, {
    channelField,
    messageField,
    customId,
    label,
    description,
    moveToBottom,
    extraButtons,
  });

  const trackedOperation = operation.finally(() => {
    if (entryLocks.get(key) === trackedOperation) {
      entryLocks.delete(key);
    }
  });

  entryLocks.set(key, trackedOperation);
  return trackedOperation;
}

async function ensureChannelEntryOnce(
  guild,
  channel,
  { channelField, messageField, customId, label, description, moveToBottom, extraButtons },
) {
  const config = await GuildConfig.findOne({ guildId: guild.id });
  const oldChannelId = config?.[channelField] ?? "";
  const oldMessageId = config?.[messageField] ?? "";

  const payload = {
    content: `**${label}**\n${description}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary),
        ...extraButtons.map(button => new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(ButtonStyle.Secondary)),
      ),
    ],
    allowedMentions: { parse: [] },
  };

  // Reuse the saved message only when this bot authored it.
  if (!moveToBottom && oldChannelId === channel.id && oldMessageId) {
    try {
      const message = await channel.messages.fetch(oldMessageId);

      if (message.author.id === guild.client.user.id) {
        await message.edit(payload);
        return message;
      }

      // The saved message belongs to the old bot.
      // Continue below and create a message owned by this bot.
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) {
        throw error;
      }
    }
  }

  // Do not retire the old button until the new one is saved in MongoDB.
  // This order makes a failed database write recoverable.
  const message = await channel.send(payload);
  try {
    const result = await GuildConfig.updateOne(
      { guildId: guild.id },
      { $set: { [channelField]: channel.id, [messageField]: message.id } },
      { upsert: true },
    );
    if (result.acknowledged === false) {
      throw new Error("Entry reference update was not acknowledged.");
    }
  } catch (error) {
    await message.delete().catch(cleanupError => {
      console.error(`Could not delete untracked ${label} entry:`, cleanupError);
    });
    throw error;
  }

  // Failure to remove a previous message is nonfatal: the new entry
  // and its persisted reference remain valid.
  if (oldChannelId && oldMessageId && oldMessageId !== message.id) {
    try {
      const oldChannel = await guild.channels.fetch(oldChannelId);
      const oldMessage = await oldChannel?.messages?.fetch(oldMessageId);
      if (oldMessage?.author?.id === guild.client.user.id) {
        await oldMessage.delete();
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) {
        console.warn(`Could not retire prior ${label} entry; new entry remains available:`, error);
      }
    }
  }
  return message;
}
