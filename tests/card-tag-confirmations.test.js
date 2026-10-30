import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import CardCollector from "../models/CardCollector.js";
import {
  prepareCardTagConfirmation, getCardTagConfirmation,
  cancelCardTagConfirmation, confirmCardTagChange,
} from "../services/card-tag-confirmations.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { data as cardCommand } from "../commands/cards.js";

const owner = "123456789012345678", outsider = "234567890123456789";

test("collection cute is a tag filter and card display is called view", () => {
  assert.deepEqual(parseHatchemText(".collection cute"), {
    action:"collection", options:{ member:"", tag:"cute" },
  });
  assert.deepEqual(parseHatchemText(".collection <@123456789012345678> cute"), {
    action:"collection", options:{ member:"<@123456789012345678>", tag:"cute" },
  });
  assert.equal(parseHatchemText(".view KxQOo").action, "view");
  assert.equal(parseHatchemText(".preview KxQOo"), null);
  assert.equal(cardCommand.toJSON().options.find(o=>o.name==="view").name,"view");
  const collection = cardCommand.toJSON().options.find(o=>o.name==="collection");
  assert.ok(collection.options.some(o => o.name === "tag"));
});

test("untag confirmation shows exact affected count and rejects other users", async () => {
  const PetCatalog = (await import("../models/PetCatalog.js")).default;
  const old = {
    findOne: CardCopy.findOne, copies: CardCopy.find,
    definitions: CardDefinition.find, byId: CardDefinition.findById,
    releases: CardRelease.find, pet: PetCatalog.findOne,
  };
  const id = new mongoose.Types.ObjectId();
  const definitionId = new mongoose.Types.ObjectId();
  try {
    CardCopy.findOne = query => {
      assert.equal(query.ownerDiscordUserId, owner);
      return { lean: async()=> ({
        _id:id, cardDefinitionId:definitionId,
        publicId:"KxQOo", upgradeLevel:"neon", tag:"cute",
      }) };
    };
    CardDefinition.findById = () => ({ select:()=>({ lean:async()=>({ petId:"2d-doggy" }) }) });
    CardDefinition.find = () => ({ select:()=>({ lean:async()=>[
      { _id:definitionId, petId:"2d-doggy", releaseId:"test-s1-r1" },
    ] }) });
    PetCatalog.findOne = () => ({ select:()=>({ lean:async()=>({ name:"2D Doggy" }) }) });
    CardCopy.find = () => ({ lean:async()=>[
      { _id:id, cardDefinitionId:definitionId, publicId:"KxQOo", upgradeLevel:"neon", tag:"cute" },
    ] });
    CardRelease.find = () => ({ select:()=>({ lean:async()=>[] }) });
    const request = await prepareCardTagConfirmation({
      discordUserId:owner, cardId:"KxQOo", tag:null,
    });
    assert.equal(request.cards.length,1);
    assert.equal(request.affected,1);
    assert.equal(request.tag,"");
    assert.throws(()=>getCardTagConfirmation(request.token, outsider), /Only the member/);
    const cancelled = cancelCardTagConfirmation(request.token, owner);
    assert.equal(cancelled.token, request.token);
    assert.throws(()=>getCardTagConfirmation(request.token, owner), /expired/);
  } finally {
    CardCopy.findOne=old.findOne; CardCopy.find=old.copies;
    CardDefinition.find=old.definitions; CardDefinition.findById=old.byId;
    CardRelease.find=old.releases; PetCatalog.findOne=old.pet;
  }
});

test("confirmed tag change checks original tag values and only changes chosen IDs", async () => {
  const a = new mongoose.Types.ObjectId(), b = new mongoose.Types.ObjectId();
  const definitionId = new mongoose.Types.ObjectId();
  const old = {
    one:CardCopy.findOne, find:CardCopy.find, distinct:CardCopy.distinct,
    definitions:CardDefinition.find, byId:CardDefinition.findById,
    releases:CardRelease.find, pet: (await import("../models/PetCatalog.js")).default.find,
    petOne:(await import("../models/PetCatalog.js")).default.findOne,
    update:CardCopy.updateMany, collector:CardCollector.updateOne,
    session:mongoose.startSession,
  };
  const PetCatalog = (await import("../models/PetCatalog.js")).default;
  const def = { _id:definitionId, petId:"2d-doggy", releaseId:"test-s1-r1" };
  try {
    PetCatalog.find = () => ({ select:()=>({ limit:()=>({ lean:async()=>[{ petId:"2d-doggy", name:"2D Doggy" }] }) }) });
    PetCatalog.findOne = () => ({ select:()=>({ lean:async()=>({ name:"2D Doggy" }) }) });
    CardDefinition.findById = () => ({ select:()=>({ lean:async()=>def }) });
    CardDefinition.find = () => ({ select:()=>({ lean:async()=>[def] }) });
    CardCopy.distinct=async()=>[definitionId];
    CardCopy.findOne = () => ({ sort:()=>({ lean:async()=>({
      _id:b, publicId:"Bbbbb", cardDefinitionId:definitionId,
      upgradeLevel:"neon", tag:"cute",
    }) }) });
    let stage = "preparation";
    CardCopy.find = query => {
      if(stage==="preparation")return { lean:async()=>[
        { _id:a, publicId:"Aaaaa", cardDefinitionId:definitionId, upgradeLevel:"normal", tag:"cute" },
        { _id:b, publicId:"Bbbbb", cardDefinitionId:definitionId, upgradeLevel:"neon", tag:"cute" },
      ] };
      assert.deepEqual(query._id.$in.map(String),[String(a)]);
      return { session:()=>({ lean:async()=>[
        { _id:a, cardDefinitionId:definitionId, tag:"cute" },
      ] }) };
    };
    CardRelease.find=()=>({ select:()=>({ lean:async()=>[{ releaseId:"test-s1-r1", cardFrameKey:"sparkles" }] }) });
    const request = await prepareCardTagConfirmation({ discordUserId:owner, cardId:"2d do", tag:null });
    assert.equal(request.cards.length,2);
    assert.equal(request.affected,2);
    assert.equal(request.cards[0].frame,"sparkles");
    stage="confirmation";
    let changed=0;
    mongoose.startSession=async()=>({
      withTransaction:async fn=>fn(), endSession:async()=>{},
    });
    CardCopy.updateMany=async(query,update)=>{
      assert.equal(query.ownerDiscordUserId, owner);
      assert.deepEqual(query._id.$in.map(String), [String(a)]);
      assert.equal(update.$set.tag,"");
      changed++;
      return { matchedCount:1, modifiedCount:1 };
    };
    CardCollector.updateOne=async()=>{ throw Error("Untag must not delete a saved tag"); };
    const result=await confirmCardTagChange({
      token:request.token, ownerId:owner, selectedId:String(a),
    });
    assert.equal(result.count,1);
    assert.equal(result.changed,1);
    assert.equal(changed,1);
    assert.throws(()=>getCardTagConfirmation(request.token,owner),/expired/);
  } finally {
    CardCopy.findOne=old.one;CardCopy.find=old.find;CardCopy.distinct=old.distinct;
    CardDefinition.find=old.definitions;CardDefinition.findById=old.byId;
    CardRelease.find=old.releases;PetCatalog.find=old.pet;PetCatalog.findOne=old.petOne;
    CardCopy.updateMany=old.update;CardCollector.updateOne=old.collector;
    mongoose.startSession=old.session;
  }
});


test("when a selected ID has other owned pet variants, prompt for only ID or all copies", async () => {
  const PetCatalog = (await import("../models/PetCatalog.js")).default;
  const primary = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
  const definitionId = new mongoose.Types.ObjectId();
  const original = {
    one:CardCopy.findOne, many:CardCopy.find,
    def:CardDefinition.find, byId:CardDefinition.findById,
    pet:PetCatalog.findOne, releases:CardRelease.find, collector:CardCollector.findOne,
  };
  try {
    CardCollector.findOne = () => ({select:()=>({lean:async()=>({tagNames:["cute"]})})});
    CardCopy.findOne = () => ({ lean:async()=>({
      _id:primary, publicId:"KxQOo", cardDefinitionId:definitionId, upgradeLevel:"neon", tag:"",
    }) });
    CardDefinition.findById = () => ({ select:()=>({ lean:async()=>({petId:"2d-doggy"}) }) });
    CardDefinition.find = () => ({ select:()=>({ lean:async()=>[
      {_id:definitionId, petId:"2d-doggy", releaseId:"test-s1-r1"},
    ] }) });
    PetCatalog.findOne = () => ({ select:()=>({ lean:async()=>({name:"2D Doggy"}) }) });
    CardCopy.find = () => ({ lean:async()=>[
      {_id:primary, publicId:"KxQOo", cardDefinitionId:definitionId, upgradeLevel:"neon",tag:""},
      {_id:other, publicId:"AbCde", cardDefinitionId:definitionId, upgradeLevel:"normal",tag:""},
    ] });
    CardRelease.find = () => ({ select:()=>({ lean:async()=>[
      {releaseId:"test-s1-r1",cardFrameKey:"star-frame"},
    ] }) });
    const request = await prepareCardTagConfirmation({
      discordUserId:owner,cardId:"KxQOo",tag:"CuTe",
    });
    assert.equal(request.mode, "id-choice");
    assert.equal(request.preferredId, String(primary));
    assert.equal(request.cards.length, 2);
    assert.equal(request.cards[0].frame, "star-frame");
    assert.equal(request.affected, 2);
    cancelCardTagConfirmation(request.token, owner);
  } finally {
    CardCopy.findOne=original.one;CardCopy.find=original.many;
    CardDefinition.find=original.def;CardDefinition.findById=original.byId;
    PetCatalog.findOne=original.pet;CardRelease.find=original.releases;
    CardCollector.findOne=original.collector;
  }
});

test("bulk untag also prepares a confirmation with the total number of affected IDs", async () => {
  const x = new mongoose.Types.ObjectId(), y = new mongoose.Types.ObjectId();
  const definitionId = new mongoose.Types.ObjectId();
  const original = { copy:CardCopy.findOne, def:CardDefinition.find, releases:CardRelease.find };
  try {
    CardCopy.findOne = query => ({ lean:async()=>({
      _id:query.publicId==="Abc12"?x:y, publicId:query.publicId,
      cardDefinitionId:definitionId, upgradeLevel:"normal", tag:"cute",
    }) });
    CardDefinition.find = () => ({ select:()=>({ lean:async()=>[] }) });
    CardRelease.find = () => ({ select:()=>({ lean:async()=>[] }) });
    const request = await prepareCardTagConfirmation({
      discordUserId:owner,cardIds:"Abc12, Def34", tag:null,
    });
    assert.equal(request.mode,"ids");
    assert.equal(request.cards.length,2);
    assert.equal(request.affected,2);
    cancelCardTagConfirmation(request.token, owner);
  } finally {
    CardCopy.findOne=original.copy;CardDefinition.find=original.def;
    CardRelease.find=original.releases;
  }
});
