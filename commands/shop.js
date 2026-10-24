
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder,
} from "discord.js";
import mongoose from "mongoose";
import GuildConfig from "../models/GuildConfig.js";
import UserProfile from "../models/UserProfile.js";
import AppearanceInventory from "../models/AppearanceInventory.js";
import PointsWallet from "../models/PointsWallet.js";
import { getOrCreateDmPanel, dmPanelUrl } from "../services/member-dm-panels.js";
import { sendTemporaryDmNotice } from "../services/temporary-dm-notice.js";
import { openAppearanceDMFromShop } from "./profile.js";
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
// Render each featured example at full profile-card size instead of squeezing
// three profiles into a single horizontal image. Discord stacks these vertically.
async function featuredCards(featured) {
  const images = await Promise.all(featured.map(exampleImage));
  return {
    embeds: featured.map((item, index) =>
      new EmbedBuilder().setTitle(`${item.name} · ${item.price} Points`)
        .setImage(`attachment://shop-featured-${index}.png`)),
    files: images.map((image, index) =>
      new AttachmentBuilder(image, { name: `shop-featured-${index}.png` })),
  };
}
function topThree(category) {
  return [...itemsFor(category)].sort((a, b) => b.price - a.price || a.id.localeCompare(b.id)).slice(0, 3);
}
function sortedItems(category) {
  return [...(category ? itemsFor(category) : shopItems())]
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
async function featuredPage(context, category) {
  const featured = topThree(category);
  const cards = await featuredCards(featured);
  const balance = await walletBalance(context.guildId, context.user.id);
  return {
    embeds: [new EmbedBuilder().setTitle(`${CATEGORY_LABELS[category]} · Featured`)
      .setDescription(`Our top ${featured.length} picks!\n**Your Points: ${balance}**\nBrowse Items starts at the cheapest design.`), ...cards.embeds],
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
  return {
    embeds: [new EmbedBuilder().setTitle(CATEGORY_LABELS[category])
      .setDescription(`Top ${featured.length} picks below. Browse all ${CATEGORY_LABELS[category].toLowerCase()} in your DMs.`),
      ...cards.embeds],
    files: cards.files,
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
    .setDescription(`**${item.name}**\nCategory: ${item.category}\nPrice: **${item.price} Points**\nStatus: **${owned ? "Owned" : "Not owned"}**\nYour balance: **${balance} Points**${!owned && !canAfford ? `\n**You need ${item.price - balance} more Points to buy this.**` : ""}\n\nUse Preview to see this on your own profile without saving it.`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop:page:${category || 'all'}:${index - 1}`).setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(index === 0 && !category),
    new ButtonBuilder().setCustomId(`shop:page:${category || 'all'}:${index + 1}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(index === total - 1),
    new ButtonBuilder().setCustomId(`shop:preview:${category || 'all'}:${index}`).setLabel("Preview").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`shop:buy:${category || 'all'}:${index}`).setLabel(owned ? "Owned" : `Buy · ${item.price}`).setStyle(ButtonStyle.Success).setDisabled(owned || !canAfford),
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
  await sendShopDM(interaction, categories()[0]);
}
async function previewPayload(context, item) {
  const profile = await UserProfile.findOne({ guildId: context.guildId, discordUserId: context.user.id });
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
    content: `**Preview: ${item.name}** — this does not change your saved profile.`,
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
        .setLabel(owned ? "Owned" : `Buy · ${item.price}`).setStyle(ButtonStyle.Success).setDisabled(owned || balance < item.price),
    ),
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
async function dmPreview(context, category, index) {
  const item = sortedItems(category)[index];
  const result = await previewPayload(context, item);
  result.components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop:dm:${context.guildId}:page:${category}:${index}`)
        .setLabel("← Back to item").setStyle(ButtonStyle.Primary),
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
  const guild = await interaction.client.guilds.fetch(guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must belong to the server to use this shop.");
  const context = { guildId, user: interaction.user, guild };
  if (action === "category" && interaction.isStringSelectMenu()) {
    const selected = interaction.values[0];
    if (!CATEGORY_LABELS[selected] || !itemsFor(selected).length) throw new UserFacingError("Unknown category.");
    await interaction.deferUpdate();
    await interaction.editReply(await dmItemPage(context, selected, 0));
    return true;
  }
  if (!interaction.isButton()) throw new UserFacingError("Unknown shop control.");
  if (action === "appearance") {
    return openAppearanceDMFromShop(interaction, guild);
  }
  const category = categoryText;
  if (!CATEGORY_LABELS[category] || !itemsFor(category).length) throw new UserFacingError("This category isn't available.");
  const index = indexText === undefined ? NaN : Number(indexText);
  if (!Number.isSafeInteger(index) || index < (action === "page" ? -1 : 0) || index >= itemsFor(category).length) {
    throw new UserFacingError("That shop page isn't available.");
  }
  await interaction.deferUpdate();
  if (action === "page" || action === "cancel") {
    await interaction.editReply(await dmItemPage(context, category, index));
  } else if (action === "preview") {
    await interaction.editReply(await dmPreview(context, category, index));
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
