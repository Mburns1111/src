import test from "node:test";
import assert from "node:assert/strict";
import PointsLedger from "../models/PointsLedger.js";
import { spendPointsInSession, spendEventKey, validateSpendDetails,
  PointsSpendError } from "../services/points-spending.js";
import { refundPoints } from "../services/points-rewards.js";
import { AUDIT_TYPES, receiptCsvLine } from "../services/points-audit.js";
import { data as pointsAdmin } from "../commands/points-admin.js";
import { readFile } from "node:fs/promises";

const guildId = "1561372971355086958";
const userId = "1561372971355086959";

function fakeDb(startBalance = 500) {
  const receipts = new Map();
  let balance = startBalance;
  let walletUpdates = 0;
  const Wallet = { async findOneAndUpdate(query, update, opts) {
    assert.equal(opts.session, session);
    if (balance < query.balance.$gte) return null;
    balance += update.$inc.balance;
    walletUpdates++;
    return { balance };
  } };
  const Ledger = {
    exists(query) { return { async session(value) {
      assert.equal(value, session);
      return receipts.has(query.eventKey);
    } }; },
    async create(items, opts) {
      assert.equal(opts.session, session);
      const receipt = items[0];
      assert.equal(receipt.amount < 0, true);
      if (receipts.has(receipt.eventKey)) { const e = Error("duplicate"); e.code = 11000; throw e; }
      receipts.set(receipt.eventKey, receipt);
    },
  };
  const session = { marker: "active-transaction" };
  return { Ledger, Wallet, session, receipts,
    get balance() { return balance; }, get walletUpdates() { return walletUpdates; } };
}

test("shop debit writes signed receipt, source and item details alongside wallet change", async () => {
  const db = fakeDb(120);
  const params = {
    guildId, userId, eventKey: spendEventKey("shop", "single:one"),
    amount: 75, description: "Shop purchase: Forest Green Background",
    sourceType: "shop", sourceId: "backgrounds:forest",
    items: [{ category: "backgrounds", id: "forest", price: 75 }],
    ...db,
  };
  const receipt = await spendPointsInSession(params);
  assert.deepEqual(receipt, { spent: 75, balanceAfter: 45 });
  assert.equal(db.balance, 45);
  const logged = db.receipts.get(params.eventKey);
  assert.equal(logged.kind, "spend");
  assert.equal(logged.amount, -75);
  assert.equal(logged.balanceAfter, 45);
  assert.equal(logged.sourceType, "shop");
  assert.deepEqual(logged.items, params.items);
  assert.match(receiptCsvLine({ ...logged, createdAt: new Date() }), /-75,"debit"/);
});

test("duplicate spend reference cannot charge twice", async () => {
  const db = fakeDb(120);
  const params = { guildId, userId, amount: 75,
    eventKey: spendEventKey("shop", "single:one"), description: "Shop purchase",
    sourceType: "shop", sourceId: "single", ...db };
  await spendPointsInSession(params);
  await assert.rejects(() => spendPointsInSession(params), e =>
    e instanceof PointsSpendError && e.code === "duplicate");
  assert.equal(db.balance, 45);
  assert.equal(db.receipts.size, 1);
  assert.equal(db.walletUpdates, 1);
});

test("insufficient funds never record spending or change balance", async () => {
  const db = fakeDb(40);
  await assert.rejects(() => spendPointsInSession({ guildId, userId,
    amount: 75, eventKey: "spend:shop:one", sourceType: "shop",
    description: "Shop purchase", ...db }), e =>
      e instanceof PointsSpendError && e.code === "insufficient");
  assert.equal(db.balance, 40);
  assert.equal(db.receipts.size, 0);
  assert.equal(db.walletUpdates, 0);
});

test("bundle is a single spend with all purchased items and stable reference", async () => {
  const db = fakeDb(500);
  const items = [{ category: "backgrounds", id: "forest", price: 75 },
    { category: "frames", id: "sparkle", price: 125 }];
  const eventKey = spendEventKey("shop", "bundle:abc123:1720000000000");
  const result = await spendPointsInSession({ guildId, userId, amount: 200,
    eventKey, sourceType: "shop", sourceId: "abc123",
    description: "Shop Purchase All: 2 appearance items",
    items, ...db });
  assert.equal(result.balanceAfter, 300);
  assert.equal(db.receipts.size, 1);
  assert.equal(db.receipts.get(eventKey).items.length, 2);
});

test("future spending sources share the same helper without shop assumptions", async () => {
  const db = fakeDb(200);
  const eventKey = spendEventKey("event", "entry:123456");
  await spendPointsInSession({ guildId, userId, amount: 35, eventKey,
    description: "Community event ticket", sourceType: "event",
    sourceId: "123456", ...db });
  assert.equal(db.receipts.get(eventKey).sourceType, "event");
  assert.equal(db.balance, 165);
  assert.throws(() => validateSpendDetails({ guildId, userId, amount: 0, eventKey,
    description: "No-cost", sourceType: "event" }), /Invalid/);
  assert.throws(() => spendEventKey("??", "ref"), /source/);
});

test("ledger stores negative spends but rejects zero and decimal amounts", () => {
  const field = PointsLedger.schema.path("amount");
  const validator = field.validators.find(v => v.message === "Points movements must be nonzero signed integers")?.validator;
  assert.equal(typeof validator, "function");
  assert.equal(validator(-50), true);
  assert.equal(validator(10), true);
  assert.equal(validator(0), false);
  assert.equal(validator(1.5), false);
  assert.ok(AUDIT_TYPES.some(x => x.value === "spend"));
  assert.ok(AUDIT_TYPES.some(x => x.value === "refund"));
  assert.ok(typeof refundPoints === "function");
});

test("the existing shop's single and bundle checkouts both use signed-spend helper", async () => {
  const source = await readFile(new URL("../commands/shop.js", import.meta.url), "utf8");
  assert.ok(source.includes('spendEventKey("shop", `single:'));
  assert.ok(source.includes('spendEventKey("shop", `bundle:'));
  assert.equal((source.match(/await spendPointsInSession\(/g) ?? []).length, 2);
  assert.ok(source.includes('const context = { guildId, user: interaction.user, guild, interactionId: interaction.id };'));
  assert.equal((source.match(/\$inc: \{ balance: -/g) ?? []).length, 0);
});
