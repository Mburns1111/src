import {automaticRerollLimit,automaticRerollsUsed,winnerClaimDeadline} from "./giveaway-claims.js";

// An ended giveaway is not a cancelled giveaway. Delete Listing is a separate
// staff action that preserves the final winners, claims, history and status.
//
// Each winner place must be *settled*. That means the CURRENT winner submitted
// a ticket claim, or its claim deadline has passed AND it has no rerolls left.
// A resolved slot also covers the case where the bot exhausted eligible entrants.
export function completedGiveawayCanDeleteListing(record,{now=new Date()}={}) {
  if (!record || record.status !== "ended" || record.publicListingRemovedAt) return false;
  const winners=record.winnerIds||[];
  if (!winners.length) return true; // The draw selected nobody.
  // Old Court's Trials were staff-managed and had no ticket-based settlement.
  if (record.mode==="survival"&&!record.trialTicketClaimsEnabled) return false;
  return winners.every((userId,slot)=>{
    const claimed=(record.winnerClaims||[]).some(claim=>
      claim.slot===slot && claim.userId===userId &&
      Boolean(String(claim.ticketNumber||"").trim()) &&
      Boolean(String(claim.ticketUrl||"").trim()) &&
      Boolean(claim.submittedAt));
    if (claimed) return true;
    const deadline=winnerClaimDeadline(record,slot);
    if (!deadline || deadline>now) return false; // Still entitled to claim.
    const resolved=(record.claimResolvedSlots||[]).includes(slot);
    const budgetExhausted=automaticRerollsUsed(record,slot)>=automaticRerollLimit(record);
    return resolved || budgetExhausted;
  });
}

export function completedGiveawayHasPublicPosts(record) {
  return Boolean(record?.listMessageId || record?.messageId ||
    (record?.mode === "survival" && record?.finaleMessageId));
}
