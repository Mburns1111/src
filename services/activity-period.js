import { POINTS_ACTIVITY_TARGETS } from "./points-policy.js";

export const FIRST_WEEK_MS = 7 * 24 * 60 * 60_000;
export function pollWeekStartUtc(now = new Date()) {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function activityPeriod(joinedAt, now = new Date()) {
  const joined = joinedAt instanceof Date ? joinedAt : joinedAt ? new Date(joinedAt) : null;
  const joinedMs = joined?.getTime();
  const age = Number.isFinite(joinedMs) ? now.getTime() - joinedMs : Number.POSITIVE_INFINITY;
  const starter = age >= 0 && age < FIRST_WEEK_MS;
  return starter
    ? { key: `starter:${joinedMs}`, starter: true,
      cap: POINTS_ACTIVITY_TARGETS.starterWeekActivityCap,
      multiplier: POINTS_ACTIVITY_TARGETS.firstWeekActivityMultiplier }
    : { key: `week:${pollWeekStartUtc(now)}`, starter: false,
      cap: POINTS_ACTIVITY_TARGETS.laterWeeklyActivityCap, multiplier: 1 };
}
