import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from "discord.js";
import mongoose from "mongoose";
import GuildConfig from "../models/GuildConfig.js";
import UserProfile from "../models/UserProfile.js";
import AppearanceInventory from "../models/AppearanceInventory.js";
import PointsWallet from "../models/PointsWallet.js";
import { shopItems, shopItem } from "../services/shop-catalog.js";
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

function entryPayload() {
  return {
    embeds: [new EmbedBuilder().setTitle("Appearance Shop").setDescription(
      "Browse backgrounds, panels, frames, fonts, colors and stickers. Preview items on your profile before spending Points. Your purchases are unlocked across post types."
    )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("shop:open").setLabel("Browse shop").setStyle(ButtonStyle.Primary),
    )],
    allowedMentions: { parse: [] },
  };
}
export async function ensureShopEntry(guild, channel) {
  const config = await GuildConfig.findOne({ guildId: guild.id });
  if (config?.shopChannelId === channel.id && config.shopMessageId) {
    try {
      const existing = await channel.messages.fetch(config.shopMessageId);
      if (existing.author.id === guild.client.user.id) {
        await existing.edit(entryPayload());
        return existing;
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }
  const message = await channel.send(entryPayload());
  await GuildConfig.updateOne({ guildId: guild.id }, {
    $set: { shopChannelId: channel.id, shopMessageId: message.id },
  });
  return message;
}
async function walletBalance(guildId, userId) {
  return (await PointsWallet.findOne({ guildId, discordUserId: userId }).lean())?.balance ?? 0;
}
function itemPage(item, index, total, balance, owned) {
  const embed = new EmbedBuilder().setTitle(`Appearance Shop · ${index + 1}/${total}`)
    .setDescription(`**${item.name}**\nCategory: ${item.category}\nPrice: **${item.price} Points**\nStatus: **${owned ? "Owned" : "Not owned"}**\nYour balance: **${balance} Points**\n\nUse Preview to see this on your own profile without saving it.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:page:${index - 1}`).setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`shop:page:${index + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
    new ButtonBuilder().setCustomId(`shop:preview:${index}`).setLabel("Preview").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`shop:buy:${index}`).setLabel(owned ? "Owned" : `Buy · ${item.price}`).setStyle(ButtonStyle.Success).setDisabled(owned),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}
async function pageFor(interaction, index) {
  const items = shopItems();
  if (!items.length) throw new UserFacingError("The shop has no items yet.");
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) throw new UserFacingError("Invalid shop page.");
  const ownership = await getAppearanceOwnership(interaction.guildId, interaction.user.id);
  return itemPage(items[index], index, items.length,
    await walletBalance(interaction.guildId, interaction.user.id),
    ownsAppearanceItem(ownership, items[index].category, items[index].id));
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
export async function handleShopButton(interaction) {
  const [prefix, action, rawIndex] = interaction.customId.split(":");
  if (prefix !== "shop") return false;
  if (action === "open") {
    await interaction.reply({ ...(await pageFor(interaction, 0)), flags: MessageFlags.Ephemeral });
    return true;
  }
  const index = Number(rawIndex);
  const items = shopItems();
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) {
    throw new UserFacingError("That shop item is unavailable.");
  }
  if (action === "page") {
    await interaction.update(await pageFor(interaction, index));
  } else if (action === "preview") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await preview(interaction, items[index]);
  } else if (action === "buy") {
    await interaction.deferUpdate();
    await purchase(interaction, items[index]);
    await interaction.editReply(await pageFor(interaction, index));
    await interaction.followUp({ content: `Purchased **${items[index].name}** for **${items[index].price} Points**! You can now equip it in Customize appearance.`, flags: MessageFlags.Ephemeral });
  } else {
    throw new UserFacingError("Unknown shop action.");
  }
  return true;
}
