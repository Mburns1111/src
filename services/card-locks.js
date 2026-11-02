import { recordAchievementEvent, achievementStart } from "./card-achievement-engine.js";
import {randomUUID} from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import { findOwnedCardById } from "./card-owned-selection.js";

export async function setCardLock({ownerId,cardId,locked}) {
  const selected=await findOwnedCardById(ownerId,cardId);
  if(!selected)throw Error("That card is not in your collection.");
  if(Boolean(selected.locked)===locked)
    return {publicId:selected.publicId,locked,unchanged:true};
  const operationId=randomUUID();
  const session=achievementStart()?await mongoose.startSession():null;
  try {
  const run=async()=>{
  const result=await CardCopy.updateOne({
    _id:selected._id,ownerDiscordUserId:ownerId,state:"owned",
    locked: locked?{$ne:true}:true,
  },{$set:{locked} },session?{session}:{});
  if(result.modifiedCount!==1)
    throw Error("Card changed since you requested this lock. Check your collection and try again.");
  if(locked&&session)await recordAchievementEvent({id:"lock:"+operationId,userId:ownerId,kind:"locks",cards:[selected],guildId:selected.originGuildId},session);
  return {publicId:selected.publicId,locked,unchanged:false};
  };
  return session?await session.withTransaction(run):await run();
  } finally {if(session)await session.endSession();}
}
