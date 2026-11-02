import test from "node:test";
import assert from "node:assert/strict";
import CardCopy from "../models/CardCopy.js";
import CardCollector from "../models/CardCollector.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { updateOwnedCardTag } from "../services/card-collection-summary.js";
import { createCollectorTag } from "../services/card-tag-catalog.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";

test("uncreated tag cannot alter newest owned card; creating it then tagging targets the same newest card", async () => {
 const before={copy:CardCopy.findOne,update:CardCopy.updateMany,collector:CardCollector.findOne,
   create:CardCollector.updateOne,def:CardDefinition.findById,pet:PetCatalog.findOne};
 const newest={_id:"newest",publicId:"Abc12",cardDefinitionId:"definition",tag:"",state:"owned"};
 let explicitlyCreated=false,writes=0;
 try {
  CardCopy.findOne=()=>({sort:()=>({lean:async()=>({...newest})})});
  CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:explicitlyCreated?["random"]:[]})})});
  CardCollector.updateOne=async (_q,change)=>{
    assert.equal(change.$addToSet.createdTagNames,"random");explicitlyCreated=true;
  };
  CardCopy.updateMany=async (query,change)=>{
    assert.deepEqual(query._id.$in,["newest"]);
    assert.equal(change.$set.tag,"random");
    writes++;
    return {matchedCount:1,modifiedCount:1};
  };
  CardDefinition.findById=()=>({select:()=>({lean:async()=>({petId:"kitty",rarity:"Rare"})})});
  PetCatalog.findOne=()=>({select:()=>({lean:async()=>({name:"Kitty"})})});
  await assert.rejects(()=>updateOwnedCardTag({discordUserId:"owner",cardId:null,tag:"random"}),/Create it first/);
  assert.equal(writes,0,"no card was tagged for an unknown tag");
  assert.deepEqual(parseHatchemText(".createtag random"),
    {action:"create-tag",options:{tag:"random"}});
  await createCollectorTag("owner","random");
  const result=await updateOwnedCardTag({discordUserId:"owner",cardId:null,tag:"random"});
  assert.equal(result.id,"Abc12");
  assert.equal(writes,1);
 }finally {
  CardCopy.findOne=before.copy;CardCopy.updateMany=before.update;
  CardCollector.findOne=before.collector;CardCollector.updateOne=before.create;
  CardDefinition.findById=before.def;PetCatalog.findOne=before.pet;
 }
});

test("hyphen-free dot commands work and older spellings remain aliases",()=>{
 for(const [newer,older,action] of [
  [".createtag cute",".create-tag cute","create-tag"],
  [".tagmultiple cute Abc12 Def34",".tag-multiple cute Abc12 Def34","tag-multiple"],
  [".untagmultiple Abc12 Def34",".untag-multiple Abc12 Def34","untag-multiple"],
  [".deletetag cute",".delete-tag cute","delete-tag"],
 ]) {
  assert.equal(parseHatchemText(newer).action,action);
  assert.deepEqual(parseHatchemText(newer),parseHatchemText(older));
 }
});
