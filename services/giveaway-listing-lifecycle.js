// Staff may archive a finished prize giveaway only after *all* current
// winners have claimed and staff have separately confirmed prize delivery.
// A missed claim, forfeited place or undelivered prize must use cancellation,
// not the completed/archive workflow. Previously finished records remain intact.

export function giveawayClaimsComplete(record) {
  if (!record || record.status !== "ended") return false;
  const winners=(record.winnerIds||[]).filter(Boolean);
  if (!winners.length) return false;
  // Pre-ticket legacy Trials were coordinated manually by staff.
  if(record.mode==="survival"&&!record.trialTicketClaimsEnabled) return true;
  return (record.winnerIds||[]).every((userId,slot)=>
    Boolean(userId) &&
    !(record.claimResolvedSlots||[]).includes(slot) &&
    (record.winnerClaims||[]).some(claim=>
      claim.slot===slot && claim.userId===userId &&
      Boolean(String(claim.ticketNumber||"").trim()) &&
      Boolean(String(claim.ticketUrl||"").trim()) &&
      Boolean(claim.submittedAt)));
}

export function completedGiveawayCanDeleteListing(record) {
  return Boolean(record && record.status==="ended" && !record.publicListingRemovedAt &&
    record.prizeDeliveredAt && giveawayClaimsComplete(record));
}

export function completedGiveawayHasPublicPosts(record) {
  return Boolean(record?.listMessageId || record?.messageId ||
    (record?.mode === "survival" && record?.finaleMessageId));
}
