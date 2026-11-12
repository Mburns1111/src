import test from "node:test";
import assert from "node:assert/strict";
import {helpTopicPayload,STAFF_TOPICS} from "../commands/help.js";

const userId="123456789012345678";

test("Staff Help introduces setup and highlights Bot Setup in blue",()=>{
  const staff=helpTopicPayload("staff",userId);
  assert.match(staff.embeds[0].data.description,/Complete Bot Setup first/);
  const selects=staff.components.flatMap(row=>row.components)
    .filter(component=>component.data.type===3);
  const setup=selects.flatMap(component=>component.data.options||[])
    .find(option=>option.label==="Bot Setup");
  assert.ok(setup);
  assert.equal(setup.value,"ssetup");
  assert.ok(STAFF_TOPICS.some(topic=>topic.id==="ssetup"&&topic.label==="Bot Setup"));
});

test("Bot Setup covers the whole bot and includes required private archives",()=>{
  const payload=helpTopicPayload("ssetup",userId);
  const embed=payload.embeds[0].toJSON();
  const fields=embed.fields||[];
  assert.equal(fields.length,7);
  assert.match(fields[0].value,/\*\*Bot Commands Channel\*\*/i);
  assert.match(fields[1].value,/Profiles/i);
  assert.match(fields[1].value,/Shop/);
  assert.match(fields[2].value,/Hatchem/);
  assert.match(fields[3].value,/Party Games/);
  assert.match(fields[4].value,/Archives/);
  assert.match(fields[4].value,/required/i);
  assert.match(fields[6].value,/\/setup trials/);
});

test("Giveaway help distinguishes claims from delivery and includes Trials",()=>{
  const payload=helpTopicPayload("sgiveaways",userId);
  const fields=payload.embeds[0].toJSON().fields||[];
  assert.match(fields[0].value,/Court.s Trial/);
  assert.match(fields[4].value,/A completed claim does not mean delivery is confirmed/i);
  assert.match(fields[5].value,/Archive Giveaway/);
});
