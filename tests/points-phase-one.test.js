import test from "node:test";
import assert from "node:assert/strict";
import { POINTS_MILESTONES, POINTS_ACTIVITY_TARGETS,
  milestoneAwardAmount, starterClassicBasket, starterClassicBasketCost } from "../services/points-policy.js";
import { hasCustomizedAppearance } from "../services/points-backfill.js";
import { DEFAULT_APPEARANCE } from "../services/post-appearance.js";
import PointsLedger from "../models/PointsLedger.js";
import { data as adminData } from "../commands/points-admin.js";

test("starter collection costs 425 Points before any one-time bonuses", () => {
  // Cheapest paid background (75), panel (50), frame (125), font (125),
  // sticker (50). Text color intentionally excluded.
  const basket = starterClassicBasket();
  assert.deepEqual(basket.map(item => item.category),
    ["backgrounds", "panels", "frames", "fonts", "stickers"]);
  assert.deepEqual(basket.map(item => item.price), [75, 50, 125, 125, 50]);
  const starter = starterClassicBasketCost();
  assert.equal(starter, 425);
  assert.equal(POINTS_ACTIVITY_TARGETS.firstWeekActivityMultiplier, 2);
  assert.equal("starterWeekActivityCap" in POINTS_ACTIVITY_TARGETS, false);
  assert.equal("laterWeeklyActivityCap" in POINTS_ACTIVITY_TARGETS, false);
  assert.equal(POINTS_ACTIVITY_TARGETS.invitationReward, 40);
  assert.equal(POINTS_ACTIVITY_TARGETS.inviteMinimumMembershipDays, 7);
  assert.equal(POINTS_ACTIVITY_TARGETS.rewardedInvitesPerCalendarMonth, 2);
});

test("milestones are one-time known keys, with configurable zero-point disabling", () => {
  assert.equal(Object.keys(POINTS_MILESTONES).length, 7);
  for (const [key, info] of Object.entries(POINTS_MILESTONES)) {
    assert.ok(info.label && info.points >= 0);
    assert.equal(milestoneAwardAmount(null, key), info.points);
    assert.equal(milestoneAwardAmount({ milestoneAmounts: { [key]: 0 } }, key), 0);
    assert.equal(milestoneAwardAmount({ milestoneAmounts: { [key]: 77 } }, key), 77);
    assert.equal(milestoneAwardAmount({ milestoneAmounts: { [key]: 700 } }, key), info.points);
    assert.equal(milestoneAwardAmount({ milestoneAmounts: { [key]: -10 } }, key), info.points);
  }
  assert.throws(() => milestoneAwardAmount(null, "madeUpReward"), /Unknown Points milestone/);
});

test("retroactive customization evidence requires a saved appearance change", () => {
  assert.equal(hasCustomizedAppearance(DEFAULT_APPEARANCE), false);
  assert.equal(hasCustomizedAppearance({}), false);
  assert.equal(hasCustomizedAppearance({ background: "roseDark" }), true);
  assert.equal(hasCustomizedAppearance({ panelColor: "match" }), true);
  assert.equal(hasCustomizedAppearance({
    ...DEFAULT_APPEARANCE, stickers: [{ id: "heart", x: .8, y: .72 }],
  }), true);
});

test("ledger enforces unique member-event receipts for retry-safe Points", () => {
  assert.ok(PointsLedger.schema.indexes().some(([fields, options]) =>
    fields.guildId === 1 && fields.discordUserId === 1 &&
    fields.eventKey === 1 && options.unique === true));
});

test("manager controls expose dry-run backfill, audited grants and settings", () => {
  const command = adminData.toJSON();
  assert.equal(command.name, "points-admin");
  assert.deepEqual(command.options.map(item => item.name),
    ["settings", "activity-toggle", "activity-status", "milestone", "toggle", "grant", "grant-multiple", "poll-approve", "poll-disable", "scan-messages", "history", "backfill"]);
  const backfill = command.options.find(item => item.name === "backfill");
  const apply = backfill.options.find(option => option.name === "apply");
  assert.equal(apply.required, false, "backfill must dry run unless explicitly requested");
  const grant = command.options.find(item => item.name === "grant");
  assert.equal(grant.options.find(option => option.name === "points").max_value, 250);
});
