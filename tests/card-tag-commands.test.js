import test from "node:test";
import assert from "node:assert/strict";
import CardCopy from "../models/CardCopy.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import CardCollector from "../models/CardCollector.js";
import { findOwnedCardForCommand, petNameSearchPattern } from "../services/card-owned-selection.js";
import { createCollectorTag, listCollectorTags, matchingTagRegex, tagKey } from "../services/card-tag-catalog.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { data } from "../commands/cards.js";

test("Hatchem accepts tag-FIRST syntax, named pets, exact IDs and multiple IDs", () => {
  assert.deepEqual(parseHatchemText(".create-tag CuTe"), { action: "create-tag", options: { tag: "CuTe" } });
  assert.deepEqual(parseHatchemText(".tags"), { action: "tags", options: {} });
  assert.deepEqual(parseHatchemText('.tag "cute"'), { action: "tag", options: { tag: "cute" } });
  assert.deepEqual(parseHatchemText(".tag cute"), { action: "tag", options: { tag: "cute" } });
  assert.deepEqual(parseHatchemText('.TAG "CuTe" ABYS'), { action: "tag", options: { tag: "CuTe", card_id: "ABYS" } });
  assert.deepEqual(parseHatchemText('.tag "My Cute Pets"'), { action: "tag", options: { tag: "My Cute Pets" } });
  assert.deepEqual(parseHatchemText('.tag "My Cute Pets" Abyssinian Cat'), {
    action: "tag", options: { tag: "My Cute Pets", card_id: "Abyssinian Cat" },
  });
  assert.deepEqual(parseHatchemText('.tag "cute" 2d do'), { action: "tag", options: { tag: "cute", card_id: "2d do" } });
  assert.deepEqual(parseHatchemText('.tag "Very Cute" "2D Doggy"'), { action: "tag", options: { tag: "Very Cute", card_id: "2D Doggy" } });
  assert.deepEqual(parseHatchemText('.tag "cute" KxQOo'), { action: "tag", options: { tag: "cute", card_id: "KxQOo" } });
  assert.deepEqual(parseHatchemText('.tag "cute" KxQOo Abc12 Def34'), {
    action: "tag", options: { tag: "cute", card_ids: "KxQOo Abc12 Def34" },
  });
  assert.deepEqual(parseHatchemText('.tag "my favorites" KxQOo,Abc12'), {
    action: "tag", options: { tag: "my favorites", card_ids: "KxQOo Abc12" },
  });
  assert.deepEqual(parseHatchemText(".untag 2D Doggy"), { action: "untag", options: { card_id: "2D Doggy" } });
  assert.deepEqual(parseHatchemText(".untag abys"), { action: "untag", options: { card_id: "abys" } });
  assert.equal(parseHatchemText("tag cute"), null);
  const commands = data.toJSON().options;
  assert.ok(commands.some(c => c.name === "create-tag"));
  assert.ok(commands.some(c => c.name === "tags"));
  assert.ok(commands.find(c => c.name === "tag").options.some(o => o.name === "card_ids"));
  assert.ok(CardCollector.schema.path("tagNames"));
});

test("tag names match without case and existing older tags remain readable", () => {
  assert.equal(tagKey(" CuTe "), "cute");
  assert.equal(tagKey("MY   PETS"), "my pets");
  assert.ok(matchingTagRegex("cute").test("CuTe"));
  assert.ok(matchingTagRegex("my pets").test("MY PETS"));
  assert.throws(() => tagKey("@everyone"), /Tags must/);
});

test("saved tags persist without needing a card assignment", async () => {
  const oldUpdate = CardCollector.updateOne;
  const oldFind = CardCollector.findOne;
  const oldDistinct = CardCopy.distinct;
  try {
    CardCollector.updateOne = async (query, change, options) => {
      assert.equal(query.discordUserId, "owner");
      assert.equal(change.$addToSet.tagNames, "cute");
      assert.equal(options.upsert, true);
    };
    assert.equal(await createCollectorTag("owner", "CuTe"), "cute");
    CardCollector.findOne = () => ({ select: () => ({ lean: async () => ({ tagNames: ["cute"] }) }) });
    CardCopy.distinct = async () => ["CUTE", "Favorites"];
    assert.deepEqual(await listCollectorTags("owner"), ["cute", "favorites"]);
  } finally {
    CardCollector.updateOne = oldUpdate;
    CardCollector.findOne = oldFind;
    CardCopy.distinct = oldDistinct;
  }
});

test("no reference selects newest currently owned card, including upgrades", async () => {
  const original = CardCopy.findOne;
  try {
    CardCopy.findOne = query => {
      assert.deepEqual(query, { ownerDiscordUserId: "owner", state: "owned" });
      return { sort: ordering => {
        assert.deepEqual(ordering, { createdAt: -1, _id: -1 });
        return { lean: async () => ({ _id: "new-neon", source: "upgrade" }) };
      } };
    };
    assert.equal((await findOwnedCardForCommand("owner"))._id, "new-neon");
  } finally { CardCopy.findOne = original; }
});

test("pet prefix resolves newest owned matching pet, not an arbitrary catalog entry", async () => {
  const original = {
    pet: PetCatalog.find, definition: CardDefinition.find,
    distinct: CardCopy.distinct, one: CardCopy.findOne,
  };
  try {
    PetCatalog.find = query => {
      assert.ok(query.name.test("Abyssinian Cat"));
      return { select: () => ({ limit: () => ({ lean: async () => [
        { petId: "abyssinian-cat", name: "Abyssinian Cat" },
      ] }) }) };
    };
    CardDefinition.find = () => ({ select: () => ({ lean: async () => [
      { _id: "def1", petId: "abyssinian-cat" },
    ] }) });
    CardCopy.distinct = async () => ["def1"];
    CardCopy.findOne = query => {
      assert.deepEqual(query.cardDefinitionId.$in, ["def1"]);
      return { sort: order => {
        assert.equal(order.createdAt, -1);
        return { lean: async () => ({ _id: "newest-abys", ownerDiscordUserId: "owner" }) };
      } };
    };
    assert.equal((await findOwnedCardForCommand("owner", "ABYS"))._id, "newest-abys");
  } finally {
    PetCatalog.find = original.pet; CardDefinition.find = original.definition;
    CardCopy.distinct = original.distinct; CardCopy.findOne = original.one;
  }
});

test("ambiguous pet prefixes refuse to select somebody's wrong pet", async () => {
  const original = {
    pet: PetCatalog.find, definition: CardDefinition.find,
    distinct: CardCopy.distinct,
  };
  try {
    PetCatalog.find = () => ({ select: () => ({ limit: () => ({ lean: async () => [
      { petId: "black-cat", name: "Black Cat" },
      { petId: "black-panther", name: "Black Panther" },
    ] }) }) });
    CardDefinition.find = () => ({ select: () => ({ lean: async () => [
      { _id: "d1", petId: "black-cat" },
      { _id: "d2", petId: "black-panther" },
    ] }) });
    CardCopy.distinct = async () => ["d1", "d2"];
    await assert.rejects(() => findOwnedCardForCommand("owner", "BLAC"), /several pets you own/);
  } finally {
    PetCatalog.find = original.pet; CardDefinition.find = original.definition;
    CardCopy.distinct = original.distinct;
  }
});

test("five-character card IDs ignore capitalization only if the result is unique", async () => {
  const original = { one: CardCopy.findOne, many: CardCopy.find };
  try {
    CardCopy.findOne = () => ({ lean: async () => null });
    CardCopy.find = query => {
      assert.ok(query.publicId.test("KxQOo"));
      return { limit: () => ({ lean: async () => [{ _id: "the-card" }] }) };
    };
    assert.equal((await findOwnedCardForCommand("owner", "kxqoo"))._id, "the-card");
    CardCopy.find = () => ({ limit: () => ({ lean: async () => [{ _id: "one" }, { _id: "two" }] }) });
    await assert.rejects(() => findOwnedCardForCommand("owner", "kxqoo"), /exact capitalization/);
  } finally {
    CardCopy.findOne = original.one; CardCopy.find = original.many;
  }
});

test("pet prefixes require four letters except for complete short pet names", () => {
  assert.ok(petNameSearchPattern("cat").test("Cat"));
  assert.ok(!petNameSearchPattern("cat").test("Caterpillar"));
  assert.ok(petNameSearchPattern("cate").test("Caterpillar"));
  assert.ok(petNameSearchPattern("ABYS").test("Abyssinian Cat"));
});
