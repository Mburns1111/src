
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
} from "discord.js";
import mongoose from "mongoose";
import { createCanvas } from "@napi-rs/canvas";
import GuildConfig from "../models/GuildConfig.js";
import UserProfile from "../models/UserProfile.js";
import AppearanceInventory from "../models/AppearanceInventory.js";
import PointsWallet from "../models/PointsWallet.js";
import MemberDmPanel from "../models/MemberDmPanel.js";
import { getOrCreateDmPanel, dmPanelUrl } from "../services/member-dm-panels.js";
import { sendTemporaryDmNotice } from "../services/temporary-dm-notice.js";
import { openAppearanceDMFromShop } from "./profile.js";
import { shopItems } from "../services/shop-catalog.js";
import { getAppearanceOwnership, ownsAppearanceItem } from "../services/appearance-ownership.js";
import { APPEARANCE_CATALOG, DEFAULT_APPEARANCE, resolveAppearance } from "../services/post-appearance.js";
import { renderPostImage } from "../services/post-renderer.js";
import { normalizeShopMix, tryOnShopMix, SHOP_MIX_CATEGORIES } from "../services/shop-preview-mix.js";
import { CLASSIC_COLOR_FAMILIES, CLASSIC_COLOR_OPTIONS } from "../services/classic-colors.js";
import { UserFacingError } from "./errors.js";
import { requireGuild } from "./shared.js";

export const data = new SlashCommandBuilder()
  .setName("shop")
  .setDescription("Browse appearance items and your Points")
  .addSubcommand(command => command.setName("browse").setDescription("Open the shop flipbook privately"))
  .addSubcommand(command => command.setName("balance").setDescription("Check your Points balance"));

const CATEGORY_LABELS = {
  backgrounds: "Backgrounds", panels: "Panels", frames: "Frames",
  fonts: "Fonts", fontColors: "Text Colors", stickers: "Stickers",
};
// Distinct soft color bands make each permanent storefront category easy to spot.
// Discord embeds cannot have colored backgrounds, so the header itself is a
// compact Canvas image with a full colored background (not just an accent line).
const CATEGORY_THEMES = Object.freeze({
  backgrounds: { background: "#D9E9DD", accent: "#4A7964" },
  panels: { background: "#E8DCF1", accent: "#8462A3" },
  frames: { background: "#F6E0D4", accent: "#B66F4C" },
  fonts: { background: "#DAEAF6", accent: "#587DAA" },
  fontColors: { background: "#F5E9C8", accent: "#AB8847" },
  stickers: { background: "#F6DFE9", accent: "#B4698D" },
});

function storefrontHeaderImage(category) {
  const theme = CATEGORY_THEMES[category];
  const canvas = createCanvas(1200, 216);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, 24, canvas.height);
  ctx.fillRect(0, 206, canvas.width, 10);

  ctx.fillStyle = "#24312C";
  ctx.font = "bold 75px sans-serif";
  ctx.fillText(CATEGORY_LABELS[category], 76, 98, 1020);
  ctx.font = "30px sans-serif";
  ctx.fillText("Featured designs  ·  View All opens your private shop", 80, 165, 1050);
  return canvas.toBuffer("image/png");
}

function categories() {
  return Object.keys(CATEGORY_LABELS).filter(category => shopItems().some(item => item.category === category));
}
function itemsFor(category) {
  return shopItems().filter(item => item.category === category);
}
function exampleAppearance(item) {
  const appearance = resolveAppearance(DEFAULT_APPEARANCE);
  const field = { backgrounds: "background", panels: "panelColor", frames: "frame",
    fonts: "font", fontColors: "fontColor" }[item.category];
  if (field) appearance[field] = item.id;
  if (item.category === "panels" && APPEARANCE_CATALOG.panels[item.id]?.dark) {
    appearance.panelOpacity = 0.9;
  }
  if (item.category === "stickers") appearance.stickers = [
    { id: item.id, x: 0.8, y: 0.72, scale: 1.4, rotation: 0 },
  ];
  return appearance;
}
// Keep these ready-made preview examples in memory so reopening a shop
// category doesn't render the same 1200x800 profile cards again.
const exampleImageCache = new Map();
async function exampleImage(item) {
  const key = `${item.category}:${item.id}`;
  if (!exampleImageCache.has(key)) {
    const task = renderPostImage({
      type: "profile",
      data: { displayName: "Shop Example", discordUsername: "Example",
        robloxUsername: "Example", bio: "See how this design looks on a profile.",
        footer: "Catalog example" },
      appearance: exampleAppearance(item),
    });
    exampleImageCache.set(key, task);
    task.catch(() => exampleImageCache.delete(key));
  }
  return exampleImageCache.get(key);
}

// Catalog browsing needs a fast color sample, not a full profile render.
// My Preview remains the full personalized profile with Mix & Match support.
const swatchCache = new Map();
function catalogSwatch(item) {
  const key = `${item.category}:${item.id}`;
  if (swatchCache.has(key)) return swatchCache.get(key);
  const hex = item.category === "backgrounds"
    ? APPEARANCE_CATALOG.backgrounds[item.id]?.color
    : APPEARANCE_CATALOG.panels[item.id]?.palette?.panel;
  if (!hex) return null;
  const canvas = createCanvas(760, 225);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 760, 225);
  const dark = CLASSIC_COLOR_OPTIONS.find(color => color.id === item.id)?.dark;
  ctx.fillStyle = dark ? "#FFFFFF" : "#242424";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(item.name, 32, 103, 695);
  ctx.font = "27px sans-serif";
  ctx.fillText(hex.toUpperCase(), 33, 159, 695);
  const bytes = canvas.toBuffer("image/png");
  swatchCache.set(key, bytes);
  return bytes;
}
// Render each featured example at full profile-card size instead of squeezing
// three profiles into a single horizontal image. Discord stacks these vertically.
async function featuredCards(featured) {
  const images = await Promise.all(featured.map(exampleImage));
  return {
    embeds: featured.map((item, index) =>
      new EmbedBuilder().setTitle(`${item.name} · ${item.price} Points`)
        .setColor(CATEGORY_THEMES[item.category]?.accent ?? "#819287")
        .setImage(`attachment://shop-featured-${index}.png`)),
    files: images.map((image, index) =>
      new AttachmentBuilder(image, { name: `shop-featured-${index}.png` })),
  };
}
function topThree(category) {
  // Three DIFFERENT hues and tones show off the range of the Classic set;
  // otherwise identical-priced swatches would all come from the Aqua family.
  const classicExamples = {
    backgrounds: ["yellowPastel", "roseNormal", "aquaDark"],
    panels: ["coralPastel", "lavenderNormal", "grayDark"],
  }[category];
  const items = itemsFor(category);
  if (classicExamples) {
    return classicExamples.map(id => items.find(item => item.id === id)).filter(Boolean)
      .slice(0, 3);
  }
  return [...items].sort((a, b) => b.price - a.price || a.id.localeCompare(b.id)).slice(0, 3);
}
function sortedItems(category) {
  // Classic colors are browsed in color-wheel order, with the three variants
  // together, instead of being scattered alphabetically or by price.
  if (category === "backgrounds" || category === "panels") return itemsFor(category);
  return [...(category ? itemsFor(category) : shopItems())]
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
async function featuredPage(context, category) {
  const featured = topThree(category);
  const cards = await featuredCards(featured);
  const balance = await walletBalance(context.guildId, context.user.id);
  return {
    embeds: [new EmbedBuilder().setTitle(`${CATEGORY_LABELS[category]} · Featured`)
      .setDescription(`Featured designs!\n**Your Points: ${balance}**\nBrowse Items starts at the cheapest design.`), ...cards.embeds],
    files: cards.files,
    attachments: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:page:${category}:0`).setLabel("Browse Items →").setStyle(ButtonStyle.Primary),
    )],
    allowedMentions: { parse: [] },
  };
}
async function storefrontCategoryPayload(category, featured) {
  const cards = await featuredCards(featured);
  const header = storefrontHeaderImage(category);
  return {
    embeds: [new EmbedBuilder()
      .setColor(CATEGORY_THEMES[category].accent)
      .setImage("attachment://shop-category-header.png"),
      ...cards.embeds],
    files: [
      new AttachmentBuilder(header, {
        name: "shop-category-header.png",
        description: `${CATEGORY_LABELS[category]} — featured designs. View All opens your private shop.`,
      }),
      ...cards.files,
    ],
    attachments: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:open:${category}`)
        .setLabel("View All").setStyle(ButtonStyle.Primary),
    )],
    allowedMentions: { parse: [] },
  };
}
function balanceEntryPayload() {
  return {
    embeds: [new EmbedBuilder().setTitle("My Points")
      .setDescription("Check how many Points you have. Your balance is only shown to you.")],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("shop:balance")
        .setLabel("Check My Points").setStyle(ButtonStyle.Primary),
    )],
    allowedMentions: { parse: [] },
  };
}
async function updateOrSend(channel, id, payload) {
  if (id) {
    try {
      const message = await channel.messages.fetch(id);
      if (message.author.id === channel.client.user.id) {
        await message.edit(payload);
        return message;
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }
  return channel.send(payload);
}
export async function ensureShopEntry(guild, channel) {
  const config = await GuildConfig.findOne({ guildId: guild.id });
  const existing = config?.shopChannelId === channel.id
    ? Object.fromEntries(config.shopCategoryMessageIds || []) : {};
  const ids = {};
  for (const category of categories()) {
    const featured = topThree(category);
    const message = await updateOrSend(channel, existing[category],
      await storefrontCategoryPayload(category, featured));
    ids[category] = message.id;
  }
  // Always put the balance button after all category examples when first configured.
  const balanceId = config?.shopChannelId === channel.id ? config.shopMessageId : null;
  let balance = await updateOrSend(channel, balanceId, balanceEntryPayload());
  // A newly created category post must not appear below the balance button.
  if (Object.values(ids).some(id => BigInt(id) > BigInt(balance.id))) {
    const replacement = await channel.send(balanceEntryPayload());
    await balance.delete().catch(error => console.warn("Could not remove old shop balance entry:", error));
    balance = replacement;
  }
  await GuildConfig.updateOne({ guildId: guild.id }, {
    $set: { shopChannelId: channel.id, shopMessageId: balance.id,
      shopCategoryMessageIds: ids },
  });
  return balance;
}
async function walletBalance(guildId, userId) {
  return (await PointsWallet.findOne({ guildId, discordUserId: userId }).lean())?.balance ?? 0;
}
function itemPage(item, index, total, balance, owned, category = null) {
  const canAfford = balance >= item.price;
  const embed = new EmbedBuilder().setTitle(`Appearance Shop · ${index + 1}/${total}`)
    .setDescription(`**${item.name}**\nCategory: ${CATEGORY_LABELS[item.category] || item.category}\nPrice: **${item.price} Points**\nStatus: **${owned ? "Owned" : "Not owned"}**\nYour balance: **${balance} Points**${!owned && !canAfford ? `\n**You need ${item.price - balance} more Points to buy this.**` : ""}\n\nUse Preview to see this on your own profile without saving it.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:page:${category || 'all'}:${index - 1}`).setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(index === 0 && !category),
    new ButtonBuilder().setCustomId(`shop:page:${category || 'all'}:${index + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
    new ButtonBuilder().setCustomId(`shop:preview:${category || 'all'}:${index}`).setLabel("Preview").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`shop:buy:${category || 'all'}:${index}`).setLabel(item.included ? "Included" : owned ? "Owned" : `Buy · ${item.price}`).setStyle(ButtonStyle.Success).setDisabled(owned || !canAfford),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}
async function pageFor(interaction, index, category = null) {
  const items = sortedItems(category);
  if (!items.length) throw new UserFacingError("The shop has no items yet.");
  if (index === -1 && category) return featuredPage(interaction, category);
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) throw new UserFacingError("Invalid shop page.");
  const ownership = await getAppearanceOwnership(interaction.guildId, interaction.user.id);
  const item = items[index];
  const result = itemPage(item, index, items.length,
    await walletBalance(interaction.guildId, interaction.user.id),
    ownsAppearanceItem(ownership, item.category, item.id), category);
  const swatch = ["backgrounds", "panels"].includes(item.category)
    ? catalogSwatch(item) : null;
  const image = swatch || await exampleImage(item);
  const fileName = swatch ? "shop-swatch.png" : "shop-example.png";
  result.embeds[0].setImage(`attachment://${fileName}`);
  result.files = [new AttachmentBuilder(image, { name: fileName })];
  result.attachments = [];
  return result;
}
export async function execute(interaction) {
  requireGuild(interaction);
  if (interaction.options.getSubcommand() === "balance") {
    await interaction.editReply({ content: `You have **${await walletBalance(interaction.guildId, interaction.user.id)} Points**.` });
    return;
  }
  await sendShopDM(interaction, categories()[0]);
}
async function previewPayload(context, item, mix = {}) {
  const profile = await UserProfile.findOne({ guildId: context.guildId, discordUserId: context.user.id });
  const appearance = tryOnShopMix(
    profile?.profileAppearance?.background
      ? profile.profileAppearance
      : DEFAULT_APPEARANCE,
    mix,
    item,
  );
  const member = await context.guild.members.fetch(context.user.id).catch(() => null);
  const image = await renderPostImage({
    type: "profile",
    data: {
      displayName: profile?.displayName || context.user.globalName || context.user.username,
      discordUsername: context.user.username,
      robloxUsername: profile?.adoptMeUsername || "",
      bio: profile?.bio || "",
      lookingForTrades: profile?.lookingForTrades || false,
      serverRoles: member ? member.roles.cache.filter(role => role.id !== context.guildId && !role.managed)
        .sort((a, b) => b.position - a.position).map(role => role.name) : [],
      footer: "Shop preview · not saved",
    },
    images: { avatar: context.user.displayAvatarURL({ extension: "png", size: 256 }) },
    appearance,
  });
  return {
    content: item
      ? `**Preview: ${item.name}** — no purchase required to try it on.`
      : "**Mix & Match Preview** — this does not purchase or equip anything.",
    embeds: [new EmbedBuilder().setImage("attachment://shop-preview.png")],
    files: [new AttachmentBuilder(image, { name: "shop-preview.png" })],
    components: [],
    attachments: [],
    allowedMentions: { parse: [] },
  };
}
async function preview(interaction, item) {
  await interaction.editReply(await previewPayload(interaction, item));
}
async function purchase(interaction, item) {
  if (item.included) {
    throw new UserFacingError("This standard color is already included free with every profile.");
  }
  // Wallet deduction and item grant must commit together. Requires MongoDB transactions.
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const inventory = await AppearanceInventory.findOne({
        guildId: interaction.guildId, discordUserId: interaction.user.id,
      }).session(session);
      if (inventory?.owned?.[item.category]?.includes(item.id)) {
        throw new UserFacingError("You already own this item.");
      }
      const debited = await PointsWallet.findOneAndUpdate({
        guildId: interaction.guildId, discordUserId: interaction.user.id, balance: { $gte: item.price },
      }, { $inc: { balance: -item.price } }, { session, returnDocument: "after" });
      if (!debited) throw new UserFacingError("You don't have enough Points yet.");
      await AppearanceInventory.updateOne({
        guildId: interaction.guildId, discordUserId: interaction.user.id,
      }, { $addToSet: { [`owned.${item.category}`]: item.id } },
      { session, upsert: true, setDefaultsOnInsert: true });
    });
  } finally {
    await session.endSession();
  }
}
async function confirmationPage(interaction, item, category, index) {
  const balance = await walletBalance(interaction.guildId, interaction.user.id);
  const ownership = await getAppearanceOwnership(interaction.guildId, interaction.user.id);
  const owned = ownsAppearanceItem(ownership, item.category, item.id);
  const image = await exampleImage(item);
  return {
    embeds: [new EmbedBuilder().setTitle("Confirm your purchase")
      .setDescription(`**${item.name}**\nPrice: **${item.price} Points**\nYour balance: **${balance} Points**\nAfter purchase: **${Math.max(0, balance - item.price)} Points**\n\n${owned ? "You already own this item." : balance < item.price ? "You need more Points to buy this." : "Do you want to buy this item?"}`)
      .setImage("attachment://shop-confirm.png")],
    files: [new AttachmentBuilder(image, { name: "shop-confirm.png" })],
    attachments: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:confirm:${category || "all"}:${index}`)
        .setLabel("Confirm Purchase").setStyle(ButtonStyle.Success).setDisabled(owned || balance < item.price),
      new ButtonBuilder().setCustomId(`shop:cancel:${category || "all"}:${index}`)
        .setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: { parse: [] },
  };
}

function dmShopTools(guildId, category, index) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:dm:${guildId}:mix:${category}:${index}`)
      .setLabel("Mix Preview").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`shop:dm:${guildId}:refresh:${category}:${index}`)
      .setLabel("Refresh Points & Items").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`shop:dm:${guildId}:appearance`)
      .setLabel("Customize Profile").setStyle(ButtonStyle.Primary),
  );
}

async function canPurchase(context, item) {
  const ownership = await getAppearanceOwnership(context.guildId, context.user.id);
  return !ownsAppearanceItem(ownership, item.category, item.id) &&
    (await walletBalance(context.guildId, context.user.id)) >= item.price;
}

function isClassicColorCategory(category) {
  return category === "backgrounds" || category === "panels";
}

// 9 families fit in a single dropdown. Swatch buttons let members choose
// Pastel / Normal / Dark in one click, so all 27 items are at most two clicks
// away instead of needing 26 Next presses.
function shopFamilyMenu(guildId, category, index, preview = false) {
  if (!isClassicColorCategory(category)) return null;
  const family = Math.floor(index / 3);
  const customId = `shop:dm:${guildId}:${preview ? "familyPreview" : "family"}:${category}:${index}`;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId)
      .setPlaceholder("Jump to a color family")
      .addOptions(CLASSIC_COLOR_FAMILIES.map((entry, i) => ({
        label: entry.name, value: entry.id, default: i === family,
      }))),
  );
}

function shopShadeButtons(guildId, category, index, preview = false) {
  if (!isClassicColorCategory(category)) return [];
  const firstIndex = Math.floor(index / 3) * 3;
  return ["Pastel", "Normal", "Dark"].map((label, shade) =>
    new ButtonBuilder()
      .setCustomId(`shop:dm:${guildId}:${preview ? "previewShade" : "shade"}:${category}:${firstIndex + shade}`)
      .setLabel(label)
      .setStyle(shade === index % 3 ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(shade === index % 3),
  );
}

function dmCategoryMenu(guildId, current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`shop:dm:${guildId}:category`)
      .setPlaceholder("Browse another category")
      .addOptions(categories().map(category => ({
        label: CATEGORY_LABELS[category], value: category, default: category === current,
      }))),
  );
}
async function dmItemPage(context, category, index) {
  // Older DM buttons may still refer to page -1; reopen page one instead.
  if (index === -1) index = 0;
  const result = await pageFor(context, index, category);
  result.content = "";
  const item = sortedItems(category)[index];
  const ownership = await getAppearanceOwnership(context.guildId, context.user.id);
  const owned = ownsAppearanceItem(ownership, item.category, item.id);
  const size = sortedItems(category).length;
  const balance = await walletBalance(context.guildId, context.user.id);
  result.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:page:${category}:${index - 1}`)
        .setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:page:${category}:${index + 1}`)
        .setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(index >= size - 1),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:preview:${category}:${index}`)
        .setLabel("My Preview").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:buy:${category}:${index}`)
        .setLabel(item.included ? "Included" : owned ? "Owned" : `Buy · ${item.price}`).setStyle(ButtonStyle.Success).setDisabled(owned || balance < item.price),
    ),
    ...(isClassicColorCategory(category) ? [
      shopFamilyMenu(context.guildId, category, index),
      new ActionRowBuilder().addComponents(
        ...shopShadeButtons(context.guildId, category, index),
      ),
    ] : []),
    dmCategoryMenu(context.guildId, category),
    dmShopTools(context.guildId, category, index),
  ];
  return result;
}
async function dmConfirmation(context, category, index) {
  const item = sortedItems(category)[index];
  const result = await confirmationPage(context, item, category, index);
  result.content = "";
  const ownership = await getAppearanceOwnership(context.guildId, context.user.id);
  const balance = await walletBalance(context.guildId, context.user.id);
  const blocked = ownsAppearanceItem(ownership, item.category, item.id) || balance < item.price;
  result.embeds[0].setDescription(
    `**${item.name}**\nPrice: **${item.price} Points**\nYour balance: **${balance} Points**\n${blocked ? (balance < item.price ? `You need **${item.price - balance} more Points** to buy this.` : "You already own this.") : `After purchase: **${balance - item.price} Points**\nDo you want to buy this item?`}`,
  );
  result.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:confirm:${category}:${index}`)
        .setLabel("Confirm Purchase").setStyle(ButtonStyle.Success).setDisabled(blocked),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:cancel:${category}:${index}`)
        .setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
    dmCategoryMenu(context.guildId, category),
    dmShopTools(context.guildId, category, index),
  ];
  return result;
}
function mixSummary(mix) {
  const picks = SHOP_MIX_CATEGORIES.map(category => {
    const item = mix[category] && shopItems().find(item =>
      item.category === category && item.id === mix[category]);
    return `**${CATEGORY_LABELS[category]}:** ${item ? item.name : "Not selected"}`;
  });
  return picks.join("\n");
}

async function dmPreview(context, category, index, savedMix = {}) {
  const mix = normalizeShopMix(savedMix);
  const items = sortedItems(category);
  const item = items[index];
  const inMix = mix[category] === item.id;
  // The current item is tried on *alongside* the user's previous category
  // selections. The mix only changes when Add to Mix is explicitly pressed.
  const result = await previewPayload(context, item, mix);
  result.content = `**Preview ${index + 1}/${items.length}: ${item.name}**\n` +
    `Mix & Match: **${Object.keys(mix).length}/${SHOP_MIX_CATEGORIES.length} categories saved**. ` +
    `${inMix ? "This item is in your mix." : "Like this look? Choose **Add to Mix** to keep this item while browsing other categories."}\n` +
    "This is a preview only. No Points are spent and your profile is unchanged.";
  result.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:preview:${category}:${index - 1}`)
        .setLabel("◀ Previous Preview").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:preview:${category}:${index + 1}`)
        .setLabel("Next Preview ▶").setStyle(ButtonStyle.Secondary).setDisabled(index >= items.length - 1),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:page:${category}:${index}`)
        .setLabel("← Back to item").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:${inMix ? "unmix" : "addmix"}:${category}:${index}`)
        .setLabel(inMix ? "Remove From Mix" : "Add to Mix")
        .setStyle(inMix ? ButtonStyle.Secondary : ButtonStyle.Success),
      ...shopShadeButtons(context.guildId, category, index, true),
    ),
    ...(isClassicColorCategory(category) ? [shopFamilyMenu(context.guildId, category, index, true)] : []),
    dmCategoryMenu(context.guildId, category),
    dmShopTools(context.guildId, category, index),
  ];
  return result;
}

async function dmMixOverview(context, category, index, savedMix = {}) {
  const mix = normalizeShopMix(savedMix);
  const result = await previewPayload(context, null, mix);
  result.content = "**Your Mix & Match Preview** — one item from each shop category.\n" +
    mixSummary(mix) + "\n\n" +
    "To try more options, **browse a category → My Preview → Add to Mix**. " +
    "You can replace any selection without buying it. Your Points and saved profile are unchanged.";
  result.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:page:${category}:${index}`)
        .setLabel("← Back to item").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:clearmix:${category}:${index}`)
        .setLabel("Clear Mix").setStyle(ButtonStyle.Secondary)
        .setDisabled(!Object.keys(mix).length),
    ),
    dmCategoryMenu(context.guildId, category),
    dmShopTools(context.guildId, category, index),
  ];
  return result;
}
// One permanent shop DM per member and server. Other features can call this
// before sending temporary controls, without creating another shop message.
export async function ensureMemberShopDM(guild, user, category = categories()[0], { refresh = false } = {}) {
  if (!category || !CATEGORY_LABELS[category]) {
    throw new UserFacingError("No shop categories are available.");
  }
  const context = { guildId: guild.id, user, guild };
  const result = await getOrCreateDmPanel({
    guildId: guild.id,
    user,
    kind: "shop",
    makeInitial: async () => ({ payload: await dmItemPage(context, category, 0) }),
    adoptExisting: message => message.components.some(row =>
      row.components?.some(component =>
        component.customId?.startsWith(`shop:dm:${guild.id}:`))),
  });
  if (result.adopted || (refresh && !result.created)) {
    // Reopening from a storefront category starts on its first item and
    // refreshes the Points/owned state on the *same* permanent DM message.
    await result.message.edit(await dmItemPage(context, category, 0));
  }
  return result;
}
async function sendShopDM(interaction, category) {
  const { message, created } = await ensureMemberShopDM(interaction.guild, interaction.user, category, { refresh: true });
  await interaction.editReply({
    content: `${created ? "I opened your personal shop!" : "Your personal shop is already in your DMs."} [**Open your shop**](${dmPanelUrl(message.channelId, message.id)}). You can browse categories, check Points, and customize your profile there.`,
    allowedMentions: { parse: [] },
  });
}
async function handleShopDM(interaction) {
  const [, , guildId, action, categoryText, indexText] = interaction.customId.split(":");
  if (!/^\d{17,21}$/.test(guildId)) throw new UserFacingError("This shop link is invalid.");
  // Acknowledge the interaction *before* member fetches or MongoDB queries,
  // particularly important for old DM buttons just after a bot restart.
  if (action === "appearance") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } else {
    await interaction.deferUpdate();
  }
  const guild = await interaction.client.guilds.fetch(guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must belong to the server to use this shop.");
  const context = { guildId, user: interaction.user, guild };
  if (action === "category" && interaction.isStringSelectMenu()) {
    const selected = interaction.values[0];
    if (!CATEGORY_LABELS[selected] || !itemsFor(selected).length) throw new UserFacingError("Unknown category.");
    await interaction.editReply(await dmItemPage(context, selected, 0));
    return true;
  }
  if (!interaction.isButton() &&
      !((action === "family" || action === "familyPreview") && interaction.isStringSelectMenu())) {
    throw new UserFacingError("Unknown shop control.");
  }
  if (action === "appearance") {
    return openAppearanceDMFromShop(interaction, guild);
  }
  const category = categoryText;
  if (!CATEGORY_LABELS[category] || !itemsFor(category).length) throw new UserFacingError("This category isn't available.");
  const index = indexText === undefined ? NaN : Number(indexText);
  if (!Number.isSafeInteger(index) || index < (action === "page" ? -1 : 0) || index >= itemsFor(category).length) {
    throw new UserFacingError("That shop page isn't available.");
  }
  let destination = index;
  if (action === "family" || action === "familyPreview") {
    if (!isClassicColorCategory(category) || !interaction.isStringSelectMenu()) {
      throw new UserFacingError("That color selection is unavailable.");
    }
    const family = CLASSIC_COLOR_FAMILIES.findIndex(entry => entry.id === interaction.values[0]);
    if (family < 0) throw new UserFacingError("Unknown color family.");
    destination = family * 3 + (index % 3);
  } else if ((action === "shade" || action === "previewShade") && !isClassicColorCategory(category)) {
    throw new UserFacingError("This category has no color shades.");
  }
  if (["page", "cancel", "family", "shade"].includes(action)) {
    await interaction.editReply(await dmItemPage(context, category, destination));
  } else if (["preview", "previewShade", "familyPreview", "mix", "addmix", "unmix", "clearmix"].includes(action)) {
    // Verify the stored panel belongs to this bot, guild, member and message.
    // Preview selections live in MongoDB so a bot restart won't erase them.
    const panel = await MemberDmPanel.findOne({
      botUserId: interaction.client.user.id,
      guildId,
      discordUserId: interaction.user.id,
      kind: "shop",
      channelId: interaction.channelId,
      messageId: interaction.message.id,
    });
    if (!panel) throw new UserFacingError(
      "This private shop needs to be reopened from the server to use Mix & Match.",
    );
    const mix = normalizeShopMix(panel.shopPreviewMix);
    if (action === "addmix") {
      mix[category] = sortedItems(category)[index].id;
    } else if (action === "unmix") {
      if (mix[category] === sortedItems(category)[index].id) delete mix[category];
    } else if (action === "clearmix") {
      for (const key of Object.keys(mix)) delete mix[key];
    }
    if (["addmix", "unmix", "clearmix"].includes(action)) {
      panel.shopPreviewMix = mix;
      panel.markModified("shopPreviewMix");
      await panel.save();
    }
    await interaction.editReply(action === "mix" || action === "clearmix"
      ? await dmMixOverview(context, category, index, mix)
      : await dmPreview(context, category, destination, mix));
  } else if (action === "refresh") {
    await interaction.editReply(await dmItemPage(context, category, index));
  } else if (action === "buy") {
    const item = sortedItems(category)[index];
    if (!await canPurchase(context, item)) {
      await interaction.editReply(await dmItemPage(context, category, index));
      return true;
    }
    await interaction.editReply(await dmConfirmation(context, category, index));
  } else if (action === "confirm") {
    await purchase(context, sortedItems(category)[index]);
    await interaction.editReply(await dmItemPage(context, category, index));
    // The purchase has already committed. A failed optional receipt should
    // never make a successful purchase look like it failed.
    try {
      await sendTemporaryDmNotice(interaction.user,
        `✅ **Purchased ${sortedItems(category)[index].name} for ${sortedItems(category)[index].price} Points!** You can equip it using **Customize Profile** in your permanent shop.`);
    } catch (error) {
      console.warn("Purchase succeeded, but the DM receipt could not be sent:", error);
    }
  } else {
    throw new UserFacingError("Unknown shop action.");
  }
  return true;
}

export async function handleShopButton(interaction) {
  const [, action, rawCategory, rawIndex] = interaction.customId.split(":");
  if (action === "dm") return handleShopDM(interaction);
  if (action === "balance") {
    await interaction.reply({ content: `You have **${await walletBalance(interaction.guildId, interaction.user.id)} Points**.`,
      flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "open") {
    const category = rawCategory && CATEGORY_LABELS[rawCategory] ? rawCategory : null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await sendShopDM(interaction, category || categories()[0]);
    return true;
  }
  const category = rawCategory === "all" ? null : rawCategory;
  if (category && !CATEGORY_LABELS[category]) throw new UserFacingError("Unknown shop category.");
  const items = sortedItems(category);
  const index = rawIndex === undefined ? NaN : Number(rawIndex);
  if (!Number.isSafeInteger(index) || index < (action === "page" && category ? -1 : 0) || index >= items.length) {
    throw new UserFacingError("That shop item is unavailable.");
  }
  if (action === "page" || action === "cancel") {
    await interaction.deferUpdate();
    await interaction.editReply(await pageFor(interaction, index, category));
  } else if (action === "preview") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await preview(interaction, items[index]);
  } else if (action === "buy") {
    await interaction.deferUpdate();
    await interaction.editReply(await confirmationPage(interaction, items[index], category, index));
  } else if (action === "confirm") {
    await interaction.deferUpdate();
    await purchase(interaction, items[index]);
    await interaction.editReply(await pageFor(interaction, index, category));
    await interaction.followUp({ content: `Purchased **${items[index].name}** for **${items[index].price} Points**! You can now equip it in Customize appearance.`,
      flags: MessageFlags.Ephemeral });
  } else {
    throw new UserFacingError("Unknown shop action.");
  }
  return true;
}
