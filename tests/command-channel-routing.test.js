import test from "node:test";
import assert from "node:assert/strict";
import {allowedCommandChannels,commandChannelRestriction} from "../services/command-channel-routing.js";

const command="123456789012345678";
const staff="234567890123456789";
const trial="345678901234567890";
const general="456789012345678901";
const settings={commandChannelId:command,activityGiveawayReviewChannelId:staff,survivalTrialChannelId:trial};

test("giveaway and giveaway-role run in the commands channel and private staff giveaway channel",()=>{
  for(const name of ["giveaway","giveaway-role"]){
    assert.deepEqual(allowedCommandChannels(name,settings),[command,staff]);
    assert.equal(commandChannelRestriction(name,command,settings),null);
    assert.equal(commandChannelRestriction(name,staff,settings),null);
    assert.match(commandChannelRestriction(name,trial,settings),new RegExp(staff));
    assert.match(commandChannelRestriction(name,general,settings),new RegExp(command));
  }
});

test("Court's Trial commands run in the Trial channel and existing commands channel, but not the giveaway staff channel",()=>{
  assert.deepEqual(allowedCommandChannels("trial",settings),[command,trial]);
  assert.equal(commandChannelRestriction("trial",command,settings),null);
  assert.equal(commandChannelRestriction("trial",trial,settings),null);
  assert.match(commandChannelRestriction("trial",staff,settings),/Court's Trial/);
  assert.match(commandChannelRestriction("trial",staff,settings),new RegExp(trial));
});

test("unrelated bot commands remain limited to the configured bot commands channel",()=>{
  for(const name of ["profile","shop","points","help","test-points"]){
    assert.deepEqual(allowedCommandChannels(name,settings),[command]);
    assert.equal(commandChannelRestriction(name,command,settings),null);
    assert.match(commandChannelRestriction(name,staff,settings),/Please use bot commands/);
    assert.match(commandChannelRestriction(name,trial,settings),new RegExp(command));
  }
});

test("a guild with only a staff giveaway channel can run giveaway commands there",()=>{
  const config={activityGiveawayReviewChannelId:staff};
  assert.equal(commandChannelRestriction("giveaway",staff,config),null);
  assert.match(commandChannelRestriction("giveaway",trial,config),new RegExp(staff));
});

test("a guild with only a Trial channel can run Trial commands there",()=>{
  const config={survivalTrialChannelId:trial};
  assert.equal(commandChannelRestriction("trial",trial,config),null);
  assert.match(commandChannelRestriction("trial",staff,config),new RegExp(trial));
});

test("shared channel IDs are not duplicated, and unchanged unset-channel behavior remains",()=>{
  const duplicate={commandChannelId:command,activityGiveawayReviewChannelId:command,survivalTrialChannelId:command};
  assert.deepEqual(allowedCommandChannels("giveaway",duplicate),[command]);
  assert.deepEqual(allowedCommandChannels("trial",duplicate),[command]);
  assert.equal(commandChannelRestriction("giveaway",general,{}),null);
  assert.equal(commandChannelRestriction("trial",general,{}),null);
  assert.equal(commandChannelRestriction("shop",general,{}),null);
});
