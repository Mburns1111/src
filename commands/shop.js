import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags, SlashCommandBuilder,
} from "discord.js";
import mongoose from "mongoose";
import GuildConfig from "../models/GuildConfig.js";
import UserProfile from "../models/UserProfile.js";
import AppearanceInventory from "../models/AppearanceInventory.js";
import PointsWallet from "../models/PointsWallet.js";
import { shopItems } from "../services/shop-catalog.js";
import { getAppearanceOwnership, ownsAppearanceItem } from "../services/appearance-ownership.js";
import { resolveAppearance } from "../services/post-appearance.js";
import { renderPostImage } from "../services/post-renderer.js";
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
function categories() {
  return Object.keys(CATEGORY_LABELS).filter(category => shopItems().some(item => item.category === category));
}
function itemsFor(category) {
  return shopItems().filter(item => item.category === category);
}
function exampleAppearance(item) {
  const appearance = resolveAppearance({ background: "sagePreview", panelColor: "match", panelOpacity: 0.34 });
  const field = { backgrounds: "background", panels: "panelColor", frames: "frame",
    fonts: "font", fontColors: "fontColor" }[item.category];
  if (field) appearance[field] = item.id;
  if (item.category === "stickers") appearance.stickers = [
    { id: item.id, x: 0.8, y: 0.72, scale: 1.4, rotation: 0 },
  ];
  return appearance;
}
async function exampleImage(item) {
  return renderPostImage({
    type: "profile",
    data: { displayName: "Shop Example", discordUsername: "Example",
      robloxUsername: "Example", bio: "See how this design looks on a profile.",
      footer: "Catalog example" },
    appearance: exampleAppearance(item),
  });
}
async function featuredImage(featured) {
  const width = 1200, tileWidth = 380, gap = 15;
  const canvas = createCanvas(width, 330);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#E9F0E7";
  ctx.fillRect(0, 0, width, 330);
  for (let i = 0; i < featured.length; i++) {
    const item = featured[i];
    const img = await loadImage(await exampleImage(item));
    const x = 15 + i * (tileWidth + gap);
    ctx.drawImage(img, x, 15, tileWidth, 253);
    ctx.fillStyle = "#29312C";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(item.name.slice(0, 28), x + 5, 291);
    ctx.font = "16px sans-serif";
    ctx.fillText(item.price + " Points", x + 5, 314);
  }
  return canvas.toBuffer("image/png");
}
function topThree(category) {
  return [...itemsFor(category)].sort((a, b) => b.price - a.price || a.id.localeCompare(b.id)).slice(0, 3);
}
function sortedItems(category) {
  return [...(category ? itemsFor(category) : shopItems())]
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
async function featuredPage(interaction, category) {
  const featured = topThree(category);
  const image = await featuredImage(featured);
  const balance = await walletBalance(interaction.guildId, interaction.user.id);
  return {
    embeds: [new EmbedBuilder().setTitle(`${CATEGORY_LABELS[category]} · Featured`)
      .setDescription(`Our top ${featured.length} picks!\n**Your Points: ${balance}**\nPress Browse Items to start with the cheapest and work your way up.`)
      .setImage("attachment://shop-featured.png")],
    files: [new AttachmentBuilder(image, { name: "shop-featured.png" })],
    attachments: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:page:${category}:0`).setLabel("Browse Items →").setStyle(ButtonStyle.Primary),
    )],
    allowedMentions: { parse: [] },
  };
}
function storefrontCategoryPayload(category, featured, image) {
  return {
    embeds: [new EmbedBuilder()
      .setTitle(CATEGORY_LABELS[category])
      .setDescription(`Top picks: ${featured.map(item => `**${item.name}** (${item.price} Points)`).join(" · ")}\nBrowse all ${CATEGORY_LABELS[category].toLowerCase()} privately.`)
      .setImage("attachment://shop-example.png")],
    files: [new AttachmentBuilder(image, { name: "shop-example.png" })],
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
    const image = await featuredImage(featured);
    const message = await updateOrSend(channel, existing[category],
      storefrontCategoryPayload(category, featured, image));
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
  const embed = new EmbedBuilder().setTitle(`Appearance Shop · ${index + 1}/${total}`)
    .setDescription(`**${item.name}**\nCategory: ${item.category}\nPrice: **${item.price} Points**\nStatus: **${owned ? "Owned" : "Not owned"}**\nYour balance: **${balance} Points**\n\nUse Preview to see this on your own profile without saving it.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:page:${category || 'all'}:${index - 1}`).setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(index === 0 && !category),
    new ButtonBuilder().setCustomId(`shop:page:${category || 'all'}:${index + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
    new ButtonBuilder().setCustomId(`shop:preview:${category || 'all'}:${index}`).setLabel("Preview").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`shop:buy:${category || 'all'}:${index}`).setLabel(owned ? "Owned" : `Buy · ${item.price}`).setStyle(ButtonStyle.Success).setDisabled(owned),
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
  const example = await exampleImage(item);
  result.embeds[0].setImage("attachment://shop-example.png");
  result.files = [new AttachmentBuilder(example, { name: "shop-example.png" })];
  result.attachments = [];
  return result;
}
export async function execute(interaction) {
  requireGuild(interaction);
  if (interaction.options.getSubcommand() === "balance") {
    await interaction.editReply({ content: `You have **${await walletBalance(interaction.guildId, interaction.user.id)} Points**.` });
    return;
  }
  await interaction.editReply(await pageFor(interaction, 0));
}
async function preview(interaction, item) {
  const profile = await UserProfile.findOne({ guildId: interaction.guildId, discordUserId: interaction.user.id });
  const appearance = resolveAppearance(profile?.profileAppearance?.background
    ? profile.profileAppearance
    : { background: "sagePreview", panelColor: "match", panelOpacity: 0.34 });
  const field = { backgrounds: "background", panels: "panelColor", frames: "frame",
    fonts: "font", fontColors: "fontColor" }[item.category];
  if (field) appearance[field] = item.id;
  if (item.category === "stickers") {
    appearance.stickers = [...appearance.stickers.slice(0, 7),
      { id: item.id, x: 0.8, y: 0.72, scale: 1, rotation: 0 }];
  }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const image = await renderPostImage({
    type: "profile",
    data: {
      displayName: profile?.displayName || interaction.user.globalName || interaction.user.username,
      discordUsername: interaction.user.username,
      robloxUsername: profile?.adoptMeUsername || "",
      bio: profile?.bio || "",
      lookingForTrades: profile?.lookingForTrades || false,
      serverRoles: member ? member.roles.cache.filter(role => role.id !== interaction.guildId && !role.managed)
        .sort((a, b) => b.position - a.position).map(role => role.name) : [],
      footer: "Shop preview · not saved",
    },
    images: { avatar: interaction.user.displayAvatarURL({ extension: "png", size: 256 }) },
    appearance,
  });
  await interaction.editReply({
    content: `**Preview: ${item.name}** — this does not change your saved profile.`,
    embeds: [new EmbedBuilder().setImage("attachment://shop-preview.png")],
    files: [new AttachmentBuilder(image, { name: "shop-preview.png" })],
    components: [],
  });
}
async function purchase(interaction, item) {
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
export async function handleShopButton(interaction) {
  const [, action, rawCategory, rawIndex] = interaction.customId.split(":");
  if (action === "balance") {
    await interaction.reply({ content: `You have **${await walletBalance(interaction.guildId, interaction.user.id)} Points**.`,
      flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "open") {
    const category = rawCategory && CATEGORY_LABELS[rawCategory] ? rawCategory : null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(category ? await featuredPage(interaction, category) : await pageFor(interaction, 0));
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
