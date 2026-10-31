import {achievementStart} from "./card-achievement-engine.js";
import {claimWithBonus,refundWithBonus} from "./card-bonus-actions.js";
import CardActionCooldown from "../models/CardActionCooldown.js";

export const CARD_DROP_COOLDOWN_MS = 15 * 60 * 1000;
export const CARD_GRAB_COOLDOWN_MS = 5 * 60 * 1000;

export function cardCooldownIdentity({ action, discordUserId, guildId }) {
  if (!["drop", "grab"].includes(action)) throw new Error("Unknown card cooldown action.");
  if (!/^\d{17,20}$/.test(String(discordUserId || ""))) throw new Error("Invalid collector ID.");
  if (action === "grab" && !/^\d{17,20}$/.test(String(guildId || ""))) {
    throw new Error("A grab cooldown requires a server ID.");
  }
  const scope = action === "drop" ? "global" : String(guildId);
  return {
    _id: `${action}:${scope}:${discordUserId}`,
    action, scope, discordUserId: String(discordUserId),
  };
}

export function cardCooldownDuration(action) {
  if (action === "drop") return CARD_DROP_COOLDOWN_MS;
  if (action === "grab") return CARD_GRAB_COOLDOWN_MS;
  throw new Error("Unknown card cooldown action.");
}

/**
 * Claim a player action cooldown at the point the action is accepted.
 * Call this only when a regular player drop or normal grab is actually valid.
 * The current manager-only TEST drops do not spend player cooldowns.
 *
 * MongoDB is the source of truth. A compare-and-set protects simultaneous
 * interactions and cross-server attempts even across bot instances.
 */
export async function claimCardActionCooldown({ action, discordUserId, guildId, sourceId = "", now = new Date() }) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Invalid cooldown timestamp.");
  const id = cardCooldownIdentity({ action, discordUserId, guildId });
  if(achievementStart())return claimWithBonus({identity:id,sourceId:String(sourceId),now,duration:cardCooldownDuration(action)});
  const availableAt = new Date(now.getTime() + cardCooldownDuration(action));
  const advanced = await CardActionCooldown.findOneAndUpdate(
    { _id: id._id, availableAt: { $lte: now } },
    { $set: { availableAt, sourceId: String(sourceId) } },
    { returnDocument: "after" },
  ).lean();
  if (advanced) return { allowed: true, availableAt, action, scope: id.scope };
  try {
    await CardActionCooldown.create({ ...id, availableAt, sourceId: String(sourceId) });
    return { allowed: true, availableAt, action, scope: id.scope };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const existing = await CardActionCooldown.findById(id._id).select("availableAt").lean();
  if (!existing) throw new Error("Cooldown changed during an overlapping request. Try again.");
  return { allowed: false, availableAt: existing.availableAt, action, scope: id.scope };
}

export async function readCardActionCooldown({ action, discordUserId, guildId, now = new Date() }) {
  const id = cardCooldownIdentity({ action, discordUserId, guildId });
  const existing = await CardActionCooldown.findById(id._id).select("availableAt").lean();
  return {
    allowed: !existing || new Date(existing.availableAt) <= now,
    availableAt: existing?.availableAt || null,
    action, scope: id.scope,
  };
}


// A refund removes ONLY the cooldown reserved for the specified action.
// sourceId protects a later successful action from an old failed send,
// a duplicate worker pass, or a displaced/losing drop entry.
export async function releaseCardActionCooldown({ action, discordUserId, guildId, sourceId }) {
  if (!sourceId) throw new Error("A source ID is required to refund a card cooldown.");
  const id = cardCooldownIdentity({ action, discordUserId, guildId });
  if(achievementStart())return refundWithBonus(id,String(sourceId));
  const result = await CardActionCooldown.deleteOne({
    _id: id._id, sourceId: String(sourceId),
  });
  return result.deletedCount === 1;
}
