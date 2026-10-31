import CardCopy from "../models/CardCopy.js";
import { findOwnedCardById } from "./card-owned-selection.js";

export async function setCardLock({ownerId,cardId,locked}) {
  const selected=await findOwnedCardById(ownerId,cardId);
  if(!selected)throw Error("That card is not in your collection.");
  if(Boolean(selected.locked)===locked)
    return {publicId:selected.publicId,locked,unchanged:true};
  const result=await CardCopy.updateOne({
    _id:selected._id,ownerDiscordUserId:ownerId,state:"owned",
    locked: locked?true:{$ne:true},
  },{$set:{locked} });
  if(result.modifiedCount!==1)
    throw Error("Card changed since you requested this lock. Check your collection and try again.");
  return {publicId:selected.publicId,locked,unchanged:false};
}
