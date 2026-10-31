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
  const found = /^\.(help|register|drop|cooldowns|collection|upgrade|createtag|tagcreate|create-tag|tags|tag|untag|tagmultiple|tag-multiple|untagmultiple|untag-multiple|deletetag|tagdelete|delete-tag|stats|view|trade|give|burn|dust|dustupgrade|lock|unlock|achievements|history|show)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!found) return null;
  const action = ({createtag:"create-tag",tagcreate:"create-tag",tagdelete:"delete-tag",tagmultiple:"tag-multiple",untagmultiple:"untag-multiple",deletetag:"delete-tag"})[found[1].toLowerCase()] || found[1].toLowerCase(), args = String(found[2] || "").trim();
  if (action === "register") return { action, options: {} };
  if (action === "trade") return { action, options: { member: args } };
  if (action === "give") {
    const match = /^(<@!?\d{17,20}>)(?:\s+([\s\S]+))?$/.exec(args);
    return { action, options: { member: match?.[1] || "", cards: match?.[2]?.trim() || "" } };
  }
  if (action === "drop") return { action: "drop", options: {} };
  if (action === "dust") return { action, options: {} };
  if (["achievements","history"].includes(action)) return {action,options:{}};
  if (["lock","unlock"].includes(action)) return {action,options:{card_id:args}};
  if (action==="show") return {action,options:{pet:args}};
  if (action==="dustupgrade")return {action,options:{card:args}};
  if (action === "burn") return { action, options: { card_ids: args } };
  if (action === "cooldowns") return { action, options: {} };
  if (action === "collection") {
    const tokens = args.split(/\s+/).filter(Boolean);
    const member = /^<@!?\d{17,20}>$/.test(tokens[0] || "") ? tokens.shift() : "";
    return { action, options: { member, tag: tokens.join(" ").replace(/^"|"$/g, "") } };
  }
  if (action === "upgrade") {
    const useDust=/\s+dust$/i.test(args);
    return {action,options:{card:useDust?args.replace(/\s+dust$/i,"").trim():args,use_dust:useDust}};
  }
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
  "Type .register to join Hatchem and receive this server\u2019s Card role.",
  "Type a command starting with a dot (.) here, or use /cards:",
  ".collection [tag] or .collection @member [tag] — filter collection",
  ".upgrade [pet name or card ID] — combine four matching cards",
  '.createtag cute · .tags · .tag cute (newest card)',
  '.tag cute 2D Doggy (all copies) · .untag abys',
  ".stats [card ID] · .view [card ID]",
  ".drop — drop an egg (15m global cooldown)",
  ".cooldowns — see your next drop and this server’s grab",
  ".help — list more commands",
  ".trade @member — offer cards on both sides, both confirm twice",
  ".give @member CARDID CARDID or .give @member tag:cute — gift cards after sender confirmation",
  ".burn CARDID, .burn ID1 ID2, or .burn tag:burn — burn selected cards for rarity dust after confirmation",
  ".dust — check your dust by rarity",
  ".dustupgrade CARDID — spend matching rarity dust to replace missing upgrade cards",
  ".lock CARDID / .unlock CARDID — protect a favorite card from transfers and consumption",
  ".history — your recent completed gifts and trades",
  ".achievements — track and unlock milestone badges",
  ".show Pet Name — publicly display a pet card; /cards show offers autocomplete",
].join("\n");

export const HATCHEM_HELP = [
  "**🥚 Hatchem typed commands — start with a dot (.)**",
  ".register — join Hatchem in this server and receive your Card role",
  "Registration is required before regular drops or grabs. Join separately in each server.",
  ".drop — player egg every 15 minutes globally",
  ".cooldowns — check drop and grab availability",
  ".collection or .collection cute — optionally filter by tag",
  ".collection @member or .collection @member cute — public collection",
  ".upgrade Pet Name or .upgrade CardID — confirm a four-card upgrade",
  '.createtag cute — save a tag · .tags — list saved tags',
  '.tag cute — tag your newest owned card',
  '.tag cute 2D Doggy — select one or all matching pet copies',
  '.tag cute KxQOo — target a card ID (ask one/all if duplicates)',
  '.tag cute KxQOo Abc12 Def34 — tag only these card IDs',
  '.createtag Very Cute, then .tag Very Cute 2D Doggy — spaces work without quotes',
  '.untag abys — confirm before removing tags',
  ".tagmultiple Favorites ID1,ID2 · .untagmultiple ID1,ID2",
  ".deletetag Favorites · .stats abys · .view abys",
  ".trade @member — both add cards and confirm twice",
  ".give @member ID1 ID2 or .give @member tag:cute — the giver confirms once",
  ".burn CARDID, .burn ID1 ID2, or .burn tag:burn — confirm before destroying cards for dust",
  ".createtag burn then .tag burn CARDID — select cards to burn; other tags protect cards",
  ".dust — view your five rarity dust balances",
  ".dustupgrade CARDID (or .upgrade CARDID dust) — upgrade with 1–3 matching cards plus dust",
  ".lock CARDID / .unlock CARDID — prevent or allow burns, gifts, trades and upgrades",
  ".history — view completed gifts and trades",
  ".achievements — view your milestones",
  ".show Pet Name — display a card in this channel; /cards show has search suggestions",
  "Tag FIRST, then pet name or IDs. No quotes necessary; create multiword tags first.",
].join("\n");

export async function runHatchemText(message, parsed) {
  if (!parsed) return false;
  if (parsed.action === "help") {
    await message.reply({ content:HATCHEM_HELP,allowedMentions:{parse:[]} });
    return true;
  }
  if (parsed.action === "burn" && !parsed.options.card_ids) {
    await message.reply({content:"Use .burn CARDID, .burn ID1 ID2, or .burn tag:burn. Only the burn tag can be used for burn selection; other tags protect cards. Confirm before destroying anything.",allowedMentions:{parse:[]}});
    return true;
  }
  const match = /^<@!?(\d{17,20})>$/.exec(parsed.options.member || "");
  const target = match ? (message.mentions.users.get(match[1]) ||
    await message.client.users.fetch(match[1]).catch(() => null)) : null;
  if (["trade","give"].includes(parsed.action) && !match) {
    await message.reply({
      content: "Use .trade @member to trade, or .give @member CARDID CARDID (or tag:cute) to gift cards.",
      allowedMentions: { parse: [] },
    });
    return true;
  }
  if (match && !target) {
    await message.reply({ content: "That member could not be found.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.action === "give" && !parsed.options.cards) {
    await message.reply({content:"Use .give @member CARDID CARDID or .give @member tag:cute.",allowedMentions:{parse:[]}});
    return true;
  }
  if(parsed.action==="show"&&!parsed.options.pet){
    await message.reply({content:"Use .show Pet Name to display a card, or /cards show to choose from autocomplete.",allowedMentions:{parse:[]}});
    return true;
  }
  if(["lock","unlock"].includes(parsed.action)&&!parsed.options.card_id){
    await message.reply({content:"Use ."+parsed.action+" CARDID (a five-character ID from .collection).",allowedMentions:{parse:[]}});
    return true;
  }
  if(parsed.action==="dustupgrade"&&!parsed.options.card){
    await message.reply({content:"Use .dustupgrade CARDID. You need 1–3 unlocked matching cards plus enough matching rarity dust.",allowedMentions:{parse:[]}});
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
        content: "Use .tag cute for your newest card, .tag cute 2D Doggy for a pet, or .tag cute KxQOo Abc12 for multiple IDs. Create a tag with spaces first using .createtag Very Cute.",
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
      getBoolean: key => Boolean(options[key]),
      getAttachment: () => null,
    },
    suppressSuccessDropReply: async () => null,
    suppressGiftReply: async () => null,
    suppressShowReply: async()=>null,
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
