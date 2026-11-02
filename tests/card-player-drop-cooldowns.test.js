import test from "node:test";
import mongoose from "mongoose";
import CardCollector from "../models/CardCollector.js";
import { AchievementControl, CardBonusUse } from "../models/CardAchievementState.js";
import assert from "node:assert/strict";
import CardDrop from "../models/CardDrop.js";
import CardActionCooldown from "../models/CardActionCooldown.js";
import {
  claimCardActionCooldown, releaseCardActionCooldown, readCardActionCooldown,
  cardCooldownIdentity, CARD_DROP_COOLDOWN_MS, CARD_GRAB_COOLDOWN_MS,
} from "../services/card-action-cooldowns.js";
import { refundLosingCardGrabCooldowns } from "../services/card-drop-claims.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { data as cardCommand,ownerCardOptions } from "../commands/cards.js";

const user = "123456789012345678";
const guildA = "234567890123456789";
const guildB = "345678901234567890";

/** Mock the real transactional cooldown/bonus path, never connect to MongoDB. */
async function withCooldownStore(initial, run) {
  const rows = new Map(initial.map(row => [row._id, { ...row }]));
  const prior = [], previousFlag = process.env.ENABLE_CARD_GAME_TEST;
  const stub = (object, key, replacement) => {
    prior.push([object, key, object[key]]);
    object[key] = replacement;
  };
  const session = { withTransaction: async fn => fn(), endSession: async () => {} };
  const writes = { claimed: 0, refunded: 0, attemptedBonusDebit: 0 };
  try {
    process.env.ENABLE_CARD_GAME_TEST = "1";
    stub(mongoose, "startSession", async () => session);
    stub(AchievementControl, "updateOne", async () => ({ modifiedCount: 1 }));
    stub(CardActionCooldown, "findById", id => ({
      session: given => {
        assert.equal(given, session);
        return { lean: async () => rows.get(id) || null };
      },
      select: () => ({ lean: async () => rows.get(id) || null }),
    }));
    stub(CardActionCooldown, "updateOne", async (filter, update, options) => {
      assert.equal(options.session, session);
      assert.equal(options.upsert, true);
      assert.ok(update.$set.sourceId);
      rows.set(filter._id, { ...rows.get(filter._id), ...update.$set });
      writes.claimed += 1;
      return { modifiedCount: 1 };
    });
    stub(CardActionCooldown, "deleteOne", async (filter, options) => {
      assert.equal(options.session, session);
      const existing = rows.get(filter._id);
      if (!existing || existing.sourceId !== filter.sourceId) return { deletedCount: 0 };
      rows.delete(filter._id);
      writes.refunded += 1;
      return { deletedCount: 1 };
    });
    stub(CardBonusUse, "findById", () => ({
      session: given => {
        assert.equal(given, session);
        return { lean: async () => null };
      },
    }));
    stub(CardBonusUse, "updateOne", async () => ({ modifiedCount: 0 }));
    stub(CardCollector, "updateOne", async () => {
      writes.attemptedBonusDebit += 1;
      return { modifiedCount: 0 }; // No extras in the basic cooldown tests.
    });
    await run({ rows, writes });
  } finally {
    for (const [object, key, original] of prior.reverse()) object[key] = original;
    if (previousFlag === undefined) delete process.env.ENABLE_CARD_GAME_TEST;
    else process.env.ENABLE_CARD_GAME_TEST = previousFlag;
  }
}


test("member commands grant a normal drop and cooldown status, while owner test-drop stays available", () => {
  const commands = cardCommand.toJSON().options.map(option => option.name);
  assert.ok(commands.includes("drop"));
  assert.ok(commands.includes("cooldowns"));
  assert.ok(!commands.includes("test-drop"),"owner tools stay out of public /cards");
  assert.ok(ownerCardOptions.toJSON().options.some(o=>o.name==="test-drop"));
  assert.deepEqual(parseHatchemText(".drop"), { action: "drop", options: {} });
  assert.deepEqual(parseHatchemText(".cooldowns"), { action: "cooldowns", options: {} });
  assert.equal(CardDrop.schema.path("mode").defaultValue, "test");
});

test("drop cooldown is GLOBAL and grab cooldown is per server", () => {
  const a = cardCooldownIdentity({ action:"drop", discordUserId:user, guildId:guildA });
  const b = cardCooldownIdentity({ action:"drop", discordUserId:user, guildId:guildB });
  const ga = cardCooldownIdentity({ action:"grab", discordUserId:user, guildId:guildA });
  const gb = cardCooldownIdentity({ action:"grab", discordUserId:user, guildId:guildB });
  assert.equal(a._id, b._id);
  assert.notEqual(ga._id, gb._id);
  assert.equal(CARD_DROP_COOLDOWN_MS, 15*60*1000);
  assert.equal(CARD_GRAB_COOLDOWN_MS, 5*60*1000);
  assert.ok(CardActionCooldown.schema.path("sourceId"));
});

test("a successful player drop claims exactly 15 minutes and records the drop source for refunds", async () => {
  const now = new Date("2026-10-29T18:00:00.000Z");
  await withCooldownStore([], async ({ rows, writes }) => {
    const result = await claimCardActionCooldown({
      action: "drop", discordUserId: user, guildId: guildA, now, sourceId: "d1",
    });
    assert.equal(result.allowed, true);
    assert.equal(result.bonus, false, "free drop does not spend an extra");
    assert.equal(+result.availableAt, +now + CARD_DROP_COOLDOWN_MS);
    const saved = rows.get("drop:global:" + user);
    assert.equal(saved.scope, "global");
    assert.equal(saved.action, "drop");
    assert.equal(saved.sourceId, "d1");
    assert.equal(+saved.availableAt, +now + CARD_DROP_COOLDOWN_MS);
    assert.equal(writes.claimed, 1);
    assert.equal(writes.attemptedBonusDebit, 0);
  });
});

test("a second drop in another server is denied while the same global cooldown is running", async () => {
  const next = new Date("2026-10-29T18:15:00.000Z");
  const id = "drop:global:" + user;
  await withCooldownStore([{ _id: id, sourceId: "d1", availableAt: next }], async ({ rows, writes }) => {
    const result = await claimCardActionCooldown({
      action: "drop", discordUserId: user, guildId: guildB,
      sourceId: "d2", now: new Date("2026-10-29T18:05:00.000Z"),
    });
    assert.equal(result.allowed, false);
    assert.equal(+result.availableAt, +next);
    assert.equal(rows.get(id).sourceId, "d1", "failed drop cannot replace previous source");
    assert.equal(writes.claimed, 0);
    assert.equal(writes.attemptedBonusDebit, 1, "active cooldown checks for extras");
  });
});

test("a failed drop or unsuccessful grab refunds only its own cooldown source", async () => {
  const id = "grab:" + guildA + ":" + user;
  const initial = [{ _id: id, sourceId: "drop-abc", availableAt: new Date("2026-10-29T18:05:00Z") }];
  await withCooldownStore(initial, async ({ rows, writes }) => {
    assert.equal(await releaseCardActionCooldown({
      action: "grab", discordUserId: user, guildId: guildA, sourceId: "drop-abc",
    }), true);
    assert.equal(rows.has(id), false);
    rows.set(id, { _id: id, sourceId: "newer-drop", availableAt: new Date("2026-10-29T18:10:00Z") });
    assert.equal(await releaseCardActionCooldown({
      action: "grab", discordUserId: user, guildId: guildA, sourceId: "old-drop",
    }), false);
    assert.equal(rows.get(id).sourceId, "newer-drop");
    assert.equal(writes.refunded, 1);
  });
});

test("read cooldowns do not consume or renew eligibility", async () => {
  const prev=CardActionCooldown.findById;
  try {
    CardActionCooldown.findById=()=>({select:()=>({lean:async()=>null})});
    assert.equal((await readCardActionCooldown({
      action:"grab",discordUserId:user,guildId:guildB,
    })).allowed,true);
  } finally { CardActionCooldown.findById=prev; }
});

test("settling a player drop refunds losing guests, but never the winner", async () => {
  const dropId = "507f1f77bcf86cd799439011";
  const loser = "456789012345678901", winner = user;
  const winnerId = "grab:" + guildA + ":" + winner;
  const loserId = "grab:" + guildA + ":" + loser;
  const initial = [winnerId, loserId].map(id => ({
    _id: id, sourceId: dropId, availableAt: new Date("2026-10-29T18:05:00Z"),
  }));
  const previous = { find: CardDrop.findById, update: CardDrop.updateOne };
  try {
    CardDrop.findById = () => ({ lean: async () => ({
      _id: dropId, guildId: guildA, status: "closed", mode: "player", grabRefundedAt: null,
      slots: [
        { entrants: [winner, loser], winnerId: winner, settledAt: new Date() },
        { entrants: [], winnerId: null, settledAt: null },
        { entrants: [], winnerId: null, settledAt: null },
      ],
    }) });
    let marks = 0;
    CardDrop.updateOne = async (query, update) => {
      assert.equal(query.grabRefundedAt, null);
      assert.ok(update.$set.grabRefundedAt instanceof Date);
      marks++;
    };
    await withCooldownStore(initial, async ({ rows, writes }) => {
      await refundLosingCardGrabCooldowns({ _id: dropId, mode: "player", grabRefundedAt: null });
      assert.equal(rows.has(loserId), false);
      assert.equal(rows.has(winnerId), true, "winner cooldown must survive");
      assert.equal(writes.refunded, 1);
      assert.equal(writes.attemptedBonusDebit, 0);
    });
    assert.equal(marks, 1);
  } finally {
    CardDrop.findById = previous.find;
    CardDrop.updateOne = previous.update;
  }
});

