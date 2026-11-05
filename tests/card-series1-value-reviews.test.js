import test from "node:test";
import assert from "node:assert/strict";
import {
  SERIES1_VALUE_REVIEW_MIN,series1ValueReviewTemplate,planSeries1ValueReviews,
} from "../services/card-series1-value-review-plan.js";

const release={releaseId:"s1-r1",status:"draft"};
const cards=Array.from({length:108},(_,i)=>({
  _id:"id-"+i,petId:"pet-"+i,releaseId:"s1-r1",rarity:i%2?"Common":"Legendary",
  enabled:true,artStatus:"approved",hatchWeight:i+1,
  valueReview:{valueScore:null},
}));
const sources=i=>[
  {name:"Independent market one",url:"https://site-one.example/pets/"+i},
  {name:"Independent market two",url:"https://site-two.example/pets/"+i},
];
const input=(count=20)=>{
  const template=series1ValueReviewTemplate(cards);
  template.reviewMethod="Owner-reviewed relative trading value after comparing two independently published sites; not hatchWeight or official rarity.";
  for(let i=0;i<count;i++){
    const row=template.reviews[i];
    row.score=100-i*0.5;
    row.sources=sources(i);
    row.checkedAt="2026-11-04T17:00:00-05:00";
  }
  return template;
};

test("Series 1 export produces exactly 108 unsigned, unscored roster rows",()=>{
  const t=series1ValueReviewTemplate(cards);
  assert.equal(t.releaseId,"s1-r1");
  assert.equal(t.reviews.length,108);
  assert.equal(t.reviewMethod,"");
  assert.ok(t.reviews.every(r=>r.score===null&&r.sources.length===0));
  assert.ok(!t.reviews.some(r=>Object.hasOwn(r,"hatchWeight")));
});

test("20 independently sourced, reviewed values satisfy ranking minimum without changing hatch weights",()=>{
  const oldWeights=cards.map(c=>c.hatchWeight);
  const config=input(20);
  const result=planSeries1ValueReviews({release,definitions:cards,config});
  assert.equal(SERIES1_VALUE_REVIEW_MIN,20);
  assert.equal(result.pendingReviews,20);
  assert.equal(result.existingReviewed,0);
  assert.equal(result.reviewedAfter,20);
  assert.equal(result.unreviewedAfter,88);
  assert.equal(result.valueAchievementCoverageReady,true);
  assert.equal(result.changes[0].valueReview.valueScore,100);
  assert.equal(result.changes[0].valueReview.sources.length,2);
  assert.deepEqual(cards.map(c=>c.hatchWeight),oldWeights);
  assert.ok(cards.every(c=>c.valueReview.valueScore===null));
});

test("partial reviews stay explicit and cannot claim ranking minimum passed",()=>{
  const result=planSeries1ValueReviews({release,definitions:cards,config:input(5)});
  assert.equal(result.reviewedAfter,5);
  assert.equal(result.valueAchievementCoverageReady,false);
});

test("reject unverified, duplicate-site and future-dated review rows",()=>{
  const bad=input(1);
  bad.reviews[0].sources=bad.reviews[0].sources.slice(0,1);
  assert.throws(()=>planSeries1ValueReviews({release,definitions:cards,config:bad}),/two independent/);
  bad.reviews[0].sources=[sources(0)[0],{name:"same host",url:"https://site-one.example/another"}];
  assert.throws(()=>planSeries1ValueReviews({release,definitions:cards,config:bad}),/different trading-value websites/);
  bad.reviews[0].sources=sources(0);
  bad.reviews[0].checkedAt="2099-01-01T00:00:00Z";
  assert.throws(()=>planSeries1ValueReviews({release,definitions:cards,config:bad}),/nonfuture ISO/);
});

test("never accept made-up zero-coverage, missing source method or numeric score strings",()=>{
  const bad=input(0);
  bad.reviewMethod="";
  assert.throws(()=>planSeries1ValueReviews({release,definitions:cards,config:bad}),/common scoring method/);
  bad.reviewMethod="Compared two sources on same relative scale";
  bad.reviews[0].score="999";
  bad.reviews[0].sources=sources(0);
  bad.reviews[0].checkedAt="2026-11-04T17:00:00-05:00";
  assert.throws(()=>planSeries1ValueReviews({release,definitions:cards,config:bad}),/finite numeric score/);
});

test("no official roster manipulation or overwriting approved reviewed scores",()=>{
  const good=input(1);
  const noLongerDraft={...release,status:"active"};
  assert.throws(()=>planSeries1ValueReviews({release:noLongerDraft,definitions:cards,config:good}),/draft/);
  const absent=cards.slice(1);
  assert.throws(()=>planSeries1ValueReviews({release,definitions:absent,config:good}),/exactly 108/);
  const disabled=cards.map((c,i)=>i===0?{...c,enabled:false}:c);
  assert.throws(()=>planSeries1ValueReviews({release,definitions:disabled,config:good}),/enabled, approved/);
  const existing=cards.map((c,i)=>i===0?{...c,valueReview:{valueScore:20}}:c);
  assert.throws(()=>planSeries1ValueReviews({release,definitions:existing,config:good}),/overwrite/);
  const wrongRarity=input(1);
  wrongRarity.reviews[0].rarity="Rare";
  assert.throws(()=>planSeries1ValueReviews({release,definitions:cards,config:wrongRarity}),/mismatched official rarity/);
});
