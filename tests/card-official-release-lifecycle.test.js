import test from "node:test";
import assert from "node:assert/strict";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardArtwork from "../models/CardArtwork.js";
import { activateRelease, checkOfficialReleaseReadiness, transitionRelease,
  assignReleaseArtwork, setReleasePetEnabled } from "../services/card-global-releases.js";

const release = { releaseId: "s1-r1", status: "draft", seriesId: "series-1",
  hatchOdds: { Common:26, Uncommon:26, Rare:26, "Ultra-Rare":14, Legendary:8 },
  achievementSecrets: [], eggImageFileId:null, eggImageUrl:"" };

test("official readiness blocks draft releases with missing reviewed artwork and secrets", async () => {
  const old = { release:CardRelease.findOne, definitions:CardDefinition.find };
  try {
    CardRelease.findOne = () => ({lean:async()=>release});
    CardDefinition.find = () => ({lean:async()=>[]});
    const check = await checkOfficialReleaseReadiness({releaseId:"s1-r1"});
    assert.equal(check.usable,0);
    assert.ok(check.problems.some(x=>/No enabled cards/.test(x)));
    assert.ok(check.problems.some(x=>/egg artwork/i.test(x)));
    assert.ok(check.problems.some(x=>/At least six owner-authored release secrets/.test(x)));
    await assert.rejects(()=>activateRelease({releaseId:"s1-r1"}),/Release not ready/);
  } finally { CardRelease.findOne=old.release; CardDefinition.find=old.definitions; }
});

test("only license-approved artwork is assignable to a draft", async () => {
  const old = { release:CardRelease.findOne, artwork:CardArtwork.findOne, def:CardDefinition.updateOne };
  try {
    CardRelease.findOne = () => ({lean:async()=>release});
    CardArtwork.findOne = () => ({lean:async()=>null});
    await assert.rejects(()=>assignReleaseArtwork({releaseId:"s1-r1",kind:"pet",
      key:"unreviewed",petId:"cow"}),/approved license review/);
    let changes=0;
    CardArtwork.findOne = () => ({lean:async()=>({key:"approved-cow",kind:"pet",artistCredit:"Artist",licenseReviewStatus:"approved"})});
    CardDefinition.updateOne = async (q,update) => {
      assert.equal(q.releaseId,"s1-r1");
      assert.equal(q.petId,"cow");
      assert.equal(update.$set.artStatus,"approved");changes++;
      return {modifiedCount:1};
    };
    await assignReleaseArtwork({releaseId:"s1-r1",kind:"pet",key:"approved-cow",petId:"cow"});
    assert.equal(changes,1);
  } finally { CardRelease.findOne=old.release; CardArtwork.findOne=old.artwork;
    CardDefinition.updateOne=old.def; }
});

test("approved pet art is required before enabling a draft definition", async () => {
  const old={release:CardRelease.findOne,card:CardDefinition.findOne,exists:CardArtwork.exists,update:CardDefinition.updateOne};
  try {
    CardRelease.findOne=()=>({lean:async()=>release});
    CardDefinition.findOne=()=>({lean:async()=>({_id:"card-id",petId:"cow",artStatus:"missing"})});
    await assert.rejects(()=>setReleasePetEnabled({releaseId:"s1-r1",petId:"cow",enabled:true}),/Approve and assign/);
    CardDefinition.findOne=()=>({lean:async()=>({_id:"card-id",petId:"cow",artStatus:"approved",petArtworkKey:"cow-art",artistCredit:"Artist"})});
    CardArtwork.exists=async()=>false;
    await assert.rejects(()=>setReleasePetEnabled({releaseId:"s1-r1",petId:"cow",enabled:true}),/license/);
    CardArtwork.exists=async()=>true;
    CardDefinition.updateOne=async()=>({modifiedCount:1});
    assert.equal((await setReleasePetEnabled({releaseId:"s1-r1",petId:"cow",enabled:true})).enabled,true);
  } finally {CardRelease.findOne=old.release;CardDefinition.findOne=old.card;
    CardArtwork.exists=old.exists;CardDefinition.updateOne=old.update;}
});

test("pausing and resuming are reversible but retirement is final", async () => {
  const old=CardRelease.findOneAndUpdate;
  const stages=["active","paused","active","retired"];
  let at=0;
  try {
    CardRelease.findOneAndUpdate=(query, update)=>({
      lean:async()=>{
        const allowed=Array.isArray(query.status?.$in)?query.status.$in:[query.status];
        if(!allowed.includes(stages[at]))return null;
        stages[at]=update.$set.status;at++;
        return {status:update.$set.status};
      }
    });
    assert.equal((await transitionRelease({releaseId:"s1-r1",action:"pause"})).status,"paused");
    assert.equal((await transitionRelease({releaseId:"s1-r1",action:"resume"})).status,"active");
    assert.equal((await transitionRelease({releaseId:"s1-r1",action:"retire"})).status,"retired");
    await assert.rejects(()=>transitionRelease({releaseId:"s1-r1",action:"resume"}),/not in a state/);
  } finally { CardRelease.findOneAndUpdate=old; }
});
