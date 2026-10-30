import { execute as executeCards } from "../commands/cards.js";
import { listCollectorTags } from "./card-tag-catalog.js";

/**
 * User-facing format is .tag <tag name> [pet name or IDs], without quotes.
 * The collector's saved tags disambiguate a tag containing spaces from a
 * pet name containing spaces. Longer tag names take precedence.
 *
 * Examples:
 *   .tag cute
 *   .tag cute 2D Doggy
 *   .tag cute KxQOo Abc12
 *   .tag Very Cute 2D Doggy  (when "Very Cute" is a saved tag)
 */
export function parseHatchemTagArguments(raw, savedTags = []) {
  const args = String(raw || "").trim().replace(/\s+/g, " ");
  if (!args) return { tag: "" };

  const sortedTags = [...savedTags]
    .filter(value => typeof value === "string" && value.trim())
    .map(value => value.trim().replace(/\s+/g, " "))
    .sort((a, b) => b.length - a.length);

  const known = sortedTags.find(name =>
    args.toLocaleLowerCase() === name.toLocaleLowerCase()
    || args.toLocaleLowerCase().startsWith(name.toLocaleLowerCase() + " ")
  );
  let tag;
  let target;
  if (known) {
    tag = known;
    target = args.slice(known.length).trim();
  } else {
    // Preserve compatibility with previously typed quoted tags, but quotes
    // are never needed or displayed in the user-facing instructions.
    const first = /^"([^"]+)"(?:\s+([\s\S]+))?$/.exec(args)
      || /^(\S+)(?:\s+([\s\S]+))?$/.exec(args);
    if (!first) return { tag: "" };
    tag = first[1].trim();
    target = String(first[2] || "").trim();
  }
  if (!target) return { tag };
  const namedTarget = /^"([^"]+)"$/.exec(target);
  if (namedTarget) return { tag, card_id: namedTarget[1] };
  const references = target.split(/[\s,;]+/).filter(Boolean);
  if ((references.length > 1 && references.every(value => /^[0-9A-Za-z_-]{5}$/.test(value)))
      || /[,;]/.test(target)) {
    return { tag, card_ids: references.join(" ") };
  }
  return { tag, card_id: target };
}

export function parseHatchemText(content) {
  const text = String(content || "").trim().slice(0, 1000);
  if (!text.startsWith(".")) return null;
  const found = /^\.(help|drop|cooldowns|collection|upgrade|create-tag|tags|tag|untag|tag-multiple|untag-multiple|delete-tag|stats|view|trade|burn)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!found) return null;
  const action = found[1].toLowerCase(), args = String(found[2] || "").trim();
  if (action === "drop") return { action: "drop", options: {} };
  if (action === "cooldowns") return { action, options: {} };
  if (action === "collection") {
    const tokens = args.split(/\s+/).filter(Boolean);
    const member = /^<@!?\d{17,20}>$/.test(tokens[0] || "") ? tokens.shift() : "";
    return { action, options: { member, tag: tokens.join(" ").replace(/^"|"$/g, "") } };
  }
  if (action === "upgrade") return { action, options: { card: args } };
  if (action === "tag") return { action, options: parseHatchemTagArguments(args) };
  if (action === "create-tag") return { action, options: { tag: args.replace(/^"|"$/g, "") } };
  if (["untag", "stats", "view"].includes(action)) return { action, options: { card_id: args } };
  if (action === "tag-multiple") {
    const [tag, ...ids] = args.split(/\s+/);
    return { action, options: { tag: tag || "", card_ids: ids.join(" ") } };
  }
  if (action === "untag-multiple") return { action, options: { card_ids: args } };
  if (action === "delete-tag") return { action, options: { tag: args } };
  return { action, options: {} };
}

export const HATCHEM_GUIDE = [
  "**🥚 Hatchem — Hatch, Collect & Upgrade!**",
  "Type a command starting with a dot (.) here, or use /cards:",
  ".collection [tag] or .collection @member [tag] — filter collection",
  ".upgrade [pet name or card ID] — combine four matching cards",
  '.create-tag cute · .tags · .tag cute (newest card)',
  '.tag cute 2D Doggy (all copies) · .untag abys',
  ".stats [card ID] · .view [card ID]",
  ".drop — drop an egg (15m global cooldown)",
  ".cooldowns — see your next drop and this server’s grab",
  ".help — list more commands",
  "Trade and burn are planned, not enabled yet.",
].join("\n");

export const HATCHEM_HELP = [
  "**🥚 Hatchem typed commands — start with a dot (.)**",
  ".drop — player egg every 15 minutes globally",
  ".cooldowns — check drop and grab availability",
  ".collection or .collection cute — optionally filter by tag",
  ".collection @member or .collection @member cute — public collection",
  ".upgrade Pet Name or .upgrade CardID — confirm a four-card upgrade",
  '.create-tag cute — save a tag · .tags — list saved tags',
  '.tag cute — tag your newest owned card',
  '.tag cute 2D Doggy — select one or all matching pet copies',
  '.tag cute KxQOo — target a card ID (ask one/all if duplicates)',
  '.tag cute KxQOo Abc12 Def34 — tag only these card IDs',
  '.create-tag Very Cute, then .tag Very Cute 2D Doggy — spaces work without quotes',
  '.untag abys — confirm before removing tags',
  ".tag-multiple Favorites ID1,ID2 · .untag-multiple ID1,ID2",
  ".delete-tag Favorites · .stats abys · .view abys",
  ".trade and .burn — coming later; not active",
  "Tag FIRST, then pet name or IDs. No quotes necessary; create multiword tags first.",
].join("\n");

export async function runHatchemText(message, parsed) {
  if (!parsed) return false;
  if (parsed.action === "help" || ["trade", "burn"].includes(parsed.action)) {
    const content = parsed.action === "help" ? HATCHEM_HELP :
      "That Hatchem feature isn't ready yet. Trade and burn do not change cards or Points.";
    await message.reply({ content, allowedMentions: { parse: [] } });
    return true;
  }
  const match = /^<@!?(\d{17,20})>$/.exec(parsed.options.member || "");
  const target = match ? (message.mentions.users.get(match[1]) ||
    await message.client.users.fetch(match[1]).catch(() => null)) : null;
  if (match && !target) {
    await message.reply({ content: "That member could not be found.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.action === "upgrade" && !parsed.options.card) {
    await message.reply({ content: "Use .upgrade followed by a pet name or card ID.", allowedMentions: { parse: [] } });
    return true;
  }
  let options = parsed.options;
  if (parsed.action === "tag") {
    // Resolve multiword tag names against saved tags BEFORE splitting the pet
    // name or ID list. Typed commands have no Discord autocomplete.
    try {
      const savedTags = await listCollectorTags(message.author.id);
      const rawArguments = /^\.tag(?:\s+([\s\S]*))?$/i.exec(String(message.content || "").trim())?.[1] || "";
      options = parseHatchemTagArguments(rawArguments, savedTags);
    } catch (error) {
      await message.reply({
        content: "Unable to read your saved tags: " + String(error.message || "try again"),
        allowedMentions: { parse: [] },
      });
      return true;
    }
    if (!options.tag) {
      await message.reply({
        content: "Use .tag cute for your newest card, .tag cute 2D Doggy for a pet, or .tag cute KxQOo Abc12 for multiple IDs. Create a tag with spaces first using .create-tag Very Cute.",
        allowedMentions: { parse: [] },
      });
      return true;
    }
  }
  let response = null;
  const facade = {
    user: message.author, guild: message.guild, guildId: message.guildId,
    channel: message.channel, channelId: message.channelId,
    memberPermissions: message.member?.permissions,
    options: {
      getSubcommand: () => parsed.action,
      getString: key => options[key] || null,
      getUser: key => key === "member" ? target : null,
      getInteger: () => null,
      getAttachment: () => null,
    },
    editReply: async payload => {
      const body = typeof payload === "string" ? { content: payload } : payload;
      const data = { ...body, allowedMentions: body.allowedMentions || { parse: [] } };
      response = response ? await response.edit(data) : await message.reply(data);
      return response;
    },
  };
  try {
    await executeCards(facade);
  } catch (error) {
    console.error("[Hatchem] Text command failed:", error);
    await message.reply({ content: "Hatchem couldn't complete that command. Please try again.", allowedMentions: { parse: [] } });
  }
  return true;
}
