import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import CardNumberSequence from "../models/CardNumberSequence.js";
import { prepareDustUpgrade,confirmDustUpgrade,cancelDustUpgrade } from "../services/card-dust-upgrades.js";

const owner="123456789012345678",guild="234567890123456789";
const definitionId=new mongoose.Types.ObjectId();
const id1=new mongoose.Types.ObjectId(),id2=new mongoose.Types.ObjectId();
const cards=[{_id:id1,publicId:"Abc12",ownerDiscordUserId:owner,state:"owned",
  cardDefinitionId:definitionId,upgradeLevel:"normal",locked:false},
  {_id:id2,publicId:"Def34",ownerDiscordUserId:owner,state:"owned",
  cardDefinitionId:definitionId,upgradeLevel:"normal",locked:false}];
function stubEnvironment(){
 const original={
  lookup:CardCopy.findOne,find:CardCopy.find,update:CardCopy.updateMany,
  create:CardCopy.create,exists:CardCopy.exists,def:CardDefinition.findById,
  pet:PetCatalog.findOne,wallet:CardCollector.findOne,debit:CardCollector.updateOne,
  lifecycle:CardLifecycleEvent.exists,events:CardLifecycleEvent.create,
  counter:CardNumberSequence.findOneAndUpdate,session:mongoose.startSession,
 };
 CardCopy.findOne=()=>({lean:async()=>cards[0]});
 CardCopy.find=()=>({
  sort:()=>({limit:()=>({lean:async()=>cards})}),
  session:()=>({lean:async()=>cards}),
 });
 CardDefinition.findById=()=>({select:()=>({lean:async()=>({
  _id:definitionId,petId:"cat",rarity:"Rare",releaseId:"r1",
 })})});
 PetCatalog.findOne=()=>({select:()=>({lean:async()=>({name:"Abyssinian Cat"})})});
 CardCollector.findOne=()=>({select:()=>({lean:async()=>({dust:{Rare:55}})})});
 const session={withTransaction:fn=>fn(),endSession:async()=>{}};
 mongoose.startSession=async()=>session;
 CardLifecycleEvent.exists=()=>({session:async()=>null});
 CardNumberSequence.findOneAndUpdate=async()=>({value:12});
 CardCopy.exists=()=>({session:async()=>null});
 return {session,original,restore(){
  CardCopy.findOne=original.lookup;CardCopy.find=original.find;
  CardCopy.updateMany=original.update;CardCopy.create=original.create;
  CardCopy.exists=original.exists;CardDefinition.findById=original.def;
  PetCatalog.findOne=original.pet;CardCollector.findOne=original.wallet;
  CardCollector.updateOne=original.debit;CardLifecycleEvent.exists=original.lifecycle;
  CardLifecycleEvent.create=original.events;
  CardNumberSequence.findOneAndUpdate=original.counter;
  mongoose.startSession=original.session;
 }};
}
test("dust upgrade confirmation atomically consumes two physical cards and 14 Rare Dust",async()=>{
 const env=stubEnvironment();
 try {
  const pending=await prepareDustUpgrade({ownerId:owner,guildId:guild,cardReference:"Abc12"});
  assert.equal(pending.cards.length,2);
  assert.equal(pending.cost,14);
  assert.equal(pending.missing,2);
  assert.equal(pending.available,55);
  let debits=0,consumes=0,mints=0,audits=0;
  CardCollector.updateOne=async(query,change,opts)=>{
    assert.equal(query["dust.Rare"].$gte,14);
    assert.deepEqual(change.$inc,{"dust.Rare":-14});
    assert.equal(opts.session,env.session);
    debits++;return {modifiedCount:1};
  };
  CardCopy.updateMany=async(query,change,opts)=>{
    assert.equal(query.locked.$ne,true);
    assert.equal(change.$set.state,"consumed");
    assert.equal(opts.session,env.session);
    consumes++;return {modifiedCount:2};
  };
  CardCopy.create=async(items,opts)=>{
    assert.equal(items[0].upgradeLevel,"neon");
    assert.equal(items[0].createdFrom.length,2);
    assert.equal(opts.session,env.session);
    mints++;return [{_id:new mongoose.Types.ObjectId()}];
  };
  CardLifecycleEvent.create=async(items,opts)=>{
    assert.equal(items[0].dustSpent.amount,14);
    assert.equal(items[0].dustSpent.rarity,"Rare");
    assert.equal(opts.session,env.session);
    audits++;
  };
  const result=await confirmDustUpgrade(pending.token,owner,guild);
  assert.equal(result.dustSpent,14);
  assert.equal(result.target,"neon");
  assert.equal(debits,1);assert.equal(consumes,1);
  assert.equal(mints,1);assert.equal(audits,1);
  await assert.rejects(()=>confirmDustUpgrade(pending.token,owner,guild),/expired/);
 }finally{env.restore();}
});

test("dust upgrade with insufficient balance during confirmation never consumes or creates a card",async()=>{
 const env=stubEnvironment();
 try{
  const pending=await prepareDustUpgrade({ownerId:owner,guildId:guild,cardReference:"Abc12"});
  CardCollector.updateOne=async()=>({modifiedCount:0});
  CardCopy.updateMany=async()=>{throw Error("Never consume a card without enough dust.");};
  CardCopy.create=async()=>{throw Error("Never mint a card without enough dust.");};
  await assert.rejects(()=>confirmDustUpgrade(pending.token,owner,guild),/Not enough dust/);
  cancelDustUpgrade(pending.token,owner,guild);
 }finally{env.restore();}
});
