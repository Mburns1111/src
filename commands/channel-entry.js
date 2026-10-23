
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

  // Create a replacement entry owned by this bot.
  const message = await channel.send(payload);

  try {
    // Delete the old entry only after the replacement was successfully sent.
    if (oldChannelId && oldMessageId) {
      try {
        const oldChannel = await guild.channels.fetch(oldChannelId);
        const oldMessage = await oldChannel?.messages?.fetch(oldMessageId);

        // Only delete the old entry if it belongs to this bot.
        // Messages authored by the previous bot are left untouched.
        if (oldMessage?.author.id === guild.client.user.id) {
          await oldMessage.delete();
        }
      } catch (error) {
        if (![10003, 10008].includes(Number(error?.code))) {
          throw error;
        }
      }
    }

    await GuildConfig.updateOne(
      { guildId: guild.id },
      {
        $set: {
          [channelField]: channel.id,
          [messageField]: message.id,
        },
      },
    );
  } catch (error) {
    await message.delete().catch((deleteError) => {
      console.error(
        `Could not remove the replacement ${label} entry message:`,
        deleteError,
      );
    });

    throw error;
  }

  return message;
}
