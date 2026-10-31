import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardCollector from "../models/CardCollector.js";
import PetCatalog from "../models/PetCatalog.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import { allocateCardId } from "./card-identifiers.js";
import { findOwnedCardById } from "./card-owned-selection.js";

export const DUST_UPGRADE_COSTS=Object.freeze({
  Common:5,Uncommon:6,Rare:7,"Ultra-Rare":8,Legendary:10,
});
const TTL=90_000;
const pending=new Map();

export function calculateDustUpgrade({rarity,stage,cardCount}) {
  if(!Object.hasOwn(DUST_UPGRADE_COSTS,rarity))throw Error("This card's rarity has no dust upgrade cost.");
  if(!["normal","neon"].includes(stage))throw Error("Only Normal and Neon cards can be upgraded.");
  if(!Number.isInteger(cardCount)||cardCount<1||cardCount>3)
    throw Error("Dust upgrades need 1–3 matching physical cards. Use .upgrade with four cards.");
  const missing=4-cardCount;
  // A Neon is created from four Normals; one missing Neon therefore costs
  // five times the Normal replacement amount. All spending uses SAME rarity.
  const cost=missing*DUST_UPGRADE_COSTS[rarity]*(stage==="neon"?5:1);
  return {missing,cost,target:stage==="normal"?"neon":"mega"};
}

export async function prepareDustUpgrade({ownerId,guildId,cardReference}) {
  const anchor=await findOwnedCardById(ownerId,cardReference);
  if(!anchor)throw Error("Use a five-character ID of a card you own.");
  if(anchor.locked)throw Error("Unlock that card before upgrading.");
  if(anchor.upgradeLevel==="mega")throw Error("Mega Neon cannot be upgraded further.");
  const copies=await CardCopy.find({
    ownerDiscordUserId:ownerId,state:"owned",locked:{$ne:true},
    cardDefinitionId:anchor.cardDefinitionId,upgradeLevel:anchor.upgradeLevel,
  }).sort({createdAt:1,_id:1}).limit(4).lean();
  const matching=[anchor,...copies.filter(c=>String(c._id)!==String(anchor._id))].slice(0,4);
  if(matching.length>=4)throw Error("You have four matching cards! Use .upgrade CARDID without spending dust.");
  if(matching.some(c=>c.locked))throw Error("Unlock the cards before upgrading.");
  const def=await CardDefinition.findById(anchor.cardDefinitionId).select("petId rarity releaseId").lean();
  if(!def)throw Error("Card definition unavailable.");
  const quote=calculateDustUpgrade({rarity:def.rarity,stage:anchor.upgradeLevel,cardCount:matching.length});
  const collector=await CardCollector.findOne({discordUserId:ownerId}).select("dust").lean();
  const available=Number(collector?.dust?.[def.rarity]||0);
  if(available<quote.cost)
    throw Error("Not enough "+def.rarity+" Dust. Need "+quote.cost+", have "+available+".");
  const pet=await PetCatalog.findOne({petId:def.petId}).select("name").lean();
  for(const [key,val] of pending)if(val.expiresAt<=Date.now())pending.delete(key);
  const token=randomBytes(12).toString("hex");
  const entry={token,operationKey:randomBytes(16).toString("hex"),
    ownerId,guildId,definitionId:String(def._id),rarity:def.rarity,
    stage:anchor.upgradeLevel,petName:pet?.name||def.petId,releaseId:def.releaseId,
    cards:matching.map(c=>({id:String(c._id),publicId:c.publicId})),
    ...quote,available,expiresAt:Date.now()+TTL};
  pending.set(token,entry);
  return entry;
}
export function getPendingDustUpgrade(token,ownerId,guildId) {
  const entry=pending.get(token);
  if(!entry||entry.expiresAt<=Date.now()){
    pending.delete(token);throw Error("Dust upgrade expired. Start a new .dustupgrade.");
  }
  if(entry.ownerId!==ownerId||entry.guildId!==guildId)
    throw Error("Only the collector can confirm this dust upgrade.");
  return entry;
}
export function cancelDustUpgrade(token,ownerId,guildId) {
  getPendingDustUpgrade(token,ownerId,guildId);pending.delete(token);
}
export async function confirmDustUpgrade(token,ownerId,guildId) {
  const entry=getPendingDustUpgrade(token,ownerId,guildId);
  const session=await mongoose.startSession();
  try{
    let output;
    await session.withTransaction(async()=>{
      if(await CardLifecycleEvent.exists({operationKey:entry.operationKey}).session(session))
        throw Error("This upgrade was already completed.");
      const copyIds=entry.cards.map(c=>new mongoose.Types.ObjectId(c.id));
      const cards=await CardCopy.find({
        _id:{$in:copyIds},ownerDiscordUserId:ownerId,state:"owned",locked:{$ne:true},
        cardDefinitionId:new mongoose.Types.ObjectId(entry.definitionId),
        upgradeLevel:entry.stage,
      }).session(session).lean();
      if(cards.length!==entry.cards.length)throw Error("A card was locked, traded or consumed. No dust spent.");
      const known=new Map(entry.cards.map(c=>[c.id,c.publicId]));
      if(cards.some(c=>known.get(String(c._id))!==c.publicId))
        throw Error("Your selected cards changed. No dust spent.");
      // Use conditional atomic debit to prevent insufficient funds or double spending.
      const wallet=await CardCollector.updateOne({
        discordUserId:ownerId,
        ["dust."+entry.rarity]:{$gte:entry.cost},
      },{$inc:{["dust."+entry.rarity]:-entry.cost}},{session});
      if(wallet.modifiedCount!==1)throw Error("Not enough dust at confirmation. Nothing was upgraded.");
      const consumed=await CardCopy.updateMany({
        _id:{$in:copyIds},ownerDiscordUserId:ownerId,
        state:"owned",locked:{$ne:true},upgradeLevel:entry.stage,
        cardDefinitionId:new mongoose.Types.ObjectId(entry.definitionId),
      },{$set:{state:"consumed",consumedAt:new Date()}},{session});
      if(consumed.modifiedCount!==cards.length)throw Error("A selected card changed. No dust was spent.");
      const publicId=await allocateCardId(session);
      const [created]=await CardCopy.create([{
        publicId,cardDefinitionId:new mongoose.Types.ObjectId(entry.definitionId),
        ownerDiscordUserId:ownerId,originGuildId:guildId,upgradeLevel:entry.target,
        state:"owned",source:"upgrade",createdFrom:cards.map(c=>c._id),
      }],{session});
      await CardLifecycleEvent.create([{
        operationKey:entry.operationKey,
        cardDefinitionId:new mongoose.Types.ObjectId(entry.definitionId),
        actorDiscordUserId:ownerId,eventType:"upgrade",targetUpgradeLevel:entry.target,
        consumedCardCopyIds:cards.map(c=>c._id),resultCardCopyId:created._id,
        dustSpent:{rarity:entry.rarity,amount:entry.cost},
      }],{session});
      output={publicId,target:entry.target,petName:entry.petName,
        consumedIds:entry.cards.map(c=>c.publicId),dustSpent:entry.cost,rarity:entry.rarity};
    });
    pending.delete(token);
    return output;
  }finally{await session.endSession();}
}
