import test from "node:test";
import assert from "node:assert/strict";
import {
  assignCourtMatchups, scoreCourtMatchup, courtRewardPlan,
  safeCourtText, COURT_PROMPTS,
} from "../services/party-court-rules.js";

test("Court prompt bank uses original, distinct questions across every category", () => {
  assert.ok(COURT_PROMPTS.length >= 40);
  assert.equal(new Set(COURT_PROMPTS.map(p => p.text)).size, COURT_PROMPTS.length);
  for (const name of ["silly", "roblox", "fantasy"])
    assert.ok(COURT_PROMPTS.some(p => p.category === name));
});

for (const count of [4,5,6,19,20]) {
  test("court matchups assign exactly one opponent group per player, count " + count, () => {
    const players = Array.from({ length: count }, (_, i) => String(100000000000000001n + BigInt(i)));
    const rounds = assignCourtMatchups(players, 1, "mixed", [], () => 0.37);
    const assigned = rounds.flatMap(m => m.playerIds);
    assert.equal(assigned.length, count);
    assert.equal(new Set(assigned).size, count);
    assert.deepEqual(new Set(assigned), new Set(players));
    assert.equal(rounds.filter(m => m.playerIds.length === 3).length, count % 2);
    assert.equal(new Set(rounds.map(m => m.promptId)).size, rounds.length);
  });
}
test("rejects duplicate participants and invalid player limits", () => {
  assert.throws(() => assignCourtMatchups(["a","b","c","d","d"], 1), /distinct/);
  assert.throws(() => assignCourtMatchups(["a","b","c"], 1), /4/);
  assert.throws(() => assignCourtMatchups(Array.from({length:21}, (_,i)=>String(i)), 1), /20/);
});
test("prior prompts are excluded while enough choices remain", () => {
  const players = ["a","b","c","d"];
  const first = assignCourtMatchups(players, 1, "roblox", [], () => 0);
  const second = assignCourtMatchups(players, 2, "roblox", first.map(p=>p.promptId), () => 0);
  assert.equal(second.filter(m => first.some(p => p.promptId === m.promptId)).length, 0);
});
test("vote shares calculate a proportional score, not raw vote totals", () => {
  const answers = [{userId:"a",text:"one"},{userId:"b",text:"two"}];
  const votes = [{voterId:"c",targetId:"a"},{voterId:"d",targetId:"a"},{voterId:"e",targetId:"b"}];
  assert.deepEqual(scoreCourtMatchup(["a","b"],answers,votes,1),{a:667,b:333});
  assert.deepEqual(scoreCourtMatchup(["a","b"],answers,votes,3),{a:1333,b:667});
});
test("a player cannot influence their own match and unanswered prompts forfeit", () => {
  const answers = [{userId:"a",text:"one"},{userId:"b",text:"two"}];
  assert.deepEqual(scoreCourtMatchup(["a","b"],answers,[{voterId:"a",targetId:"a"},{voterId:"b",targetId:"b"}],1),{a:500,b:500});
  assert.deepEqual(scoreCourtMatchup(["a","b"],[answers[0]],[{voterId:"c",targetId:"a"}],1),{a:0,b:0});
});
test("three-way matchups split equally on no votes", () => {
  const p=["a","b","c"];
  const answers=p.map(userId=>({userId,text:"answer"}));
  assert.deepEqual(scoreCourtMatchup(p,answers,[],1),{a:333,b:333,c:333});
});
test("completion rewards require two answered rounds and four players", () => {
  const players=["a","b","c","d"].map((userId,i)=>({userId,score:100-i}));
  const answers={a:3,b:2,c:1,d:2};
  assert.deepEqual(courtRewardPlan(players,answers,3).map(p=>[p.userId,p.completion,p.placement]),
    [["a",5,10],["b",5,6],["d",5,3]]);
  assert.deepEqual(courtRewardPlan(players,answers,1),[]);
  assert.deepEqual(courtRewardPlan(players,answers,3,2),[]);
});
test("user-supplied text is constrained and cannot ping everyone", () => {
  const text = safeCourtText("@everyone **hello**");
  assert.doesNotMatch(text, /@everyone/);
  assert.ok(text.includes("\\*"));
  assert.ok(text.length < 160);
});
