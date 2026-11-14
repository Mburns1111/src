import test from "node:test";
import assert from "node:assert/strict";
import {cleanRegularDisplayText,cleanRegularDisplayTitle,renderRegularDisplayText}
  from "../services/giveaway-display-text.js";
import {giveawayAnnouncement} from "../services/giveaways.js";

const creator="567890123456789012",winner="678901234567890123";
const fixture=(overrides={})=>({
  _id:"507f1f77bcf86cd799439999",mode:"standard",status:"open",
  creatorId:creator,title:"Special Prize",prize:"Mystery Egg",
  description:"Details stay visible",rules:"Stay in the server",
  winnerCount:1,entrantIds:[],winnerIds:[],claimResolvedSlots:[],
  requiredRoleId:"",endsAt:new Date(Date.now()+60000),
  ...overrides
});
const display=record=>giveawayAnnouncement(record).embeds[0].toJSON().description;

test("manual regular giveaways replace only opening story text, not mandatory details",()=>{
  const s=display(fixture({displayEntryText:"A royal invitation from {host}!"}));
  assert.match(s,/A royal invitation/);
  assert.match(s,new RegExp(creator));
  assert.doesNotMatch(s,/fox whispers/i);
  for(const required of ["Mystery Egg","Details stay visible","Stay in the server","Hosted by:","Winners:","Ends:"])
    assert.ok(s.includes(required),required+" should remain visible");
});

test("winner story persists after settling or rerolling a regular giveaway",()=>{
  for(const status of ["ended","rerolling"]){
    const announcement=giveawayAnnouncement(fixture({status,winnerIds:[winner],entrantIds:[winner],
      displayWinnerText:"{winners} won the court's prize from {host}!"}));
    const s=announcement.embeds[0].toJSON().description;
    assert.match(s,/won the court's prize/);
    assert.ok(s.includes("<@"+winner+">"));
    assert.ok(s.includes("<@"+creator+">"));
    const resultField=announcement.embeds[0].toJSON().fields.find(f=>f.name==="🏆 Winners / Results");
    assert.ok(resultField,"the winner list belongs in one dedicated results field");
    assert.match(resultField.value,new RegExp(winner));
    assert.doesNotMatch(s,/\*\*Winners \/ Results\*\*|\*\*Winner ticket claims\*\*/);
  }
});

test("no-winner result and activity giveaways retain their established text",()=>{
  const noWinner=display(fixture({status:"ended",displayWinnerText:"Never replace no-winner text"}));
  assert.match(noWinner,/No eligible winner/);
  assert.doesNotMatch(noWinner,/Never replace/);
  const activity=display(fixture({mode:"activity",displayEntryText:"Custom entry should not apply"}));
  assert.doesNotMatch(activity,/Custom entry should not apply/);
});

test("default messages remain when custom text is empty",()=>{
  assert.match(display(fixture()),/fox whispers/i);
  assert.match(display(fixture({status:"ended",winnerIds:[winner],entrantIds:[winner]})),/fox cackles/i);
});

test("display text length and arbitrary mentions are sanitized, placeholders remain",()=>{
  assert.throws(()=>cleanRegularDisplayText("x".repeat(401)),/400 characters/);
  assert.equal(cleanRegularDisplayText("  Hey @everyone  "),"Hey ＠everyone");
  assert.equal(renderRegularDisplayText("Hello {host}, winner {winners}, @here",
    {hostId:creator,winnerIds:[winner,winner]}),
    "Hello <@"+creator+">, winner <@"+winner+">, ＠here");
});

test("regular giveaway open and winner heading titles use their saved snapshots",()=>{
  const open=giveawayAnnouncement(fixture({displayOpenTitle:"The Royal Prize"})).embeds[0].toJSON();
  assert.equal(open.title,"The Royal Prize");
  const ended=giveawayAnnouncement(fixture({status:"ended",winnerIds:[winner],entrantIds:[winner],
    displayEndedTitle:"The Royal Verdict"})).embeds[0].toJSON();
  assert.equal(ended.title,"The Royal Verdict");
  assert.match(ended.description,/fox cackles/i);
});

test("blank display title keeps the original fox headings and does not affect activity giveaways",()=>{
  assert.equal(giveawayAnnouncement(fixture()).embeds[0].toJSON().title,"🦊 The Fox’s Giveaway");
  assert.equal(giveawayAnnouncement(fixture({status:"ended",winnerIds:[winner],entrantIds:[winner]}))
    .embeds[0].toJSON().title,"🦊 Heist Complete");
  assert.notEqual(giveawayAnnouncement(fixture({mode:"activity",displayOpenTitle:"Other"}))
    .embeds[0].toJSON().title,"Other");
  assert.throws(()=>cleanRegularDisplayTitle("A".repeat(121)),/120 characters/);
});
