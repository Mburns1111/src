import mongoose from "mongoose";
import CardActionCooldown from "../models/CardActionCooldown.js";
import CardCollector from "../models/CardCollector.js";
import {CardBonusUse,AchievementControl} from "../models/CardAchievementState.js";

export async function claimWithBonus({identity,sourceId,now,duration}){
 if(!sourceId)throw Error("A source ID is required for bonus actions.");
 const session=await mongoose.startSession();
 try{return await session.withTransaction(async()=>{
  await AchievementControl.updateOne({_id:"clock"},{$inc:{sequence:1}},{session});
  const existing=await CardActionCooldown.findById(identity._id).session(session).lean();
  const useId=JSON.stringify([identity.action,identity.discordUserId,sourceId]);
  const prior=await CardBonusUse.findById(useId).session(session).lean();
  if((prior&&!prior.refundedAt)||existing?.sourceId===sourceId)
   return {allowed:false,availableAt:existing?.availableAt,action:identity.action,scope:identity.scope};
  const availableAt=new Date(now.getTime()+duration);
  if(!existing||new Date(existing.availableAt)<=now){
   await CardActionCooldown.updateOne({_id:identity._id},{$set:{...identity,sourceId,availableAt}},{upsert:true,session});
   return {allowed:true,availableAt,action:identity.action,scope:identity.scope,bonus:false};
  }
  const field=identity.action==="grab"?"bonusGrabs":"bonusDrops";
  const debit=await CardCollector.updateOne({discordUserId:identity.discordUserId,[field]:{$gte:1}},{$inc:{[field]:-1}},{session});
  if(!debit.modifiedCount)return {allowed:false,availableAt:existing.availableAt,action:identity.action,scope:identity.scope};
  await CardBonusUse.updateOne({_id:useId},{$set:{userId:identity.discordUserId,action:identity.action,sourceId,refundedAt:null}},{upsert:true,session});
  return {allowed:true,availableAt:existing.availableAt,action:identity.action,scope:identity.scope,bonus:true};
 });}finally{await session.endSession();}
}
export async function refundWithBonus(identity,sourceId){
 const session=await mongoose.startSession();
 try{return await session.withTransaction(async()=>{
  await AchievementControl.updateOne({_id:"clock"},{$inc:{sequence:1}},{session});
  const useId=JSON.stringify([identity.action,identity.discordUserId,sourceId]);
  const refunded=await CardBonusUse.updateOne({_id:useId,refundedAt:null},{$set:{refundedAt:new Date()}},{session});
  if(refunded.modifiedCount)await CardCollector.updateOne({discordUserId:identity.discordUserId},{$inc:{[identity.action==="grab"?"bonusGrabs":"bonusDrops"]:1}},{session});
  const normal=await CardActionCooldown.deleteOne({_id:identity._id,sourceId},{session});
  return Boolean(refunded.modifiedCount||normal.deletedCount);
 });}finally{await session.endSession();}
}
