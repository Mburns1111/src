import Giveaway from "../models/Giveaway.js";
import { chooseGiveawayWinners, rerollGiveaway, publishGiveawayResult } from "./giveaways.js";
import { winnerClaimDeadline, winnerHasClaim, nextClaimCheckAt } from "./giveaway-claims.js";

// Reroll only when automatic enforcement was explicitly enabled on the giveaway.
// Older records with informational claim windows are never retroactively rerolled.
export async function reconcileGiveawayClaims(client, {now=new Date(),limit=30}={}) {
  const records=await Giveaway.find({
    status:"ended",mode:{$in:["standard","activity"]},
    autoRerollClaims:true,claimCheckAt:{$lte:now,$ne:null},
  }).sort({claimCheckAt:1}).limit(limit).lean();
  for (const candidate of records) {
    try {
      let latest=candidate;
      for (let slot=0;slot<(latest.winnerIds || []).length;slot++) {
        const deadline=winnerClaimDeadline(latest,slot);
        if (!deadline || deadline>now || winnerHasClaim(latest,slot) ||
            (latest.claimResolvedSlots || []).includes(slot)) continue;
        const prior=[...latest.winnerIds,...(latest.rerollHistory || []).flatMap(x=>[x.previousId,x.replacementId])];
        const pool=latest.mode==="activity" ? latest.activityVerifiedIds||[] : latest.entrantIds||[];
        if (!chooseGiveawayWinners(pool,1,prior).length) {
          await Giveaway.updateOne(
            {_id:latest._id,status:"ended",[`winnerIds.${slot}`]:latest.winnerIds[slot]},
            {$addToSet:{claimResolvedSlots:slot},$set:{renderedAt:null},$inc:{renderVersion:1}});
        } else {
          latest=await rerollGiveaway({id:latest._id,guildId:latest.guildId,staffId:"bot",slot,
            reason:"claim-expired",now});
        }
        latest=await Giveaway.findById(latest._id).lean();
        if (!latest || latest.status!=="ended") break;
      }
      if (latest?.status==="ended") {
        await Giveaway.updateOne({_id:latest._id,status:"ended",renderVersion:latest.renderVersion},
          {$set:{claimCheckAt:nextClaimCheckAt(latest)}});
        await publishGiveawayResult(client,latest);
      }
    } catch(error) {
      console.error("[Giveaways] Claim deadline sweep failed:",String(candidate._id),error);
    }
  }
  return records.length;
}
