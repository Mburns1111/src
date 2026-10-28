import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardDrop from "../models/CardDrop.js";
import { getCardCollectionSummary, formatCardCollectionSummary, updateOwnedCardTag } from "../services/card-collection-summary.js";
import PetCatalog from "../models/PetCatalog.js";
import { updateMultipleOwnedCardTags, prepareTagDeletion, confirmTagDeletion } from "../services/card-tag-management.js";
import { revealDrop, validateHatchOdds } from "../services/card-hatch-engine.js";
import { CardClaimError, reserveCardFromDrop, settleClosedCardDrop } from "../services/card-drop-claims.js";

export const data = new SlashCommandBuilder().setName("cards").setDescription("Collectible card game")
  .addSubcommand(c => c.setName("collection").setDescription("View your collectible cards"))
  .addSubcommand(c => c.setName("tag").setDescription("Give a card you own a personal tag")
    .addStringOption(o => o.setName("tag").setDescription("Tag, up to 32 characters").setMinLength(1).setMaxLength(32).setRequired(true))
    .addStringOption(o => o.setName("card_id").setDescription("Optional; defaults to last grabbed card").setRequired(false)))
  .addSubcommand(c => c.setName("untag").setDescription("Remove the tag from one of your cards")
    .addStringOption(o => o.setName("card_id").setDescription("Optional; defaults to last grabbed card").setRequired(false)))
  .addSubcommand(c => c.setName("tag-multiple").setDescription("Apply one tag to multiple cards you own")
    .addStringOption(o => o.setName("tag").setDescription("Tag to apply").setRequired(true).setMinLength(1).setMaxLength(32))
    .addStringOption(o => o.setName("card_ids").setDescription("1–20 five-character card IDs, comma-separated").setRequired(true)))
  .addSubcommand(c => c.setName("untag-multiple").setDescription("Remove tags from multiple cards you own")
    .addStringOption(o => o.setName("card_ids").setDescription("1–20 five-character card IDs, comma-separated").setRequired(true)))
  .addSubcommand(c => c.setName("delete-tag").setDescription("Remove a named tag from ALL your cards (confirmation required)")
    .addStringOption(o => o.setName("tag").setDescription("Exact tag to delete").setRequired(true)))
  .addSubcommand(c => c.setName("test-drop").setDescription("MANAGERS: reveal a test release egg with three cards")
    .addStringOption(o => o.setName("release").setDescription("Release ID (e.g. series1-release1)").setRequired(true))
);

const isEnabled = () => process.env.ENABLE_CARD_GAME_TEST === "1";
const escapeDiscord = text => String(text ?? "").replace(/[@`*_~|<>]/g, "");
const rowButtons = drop => new ActionRowBuilder().addComponents(drop.slots.map((slot, i) =>
  new ButtonBuilder().setCustomId(`cards:grab:${drop._id}:${i}`)
    .setLabel(slot.claimedBy ? `#${i + 1} Reserved` : `Grab #${i + 1}`)
    .setStyle(ButtonStyle.Primary).setDisabled(Boolean(slot.claimedBy) || drop.expiresAt <= new Date() || drop.status !== "open")));
export function dropText(drop, releaseName, petNames = {}) {
  const closed = drop.status === "closed" || new Date(drop.expiresAt) <= new Date();
  return [
    closed ? `🥚 **${escapeDiscord(releaseName)} Egg**` : `🥚 **${escapeDiscord(releaseName)} Egg — Hatched!**`,
    closed ? "**Drop Ended**" : "Pick one visible card to grab:",
    ...drop.slots.map((slot, i) => `**${i + 1}. ${escapeDiscord(petNames[slot.petId] || slot.petId)}** · ${slot.rarity}${slot.claimedBy ? closed ? " · Claimed" : " · Reserved" : closed ? " · Unclaimed" : ""}`),
    ...(closed ? [] : [`Drop closes <t:${Math.floor(new Date(drop.expiresAt).getTime() / 1000)}:R>.`]),
  ].join("\n");
}
export async function execute(interaction) {
  if (!interaction.guildId) return interaction.editReply("Use card commands inside a server.");
  const option = interaction.options.getSubcommand();
  if (option === "collection") {
    const summary = await getCardCollectionSummary(interaction.user.id);
    return interaction.editReply(formatCardCollectionSummary(summary));
  }
  if (option === "tag" || option === "untag") {
    if (!isEnabled()) return interaction.editReply("Card tagging is not enabled on this bot.");
    try {
      const cardId = interaction.options.getString("card_id")?.trim() || null;
      const tag = option === "tag" ? interaction.options.getString("tag", true) : null;
      const updated = await updateOwnedCardTag({ discordUserId: interaction.user.id, cardId, tag });
      const cardDescription = `**${escapeDiscord(updated.name)}** · ${escapeDiscord(updated.rarity)} · ${updated.upgradeLevel === "mega" ? "Mega Neon" : updated.upgradeLevel === "neon" ? "Neon" : "Normal"}\nCard ID: \`${updated.id}\``;
      return interaction.editReply({
        content: updated.tag
          ? `${cardDescription}\nTag: **${escapeDiscord(updated.tag)}** (saved)`
          : `${cardDescription}\nTag removed.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      return interaction.editReply(error.message);
    }
  }
  if (["tag-multiple", "untag-multiple", "delete-tag"].includes(option)) {
    if (!isEnabled()) return interaction.editReply("Card tagging is not enabled on this bot.");
    try {
      if (option === "delete-tag") {
        const pending = await prepareTagDeletion({
          discordUserId: interaction.user.id, tag: interaction.options.getString("tag", true),
        });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`cards:tagdelete:yes:${pending.id}`)
            .setLabel("Confirm — Remove Tag").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`cards:tagdelete:no:${pending.id}`)
            .setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        );
        return interaction.editReply({
          content: `**Delete Tag — Confirmation Required**\nTag: **${escapeDiscord(pending.tag)}**\nCards that will lose this tag: **${pending.count}**\n\nNo cards will be deleted, burned, traded or otherwise changed. Only their tag labels will be cleared. This confirmation expires in two minutes.`,
          components: [row], allowedMentions: { parse: [] },
        });
      }
      const ids = interaction.options.getString("card_ids", true);
      const tag = option === "tag-multiple" ? interaction.options.getString("tag", true) : null;
      const result = await updateMultipleOwnedCardTags({
        discordUserId: interaction.user.id, cardIds: ids, tag,
      });
      return interaction.editReply({
        content: result.tag
          ? `Tag **${escapeDiscord(result.tag)}** applied to ${result.selected} selected cards (${result.changed} changed).`
          : `Tags cleared from ${result.changed} of ${result.selected} selected cards.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      return interaction.editReply(error.message);
    }
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
    const reserved = await reserveCardFromDrop({ dropId, slot, guildId: interaction.guildId, discordUserId: interaction.user.id });
    await interaction.editReply(`You reserved **${escapeDiscord(reserved.petId)}** (${reserved.rarity}). It will be added to your collection when the drop ends.`);
    // Updating buttons is cosmetic; the MongoDB transaction is authoritative.
    try {
      const drop = await CardDrop.findById(dropId).lean();
      if (drop && String(drop.messageId) === interaction.message.id) {
        const pets = await PetCatalog.find({ petId: { $in: drop.slots.map(s => s.petId) } }).select("petId name").lean();
        const names = Object.fromEntries(pets.map(p => [p.petId, p.name]));
        // The expiry worker settles awards before publishing the final result.
        // Do not mark the closed message refreshed here; a click near the
        // deadline must not skip the worker's final display update.
        if (drop.status === "open" && new Date(drop.expiresAt) > new Date()) {
          const release = await CardRelease.findOne({ releaseId: drop.releaseId }).select("name").lean();
          await interaction.message.edit({ content: dropText(drop, release?.name || drop.releaseId, names), components: [rowButtons(drop)], allowedMentions: { parse: [] } });
        }
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
    status: "closed", expiresAt: { $lte: now },
    $or: [
      { displayClosedAt: null, messageId: { $ne: "" } },
      { slots: { $elemMatch: { claimedBy: { $ne: null }, settledAt: null } } },
    ],
  }).sort({ expiresAt: 1 }).limit(30).lean();
  for (const drop of pending) {
    try {
      await settleClosedCardDrop(drop);
    } catch (error) {
      console.error("[Cards] Could not settle reserved cards:", String(drop._id), error);
      continue;
    }
    if (drop.displayClosedAt || !drop.messageId) continue;
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

export async function handleCardTagDeletion(interaction) {
  if (!isEnabled()) return interaction.reply({ content: "Card tagging is disabled.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  if (parts.length !== 4 || !["yes", "no"].includes(parts[2])) {
    return interaction.followUp({ content: "Invalid confirmation.", flags: MessageFlags.Ephemeral });
  }
  try {
    const result = await confirmTagDeletion({
      discordUserId: interaction.user.id, requestId: parts[3], confirm: parts[2] === "yes",
    });
    await interaction.editReply({
      content: result.cancelled
        ? `Cancelled. Tag **${escapeDiscord(result.tag)}** was not changed on any cards.`
        : `Tag **${escapeDiscord(result.tag)}** removed from **${result.count} cards**. No cards were deleted or changed otherwise.`,
      components: [], allowedMentions: { parse: [] },
    });
  } catch (error) {
    await interaction.followUp({ content: error.message, flags: MessageFlags.Ephemeral });
  }
}
