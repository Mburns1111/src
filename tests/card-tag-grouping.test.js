import test from "node:test";
import assert from "node:assert/strict";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import CardCollector from "../models/CardCollector.js";
import PetCatalog from "../models/PetCatalog.js";
import { selectOwnedTagTargets } from "../services/card-tag-targets.js";
import { updateOwnedCardTag } from "../services/card-collection-summary.js";

test("pet name with spaces targets ALL owned copies across releases and stages", async () => {
  const originals = {
    copyOne: CardCopy.findOne, copyFind: CardCopy.find,
    distinct: CardCopy.distinct, update: CardCopy.updateMany,
    defFind: CardDefinition.find, defById: CardDefinition.findById,
    petFind: PetCatalog.find, petOne: PetCatalog.findOne,
    collectorUpdate: CardCollector.updateOne, collectorFind: CardCollector.findOne,
  };
  try {
    CardCollector.findOne = () => ({ select:()=>({lean:async()=>({tagNames:["cute"]})}) });
    PetCatalog.find = query => {
      assert.ok(query.name.test("2D Doggy"));
      return { select: () => ({ limit: () => ({ lean: async () => [
        { petId:"2d-doggy", name:"2D Doggy" },
      ] }) }) };
    };
    CardDefinition.find = query => ({
      select: () => ({ lean: async () => (
        query.petId?.$in ?
          [{ _id:"d1", petId:"2d-doggy" }] :
          [{ _id:"d1", petId:"2d-doggy" }, { _id:"d2", petId:"2d-doggy" }]
      ) }),
    });
    CardCopy.distinct = async () => ["d1"];
    CardCopy.findOne = query => {
      assert.equal(query.ownerDiscordUserId, "owner");
      return { sort: () => ({ lean: async () => ({ _id:"newest", cardDefinitionId:"d1", publicId:"KxQOo" }) }) };
    };
    CardDefinition.findById = () => ({
      select: () => ({ lean: async () => ({ petId:"2d-doggy", rarity:"Legendary" }) }),
    });
    PetCatalog.findOne = () => ({ select: () => ({ lean: async () => ({ name:"2D Doggy" }) }) });
    CardCopy.find = query => {
      assert.deepEqual(query.cardDefinitionId.$in, ["d1", "d2"]);
      return { lean: async () => [
        { _id:"id-1", cardDefinitionId:"d1", publicId:"KxQOo", upgradeLevel:"neon" },
        { _id:"id-2", cardDefinitionId:"d2", publicId:"Abc12", upgradeLevel:"normal" },
      ] };
    };
    const targets = await selectOwnedTagTargets("owner", "2d do");
    assert.equal(targets.mode, "pet");
    assert.equal(targets.cards.length, 2);
    CardCopy.updateMany = async (query, update) => {
      assert.deepEqual(query._id.$in, ["id-1", "id-2"]);
      assert.equal(update.$set.tag, "cute");
      return { matchedCount:2, modifiedCount:2 };
    };
    CardCollector.updateOne = async () => ({});
    const result = await updateOwnedCardTag({ discordUserId:"owner", cardId:"2d do", tag:"CuTe" });
    assert.equal(result.mode, "pet");
    assert.equal(result.name, "2D Doggy");
    assert.equal(result.count, 2);
    assert.equal(result.changed, 2);
    assert.equal(result.tag, "cute");
  } finally {
    CardCopy.findOne = originals.copyOne; CardCopy.find = originals.copyFind;
    CardCopy.distinct = originals.distinct; CardCopy.updateMany = originals.update;
    CardDefinition.find = originals.defFind; CardDefinition.findById = originals.defById;
    PetCatalog.find = originals.petFind; PetCatalog.findOne = originals.petOne;
    CardCollector.updateOne = originals.collectorUpdate;
    CardCollector.findOne = originals.collectorFind;
  }
});

test("a five-character card ID tags ONLY the exact matching owned card", async () => {
  const original = { one:CardCopy.findOne, update:CardCopy.updateMany,
    def:CardDefinition.findById, pet:PetCatalog.findOne, collector:CardCollector.updateOne, collectorFind: CardCollector.findOne };
  try {
    CardCollector.findOne = () => ({ select:()=>({lean:async()=>({tagNames:["cute"]})}) });
    CardCopy.findOne = query => {
      assert.equal(query.publicId, "KxQOo");
      return { lean: async () => ({ _id:"only-one", publicId:"KxQOo",
        cardDefinitionId:"d1", upgradeLevel:"neon" }) };
    };
    CardCopy.updateMany = async query => {
      assert.deepEqual(query._id.$in, ["only-one"]);
      return { matchedCount:1, modifiedCount:1 };
    };
    CardDefinition.findById = () => ({ select: () => ({ lean: async () => ({ petId:"2d-doggy", rarity:"Legendary" }) }) });
    PetCatalog.findOne = () => ({ select: () => ({ lean: async () => ({ name:"2D Doggy" }) }) });
    CardCollector.updateOne = async () => ({});
    const result = await updateOwnedCardTag({ discordUserId:"owner", cardId:"KxQOo", tag:"cute" });
    assert.equal(result.mode, "id");
    assert.equal(result.count, 1);
    assert.equal(result.id, "KxQOo");
  } finally {
    CardCopy.findOne=original.one; CardCopy.updateMany=original.update;
    CardDefinition.findById=original.def; PetCatalog.findOne=original.pet;
    CardCollector.updateOne=original.collector;
    CardCollector.findOne=original.collectorFind;
  }
});
