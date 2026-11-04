import test from "node:test";
import assert from "node:assert/strict";
import { activityWeek, completedActivityWeek } from "../services/giveaway-activity-counter.js";
test("Wednesday midnight Eastern starts a new week in standard time", () => {
  assert.equal(activityWeek(new Date("2026-11-04T04:59:59Z")), "2026-10-28");
  assert.equal(activityWeek(new Date("2026-11-04T05:00:00Z")), "2026-11-04");
  assert.equal(completedActivityWeek(new Date("2026-11-04T05:00:00Z")), "2026-10-28");
});
test("Wednesday midnight Eastern accounts for daylight saving", () => {
  assert.equal(activityWeek(new Date("2026-07-08T03:59:59Z")), "2026-07-01");
  assert.equal(activityWeek(new Date("2026-07-08T04:00:00Z")), "2026-07-08");
});
test("Sunday and Tuesday are in the same Wednesday activity week", () => {
  assert.equal(activityWeek(new Date("2026-11-08T16:00:00Z")), "2026-11-04");
  assert.equal(activityWeek(new Date("2026-11-10T16:00:00Z")), "2026-11-04");
});
