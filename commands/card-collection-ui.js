import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, StringSelectMenuBuilder,
} from "discord.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import CardSeries from "../models/CardSeries.js";
import PetCatalog from "../models/PetCatalog.js";
import { renderCollectibleCardPreview } from "../services/card-preview-renderer.js";
import { loadCardArtwork } from "../services/card-artwork-assets.js";
import { countOtherCardCollectors } from "../services/card-ownership-stats.js";
import { getCardCollectionSummary } from "../services/card-collection-summary.js";
import {
  openCollectionSession, getCollectionSession, updateCollectionSession,
  closeCollectionSession, getCollectionPage, listCollectionReleases,
  findOwnedCollectionCard, COLLECTION_RARITY_OPTIONS, COLLECTION_SORT_OPTIONS,
} from "../services/card-collection-browser.js";

const safe = value => String(value ?? "").replace(/[@`*_~|<>]/g, "");
const labelStage = value => value === "mega" ? "Mega Neon" : value === "neon" ? "Neon" : "Normal";

function select(id, placeholder, options, selected) {
  const menu = new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder)
    .addOptions(options.map(o => ({
      label: o.label.slice(0, 100),
      value: o.value,
      default: o.value === selected,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

async function collectionView(id, ownerId) {
  const session = getCollectionSession(id, ownerId);
  const [page, summary, releases] = await Promise.all([
    getCollectionPage(ownerId, session),
    getCardCollectionSummary(ownerId),
    listCollectionReleases(ownerId),
  ]);
  // Discord allows only 25 select choices. Reserve one for All releases.
  session.releaseOptions = releases.slice(0, 24);
  if (session.release !== "all" && !session.releaseOptions.includes(session.release)) session.release = "all";
  // Discord embeds keep every card on a single compact, regular-weight line.
  // Names and tags are escaped; no extra heading/ID rows for each card.
  const rows = page.cards.map((c, i) => [
    `${page.page * 8 + i + 1}.`,
    safe(c.petName),
    safe(c.rarityName),
    labelStage(c.upgradeLevel),
    \`${safe(c.publicId || "PENDING")}\`,
    safe(c.releaseName),
    ...(c.tag ? [`#${safe(c.tag)}`] : []),
  ].join(" · ").replace(/^([0-9]+\\.) · /, "$1 "));
  const embed = new EmbedBuilder()
    .setColor(0xB9A4D7)
    .setTitle(`Your Card Collection · ${summary.total} owned`)
    .setDescription(rows.length ? rows.join("\\n") : "No cards match these filters.")
    .addFields({
      name: "Collection",
      value: `Normal ${summary.upgrade.normal || 0}  ·  Neon ${summary.upgrade.neon || 0}  ·  Mega ${summary.upgrade.mega || 0}`,
    })
    .setFooter({ text: `${page.total} matching · page ${page.page + 1}/${page.pages} · Select a card to view` });
  const rarity = select(`cards:collection:rarity:${id}`, "Filter by rarity",
    COLLECTION_RARITY_OPTIONS.map(x => ({ label: x === "all" ? "All rarities" : x, value: x })), session.rarity);
  const release = select(`cards:collection:release:${id}`, "Filter by release",
    [{ label: "All releases", value: "all" }, ...session.releaseOptions.map(x => ({ label: x, value: x }))], session.release);
  const sort = select(`cards:collection:sort:${id}`, "Sort cards",
    COLLECTION_SORT_OPTIONS.map(x => ({
      label: { newest: "Newest first", oldest: "Oldest first", name: "Pet name A–Z", rarity: "Highest rarity first" }[x],
      value: x,
    })), session.sort);
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cards:collection:prev:${id}`).setLabel("Previous")
      .setStyle(ButtonStyle.Secondary).setDisabled(page.page === 0),
    new ButtonBuilder().setCustomId(`cards:collection:next:${id}`).setLabel("Next")
      .setStyle(ButtonStyle.Secondary).setDisabled(page.page + 1 >= page.pages),
    new ButtonBuilder().setCustomId(`cards:collection:close:${id}`).setLabel("Close")
      .setStyle(ButtonStyle.Secondary),
  );
  const components = [rarity, release, sort];
  if (page.cards.length) components.push(select(`cards:collection:pick:${id}`, "Open a card",
    page.cards.map((c, i) => ({
      label: `${page.page * 8 + i + 1}. ${c.petName}`,
      value: String(c._id),
    })), undefined));
  components.push(controls);
  return { content: "", embeds: [embed], components, attachments: [], allowedMentions: { parse: [] } };
}

export async function startCardCollection(interaction) {
  const id = openCollectionSession(interaction.user.id);
  return interaction.editReply(await collectionView(id, interaction.user.id));
}

export async function handleCardCollectionInteraction(interaction) {
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const action = parts[2], id = parts[3];
  if (parts.length !== 4 || !id) return interaction.editReply({ content: "Invalid collection menu.", embeds: [], components: [] });
  try {
    const session = getCollectionSession(id, interaction.user.id);
    if (action === "close") {
      closeCollectionSession(id, interaction.user.id);
      return interaction.editReply({ content: "Collection closed. Use /cards collection to open it again.", embeds: [], components: [], attachments: [] });
    }
    if (action === "back") return interaction.editReply(await collectionView(id, interaction.user.id));
    if (action === "prev" || action === "next") {
      updateCollectionSession(id, interaction.user.id, { page: Math.max(0, session.page + (action === "next" ? 1 : -1)) });
    } else if (action === "rarity") {
      updateCollectionSession(id, interaction.user.id, { rarity: interaction.values?.[0] });
    } else if (action === "release") {
      updateCollectionSession(id, interaction.user.id, { release: interaction.values?.[0] });
    } else if (action === "sort") {
      updateCollectionSession(id, interaction.user.id, { sort: interaction.values?.[0] });
    } else if (action === "pick") {
      const copy = await findOwnedCollectionCard(interaction.user.id, interaction.values?.[0]);
      if (!copy) throw new Error("You no longer own that card.");
      const def = await CardDefinition.findById(copy.cardDefinitionId).lean();
      if (!def) throw new Error("Card definition missing.");
      const [pet, release, series, count] = await Promise.all([
        PetCatalog.findOne({ petId: def.petId }).select("name").lean(),
        CardRelease.findOne({ releaseId: def.releaseId }).select("name cardBackgroundKey cardFrameKey").lean(),
        CardSeries.findOne({ seriesId: def.seriesId }).select("name").lean(),
        countOtherCardCollectors({ cardDefinitionId: copy.cardDefinitionId, ownerDiscordUserId: interaction.user.id }),
      ]);
      const [petImage, background, frame] = await Promise.all([
        loadCardArtwork(def.petArtworkKey, "pet"),
        loadCardArtwork(release?.cardBackgroundKey, "background"),
        loadCardArtwork(release?.cardFrameKey, "frame"),
      ]);
      const png = await renderCollectibleCardPreview({
        petName: pet?.name || def.petId, rarity: def.rarity, upgradeLevel: copy.upgradeLevel,
        publicId: copy.publicId || "PENDING", releaseName: release?.name || def.releaseId,
        seriesName: series?.name || def.seriesId, artistCredit: def.artistCredit,
        artUrl: def.artUrl, artStatus: def.artStatus, otherCollectorCount: count,
        petImageSource: petImage?.bytes, backgroundImageSource: background?.bytes,
        frameImageSource: frame?.bytes,
      });
      return interaction.editReply({
        content: `**${safe(pet?.name || def.petId)}** · ${safe(def.rarity)} · ${labelStage(copy.upgradeLevel)}\nCard ID: \`${safe(copy.publicId || "PENDING")}\`${copy.tag ? ` · Tag: ${safe(copy.tag)}` : ""}`,
        embeds: [],
        files: [new AttachmentBuilder(png, { name: "collection-card.png" })],
        attachments: [],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`cards:collection:back:${id}`).setLabel("Back to collection").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`cards:collection:close:${id}`).setLabel("Close").setStyle(ButtonStyle.Secondary),
        )],
        allowedMentions: { parse: [] },
      });
    } else {
      throw new Error("Unknown collection action.");
    }
    return interaction.editReply(await collectionView(id, interaction.user.id));
  } catch (error) {
    return interaction.editReply({
      content: safe(error.message),
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cards:collection:back:${id}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
      )],
      attachments: [],
      allowedMentions: { parse: [] },
    });
  }
}
