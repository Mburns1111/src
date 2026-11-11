import test from "node:test";
import assert from "node:assert/strict";
import {data as setupCommand} from "../commands/setup.js";
import {describeActivityGiveawaySetup} from "../commands/activity-giveaway-setup.js";
import {trialSetupSummary} from "../commands/trial-giveaway-setup.js";

const archiveId="123456789012345678";
const staffId="234567890123456789";

test("archive channel is selected through every giveaway setup, not a separate slash subcommand",()=>{
  const commands=setupCommand.toJSON().options.map(option=>option.name);
  for(const name of ["giveaways","activity-giveaways","trials"])
    assert.ok(commands.includes(name), name+" guided setup is available");
  assert.ok(!commands.includes("archives"), "standalone archive setup has been retired");
});

test("regular and activity setup summaries show the same mandatory archive",()=>{
  const settings={
    giveawayArchiveChannelId:archiveId,
    activityGiveawayReviewChannelId:staffId,
    activityClaimWindowHours:12,
    activityMaxAutoRerolls:2,
  };
  for(const mode of ["regular","activity"]){
    const description=describeActivityGiveawaySetup(settings,{mode});
    assert.match(description,/Private giveaway archive \(required\)/);
    assert.ok(description.includes("<#"+archiveId+">"));
  }
});

test("Court's Trial setup summary shows shared private archive",()=>{
  const text=trialSetupSummary({
    giveawayArchiveChannelId:archiveId,
    activityGiveawayReviewChannelId:staffId,
    trialClaimWindowMinutes:720,
    trialMaxAutoRerolls:2,
  });
  assert.match(text,/Private giveaway archive \(required\)/);
  assert.ok(text.includes("<#"+archiveId+">"));
});
