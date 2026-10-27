import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardDrop from "../models/CardDrop.js";
import CardCopy from "../models/CardCopy.js";
import PetCatalog from "../models/PetCatalog.js";
import { revealDrop, validateHatchOdds } from "../services/card-hatch-engine.js";
import { CardClaimError, claimCardFromDrop } from "../services/card-drop-claims.js";

export const data = new SlashCommandBuilder().setName("cards").setDescription("Collectible card game")
  .addSubcommand(c => c.setName("collection").setDescription("View your collectible cards"))
  .addSubcommand(c => c.setName("test-drop").setDescription("MANAGERS: reveal a test release egg with three cards")
    .addStringOption(o => o.setName("release").setDescription("Release ID (e.g. series1-release1)").setRequired(true))
);

const isEnabled = () => process.env.ENABLE_CARD_GAME_TEST === "1";
const escapeDiscord = text => String(text ?? "").replace(/[@`*_~|<>]/g, "");
const rowButtons = drop => new ActionRowBuilder().addComponents(drop.slots.map((slot, i) =>
  new ButtonBuilder().setCustomId(`cards:grab:${drop._id}:${i}`)
    .setLabel(slot.claimedBy ? `#${i + 1} Claimed` : `Grab #${i + 1}`)
    .setStyle(ButtonStyle.Primary).setDisabled(Boolean(slot.claimedBy) || drop.expiresAt <= new Date() || drop.status !== "open")));
export function dropText(drop, releaseName, petNames = {}) {
  const closed = drop.status === "closed" || new Date(drop.expiresAt) <= new Date() || drop.slots.every(slot => Boolean(slot.claimedBy));
  return [
    `🥚 **${escapeDiscord(releaseName)} Egg — Hatched!**`,
    closed ? "**Drop Closed**" : "Pick one visible card to grab:",
    ...drop.slots.map((slot, i) => `**${i + 1}. ${escapeDiscord(petNames[slot.petId] || slot.petId)}** · ${slot.rarity}${slot.claimedBy ? " · Claimed" : ""}`),
    ...(closed ? [] : [`Drop closes <t:${Math.floor(new Date(drop.expiresAt).getTime() / 1000)}:R>.`]),
  ].join("\n");
}
export async function execute(interaction) {
  if (!interaction.guildId) return interaction.editReply("Use card commands inside a server.");
  const option = interaction.options.getSubcommand();
  if (option === "collection") {
    const copies = await CardCopy.find({ ownerDiscordUserId: interaction.user.id, state: "owned" }).limit(200).lean();
    const counts = {};
    for (const copy of copies) counts[copy.upgradeLevel] = (counts[copy.upgradeLevel] || 0) + 1;
    return interaction.editReply(`Your collection (first 200 cards): **${copies.length}** · Normal ${counts.normal || 0} · Neon ${counts.neon || 0} · Mega ${counts.mega || 0}.\nFull gallery and filtering are coming next.`);
  }
  if (!isEnabled()) return interaction.editReply("Card test drops are disabled on this bot.");
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply("Only server managers can start test drops.");
  const releaseId = interaction.options.getString("release", true);
  if (!releaseId.startsWith("test-")) return interaction.editReply("Test drops require a test-* release ID. Live releases cannot be triggered here.");
  const release = await CardRelease.findOne({ releaseId, status: "active" }).lean();
  if (!release) return interaction.editReply("No active release has that ID. Configure and approve a release first.");
  const odds = Object.fromEntries(["Common","Uncommon","Rare","Ultra-Rare","Legendary"].map(k => [k, release.hatchOdds[k]]));
  validateHatchOdds(odds);
  const definitions = await CardDefinition.find({ releaseId, seriesId: release.seriesId, enabled: true, artStatus: { $in: ["approved", "test-placeholder"] }, hatchWeight: { $gt: 0 } }).lean();
  if (!definitions.length) return interaction.editReply("This release has no approved, enabled card artwork.");
  const revealed = revealDrop({ cards: definitions, odds, allowTestPlaceholders: true });
  const ids = [...new Set(revealed.map(x => x.card.petId))];
  const pets = await PetCatalog.find({ petId: { $in: ids } }).select("petId name").lean();
  const petNames = Object.fromEntries(pets.map(p => [p.petId, p.name]));
  const drop = await CardDrop.create({
    guildId: interaction.guildId, channelId: interaction.channelId,
    releaseId, createdBy: interaction.user.id, expiresAt: new Date(Date.now() + 75_000),
    slots: revealed.map(x => ({ cardDefinitionId: x.card._id, petId: x.card.petId, rarity: x.rarity })),
  });
  try {
    const message = await interaction.channel.send({
      content: dropText(drop, release.name, petNames), components: [rowButtons(drop)],
      allowedMentions: { parse: [] },
    });
    await CardDrop.updateOne({ _id: drop._id }, { $set: { messageId: message.id } });
  } catch (error) {
    await CardDrop.updateOne({ _id: drop._id }, { $set: { status: "closed" } });
    throw error;
  }
  return interaction.editReply("Test release egg hatched in this channel. Cards are available to grab for 75 seconds.");
}
export async function handleCardGrab(interaction) {
  if (!isEnabled()) return interaction.reply({ content: "Card grabbing is disabled.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const parts = interaction.customId.split(":");
  const dropId = parts[2], slot = Number(parts[3]);
  if (!interaction.guildId || parts.length !== 4 || !["0", "1", "2"].includes(parts[3])) return interaction.editReply("Invalid card selection.");
  try {
    const awarded = await claimCardFromDrop({ dropId, slot, guildId: interaction.guildId, discordUserId: interaction.user.id });
    await interaction.editReply(`You grabbed **${escapeDiscord(awarded.petId)}** (${awarded.rarity})! Added to your card collection.`);
    // Updating buttons is cosmetic; the MongoDB transaction is authoritative.
    try {
      const drop = await CardDrop.findById(dropId).lean();
      if (drop && String(drop.messageId) === interaction.message.id) {
        const pets = await PetCatalog.find({ petId: { $in: drop.slots.map(s => s.petId) } }).select("petId name").lean();
        const names = Object.fromEntries(pets.map(p => [p.petId, p.name]));
        const allClaimed = drop.slots.every(slot => Boolean(slot.claimedBy));
        if (allClaimed) await CardDrop.updateOne({ _id: drop._id, status: "open" }, { $set: { status: "closed" } });
        const closed = allClaimed || drop.status === "closed" || new Date(drop.expiresAt) <= new Date();
        const release = await CardRelease.findOne({ releaseId: drop.releaseId }).select("name").lean();
        await interaction.message.edit({ content: dropText({ ...drop, status: closed ? "closed" : "open" }, release?.name || drop.releaseId, names), components: closed ? [] : [rowButtons(drop)], allowedMentions: { parse: [] } });
        if (closed) await CardDrop.updateOne({ _id: drop._id }, { $set: { displayClosedAt: new Date() } });
      }
    } catch (error) { console.warn("[Cards] Could not refresh drop display:", error.message); }
  } catch (error) {
    if (error instanceof CardClaimError) return interaction.editReply(error.message);
    throw error;
  }
}

/**
 * Periodically close expired drops and remove their Discord buttons.
 * Also revisits previously closed drops after a restart or transient API error.
 * Claim transactions check expiry in MongoDB, independent of message cleanup.
 */
export async function reconcileCardDropClosures(client) {
  if (!isEnabled()) return;
  const now = new Date();
  await CardDrop.updateMany(
    { status: "open", expiresAt: { $lte: now } },
    { $set: { status: "closed" } },
  );
  const pending = await CardDrop.find({
    status: "closed", displayClosedAt: null, messageId: { $ne: "" },
  }).sort({ expiresAt: 1 }).limit(30).lean();
  for (const drop of pending) {
    try {
      const channel = await client.channels.fetch(drop.channelId);
      if (!channel?.messages?.fetch) throw new Error("Channel unavailable");
      const message = await channel.messages.fetch(drop.messageId);
      const pets = await PetCatalog.find({ petId: { $in: drop.slots.map(s => s.petId) } })
        .select("petId name").lean();
      const names = Object.fromEntries(pets.map(p => [p.petId, p.name]));
      const release = await CardRelease.findOne({ releaseId: drop.releaseId }).select("name").lean();
      await message.edit({
        content: dropText(drop, release?.name || drop.releaseId, names),
        components: [], allowedMentions: { parse: [] },
      });
      await CardDrop.updateOne({ _id: drop._id }, { $set: { displayClosedAt: new Date() } });
    } catch (error) {
      // Deleted Discord messages do not need ongoing retries.
      if (Number(error?.code) === 10008 || Number(error?.code) === 10003) {
        await CardDrop.updateOne({ _id: drop._id }, { $set: { displayClosedAt: new Date() } });
      } else {
        console.warn("[Cards] Could not close drop message:", String(drop._id), error.message);
      }
    }
  }
}
