import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";

const entryLocks = new Map();

// Serialize replacements so concurrent posts cannot leave duplicate channel buttons.
export async function ensureChannelEntry(
  guild,
  channel,
  { channelField, messageField, customId, label, description, moveToBottom = false },
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
    });
  }

  const operation = ensureChannelEntryOnce(guild, channel, {
    channelField,
    messageField,
    customId,
    label,
    description,
    moveToBottom,
  });
  const trackedOperation = operation.finally(() => {
    if (entryLocks.get(key) === trackedOperation) entryLocks.delete(key);
  });
  entryLocks.set(key, trackedOperation);
  return trackedOperation;
}

async function ensureChannelEntryOnce(
  guild,
  channel,
  { channelField, messageField, customId, label, description, moveToBottom },
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
      ),
    ],
    allowedMentions: { parse: [] },
  };

  if (!moveToBottom && oldChannelId === channel.id && oldMessageId) {
    try {
      const message = await channel.messages.fetch(oldMessageId);
      await message.edit(payload);
      return message;
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }

  // Reposting is how the persistent entry button stays at the bottom of busy channels.
  const message = await channel.send(payload);
  try {
    if (oldChannelId && oldMessageId) {
      try {
        const oldChannel = await guild.channels.fetch(oldChannelId);
        const oldMessage = await oldChannel?.messages?.fetch(oldMessageId);
        await oldMessage?.delete();
      } catch (error) {
        if (![10003, 10008].includes(Number(error?.code))) throw error;
      }
    }
    await GuildConfig.updateOne(
      { guildId: guild.id },
      { $set: { [channelField]: channel.id, [messageField]: message.id } },
    );
  } catch (error) {
    await message.delete().catch((deleteError) => {
      console.error(`Could not remove the replacement ${label} entry message:`, deleteError);
    });
    throw error;
  }
  return message;
}
