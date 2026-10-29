import test from "node:test";
import assert from "node:assert/strict";
import { data } from "../commands/cards.js";
import { COLLECTION_PAGE_SIZE, COLLECTION_RARITY_OPTIONS, COLLECTION_SORT_OPTIONS,
  openCollectionSession, getCollectionSession, updateCollectionSession, closeCollectionSession } from "../services/card-collection-browser.js";
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
