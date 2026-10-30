import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";

export const MAX_CARD_TAG_LENGTH = 32;

export function normalizeCardTag(value) {
  const tag = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!tag || tag.length > MAX_CARD_TAG_LENGTH || !/^[\p{L}\p{N} _-]+$/u.test(tag)) {
    throw new Error("Tags must be 1–32 characters using letters, numbers, spaces, - or _.");
  }
  return tag;
}

// New tags use a stable lowercase key. Existing mixed-case card tags remain
// readable and match through a case-insensitive query; no migration is needed.
export function tagKey(value) {
  return normalizeCardTag(value).toLocaleLowerCase();
}

export function matchingTagRegex(tag) {
  const escaped = normalizeCardTag(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped + "$", "i");
}

export async function createCollectorTag(discordUserId, value) {
  const name = tagKey(value);
  await CardCollector.updateOne(
    { discordUserId },
    { $setOnInsert: { discordUserId }, $addToSet: { tagNames: name } },
    { upsert: true },
  );
  return name;
}

export async function listCollectorTags(discordUserId) {
  const [collector, assigned] = await Promise.all([
    CardCollector.findOne({ discordUserId }).select("tagNames").lean(),
    CardCopy.distinct("tag", {
      ownerDiscordUserId: discordUserId, state: "owned",
      tag: { $type: "string", $ne: "" },
    }),
  ]);
  return [...new Set([...(collector?.tagNames || []), ...assigned]
    .filter(value => typeof value === "string" && value.trim())
    .map(tagKey))].sort((a, b) => a.localeCompare(b));
}


// Applying a tag must NEVER silently create it. .create-tag is the only
// member command that adds a new reusable tag name.
export async function requireSavedCardTag(discordUserId, value) {
  const normalized = tagKey(value);
  const collector = await CardCollector.findOne({ discordUserId }).select("tagNames").lean();
  if (!(collector?.tagNames || []).some(t => tagKey(t) === normalized))
    throw new Error("Tag '" + normalized + "' does not exist. Create it first with .create-tag " + normalized + ".");
  return normalized;
}
