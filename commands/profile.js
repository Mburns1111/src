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
import MemberDmPanel from "../models/MemberDmPanel.js";
import { getOrCreateDmPanel, dmPanelUrl } from "../services/member-dm-panels.js";
import { sendTemporaryDmNotice } from "../services/temporary-dm-notice.js";
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
import { APPEARANCE_CATALOG, DEFAULT_APPEARANCE, appearanceCatalogItem, resolveAppearance } from "../services/post-appearance.js";
import { SHOP_FONT_STYLES } from "../services/font-library.js";
import { customColorHex, customColorLabel } from "../services/custom-colors.js";
import { CLASSIC_COLOR_OPTIONS, STANDARD_BACKGROUND_ID, STANDARD_PANEL_ID } from "../services/classic-colors.js";
import { FREE_APPEARANCE, getAppearanceOwnership, ownsAppearanceItem, filterOwnedAppearance, APPEARANCE_FIELD_CATEGORY } from "../services/appearance-ownership.js";

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
  if (interaction.customId === "profile:entry:appearance") {
    // Acknowledge before loading the profile or preparing DM images.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const profile = await ensureProfileRecord(interaction.guildId, interaction.user);
    await openAppearanceDM(interaction, profile);
    return true;
  }
  const profile = await ensureProfileRecord(interaction.guildId, interaction.user);
  if (interaction.customId === "profile:entry:photos") {
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
    appearance: filterOwnedAppearance(profile.profileAppearance?.background ? profile.profileAppearance : DEFAULT_APPEARANCE, await getAppearanceOwnership(guild.id, profile.discordUserId)),
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

// The full classic spectrum (27 choices) is paged to obey Discord's
// 25-select-option limit. The free standard colors are labeled clearly.
const APPEARANCE_CHOICES = {
  background: [STANDARD_BACKGROUND_ID, ...CLASSIC_COLOR_OPTIONS.map(item => item.id)],
  panelColor: ["match", ...CLASSIC_COLOR_OPTIONS.map(item => item.id)],
  // 'font' is kept to accept selections from pre-update editor messages.
  font: ["default", "classic", ...Object.keys(SHOP_FONT_STYLES)],
  headerFont: ["default", ...Object.keys(SHOP_FONT_STYLES), "classic"],
  bodyFont: ["default", ...Object.keys(SHOP_FONT_STYLES), "classic"],
  fontColor: ["default", "black", "white", "plum"],
  frame: ["default", "doubleLine", "softRounded", "silverFloral", "goldCelestial", "blackKnight"],
};
const APPEARANCE_LABELS = {
  ...Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [
    item.id,
    item.name,
  ])),
  sagePreview: "Starter Sage (free)",
  match: "Match background",
  default: "Default",
  classic: "Classic Serif (legacy)",
  ...Object.fromEntries(Object.entries(SHOP_FONT_STYLES).map(([id, font]) => [id, font.name])),
  black: "Black (free)",
  white: "White (free)",
  plum: "Plum",
  doubleLine: "Double Line",
  softRounded: "Soft Rounded",
  silverFloral: "Silver Floral",
  goldCelestial: "Golden Celestial",
  blackKnight: "Black Knight",
};
const COLOR_SELECT_PAGE_SIZE = 24;
const RETIRED_COLOR_NAMES = {
  sageDots: "Sage Dots", garden: "Garden", paleSage: "Pale Sage",
  warmCream: "Warm Cream", dustyBlue: "Dusty Blue",
  moss: "Moss", lavender: "Lavender", sagePanel: "Sage Panel",
  creamPanel: "Cream Panel", bluePanel: "Blue Panel",
  charcoal: "Charcoal", forest: "Forest", navy: "Navy",
};

// The real profile editor shows ONLY owned/unlocked colors. Locked colors
// remain available to try in the shop's Mix & Match preview, not here.
// "Match background" is always allowed, and free standards/text colors are
// already included in the ownership set. Retired paid colors stay available
// to their original buyers without returning to the storefront.
function availableAppearanceChoices(field, ownership) {
  const choices = APPEARANCE_CHOICES[field];
  // Equipment must be owned: the shop and Mix & Match can preview locked
  // frames, but Customize Profile offers only the free or purchased frames.
  if (!["background", "panelColor", "fontColor", "frame", "headerFont", "bodyFont", "font"].includes(field)) return choices;
  const category = APPEARANCE_FIELD_CATEGORY[field];
  const unlocked = choices.filter(id =>
    id === "match" || ownsAppearanceItem(ownership, category, id));
  if (["headerFont", "bodyFont", "font"].includes(field)) return unlocked;
  if (field === "fontColor") {
    // A member can own any number of permanent purchased HEX text colors.
    // Do not expose the raw template ID or anyone else's color codes.
    const customOwned = [...(ownership?.fontColors || [])]
      .filter(id => Boolean(customColorHex(id))).sort();
    return [...new Set([...unlocked, ...customOwned])];
  }
  if (field === "frame") {
    // Preserve a previously purchased retired border even if no longer sold.
    const legacy = Object.keys(APPEARANCE_CATALOG.frames).filter(id =>
      !choices.includes(id) && ownership?.frames?.has(id) &&
      !FREE_APPEARANCE.frames.includes(id));
    return [...unlocked, ...legacy];
  }
  // Each purchased custom HEX value is stored as a stable inventory ID,
  // so multiple saved colors can appear here without a separate DB schema.
  const customOwned = [...(ownership?.[category] || [])]
    .filter(id => Boolean(customColorHex(id))).sort();
  const retiredOwned = Object.keys(APPEARANCE_CATALOG[category]).filter(id =>
    !choices.includes(id) && ownership?.[category]?.has(id) &&
    !FREE_APPEARANCE[category]?.includes(id));
  return [...new Set([...unlocked, ...customOwned, ...retiredOwned])];
}

function appearanceChoicePage(field, currentAppearance, optionPages = {}, ownership = null) {
  const options = availableAppearanceChoices(field, ownership);
  const pageCount = Math.ceil(options.length / COLOR_SELECT_PAGE_SIZE);
  if (pageCount <= 1) return { page: 0, count: 1 };
  // On first open, show the page containing the equipped color.
  const selectedIndex = options.indexOf(currentAppearance[field]);
  const selectedPage = Math.max(0, Math.floor(selectedIndex / COLOR_SELECT_PAGE_SIZE));
  const requested = Number.isSafeInteger(optionPages[field]) ? optionPages[field] : selectedPage;
  return { page: Math.max(0, Math.min(pageCount - 1, requested)), count: pageCount };
}

function appearanceChoiceOptions(field, appearance, ownership, optionPages) {
  const all = availableAppearanceChoices(field, ownership);
  const { page, count } = appearanceChoicePage(field, appearance, optionPages, ownership);
  const visible = count === 1 ? all : all.slice(
    page * COLOR_SELECT_PAGE_SIZE, (page + 1) * COLOR_SELECT_PAGE_SIZE,
  );
  const options = visible.map(id => ({
    label: customColorLabel(id) ||
      (!APPEARANCE_CHOICES[field].includes(id)
      ? `Retired · ${RETIRED_COLOR_NAMES[id] || id}`
      : field === "background" && id === STANDARD_BACKGROUND_ID
        ? "Starter Sage (free)"
        : field === "panelColor" && id === STANDARD_PANEL_ID
          ? `${APPEARANCE_LABELS[id]} (Free · Standard)`
          : field === "frame" && id === "default"
            ? "Classic Thin (free)"
            : (field === "headerFont" || field === "bodyFont") && id === "default"
              ? "Standard Clean (free)"
              : APPEARANCE_LABELS[id] || id),
    value: id,
    default: appearance[field] === id,
    description: customColorHex(id) ? "Your purchased HEX color" :
      !APPEARANCE_CHOICES[field].includes(id)
      ? "Previously purchased · yours to keep"
      : id === "match" || ownership?.[APPEARANCE_FIELD_CATEGORY[field]]?.has(id)
        ? "Available" : "Locked",
  }));
  if (count > 1) {
    options.push(page < count - 1
      ? { label: "More colors →", value: "__next__", description: `Page ${page + 2} of ${count}` }
      : { label: "← Previous colors", value: "__previous__", description: `Page ${page} of ${count}` });
  }
  return { options, page, count };
}
const APPEARANCE_PAGES = {
  colors: ["background", "panelColor", "opacity"],
  fonts: ["headerFont", "bodyFont"],
  details: ["fontColor", "frame"],
  stickers: [],
};
function getProfileAppearance(profile) {
  return resolveAppearance(profile.profileAppearance?.background
    ? profile.profileAppearance
    : DEFAULT_APPEARANCE);
}
function makeAppearanceControls(profile, page = "colors", selected = 0, ownership = null, dmToken = null, optionPages = {}) {
  const a = getProfileAppearance(profile);
  const ownerId = profile.discordUserId;
  const selectId = field => dmToken
    ? `profile:dm:select:${dmToken}:${field}`
    : `profile:appearance:${field}:${ownerId}`;
  const finish = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:confirm`).setLabel("Confirm & update profile").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:cancel`).setLabel("Discard Changes").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:refresh`).setLabel("Refresh Preview").setStyle(ButtonStyle.Secondary),
  );
  const pageMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(selectId("page"))
      .setPlaceholder("Customization category")
      .addOptions([
        { label: "Backgrounds & panels", value: "colors", default: page === "colors" },
        { label: "Fonts · Headings and profile text", value: "fonts", default: page === "fonts" },
        { label: "Text colors & frames", value: "details", default: page === "details" },
        { label: "Stickers", value: "stickers", default: page === "stickers" },
      ]),
  );
  if (dmToken && page === "stickers") {
    const stickerChoices = [
      ...a.stickers.map((sticker, i) => ({
        label: `Edit sticker ${i + 1}: ${sticker.id}`,
        value: `select:${i}`,
        default: i === selected,
      })),
      ...Object.keys(APPEARANCE_CATALOG.stickers).map(id => ({
        label: `Add ${id}`,
        value: `add:${id}`,
        description: ownership?.stickers.has(id) ? "Owned" : "Locked",
      })),
    ];
    const rows = [
      pageMenu,
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(selectId("stickerPick"))
          .setPlaceholder("Add a sticker or choose one to edit")
          .addOptions(stickerChoices),
      ),
    ];
    if (a.stickers.length) {
      const button = (action, label, style = ButtonStyle.Secondary) =>
        new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:${action}`)
          .setLabel(label).setStyle(style);
      rows.push(new ActionRowBuilder().addComponents(
        button("left", "← Left"), button("right", "Right →"),
        button("up", "↑ Up"), button("down", "↓ Down"),
      ));
      rows.push(new ActionRowBuilder().addComponents(
        button("smaller", "− Size"), button("larger", "+ Size"),
        button("rotateLeft", "↶ Rotate"), button("rotateRight", "↷ Rotate"),
        button("remove", "Remove", ButtonStyle.Danger),
      ));
    }
    return [...rows, finish()];
  }
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
    const choice = appearanceChoiceOptions(field, a, ownership, optionPages);
    const placeholder = {
      background: "Choose background", panelColor: "Choose panel color",
      font: "Choose font", headerFont: "Choose font for titles & headings",
      bodyFont: "Choose font for profile text", fontColor: "Choose text color",
      frame: "Choose frame",
    }[field];
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId(field))
        .setPlaceholder(choice.count > 1
          ? `${placeholder} · ${choice.page + 1}/${choice.count}`
          : placeholder)
        .addOptions(choice.options),
    );
  });
  // Fonts are owned once. Choose separate fonts, or apply one to both.
  if (page === "fonts" && dmToken) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`profile:dm:button:${dmToken}:fontBoth`)
        .setLabel("Apply Heading Font to Both")
        .setStyle(ButtonStyle.Primary),
    ));
  }
  return dmToken ? [pageMenu, ...rows, finish()] : [pageMenu, ...rows];
}

async function appearanceDmPayload(guild, user, profile, draft) {
  const ownership = await getAppearanceOwnership(guild.id, user.id);
  const previewProfile = { ...profile.toObject(), profileAppearance: draft.appearance };
  const preview = await makeProfileCardPayload(guild, previewProfile, user);
  const controls = makeAppearanceControls(
    previewProfile, draft.page, draft.selected, ownership, draft.token, draft.optionPages || {},
  );
  return {
    content: "**Customize your profile** — see every change in this preview. **Confirm & update profile** saves your work and closes this temporary editor. **Discard Changes** closes it without saving. Your permanent shop remains in DMs.",
    embeds: preview.embeds,
    files: preview.files,
    attachments: [],
    components: controls,
    allowedMentions: { parse: [] },
  };
}

async function openAppearanceDM(interaction, profile, guild = interaction.guild) {
  if (!guild) throw new UserFacingError("The server is not available.");
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  // Keep only the shop message permanently. If Customize is the member's first
  // visit, create their permanent shop before the temporary editor.
  const { ensureMemberShopDM } = await import("./shop.js");
  const shop = await ensureMemberShopDM(guild, interaction.user);
  const { message, panel, created } = await getOrCreateDmPanel({
    guildId: guild.id,
    user: interaction.user,
    kind: "appearance",
    makeInitial: async () => {
      const ownership = await getAppearanceOwnership(guild.id, interaction.user.id);
      const draft = {
        token: randomUUID().slice(0, 12),
        guildId: guild.id,
        appearance: filterOwnedAppearance(getProfileAppearance(profile), ownership),
        page: "colors",
        selected: 0,
        optionPages: {},
      };
      return {
        payload: await appearanceDmPayload(guild, interaction.user, profile, draft),
        fields: {
          token: draft.token,
          appearanceDraft: draft.appearance,
          appearancePage: draft.page,
          selectedSticker: draft.selected,
          appearanceOptionPages: draft.optionPages,
        },
      };
    },
  });

  if (!created) {
    // A still-open editing session is reused rather than creating duplicates.
    // Refresh controls from the saved draft (which also survives bot restarts).
    const ownership = await getAppearanceOwnership(guild.id, interaction.user.id);
    const draft = {
      token: panel.token,
      guildId: guild.id,
      appearance: filterOwnedAppearance(panel.appearanceDraft ?? getProfileAppearance(profile), ownership),
      page: APPEARANCE_PAGES[panel.appearancePage] ? panel.appearancePage : "colors",
      selected: panel.selectedSticker ?? 0,
      optionPages: panel.appearanceOptionPages || {},
    };
    if (draft.token) {
      await message.edit(await appearanceDmPayload(guild, interaction.user, profile, draft));
    }
  }
  await interaction.editReply({
    content: `[**Open your temporary profile editor**](${dmPanelUrl(message.channelId, message.id)}) — ${created ? "ready to customize!" : "your unfinished edits are still here."}\n[Your permanent shop](${dmPanelUrl(shop.message.channelId, shop.message.id)}) stays in DMs and has the **Customize Profile** button for next time.`,
    allowedMentions: { parse: [] },
  });
}

export async function openAppearanceDMFromShop(interaction, guild) {
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must belong to this server to customize your profile.");
  const profile = await ensureProfileRecord(guild.id, interaction.user);
  await openAppearanceDM(interaction, profile, guild);
  return true;
}

async function saveDraftPanel(panel, draft) {
  panel.appearanceDraft = draft.appearance;
  panel.appearancePage = draft.page;
  panel.selectedSticker = draft.selected;
  panel.appearanceOptionPages = draft.optionPages || {};
  panel.markModified("appearanceDraft");
  panel.markModified("appearanceOptionPages");
  await panel.save();
}

function adjustDraftSticker(draft, action) {
  const sticker = draft.appearance.stickers[draft.selected];
  if (!sticker) throw new UserFacingError("Choose a sticker to edit.");
  switch (action) {
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
}

export async function handleProfileAppearanceDM(interaction) {
  // After a restart the MongoDB reads and guild fetches can be slow. Reply to
  // Discord immediately so existing message controls do not time out.
  await interaction.deferUpdate();
  const [, , kind, token, field] = interaction.customId.split(":");
  const panel = await MemberDmPanel.findOne({
    botUserId: interaction.client.user.id,
    discordUserId: interaction.user.id, kind: "appearance", token,
  });
  if (!panel || panel.messageId !== interaction.message?.id || panel.channelId !== interaction.channelId) {
    throw new UserFacingError("This editor is no longer active. Use Customize Profile in the shop or server to open your current editor.");
  }
  const guild = await interaction.client.guilds.fetch(panel.guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must still belong to the server to edit this profile.");
  const profile = await UserProfile.findOne({ guildId: panel.guildId, discordUserId: interaction.user.id });
  if (!profile) throw new UserFacingError("Your profile is no longer available.");
  const ownership = await getAppearanceOwnership(panel.guildId, interaction.user.id);
  const draft = {
    token: panel.token,
    guildId: panel.guildId,
    appearance: filterOwnedAppearance(panel.appearanceDraft ?? getProfileAppearance(profile), ownership),
    page: APPEARANCE_PAGES[panel.appearancePage] ? panel.appearancePage : "colors",
    selected: panel.selectedSticker ?? 0,
    optionPages: panel.appearanceOptionPages || {},
  };

  if (kind === "button" && field === "cancel") {
    await MemberDmPanel.deleteOne({ _id: panel._id, token: panel.token });
    try {
      await interaction.message.delete();
    } catch (error) {
      if (Number(error?.code) !== 10008) {
        console.warn("Could not delete the cancelled profile editor:", error);
        await interaction.message.edit({
          content: "Customization cancelled. Your profile was not changed.",
          embeds: [], components: [], attachments: [],
        }).catch(() => {});
      }
    }
    await sendTemporaryDmNotice(interaction.user,
      "↩️ **Changes discarded.** Your profile was not changed. You can open another editor using **Customize Profile** in your shop.");
    return true;
  }
  if (kind === "button" && field === "confirm") {
    profile.profileAppearance = filterOwnedAppearance(draft.appearance, ownership);
    profile.markModified("profileAppearance");
    await profile.save();
    await ensureProfileCard(guild, interaction.user, { refresh: true });

    // End the editing session only after the server profile is updated.
    await MemberDmPanel.deleteOne({ _id: panel._id, token: panel.token });
    try {
      await interaction.message.delete();
    } catch (error) {
      if (Number(error?.code) !== 10008) {
        console.warn("Could not delete the completed profile editor:", error);
        await interaction.message.edit({
          content: "Profile updated. This editing session is closed.",
          embeds: [], components: [], attachments: [],
        }).catch(() => {});
      }
    }
    await sendTemporaryDmNotice(interaction.user,
      "✅ **Profile appearance saved!** Your profile card in the server has been updated. The editor is closed; use **Customize Profile** in your permanent shop to edit again.");
    return true;
  }
  if (kind === "button" && field === "fontBoth") {
    if (!ownsAppearanceItem(ownership, "fonts", draft.appearance.headerFont)) {
      throw new UserFacingError("You have not unlocked that font.");
    }
    draft.appearance.bodyFont = draft.appearance.headerFont;
    draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
    await saveDraftPanel(panel, draft);
    await interaction.editReply(await appearanceDmPayload(guild, interaction.user, profile, draft));
    return true;
  }
  if (kind === "button" && field === "refresh") {
    await interaction.editReply(await appearanceDmPayload(guild, interaction.user, profile, draft));
    return true;
  }
  if (kind === "button" && [
    "left", "right", "up", "down", "smaller", "larger",
    "rotateLeft", "rotateRight", "remove",
  ].includes(field)) {
    adjustDraftSticker(draft, field);
    draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
    await saveDraftPanel(panel, draft);
    await interaction.editReply(await appearanceDmPayload(guild, interaction.user, profile, draft));
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
  } else if (field === "stickerPick") {
    const [action, id] = value.split(":");
    if (action === "select") {
      const index = Number(id);
      if (!Number.isSafeInteger(index) || index < 0 || index >= draft.appearance.stickers.length) {
        throw new UserFacingError("Invalid sticker selection.");
      }
      draft.selected = index;
    } else if (action === "add") {
      if (!ownsAppearanceItem(ownership, "stickers", id)) {
        throw new UserFacingError("You have not unlocked that sticker.");
      }
      if (draft.appearance.stickers.length >= 8) throw new UserFacingError("You can place up to eight stickers.");
      draft.appearance.stickers.push({ id, x: 0.8, y: 0.72, scale: 1, rotation: 0 });
      draft.selected = draft.appearance.stickers.length - 1;
    } else {
      throw new UserFacingError("Unknown sticker choice.");
    }
    draft.page = "stickers";
  } else if (field === "stickerAction") {
    adjustDraftSticker(draft, value);
  } else if (field === "opacity") {
    if (![0.2, 0.34, 0.5, 0.7, 0.9].includes(Number(value))) throw new UserFacingError("Invalid opacity.");
    draft.appearance.panelOpacity = Number(value);
  } else if (["background", "panelColor", "fontColor"].includes(field) &&
             ["__next__", "__previous__"].includes(value)) {
    const { page, count } = appearanceChoicePage(field, draft.appearance, draft.optionPages, ownership);
    draft.optionPages[field] = Math.max(0, Math.min(count - 1,
      page + (value === "__next__" ? 1 : -1)));
  } else if (availableAppearanceChoices(field, ownership)?.includes(value)) {
    if (value !== "match" && !ownsAppearanceItem(ownership, APPEARANCE_FIELD_CATEGORY[field], value)) {
      throw new UserFacingError("You have not unlocked that appearance item.");
    }
    draft.appearance[field] = value;
    // Old one-font editor controls should still update both font slots.
    if (field === "font") {
      draft.appearance.headerFont = value;
      draft.appearance.bodyFont = value;
    }
    if (field === "panelColor" && appearanceCatalogItem("panels", value)?.dark) {
      draft.appearance.panelOpacity = 0.9;
    }
    if (field === "background" && draft.appearance.panelColor === "match" &&
        appearanceCatalogItem("backgrounds", value)?.dark) {
      draft.appearance.panelOpacity = 0.9;
    }
  } else {
    throw new UserFacingError("Invalid appearance choice.");
  }
  draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
  await saveDraftPanel(panel, draft);
  await interaction.editReply(await appearanceDmPayload(guild, interaction.user, profile, draft));
  return true;
}

// Old ephemeral appearance controls might still be visible in Discord. Redirect
// them to the DM editor so they can no longer save changes without confirmation.
export async function handleProfileAppearanceSelect(interaction) {
  const ownerId = interaction.customId.split(":").at(-1);
  if (ownerId !== interaction.user.id) throw new UserFacingError("Only the profile owner can customize this profile.");
  await openAppearanceDM(interaction, await ensureProfileRecord(interaction.guildId, interaction.user));
}
export async function handleProfileStickerButton(interaction) {
  const ownerId = interaction.customId.split(":").at(-1);
  if (ownerId !== interaction.user.id) throw new UserFacingError("Only the profile owner can customize this profile.");
  await openAppearanceDM(interaction, await ensureProfileRecord(interaction.guildId, interaction.user));
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

  if (action === "appearance") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
