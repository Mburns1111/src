import { recordAchievementEvent } from "./card-achievement-engine.js";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import CardDefinition from "../models/CardDefinition.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import PetCatalog from "../models/PetCatalog.js";
import { findOwnedCardById } from "./card-owned-selection.js";
import { matchingTagRegex } from "./card-tag-catalog.js";

// Reward Normal = 1, Neon = 5, Mega Neon = 23 dust of the card rarity.
// No exchange/upgrade dust spending is unlocked by this feature.
export const BURN_STAGE_MULTIPLIERS = Object.freeze({ normal: 1, neon: 5, mega: 23 });
export const BURN_RARITIES = Object.freeze(["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"]);
export const MAX_BURN_CARDS = 50;
const MAX_PENDING = 500;
const BURN_TTL_MS = 120_000;
const pendingBurns = new Map();
const ID = /^[0-9A-Za-z_-]{5}$/;
export const BURN_TAG_NAME = "burn";
export const isBurnableCardTag = tag => !String(tag ?? "").trim() || String(tag).trim().toLocaleLowerCase() === BURN_TAG_NAME;

export function parseBurnCardReferences(raw) {
  const input = String(raw || "").trim();
  // The ONLY accepted tag selector is tag:burn, and it must stand alone.
  if (/^tag:/i.test(input)) {
    if (!/^tag:burn$/i.test(input))
      throw new Error("Only tag:burn is permitted for burning. Other tags protect cards.");
    return ["tag:burn"];
  }
  if (/tag:/i.test(input))
    throw new Error("Use .burn tag:burn on its own, or enter card IDs separately.");
  const values = input.split(/[\s,;]+/).filter(Boolean);
  if (!values.length) throw new Error("Use .burn CARDID, .burn ID1 ID2, or .burn tag:burn.");
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
  if (resolved.some(c=>c.locked)) throw new Error("A selected card is locked. Use .unlock CARDID before burning.");
  if (resolved.some(c=>!isBurnableCardTag(c.tag)))
    throw new Error("Tagged cards are protected unless their tag is burn. Use .untag CARDID first.");
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
      upgradeLevel:c.upgradeLevel||"normal", tag:String(c.tag || "").trim().toLocaleLowerCase(),
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
  const refs=parseBurnCardReferences(cardReferences);
  let ids=refs;
  if (refs.length===1 && refs[0]==="tag:burn") {
    const collector=await CardCollector.findOne({discordUserId:ownerId})
      .select("createdTagNames").lean();
    if (!(collector?.createdTagNames || []).some(t=>String(t).trim().toLocaleLowerCase()===BURN_TAG_NAME))
      throw new Error("Create the burn tag first with .createtag burn, then tag cards with .tag burn CARDID.");
    const copies=await CardCopy.find({
      ownerDiscordUserId:ownerId, state:"owned", locked:{$ne:true},tag:matchingTagRegex(BURN_TAG_NAME),
    }).select("publicId").lean();
    if (!copies.length) throw new Error("No owned cards have the burn tag.");
    if (copies.length>MAX_BURN_CARDS)
      throw new Error("You have "+copies.length+" burn-tagged cards. Burn at most "+MAX_BURN_CARDS+" at once using card IDs; no cards were selected.");
    if (copies.some(c=>!c.publicId || !ID.test(c.publicId)))
      throw new Error("A burn-tagged card has no valid five-character ID. Nothing was selected.");
    ids=copies.map(c=>c.publicId);
  }
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
            card.upgradeLevel!==item.upgradeLevel||card.locked===true||
            String(card.tag||"").trim().toLocaleLowerCase()!==item.tag||
            !isBurnableCardTag(card.tag))
          throw new Error("A selected card changed or is now tagged. Nothing was burned.");
      }
      const changes=await CardCopy.updateMany({
        _id:{$in:rows.map(c=>c._id)},ownerDiscordUserId:ownerId,state:"owned",
        tag:{$in:["",null,matchingTagRegex(BURN_TAG_NAME)]},locked:{$ne:true},
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
      })),{session,ordered:true});
      await recordAchievementEvent({id:request.operationKey,userId:ownerId,kind:"burns",cards:rows,guildId:request.guildId},session);
    });
    pendingBurns.delete(token);
    return {count:request.cards.length,dust:request.dust,cards:request.cards};
  } finally {await session.endSession();}
}
