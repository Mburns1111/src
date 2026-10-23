
import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import GuildConfig from "../models/GuildConfig.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import TradeListing from "../models/TradeListing.js";
import TradingPost from "../models/TradingPost.js";
import UserProfile from "../models/UserProfile.js";

export const data = new SlashCommandBuilder()
  .setName("migrate-old-posts")
  .setDescription("Move saved bot posts to this bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function isMissingMessage(error) {
  return [10003, 10008].includes(Number(error?.code));
}

async function fetchOldMessage(guild, channelId, messageId) {
  if (!channelId || !messageId) return null;

  const channel = await guild.channels.fetch(channelId);

  if (!channel?.isTextBased() || !channel.messages) {
    throw new Error(`Channel ${channelId} is unavailable.`);
  }

  return channel.messages.fetch(messageId);
}

async function makeCopyPayload(message) {
  const files = [];

  for (const attachment of message.attachments.values()) {
    const response = await fetch(attachment.url);

    if (!response.ok) {
      throw new Error(
        `Could not download attachment "${attachment.name}" (HTTP ${response.status}).`,
      );
    }

    files.push({
      attachment: Buffer.from(await response.arrayBuffer()),
      name: attachment.name,
      description: attachment.description ?? undefined,
    });
  }

  return {
    content: message.content || "",
    embeds: message.embeds.map((embed) => embed.toJSON()),
    components: message.components.map((component) => component.toJSON()),
    files,
    allowedMentions: { parse: [] },
  };
}

async function deleteOldMessage(
  guild,
  channelId,
  messageId,
  newMessageId,
) {
  if (!channelId || !messageId || messageId === newMessageId) return;

  try {
    const oldMessage = await fetchOldMessage(
      guild,
      channelId,
      messageId,
    );

    if (oldMessage) await oldMessage.delete();
  } catch (error) {
    if (!isMissingMessage(error)) {
      throw error;
    }
  }
}

/**
 * Creates the new message, persists its ID, and only then deletes the old one.
 * If persistence fails, the new message is removed and the old one is retained.
 */
async function migrateMessage({
  guild,
  channelId,
  messageId,
  destinationChannelId,
  saveNewIds,
  description,
  results,
}) {
  if (!channelId || !messageId) {
    results.skipped++;
    return;
  }

  let newMessage;

  try {
    const oldMessage = await fetchOldMessage(
      guild,
      channelId,
      messageId,
    );

    if (!oldMessage) {
      results.skipped++;
      results.details.push(
        `Skipped ${description}: the old message could not be found.`,
      );
      return;
    }

    // Already belongs to this bot: no replacement is needed.
    if (oldMessage.author?.id === guild.client.user.id) {
      results.skipped++;
      return;
    }

    const targetChannel = await guild.channels.fetch(
      destinationChannelId || channelId,
    );

    if (!targetChannel?.isTextBased() || !targetChannel.messages) {
      throw new Error("The destination channel is unavailable.");
    }

    const payload = await makeCopyPayload(oldMessage);
    newMessage = await targetChannel.send(payload);

    try {
      await saveNewIds(newMessage);
    } catch (error) {
      await newMessage.delete().catch(() => {});
      newMessage = null;

      throw new Error(
        `Could not save replacement IDs: ${error.message}`,
      );
    }

    try {
      await deleteOldMessage(
        guild,
        channelId,
        messageId,
        newMessage.id,
      );
    } catch (error) {
      results.details.push(
        `Replacement saved for ${description}, but old-message deletion failed: ${error.message}`,
      );
    }

    results.migrated++;
  } catch (error) {
    results.failed++;
    results.details.push(`${description}: ${error.message}`);
  }
}

export async function execute(interaction) {
  // index.js already defers chat-input command interactions.
  // Use editReply() for responses from this command.

  if (!interaction.inGuild()) {
    await interaction.editReply(
      "This command can only be used in a server.",
    );
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.editReply(
      "You need Manage Server permission to run this migration.",
    );
    return;
  }

  // Do not call deferReply() here.
  // index.js has already deferred this interaction.

  const guild = interaction.guild;

  const results = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const config = await GuildConfig.findOne({
    guildId: guild.id,
  });

  if (!config) {
    await interaction.editReply(
      "No saved server configuration was found. Nothing was migrated.",
    );
    return;
  }

  // Entry buttons for each configured section.
  const entries = [
    {
      name: "House entry",
      channelField: "houseEntryChannelId",
      messageField: "houseEntryMessageId",
      targetField: "houseChannelId",
    },
    {
      name: "Outfit entry",
      channelField: "outfitEntryChannelId",
      messageField: "outfitEntryMessageId",
      targetField: "outfitChannelId",
    },
    {
      name: "Inventory entry",
      channelField: "inventoryEntryChannelId",
      messageField: "inventoryEntryMessageId",
      targetField: "inventoryChannelId",
    },
    {
      name: "Profile entry",
      channelField: "profileEntryChannelId",
      messageField: "profileEntryMessageId",
      targetField: "profileChannelId",
    },
    {
      name: "Trade-voting entry",
      channelField: "tradeVoteEntryChannelId",
      messageField: "tradeVoteEntryMessageId",
      targetField: "tradeVoteChannelId",
    },
    {
      name: "Trading Post entry",
      channelField: "tradingPostEntryChannelId",
      messageField: "tradingPostEntryMessageId",
      targetField: "tradingPostChannelId",
    },
  ];

  for (const entry of entries) {
    const oldChannelId = config[entry.channelField];
    const oldMessageId = config[entry.messageField];

    const targetChannelId =
      config[entry.targetField] || oldChannelId;

    if (!oldChannelId || !oldMessageId) {
      results.skipped++;
      continue;
    }

    await migrateMessage({
      guild,
      channelId: oldChannelId,
      messageId: oldMessageId,
      destinationChannelId: targetChannelId,
      description: entry.name,
      results,

      saveNewIds: async (message) => {
        await GuildConfig.updateOne(
          { guildId: guild.id },
          {
            $set: {
              [entry.channelField]: message.channelId,
              [entry.messageField]: message.id,
            },
          },
        );

        config[entry.channelField] = message.channelId;
        config[entry.messageField] = message.id;
      },
    });
  }

  // House listings, including saved sold listings.
  const houses = await HouseListing.find({
    guildId: guild.id,
  });

  for (const listing of houses) {
    await migrateMessage({
      guild,
      channelId: listing.postChannelId,
      messageId: listing.postMessageId,
      destinationChannelId:
        config.houseChannelId || listing.postChannelId,
      description: `House listing ${listing._id}`,
      results,

      saveNewIds: async (message) => {
        listing.postChannelId = message.channelId;
        listing.postMessageId = message.id;
        await listing.save();
      },
    });
  }

  // Outfit listings, including saved sold listings.
  const outfits = await OutfitListing.find({
    guildId: guild.id,
  });

  for (const listing of outfits) {
    await migrateMessage({
      guild,
      channelId: listing.postChannelId,
      messageId: listing.postMessageId,
      destinationChannelId:
        config.outfitChannelId || listing.postChannelId,
      description: `Outfit listing ${listing._id}`,
      results,

      saveNewIds: async (message) => {
        listing.postChannelId = message.channelId;
        listing.postMessageId = message.id;
        await listing.save();
      },
    });
  }

  // Trade listings, including saved vote data and interactive controls.
  const trades = await TradeListing.find({
    guildId: guild.id,
  });

  for (const listing of trades) {
    await migrateMessage({
      guild,
      channelId: listing.postChannelId,
      messageId: listing.postMessageId,
      destinationChannelId: listing.postChannelId,
      description: `Trade listing ${listing._id}`,
      results,

      saveNewIds: async (message) => {
        listing.postChannelId = message.channelId;
        listing.postMessageId = message.id;
        await listing.save();
      },
    });
  }

  // Individual Trading Post cards.
  const tradingPosts = await TradingPost.find({
    guildId: guild.id,
  });

  for (const post of tradingPosts) {
    await migrateMessage({
      guild,
      channelId: post.postChannelId,
      messageId: post.postMessageId,
      destinationChannelId:
        config.tradingPostChannelId || post.postChannelId,
      description: `Trading Post card for ${post.ownerId}`,
      results,

      saveNewIds: async (message) => {
        post.postChannelId = message.channelId;
        post.postMessageId = message.id;
        await post.save();
      },
    });
  }

  // Member profile cards, inventory videos, and album posts.
  const profiles = await UserProfile.find({
    guildId: guild.id,
  });

  for (const profile of profiles) {
    if (
      profile.profileCardChannelId &&
      profile.profileCardMessageId
    ) {
      await migrateMessage({
        guild,
        channelId: profile.profileCardChannelId,
        messageId: profile.profileCardMessageId,
        destinationChannelId:
          config.profileChannelId ||
          profile.profileCardChannelId,
        description: `Profile card for ${profile.discordUserId}`,
        results,

        saveNewIds: async (message) => {
          profile.profileCardChannelId = message.channelId;
          profile.profileCardMessageId = message.id;
          await profile.save();
        },
      });
    } else {
      results.skipped++;
    }

    if (
      profile.inventoryVideoPostChannelId &&
      profile.inventoryVideoPostMessageId
    ) {
      await migrateMessage({
        guild,
        channelId: profile.inventoryVideoPostChannelId,
        messageId: profile.inventoryVideoPostMessageId,
        destinationChannelId:
          config.inventoryChannelId ||
          profile.inventoryVideoPostChannelId,
        description: `Inventory video for ${profile.discordUserId}`,
        results,

        saveNewIds: async (message) => {
          profile.inventoryVideoPostChannelId = message.channelId;
          profile.inventoryVideoPostMessageId = message.id;
          await profile.save();
        },
      });
    } else {
      results.skipped++;
    }

    // Save each album-post ID independently so one failure
    // doesn't block the rest.
    for (let i = 0; i < profile.albumPosts.length; i++) {
      const albumPost = profile.albumPosts[i];

      await migrateMessage({
        guild,
        channelId: albumPost.channelId,
        messageId: albumPost.messageId,
        destinationChannelId:
          config.inventoryChannelId || albumPost.channelId,
        description:
          `Inventory album post for ${profile.discordUserId}`,
        results,

        saveNewIds: async (message) => {
          profile.albumPosts[i].channelId = message.channelId;
          profile.albumPosts[i].messageId = message.id;
          await profile.save();
        },
      });
    }
  }

  const detailText = results.details.length
    ? "\n\nDetails:\n" + results.details.slice(0, 15).join("\n")
    : "";

  const remainingCount = Math.max(
    0,
    results.details.length - 15,
  );

  const moreText = remainingCount
    ? `\n…and ${remainingCount} more detail(s).`
    : "";

  await interaction.editReply({
    content:
      `**Migration finished**\n` +
      `Replaced: ${results.migrated}\n` +
      `Skipped: ${results.skipped}\n` +
      `Failed: ${results.failed}` +
      detailText +
      moreText,
    allowedMentions: { parse: [] },
  });
}
