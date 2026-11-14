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

// Staff may settle individual prize places by cancelling them with a logged
// reason, or by confirming delivery after a valid claim. The original winner
// stays in history even when a prize has been cancelled.
export function giveawayPrizesSettled(record){
  if(!record||record.status!=="ended"||!(record.winnerIds||[]).length)return false;
  if(record.prizeDeliveredAt&&giveawayClaimsComplete(record))return true;
  if(!(record.cancelledPrizes||[]).length)return false;
  return record.winnerIds.every((userId,slot)=>
    (record.cancelledPrizes||[]).some(c=>c.slot===slot&&c.userId===userId)||
    ((record.prizeDeliveries||[]).some(d=>d.slot===slot&&d.userId===userId)&&
      (record.winnerClaims||[]).some(c=>c.slot===slot&&c.userId===userId)));
}

export function completedGiveawayCanDeleteListing(record){
  return Boolean(record && record.status==="ended"&&!record.publicListingRemovedAt&&
    giveawayPrizesSettled(record));
}

export function completedGiveawayHasPublicPosts(record) {
  return Boolean(record?.listMessageId || record?.messageId ||
    (record?.mode === "survival" && record?.finaleMessageId));
}
