import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import PointsLedger from "../models/PointsLedger.js";
import {
  AchievementControl, AchievementEvent, CardAcquisition, AchievementDiscovery,
  AchievementReleaseFirst,
} from "../models/CardAchievementState.js";
import {isUnrankedCardGameCreator} from "../services/card-owner-access.js";
import {grantAchievement,recordAchievementEvent} from "../services/card-achievement-engine.js";
import {achievementPages} from "../services/card-achievements.js";
import {parseHatchemText} from "../services/hatchem-text-commands.js";
import {
  safeCreatorRewardForfeiture,previewCreatorAchievementReset,resetCreatorAchievements,
} from "../services/card-creator-reset.js";

const creator="123456789012345678";
async function inProduction(callback) {
  const previous={...process.env};
  try {
    process.env.CARD_GAME_OWNER_DISCORD_ID=creator;
    process.env.ENABLE_CARD_GAME="1";
    process.env.ENABLE_CARD_GAME_TEST="0";
    return await callback();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    for (const [key,value] of Object.entries(previous)) process.env[key]=value;
  }
}
const chain=result=>({session(){return this;},lean:async()=>result,sort(){return this;},select(){return this;}});
const stub=(restores,obj,key,fn)=>{restores.push([obj,key,obj[key]]);obj[key]=fn;};

test("only the real production owner is unranked; test bot can still verify achievements",async()=>{
  await inProduction(async()=>{
    assert.equal(isUnrankedCardGameCreator(creator),true);
    assert.equal(isUnrankedCardGameCreator("222222222222222222"),false);
    assert.deepEqual(parseHatchemText(".creatorreset CONFIRM"),
      {action:"creatorreset",options:{mode:"CONFIRM"}});
    assert.equal(await grantAchievement({userId:creator}),null);
    assert.equal(await recordAchievementEvent({userId:creator},null),undefined);
    const rows=[];rows.wallet={bonusGrabs:0,bonusDrops:0};rows.unranked=true;
    assert.match(achievementPages(rows)[0],/Creator account · unranked/);
    process.env.ENABLE_CARD_GAME="0";
    process.env.ENABLE_CARD_GAME_TEST="1";
    assert.equal(isUnrankedCardGameCreator(creator),false);
  });
});

test("never remove purchased extras during owner reset even if award usage is ambiguous",()=>{
  const awards=[{rewardGrantedAt:new Date(),rewardGrabs:4,rewardDrops:3}];
  const wallet={bonusGrabs:4,bonusDrops:3};
  assert.deepEqual(safeCreatorRewardForfeiture({
    awards,wallet,purchases:[{sourceId:"grab",amount:-20},{sourceId:"drop",amount:-40}],
  }).forfeit,{grab:2,drop:1});
  assert.deepEqual(safeCreatorRewardForfeiture({
    awards,wallet,purchases:[{sourceId:"grab",amount:-15}],
  }).forfeit,{grab:0,drop:0});
});

test("creator reset is forbidden for any non-owner before database access",async()=>{
  await inProduction(async()=>{
    await assert.rejects(resetCreatorAchievements("222222222222222222"),/Only the configured live/);
    await assert.rejects(previewCreatorAchievementReset("222222222222222222"),/Only the configured live/);
  });
});

test("transactional creator reset leaves other ranks intact, reopens creator-only firsts and preserves paid extras",async()=>{
  await inProduction(async()=>{
    const restores=[],deleted=[],counterEdits=[],firsts=[];
    const badges=[
      {discordUserId:creator,key:"first-hatch",discoveryNumber:1,rewardGrantedAt:new Date(),rewardGrabs:1,rewardDrops:0},
      {discordUserId:creator,key:"crown-jewel",discoveryNumber:1,rewardGrantedAt:new Date(),rewardGrabs:3,rewardDrops:1},
    ];
    const wallet={bonusGrabs:4,bonusDrops:3};
    stub(restores,mongoose,"startSession",async()=>({
      withTransaction:async callback=>callback(),endSession:async()=>{},
    }));
    stub(restores,AchievementControl,"updateOne",async()=>({matchedCount:1}));
    stub(restores,CardAchievement,"find",q=>{
      assert.equal(q.discordUserId,creator);return chain(badges);
    });
    stub(restores,CardAchievement,"findOne",q=>{
      assert.ok(!("discordUserId" in q)); // don't rewrite other player awards
      return chain(q.key==="crown-jewel"?{discoveryNumber:2}:null);
    });
    stub(restores,CardAchievement,"deleteMany",async q=>{
      assert.deepEqual(q,{discordUserId:creator});deleted.push("badges");return {deletedCount:2};
    });
    stub(restores,AchievementEvent,"deleteMany",async q=>{
      assert.deepEqual(q,{userId:creator});deleted.push("events");return {deletedCount:2};
    });
    stub(restores,CardAcquisition,"deleteMany",async q=>{
      assert.deepEqual(q,{userId:creator});deleted.push("acquisitions");return {deletedCount:1};
    });
    stub(restores,AchievementReleaseFirst,"deleteMany",async q=>{
      assert.deepEqual(q,{userId:creator});deleted.push("firsts");return {deletedCount:1};
    });
    stub(restores,AchievementDiscovery,"updateOne",async(q,u)=>{
      counterEdits.push(["set",q._id,u.$set.value]);
    });
    stub(restores,AchievementDiscovery,"deleteOne",async(q)=>{
      counterEdits.push(["delete",q._id]);
    });
    stub(restores,CardCollector,"findOne",q=>{
      assert.deepEqual(q,{discordUserId:creator});return chain(wallet);
    });
    stub(restores,CardCollector,"updateOne",async(q,u)=>{
      assert.equal(q.discordUserId,creator);
      firsts.push(u.$inc);
      return {matchedCount:1};
    });
    stub(restores,PointsLedger,"find",q=>{
      assert.equal(q.discordUserId,creator);
      return chain([{sourceId:"grab",amount:-20},{sourceId:"drop",amount:-40}]);
    });
    try {
      const result=await resetCreatorAchievements(creator);
      assert.equal(result.badges,2);
      assert.deepEqual(deleted,["badges","events","acquisitions","firsts"]);
      assert.deepEqual(counterEdits,[["delete","first-hatch"],["set","crown-jewel",2]]);
      assert.deepEqual(firsts,[{bonusGrabs:-2,bonusDrops:-1}]);
      assert.equal(result.purchasedExtrasProtected,true);
      // No CardCopy, PointsWallet, cards, releases or other user records touched.
    } finally {
      for(const [obj,key,fn] of restores.reverse()) obj[key]=fn;
    }
  });
});
