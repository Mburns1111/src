// Completed giveaways can be archived publicly without becoming cancelled.
// A submitted ticket claim must belong to the CURRENT winner of each place;
// an earlier winner's claim after a reroll does not qualify.
export function completedGiveawayCanDeleteListing(record) {
  if (!record || record.status !== "ended" || record.publicListingRemovedAt) return false;
  const winners = record.winnerIds || [];
  if (!winners.length) return true; // The draw selected nobody.
  // Older Court's Trials did not have the winner ticket form.
  if (record.mode === "survival" && !record.trialTicketClaimsEnabled) return false;
  return winners.every((userId, slot) => (record.winnerClaims || []).some(
    claim => claim.slot === slot && claim.userId === userId &&
      Boolean(String(claim.ticketNumber || "").trim()) &&
      Boolean(String(claim.ticketUrl || "").trim()) &&
      Boolean(claim.submittedAt),
  ));
}

export function completedGiveawayHasPublicPosts(record) {
  return Boolean(record?.listMessageId || record?.messageId ||
    (record?.mode === "survival" && record?.finaleMessageId));
}
