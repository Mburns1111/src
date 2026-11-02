import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import PointsWallet from "../models/PointsWallet.js";
import { startCardCollection } from "./card-collection-ui.js";
import { startCardShop } from "./card-shop-ui.js";
import { loadAchievementMessage } from "./card-achievements-ui.js";

const validId = value => /^\d{17,20}$/.test(String(value || ""));
const safe = value => String(value || "").replace(/[@`*_~|<>\r\n]/g, "").slice(0, 60);
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const RARITIES = ["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"];

export function inventoryButtons(guildId, userId) {
  if (!validId(guildId) || !validId(userId)) throw Error("Invalid inventory owner or server.");
  const row = new ActionRowBuilder();
  for (const [action, label, style] of [
    ["collection", "Collection", ButtonStyle.Primary],
    ["achievements", "Achievements", ButtonStyle.Secondary],
    ["shop", "Hatchem Shop", ButtonStyle.Secondary],
  ]) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`cards:inventory:${action}:${guildId}:${userId}`)
      .setLabel(label).setStyle(style));
  }
  return [row];
}

/** Read-only snapshot. Card ownership and bonus uses are global; Points are per-server. */
export async function cardInventoryPayload({ guildId, userId, displayName }) {
  if (!validId(guildId) || !validId(userId)) throw Error("Invalid inventory owner or server.");
  const [collector, wallet, stages] = await Promise.all([
    CardCollector.findOne({ discordUserId: userId }).select("bonusGrabs bonusDrops dust").lean(),
    PointsWallet.findOne({ guildId, discordUserId: userId }).select("balance").lean(),
    CardCopy.aggregate([
      { $match: { ownerDiscordUserId: userId, state: "owned" } },
      { $group: { _id: "$upgradeLevel", total: { $sum: 1 } } },
    ]),
  ]);
  const byStage = Object.fromEntries(stages.map(row => [row._id, count(row.total)]));
  const normal = byStage.normal || 0, neon = byStage.neon || 0, mega = byStage.mega || 0;
  const total = normal + neon + mega;
  const dust = collector?.dust || {};
  const embed = new EmbedBuilder()
    .setColor(0xB9A4D7)
    .setTitle("🥚 Hatchem — " + safe(displayName || "Collector") + "'s Inventory")
    .setDescription("A public snapshot of <@" + userId + ">'s Hatchem collection and resources.")
    .addFields(
      { name: "🎟️ Extra Actions", value:
        "**Extra Grabs:** " + count(collector?.bonusGrabs) +
        "\n**Extra Drops:** " + count(collector?.bonusDrops), inline: true },
      { name: "🃏 Owned Cards", value:
        "**Total:** " + total +
        "\nNormal: " + normal + " · Neon: " + neon + " · Mega Neon: " + mega, inline: true },
      { name: "✨ Points & Dust", value:
        "**Points (this server):** " + count(wallet?.balance) +
        "\n" + RARITIES.map(rarity => rarity + " Dust: " + count(dust[rarity])).join("\n"), inline: false },
    )
    .setFooter({ text: "Cards, extras and dust are global · Points are specific to this server" });
  return {
    embeds: [embed],
    components: inventoryButtons(guildId, userId),
    allowedMentions: { parse: [] },
  };
}

export async function startCardInventory(interaction) {
  if (process.env.ENABLE_CARD_GAME_TEST !== "1")
    return interaction.editReply("Hatchem inventory is available on the development bot only.");
  try {
    return await interaction.editReply(await cardInventoryPayload({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    }));
  } catch (error) {
    console.error("[Hatchem Inventory] Failed to read inventory:", error);
    return interaction.editReply({ content: "Could not load your Hatchem inventory. Try again.", allowedMentions: { parse: [] } });
  }
}

export async function handleCardInventoryInteraction(interaction) {
  const parts = String(interaction.customId || "").split(":");
  const action = parts[2], guildId = parts[3], userId = parts[4];
  if (!interaction.isButton() || parts.length !== 5 ||
      !["collection", "achievements", "shop"].includes(action) ||
      !validId(guildId) || !validId(userId) ||
      !interaction.guildId || interaction.guildId !== guildId) {
    return interaction.reply({ content: "Invalid Hatchem inventory button.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: "That inventory belongs to another collector. Use `.inventory` to open your own.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
  if (process.env.ENABLE_CARD_GAME_TEST !== "1")
    return interaction.reply({ content: "Hatchem inventory is unavailable.", flags: MessageFlags.Ephemeral });

  if (action === "collection") {
    // The collection is also public, and its existing menus are bound to the opener.
    await interaction.deferReply();
    try {
      return await startCardCollection(interaction);
    } catch (error) {
      console.error("[Hatchem Inventory] Could not open collection:", error);
      return interaction.editReply("Could not open your collection.");
    }
  }

  // Keep the existing private purchase and achievement behavior. The public
  // inventory displays counts only; clicking must not reveal private screens.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (action === "shop") return await startCardShop(interaction);
    return interaction.editReply(await loadAchievementMessage(userId));
  } catch (error) {
    console.error("[Hatchem Inventory] Could not open linked screen:", error);
    return interaction.editReply("Could not open that Hatchem screen. Use its command to try again.");
  }
}
