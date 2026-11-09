import Giveaway from "../models/Giveaway.js";
import { winnerClaimDeadline, nextClaimCheckAt } from "./giveaway-claims.js";

export function validateTicketClaim(number, link) {
  const ticketNumber=String(number || "").trim();
  if (!/^[a-zA-Z0-9_# -]{1,80}$/.test(ticketNumber))
    throw Error("Enter a ticket number using letters, numbers, spaces, #, - or _ (up to 80 characters).");
  const exactLink=String(link||"").trim();
  if(exactLink.length>500)throw Error("The message link cannot exceed 500 characters.");
  let url;
  try {url=new URL(exactLink);}catch {throw Error("Paste the Discord message link from your ticket.");}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=="https:" || url.username || url.password || url.port ||
    !/^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$/.test(host) ||
    !/^\/channels\/\d{17,20}\/\d{17,20}\/\d{17,20}\/?$/.test(url.pathname) ||
    url.hash || /[<>\s]/.test(exactLink))
    throw Error("Copy the Discord message link from your ticket (server/channel/message link).");
  // Keep the original link exactly, including any query parameters.
  return {ticketNumber,ticketUrl:exactLink};
}

export async function submitGiveawayTicket({id,guildId,userId,ticketNumber,ticketUrl,now=new Date()}) {
  const record=await Giveaway.findOne({_id:id,guildId,status:"ended",
    $or:[{mode:{$ne:"survival"}},{mode:"survival",trialTicketClaimsEnabled:true}]}).lean();
  if (!record) throw Error("This giveaway is not accepting ticket claims.");
  const slot=record.winnerIds.indexOf(userId);
  if (slot<0) throw Error("Only a current winner may file a ticket claim.");
  if ((record.claimResolvedSlots || []).includes(slot)) throw Error("This winning place has expired.");
  if ((record.winnerClaims || []).some(c=>c.slot===slot && c.userId===userId))
    throw Error("You have already filed a ticket claim. Contact staff to correct it.");
  const deadline=winnerClaimDeadline(record,slot);
  if (deadline && now>=deadline) throw Error("Your claim deadline has passed. The bot will process the reroll.");
  const clean=validateTicketClaim(ticketNumber,ticketUrl);
  const updated=await Giveaway.findOneAndUpdate(
    {_id:id,guildId,status:"ended",[`winnerIds.${slot}`]:userId,
      winnerClaims:{$not:{$elemMatch:{slot,userId}}},claimResolvedSlots:{$ne:slot}},
    {$push:{winnerClaims:{slot,userId,...clean,submittedAt:now}},
      $set:{renderedAt:null},$inc:{renderVersion:1}},
    {returnDocument:"after"}).lean();
  if (!updated) throw Error("The giveaway changed while you were submitting. Check its current winners.");
  await Giveaway.updateOne({_id:id,status:"ended",renderVersion:updated.renderVersion},
    {$set:{claimCheckAt:nextClaimCheckAt(updated)}});
  return updated;
}
