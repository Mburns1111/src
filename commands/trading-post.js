
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
import { finalizeTradingPostDeletion } from "../services/trading-post-deletion.js";
import { awardMilestoneSafely } from "../services/points-rewards.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance, snapshotOwnedListingAppearance } from "../services/listing-appearance.js";
import { getAppearanceOwnership } from "../services/appearance-ownership.js";
import { renderPostImage } from "../services/post-renderer.js";
import { tradingPostCardPayload } from "../services/trading-post-display.js";
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
    content:
      "**Trading Post**\nCreate one permanent card per member to find trading partners.",
    components: makeEntryComponents(),
    allowedMentions: { parse: [] },
  };
}

export async function ensureTradingPostEntry(
  guild,
  channel,
  { moveToBottom = false } = {},
) {
  const key = guild.id;
  const currentLock = entryPostLocks.get(key);

  if (currentLock) {
    await currentLock;
    return ensureTradingPostEntry(guild, channel, { moveToBottom });
  }

  const operation = ensureTradingPostEntryOnce(guild, channel, moveToBottom);
  const trackedOperation = operation.finally(() => {
    if (entryPostLocks.get(key) === trackedOperation) {
      entryPostLocks.delete(key);
    }
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

      if (oldMessage.author.id === guild.client.user.id) {
        if (oldMessage.pinned) await oldMessage.unpin();
        await oldMessage.edit(makeEntryPayload());
        return oldMessage;
      }

      // The saved message belongs to the old bot.
      // Create a replacement below.
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

        // Never attempt to unpin or delete another bot's message.
        if (oldMessage?.author.id === guild.client.user.id) {
          if (oldMessage.pinned) await oldMessage.unpin();
          await oldMessage.delete();
        }
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
      console.error(
        "Could not remove the replacement Trading Post entry message:",
        deleteError,
      );
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
      status: "active", publicationState: { $ne: "staging" },
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
      status: "active", publicationState: { $ne: "staging" },
      postChannelId: { $ne: "" },
      postMessageId: { $ne: "" },
    })
      .select("title postChannelId postMessageId createdAt")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean(),
  ]);

  const inventoryLinks = [];

  if (
    profile?.inventoryVideoPostChannelId &&
    profile.inventoryVideoPostMessageId
  ) {
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

  for (const albumPost of [...(profile?.albumPosts ?? [])]
    .slice(-2)
    .reverse()) {
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

  const linkLines = [
    ...outfitLinks.slice(0, 3), ...houseLinks.slice(0, 3), ...inventoryLinks,
  ];
  const ownership = await getAppearanceOwnership(guild.id, post.ownerId);
  const cardImage = await renderPostImage({
    type: "tradingPost",
    data: {
      discordName: post.discordName,
      robloxName: post.robloxName,
      lookingFor: post.lookingFor,
      willingToTrade: post.willingToTrade,
    },
    appearance: displayListingAppearance(post, profile, ownership),
  });
  return tradingPostCardPayload(cardImage, linkLines, makeTradingPostComponents(post));
}

export async function refreshTradingPostCard(guild, ownerId) {
  const tradingPost = await TradingPost.findOne({
    guildId: guild.id,
    ownerId,
    deletePending: { $ne: true },
  });
  if (!tradingPost) return null;

  const config = await GuildConfig.findOne({ guildId: guild.id });

  if (!config?.tradingPostChannelId) {
    throw new UserFacingError(
      "The Trading Post channel is not configured. Ask an admin to run `/setup channels`.",
    );
  }

  const channel = await guild.channels.fetch(config.tradingPostChannelId);

  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new UserFacingError(
      "The configured Trading Post channel is unavailable.",
    );
  }

  const [member, profile] = await Promise.all([
    guild.members.fetch(ownerId),
    UserProfile.findOne({
      guildId: guild.id,
      discordUserId: ownerId,
    }),
  ]);

  // Legacy cards predate saved listing styles. Capture their starting appearance
  // once; do not keep inheriting future profile changes.
  if (!tradingPost.postAppearance) {
    tradingPost.postAppearance = await snapshotOwnedListingAppearance(guild.id, ownerId, profile);
    tradingPost.markModified("postAppearance");
  }

  const oldChannelId = tradingPost.postChannelId;
  const oldMessageId = tradingPost.postMessageId;

  tradingPost.discordName = member.displayName;
  tradingPost.robloxName = profile?.adoptMeUsername ?? "";

  let message;
  let newlySent = false;

  if (tradingPost.postChannelId === channel.id && tradingPost.postMessageId) {
    try {
      const existingMessage = await channel.messages.fetch(
        tradingPost.postMessageId,
      );

      if (existingMessage.author.id === guild.client.user.id) {
        message = await existingMessage.edit(
          await makeTradingPostPayload(guild, tradingPost, member, profile),
        );
      }
      // If the old bot authored the message, create a replacement below.
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
    newlySent = true;
  }

  try {
    await tradingPost.save();
  } catch (error) {
    if (newlySent) await message.delete().catch(cleanupError =>
      console.warn("[Trading Post] Untracked replacement could not be removed:", cleanupError));
    throw error;
  }

  // Leave messages authored by the old bot untouched.
  // Delete an earlier card only if this bot authored it.
  if (oldMessageId && oldMessageId !== message.id && oldChannelId) {
    try {
      const oldChannel = await guild.channels.fetch(oldChannelId);
      const oldMessage = await oldChannel?.messages?.fetch(oldMessageId);

      if (oldMessage?.author.id === guild.client.user.id) {
        await oldMessage.delete();
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) {
        console.error("Could not remove the previous Trading Post card:", error);
      }
    }
  }

  return message;
}


/**
 * Create the selected member's one Trading Post, never overwrite a card that
 * may contain unsaved changes or pending deletion. The member retains full
 * edit/delete/interest controls, and imports do not pay milestone Points.
 */
export async function importTradingPostForMember(interaction, {
  owner, lookingFor, willingToTrade, importedById,
}) {
  if (!owner?.id || !importedById) throw new UserFacingError("Choose a valid Trading Post owner.");
  if (typeof lookingFor !== "string" || lookingFor.length > 1000 ||
      typeof willingToTrade !== "string" || willingToTrade.length > 1000) {
    throw new UserFacingError("Trading Post fields must be at most 1000 characters.");
  }
  const channel = await getConfiguredTextChannel(interaction, "tradingPostChannelId", "Trading Post");
  const existing = await TradingPost.findOne({ guildId: interaction.guildId, ownerId: owner.id });
  if (existing) {
    throw new UserFacingError(existing.deletePending
      ? "This member's Trading Post deletion is pending. No import was performed."
      : "This member already has a Trading Post. No existing card or data was replaced.");
  }
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId, discordUserId: owner.id,
  });
  let record;
  try {
    record = await TradingPost.create({
      guildId: interaction.guildId, ownerId: owner.id,
      discordName: owner.displayName,
      robloxName: profile?.adoptMeUsername || "",
      lookingFor: lookingFor.trim(), willingToTrade: willingToTrade.trim(),
      notifyOnInterest: false,
      postAppearance: await snapshotOwnedListingAppearance(
        interaction.guildId, owner.id, profile),
      importedById,
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      throw new UserFacingError("This member's Trading Post was created while you were importing. No existing card was overwritten.");
    }
    throw error;
  }
  let post;
  try {
    post = await refreshTradingPostCard(interaction.guild, owner.id);
  } catch (error) {
    console.error("[Admin Trading Post import] Saved draft, card requires recovery:", record.id, error);
    throw new UserFacingError(
      "The member's Trading Post information was saved, but the card could not be published. " +
      "Ask a manager to check it before trying a second import. The saved data was preserved.",
    );
  }
  await ensureTradingPostEntry(interaction.guild, channel, { moveToBottom: true }).catch(error =>
    console.warn("[Admin Trading Post import] Could not reposition entry:", error));
  return post;
}

export async function handleTradingPostEntryButton(interaction) {
  if (interaction.customId !== entryButtonId) return false;

  const tradingPost = await TradingPost.findOne({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
  });
  if (tradingPost?.deletePending) {
    throw new UserFacingError("Your Trading Post is being deleted. Ask a server manager to check recovery if it persists.");
  }

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
    deletePending: { $ne: true },
  });

  if (!post) {
    throw new UserFacingError("This Trading Post card is no longer active.");
  }

  if (action === "edit") {
    if (interaction.user.id !== ownerId) {
      throw new UserFacingError(
        "Only the card owner can edit this Trading Post.",
      );
    }

    await interaction.showModal(makeTradingPostModal(ownerId, post));
    return;
  }

  if (action === "delete") {
    if (interaction.user.id !== ownerId) {
      throw new UserFacingError(
        "Only the card owner can delete this Trading Post.",
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reserved = await TradingPost.findOneAndUpdate({
      _id: post._id, guildId: interaction.guildId, ownerId,
      postMessageId: interaction.message.id, deletePending: { $ne: true },
    }, { $set: { deletePending: true } }, { returnDocument: "after" });
    if (!reserved) throw new UserFacingError("This Trading Post was already removed.");
    try {
      await finalizeTradingPostDeletion(interaction.guild, reserved, {
        knownMessage: interaction.message,
      });
      await interaction.editReply({
        content: "Your Trading Post card was deleted.",
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      // Keep the tombstone: startup recovery can finish this safely.
      console.error("[Trading Post] Deletion queued for retry:", error);
      await interaction.editReply({
        content: "Your deletion request was saved, but cleanup couldn't finish. The bot will retry after its next restart. Ask a server manager if the post remains.",
        allowedMentions: { parse: [] },
      });
    }

    return;
  }

  if (interaction.user.id === ownerId) {
    throw new UserFacingError(
      "You can't mark yourself as interested in your own Trading Post.",
    );
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

  if (!updated) {
    throw new UserFacingError("This Trading Post card is no longer active.");
  }

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
      console.warn(
        `Could not DM Trading Post owner ${ownerId} about interest:`,
        error,
      );
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
  if (await TradingPost.exists({ guildId: interaction.guildId, ownerId, deletePending: true })) {
    throw new UserFacingError("Your previous Trading Post deletion is still pending. It cannot be recreated yet.");
  }

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
      interaction.fields.getStringSelectValues("notify_on_interest")[0] ===
      "yes",
  };

  let post;

  if (action === "edit") {
    post = await TradingPost.findOneAndUpdate(
      { guildId: interaction.guildId, ownerId },
      { $set: update },
      { returnDocument: "after", runValidators: true },
    );

    if (!post) {
      throw new UserFacingError("Your Trading Post card no longer exists.");
    }
  } else {
    try {
      post = await TradingPost.findOneAndUpdate(
        { guildId: interaction.guildId, ownerId },
        { $set: update, $setOnInsert: {
          postAppearance: await snapshotOwnedListingAppearance(interaction.guildId, ownerId, profile),
        } },
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
  const channel = await interaction.guild.channels.fetch(
    config.tradingPostChannelId,
  );

  await ensureTradingPostEntry(interaction.guild, channel, {
    moveToBottom: true,
  });

  await interaction.editReply({
    content: `Your Trading Post card is ready: ${message.url}`,
    allowedMentions: { parse: [] },
  });
  await awardMilestoneSafely(interaction.guildId, ownerId,
    "tradingPostFirstPublished", String(post._id));
}

