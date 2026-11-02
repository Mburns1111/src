import test from "node:test";
import assert from "node:assert/strict";
import {
  assignCourtMatchups, scoreCourtMatchup, courtRewardPlan,
  safeCourtText, COURT_PROMPTS, COURT_MATCHUPS_PER_PLAYER,
} from "../services/party-court-rules.js";

test("Court prompt bank uses original, distinct questions across every category", () => {
  assert.ok(COURT_PROMPTS.length >= 40);
  assert.equal(new Set(COURT_PROMPTS.map(p => p.text)).size, COURT_PROMPTS.length);
  for (const name of ["silly", "roblox", "fantasy"])
    assert.ok(COURT_PROMPTS.some(p => p.category === name));
});

for (const count of [1,2,3,4,5,6,19,20]) {
  test("court matchups assign TWO opponent groups per player, count " + count, () => {
    const players = Array.from({ length: count }, (_, i) => String(100000000000000001n + BigInt(i)));
    const rounds = assignCourtMatchups(players, 1, "mixed", [], () => 0.37);
    const assigned = rounds.flatMap(m => m.playerIds);
    assert.equal(COURT_MATCHUPS_PER_PLAYER, 2);
    assert.equal(assigned.length, count * 2);
    assert.deepEqual(new Set(assigned), new Set(players));
    for (const id of players) assert.equal(assigned.filter(p => p === id).length, 2);
    assert.equal(rounds.filter(m => m.playerIds.length === 3).length, count >= 3 ? (count % 2) * 2 : 0);
    assert.equal(rounds.filter(m => m.playerIds.length === 1).length, count === 1 ? 2 : 0);
    assert.equal(new Set(rounds.map(m => m.promptId)).size, rounds.length);
  });
}
test("rejects duplicate participants and invalid player limits", () => {
  assert.throws(() => assignCourtMatchups(["a","b","c","d","d"], 1), /distinct/);
  assert.throws(() => assignCourtMatchups([], 1), /1/);
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
test("completion rewards require two answered rounds, regardless of lobby size", () => {
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

test("final-round score then matchup wins break ties; exact ties share placement", () => {
  const players = [
    { userId:"a",score:2500,finalRound:1000,wins:2 },
    { userId:"b",score:2500,finalRound:1200,wins:1 },
    { userId:"c",score:2500,finalRound:1000,wins:2 },
    { userId:"d",score:2000,finalRound:900,wins:1 },
  ];
  const plan = courtRewardPlan(players, { a:3,b:3,c:3,d:3 }, 3);
  assert.deepEqual(plan.map(p=>[p.userId,p.placement]), [
    ["b",10],["a",6],["c",6],["d",0],
  ]);
});

test("solo Court game can reveal answers without a comparison or placement bonus", () => {
  const matchups = assignCourtMatchups(["solo"], 1, "silly", [], () => 0.2);
  assert.equal(matchups.length, 2);
  assert.deepEqual(matchups[0].playerIds, ["solo"]);
  assert.deepEqual(matchups[1].playerIds, ["solo"]);
  assert.deepEqual(scoreCourtMatchup(["solo"], [{ userId: "solo", text: "A funny answer" }], [], 1), {solo:0});
  assert.deepEqual(courtRewardPlan([{userId:"solo",score:0}], {solo:3}, 3), [
    {userId:"solo",completion:5,placement:0},
  ]);
  assert.deepEqual(courtRewardPlan([{userId:"solo",score:0}], {solo:1}, 3), []);
});
test("a two-player game forms one head-to-head matchup", () => {
  const matchups=assignCourtMatchups(["a","b"], 1);
  assert.equal(matchups.length, 2);
  assert.ok(matchups.every(m => m.playerIds.length === 2));
  assert.deepEqual(scoreCourtMatchup(["a","b"],[
    {userId:"a",text:"One"}, {userId:"b",text:"Two"},
  ],[],1),{a:500,b:500});
});
test("a three-player game forms one three-way matchup", () => {
  const matchups=assignCourtMatchups(["a","b","c"], 1);
  assert.equal(matchups.length, 2);
  assert.ok(matchups.every(m => m.playerIds.length === 3));
});

test("four and six players rotate opponents for their second matchup", () => {
  for (const count of [4, 6, 8]) {
    const ids = Array.from({length: count}, (_, i) => String(i + 1));
    const matches = assignCourtMatchups(ids, 1, "mixed", [], () => 0.3);
    const firstPass = matches.slice(0, count / 2);
    const secondPass = matches.slice(count / 2);
    for (const user of ids) {
      const initial = firstPass.find(m => m.playerIds.includes(user));
      const second = secondPass.find(m => m.playerIds.includes(user));
      assert.ok(initial && second);
      assert.notDeepEqual(initial.playerIds.slice().sort(), second.playerIds.slice().sort());
    }
  }
});
test("a round never repeats a prompt even after previous rounds exhaust most of the category", () => {
  const players = Array.from({length:20}, (_, i) => String(i));
  const usedIds = COURT_PROMPTS.filter(p => p.category === "roblox").slice(0, 29).map(p => p.id);
  const matches = assignCourtMatchups(players, 3, "roblox", usedIds, () => 0);
  assert.equal(matches.length, 20);
  assert.equal(new Set(matches.map(m => m.promptId)).size, 20);
});
