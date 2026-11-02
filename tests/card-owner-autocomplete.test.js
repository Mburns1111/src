import test from "node:test";
import assert from "node:assert/strict";
import CardSeries from "../models/CardSeries.js";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import PetCatalog from "../models/PetCatalog.js";
import { data, autocompleteCardsOwner } from "../commands/cards-owner.js";
import { data as cards } from "../commands/cards.js";

const owner = "123456789012345678", outsider = "234567890123456789";

function interaction({ userId = owner, action, field, value = "", release = null, accept }) {
  return {
    user: { id:userId },
    options: {
      getSubcommand: () => action,
      getFocused: () => ({ name:field, value }),
      getString: name => name === "release" ? release : null,
    },
    respond: accept,
  };
}

test("slash commands advertise owner/collector autocomplete for relevant names", () => {
  const opts = data.toJSON().options;
  for (const command of ["create-release","add-pet","remove-pet","set-weight","inspect","release-check"]) {
    const sub = opts.find(o => o.name === command);
    assert.ok(sub, command);
    if (command === "create-release") assert.equal(sub.options.find(o => o.name === "series").autocomplete, true);
    if (sub.options.some(o => o.name === "release")) assert.equal(sub.options.find(o => o.name === "release").autocomplete, true);
    if (sub.options.some(o => o.name === "pet")) assert.equal(sub.options.find(o => o.name === "pet").autocomplete, true);
  }
  for (const cmd of ["tag","untag","stats","view"]) {
    const sub = cards.toJSON().options.find(o => o.name === cmd);
    assert.equal(sub.options.find(o => o.name === "card_id").autocomplete, true);
  }
});

test("owner suggestions stay private, never queried for other guild administrators", async () => {
  const original = process.env.CARD_GAME_OWNER_DISCORD_ID;
  const find = CardSeries.find;
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID = owner;
    CardSeries.find = () => { throw new Error("Outsider must not query global series"); };
    let response;
    await autocompleteCardsOwner(interaction({
      userId:outsider, action:"create-release", field:"series", accept: choices => { response = choices; },
    }));
    assert.deepEqual(response, []);
  } finally {
    CardSeries.find = find;
    if (original === undefined) delete process.env.CARD_GAME_OWNER_DISCORD_ID;
    else process.env.CARD_GAME_OWNER_DISCORD_ID = original;
  }
});

test("release creation suggests existing series instead of an unknown series identifier", async () => {
  const original = process.env.CARD_GAME_OWNER_DISCORD_ID;
  const find = CardSeries.find;
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID = owner;
    CardSeries.find = () => ({ select: () => ({ sort: () => ({ limit: () => ({
      lean: async () => [{ seriesId:"series-test-1", name:"Test Series 1" }],
    }) }) }) });
    let response;
    await autocompleteCardsOwner(interaction({
      action:"create-release", field:"series", value:"test", accept: choices => { response = choices; },
    }));
    assert.deepEqual(response, [{ name:"Test Series 1 · series-test-1", value:"series-test-1" }]);
  } finally {
    CardSeries.find = find;
    if (original === undefined) delete process.env.CARD_GAME_OWNER_DISCORD_ID;
    else process.env.CARD_GAME_OWNER_DISCORD_ID = original;
  }
});

test("add-pet suggests available catalog pets but excludes already assigned pets", async () => {
  const original = process.env.CARD_GAME_OWNER_DISCORD_ID;
  const find = PetCatalog.find, distinct = CardDefinition.distinct;
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID = owner;
    PetCatalog.find = query => {
      assert.deepEqual(query.rarity, { $ne:"Unknown" });
      return { select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [
        { petId:"cow", name:"Cow", rarity:"Rare" },
        { petId:"cat", name:"Cat", rarity:"Common" },
      ] }) }) }) };
    };
    CardDefinition.distinct = async () => ["cat"];
    let response;
    await autocompleteCardsOwner(interaction({
      action:"add-pet", field:"pet", value:"c", release:"s1-r1",
      accept: choices => { response = choices; },
    }));
    assert.deepEqual(response, [{ name:"Cow · Rare", value:"cow" }]);
  } finally {
    PetCatalog.find = find;
    CardDefinition.distinct = distinct;
    if (original === undefined) delete process.env.CARD_GAME_OWNER_DISCORD_ID;
    else process.env.CARD_GAME_OWNER_DISCORD_ID = original;
  }
});
