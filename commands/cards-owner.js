import { SlashCommandBuilder } from "discord.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { isCardGameOwner } from "../services/card-owner-access.js";

const PAGE_SIZE = 15;
const clean = value => String(value ?? "").replace(/[@`*_~|<>]/g, "").slice(0, 120);

export const data = new SlashCommandBuilder()
  .setName("cards-owner")
  .setDescription("Private owner-only Hatchem release management")
  .addSubcommand(command => command.setName("releases")
    .setDescription("Privately inspect globally configured egg releases")
    .addIntegerOption(option => option.setName("page")
      .setDescription("Page number").setMinValue(1).setRequired(false)))
  .addSubcommand(command => command.setName("inspect")
    .setDescription("Privately inspect all pets and weights in an egg release")
    .addStringOption(option => option.setName("release")
      .setDescription("The global release ID").setRequired(true))
    .addIntegerOption(option => option.setName("page")
      .setDescription("Page of the release's pets").setMinValue(1).setRequired(false)));

export async function execute(interaction) {
  // Never query or reveal release data until the ID-based owner check succeeds.
  // There is intentionally no administrator/role bypass.
  if (!isCardGameOwner(interaction.user?.id)) {
    return interaction.editReply("Only the card-game owner can view or manage global releases.");
  }
  const page = interaction.options.getInteger("page") || 1;
  const option = interaction.options.getSubcommand();
  if (option === "releases") {
    const [total, releases] = await Promise.all([
      CardRelease.countDocuments({}),
      CardRelease.find({}).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    ]);
    if (!releases.length) return interaction.editReply("There are no releases on this page.");
    return interaction.editReply([
      `**Global egg releases — owner only** · Page ${page}/${Math.max(1, Math.ceil(total / PAGE_SIZE))}`,
      ...releases.map(r => `• ${clean(r.name)} · \`${clean(r.releaseId)}\` · ${clean(r.status)}`),
      "Use /cards-owner inspect to see the pets inside one release.",
    ].join("\n"));
  }
  if (option === "inspect") {
    const releaseId = interaction.options.getString("release", true).trim();
    const release = await CardRelease.findOne({ releaseId }).lean();
    if (!release) return interaction.editReply("That release does not exist.");
    const [total, definitions] = await Promise.all([
      CardDefinition.countDocuments({ releaseId }),
      CardDefinition.find({ releaseId }).sort({ petId: 1, _id: 1 })
        .skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    ]);
    const pets = await PetCatalog.find({ petId: { $in: definitions.map(d => d.petId) } })
      .select("petId name").lean();
    const names = new Map(pets.map(p => [p.petId, p.name]));
    return interaction.editReply([
      `**${clean(release.name)}** · ${clean(release.status)} · Owner-only roster`,
      `ID: \`${clean(release.releaseId)}\` · ${total} pet designs · Page ${page}/${Math.max(1, Math.ceil(total / PAGE_SIZE))}`,
      `Hatch odds: Common ${release.hatchOdds?.Common}% · Uncommon ${release.hatchOdds?.Uncommon}% · Rare ${release.hatchOdds?.Rare}% · Ultra-Rare ${release.hatchOdds?.["Ultra-Rare"]}% · Legendary ${release.hatchOdds?.Legendary}%`,
      ...definitions.map(d => `• ${clean(names.get(d.petId) || d.petId)} · ${clean(d.rarity)} · weight ${d.hatchWeight} · ${d.enabled ? "enabled" : "disabled"} · ${clean(d.artStatus)}`),
      definitions.length ? "" : "No pets on this page.",
    ].join("\n"));
  }
  return interaction.editReply("Unknown owner action.");
}
