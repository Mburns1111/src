import test from "node:test";
import assert from "node:assert/strict";
import {GIVEAWAY_MAX_MINUTES,maxRegularGiveawayMinutes,sixCalendarMonthsAfter}
  from "../services/giveaways.js";
import {regularGiveawayDaysToMinutes,regularGiveawayDurationLabel}
  from "../commands/regular-giveaway-wizard.js";

test("regular giveaway duration is capped at six calendar months, not a fixed 180 days",()=>{
  const winter=new Date("2026-11-09T19:00:00.000Z");
  assert.equal(sixCalendarMonthsAfter(winter).toISOString(),"2027-05-09T19:00:00.000Z");
  assert.equal(maxRegularGiveawayMinutes(winter),181*1440);
  assert.equal(regularGiveawayDaysToMinutes(181,winter),181*1440);
  assert.throws(()=>regularGiveawayDaysToMinutes(182,winter),/six calendar months/);
  const summer=new Date("2027-03-01T16:00:00.000Z");
  assert.equal(sixCalendarMonthsAfter(summer).toISOString(),"2027-09-01T16:00:00.000Z");
  assert.equal(maxRegularGiveawayMinutes(summer),184*1440);
  assert.equal(GIVEAWAY_MAX_MINUTES,184*1440);
  assert.equal(regularGiveawayDaysToMinutes("184",summer),184*1440);
  assert.throws(()=>regularGiveawayDaysToMinutes("185",summer),/six calendar months/);
});

test("six calendar months clamps a month-end start to the last valid day",()=>{
  assert.equal(sixCalendarMonthsAfter(new Date("2026-08-31T12:30:00Z")).toISOString(),
    "2027-02-28T12:30:00.000Z");
  assert.equal(sixCalendarMonthsAfter(new Date("2027-08-31T12:30:00Z")).toISOString(),
    "2028-02-29T12:30:00.000Z");
});

test("custom giveaway day inputs are positive whole days and review labels are readable",()=>{
  const start=new Date("2027-03-01T16:00:00.000Z");
  for(const value of [0,-1,1.5,"2.5","not a number",null,Infinity]){
    assert.throws(()=>regularGiveawayDaysToMinutes(value,start),/Duration/);
  }
  assert.equal(regularGiveawayDaysToMinutes("3",start),4320);
  assert.match(regularGiveawayDurationLabel(4320),/3 day/);
  assert.match(regularGiveawayDurationLabel(90),/90 minutes/);
});
