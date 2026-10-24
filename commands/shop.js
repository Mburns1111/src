
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
import { getAppearanceOwnership, ownsAppearanceItem, filterOwnedAppearance } from "../services/appearance-ownership.js";
import { APPEARANCE_CATALOG, DEFAULT_APPEARANCE, resolveAppearance } from "../services/post-appearance.js";
import { renderPostImage } from "../services/post-renderer.js";
import { normalizeShopMix, tryOnShopMix, SHOP_MIX_CATEGORIES } from "../services/shop-preview-mix.js";
import { CLASSIC_COLOR_FAMILIES, CLASSIC_COLOR_OPTIONS, STANDARD_PANEL_ID } from "../services/classic-colors.js";
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
  ctx.fillText(
    category === "backgrounds" || category === "panels"
      ? "27 classic shades  ·  View All opens your private shop"
      : "Featured designs  ·  View All opens your private shop",
    80, 165, 1050,
  );
  return canvas.toBuffer("image/png");
}

// A compact color chart for the public storefront. The 27 approved swatches
// are identical for Backgrounds and Panels; the FREE standard differs by type.
// Cache each PNG because startup refreshes the same permanent category posts.
const classicChartCache = new Map();
function classicColorChart(category) {
  if (!isClassicColorCategory(category)) return null;
  if (classicChartCache.has(category)) return classicChartCache.get(category);

  const width = 1200, height = 1350;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // Starter Sage is the free background and deliberately is NOT a shop swatch.
  const standardId = category === "panels" ? STANDARD_PANEL_ID : null;
  const xPositions = [32, 424, 816];
  const tileWidth = 352;

  ctx.fillStyle = "#F4F5F3";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#292F2C";
  ctx.font = "bold 45px sans-serif";
  ctx.fillText("CLASSIC COLOR COLLECTION", 36, 67);
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "#515B54";
  ctx.fillText(`${CATEGORY_LABELS[category]}  ·  27 shades  ·  9 color families`, 38, 110);

  for (const [column, label] of ["PASTEL", "NORMAL", "DARK"].entries()) {
    ctx.font = "bold 27px sans-serif";
    ctx.fillStyle = "#303C35";
    ctx.fillText(label, xPositions[column] + 8, 160);
  }

  CLASSIC_COLOR_FAMILIES.forEach((family, row) => {
    const rowY = 173 + row * 129;
    ctx.fillStyle = "#303C35";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(family.name, 38, rowY + 26);

    ["pastel", "normal", "dark"].forEach((variant, column) => {
      const option = CLASSIC_COLOR_OPTIONS[row * 3 + column];
      const x = xPositions[column], y = rowY + 33;
      ctx.fillStyle = option.hex;
      // Rectangles are supported on all @napi-rs/canvas versions used by
      // our hosts; a subtle border keeps pale/white swatches distinct.
      ctx.fillRect(x, y, tileWidth, 82);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(35,45,38,.15)";
      ctx.strokeRect(x, y, tileWidth, 82);

      const ink = option.dark ? "#FFFFFF" : "#232B26";
      ctx.fillStyle = ink;
      ctx.font = "bold 28px sans-serif";
      ctx.fillText(option.hex, x + 17, y + 49);
      if (option.id === standardId) {
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("FREE", x + tileWidth - 15, y + 49);
        ctx.textAlign = "left";
      }
    });
  });

  const buffer = canvas.toBuffer("image/png");
  classicChartCache.set(category, buffer);
  return buffer;
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
  // Public Backgrounds and Panels already show ALL 27 classic colors in a
  // compact chart. Leave their large, lower featured examples EMPTY until
  // we add fancy/premium artwork worth showcasing.
  //
  // TO RESTORE classic profile examples later, replace the return [] below
  // with the following code (this keeps the old method documented):
  //
  // const classicIds = category === "backgrounds"
  //   ? ["yellowPastel", "roseNormal", "aquaDark"]
  //   : ["coralPastel", "lavenderNormal", "grayDark"];
  // return classicIds
  //   .map(id => itemsFor(category).find(item => item.id === id))
  //   .filter(Boolean)
  //   .slice(0, 3);
  //
  // FOR FUTURE FANCY DESIGNS, use the exact same pattern above but substitute
  // the new premium item IDs. featuredCards() and storefrontCategoryPayload()
  // below already render up to three large examples automatically.
  if (category === "backgrounds" || category === "panels") return [];

  const items = itemsFor(category);
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
  const chart = classicColorChart(category);
  const chartEmbed = chart
    ? [new EmbedBuilder().setColor(CATEGORY_THEMES[category].accent)
        .setTitle("Classic Color Chart · All 27 Shades")
        .setDescription(category === "backgrounds"
          ? "Nine color families in Pastel, Normal, and Dark. **Starter Sage** is the free default background and is not sold here; all 27 Classic backgrounds are purchasable."
          : "Nine color families in Pastel, Normal, and Dark. **FREE** marks the standard Classic Gray panel color.")
        .setImage("attachment://shop-classic-colors.png")]
    : [];
  return {
    embeds: [new EmbedBuilder()
      .setColor(CATEGORY_THEMES[category].accent)
      .setImage("attachment://shop-category-header.png"),
      ...chartEmbed,
      ...cards.embeds],
    files: [
      new AttachmentBuilder(header, {
        name: "shop-category-header.png",
        description: `${CATEGORY_LABELS[category]} — featured designs. View All opens your private shop.`,
      }),
      ...(chart ? [new AttachmentBuilder(chart, {
        name: "shop-classic-colors.png",
        description: `27 Classic ${CATEGORY_LABELS[category].toLowerCase()} swatches in 9 color families, arranged Pastel, Normal and Dark.`,
      })] : []),
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
async function pageFor(interaction, index, category = null, knownStatus = null) {
  const items = sortedItems(category);
  if (!items.length) throw new UserFacingError("The shop has no items yet.");
  if (index === -1 && category) return featuredPage(interaction, category);
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) throw new UserFacingError("Invalid shop page.");
  const [ownership, balance] = knownStatus
    ? [knownStatus.ownership, knownStatus.balance]
    : await Promise.all([
      getAppearanceOwnership(interaction.guildId, interaction.user.id),
      walletBalance(interaction.guildId, interaction.user.id),
    ]);
  const item = items[index];
  const result = itemPage(item, index, items.length, balance,
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
  const [profile, ownership, member] = await Promise.all([
    UserProfile.findOne({ guildId: context.guildId, discordUserId: context.user.id }),
    getAppearanceOwnership(context.guildId, context.user.id),
    context.guild.members.fetch(context.user.id).catch(() => null),
  ]);
  // Equipped colors left over from the previous free Leaf Green standard
  // should not appear as purchased in the try-on. Start from the same owned
  // appearance that the server profile card displays, then overlay previews.
  const baseAppearance = filterOwnedAppearance(
    profile?.profileAppearance?.background ? profile.profileAppearance : DEFAULT_APPEARANCE,
    ownership,
  );
  const appearance = tryOnShopMix(baseAppearance, mix, item);
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
      .setLabel("Mix & Match").setStyle(ButtonStyle.Primary),
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
  const [ownership, balance] = await Promise.all([
    getAppearanceOwnership(context.guildId, context.user.id),
    walletBalance(context.guildId, context.user.id),
  ]);
  const result = await pageFor(context, index, category, { ownership, balance });
  result.content = "";
  const item = sortedItems(category)[index];
  const owned = ownsAppearanceItem(ownership, item.category, item.id);
  const size = sortedItems(category).length;
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
// Mix & Match is now one live dress-up screen in the existing permanent
// shop DM. Dropdowns update its preview immediately; no Add to Mix required.
const MIX_OPTION_PAGE_SIZE = 22;
const MIX_DEFAULT_ITEM_LABELS = {
  frames: [{ id: "default", name: "Standard frame · Free" }],
  fonts: [{ id: "default", name: "Standard font · Free" }],
  fontColors: [
    { id: "default", name: "Default text · Free" },
    { id: "black", name: "Black text · Free" },
    { id: "white", name: "White text · Free" },
  ],
  stickers: [{ id: "none", name: "No stickers" }],
};

function mixValueName(category, id) {
  if (!id) return "My equipped profile";
  if (category === "panels" && id === "match") return "Match background";
  if (category === "stickers" && id === "none") return "No stickers";
  const included = MIX_DEFAULT_ITEM_LABELS[category]?.find(item => item.id === id);
  if (included) return included.name.replace(" · Free", "");
  const item = itemsFor(category).find(item => item.id === id);
  if (item) return item.name;
  return CLASSIC_COLOR_OPTIONS.find(color => color.id === id)?.name || "Previous saved design";
}

function mixSummary(mix) {
  return SHOP_MIX_CATEGORIES.map(category =>
    `**${CATEGORY_LABELS[category]}:** ${mixValueName(category, mix[category])}`,
  ).join("\n");
}

function mixColorPosition(category, mix) {
  const index = CLASSIC_COLOR_OPTIONS.findIndex(item => item.id === mix[category]);
  return {
    familyIndex: index >= 0 ? Math.floor(index / 3) : category === "backgrounds" ? 7 : 8,
    variant: index >= 0 ? CLASSIC_COLOR_OPTIONS[index].variant
      : category === "backgrounds" ? "pastel" : "normal",
  };
}

function mixItemEntries(category) {
  return [...(MIX_DEFAULT_ITEM_LABELS[category] || []), ...itemsFor(category)];
}

function mixEditorChrome(context, panel, mix) {
  const category = SHOP_MIX_CATEGORIES.includes(panel.shopMixCategory)
    ? panel.shopMixCategory : "backgrounds";
  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`shop:dm:${context.guildId}:mixCategory`)
        .setPlaceholder("1 · Choose what to customize")
        .addOptions(SHOP_MIX_CATEGORIES.map(id => ({
          label: CATEGORY_LABELS[id], value: id, default: category === id,
        }))),
    ),
  ];

  if (isClassicColorCategory(category)) {
    const { familyIndex, variant } = mixColorPosition(category, mix);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`shop:dm:${context.guildId}:mixFamily`)
        .setPlaceholder("2 · Choose a color family")
        .addOptions(CLASSIC_COLOR_FAMILIES.map((item, i) => ({
          label: item.name, value: item.id, default: familyIndex === i,
        }))),
    ));
    const shades = ["pastel", "normal", "dark"].map((shade, i) => {
      const color = CLASSIC_COLOR_OPTIONS[familyIndex * 3 + i];
      return new ButtonBuilder()
        .setCustomId(`shop:dm:${context.guildId}:mixShade:${shade}`)
        .setLabel(shade[0].toUpperCase() + shade.slice(1))
        .setStyle(shade === variant ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(mix[category] === color.id);
    });
    if (category === "panels") {
      shades.push(new ButtonBuilder()
        .setCustomId(`shop:dm:${context.guildId}:mixMatch`)
        .setLabel("Match Background")
        .setStyle(mix.panels === "match" ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(mix.panels === "match"));
    }
    rows.push(new ActionRowBuilder().addComponents(...shades));
  } else {
    const entries = mixItemEntries(category);
    const maxPage = Math.max(0, Math.ceil(entries.length / MIX_OPTION_PAGE_SIZE) - 1);
    const page = Math.max(0, Math.min(maxPage, Number.isInteger(panel.shopMixOptionPage)
      ? panel.shopMixOptionPage : 0));
    const visible = entries.slice(page * MIX_OPTION_PAGE_SIZE, (page + 1) * MIX_OPTION_PAGE_SIZE);
    const options = [
      { label: "Use my equipped profile", value: "__reset__",
        description: "Undo the preview choice for this category", default: !mix[category] },
      ...visible.map(item => ({
        label: item.name,
        value: item.id,
        description: item.price === undefined || item.included
          ? "Free · Try on now" : `Preview only · ${item.price} Points to buy`,
        default: mix[category] === item.id,
      })),
      ...(page > 0 ? [{ label: "← Previous items", value: "__previous__" }] : []),
      ...(page < maxPage ? [{ label: "More items →", value: "__next__" }] : []),
    ];
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`shop:dm:${context.guildId}:mixItem`)
        .setPlaceholder(`2 · Choose ${CATEGORY_LABELS[category].toLowerCase()}`)
        .addOptions(options),
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:mixReset`)
      .setLabel("Use My Profile").setStyle(ButtonStyle.Secondary)
      .setDisabled(!mix[category]),
    new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:mixClear`)
      .setLabel("Clear All Choices").setStyle(ButtonStyle.Secondary)
      .setDisabled(!Object.keys(mix).length),
    new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:mixBack`)
      .setLabel("← Back to Shop").setStyle(ButtonStyle.Primary),
  ));
  return {
    content: `**Mix & Match · Live Profile Preview**\n` +
      `Editing **${CATEGORY_LABELS[category]}** — pick a style and your profile preview updates automatically.\n\n` +
      mixSummary(mix) + "\n\n" +
      "**Just trying things on:** No purchases, no Points spent, and no changes to your saved profile.",
    components: rows,
    allowedMentions: { parse: [] },
  };
}

async function dmMixEditor(context, panel, { reuseImage = false } = {}) {
  const mix = normalizeShopMix(panel.shopPreviewMix);
  const chrome = mixEditorChrome(context, panel, mix);
  if (reuseImage) return chrome; // Only the controls changed: keep current PNG
  return { ...await previewPayload(context, null, mix), ...chrome };
}

async function dmPreview(context, category, index, savedMix = {}) {
  const mix = normalizeShopMix(savedMix);
  const items = sortedItems(category);
  const item = items[index];
  const result = await previewPayload(context, item, mix);
  result.content = `**Single-Item Preview ${index + 1}/${items.length}: ${item.name}**\n` +
    "To combine backgrounds, panels, frames, fonts, text colors and stickers, open **Mix & Match**. " +
    "You'll change everything directly on one live profile preview, without buying anything.";
  result.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:preview:${category}:${index - 1}`)
        .setLabel("◀ Previous Preview").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:preview:${category}:${index + 1}`)
        .setLabel("Next Preview ▶").setStyle(ButtonStyle.Secondary).setDisabled(index >= items.length - 1),
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:page:${category}:${index}`)
        .setLabel("← Back to item").setStyle(ButtonStyle.Primary),
    ),
    ...(isClassicColorCategory(category)
      ? [
        new ActionRowBuilder().addComponents(
          ...shopShadeButtons(context.guildId, category, index, true),
        ),
        shopFamilyMenu(context.guildId, category, index, true),
      ] : []),
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

  // Live Mix & Match: all controls operate on the SAME permanent DM. Users
  // need no purchases and never need to press Add to Mix or Confirm.
  const mixEditorActions = [
    "mixCategory", "mixFamily", "mixShade", "mixMatch", "mixItem",
    "mixReset", "mixClear", "mixBack", "mixRefresh",
  ];
  if (mixEditorActions.includes(action)) {
    const isSelect = ["mixCategory", "mixFamily", "mixItem"].includes(action);
    if (isSelect ? !interaction.isStringSelectMenu() : !interaction.isButton()) {
      throw new UserFacingError("That preview control is invalid.");
    }
    const panel = await MemberDmPanel.findOne({
      botUserId: interaction.client.user.id,
      guildId,
      discordUserId: interaction.user.id,
      kind: "shop",
      channelId: interaction.channelId,
      messageId: interaction.message.id,
    });
    if (!panel) throw new UserFacingError(
      "Please reopen your private shop from the server to use Mix & Match.",
    );
    if (action === "mixBack") {
      const backCategory = CATEGORY_LABELS[panel.shopMixReturnCategory]
        ? panel.shopMixReturnCategory : "backgrounds";
      const backIndex = Number.isSafeInteger(panel.shopMixReturnIndex) &&
        panel.shopMixReturnIndex >= 0 &&
        panel.shopMixReturnIndex < sortedItems(backCategory).length
        ? panel.shopMixReturnIndex : 0;
      await interaction.editReply(await dmItemPage(context, backCategory, backIndex));
      return true;
    }

    const category = SHOP_MIX_CATEGORIES.includes(panel.shopMixCategory)
      ? panel.shopMixCategory : "backgrounds";
    const mix = normalizeShopMix(panel.shopPreviewMix);
    let imageChanged = false;
    if (action === "mixCategory") {
      const selected = interaction.values[0];
      if (!SHOP_MIX_CATEGORIES.includes(selected)) throw new UserFacingError("Unknown mix category.");
      panel.shopMixCategory = selected;
      panel.shopMixOptionPage = 0;
    } else if (action === "mixFamily") {
      if (!isClassicColorCategory(category)) throw new UserFacingError("This isn't a color category.");
      const family = CLASSIC_COLOR_FAMILIES.find(item => item.id === interaction.values[0]);
      if (!family) throw new UserFacingError("Unknown color family.");
      const { variant } = mixColorPosition(category, mix);
      mix[category] = `${family.id}${variant[0].toUpperCase() + variant.slice(1)}`;
      imageChanged = true;
    } else if (action === "mixShade") {
      if (!isClassicColorCategory(category)) throw new UserFacingError("This isn't a color category.");
      const shade = categoryText;
      if (!["pastel", "normal", "dark"].includes(shade)) {
        throw new UserFacingError("Unknown color shade.");
      }
      const { familyIndex } = mixColorPosition(category, mix);
      mix[category] = CLASSIC_COLOR_OPTIONS[familyIndex * 3 + ["pastel", "normal", "dark"].indexOf(shade)].id;
      imageChanged = true;
    } else if (action === "mixMatch") {
      if (category !== "panels") throw new UserFacingError("Only panels can match the background.");
      mix.panels = "match";
      imageChanged = true;
    } else if (action === "mixItem") {
      if (isClassicColorCategory(category)) throw new UserFacingError("Use the color controls instead.");
      const choice = interaction.values[0];
      const entries = mixItemEntries(category);
      const maxPage = Math.max(0, Math.ceil(entries.length / MIX_OPTION_PAGE_SIZE) - 1);
      const page = Math.max(0, Math.min(maxPage, Number.isInteger(panel.shopMixOptionPage)
        ? panel.shopMixOptionPage : 0));
      if (choice === "__next__" || choice === "__previous__") {
        panel.shopMixOptionPage = Math.max(0, Math.min(maxPage,
          page + (choice === "__next__" ? 1 : -1)));
      } else if (choice === "__reset__") {
        delete mix[category];
        imageChanged = true;
      } else if (entries.some(item => item.id === choice)) {
        mix[category] = choice;
        imageChanged = true;
      } else {
        throw new UserFacingError("This item isn't available in the preview.");
      }
    } else if (action === "mixReset") {
      delete mix[category];
      imageChanged = true;
    } else if (action === "mixClear") {
      for (const key of Object.keys(mix)) delete mix[key];
      imageChanged = true;
    }

    if (imageChanged) {
      panel.shopPreviewMix = mix;
      panel.markModified("shopPreviewMix");
    }
    await panel.save();
    // Simply switching categories or paging the item dropdown never re-renders
    // the unchanged PNG, making the permanent DM much snappier to navigate.
    await interaction.editReply(await dmMixEditor(context, panel, {
      reuseImage: !imageChanged && action !== "mixRefresh",
    }));
    return true;
  }

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
    // Keep old buttons valid across a deployment. Old Add to Mix clicks now
    // open the new live dress-up screen with that selection already chosen.
    const panel = await MemberDmPanel.findOne({
      botUserId: interaction.client.user.id,
      guildId,
      discordUserId: interaction.user.id,
      kind: "shop",
      channelId: interaction.channelId,
      messageId: interaction.message.id,
    });
    if (!panel) throw new UserFacingError(
      "Please reopen your private shop from the server to use Mix & Match.",
    );
    const mix = normalizeShopMix(panel.shopPreviewMix);
    if (action === "addmix") {
      mix[category] = sortedItems(category)[index].id;
    } else if (action === "unmix") {
      if (mix[category] === sortedItems(category)[index].id) delete mix[category];
    } else if (action === "clearmix") {
      for (const key of Object.keys(mix)) delete mix[key];
    }
    if (["mix", "addmix", "unmix", "clearmix"].includes(action)) {
      panel.shopPreviewMix = mix;
      panel.shopMixCategory = category;
      panel.shopMixOptionPage = 0;
      panel.shopMixReturnCategory = category;
      panel.shopMixReturnIndex = index;
      panel.markModified("shopPreviewMix");
      await panel.save();
      await interaction.editReply(await dmMixEditor(context, panel));
    } else {
      await interaction.editReply(await dmPreview(context, category, destination, mix));
    }
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
