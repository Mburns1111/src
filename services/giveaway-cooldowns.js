import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import Giveaway from "../models/Giveaway.js";

const ONE_DAY_MS=86_400_000;
export const MAX_GIVEAWAY_COOLDOWN_DAYS=365;

// Cooldowns are a separate, optional, server-wide winner restriction. Trials
// never consult them. The banned giveaway role always takes precedence.
export const giveawayUsesCooldown=record=>
  Boolean(record&&record.mode!=="survival"&&record.winnerCooldownEnabled===true);

export function cooldownExpiration(deliveredAt,days){
 if(!Number.isSafeInteger(days)||days<1||days>MAX_GIVEAWAY_COOLDOWN_DAYS)
  throw Error("Cooldown must be a whole number from 1 to 365 days.");
 const start=new Date(deliveredAt);
 if(!Number.isFinite(+start))throw Error("Prize delivery date is unavailable.");
 return new Date(+start+days*ONE_DAY_MS);
}

export async function activeGiveawayCooldownIds(guildId,userIds,{now=new Date()}={}){
 const ids=[...new Set((userIds||[]).map(String).filter(Boolean))];
 if(!ids.length)return new Set();
 const docs=await GiveawayWinnerCooldown.find({
  guildId,userId:{$in:ids},expiresAt:{$gt:now},
 }).lean();
 return new Set(docs.map(x=>String(x.userId)));
}

export async function activeCooldownFor(guildId,userId,{now=new Date()}={}){
 return GiveawayWinnerCooldown.findOne({
  guildId,userId,expiresAt:{$gt:now},
 }).lean();
}

// An active cooldown removes entries in *open, cooldown-enabled* regular
// giveaways. It never removes entries in an OFF giveaway or edits activity
// participation, which is qualified and filtered at the draw instead.
export async function removeActiveCooldownEntries(guildId,userIds,{now=new Date()}={}){
 const ids=[...new Set((userIds||[]).map(String).filter(Boolean))];
 if(!ids.length)return 0;
 const result=await Giveaway.updateMany({
   guildId,mode:"standard",status:"open",endsAt:{$gt:now},
   winnerCooldownEnabled:true,entrantIds:{$in:ids},
 },{$pull:{entrantIds:{$in:ids}}});
 return result.modifiedCount||0;
}

export async function applyGiveawayWinnerCooldown({
 guildId,userId,sourceGiveawayId,deliveredAt,staffId,days,now=new Date(),
}){
 if(!guildId||!userId||!sourceGiveawayId||!staffId)
  throw Error("A server, winner, giveaway and moderator are required.");
 const requestedExpiresAt=cooldownExpiration(deliveredAt,days);
 if(requestedExpiresAt<=now)
  throw Error("This cooldown would already be expired. Choose a longer duration or do not apply it.");
 // $max ensures two concurrent staff requests cannot shorten each other's
 // longer cooldown. A repeated submission is auditable, never a shorter ban.
 const record=await GiveawayWinnerCooldown.findOneAndUpdate(
  {guildId,userId},
  {$max:{expiresAt:requestedExpiresAt},
   $set:{sourceGiveawayId:String(sourceGiveawayId),days,appliedBy:staffId,
     appliedAt:now,removedAt:null,removedBy:""},
   $push:{history:{action:"apply",at:now,staffId,
     sourceGiveawayId:String(sourceGiveawayId),days,requestedExpiresAt}}},
  {upsert:true,new:true,runValidators:true}).lean();
 return {record,requestedExpiresAt,expiresAt:record.expiresAt,
  extended:+new Date(record.expiresAt)===+requestedExpiresAt};
}

// Explicit moderator correction. Unlike automatic $max application, this
// intentionally permits shortening an entry entered with the wrong duration.
export async function adjustGiveawayWinnerCooldown({
 guildId,userId,staffId,daysRemaining,now=new Date(),
}){
 if(!guildId||!userId||!staffId)throw Error("Missing server, member or moderator.");
 if(!Number.isSafeInteger(daysRemaining)||daysRemaining<1||daysRemaining>365)
  throw Error("Remaining days must be between 1 and 365.");
 const expiresAt=new Date(+now+daysRemaining*ONE_DAY_MS);
 return GiveawayWinnerCooldown.findOneAndUpdate({
  guildId,userId,expiresAt:{$gt:now},
 },{$set:{expiresAt,removedAt:null,removedBy:""},
   $push:{history:{action:"adjust",at:now,staffId,days:daysRemaining,
    requestedExpiresAt:expiresAt}}},
  {new:true}).lean();
}

export async function removeGiveawayWinnerCooldown({
 guildId,userId,staffId,now=new Date(),
}){
 if(!guildId||!userId||!staffId)throw Error("Missing server, member or moderator.");
 const result=await GiveawayWinnerCooldown.findOneAndUpdate(
  {guildId,userId,expiresAt:{$gt:now}},
  {$set:{expiresAt:now,removedAt:now,removedBy:staffId},
   $push:{history:{action:"remove",at:now,staffId}}},
  {new:true}).lean();
 return Boolean(result);
}
