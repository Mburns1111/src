import { SlashCommandBuilder } from "discord.js";
import CardRelease from "../models/CardRelease.js";
import CardSeries from "../models/CardSeries.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { isCardGameOwner } from "../services/card-owner-access.js";
import { createSeries, createRelease, editRelease, addReleasePet, addReleasePetsBulk, removeReleasePet, setReleasePetWeight, setReleaseOdds, checkRelease } from "../services/card-global-releases.js";

const PAGE_SIZE = 15;
const clean = value => String(value ?? "").replace(/[@`*_~|<>]/g, "").slice(0, 120);

export const data = new SlashCommandBuilder()
  .setName("cards-owner")
  .setDescription("Private owner-only Hatchem release management")
  .addSubcommand(command => command.setName("releases")
    .setDescription("Privately inspect globally configured egg releases")
    .addIntegerOption(option => option.setName("page")
      .setDescription("Page number").setMinValue(1).setRequired(false)))
  .addSubcommand(command => command.setName("create-series")
    .setDescription("OWNER: create a global collectible series in draft")
    .addStringOption(o => o.setName("id").setDescription("Stable ID, e.g. series-1").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("Display title, e.g. Series 1").setRequired(true)))
  .addSubcommand(command => command.setName("create-release")
    .setDescription("OWNER: create an inactive global egg release under a series")
    .addStringOption(o => o.setName("series").setDescription("Select an existing global series").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("id").setDescription("Unique release ID, e.g. s1-r1").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("Release title").setRequired(true))
    .addStringOption(o => o.setName("egg").setDescription("Egg display name").setRequired(true)))
  .addSubcommand(command => command.setName("edit-release")
    .setDescription("OWNER: edit the name of a DRAFT release or egg")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("name").setDescription("Optional replacement release name"))
    .addStringOption(o => o.setName("egg").setDescription("Optional replacement egg name")))
  .addSubcommand(command => command.setName("add-pet")
    .setDescription("OWNER: add a master-catalog pet to a DRAFT release")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("pet").setDescription("Search available pet names").setRequired(true).setAutocomplete(true))
    .addNumberOption(o => o.setName("weight").setDescription("Relative hatch weight; default 1").setMinValue(0).setMaxValue(10000)))
  .addSubcommand(command => command.setName("add-pets")
    .setDescription("OWNER: add up to 100 pets to a DRAFT in one atomic operation")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("pets").setDescription("Comma-separated pet IDs or exact names").setRequired(true).setMaxLength(6000)))
  .addSubcommand(command => command.setName("remove-pet")
    .setDescription("OWNER: remove a pet with no approved art from a DRAFT")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("pet").setDescription("Search pets already assigned to this release").setRequired(true).setAutocomplete(true)))
  .addSubcommand(command => command.setName("set-weight")
    .setDescription("OWNER: adjust a draft release pet's relative hatch weight")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("pet").setDescription("Search pets already assigned to this release").setRequired(true).setAutocomplete(true))
    .addNumberOption(o => o.setName("weight").setDescription("Weight, 0 disables its chance").setMinValue(0).setMaxValue(10000).setRequired(true)))
  .addSubcommand(command => command.setName("set-odds")
    .setDescription("OWNER: set all five rarity percentages in a DRAFT release")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true))
    .addNumberOption(o => o.setName("common").setDescription("Common %").setRequired(true).setMinValue(0).setMaxValue(100))
    .addNumberOption(o => o.setName("uncommon").setDescription("Uncommon %").setRequired(true).setMinValue(0).setMaxValue(100))
    .addNumberOption(o => o.setName("rare").setDescription("Rare %").setRequired(true).setMinValue(0).setMaxValue(100))
    .addNumberOption(o => o.setName("ultra_rare").setDescription("Ultra-Rare %").setRequired(true).setMinValue(0).setMaxValue(100))
    .addNumberOption(o => o.setName("legendary").setDescription("Legendary %").setRequired(true).setMinValue(0).setMaxValue(100)))
  .addSubcommand(command => command.setName("release-check")
    .setDescription("OWNER: privately inspect readiness without activating an egg")
    .addStringOption(o => o.setName("release").setDescription("Select a global release").setRequired(true).setAutocomplete(true)))
  .addSubcommand(command => command.setName("inspect")
    .setDescription("Privately inspect all pets and weights in an egg release")
    .addStringOption(option => option.setName("release")
      .setDescription("Select a global release").setRequired(true).setAutocomplete(true))
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
  if (["create-series", "create-release", "edit-release", "add-pet",
      "add-pets", "remove-pet", "set-weight", "set-odds", "release-check"].includes(option)) {
    const string = key => interaction.options.getString(key);
    const number = key => interaction.options.getNumber(key);
    try {
      if (option === "create-series") {
        const result = await createSeries({ seriesId: string("id"), name: string("name") });
        return interaction.editReply("Created global series **" + clean(result.name) + "** (ID: " + clean(result.id) + "). Status: draft.");
      }
      if (option === "create-release") {
        const result = await createRelease({
          seriesId: string("series"), releaseId: string("id"),
          name: string("name"), eggName: string("egg"),
        });
        return interaction.editReply("Created global egg release **" + clean(result.name) +
          "** (ID: " + clean(result.id) + ") under " + clean(result.seriesId) +
          ". **DRAFT only**: no cards published or hatchable. Add pets using add-pet.");
      }
      if (option === "edit-release") {
        const result = await editRelease({ releaseId: string("release"), name: string("name"), eggName: string("egg") });
        return interaction.editReply("Updated draft release " + clean(result.releaseId) +
          ": **" + clean(result.name) + "** / Egg **" + clean(result.eggName) + "**.");
      }
      if (option === "add-pet") {
        const result = await addReleasePet({
          releaseId: string("release"), petId: string("pet"), weight: number("weight") ?? 1,
        });
        return interaction.editReply("Added **" + clean(result.petName) + "** (" + clean(result.rarity) +
          ") to draft " + clean(result.releaseId) + "; weight " + result.weight +
          ". Not yet hatchable; artwork and approval still required.");
      }
      if (option === "add-pets") {
        const result = await addReleasePetsBulk({
          releaseId: string("release"), pets: string("pets"),
        });
        return interaction.editReply("Added **" + result.added + "** disabled pet designs to draft " +
          clean(result.releaseId) + ". All entries succeeded together. Artwork remains missing.");
      }
      if (option === "remove-pet") {
        const result = await removeReleasePet({ releaseId: string("release"), petId: string("pet") });
        return interaction.editReply("Removed unapproved pet " + clean(result.petId) + " from draft " + clean(result.releaseId) + ".");
      }
      if (option === "set-weight") {
        const result = await setReleasePetWeight({
          releaseId: string("release"), petId: string("pet"), weight: number("weight"),
        });
        return interaction.editReply("Updated " + clean(result.petId) + " hatch weight to **" + result.weight + "** in draft " + clean(result.releaseId) + ".");
      }
      if (option === "set-odds") {
        const result = await setReleaseOdds({ releaseId: string("release"), odds: {
          Common: number("common"), Uncommon: number("uncommon"), Rare: number("rare"),
          "Ultra-Rare": number("ultra_rare"), Legendary: number("legendary"),
        } });
        return interaction.editReply("Saved rarity percentages for draft " + clean(result.releaseId) + ". All five add to 100%.");
      }
      if (option === "release-check") {
        const check = await checkRelease({ releaseId: string("release") });
        return interaction.editReply([
          "**Owner-only release readiness — " + clean(check.release.name) + "**",
          "Status: " + clean(check.release.status) + " · Assigned: " + check.pets +
            " · Currently hatchable: " + check.usable,
          ...check.problems.map(p => "• " + clean(p)),
          "This command is read-only. No release was activated.",
        ].join("\n"));
      }
    } catch (error) {
      return interaction.editReply({ content: clean(error.message), allowedMentions: { parse: [] } });
    }
  }
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


/** Autocomplete reveals release rosters only to the configured owner. */
export async function autocompleteCardsOwner(interaction) {
  if (!isCardGameOwner(interaction.user?.id)) return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  const query = String(focused?.value ?? "").trim().slice(0, 90).toLocaleLowerCase();
  const matches = name => String(name || "").toLocaleLowerCase().includes(query);
  const option = interaction.options.getSubcommand(false);
  try {
    let suggestions = [];
    if (focused.name === "series" && option === "create-release") {
      const series = await CardSeries.find({ status: { $ne: "retired" } })
        .select("seriesId name").sort({ name: 1 }).limit(200).lean();
      suggestions = series.filter(s => matches(s.name) || matches(s.seriesId))
        .slice(0, 25).map(s => ({ name: (s.name + " · " + s.seriesId).slice(0, 100), value: s.seriesId }));
    } else if (focused.name === "release") {
      const releases = await CardRelease.find({}).select("releaseId name status")
        .sort({ createdAt: -1 }).limit(200).lean();
      suggestions = releases.filter(r => matches(r.name) || matches(r.releaseId))
        .slice(0, 25).map(r => ({
          name: (r.name + " · " + r.releaseId + " (" + r.status + ")").slice(0, 100),
          value: r.releaseId,
        }));
    } else if (focused.name === "pet" && option === "add-pet") {
      const escaped = query.replace(/[^\p{L}\p{N} -]/gu, "\\$&");
      const pets = await PetCatalog.find({
        rarity: { $ne: "Unknown" },
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { petId: { $regex: escaped, $options: "i" } },
        ],
      }).select("petId name rarity").sort({ name: 1 }).limit(100).lean();
      const selectedRelease = interaction.options.getString("release");
      const assigned = selectedRelease
        ? await CardDefinition.distinct("petId", { releaseId: selectedRelease,
            petId: { $in: pets.map(p => p.petId) } })
        : [];
      const existing = new Set(assigned);
      suggestions = pets.filter(p => !existing.has(p.petId)).slice(0, 25)
        .map(p => ({ name: (p.name + " · " + p.rarity).slice(0, 100), value: p.petId }));
    } else if (focused.name === "pet" && ["remove-pet", "set-weight"].includes(option)) {
      const selectedRelease = interaction.options.getString("release");
      if (!selectedRelease) return interaction.respond([]);
      const assigned = await CardDefinition.find({ releaseId: selectedRelease })
        .select("petId rarity").limit(250).lean();
      const pets = await PetCatalog.find({ petId: { $in: assigned.map(d => d.petId) } })
        .select("petId name").lean();
      const names = new Map(pets.map(p => [p.petId, p.name]));
      suggestions = assigned.filter(d => matches(names.get(d.petId)) || matches(d.petId))
        .slice(0, 25).map(d => ({
          name: ((names.get(d.petId) || d.petId) + " · " + d.rarity).slice(0, 100),
          value: d.petId,
        }));
    }
    return interaction.respond(suggestions);
  } catch (error) {
    console.warn("[Cards] Owner autocomplete failed:", error.message);
    return interaction.respond([]);
  }
}
