import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayActivityCount from "../models/GiveawayActivityCount.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import {recordGiveawayMessage} from "../services/giveaway-activity-counter.js";
import {recordGuidedMessage} from "../services/guided-activity.js";
import {
  activityParticipationRole,memberHasActivityParticipationRole,eligibleActivityParticipant,
} from "../services/activity-participation.js";

const guildId="123456789012345678";
const memberId="234567890123456789";
const role="345678901234567890";

function testMessage(roles,fetchCounter) {
  const member={id:memberId,roles:{cache:new Map(roles.map(id=>[id,{}]))}};
  return {
    guildId,author:{id:memberId,bot:false},webhookId:null,
    guild:{members:{fetch:async options=>{
      fetchCounter.push(options);
      return member;
    }}},
  };
}
function stubConfig(config) {
  const previous=GuildConfig.findOne;
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>config})});
  return ()=>{GuildConfig.findOne=previous;};
}

test("activity opt-in is separate from regular giveaway required roles",()=>{
  assert.equal(activityParticipationRole({
    giveawayDefaultRequiredRoleId:role,
  }),"");
  assert.equal(activityParticipationRole({
    giveawayDefaultRequiredRoleId:"999999999999999999",
    activityParticipationRoleId:role,
  }),role);
  assert.equal(memberHasActivityParticipationRole({roles:{cache:new Map([[role,{}]])}},role),true);
  assert.equal(memberHasActivityParticipationRole({roles:{cache:new Map()}},role),false);
  assert.equal(memberHasActivityParticipationRole(null,role),false);
});

test("nothing is recorded when the activity opt-in role was never configured",async()=>{
  const restore=stubConfig({giveawayDefaultRequiredRoleId:role});
  const checks=[];
  try{
    assert.equal(await eligibleActivityParticipant(testMessage([role],checks)),null);
    assert.equal(checks.length,0,"a normal giveaway entry role does not opt in to activity tracking");
  }finally{restore();}
});

test("member participation is checked for every new message, including when a role is removed",async()=>{
  const restore=stubConfig({activityParticipationRoleId:role});
  const checks=[];
  try {
    const optedIn=testMessage([role],checks);
    const [first,retry]=await Promise.all([
      eligibleActivityParticipant(optedIn),eligibleActivityParticipant(optedIn),
    ]);
    assert.equal(first.roleId,role);
    assert.equal(retry.roleId,role);
    assert.equal(checks.length,1,"both giveaway counters share one role lookup for the same message");
    assert.deepEqual(checks[0],{user:memberId,force:true});

    assert.equal(await eligibleActivityParticipant(testMessage([],checks)),null,
      "removing the role immediately stops future message recording");
    assert.equal(checks.length,2);

    assert.equal((await eligibleActivityParticipant(testMessage([role],checks))).roleId,role,
      "reclaiming the role starts counting only new messages");
    assert.equal(checks.length,3);
  }finally{restore();}
});

test("role lookup failures fail closed and never count an unverified participant",async()=>{
  const restore=stubConfig({activityParticipationRoleId:role});
  try{
    const message=testMessage([role],[]);
    message.guild.members.fetch=async()=>{throw Error("Discord is unavailable");};
    assert.equal(await eligibleActivityParticipant(message),null);
  }finally{restore();}
});

test("non-opted-in members generate no legacy counters or guided receipts",async()=>{
  const restore=stubConfig({activityParticipationRoleId:role});
  const beforeCount=GiveawayActivityCount.updateOne;
  const beforeMinute=GiveawayActivityMinuteCount.updateOne;
  let writes=0;
  try{
    GiveawayActivityCount.updateOne=async()=>{writes++;};
    GiveawayActivityMinuteCount.updateOne=async()=>{writes++;};
    const message={
      ...testMessage([],[]),
      channelId:"456789012345678901",channel:{isTextBased:()=>true},
      content:"Hello from someone who has not opted in.",
      createdAt:new Date("2026-11-11T16:00:00Z"),
      id:"567890123456789012",
    };
    await recordGiveawayMessage(message);
    await recordGuidedMessage(message);
    assert.equal(writes,0);
  }finally{
    GiveawayActivityCount.updateOne=beforeCount;
    GiveawayActivityMinuteCount.updateOne=beforeMinute;
    restore();
  }
});
