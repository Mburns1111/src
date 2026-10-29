import test from "node:test";
import assert from "node:assert/strict";
import { data } from "../commands/cards.js";
import { COLLECTION_PAGE_SIZE, COLLECTION_RARITY_OPTIONS, COLLECTION_SORT_OPTIONS,
  openCollectionSession, getCollectionSession, updateCollectionSession, closeCollectionSession,
  listCollectionRarities, listCollectionTags } from "../services/card-collection-browser.js";
import { startCardCollection, handleCardCollectionInteraction } from "../commands/card-collection-ui.js";

test("private collection viewer supports 8-card pages and sortable filters", () => {
  assert.equal(COLLECTION_PAGE_SIZE, 8);
  assert.ok(COLLECTION_RARITY_OPTIONS.includes("Legendary"));
  assert.ok(COLLECTION_SORT_OPTIONS.includes("name"));
  assert.ok(COLLECTION_SORT_OPTIONS.includes("rarity"));
  assert.ok(data.toJSON().options.some(o => o.name === "collection"));
  assert.equal(typeof startCardCollection, "function");
  assert.equal(typeof handleCardCollectionInteraction, "function");
});
test("collection sessions reject other members and invalid inputs", () => {
  const id = openCollectionSession("collector-a");
  assert.equal(getCollectionSession(id, "collector-a").page, 0);
  assert.throws(() => getCollectionSession(id, "collector-b"), /another member/);
  updateCollectionSession(id, "collector-a", { page: 2 });
  assert.equal(getCollectionSession(id, "collector-a").page, 2);
  updateCollectionSession(id, "collector-a", { rarity: "Rare" });
  assert.equal(getCollectionSession(id, "collector-a").page, 0);
  assert.equal(getCollectionSession(id, "collector-a").rarity, "Rare");
  assert.throws(() => updateCollectionSession(id, "collector-a", { rarity: "admin" }));
  assert.throws(() => updateCollectionSession(id, "collector-a", { page: -1 }));
  assert.throws(() => updateCollectionSession(id, "collector-a", { release: "unowned" }));
  closeCollectionSession(id, "collector-a");
  assert.throws(() => getCollectionSession(id, "collector-a"), /expired/);
});

test("tag searches reset pagination and support clearing the tag", () => {
  const id = openCollectionSession("tag-owner");
  updateCollectionSession(id, "tag-owner", { page: 3 });
  updateCollectionSession(id, "tag-owner", { tag: "  My   Favorites  " });
  assert.equal(getCollectionSession(id, "tag-owner").tag, "My Favorites");
  assert.equal(getCollectionSession(id, "tag-owner").page, 0);
  assert.throws(() => updateCollectionSession(id, "tag-owner", { tag: "bad.*regex" }), /valid tag/);
  updateCollectionSession(id, "tag-owner", { tag: "" });
  assert.equal(getCollectionSession(id, "tag-owner").tag, "");
  closeCollectionSession(id, "tag-owner");
  assert.equal(typeof listCollectionRarities, "function");
  assert.equal(typeof listCollectionTags, "function");
});

test("collection tag filter is a dropdown of owned tags, not a text popup", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../commands/card-collection-ui.js", import.meta.url), "utf8");
  assert.ok(source.includes("cards:collection:tag:${id}"));
  assert.match(source, /session\.tagOptions\.map/);
  assert.match(source, /All tags/);
  assert.doesNotMatch(source, /showModal|TextInputBuilder|Find Tag/);
  assert.ok(source.includes("cards:collection:sort:${id}"));
  assert.match(source, /const components = \[rarity, release, tag, sort, picker\]/);
  assert.doesNotMatch(source, /ButtonBuilder|cards:collection:choose/);
  assert.ok(source.includes("__prev__"));
  assert.ok(source.includes("__next__"));
  assert.ok(source.includes("__back__"));
  assert.ok(source.includes("cards:collection:pick:${id}"));
  assert.doesNotMatch(source, /setLabel\(`Sort:/);
});
