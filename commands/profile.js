import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import UserProfile from "../models/UserProfile.js";
import { randomUUID } from "node:crypto";
import GuildConfig from "../models/GuildConfig.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import TradeListing from "../models/TradeListing.js";
import TradingPost from "../models/TradingPost.js";
import {
  discordMessageUrl,
  requireGuild,
  validateAttachments,
} from "./shared.js";
import { UserFacingError } from "./errors.js";
import {
  getProfileAlbumImages,
  getProfilePhotoStream,
  removeAllProfilePhotos,
  removeProfilePhotos,
  saveProfilePhotos,
} from "./profile-media.js";
import {
  saveInventoryVideoFile,
  saveInventoryVideoLink,
} from "./inventory-video.js";
import { getVoteCounts } from "./trade.js";
import { ensureChannelEntry } from "./channel-entry.js";
import { renderPostImage } from "../services/post-renderer.js";
import { APPEARANCE_CATALOG, resolveAppearance } from "../services/post-appearance.js";
import { getAppearanceOwnership, ownsAppearanceItem, filterOwnedAppearance, APPEARANCE_FIELD_CATEGORY } from "../services/appearance-ownership.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("View or update your member showcase profile")
  .addUserOption((option) =>
    option.setName("user").setDescription("View another member's profile"),
  );

const profileCardOperations = new Map();

export async function ensureProfileEntry(guild, channel, { moveToBottom = false } = {}) {
  return ensureChannelEntry(guild, channel, {
    channelField: "profileEntryChannelId",
    messageField: "profileEntryMessageId",
    customId: "profile:entry",
    label: "Create or update my profile",
    description: "Use the button to add your Roblox name and profile details.",
    moveToBottom,
    extraButtons: [
      { customId: "profile:entry:appearance", label: "Customize appearance" },
      { customId: "profile:entry:video", label: "Inventory video" },
      { customId: "profile:entry:photos", label: "Add/remove photos" },
    ],
  });
}

export async function handleProfileEntryButton(interaction) {
  if (!["profile:entry", "profile:entry:appearance", "profile:entry:video", "profile:entry:photos"].includes(interaction.customId)) return false;
  const profile = await ensureProfileRecord(interaction.guildId, interaction.user);
  if (interaction.customId === "profile:entry:appearance") {
    await openAppearanceDM(interaction, profile);
  } else if (interaction.customId === "profile:entry:photos") {
    await showPhotoActionPrompt(interaction, interaction.user.id);
  } else if (interaction.customId === "profile:entry:video") {
    await interaction.showModal(makeInventoryVideoModal(interaction.user.id));
  } else {
    await interaction.showModal(makeEditProfileModal(profile, interaction.user.id));
  }
  return true;
}

export async function ensureProfileRecord(guildId, user) {
  return UserProfile.findOneAndUpdate(
    { guildId, discordUserId: user.id },
    {
      $setOnInsert: {
        discordUsername: user.username,
        displayName: user.globalName ?? user.username,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );
}

export async function handleInventoryEntryButton(interaction) {
  if (interaction.customId !== "inventory:entry") return false;
  await interaction.showModal(
    makeInventoryVideoModal(interaction.user.id, { entryPoint: true }),
  );
  return true;
}

function makeProfileCardContent(profile, guildId, listingLinks) {
  const sections = [`<@${profile.discordUserId}>'s member profile`];
  const inventoryLinks = profile.albumPosts
    .filter(post => post.channelId !== profile.profileCardChannelId || post.messageId !== profile.profileCardMessageId)
    .slice(-8)
    .map(post => `• [Inventory photos](${discordMessageUrl(guildId, post.channelId, post.messageId)})`);
  const inventoryVideoUrl = profile.inventoryVideoPostChannelId && profile.inventoryVideoPostMessageId
    ? discordMessageUrl(guildId, profile.inventoryVideoPostChannelId, profile.inventoryVideoPostMessageId)
    : profile.inventoryVideoUrl;
  if (inventoryVideoUrl) inventoryLinks.unshift(`• [Inventory video](${inventoryVideoUrl})`);
  if (inventoryLinks.length) sections.push(`**Inventory**\n${inventoryLinks.join("\n")}`);

  for (const [label, listings] of [
    ["House listings", listingLinks.houses],
    ["Outfit listings", listingLinks.outfits],
    ["Trade listings", listingLinks.trades],
  ]) {
    if (!listings.length) continue;
    const entries = listings.map(listing => {
      const url = discordMessageUrl(guildId, listing.postChannelId, listing.postMessageId);
      const title = `[${listing.title || label.slice(0, -1)}](${url})`;
      if (label !== "Trade listings") return `• ${title}`;
      const counts = getVoteCounts(listing);
      const positive = counts.good + counts.wouldMake;
      const negative = counts.bad + counts.wouldntMake;
      return `• ${title} — 👍 ${positive} · 👎 ${negative}${counts.unsure ? ` · 🤷 ${counts.unsure}` : ""}`;
    });
    sections.push(`**${label} (${listings.length})**\n${entries.join("\n")}`);
  }
  if (listingLinks.tradingPost) {
    sections.push(`**Trading Post**\n• [View trading post](${discordMessageUrl(guildId, listingLinks.tradingPost.postChannelId, listingLinks.tradingPost.postMessageId)})`);
  }

  // Discord embed descriptions are limited to 4096 characters.
  const result = [];
  let length = 0;
  for (const section of sections) {
    const separator = result.length ? "\n\n" : "";
    if (length + separator.length + section.length > 4090) {
      if (length + 2 <= 4096) result.push("…");
      break;
    }
    result.push(section);
    length += separator.length + section.length;
  }
  return result.join("\n\n");
}

function makeAlbumButtons(userId, page, count) {
  if (!count) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile:album:${userId}:${page - 1}`)
        .setLabel("Previous photo")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`profile:album:${userId}:${page + 1}`)
        .setLabel("Next photo")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= count - 1),
    ),
  ];
}

function makeProfileCardComponents(userId, page, count) {
  return makeAlbumButtons(userId, page, count);
}

async function showPhotoActionPrompt(interaction, ownerId) {
  await interaction.reply({
    content: "Choose whether to add photos or remove photos from your album.",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`profile:photos-action:add:${ownerId}`)
          .setLabel("Add photos")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`profile:photos-action:remove:${ownerId}`)
          .setLabel("Remove photos")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`profile:photos-action:all:${ownerId}`)
          .setLabel("Remove all")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function makeProfileCardPayload(
  guild,
  profile,
  target,
  page = 0,
  currentMessage = null,
) {
  const albumImages = await getProfileAlbumImages(guild, profile);
  const photos = albumImages;
  const albumPage = photos.length
    ? Math.min(page, photos.length - 1)
    : 0;
  const currentImage = photos[albumPage];
  const currentAttachments = Array.from(
    currentMessage?.attachments?.values?.() ?? [],
  );
  const attachmentsById = new Map(
    currentAttachments.map((attachment) => [attachment.id, attachment]),
  );
  const photo = currentImage?.profilePhotoFileId
    ? await streamToBuffer(
        getProfilePhotoStream(currentImage.profilePhotoFileId),
      )
    : currentImage
      ? attachmentsById.get(currentImage.attachmentId)?.url ?? currentImage.url
      : undefined;
  // Resolve roles for the member whose profile is being rendered.
  // Fetching also works when 'target' is a Discord User rather than GuildMember.
  const profileMember = await guild.members.fetch(profile.discordUserId).catch(() => null);
  const serverRoles = profileMember
    ? profileMember.roles.cache
        .filter((role) => role.id !== guild.id && !role.managed)
        .sort((a, b) => b.position - a.position)
        .map((role) => role.name)
    : [];

  const image = await renderPostImage({
    type: "profile",
    data: {
      displayName: profile.displayName,
      discordUsername: profile.discordUsername,
      robloxUsername: profile.adoptMeUsername,
      serverRoles,
      lookingForTrades: profile.lookingForTrades,
      bio: profile.bio,
      footer: photos.length
        ? `Photo ${albumPage + 1} of ${photos.length}`
        : "Made for the community",
    },
    images: {
      avatar: target.displayAvatarURL({ extension: "png", size: 256 }),
      photo,
    },
    appearance: filterOwnedAppearance(profile.profileAppearance?.background ? profile.profileAppearance : { background: "sagePreview", panelColor: "match", panelOpacity: 0.34 }, await getAppearanceOwnership(guild.id, profile.discordUserId)),
  });
  return {
    content: "",
    embeds: [new EmbedBuilder().setImage("attachment://profile-card.png")],
    files: [new AttachmentBuilder(image, { name: "profile-card.png" })],
    attachments: [],
    components: makeProfileCardComponents(
      profile.discordUserId,
      albumPage,
      photos.length,
    ),
    allowedMentions: { parse: [] },
  };
}

async function makeProfileDetailsPayload(guild, profile) {
  const listingLinks = await getProfileListingLinks(guild, profile.discordUserId);
  return {
    content: "",
    embeds: [new EmbedBuilder().setDescription(makeProfileCardContent(profile, guild.id, listingLinks))],
    allowedMentions: { parse: [] },
  };
}

async function syncProfileDetails(guild, channel, profile) {
  const payload = await makeProfileDetailsPayload(guild, profile);
  if (profile.profileDetailsMessageId) {
    try {
      const message = await channel.messages.fetch(profile.profileDetailsMessageId);
      if (message.author.id === guild.client.user.id) {
        await message.edit(payload);
        return message;
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }
  const message = await channel.send(payload);
  profile.profileDetailsMessageId = message.id;
  await profile.save();
  return message;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getProfileListingLinks(guild, ownerId) {
  const guildId = guild.id;
  const [houses, outfits, trades, tradingPost] = await Promise.all([
    HouseListing.find({
      guildId,
      ownerId,
      status: "active",
      postChannelId: { $ne: "" },
      postMessageId: { $ne: "" },
    })
      .select("title postChannelId postMessageId createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    OutfitListing.find({
      guildId,
      ownerId,
      status: "active",
      postChannelId: { $ne: "" },
      postMessageId: { $ne: "" },
    })
      .select("title postChannelId postMessageId createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    TradeListing.find({
      guildId,
      ownerId,
      status: "open",
      postChannelId: { $ne: "" },
      postMessageId: { $ne: "" },
    })
      .select("title postChannelId postMessageId createdAt votes qualityVotes decisionVotes")
      .sort({ createdAt: -1 })
      .lean(),
    TradingPost.findOne({ guildId, ownerId })
      .select("postChannelId postMessageId")
      .lean(),
  ]);

  const channelFetches = new Map();
  const existingTrades = [];
  for (const listing of trades) {
    let channelFetch = channelFetches.get(listing.postChannelId);
    if (!channelFetches.has(listing.postChannelId)) {
      channelFetch = guild.channels.fetch(listing.postChannelId);
      channelFetches.set(listing.postChannelId, channelFetch);
    } else if (channelFetch === null) {
      continue;
    }

    let channel;
    try {
      channel = await channelFetch;
    } catch (error) {
      if (Number(error?.code) !== 10003) throw error;
      await TradeListing.updateMany(
        {
          guildId,
          ownerId,
          status: "open",
          postChannelId: listing.postChannelId,
        },
        { $set: { status: "closed" } },
      );
      channelFetches.set(listing.postChannelId, null);
      continue;
    }
    if (!channel?.messages) {
      await TradeListing.updateMany(
        {
          guildId,
          ownerId,
          status: "open",
          postChannelId: listing.postChannelId,
        },
        { $set: { status: "closed" } },
      );
      channelFetches.set(listing.postChannelId, null);
      continue;
    }

    try {
      await channel.messages.fetch(listing.postMessageId);
      existingTrades.push(listing);
      if (existingTrades.length === 5) break;
    } catch (error) {
      if (Number(error?.code) !== 10008) throw error;
      await TradeListing.updateOne(
        {
          _id: listing._id,
          guildId,
          ownerId,
          status: "open",
        },
        { $set: { status: "closed" } },
      );
    }
  }

  return {
    houses,
    outfits,
    trades: existingTrades,
    tradingPost:
      tradingPost?.postChannelId && tradingPost?.postMessageId
        ? tradingPost
        : null,
  };
}

async function ensureProfileCardOnce(guild, user, refresh) {
  const guildId = guild.id;
  const profileFilter = { guildId, discordUserId: user.id };
  const config = await GuildConfig.findOne({ guildId });
  if (!config?.profileChannelId) {
    throw new UserFacingError(
      "A server admin needs to set the profiles channel with `/setup channels` before members can use bot commands.",
    );
  }

  const channel = await guild.channels.fetch(config.profileChannelId);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new UserFacingError(
      "The configured profiles channel is unavailable. Ask an admin to update it with `/setup channels`.",
    );
  }

  const member = await guild.members.fetch(user.id);
  const discordUser = member.user;
  let profile = await UserProfile.findOne(profileFilter);
  let identityChanged = false;
  if (!profile) {
    profile = new UserProfile({
      ...profileFilter,
      discordUsername: discordUser.username,
      displayName: member.displayName,
    });
    await profile.save();
  } else {
    const displayName = member.displayName;
    identityChanged =
      profile.discordUsername !== discordUser.username ||
      profile.displayName !== displayName;
    if (identityChanged) {
      profile.discordUsername = discordUser.username;
      profile.displayName = displayName;
      await profile.save();
    }
  }

  const oldChannelId = profile.profileCardChannelId;
  const oldMessageId = profile.profileCardMessageId;
  const oldDetailsMessageId = profile.profileDetailsMessageId;
  if (oldChannelId === channel.id && oldMessageId) {
    try {
      const existingMessage = await channel.messages.fetch(oldMessageId);
      if (existingMessage.author.id === guild.client.user.id) {
        if (!refresh && !identityChanged && oldDetailsMessageId) return profile;
        await existingMessage.edit(await makeProfileCardPayload(guild, profile, member, 0, existingMessage));
        await syncProfileDetails(guild, channel, profile);
        return profile;
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }

  const newMessage = await channel.send(await makeProfileCardPayload(guild, profile, member));
  profile.profileCardChannelId = channel.id;
  profile.profileCardMessageId = newMessage.id;
  profile.profileDetailsMessageId = "";
  try {
    await profile.save();
    await syncProfileDetails(guild, channel, profile);
  } catch (error) {
    await newMessage.delete().catch(() => {});
    throw error;
  }

  await ensureProfileEntry(guild, channel, { moveToBottom: true });

  if (oldChannelId && oldMessageId) {
    try {
      const oldChannel = await guild.channels.fetch(oldChannelId);
      for (const messageId of [oldMessageId, oldDetailsMessageId]) {
        if (!messageId) continue;
        const oldMessage = await oldChannel?.messages?.fetch(messageId);
        if (oldMessage?.author.id === guild.client.user.id) await oldMessage.delete();
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) {
        console.error("Could not remove the old profile post:", error);
      }
    }
  }
  return profile;
}

export async function ensureProfileCard(guild, user, { refresh = false } = {}) {
  const key = `${guild.id}:${user.id}`;
  const existingOperation = profileCardOperations.get(key);
  if (existingOperation) {
    const profile = await existingOperation;
    return refresh
      ? ensureProfileCard(guild, user, { refresh: true })
      : profile;
  }

  const operation = ensureProfileCardOnce(guild, user, refresh);
  const trackedOperation = operation.finally(() => {
    if (profileCardOperations.get(key) === trackedOperation) {
      profileCardOperations.delete(key);
    }
  });
  profileCardOperations.set(key, trackedOperation);
  return trackedOperation;
}

const APPEARANCE_CHOICES = {
  background: ["sagePreview", "sageDots", "garden"],
  panelColor: ["match", "moss", "lavender", "default"],
  font: ["default", "classic"],
  fontColor: ["default", "plum"],
  frame: ["default", "doubleLine"],
};
const APPEARANCE_LABELS = {
  sagePreview: "Pale sage", sageDots: "Sage dots", garden: "Garden",
  match: "Match background", moss: "Moss", lavender: "Lavender",
  default: "Default", classic: "Classic serif", plum: "Plum",
  doubleLine: "Double-line border",
};
const APPEARANCE_PAGES = {
  colors: ["background", "panelColor", "opacity"],
  details: ["font", "fontColor", "frame"],
  stickers: [],
};
function getProfileAppearance(profile) {
  return resolveAppearance(profile.profileAppearance?.background
    ? profile.profileAppearance
    : { background: "sagePreview", panelColor: "match", panelOpacity: 0.34 });
}
function makeAppearanceControls(profile, page = "colors", selected = 0, ownership = null, dmToken = null) {
  const a = getProfileAppearance(profile);
  const ownerId = profile.discordUserId;
  const selectId = field => dmToken
    ? `profile:dm:select:${dmToken}:${field}`
    : selectId(field);
  const finish = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:confirm`).setLabel("Confirm & update profile").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:cancel`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  const pageMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(selectId("page"))
      .setPlaceholder("Customization category")
      .addOptions([
        { label: "Backgrounds & panels", value: "colors", default: page === "colors" },
        { label: "Fonts, text & frames", value: "details", default: page === "details" },
        { label: "Stickers", value: "stickers", default: page === "stickers" },
      ]),
  );
  if (page === "stickers") {
    const rows = [pageMenu, new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId("stickerAdd"))
        .setPlaceholder("Add a sticker (up to 8)")
        .setDisabled(a.stickers.length >= 8 || !Object.keys(APPEARANCE_CATALOG.stickers).some(id => ownership?.stickers.has(id)))
        .addOptions([
          ...Object.keys(APPEARANCE_CATALOG.stickers).map(id => ({ label: id, value: id, description: ownership?.stickers.has(id) ? "Owned" : "Locked", default: false })),
        ]),
    )];
    if (!a.stickers.length) return dmToken ? [...rows, finish()] : rows;
    const index = Math.min(Math.max(selected, 0), a.stickers.length - 1);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId("stickerSelect"))
        .setPlaceholder("Choose sticker to edit")
        .addOptions(a.stickers.map((sticker, i) => ({
          label: `Sticker ${i + 1}: ${sticker.id}`, value: String(i), default: i === index,
        }))),
    ));
    if (dmToken) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(selectId("stickerAction"))
          .setPlaceholder("Move, resize, rotate or remove sticker")
          .addOptions([
            ["left", "← Move left"], ["right", "Move right →"],
            ["up", "↑ Move up"], ["down", "Move down ↓"],
            ["smaller", "− Make smaller"], ["larger", "+ Make larger"],
            ["rotateLeft", "↶ Rotate left"], ["rotateRight", "↷ Rotate right"],
            ["remove", "Remove sticker"],
          ].map(([value, label]) => ({ value, label }))),
      ));
      return [...rows, finish()];
    }
    const button = (action, label, style = ButtonStyle.Secondary) =>
      new ButtonBuilder().setCustomId(`profile:sticker:${action}:${index}:${ownerId}`).setLabel(label).setStyle(style);
    rows.push(new ActionRowBuilder().addComponents(
      button("left", "← Left"), button("right", "Right →"),
      button("up", "↑ Up"), button("down", "↓ Down"),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button("smaller", "− Size"), button("larger", "+ Size"),
      button("rotateLeft", "↶ Rotate"), button("rotateRight", "↷ Rotate"),
      button("remove", "Remove", ButtonStyle.Danger),
    ));
    return rows;
  }
  const rows = APPEARANCE_PAGES[page].map(field => {
    if (field === "opacity") {
      return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(selectId("opacity"))
          .setPlaceholder("Panel opacity")
          .addOptions([0.2, 0.34, 0.5, 0.7, 0.9].map(n => ({
            label: `${Math.round(n * 100)}% opacity`, value: String(n),
            default: Math.abs(a.panelOpacity - n) < 0.001,
          }))),
      );
    }
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`profile:appearance:${field}:${ownerId}`)
        .setPlaceholder({
          background: "Choose background", panelColor: "Choose panel color",
          font: "Choose font", fontColor: "Choose text color", frame: "Choose frame",
        }[field])
        .addOptions(APPEARANCE_CHOICES[field].map(id => ({
          label: APPEARANCE_LABELS[id] || id, value: id, default: a[field] === id,
          description: (id === "match" || ownership?.[APPEARANCE_FIELD_CATEGORY[field]]?.has(id)) ? "Available" : "Locked",
        }))),
    );
  });
  return dmToken ? [pageMenu, ...rows, finish()] : [pageMenu, ...rows];
}

const appearanceDmSessions = new Map();

async function appearanceDmPayload(guild, user, profile, draft) {
  const ownership = await getAppearanceOwnership(guild.id, user.id);
  const previewProfile = { ...profile.toObject(), profileAppearance: draft.appearance };
  const preview = await makeProfileCardPayload(guild, previewProfile, user);
  const controls = makeAppearanceControls(
    previewProfile, draft.page, draft.selected, ownership, draft.token,
  );
  return {
    content: "**Customize your profile** — this is a live preview. Changes are not saved until you press **Confirm & update profile**. Use the sticker controls below the picture to see each change.",
    embeds: preview.embeds,
    files: preview.files,
    attachments: [],
    components: controls,
    allowedMentions: { parse: [] },
  };
}

async function openAppearanceDM(interaction, profile) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ownership = await getAppearanceOwnership(interaction.guildId, interaction.user.id);
  const draft = {
    token: randomUUID().slice(0, 12),
    guildId: interaction.guildId,
    appearance: filterOwnedAppearance(getProfileAppearance(profile), ownership),
    page: "colors",
    selected: 0,
  };
  const payload = await appearanceDmPayload(interaction.guild, interaction.user, profile, draft);
  let dm;
  try {
    dm = await interaction.user.send(payload);
  } catch (error) {
    if (Number(error?.code) === 50007) {
      throw new UserFacingError("I couldn't send you a DM. Please allow direct messages from this server and try Customize appearance again.");
    }
    throw error;
  }
  appearanceDmSessions.set(interaction.user.id, draft);
  await interaction.editReply({
    content: \`I sent your **live profile customization editor** to your DMs. [Open your editor](https://discord.com/channels/@me/\${dm.channelId}/\${dm.id}). Nothing changes on your public profile until you confirm.\`,
  });
}

export async function handleProfileAppearanceDM(interaction) {
  const [, , kind, token, field] = interaction.customId.split(":");
  const draft = appearanceDmSessions.get(interaction.user.id);
  if (!draft || draft.token !== token) {
    throw new UserFacingError("This editor has expired. Click Customize appearance in the server to open a new one.");
  }
  const guild = await interaction.client.guilds.fetch(draft.guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must still belong to the server to edit this profile.");
  const profile = await UserProfile.findOne({ guildId: draft.guildId, discordUserId: interaction.user.id });
  if (!profile) throw new UserFacingError("Your profile is no longer available.");
  const ownership = await getAppearanceOwnership(draft.guildId, interaction.user.id);

  if (kind === "button" && field === "cancel") {
    appearanceDmSessions.delete(interaction.user.id);
    await interaction.update({ content: "Customization cancelled. Your server profile was not changed.", embeds: [], components: [], attachments: [] });
    return true;
  }
  if (kind === "button" && field === "confirm") {
    await interaction.deferUpdate();
    profile.profileAppearance = filterOwnedAppearance(draft.appearance, ownership);
    profile.markModified("profileAppearance");
    await profile.save();
    await ensureProfileCard(guild, interaction.user, { refresh: true });
    appearanceDmSessions.delete(interaction.user.id);
    await interaction.editReply({
      content: "✅ **Appearance saved!** Your profile card in the server has been updated.",
      embeds: [], components: [], attachments: [],
    });
    return true;
  }
  if (kind !== "select") throw new UserFacingError("Unknown editor action.");
  const value = interaction.values[0];

  if (field === "page") {
    if (!APPEARANCE_PAGES[value]) throw new UserFacingError("Unknown customization category.");
    draft.page = value;
    draft.selected = 0;
  } else if (field === "stickerSelect") {
    const index = Number(value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= draft.appearance.stickers.length) {
      throw new UserFacingError("Invalid sticker selection.");
    }
    draft.selected = index;
    draft.page = "stickers";
  } else if (field === "stickerAdd") {
    if (!ownsAppearanceItem(ownership, "stickers", value)) {
      throw new UserFacingError("You have not unlocked that sticker.");
    }
    if (draft.appearance.stickers.length >= 8) throw new UserFacingError("You can place up to eight stickers.");
    draft.appearance.stickers.push({ id: value, x: 0.8, y: 0.72, scale: 1, rotation: 0 });
    draft.selected = draft.appearance.stickers.length - 1;
    draft.page = "stickers";
  } else if (field === "stickerAction") {
    const sticker = draft.appearance.stickers[draft.selected];
    if (!sticker) throw new UserFacingError("Choose a sticker to edit.");
    switch (value) {
      case "left": sticker.x -= 0.04; break;
      case "right": sticker.x += 0.04; break;
      case "up": sticker.y -= 0.04; break;
      case "down": sticker.y += 0.04; break;
      case "smaller": sticker.scale -= 0.15; break;
      case "larger": sticker.scale += 0.15; break;
      case "rotateLeft": sticker.rotation -= 15; break;
      case "rotateRight": sticker.rotation += 15; break;
      case "remove":
        draft.appearance.stickers.splice(draft.selected, 1);
        draft.selected = Math.max(0, draft.selected - 1);
        break;
      default: throw new UserFacingError("Unknown sticker adjustment.");
    }
  } else if (field === "opacity") {
    if (![0.2, 0.34, 0.5, 0.7, 0.9].includes(Number(value))) throw new UserFacingError("Invalid opacity.");
    draft.appearance.panelOpacity = Number(value);
  } else if (APPEARANCE_CHOICES[field]?.includes(value)) {
    if (value !== "match" && !ownsAppearanceItem(ownership, APPEARANCE_FIELD_CATEGORY[field], value)) {
      throw new UserFacingError("You have not unlocked that appearance item.");
    }
    draft.appearance[field] = value;
  } else {
    throw new UserFacingError("Invalid appearance choice.");
  }
  draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
  await interaction.deferUpdate();
  await interaction.editReply(await appearanceDmPayload(guild, interaction.user, profile, draft));
  return true;
}

async function saveProfileAppearance(interaction, profile, appearance, selectedPage, selectedIndex = 0, ownership) {
  profile.profileAppearance = filterOwnedAppearance(appearance, ownership);
  profile.markModified("profileAppearance");
  await profile.save();
  await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
  await interaction.editReply({
    content: "Appearance saved and profile updated. Only free or unlocked catalog items can be equipped.",
    components: makeAppearanceControls(profile, selectedPage, selectedIndex, ownership),
  });
}
export async function handleProfileAppearanceSelect(interaction) {
  const [, , field, ownerId] = interaction.customId.split(":");
  if (ownerId !== interaction.user.id) throw new UserFacingError("Only the profile owner can customize this profile.");
  if (!["page", "opacity", "stickerAdd", "stickerSelect", ...Object.keys(APPEARANCE_CHOICES)].includes(field)) {
    throw new UserFacingError("Unknown appearance setting.");
  }
  const profile = await UserProfile.findOne({ guildId: interaction.guildId, discordUserId: ownerId });
  if (!profile) throw new UserFacingError("Your profile was not found.");
  const value = interaction.values[0];
  const ownership = await getAppearanceOwnership(interaction.guildId, ownerId);
  if (field === "page") {
    if (!APPEARANCE_PAGES[value]) throw new UserFacingError("Unknown customization category.");
    await interaction.update({
      content: "Profile customization (test catalog; shop ownership checks are not active yet).",
      components: makeAppearanceControls(profile, value, 0, ownership),
    });
    return;
  }
  if (field === "stickerSelect") {
    const index = Number(value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= getProfileAppearance(profile).stickers.length) {
      throw new UserFacingError("Invalid sticker selection.");
    }
    await interaction.update({ components: makeAppearanceControls(profile, "stickers", index, ownership) });
    return;
  }
  if (field === "stickerAdd") {
    if (!ownsAppearanceItem(ownership, "stickers", value)) throw new UserFacingError("You have not unlocked that sticker.");
    const appearance = getProfileAppearance(profile);
    if (appearance.stickers.length >= 8) throw new UserFacingError("You can place up to eight stickers.");
    appearance.stickers.push({ id: value, x: 0.8, y: 0.72, scale: 1, rotation: 0 });
    await interaction.deferUpdate();
    await saveProfileAppearance(interaction, profile, appearance, "stickers", appearance.stickers.length - 1, ownership);
    return;
  }
  if (field === "opacity") {
    if (![0.2, 0.34, 0.5, 0.7, 0.9].includes(Number(value))) throw new UserFacingError("Invalid opacity.");
  } else if (!APPEARANCE_CHOICES[field]?.includes(value)) {
    throw new UserFacingError("Invalid catalog choice.");
  }
  if (field !== "opacity" && value !== "match" && !ownsAppearanceItem(ownership, APPEARANCE_FIELD_CATEGORY[field], value)) {
    throw new UserFacingError("You have not unlocked that appearance item.");
  }
  await interaction.deferUpdate();
  const appearance = getProfileAppearance(profile);
  appearance[field === "opacity" ? "panelOpacity" : field] = field === "opacity" ? Number(value) : value;
  await saveProfileAppearance(interaction, profile, appearance,
    APPEARANCE_PAGES.details.includes(field) ? "details" : "colors", 0, ownership);
}
export async function handleProfileStickerButton(interaction) {
  const [, , action, indexText, ownerId] = interaction.customId.split(":");
  if (ownerId !== interaction.user.id) throw new UserFacingError("Only the profile owner can edit stickers.");
  const profile = await UserProfile.findOne({ guildId: interaction.guildId, discordUserId: ownerId });
  if (!profile) throw new UserFacingError("Your profile was not found.");
  const ownership = await getAppearanceOwnership(interaction.guildId, ownerId);
  const appearance = filterOwnedAppearance(getProfileAppearance(profile), ownership);
  const index = Number(indexText);
  if (!Number.isSafeInteger(index) || index < 0 || index >= appearance.stickers.length) {
    throw new UserFacingError("This sticker is no longer available.");
  }
  const sticker = appearance.stickers[index];
  switch (action) {
    case "left": sticker.x -= 0.025; break;
    case "right": sticker.x += 0.025; break;
    case "up": sticker.y -= 0.025; break;
    case "down": sticker.y += 0.025; break;
    case "smaller": sticker.scale -= 0.15; break;
    case "larger": sticker.scale += 0.15; break;
    case "rotateLeft": sticker.rotation -= 15; break;
    case "rotateRight": sticker.rotation += 15; break;
    case "remove": appearance.stickers.splice(index, 1); break;
    default: throw new UserFacingError("Unknown sticker action.");
  }
  await interaction.deferUpdate();
  await saveProfileAppearance(interaction, profile, appearance, "stickers",
    action === "remove" ? Math.max(0, index - 1) : index, ownership);
}

export async function handleProfileCardButton(interaction) {
  const [, section, action, ownerId] = interaction.customId.split(":");
  if (
    section !== "card" ||
    !["edit", "photos", "video", "appearance"].includes(action) ||
    ownerId !== interaction.user.id
  ) {
    throw new UserFacingError("Only the profile owner can use these buttons.");
  }

  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: ownerId,
    profileCardChannelId: interaction.channelId,
    profileCardMessageId: interaction.message.id,
  });
  if (!profile) {
    throw new UserFacingError("This profile card is no longer active. Run `/profile` to refresh it.");
  }

  if (action === "appearance") {
    await openAppearanceDM(interaction, profile);
  } else if (action === "edit") {
    await interaction.showModal(makeEditProfileModal(profile, ownerId));
  } else if (action === "photos") {
    await showPhotoActionPrompt(interaction, ownerId);
  } else {
    await interaction.showModal(makeInventoryVideoModal(ownerId));
  }
}

export async function handleProfilePhotoActionButton(interaction) {
  const [, section, action, ownerId] = interaction.customId.split(":");
  if (
    section !== "photos-action" ||
    !["add", "remove", "all", "confirm-all", "cancel-all"].includes(action) ||
    ownerId !== interaction.user.id
  ) {
    throw new UserFacingError("Only the profile owner can manage these photos.");
  }

  if (action === "add") {
    await interaction.showModal(makeAddPhotosModal(ownerId));
    return;
  }

  if (action === "cancel-all") {
    await interaction.update({
      content: "Remove all cancelled. Your profile photos were not changed.",
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: ownerId,
  });
  if (!profile) throw new UserFacingError("Your profile could not be loaded.");
  const photos = await getProfileAlbumImages(interaction.guild, profile);
  if (!photos.length) {
    await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
    await interaction.update({
      content: "There are no photos in your profile album to remove.",
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (action === "all") {
    await interaction.update({
      content: `This will permanently remove all ${photos.length} photos from your profile. Are you sure?`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`profile:photos-action:confirm-all:${ownerId}`)
            .setLabel("Yes, remove all")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`profile:photos-action:cancel-all:${ownerId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (action === "confirm-all") {
    await interaction.deferUpdate();
    const removedCount = await removeAllProfilePhotos(
      interaction.guild,
      profile,
    );
    await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
    await interaction.editReply({
      content: `Removed all ${removedCount} photos from your profile album.`,
      components: [],
      allowedMentions: { parse: [] },
    });
    return;
  }
  await interaction.showModal(makeRemovePhotosModal(ownerId, photos.length));
}

export async function handleProfileAlbumPage(interaction) {
  const [, section, targetUserId, pageValue] = interaction.customId.split(":");
  if (section !== "album" || !/^\d{17,20}$/.test(targetUserId)) {
    throw new UserFacingError("That profile photo button is not valid.");
  }
  await interaction.deferUpdate();

  const page = Number(pageValue);
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new UserFacingError("That profile photo page is not valid.");
  }

  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: targetUserId,
    profileCardChannelId: interaction.channelId,
    profileCardMessageId: interaction.message.id,
  });
  if (!profile) {
    throw new UserFacingError("This profile card is no longer active.");
  }
  const target = await interaction.client.users.fetch(targetUserId);
  await interaction.editReply(
    await makeProfileCardPayload(
      interaction.guild,
      profile,
      target,
      page,
      interaction.message,
    ),
  );
}

function makeProfileMenu(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile:menu:view:${userId}`)
        .setLabel("View my card")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`profile:menu:edit:${userId}`)
        .setLabel("Edit my card")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`profile:menu:photos:${userId}`)
        .setLabel("Add/remove photos")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`profile:menu:video:${userId}`)
        .setLabel("Inventory video")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function makeMenuReply(userId, content = "Choose what you want to do with your profile.") {
  return {
    content,
    components: makeProfileMenu(userId),
    embeds: [],
    attachments: [],
    allowedMentions: { parse: [] },
  };
}

async function getOrCreateProfile(user) {
  return await UserProfile.findOne({
    guildId: user.guildId,
    discordUserId: user.id,
  }) ?? new UserProfile({
    guildId: user.guildId,
    discordUserId: user.id,
    discordUsername: user.username,
    displayName: user.globalName ?? user.username,
  });
}

function makeEditProfileModal(profile, userId) {
  const usernameInput = new TextInputBuilder()
    .setCustomId("adopt_me_username")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(64)
    .setRequired(false);
  if (profile.adoptMeUsername) usernameInput.setValue(profile.adoptMeUsername);

  const bioInput = new TextInputBuilder()
    .setCustomId("about")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(false);
  if (profile.bio) bioInput.setValue(profile.bio);

  return new ModalBuilder()
    .setCustomId(`profile:edit:${userId}`)
    .setTitle("Edit your profile")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Adopt Me username")
        .setTextInputComponent(usernameInput),
      new LabelBuilder()
        .setLabel("About you")
        .setTextInputComponent(bioInput),
      new LabelBuilder()
        .setLabel("Are you looking for trades?")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("looking_for_trades")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              {
                label: "Yes",
                value: "yes",
                default: profile.lookingForTrades,
              },
              {
                label: "No",
                value: "no",
                default: !profile.lookingForTrades,
              },
            ),
        ),
    );
}

function makeAddPhotosModal(userId) {
  return new ModalBuilder()
    .setCustomId(`profile:photos:${userId}`)
    .setTitle("Add photos to your profile")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Choose 1 to 5 pictures")
        .setDescription("Repeat this to add as many photos as you like.")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("images")
            .setMinValues(1)
            .setMaxValues(5),
        ),
    );
}

function makeRemovePhotosModal(userId, photoCount) {
  return new ModalBuilder()
    .setCustomId(`profile:remove-photos:${userId}`)
    .setTitle("Remove photos from your profile")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Photo numbers to remove")
        .setDescription(
          `Use the card's Photo count, oldest first (1-${photoCount}); enter numbers or ranges.`,
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("photo_numbers")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true)
            .setPlaceholder("Example: 1, 3-5"),
        ),
    );
}

function parsePhotoNumbers(value, photoCount) {
  const numbers = new Set();
  const parts = value.split(",").map((part) => part.trim());
  if (!parts.length || parts.some((part) => !part)) {
    throw new UserFacingError("Enter photo numbers separated by commas, such as 1, 3-5.");
  }

  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) {
      throw new UserFacingError("Use photo numbers separated by commas or ranges, such as 1, 3-5.");
    }
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > photoCount) {
      throw new UserFacingError(
        `Photo numbers must be between 1 and ${photoCount}, and ranges must be in ascending order.`,
      );
    }
    for (let number = start; number <= end; number += 1) {
      numbers.add(number);
    }
  }
  return Array.from(numbers).sort((first, second) => first - second);
}

function makeInventoryVideoModal(userId, { entryPoint = false } = {}) {
  const videoUrlInput = new TextInputBuilder()
    .setCustomId("video_url")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(500)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(
      `profile:${entryPoint ? "video-entry" : "video"}:${userId}`,
    )
    .setTitle("Add an inventory video")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Paste a video link, or upload a file below")
        .setDescription("Choose one option, not both.")
        .setTextInputComponent(videoUrlInput),
      new LabelBuilder()
        .setLabel("Upload a video (optional)")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("video")
            .setMinValues(0)
            .setMaxValues(1)
            .setRequired(false),
        ),
    );
}

export async function handleProfileMenuButton(interaction) {
  const [, section, action, ownerId] = interaction.customId.split(":");
  if (section !== "menu" || ownerId !== interaction.user.id) {
    throw new UserFacingError("That profile menu is not yours to use.");
  }

  if (action === "view") {
    await interaction.deferUpdate();
    const profile = await UserProfile.findOne({
      guildId: interaction.guildId,
      discordUserId: ownerId,
    });
    if (!profile) {
      await interaction.editReply(
        makeMenuReply(ownerId, "You don't have a profile yet. Choose **Edit my card** to create one."),
      );
      return;
    }
    const cardUrl = profile.profileCardChannelId && profile.profileCardMessageId
      ? discordMessageUrl(
          interaction.guildId,
          profile.profileCardChannelId,
          profile.profileCardMessageId,
        )
      : "";
    await interaction.editReply({
      content: cardUrl
        ? `Browse your photos and profile on the permanent card: ${cardUrl}`
        : "Your permanent profile card is not available yet. Run `/profile` again in a moment.",
      components: [],
      embeds: [],
      attachments: [],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (action === "edit") {
    const user = {
      id: interaction.user.id,
      username: interaction.user.username,
      globalName: interaction.user.globalName,
      guildId: interaction.guildId,
    };
    const profile = await getOrCreateProfile(user);
    await interaction.showModal(makeEditProfileModal(profile, ownerId));
    return;
  }
  if (action === "photos") {
    await showPhotoActionPrompt(interaction, ownerId);
    return;
  }
  if (action === "video") {
    await interaction.showModal(makeInventoryVideoModal(ownerId));
    return;
  }

  throw new UserFacingError("That profile option is not available.");
}

export async function handleProfileModal(interaction) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (
    !["edit", "photos", "remove-photos", "video", "video-entry"].includes(action) ||
    ownerId !== interaction.user.id
  ) {
    throw new UserFacingError("That profile form is not yours to use.");
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const profileFilter = {
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
  };

  if (action === "edit") {
    const adoptMeUsername = interaction.fields
      .getTextInputValue("adopt_me_username")
      .trim();
    const bio = interaction.fields.getTextInputValue("about").trim();
    const lookingForTrades = interaction.fields
      .getStringSelectValues("looking_for_trades")[0] === "yes";

    await UserProfile.findOneAndUpdate(
      profileFilter,
      {
        $set: {
          discordUsername: interaction.user.username,
          displayName: interaction.user.globalName ?? interaction.user.username,
          adoptMeUsername,
          bio,
          lookingForTrades,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
    await interaction.editReply(
      makeMenuReply(interaction.user.id, "Your profile card was saved."),
    );
    return;
  }

  if (action === "photos") {
    const uploads = Array.from(
      interaction.fields.getUploadedFiles("images", true).values(),
    );
    validateAttachments(uploads, { imagesOnly: true });
    await ensureProfileCard(interaction.guild, interaction.user);
    const profile = await UserProfile.findOne(profileFilter);
    if (!profile) throw new UserFacingError("Your profile could not be loaded.");
    await saveProfilePhotos(interaction.guildId, interaction.user.id, uploads);
    await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });

    await interaction.editReply(
      makeMenuReply(
        interaction.user.id,
        `Added ${uploads.length} photo(s) to your profile album.`,
      ),
    );
    return;
  }

  if (action === "remove-photos") {
    const profile = await UserProfile.findOne(profileFilter);
    if (!profile) throw new UserFacingError("Your profile could not be loaded.");
    const photos = await getProfileAlbumImages(interaction.guild, profile);
    const photoNumbers = parsePhotoNumbers(
      interaction.fields.getTextInputValue("photo_numbers"),
      photos.length,
    );
    const removedCount = await removeProfilePhotos(
      interaction.guild,
      profile,
      photoNumbers,
    );
    await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
    await interaction.editReply(
      makeMenuReply(
        interaction.user.id,
        `Removed ${removedCount} photo(s) from your profile album.`,
      ),
    );
    return;
  }

  const video = interaction.fields.getUploadedFiles("video")?.first();
  const videoUrl = interaction.fields.getTextInputValue("video_url").trim();
  if (video && videoUrl) {
    throw new UserFacingError("Choose either a video link or an uploaded video, not both.");
  }
  if (!video && !videoUrl) {
    throw new UserFacingError("Add a video link or upload a video file.");
  }

  const videoPost = video
    ? await saveInventoryVideoFile(interaction, video)
    : await saveInventoryVideoLink(interaction, videoUrl);
  await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
  await interaction.editReply(
    makeMenuReply(
      interaction.user.id,
      `Your inventory video was saved: ${videoPost.url}`,
    ),
  );
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
  const target = interaction.options.getUser("user");

  if (!target) {
    const profile = await UserProfile.findOne({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
    });
    const cardUrl = profile?.profileCardChannelId && profile.profileCardMessageId
      ? discordMessageUrl(
          interaction.guildId,
          profile.profileCardChannelId,
          profile.profileCardMessageId,
        )
      : "";
    await interaction.editReply({
      content: cardUrl
        ? `Your profile is in <#${profile.profileCardChannelId}>: ${cardUrl}\nUse the permanent buttons on your profile card to update it.`
        : "Your profile card is being set up. Try `/profile` again in a moment.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: target.id,
  });
  if (!profile) {
    throw new UserFacingError(
      "That member has not made a profile yet.",
    );
  }

  const cardUrl = profile.profileCardChannelId && profile.profileCardMessageId
    ? discordMessageUrl(
        interaction.guildId,
        profile.profileCardChannelId,
        profile.profileCardMessageId,
      )
    : "";
  await interaction.editReply({
    content: cardUrl
      ? `View ${target.username}'s permanent profile card to browse their photos: ${cardUrl}`
      : `${target.username}'s permanent profile card is not available yet.`,
    allowedMentions: { parse: [] },
  });
}
