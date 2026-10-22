import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import TradingPost from "../models/TradingPost.js";
import UserProfile from "../models/UserProfile.js";
import { discordMessageUrl } from "./shared.js";
import { UserFacingError } from "./errors.js";

const entryPostLocks = new Map();

export const entryButtonId = "tradingpost:entry";

function makeEntryComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(entryButtonId)
        .setLabel("Create or update my Trading Post")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function makeEntryPayload() {
  return {
    content: "**Trading Post**\nCreate one permanent card per member to find trading partners.",
    components: makeEntryComponents(),
    allowedMentions: { parse: [] },
  };
}

export async function ensureTradingPostEntry(guild, channel, { moveToBottom = false } = {}) {
  const key = guild.id;
  const currentLock = entryPostLocks.get(key);
  if (currentLock) {
    await currentLock;
    return ensureTradingPostEntry(guild, channel, { moveToBottom });
  }

  const operation = ensureTradingPostEntryOnce(guild, channel, moveToBottom);
  const trackedOperation = operation.finally(() => {
    if (entryPostLocks.get(key) === trackedOperation) entryPostLocks.delete(key);
  });
  entryPostLocks.set(key, trackedOperation);
  return trackedOperation;
}

async function ensureTradingPostEntryOnce(guild, channel, moveToBottom) {
  const config = await GuildConfig.findOne({ guildId: guild.id });
  const oldChannelId =
    config?.tradingPostEntryChannelId || config?.tradingPostChannelId || "";
  const oldMessageId = config?.tradingPostEntryMessageId ?? "";
  if (!moveToBottom && oldChannelId === channel.id && oldMessageId) {
    try {
      const oldMessage = await channel.messages.fetch(oldMessageId);
      if (oldMessage.pinned) await oldMessage.unpin();
      await oldMessage.edit(makeEntryPayload());
      return oldMessage;
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }

  const message = await channel.send(makeEntryPayload());
  try {
    if (oldChannelId && oldMessageId) {
      try {
        const oldChannel = await guild.channels.fetch(oldChannelId);
        const oldMessage = await oldChannel?.messages?.fetch(oldMessageId);
        if (oldMessage?.pinned) await oldMessage.unpin();
        await oldMessage?.delete();
      } catch (error) {
        if (![10003, 10008].includes(Number(error?.code))) throw error;
      }
    }
    await GuildConfig.updateOne(
      { guildId: guild.id },
      {
        $set: {
          tradingPostEntryChannelId: channel.id,
          tradingPostEntryMessageId: message.id,
        },
      },
    );
  } catch (error) {
    await message.delete().catch((deleteError) => {
      console.error("Could not remove the replacement Trading Post entry message:", deleteError);
    });
    throw error;
  }
  return message;
}

function makeTradingPostModal(ownerId, tradingPost = null) {
  const lookingFor = new TextInputBuilder()
    .setCustomId("looking_for")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(false)
    .setPlaceholder("What are you looking for?");
  if (tradingPost?.lookingFor) lookingFor.setValue(tradingPost.lookingFor);

  const willingToTrade = new TextInputBuilder()
    .setCustomId("willing_to_trade")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(false)
    .setPlaceholder("What are you willing to trade?");
  if (tradingPost?.willingToTrade) {
    willingToTrade.setValue(tradingPost.willingToTrade);
  }

  const notifyOnInterest = new StringSelectMenuBuilder()
    .setCustomId("notify_on_interest")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      {
        label: "No, just count interest on my card",
        value: "no",
        default: !tradingPost?.notifyOnInterest,
      },
      {
        label: "Yes, DM me when someone is interested",
        value: "yes",
        default: Boolean(tradingPost?.notifyOnInterest),
      },
    );

  return new ModalBuilder()
    .setCustomId(
      `tradingpost:${tradingPost ? "edit" : "create"}:${ownerId}`,
    )
    .setTitle(tradingPost ? "Edit your Trading Post" : "Create your Trading Post")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Looking for")
        .setTextInputComponent(lookingFor),
      new LabelBuilder()
        .setLabel("Willing to trade")
        .setTextInputComponent(willingToTrade),
      new LabelBuilder()
        .setLabel("Notify me about interest?")
        .setStringSelectMenuComponent(notifyOnInterest),
    );
}

function makeTradingPostComponents(post) {
  const userId = post.ownerId;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tradingpost:edit:${userId}`)
        .setLabel("Edit my card")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tradingpost:delete:${userId}`)
        .setLabel("Delete my card")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`tradingpost:interest:${userId}`)
        .setLabel(`Interested (${post.interestedUserIds.length})`)
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

async function makeTradingPostPayload(guild, post, member, profile) {
  const [houses, outfits] = await Promise.all([
    HouseListing.find({
      guildId: guild.id,
      ownerId: post.ownerId,
      status: "active",
      postChannelId: { $ne: "" },
      postMessageId: { $ne: "" },
    })
      .select("title postChannelId postMessageId createdAt")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
    OutfitListing.find({
      guildId: guild.id,
      ownerId: post.ownerId,
      status: "active",
      postChannelId: { $ne: "" },
      postMessageId: { $ne: "" },
    })
      .select("title postChannelId postMessageId createdAt")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
  ]);

  const inventoryLinks = [];
  if (profile?.inventoryVideoPostChannelId && profile.inventoryVideoPostMessageId) {
    inventoryLinks.push(
      `[Inventory video](${discordMessageUrl(
        guild.id,
        profile.inventoryVideoPostChannelId,
        profile.inventoryVideoPostMessageId,
      )})`,
    );
  } else if (profile?.inventoryVideoUrl) {
    inventoryLinks.push(`[Inventory video](${profile.inventoryVideoUrl})`);
  }
  for (const albumPost of [...(profile?.albumPosts ?? [])].slice(-2).reverse()) {
    inventoryLinks.push(
      `[Inventory photos](${discordMessageUrl(
        guild.id,
        albumPost.channelId,
        albumPost.messageId,
      )})`,
    );
  }
  const houseLinks = houses.map((listing) => {
    const url = discordMessageUrl(
      guild.id,
      listing.postChannelId,
      listing.postMessageId,
    );
    return `House: [${listing.title || "View listing"}](${url})`;
  });
  const outfitLinks = outfits.map((listing) => {
    const url = discordMessageUrl(
      guild.id,
      listing.postChannelId,
      listing.postMessageId,
    );
    return `Outfit: [${listing.title || "View listing"}](${url})`;
  });
  const willingDetails = [
    (post.willingToTrade || "Not specified").slice(0, 250),
    ...outfitLinks.slice(0, 3),
    ...houseLinks.slice(0, 3),
    ...inventoryLinks,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${post.discordName}'s Trading Post`)
    .addFields(
      {
        name: "Discord name",
        value: post.discordName,
        inline: true,
      },
      {
        name: "Roblox username",
        value: post.robloxName || "Not added yet",
        inline: true,
      },
      {
        name: "Looking for",
        value: post.lookingFor || "Not specified",
      },
      {
        name: "Willing to trade",
        value: willingDetails.slice(0, 1024),
      },
    )
    .setFooter({
      text: post.notifyOnInterest
        ? "The owner is opted in to interest DMs."
        : "Interest is tallied on this card.",
    })
    .setTimestamp(post.updatedAt);

  return {
    content: "",
    embeds: [embed],
    components: makeTradingPostComponents(post),
    allowedMentions: { parse: [] },
  };
}

export async function refreshTradingPostCard(guild, ownerId) {
  const tradingPost = await TradingPost.findOne({ guildId: guild.id, ownerId });
  if (!tradingPost) return null;
  const config = await GuildConfig.findOne({ guildId: guild.id });
  if (!config?.tradingPostChannelId) {
    throw new UserFacingError(
      "The Trading Post channel is not configured. Ask an admin to run `/setup channels`.",
    );
  }
  const channel = await guild.channels.fetch(config.tradingPostChannelId);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new UserFacingError("The configured Trading Post channel is unavailable.");
  }
  const [member, profile] = await Promise.all([
    guild.members.fetch(ownerId),
    UserProfile.findOne({ guildId: guild.id, discordUserId: ownerId }),
  ]);
  const oldChannelId = tradingPost.postChannelId;
  const oldMessageId = tradingPost.postMessageId;
  tradingPost.discordName = member.displayName;
  tradingPost.robloxName = profile?.adoptMeUsername ?? "";
  let message;

  if (
    tradingPost.postChannelId === channel.id &&
    tradingPost.postMessageId
  ) {
    try {
      message = await channel.messages.fetch(tradingPost.postMessageId);
      await message.edit(
        await makeTradingPostPayload(guild, tradingPost, member, profile),
      );
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }

  if (!message) {
    message = await channel.send(
      await makeTradingPostPayload(guild, tradingPost, member, profile),
    );
    tradingPost.postChannelId = channel.id;
    tradingPost.postMessageId = message.id;
  }
  await tradingPost.save();
  if (oldMessageId && oldMessageId !== message.id) {
    if (oldChannelId && oldMessageId) {
      try {
        const oldChannel = await guild.channels.fetch(oldChannelId);
        const oldMessage = await oldChannel?.messages?.fetch(oldMessageId);
        await oldMessage?.delete();
      } catch (error) {
        if (![10003, 10008].includes(Number(error?.code))) {
          console.error("Could not remove the previous Trading Post card:", error);
        }
      }
    }
  }
  return message;
}

export async function handleTradingPostEntryButton(interaction) {
  if (interaction.customId !== entryButtonId) return false;
  const tradingPost = await TradingPost.findOne({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
  });
  await interaction.showModal(
    makeTradingPostModal(interaction.user.id, tradingPost),
  );
  return true;
}

export async function handleTradingPostCardButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (
    !["edit", "delete", "interest"].includes(action) ||
    !/^\d{17,20}$/.test(ownerId ?? "")
  ) {
    throw new UserFacingError("That Trading Post button is not valid.");
  }

  const post = await TradingPost.findOne({
    guildId: interaction.guildId,
    ownerId,
    postChannelId: interaction.channelId,
    postMessageId: interaction.message.id,
  });
  if (!post) {
    throw new UserFacingError("This Trading Post card is no longer active.");
  }

  if (action === "edit") {
    if (interaction.user.id !== ownerId) {
      throw new UserFacingError("Only the card owner can edit this Trading Post.");
    }
    await interaction.showModal(makeTradingPostModal(ownerId, post));
    return;
  }

  if (action === "delete") {
    if (interaction.user.id !== ownerId) {
      throw new UserFacingError("Only the card owner can delete this Trading Post.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.message.delete();
    await TradingPost.deleteOne({ _id: post._id });
    await interaction.editReply({
      content: "Your Trading Post card was deleted.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (interaction.user.id === ownerId) {
    throw new UserFacingError("You can't mark yourself as interested in your own Trading Post.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const wasInterested = post.interestedUserIds.includes(interaction.user.id);
  const update = wasInterested
    ? { $pull: { interestedUserIds: interaction.user.id } }
    : { $addToSet: { interestedUserIds: interaction.user.id } };
  const updated = await TradingPost.findOneAndUpdate(
    {
      _id: post._id,
      guildId: interaction.guildId,
      ownerId,
      postMessageId: interaction.message.id,
    },
    update,
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) throw new UserFacingError("This Trading Post card is no longer active.");

  await refreshTradingPostCard(interaction.guild, ownerId);
  let notificationSent = false;
  if (!wasInterested && updated.notifyOnInterest) {
    try {
      const owner = await interaction.client.users.fetch(ownerId);
      await owner.send({
        content: `${interaction.user.username} is interested in your Trading Post in ${interaction.guild.name}.`,
        allowedMentions: { parse: [] },
      });
      notificationSent = true;
    } catch (error) {
      console.warn(`Could not DM Trading Post owner ${ownerId} about interest:`, error);
    }
  }
  await interaction.editReply({
    content: wasInterested
      ? "Your interest was removed from this Trading Post."
      : notificationSent
        ? "Your interest was added, and the owner was notified."
        : updated.notifyOnInterest
          ? "Your interest was added, but I couldn't DM the owner. Your interest is still tallied on the card."
          : "Your interest was added to the card.",
    allowedMentions: { parse: [] },
  });
}

export async function handleTradingPostModal(interaction) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (
    !["create", "edit"].includes(action) ||
    ownerId !== interaction.user.id
  ) {
    throw new UserFacingError("That Trading Post form is not yours to use.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await GuildConfig.findOne({ guildId: interaction.guildId });
  if (!config?.tradingPostChannelId) {
    throw new UserFacingError(
      "A server admin needs to configure the Trading Post channel with `/setup channels` first.",
    );
  }
  const member = await interaction.guild.members.fetch(ownerId);
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: ownerId,
  });
  const update = {
    discordName: member.displayName,
    robloxName: profile?.adoptMeUsername ?? "",
    lookingFor: interaction.fields.getTextInputValue("looking_for").trim(),
    willingToTrade: interaction.fields.getTextInputValue("willing_to_trade").trim(),
    notifyOnInterest:
      interaction.fields.getStringSelectValues("notify_on_interest")[0] === "yes",
  };
  let post;
  if (action === "edit") {
    post = await TradingPost.findOneAndUpdate(
      { guildId: interaction.guildId, ownerId },
      { $set: update },
      { returnDocument: "after", runValidators: true },
    );
    if (!post) throw new UserFacingError("Your Trading Post card no longer exists.");
  } else {
    try {
      post = await TradingPost.findOneAndUpdate(
        { guildId: interaction.guildId, ownerId },
        { $set: update },
        {
          upsert: true,
          returnDocument: "after",
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      post = await TradingPost.findOneAndUpdate(
        { guildId: interaction.guildId, ownerId },
        { $set: update },
        { returnDocument: "after", runValidators: true },
      );
      if (!post) throw error;
    }
  }

  const message = await refreshTradingPostCard(interaction.guild, ownerId);
  const channel = await interaction.guild.channels.fetch(config.tradingPostChannelId);
  await ensureTradingPostEntry(interaction.guild, channel, { moveToBottom: true });
  await interaction.editReply({
    content: `Your Trading Post card is ready: ${message.url}`,
    allowedMentions: { parse: [] },
  });
}
