import CardCopy from "../models/CardCopy.js";

// Count unique OTHER Discord accounts currently owning this exact card design.
// Multiple copies and upgrades held by one account count as one collector.
// This is global across participating servers, not a server-local count.
export async function countOtherCardCollectors({ cardDefinitionId, ownerDiscordUserId }) {
  if (!cardDefinitionId || !ownerDiscordUserId) throw new Error("Card definition and owner required");
  const owners = await CardCopy.distinct("ownerDiscordUserId", {
    cardDefinitionId,
    state: "owned",
    ownerDiscordUserId: { $ne: ownerDiscordUserId },
  });
  return owners.length;
}
