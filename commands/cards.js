import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder } from "discord.js";
import { isCardGameOwner } from "../services/card-owner-access.js";
import CardRelease from "../models/CardRelease.js";
import { loadStoredReleaseEggImage } from "../services/card-egg-artwork.js";
import { storeTestEggArtwork } from "../services/card-egg-artwork-upload.js";
import { uploadCardArtwork, loadCardArtwork, browseCardArtwork, getCardArtworkDetails, reviewCardArtwork } from "../services/card-artwork-assets.js";
import CardDefinition from "../models/CardDefinition.js";
import CardDrop from "../models/CardDrop.js";
import CardCopy from "../models/CardCopy.js";
import { countOtherCardCollectors } from "../services/card-ownership-stats.js";
import { getCardLifecycleStats } from "../services/card-lifecycle-stats.js";
import CardClaim from "../models/CardClaim.js";
import CardSeries from "../models/CardSeries.js";
import { resolveCardId } from "../services/card-identifiers.js";
import { renderCollectibleCardPreview } from "../services/card-preview-renderer.js";
import { renderThreeCardDropImage } from "../services/card-drop-renderer.js";
import { getCardCollectionSummary, formatCardCollectionSummary, updateOwnedCardTag } from "../services/card-collection-summary.js";
import { findOwnedCardForCommand, suggestOwnedCardReferences } from "../services/card-owned-selection.js";
import { createCollectorTag, listCollectorTags } from "../services/card-tag-catalog.js";
import { selectOwnedTagTargets } from "../services/card-tag-targets.js";
import { prepareCardTagConfirmation, getCardTagConfirmation, cancelCardTagConfirmation, confirmCardTagChange } from "../services/card-tag-confirmations.js";
import { startCardCollection } from "./card-collection-ui.js";
import { prepareCardUpgrade, confirmCardUpgrade, cancelCardUpgrade, suggestOwnedCardUpgrades } from "../services/card-upgrades.js";
import PetCatalog from "../models/PetCatalog.js";
import { updateMultipleOwnedCardTags, prepareTagDeletion, confirmTagDeletion } from "../services/card-tag-management.js";
import { revealDrop, validateHatchOdds } from "../services/card-hatch-engine.js";
import { CardClaimError, reserveCardFromDrop, settleClosedCardDrop } from "../services/card-drop-claims.js";

export const data = new SlashCommandBuilder().setName("cards").setDescription("Hatchem collectible card game")
  .addSubcommand(c => c.setName("collection").setDescription("Show your collection or another member’s cards")
    .addUserOption(o => o.setName("member").setDescription("Whose collection to view (defaults to yours)").setRequired(false))
    .addStringOption(o => o.setName("tag").setDescription("Optional saved tag filter, e.g. cute").setRequired(false)))
  .addSubcommand(c => c.setName("upgrade").setDescription("Combine 4 matching cards into Neon or Mega Neon")
    .addStringOption(o => o.setName("card").setDescription("One card ID or pet name; bot finds four matching copies").setRequired(true).setAutocomplete(true)))
  .addSubcommand(c => c.setName("stats").setDescription("See collector, burn and upgrade statistics for a card")
    .addStringOption(o => o.setName("card_id").setDescription("Optional card ID or pet-name prefix; defaults to newest").setRequired(false).setAutocomplete(true)))
  .addSubcommand(c => c.setName("view").setDescription("View a card you own")
    .addStringOption(o => o.setName("card_id").setDescription("Optional card ID or pet-name prefix; defaults to newest").setRequired(false).setAutocomplete(true)))
  .addSubcommand(c => c.setName("tag").setDescription("Tag newest, all matching pet copies, or one card ID")
    .addStringOption(o => o.setName("tag").setDescription("Tag, up to 32 characters").setMinLength(1).setMaxLength(32).setRequired(true))
    .addStringOption(o => o.setName("card_id").setDescription("Optional ID or pet-name prefix; defaults to newest owned card").setRequired(false).setAutocomplete(true)))
  .addSubcommand(c => c.setName("untag").setDescription("Confirm removing tags from one or all matching cards")
    .addStringOption(o => o.setName("card_id").setDescription("Optional ID or pet-name prefix; defaults to newest owned").setRequired(false).setAutocomplete(true)))
  .addSubcommand(c => c.setName("tag-multiple").setDescription("Apply one tag to multiple cards you own")
    .addStringOption(o => o.setName("tag").setDescription("Tag to apply").setRequired(true).setMinLength(1).setMaxLength(32))
    .addStringOption(o => o.setName("card_ids").setDescription("1–20 five-character card IDs, comma-separated").setRequired(true)))
  .addSubcommand(c => c.setName("untag-multiple").setDescription("Remove tags from multiple cards you own")
    .addStringOption(o => o.setName("card_ids").setDescription("1–20 five-character card IDs, comma-separated").setRequired(true)))
  .addSubcommand(c => c.setName("create-tag").setDescription("Save a reusable collection tag, even with no assigned cards")
    .addStringOption(o => o.setName("tag").setDescription("Your tag name").setRequired(true).setMinLength(1).setMaxLength(32)))
  .addSubcommand(c => c.setName("tags").setDescription("List your saved collection tags"))
  .addSubcommand(c => c.setName("delete-tag").setDescription("Remove a named tag from ALL your cards (confirmation required)")
    .addStringOption(o => o.setName("tag").setDescription("Exact tag to delete").setRequired(true)))
  .addSubcommand(c => c.setName("egg-art-upload").setDescription("OWNER: save the Release 1 egg artwork to MongoDB")
    .addAttachmentOption(o => o.setName("image").setDescription("Release 1 egg image (PNG/JPG/WebP)").setRequired(true)))
  .addSubcommand(c => c.setName("art-upload").setDescription("OWNER: upload a test card art asset to MongoDB")
    .addStringOption(o => o.setName("key").setDescription("Unique artwork ID, e.g. cat-art-01").setRequired(true))
    .addStringOption(o => o.setName("kind").setDescription("Layer type").setRequired(true)
      .addChoices({ name: "Pet illustration", value: "pet" }, { name: "Card background", value: "background" }, { name: "Transparent frame", value: "frame" }))
    .addAttachmentOption(o => o.setName("image").setDescription("PNG, JPG or WebP image").setRequired(true))
    .addStringOption(o => o.setName("artist").setDescription("Artist to credit (required for pet art)").setRequired(false))
    .addStringOption(o => o.setName("replaces").setDescription("Older artwork key for a new revision").setRequired(false))
    .addStringOption(o => o.setName("revision_note").setDescription("What changed? Required for revisions").setRequired(false)))
  .addSubcommand(c => c.setName("art-assign").setDescription("OWNER: assign uploaded artwork to TEST cards or release")
    .addStringOption(o => o.setName("kind").setDescription("Which layer to assign").setRequired(true)
      .addChoices({ name: "Pet illustration", value: "pet" }, { name: "Card background", value: "background" }, { name: "Transparent frame", value: "frame" }))
    .addStringOption(o => o.setName("key").setDescription("Uploaded artwork ID").setRequired(true))
    .addStringOption(o => o.setName("pet_id").setDescription("Required only for pet illustration, from test release").setRequired(false)))
  .addSubcommand(c => c.setName("art-list").setDescription("OWNER: browse uploaded card artwork")
    .addStringOption(o => o.setName("kind").setDescription("Optional layer category")
      .addChoices({ name: "Pet art", value: "pet" }, { name: "Background", value: "background" }, { name: "Frame", value: "frame" }).setRequired(false))
    .addStringOption(o => o.setName("status").setDescription("Optional review status")
      .addChoices({ name: "Needs review", value: "needs-review" }, { name: "Approved", value: "approved" }, { name: "Rejected", value: "rejected" }).setRequired(false))
    .addIntegerOption(o => o.setName("page").setDescription("Page number, 8 items each").setMinValue(1).setMaxValue(1000).setRequired(false)))
  .addSubcommand(c => c.setName("art-info").setDescription("OWNER: inspect artwork, credits and revision history")
    .addStringOption(o => o.setName("key").setDescription("Artwork key to inspect").setRequired(true)))
  .addSubcommand(c => c.setName("art-review").setDescription("OWNER: record an artwork review decision")
    .addStringOption(o => o.setName("key").setDescription("Artwork key").setRequired(true))
    .addStringOption(o => o.setName("decision").setDescription("Review decision").setRequired(true)
      .addChoices({ name: "Approve", value: "approved" }, { name: "Reject", value: "rejected" }, { name: "Return to review", value: "needs-review" }))
    .addStringOption(o => o.setName("note").setDescription("Review reason and permission evidence").setRequired(true).setMinLength(5).setMaxLength(1000)))
  .addSubcommand(c => c.setName("test-drop").setDescription("OWNER: reveal a test release egg with three cards")
    .addStringOption(o => o.setName("release").setDescription("Release ID (e.g. series1-release1)").setRequired(true))
);

const isEnabled = () => process.env.ENABLE_CARD_GAME_TEST === "1";
const escapeDiscord = text => String(text ?? "").replace(/[@`*_~|<>]/g, "");
const rowButtons = drop => new ActionRowBuilder().addComponents(drop.slots.map((slot, i) =>
  new ButtonBuilder().setCustomId(`cards:grab:${drop._id}:${i}`)
    .setLabel((slot.claimedBy || slot.winnerId) ? `#${i + 1} Chosen` : `Grab #${i + 1}`)
    .setStyle(ButtonStyle.Primary).setDisabled(Boolean(slot.claimedBy || slot.winnerId) || drop.expiresAt <= new Date() || drop.status !== "open")));
export function dropText(drop, releaseName) {
  const closed = drop.status === "closed" || new Date(drop.expiresAt) <= new Date();
  return closed
    ? `🥚 **${escapeDiscord(releaseName)} Egg — Drop Ended**`
    : `🥚 **${escapeDiscord(releaseName)} Egg — Hatched!**`;
}
export async function execute(interaction) {
  if (!interaction.guildId) return interaction.editReply("Use card commands inside a server.");
  const option = interaction.options.getSubcommand();
  if (option === "collection") {
    if (isEnabled()) return startCardCollection(interaction);
    const summary = await getCardCollectionSummary(interaction.user.id);
    return interaction.editReply(formatCardCollectionSummary(summary));
  }
  if (option === "upgrade") {
    if (!isEnabled()) return interaction.editReply("Card upgrades are enabled only on the development bot.");
    try {
      const request = await prepareCardUpgrade({
        ownerId: interaction.user.id, guildId: interaction.guildId,
        cardReference: interaction.options.getString("card", true),
      });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cards:upgrade:yes:${request.token}`)
          .setStyle(ButtonStyle.Danger).setLabel("Confirm Upgrade"),
        new ButtonBuilder().setCustomId(`cards:upgrade:no:${request.token}`)
          .setStyle(ButtonStyle.Secondary).setLabel("Cancel"),
      );
      return interaction.editReply({
        content: [
          `**Upgrade ${escapeDiscord(request.petName)} → ${request.target === "neon" ? "Neon" : "Mega Neon"}?**`,
          `Release: ${escapeDiscord(request.releaseId)}`,
          `Consume exactly four cards: ${request.ids.join(", ")}`,
          "**These four original card IDs will be permanently consumed**, and one NEW unique five-character card ID will be created.",
          "**All decorative frames will be removed from the consumed cards if any are applied. Frames and decorations do not transfer to the upgraded card.**",
          "Tagged cards are eligible; check the four listed IDs before confirming. You have 90 seconds.",
        ].join("\n"),
        components: [row], allowedMentions: { parse: [] },
      });
    } catch (error) {
      return interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    }
  }
  if (option === "stats") {
    if (!isEnabled()) return interaction.editReply("Card statistics are disabled on this bot.");
    const reference = interaction.options.getString("card_id")?.trim();
    try {
      const copy = await findOwnedCardForCommand(interaction.user.id, reference);
      if (!copy) return interaction.editReply("That card is not in your collection.");
      const definition = await CardDefinition.findById(copy.cardDefinitionId).select("petId rarity").lean();
      if (!definition) return interaction.editReply("Card definition not found.");
      const [pet, others, lifecycle] = await Promise.all([
        PetCatalog.findOne({ petId: definition.petId }).select("name").lean(),
        countOtherCardCollectors({ cardDefinitionId: copy.cardDefinitionId, ownerDiscordUserId: interaction.user.id }),
        getCardLifecycleStats(copy.cardDefinitionId),
      ]);
      return interaction.editReply({
        content: [
          `**${escapeDiscord(pet?.name || definition.petId)}** · ${definition.rarity} · \`${copy.publicId || "PENDING"}\``,
          `**Other collectors currently owning this release card:** ${others}`,
          `**Recorded cards burned:** ${lifecycle.burned}`,
          `**Recorded Neon upgrades:** ${lifecycle.upgradedToNeon}`,
          `**Recorded Mega Neon upgrades:** ${lifecycle.upgradedToMega}`,
          "*Burn/upgrade tracking is prepared for future actions; none are implemented yet.*",
        ].join("\n"), allowedMentions: { parse: [] },
      });
    } catch (error) {
      return interaction.editReply(error.message);
    }
  }
  if (option === "view") {
    if (!isEnabled()) return interaction.editReply("Card previews are disabled on this bot.");
    try {
      const reference = interaction.options.getString("card_id")?.trim();
      const copy = await findOwnedCardForCommand(interaction.user.id, reference);
      if (!copy) return interaction.editReply("That card is not in your current collection.");
      if (!copy.publicId) return interaction.editReply("This card needs its five-character ID assigned. Run the development backfill first.");
      const definition = await CardDefinition.findById(copy.cardDefinitionId).lean();
      if (!definition) return interaction.editReply("That card's artwork definition is missing.");
      const [pet, release, series, otherCollectorCount] = await Promise.all([
        PetCatalog.findOne({ petId: definition.petId }).select("name").lean(),
        CardRelease.findOne({ releaseId: definition.releaseId }).select("name cardBackgroundKey cardFrameKey").lean(),
        CardSeries.findOne({ seriesId: definition.seriesId }).select("name").lean(),
        countOtherCardCollectors({ cardDefinitionId: copy.cardDefinitionId, ownerDiscordUserId: interaction.user.id }),
      ]);
      const [petImage, backgroundImage, frameImage] = await Promise.all([
        loadCardArtwork(definition.petArtworkKey, "pet"),
        loadCardArtwork(release?.cardBackgroundKey, "background"),
        loadCardArtwork(release?.cardFrameKey, "frame"),
      ]);
      const png = await renderCollectibleCardPreview({
        petImageSource: petImage?.bytes,
        backgroundImageSource: backgroundImage?.bytes,
        frameImageSource: frameImage?.bytes,
        petName: pet?.name || definition.petId,
        rarity: definition.rarity, upgradeLevel: copy.upgradeLevel,
        releaseName: release?.name || definition.releaseId,
        seriesName: series?.name || definition.seriesId,
        publicId: copy.publicId, artistCredit: definition.artistCredit,
        otherCollectorCount,
        artStatus: definition.artStatus, artUrl: definition.artUrl,
      });
      return interaction.editReply({
        content: `**${escapeDiscord(pet?.name || definition.petId)}** · ${definition.rarity} · Card \`${copy.publicId}\`\n*First layout preview — placeholder pet artwork until approved art is available.*`,
        files: [new AttachmentBuilder(png, { name: "collectible-card-preview.png" })],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("[Cards] Preview failed:", error);
      return interaction.editReply("Unable to render this card preview. Check the development bot logs.");
    }
  }
  if (option === "create-tag" || option === "tags") {
    if (!isEnabled()) return interaction.editReply("Card tags are disabled on this bot.");
    try {
      if (option === "create-tag") {
        const name = await createCollectorTag(interaction.user.id, interaction.options.getString("tag", true));
        return interaction.editReply({
          content: `Saved tag **${escapeDiscord(name)}**. Use \`.tag ${name}\` for your newest card, or \`.tag abys ${name}\` to target a pet.`,
          allowedMentions: { parse: [] },
        });
      }
      const tags = await listCollectorTags(interaction.user.id);
      return interaction.editReply({
        content: tags.length ? `**Your collection tags:** ${tags.map(escapeDiscord).join(", ")}` :
          "No tags yet. Use \`.create-tag cute\` to save one.",
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      return interaction.editReply(error.message);
    }
  }
  if (option === "tag" || option === "untag") {
    if (!isEnabled()) return interaction.editReply("Card tagging is not enabled on this bot.");
    try {
      const cardId = interaction.options.getString("card_id")?.trim() || null;
      const tag = option === "tag" ? interaction.options.getString("tag", true) : null;
      const targets = await selectOwnedTagTargets(interaction.user.id, cardId, { includeRelatedForId: true });
      // All untagging, and tagging a pet with multiple owned copies, require confirmation.
      if (option === "untag" || targets.cards.length > 1) {
        const request = await prepareCardTagConfirmation({
          discordUserId: interaction.user.id, cardId, tag,
        });
        return interaction.editReply(cardTagConfirmationPayload(request));
      }
      const updated = await updateOwnedCardTag({ discordUserId: interaction.user.id, cardId, tag });
      return interaction.editReply({
        content: "**" + escapeDiscord(updated.name) + "** · Card ID: " +
          String.fromCharCode(96) + updated.id + String.fromCharCode(96) +
          "\nTag: **" + escapeDiscord(updated.tag) + "** (" +
          updated.changed + " changed).",
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      return interaction.editReply({ content: escapeDiscord(error.message), allowedMentions: { parse: [] } });
    }
  }
  if (["tag-multiple", "untag-multiple", "delete-tag"].includes(option)) {
    if (!isEnabled()) return interaction.editReply("Card tagging is not enabled on this bot.");
    try {
      if (option === "untag-multiple") {
        const request = await prepareCardTagConfirmation({
          discordUserId: interaction.user.id,
          cardIds: interaction.options.getString("card_ids", true),
          tag: null,
        });
        return interaction.editReply(cardTagConfirmationPayload(request));
      }
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
  if (option === "egg-art-upload") {
    if (!isEnabled()) return interaction.editReply("Egg artwork upload is only available on the development bot.");
    if (!isCardGameOwner(interaction.user.id)) {
      return interaction.editReply("Only the card-game owner can upload egg artwork. Add CARD_GAME_OWNER_DISCORD_ID to Replit Secrets.");
    }
    try {
      const result = await storeTestEggArtwork({
        releaseId: "test-s1-r1",
        attachment: interaction.options.getAttachment("image", true),
        uploadedBy: interaction.user.id,
      });
      return interaction.editReply({
        content: [
          "**Egg artwork saved in MongoDB.**",
          `Release: ${result.releaseId} · Artwork: ${result.artworkId}`,
          `Credit: ${result.creditText}`,
          "Source/license review remains pending. This upload is for development testing only.",
          "Run /cards test-drop release:test-s1-r1 to preview it.",
        ].join("\n"),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("[Cards] Egg artwork upload failed:", error);
      return interaction.editReply("Egg artwork was not saved: " + error.message);
    }
  }
  if (option === "art-upload" || option === "art-assign") {
    if (!isEnabled()) return interaction.editReply("Card artwork tools are enabled only on the development bot.");
    if (!isCardGameOwner(interaction.user.id)) return interaction.editReply("Only the card-game owner can manage card artwork. Add CARD_GAME_OWNER_DISCORD_ID to Replit Secrets.");
    try {
      const kind = interaction.options.getString("kind", true);
      const key = interaction.options.getString("key", true);
      if (option === "art-upload") {
        const result = await uploadCardArtwork({
          kind, key, attachment: interaction.options.getAttachment("image", true),
          artistCredit: interaction.options.getString("artist") || "", uploadedBy: interaction.user.id,
          replacesKey: interaction.options.getString("replaces") || "",
          revisionNote: interaction.options.getString("revision_note") || "",
        });
        return interaction.editReply({
          content: `Saved **${escapeDiscord(result.key)}** (${result.kind}) to MongoDB. Artwork remains under review. ${interaction.options.getString("replaces") ? "The original version was preserved. " : ""}Use /cards art-info to inspect it and /cards art-assign to display it in TEST cards.`,
          allowedMentions: { parse: [] },
        });
      }
      const release = await CardRelease.findOne({ releaseId: "test-s1-r1" });
      if (!release) return interaction.editReply("TEST Release 1 was not found.");
      const asset = await loadCardArtwork(key.trim().toLowerCase(), kind);
      if (!asset) return interaction.editReply("Artwork was not found.");
      if (kind === "pet") {
        const petId = interaction.options.getString("pet_id")?.trim();
        if (!petId) return interaction.editReply("Specify pet_id when assigning pet artwork.");
        const definition = await CardDefinition.findOne({ releaseId: release.releaseId, petId });
        if (!definition) return interaction.editReply("That pet ID does not have a TEST card definition.");
        if (!asset.artwork.artistCredit) return interaction.editReply("Pet artwork must have an artist credit.");
        definition.petArtworkKey = asset.artwork.key;
        definition.artistCredit = asset.artwork.artistCredit;
        // Never silently approve an uploaded artist image; TEST-only preview
        // can still use the test-placeholder status pending permission review.
        await definition.save();
      } else {
        if (interaction.options.getString("pet_id")) return interaction.editReply("Backgrounds and frames are release-wide; omit pet_id.");
        if (kind === "background") release.cardBackgroundKey = asset.artwork.key;
        else release.cardFrameKey = asset.artwork.key;
        await release.save();
      }
      return interaction.editReply({
        content: `Assigned **${escapeDiscord(asset.artwork.key)}** as ${kind} artwork to TEST Release 1${kind === "pet" ? " pet " + escapeDiscord(interaction.options.getString("pet_id")) : ""}. No production cards were modified.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("[Cards] Artwork management failed:", error);
      return interaction.editReply("Card artwork operation failed: " + error.message);
    }
  }
  if (["art-list", "art-info", "art-review"].includes(option)) {
    if (!isEnabled()) return interaction.editReply("Card artwork tools are enabled only on the development bot.");
    if (!isCardGameOwner(interaction.user.id)) return interaction.editReply("Only the card-game owner can manage card artwork. Add CARD_GAME_OWNER_DISCORD_ID to Replit Secrets.");
    try {
      if (option === "art-list") {
        const result = await browseCardArtwork({
          kind: interaction.options.getString("kind"),
          status: interaction.options.getString("status"),
          page: interaction.options.getInteger("page") || 1,
        });
        const rows = result.items.map(a =>
          `• \`${escapeDiscord(a.key)}\` · ${a.kind} · **${a.licenseReviewStatus}** · ${escapeDiscord(a.artistCredit || "credit pending")}${a.replacesKey ? " · revision" : ""}`
        );
        return interaction.editReply({
          content: [`**Card Artwork Library** — ${result.total} assets · page ${result.page}/${result.pages}`,
            ...rows, rows.length ? "Use /cards art-info key:... for details and image." : "No artwork matches these filters."].join("\n"),
          allowedMentions: { parse: [] },
        });
      }
      const key = interaction.options.getString("key", true);
      if (option === "art-review") {
        const result = await reviewCardArtwork({
          key, decision: interaction.options.getString("decision", true),
          note: interaction.options.getString("note", true), reviewerId: interaction.user.id,
        });
        return interaction.editReply({
          content: `Artwork \`${escapeDiscord(result.key)}\`: **${result.previousStatus} → ${result.status}**. Review decision recorded with your note. This does not publish a release or change existing card assignments.`,
          allowedMentions: { parse: [] },
        });
      }
      const { artwork, history, revisions } = await getCardArtworkDetails(key);
      const asset = await loadCardArtwork(artwork.key, artwork.kind);
      const ext = artwork.mime === "image/png" ? "png" : artwork.mime === "image/webp" ? "webp" : "jpg";
      const historyLines = history.map(h => `• ${h.action}: ${escapeDiscord(h.note)} (by <@${h.reviewerId}>)`);
      return interaction.editReply({
        content: [
          `**Artwork \`${escapeDiscord(artwork.key)}\`** · ${artwork.kind} · **${artwork.licenseReviewStatus}**`,
          `Artist: **${escapeDiscord(artwork.artistCredit || "not provided")}**`,
          `File: ${artwork.mime} · ${artwork.byteLength} bytes`,
          `Uploaded by: <@${artwork.uploadedBy}>`,
          `Replaces: ${escapeDiscord(artwork.replacesKey || "none")}`,
          `Revision note: ${escapeDiscord(artwork.revisionNote || "none")}`,
          `Newer versions: ${revisions.map(r => escapeDiscord(r.key)).join(", ") || "none"}`,
          "**Recent reviews**", ...(historyLines.length ? historyLines : ["None"]),
        ].join("\n").slice(0, 1900),
        files: [new AttachmentBuilder(asset.bytes, { name: `card-artwork.${ext}` })],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("[Cards] Artwork library operation failed:", error);
      return interaction.editReply("Artwork management failed: " + error.message);
    }
  }
  if (!isEnabled()) return interaction.editReply("Card test drops are disabled on this bot.");
  if (!isCardGameOwner(interaction.user.id)) return interaction.editReply("Only the card-game owner can start test drops. Add CARD_GAME_OWNER_DISCORD_ID to Replit Secrets.");
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
  // Render before creating the drop: a renderer failure never leaves a
  // claimable drop record without an image in Discord.
  const series = await CardSeries.findOne({ seriesId: release.seriesId }).select("name").lean();
  // Existing art is read directly from MongoDB; no local PNGs or ZIP files.
  const eggImageSource = release.eggImageUrl || await loadStoredReleaseEggImage(release);
  if (!eggImageSource && release.releaseId === "test-s1-r1") {
    return interaction.editReply(
      "Release 1 egg artwork was not found in the configured MongoDB image collections. " +
      "Run `node scripts/find-release-egg-artwork.js test-s1-r1` in Replit to identify its stored filename/bucket. No drop was created."
    );
  }
  const [backgroundImage, frameImage] = await Promise.all([
    loadCardArtwork(release.cardBackgroundKey, "background"),
    loadCardArtwork(release.cardFrameKey, "frame"),
  ]);
  const petImages = await Promise.all(revealed.map(({ card }) => loadCardArtwork(card.petArtworkKey, "pet")));
  const dropPng = await renderThreeCardDropImage({
    releaseName: release.name,
    seriesName: series?.name || release.seriesId,
    eggImageSource,
    cards: revealed.map(({ card, rarity }, i) => ({
      petImageSource: petImages[i]?.bytes,
      backgroundImageSource: backgroundImage?.bytes,
      frameImageSource: frameImage?.bytes,
      petName: petNames[card.petId] || card.petId,
      rarity,
      artStatus: card.artStatus,
      artUrl: card.artUrl,
      artistCredit: card.artistCredit,
    })),
  });
  const drop = await CardDrop.create({
    guildId: interaction.guildId, channelId: interaction.channelId,
    releaseId, createdBy: interaction.user.id, expiresAt: new Date(Date.now() + 75_000),
    slots: revealed.map(x => ({ cardDefinitionId: x.card._id, petId: x.card.petId, rarity: x.rarity })),
  });
  try {
    const message = await interaction.channel.send({
      content: dropText(drop, release.name, petNames),
      files: [new AttachmentBuilder(dropPng, { name: "card-drop.png" })],
      components: [rowButtons(drop)],
      allowedMentions: { parse: [] },
    });
    await CardDrop.updateOne({ _id: drop._id }, { $set: { messageId: message.id } });
  } catch (error) {
    await CardDrop.updateOne({ _id: drop._id }, { $set: { status: "closed" } });
    throw error;
  }
  return interaction.editReply("Test release egg hatched in this channel. Cards are open for entries for 75 seconds; winners are drawn at expiry.");
}
export async function handleCardUpgrade(interaction) {
  const [, , action, token] = interaction.customId.split(":");
  if (!["yes", "no"].includes(action) || !/^[0-9a-f]{24}$/.test(token || "")) {
    return interaction.reply({ content: "Invalid upgrade confirmation.", flags: MessageFlags.Ephemeral });
  }
  // This message is private and bound to the requesting member.
  try {
    if (action === "no") {
      cancelCardUpgrade(token, interaction.user.id);
      return interaction.update({ content: "Card upgrade cancelled. Your cards are unchanged.", components: [] });
    }
    await interaction.deferUpdate();
    const result = await confirmCardUpgrade(token, interaction.user.id, interaction.guildId);
    // The upgrade is committed before publishing. Never tell the member it
    // failed (or consume their cards again) if Discord or rendering fails.
    let publicPost;
    try {
      const upgraded = await CardCopy.findOne({
        publicId: result.publicId, ownerDiscordUserId: interaction.user.id,
        state: "owned", source: "upgrade",
      }).lean();
      if (!upgraded) throw new Error("Upgraded card not found after settlement");
      const definition = await CardDefinition.findById(upgraded.cardDefinitionId).lean();
      if (!definition) throw new Error("Upgraded card definition missing");
      const [pet, release, series, otherCollectorCount] = await Promise.all([
        PetCatalog.findOne({ petId: definition.petId }).select("name").lean(),
        CardRelease.findOne({ releaseId: definition.releaseId })
          .select("name cardBackgroundKey cardFrameKey").lean(),
        CardSeries.findOne({ seriesId: definition.seriesId }).select("name").lean(),
        countOtherCardCollectors({
          cardDefinitionId: upgraded.cardDefinitionId,
          ownerDiscordUserId: interaction.user.id,
        }),
      ]);
      const [petImage, backgroundImage, frameImage] = await Promise.all([
        loadCardArtwork(definition.petArtworkKey, "pet"),
        loadCardArtwork(release?.cardBackgroundKey, "background"),
        loadCardArtwork(release?.cardFrameKey, "frame"),
      ]);
      const image = await renderCollectibleCardPreview({
        petImageSource: petImage?.bytes,
        backgroundImageSource: backgroundImage?.bytes,
        frameImageSource: frameImage?.bytes,
        petName: pet?.name || definition.petId,
        rarity: definition.rarity,
        upgradeLevel: upgraded.upgradeLevel,
        publicId: upgraded.publicId,
        releaseName: release?.name || definition.releaseId,
        seriesName: series?.name || definition.seriesId,
        artistCredit: definition.artistCredit,
        artUrl: definition.artUrl,
        artStatus: definition.artStatus,
        otherCollectorCount,
      });
      publicPost = await interaction.channel.send({
        content: `✨ <@${interaction.user.id}> upgraded **${escapeDiscord(pet?.name || definition.petId)}** into a **${result.target === "neon" ? "Neon" : "Mega Neon"}**! · Card ID: ${result.publicId}`,
        files: [new AttachmentBuilder(image, { name: "upgraded-card.png" })],
        allowedMentions: { users: [interaction.user.id], parse: [] },
      });
    } catch (postError) {
      console.error("[Cards] Upgrade completed but public image failed:", postError);
      // Preserve the public announcement even if an image asset is corrupt.
      try {
        publicPost = await interaction.channel.send({
          content: `✨ <@${interaction.user.id}> upgraded **${escapeDiscord(result.petName)}** into a **${result.target === "neon" ? "Neon" : "Mega Neon"}**! · Card ID: ${result.publicId} (card image unavailable)`,
          allowedMentions: { users: [interaction.user.id], parse: [] },
        });
      } catch (sendError) {
        console.error("[Cards] Upgrade completed but channel announcement failed:", sendError);
      }
    }
    return interaction.editReply({
      content: publicPost
        ? `**Upgrade complete!** Your new ${result.target === "neon" ? "Neon" : "Mega Neon"} card ${result.publicId} has been posted in this channel.`
        : `**Upgrade complete!** Your new card ID is ${result.publicId}. I couldn't post it publicly; check /cards collection. Nothing was lost.`,
      components: [], allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("[Cards] Upgrade failed:", error);
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: error.message, components: [] });
    return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
  }
}

export async function handleCardGrab(interaction) {
  if (!isEnabled()) return interaction.reply({ content: "Card grabbing is disabled.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const parts = interaction.customId.split(":");
  const dropId = parts[2], slot = Number(parts[3]);
  if (!interaction.guildId || parts.length !== 4 || !["0", "1", "2"].includes(parts[3])) return interaction.editReply("Invalid card selection.");
  try {
    const reserved = await reserveCardFromDrop({ dropId, slot, guildId: interaction.guildId, discordUserId: interaction.user.id });
    await interaction.editReply(reserved.creatorPriority
      ? `You chose **${escapeDiscord(reserved.petId)}** (${reserved.rarity}). Your pick has priority. ${reserved.refundedEntrants ? `${reserved.refundedEntrants} earlier entrant(s) can now try another card.` : ""}`
      : `You entered for **${escapeDiscord(reserved.petId)}** (${reserved.rarity}). The winner is chosen randomly when the drop ends, unless the drop creator chooses this card. If displaced, your grab opportunity is returned.`);
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
      { slots: { $elemMatch: { winnerId: { $ne: null }, settledAt: null } } },
      { slots: { $elemMatch: { "entrants.0": { $exists: true }, settledAt: null } } },
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


function cardTagConfirmationPayload(request) {
  const heading = request.tag ? "Apply tag #" + escapeDiscord(request.tag) : "Remove tags";
  const rows = request.cards.slice(0, 15).map(card => {
    const stage = card.upgradeLevel === "mega" ? "Mega Neon" :
      card.upgradeLevel === "neon" ? "Neon" : "Normal";
    return "• " + escapeDiscord(card.publicId) + " · " + stage +
      " · " + escapeDiscord(card.releaseId) + " · Frame: " + escapeDiscord(card.frame);
  });
  const allButton = new ButtonBuilder()
    .setCustomId("cards:tagchange:all:" + request.token)
    .setStyle(request.tag ? ButtonStyle.Primary : ButtonStyle.Danger)
    .setLabel(request.tag ? "Apply to all (" + request.cards.length + ")" :
      "Confirm untag (" + request.affected + ")");
  const cancel = new ButtonBuilder().setCustomId("cards:tagchange:cancel:" + request.token)
    .setStyle(ButtonStyle.Secondary).setLabel("Cancel");
  const actions = [allButton];
  if (request.preferredId && request.cards.length > 1) {
    const preferred = request.cards.find(card => card.id === request.preferredId);
    actions.push(new ButtonBuilder()
      .setCustomId("cards:tagchange:preferred:" + request.token)
      .setStyle(ButtonStyle.Success)
      .setLabel("Only " + (preferred?.publicId || "selected ID")));
  }
  actions.push(cancel);
  const components = [new ActionRowBuilder().addComponents(actions)];
  if (request.cards.length > 1) {
    const choices = request.cards.slice(0, 25).map(card => ({
      label: (card.publicId + " · " +
        (card.upgradeLevel === "mega" ? "Mega" : card.upgradeLevel === "neon" ? "Neon" : "Normal") +
        " · " + card.releaseId).slice(0, 100),
      value: card.id,
      description: ("Frame: " + card.frame).slice(0, 100),
    }));
    const picker = new StringSelectMenuBuilder()
      .setCustomId("cards:tagchange:one:" + request.token)
      .setPlaceholder(request.tag ? "Confirm tag on one card ID" : "Confirm untag on one card ID")
      .addOptions(choices);
    components.push(new ActionRowBuilder().addComponents(picker));
  }
  const more = request.cards.length > 15
    ? "\n…plus " + (request.cards.length - 15) + " more matching cards." : "";
  const overflow = request.cards.length > 25
    ? "\nOnly the first 25 IDs appear in the picker. Use the ID directly for other copies." : "";
  return {
    content: [
      "**" + heading + " — Confirm**",
      request.name ? "Pet: **" + escapeDiscord(request.name) + "**" : "",
      "Owned matching cards: **" + request.cards.length + "**",
      "Cards whose tags would change: **" + request.affected + "**",
      request.cards.length > 1 ? "Choose **all copies** or select **one card ID** below." :
        "Confirm this single-card change or cancel.",
      rows.join("\n") + more + overflow,
      "No tags will change until you confirm. This request expires in 2 minutes.",
    ].filter(Boolean).join("\n"),
    components, allowedMentions: { parse: [] },
  };
}

export async function handleCardTagChange(interaction) {
  const parts = interaction.customId.split(":");
  if (parts.length !== 4 || !["all", "one", "preferred", "cancel"].includes(parts[2]))
    return interaction.reply({ content: "Invalid card tag confirmation.", flags: MessageFlags.Ephemeral });
  let request;
  try {
    request = getCardTagConfirmation(parts[3], interaction.user.id);
  } catch (error) {
    return interaction.reply({
      content: escapeDiscord(error.message), flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
  await interaction.deferUpdate();
  try {
    if (parts[2] === "cancel") {
      cancelCardTagConfirmation(request.token, interaction.user.id);
      return interaction.editReply({ content: "Tag change cancelled. No cards were altered.",
        components: [], allowedMentions: { parse: [] } });
    }
    const selectedId = parts[2] === "one" ? interaction.values?.[0] :
      parts[2] === "preferred" ? request.preferredId : null;
    if (["one", "preferred"].includes(parts[2]) && !selectedId) throw new Error("Select a card ID first.");
    const result = await confirmCardTagChange({
      token: request.token, ownerId: interaction.user.id, selectedId,
    });
    return interaction.editReply({
      content: (result.tag ? "**Tag #" + escapeDiscord(result.tag) + "** applied" :
        "**Tags removed**") + " on **" + result.changed +
        (result.changed === 1 ? " card" : " cards") +
        "**." + (result.selectedId ? " Card ID: " + String.fromCharCode(96) +
          result.selectedId + String.fromCharCode(96) + "." : ""),
      components: [], allowedMentions: { parse: [] },
    });
  } catch (error) {
    return interaction.editReply({ content: escapeDiscord(error.message),
      components: [], allowedMentions: { parse: [] } });
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

/** Discord autocomplete must respond directly; it is never deferred. */
export async function autocompleteCards(interaction) {
  if (!isEnabled()) return interaction.respond([]);
  try {
    const option = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused();
    if (option === "upgrade") {
      return interaction.respond(await suggestOwnedCardUpgrades(interaction.user.id, focused));
    }
    if (["tag", "untag", "stats", "view"].includes(option)) {
      return interaction.respond(await suggestOwnedCardReferences(interaction.user.id, focused,
        { includePets: option === "tag" || option === "untag" }));
    }
    return interaction.respond([]);
  } catch (error) {
    console.warn("[Cards] Autocomplete failed:", error.message);
    return interaction.respond([]);
  }
}
