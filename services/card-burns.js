import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import CardDefinition from "../models/CardDefinition.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import PetCatalog from "../models/PetCatalog.js";
import { findOwnedCardById } from "./card-owned-selection.js";

// Provisional economy: one dust per underlying Normal card.
// No exchange/upgrade dust spending is unlocked by this feature.
export const BURN_STAGE_MULTIPLIERS = Object.freeze({ normal: 1, neon: 4, mega: 16 });
export const BURN_RARITIES = Object.freeze(["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"]);
export const MAX_BURN_CARDS = 50;
const MAX_PENDING = 500;
const BURN_TTL_MS = 120_000;
const pendingBurns = new Map();
const ID = /^[0-9A-Za-z_-]{5}$/;

export function parseBurnCardReferences(raw) {
  const values = String(raw || "").trim().split(/[\s,;]+/).filter(Boolean);
  if (!values.length) throw new Error("Use .burn CARDID or .burn ID1 ID2 to choose cards.");
  if (values.length > MAX_BURN_CARDS)
    throw new Error("Burn up to " + MAX_BURN_CARDS + " cards in one confirmation. Repeat for more.");
  if (!values.every(id => ID.test(id)))
    throw new Error("Burning requires five-character card IDs from .collection. Pet names cannot be burned in bulk.");
  if (new Set(values).size !== values.length) throw new Error("A card ID was entered twice. Remove duplicates.");
  return values;
}

export function calculateBurnDust(cards) {
  const rewards = Object.fromEntries(BURN_RARITIES.map(r=>[r,0]));
  for (const card of cards) {
    if (!BURN_RARITIES.includes(card.rarity) || !BURN_STAGE_MULTIPLIERS[card.upgradeLevel])
      throw new Error("Cannot determine the dust for a card. Contact the Hatchem owner.");
    rewards[card.rarity] += BURN_STAGE_MULTIPLIERS[card.upgradeLevel];
  }
  return Object.fromEntries(Object.entries(rewards).filter(([,n])=>n>0));
}

export async function getCardDustBalance(userId) {
  const collector = await CardCollector.findOne({discordUserId:userId}).select("dust").lean();
  return Object.fromEntries(BURN_RARITIES.map(r => [r, Number(collector?.dust?.[r] || 0)]));
}

async function ownedBurnCopies(ownerId, ids) {
  const resolved = await Promise.all(ids.map(id=>findOwnedCardById(ownerId,id)));
  if (resolved.some(c=>!c)) throw new Error("One or more card IDs do not belong to you.");
  if (new Set(resolved.map(c=>String(c._id))).size!==ids.length)
    throw new Error("The same card was selected more than once.");
  if (resolved.some(c=>c.tag?.trim()))
    throw new Error("Tagged cards are protected. Use .untag CARDID before burning them.");
  const definitions=await CardDefinition.find({
    _id:{$in:resolved.map(c=>c.cardDefinitionId)},
  }).select("_id petId rarity releaseId").lean();
  const byDef=new Map(definitions.map(x=>[String(x._id),x]));
  const petIds=definitions.map(d=>d.petId);
  const pets=await PetCatalog.find({petId:{$in:petIds}}).select("petId name").lean();
  const names=new Map(pets.map(x=>[x.petId,x.name]));
  return resolved.map(c=>{
    const def=byDef.get(String(c.cardDefinitionId));
    if(!def) throw new Error("Card definition missing; nothing burned.");
    return {
      _id:String(c._id), publicId:c.publicId,
      definitionId:String(c.cardDefinitionId), name:names.get(def.petId)||def.petId,
      releaseId:def.releaseId, rarity:def.rarity,
      upgradeLevel:c.upgradeLevel||"normal",
    };
  });
}

function prunePending(now=Date.now()) {
  for(const [token,record] of pendingBurns)
    if(record.expiresAt<=now)pendingBurns.delete(token);
  while(pendingBurns.size>=MAX_PENDING)
    pendingBurns.delete(pendingBurns.keys().next().value);
}

export async function prepareCardBurn({ownerId,guildId,cardReferences}) {
  const ids=parseBurnCardReferences(cardReferences);
  const cards=await ownedBurnCopies(ownerId,ids);
  const dust=calculateBurnDust(cards);
  prunePending();
  const token=randomBytes(18).toString("hex");
  const operationKey=randomBytes(18).toString("hex");
  const request={token,ownerId,guildId,operationKey,
    cards,dust,expiresAt:Date.now()+BURN_TTL_MS};
  pendingBurns.set(token,request);
  return request;
}

export function getPendingCardBurn(token,ownerId,guildId) {
  const request=pendingBurns.get(token);
  if(!request||request.expiresAt<=Date.now()) {
    pendingBurns.delete(token);
    throw new Error("This burn confirmation expired. Run .burn again.");
  }
  if(request.ownerId!==ownerId||request.guildId!==guildId)
    throw new Error("Only the collector who requested this burn can confirm it in this server.");
  return request;
}

export function cancelCardBurn(token,ownerId,guildId) {
  const request=getPendingCardBurn(token,ownerId,guildId);
  pendingBurns.delete(token);
  return request;
}

export async function confirmCardBurn(token,ownerId,guildId) {
  const request=getPendingCardBurn(token,ownerId,guildId);
  const session=await mongoose.startSession();
  try {
    // MongoDB transaction: mark cards burned, credit exact dust once,
    // and append one lifecycle event PER burned card, all or nothing.
    await session.withTransaction(async()=>{
      const prior=await CardLifecycleEvent.exists({operationKey:request.operationKey+":0"}).session(session);
      if(prior)throw new Error("This burn was already completed.");
      const rows=await CardCopy.find({
        _id:{$in:request.cards.map(c=>new mongoose.Types.ObjectId(c._id))},
        ownerDiscordUserId:ownerId,state:"owned",
      }).session(session).lean();
      if(rows.length!==request.cards.length)throw new Error("A card is no longer owned. Nothing was burned.");
      const byId=new Map(rows.map(c=>[String(c._id),c]));
      for(const item of request.cards) {
        const card=byId.get(item._id);
        if(!card||card.ownerDiscordUserId!==ownerId||card.state!=="owned"||
            card.publicId!==item.publicId||String(card.cardDefinitionId)!==item.definitionId||
            card.upgradeLevel!==item.upgradeLevel||card.tag?.trim())
          throw new Error("A selected card changed or is now tagged. Nothing was burned.");
      }
      const changes=await CardCopy.updateMany({
        _id:{$in:rows.map(c=>c._id)},ownerDiscordUserId:ownerId,state:"owned",
        tag:{$in:["",null]},
      },{$set:{state:"burned",consumedAt:new Date()}},{session});
      if(changes.modifiedCount!==rows.length)
        throw new Error("One or more cards changed before confirmation. Nothing was burned.");
      const increases=Object.fromEntries(Object.entries(request.dust).map(([rarity,amount])=>["dust."+rarity,amount]));
      const collector=await CardCollector.updateOne(
        {discordUserId:ownerId,registeredAt:{$ne:null}},
        {$inc:increases},{session});
      if(collector.matchedCount!==1)
        throw new Error("Register for Hatchem first. Nothing was burned.");
      await CardLifecycleEvent.create(request.cards.map((c,i)=>({
        operationKey:request.operationKey+":"+i,
        cardDefinitionId:new mongoose.Types.ObjectId(c.definitionId),
        actorDiscordUserId:ownerId,eventType:"burn",
        consumedCardCopyIds:[new mongoose.Types.ObjectId(c._id)],
      })),{session});
    });
    pendingBurns.delete(token);
    return {count:request.cards.length,dust:request.dust,cards:request.cards};
  } finally {await session.endSession();}
}
