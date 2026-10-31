import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import CardCollector from "../models/CardCollector.js";
import PointsWallet from "../models/PointsWallet.js";
import { canPlayCardGame, cardRegistrationReminder } from "../services/card-collector-registration.js";
import { CARD_EXTRA_ITEMS, CARD_EXTRA_QUANTITIES, cardExtraPrice, purchaseCardExtras } from "../services/card-shop-purchases.js";

const enabled = () => process.env.ENABLE_CARD_GAME_TEST === "1";
const validId = value => /^\d{17,20}$/.test(String(value || ""));

export function cardShopButtons(guildId, userId, balance) {
  const row = new ActionRowBuilder();
  for (const kind of ["grab", "drop"]) {
    for (const quantity of CARD_EXTRA_QUANTITIES) {
      const price = cardExtraPrice(kind, quantity);
      row.addComponents(new ButtonBuilder()
        .setCustomId(`cards:shop:buy:${kind}:${quantity}:${guildId}:${userId}`)
        .setLabel(`Buy ${quantity} ${kind === "grab" ? "Grab" : "Drop"}${quantity > 1 ? "s" : ""} · ${price} Points`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(balance < price));
    }
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId(`cards:shop:refresh:${guildId}:${userId}`)
    .setLabel("Refresh").setStyle(ButtonStyle.Secondary));
  return [row];
}

export async function cardShopPayload(guildId, userId, notice = "") {
  const [wallet, collector] = await Promise.all([
    PointsWallet.findOne({ guildId, discordUserId: userId }).select("balance").lean(),
    CardCollector.findOne({ discordUserId: userId }).select("bonusGrabs bonusDrops").lean(),
  ]);
  const balance = wallet?.balance || 0;
  const grabs = collector?.bonusGrabs || 0, drops = collector?.bonusDrops || 0;
  return {
    content: [
      "**🥚 Hatchem — Extras Shop**",
      "Use your **server Points** to purchase permanent, single-use card actions.",
      `**Your Points:** ${balance}`,
      `**Extra Grabs:** ${grabs}  ·  **Extra Drops:** ${drops}`,
      "",
      `**Extra Grab — ${CARD_EXTRA_ITEMS.grab.price} Points each**`,
      "Use another grab during your 5-minute cooldown. An extra may also allow another card from the same drop.",
      `**Extra Drop — ${CARD_EXTRA_ITEMS.drop.price} Points each**`,
      "Hatch another egg during your 15-minute drop cooldown.",
      "",
      "Extras never expire. Normal free actions are used first; extras are automatically used only when needed.",
      "Buying immediately spends Points; there is no additional purchase confirmation.",
      ...(notice ? ["", notice] : []),
    ].join("\n"),
    components: cardShopButtons(guildId, userId, balance),
    allowedMentions: { parse: [] },
  };
}

export async function startCardShop(interaction) {
  if (!enabled()) return interaction.editReply("Hatchem extras are available on the development bot only.");
  if (!validId(interaction.guildId) || !await canPlayCardGame(interaction.user.id, interaction.guild))
    return interaction.editReply(await cardRegistrationReminder(interaction.guildId));
  try {
    return interaction.editReply(await cardShopPayload(interaction.guildId, interaction.user.id));
  } catch (error) {
    console.error("[Hatchem Shop] Could not load shop:", error);
    return interaction.editReply("Could not open the Hatchem shop. Your Points have not been changed.");
  }
}

export async function handleCardShopInteraction(interaction) {
  if (!interaction.isButton() || !enabled())
    return interaction.reply({ content: "The Hatchem shop is currently unavailable.", flags: MessageFlags.Ephemeral });
  const parts = interaction.customId.split(":");
  const purchase = parts[2] === "buy";
  const kind = purchase ? parts[3] : null;
  const quantity = purchase ? Number(parts[4]) : null;
  const guildId = purchase ? parts[5] : parts[3];
  const userId = purchase ? parts[6] : parts[4];
  if ((purchase ? parts.length !== 7 : parts.length !== 5 || parts[2] !== "refresh") ||
      !validId(guildId) || !validId(userId) ||
      (interaction.guildId && interaction.guildId !== guildId) ||
      (purchase && (!Object.hasOwn(CARD_EXTRA_ITEMS, kind) || !CARD_EXTRA_QUANTITIES.includes(quantity)))) {
    return interaction.reply({ content: "Invalid Hatchem shop selection.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== userId)
    return interaction.reply({ content: "Open your own shop with `.shop` or `/cards shop`.", flags: MessageFlags.Ephemeral });

  // DMs use the originating guild ID, so purchases are always charged to the
  // correct per-server Points wallet. Never accept the guild ID from a user input.
  const guild = interaction.guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (!guild || !await canPlayCardGame(userId, guild))
    return interaction.reply({ content: await cardRegistrationReminder(guildId), flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();
  let notice = "";
  if (purchase) {
    try {
      const result = await purchaseCardExtras({ guildId, userId, kind, quantity, interactionId: interaction.id });
      notice = result.alreadyProcessed
        ? "That purchase was already processed. No additional Points were charged."
        : `✅ Purchased **${quantity} ${CARD_EXTRA_ITEMS[kind].label}${quantity > 1 ? "s" : ""}** for **${result.amount} Points**.`;
    } catch (error) {
      notice = error.code === "insufficient"
        ? "You don't have enough Points for this purchase."
        : error.code === "unregistered"
          ? "You must register in this server before buying extras."
          : "Purchase could not be completed. No extras were awarded for this attempt.";
      if (!["insufficient", "unregistered"].includes(error.code))
        console.error("[Hatchem Shop] Purchase failed:", error);
    }
  }
  try {
    return await interaction.editReply(await cardShopPayload(guildId, userId, notice));
  } catch (error) {
    console.error("[Hatchem Shop] Shop refresh failed:", error);
    return interaction.editReply({
      content: "Could not refresh the shop display. Reopen `.shop` or `/cards shop` to see your current balances. Do not assume a purchase failed.",
      components: [],
      allowedMentions: { parse: [] },
    });
  }
}
