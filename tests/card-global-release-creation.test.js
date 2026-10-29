import test from "node:test";
import assert from "node:assert/strict";
import CardSeries from "../models/CardSeries.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import {
  releaseId, releaseName, hatchWeight, releaseOdds, requireDraft,
  createSeries, createRelease, editRelease, addReleasePet,
  removeReleasePet, setReleasePetWeight, setReleaseOdds, checkRelease,
} from "../services/card-global-releases.js";
import { data as command, execute as runOwnerCommand } from "../commands/cards-owner.js";

const USER = "123456789012345678";

test("series and egg IDs are canonical and human readable", () => {
  assert.equal(releaseId("  Series-1  "), "series-1");
  assert.equal(releaseId("S1-R1"), "s1-r1");
  assert.throws(() => releaseId("../evil"), /ID must/);
  assert.throws(() => releaseId("a"), /ID must/);
  assert.equal(releaseName("   Release    1 "), "Release 1");
  assert.throws(() => releaseName("@everyone"), /Names must/);
});

test("egg rarity percentages require exactly 100 and use the intended baseline", () => {
  const base = { Common:26, Uncommon:26, Rare:26, "Ultra-Rare":14, Legendary:8 };
  assert.deepEqual(releaseOdds(base), base);
  assert.throws(() => releaseOdds({ ...base, Legendary:9 }), /100%/);
  assert.throws(() => releaseOdds({ Common:100 }), /Invalid hatch odds/);
  assert.equal(hatchWeight(0), 0);
  assert.equal(hatchWeight(2.5), 2.5);
  assert.throws(() => hatchWeight(-1), /Hatch weight/);
});

test("only drafts may change the global pet list", () => {
  assert.equal(requireDraft({ status:"draft" }).status, "draft");
  assert.throws(() => requireDraft(null), /does not exist/);
  assert.throws(() => requireDraft({ status:"active" }), /Only draft/);
  assert.throws(() => requireDraft({ status:"retired" }), /Only draft/);
});

test("series creation only inserts a draft and never clones to guilds", async () => {
  const previous = CardSeries.create;
  try {
    CardSeries.create = async payload => {
      assert.deepEqual(payload, { seriesId:"series-1", name:"Series 1", status:"draft" });
      assert.equal(Object.hasOwn(payload, "guildId"), false);
      return payload;
    };
    assert.deepEqual(await createSeries({ seriesId:"SERIES-1", name:"Series 1" }),
      { id:"series-1", name:"Series 1" });
  } finally { CardSeries.create = previous; }
});

test("release creation stores a global, empty draft under an existing series", async () => {
  const original = { series: CardSeries.findOne, exists: CardRelease.exists, create: CardRelease.create };
  try {
    CardSeries.findOne = () => ({ lean: async () => ({ seriesId:"series-1", status:"draft" }) });
    CardRelease.exists = async () => false;
    CardRelease.create = async payload => {
      assert.equal(payload.seriesId, "series-1");
      assert.equal(payload.releaseId, "s1-r1");
      assert.equal(payload.eggName, "Release 1 Egg");
      assert.equal(payload.status, "draft");
      assert.deepEqual(payload.hatchOdds, { Common:26, Uncommon:26, Rare:26, "Ultra-Rare":14, Legendary:8 });
      assert.equal(Object.hasOwn(payload, "guildId"), false);
      return payload;
    };
    assert.equal((await createRelease({
      seriesId:"series-1", releaseId:"S1-R1", name:"Release 1", eggName:"Release 1 Egg",
    })).status, "draft");
    CardRelease.exists = async () => true;
    await assert.rejects(() => createRelease({
      seriesId:"series-1", releaseId:"s1-r1", name:"Duplicate", eggName:"Egg",
    }), /already exists/);
  } finally {
    CardSeries.findOne = original.series;
    CardRelease.exists = original.exists;
    CardRelease.create = original.create;
  }
});

test("adding pets does not approve their art or enable their hatching", async () => {
  const original = {
    release: CardRelease.findOne, exists: CardRelease.exists,
    pet: PetCatalog.findOne, create: CardDefinition.create,
  };
  try {
    CardRelease.findOne = () => ({ lean: async () => ({ status:"draft", seriesId:"series-1" }) });
    CardRelease.exists = async () => true;
    PetCatalog.findOne = () => ({ lean: async () => ({ petId:"cow", name:"Cow", rarity:"Rare" }) });
    CardDefinition.create = async payload => {
      assert.deepEqual(payload, {
        seriesId:"series-1", releaseId:"s1-r1", petId:"cow", rarity:"Rare",
        hatchWeight:2, enabled:false, artStatus:"missing",
      });
      return payload;
    };
    const result = await addReleasePet({ releaseId:"s1-r1", petId:"COW", weight:2 });
    assert.equal(result.petName, "Cow");
    PetCatalog.findOne = () => ({ lean: async () => ({ petId:"dirty-ducky", name:"Dirty Ducky", rarity:"Unknown" }) });
    await assert.rejects(() => addReleasePet({ releaseId:"s1-r1", petId:"dirty-ducky" }), /unresolved/);
  } finally {
    CardRelease.findOne = original.release; CardRelease.exists = original.exists;
    PetCatalog.findOne = original.pet; CardDefinition.create = original.create;
  }
});

test("editing an active release cannot rename it or alter its percentages", async () => {
  const original = { find: CardRelease.findOneAndUpdate };
  try {
    CardRelease.findOneAndUpdate = (filter) => {
      assert.equal(filter.status, "draft");
      return { lean: async () => null };
    };
    await assert.rejects(() => editRelease({
      releaseId:"s1-r1", name:"Unsafe",
    }), /not editable/);
    await assert.rejects(() => setReleaseOdds({
      releaseId:"s1-r1", odds:{ Common:26, Uncommon:26, Rare:26, "Ultra-Rare":14, Legendary:8 },
    }), /not editable/);
  } finally { CardRelease.findOneAndUpdate = original.find; }
});

test("owner-only release mutations deny outsiders before touching MongoDB", async () => {
  const original = process.env.CARD_GAME_OWNER_DISCORD_ID;
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID = USER;
    let result;
    await runOwnerCommand({
      user: { id:"999999999999999999" },
      options: { getSubcommand:() => "create-release" },
      editReply: value => { result = value; },
    });
    assert.match(result, /Only the card-game owner/);
  } finally {
    if (original === undefined) delete process.env.CARD_GAME_OWNER_DISCORD_ID;
    else process.env.CARD_GAME_OWNER_DISCORD_ID = original;
  }
});

test("owner slash commands expose draft creation, roster and read-only review actions", () => {
  const cmds = command.toJSON().options;
  for (const name of ["create-series","create-release","edit-release","add-pet",
    "remove-pet","set-weight","set-odds","release-check","releases","inspect"]) {
    assert.ok(cmds.some(option => option.name === name), name);
  }
  const create = cmds.find(option => option.name === "create-release");
  assert.ok(create.options.every(option => option.required));
  assert.equal(cmds.some(option => ["activate", "publish", "retire"].includes(option.name)), false);
});
