import {
  ActionRowBuilder, AttachmentBuilder, EmbedBuilder, StringSelectMenuBuilder,
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
  closeCollectionSession, getCollectionPage, listCollectionReleases, listCollectionRarities, listCollectionTags,
  findOwnedCollectionCard, COLLECTION_SORT_OPTIONS,
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
  const [page, summary, releases, ownedRarities, tags] = await Promise.all([
    getCollectionPage(session.collectionOwnerId, session),
    getCardCollectionSummary(session.collectionOwnerId),
    listCollectionReleases(session.collectionOwnerId),
    listCollectionRarities(session.collectionOwnerId),
    listCollectionTags(session.collectionOwnerId),
  ]);
  // Discord allows only 25 select choices. Reserve one for All releases.
  session.releaseOptions = releases.slice(0, 24);
  if (session.release !== "all" && !session.releaseOptions.includes(session.release)) session.release = "all";
  // Discord embeds keep every card on a single compact, regular-weight line.
  // Names and tags are escaped; no extra heading/ID rows for each card.
  session.rarityOptions = ownedRarities;
  if (session.rarity !== "all" && !ownedRarities.includes(session.rarity)) session.rarity = "all";
  // Show only existing tags owned by this member; reserve one option for All tags.
  session.tagOptions = tags.slice(0, 24);
  if (session.tag && !tags.some(t => t.toLowerCase() === session.tag.toLowerCase())) session.tag = "";
  if (session.tag && !session.tagOptions.includes(session.tag)) {
    session.tagOptions = [...tags.slice(0, 23), session.tag];
  }
  const rows = page.cards.map((c, i) => [
    `${page.page * 10 + i + 1}.`,
    safe(c.petName),
    safe(c.rarityName),
    labelStage(c.upgradeLevel),
    `ID:${safe(c.publicId || "PENDING")}`,
    safe(c.releaseName),
    ...(c.tag ? [`#${safe(c.tag)}`] : []),
    ...(c.locked ? ["🔒"] : []),
  ].join(" · ").replace(/^([0-9]+\\.) · /, "$1 "));
  const embed = new EmbedBuilder()
    .setColor(0xB9A4D7)
    .setTitle(`${safe(session.collectionName)} · ${summary.total} owned`)
    .setDescription([session.tag ? `Tag filter: **#${safe(session.tag)}**` : "", rows.length ? rows.join("\n") : "No cards match these filters."].filter(Boolean).join("\n"))
    .setFooter({ text: `Normal ${summary.upgrade.normal || 0} · Neon ${summary.upgrade.neon || 0} · Mega ${summary.upgrade.mega || 0}  |  ${page.total} matching · page ${page.page + 1}/${page.pages}` });
  const rarity = select(`cards:collection:rarity:${id}`, "Filter by rarity",
    ["all", ...ownedRarities].map(x => ({ label: x === "all" ? "All rarities" : x, value: x })), session.rarity);
  const release = select(`cards:collection:release:${id}`, "Filter by release",
    [{ label: "All releases", value: "all" }, ...session.releaseOptions.map(x => ({ label: x, value: x }))], session.release);
  const tag = select(`cards:collection:tag:${id}`, "Filter by tag",
    [{ label: "All tags", value: "all" }, ...session.tagOptions.map(t => ({ label: t, value: t }))],
    session.tag || "all");
  const sort = select(`cards:collection:sort:${id}`, "Sort cards",
    COLLECTION_SORT_OPTIONS.map(value => ({
      value,
      label: { newest: "Newest first", oldest: "Oldest first", name: "Pet name A–Z", rarity: "Highest rarity first" }[value],
    })), session.sort);
  // Keep the entire collection within Discord's five action rows: four
  // filters and one card picker. Page navigation lives in the picker.
  const cardChoices = page.cards.map((c, i) => ({
    label: `${page.page * 8 + i + 1}. ${c.petName}`,
    value: String(c._id),
  }));
  if (page.page > 0) cardChoices.push({ label: "← Previous page", value: "__prev__" });
  if (page.page + 1 < page.pages) cardChoices.push({ label: "Next page →", value: "__next__" });
  if (!cardChoices.length) cardChoices.push({ label: "No cards to open", value: "__empty__" });
  const picker = select(`cards:collection:pick:${id}`, "Open a card or change page", cardChoices, undefined);
  const components = [rarity, release, tag, sort, picker];
  return { content: "", embeds: [embed], components, attachments: [], allowedMentions: { parse: [] } };
}

export async function startCardCollection(interaction) {
  const target = interaction.options.getUser("member") || interaction.user;
  const name = target.id === interaction.user.id ? "Your Card Collection" : `${target.username}’s Card Collection`;
  const requestedTag = interaction.options.getString("tag")?.trim() || "";
  const id = openCollectionSession(interaction.user.id, target.id, name);
  if (requestedTag) {
    const available = await listCollectionTags(target.id);
    const matched = available.find(t => t.toLocaleLowerCase() === requestedTag.toLocaleLowerCase());
    if (!matched) {
      return interaction.editReply("No cards in this collection have the tag **" + safe(requestedTag) + "**. Use `.tags` to view saved tags.");
    }
    updateCollectionSession(id, interaction.user.id, { tag: matched });
  }
  return interaction.editReply(await collectionView(id, interaction.user.id));
}

export async function handleCardCollectionInteraction(interaction) {
  const parts = interaction.customId.split(":");
  const action = parts[2], id = parts[3];
  if (parts.length !== 4 || !id) return interaction.reply({ content: "Invalid collection menu.", flags: 64 });
  // Public controls belong only to the member who opened this collection.
  // Never acknowledge with deferUpdate for another user: that would edit their view.
  let session;
  try {
    session = getCollectionSession(id, interaction.user.id);
  } catch (error) {
    return interaction.reply({ content: safe(error.message), flags: 64, allowedMentions: { parse: [] } });
  }
  await interaction.deferUpdate();
  try {
    if (action === "pick" && ["__prev__", "__next__", "__back__", "__empty__"].includes(interaction.values?.[0])) {
      const selected = interaction.values?.[0];
      if (selected === "__prev__" || selected === "__next__") {
        updateCollectionSession(id, interaction.user.id, {
          page: Math.max(0, session.page + (selected === "__next__" ? 1 : -1)),
        });
        return interaction.editReply(await collectionView(id, interaction.user.id));
      }
      if (selected === "__back__" || selected === "__empty__") {
        return interaction.editReply(await collectionView(id, interaction.user.id));
      }
    } else if (action === "rarity") {

      if (!session.rarityOptions?.includes(interaction.values?.[0]) && interaction.values?.[0] !== "all") throw new Error("That rarity is not in your collection.");
      updateCollectionSession(id, interaction.user.id, { rarity: interaction.values?.[0] });
    } else if (action === "release") {
      updateCollectionSession(id, interaction.user.id, { release: interaction.values?.[0] });
    } else if (action === "sort") {
      updateCollectionSession(id, interaction.user.id, { sort: interaction.values?.[0] });
    } else if (action === "tag") {
      const selected = interaction.values?.[0];
      if (selected !== "all" && !session.tagOptions?.includes(selected)) throw new Error("That tag is no longer available.");
      updateCollectionSession(id, interaction.user.id, { tag: selected === "all" ? "" : selected });
    } else if (action === "pick") {
      // Check the selected card belongs to the current displayed page.
      const page = await getCollectionPage(session.collectionOwnerId, session);
      if (!page.cards.some(c => String(c._id) === interaction.values?.[0])) throw new Error("That card is not on this page.");
      const copy = await findOwnedCollectionCard(session.collectionOwnerId, interaction.values?.[0]);
      if (!copy) throw new Error("That card is no longer in this collection.");
      const def = await CardDefinition.findById(copy.cardDefinitionId).lean();
      if (!def) throw new Error("Card definition missing.");
      const [pet, release, series, count] = await Promise.all([
        PetCatalog.findOne({ petId: def.petId }).select("name").lean(),
        CardRelease.findOne({ releaseId: def.releaseId }).select("name cardBackgroundKey cardFrameKey").lean(),
        CardSeries.findOne({ seriesId: def.seriesId }).select("name").lean(),
        countOtherCardCollectors({ cardDefinitionId: copy.cardDefinitionId, ownerDiscordUserId: session.collectionOwnerId }),
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
        components: [select(`cards:collection:pick:${id}`, "Back to collection",
          [{ label: "← Back to collection", value: "__back__" }], undefined)],
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
      components: [select(`cards:collection:pick:${id}`, "Back to collection",
        [{ label: "← Back to collection", value: "__back__" }], undefined)],
      attachments: [],
      allowedMentions: { parse: [] },
    });
  }
}

