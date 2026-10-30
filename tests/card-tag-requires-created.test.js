import test from "node:test";
import assert from "node:assert/strict";
import CardCollector from "../models/CardCollector.js";
import CardCopy from "../models/CardCopy.js";
import { requireSavedCardTag } from "../services/card-tag-catalog.js";
import { updateOwnedCardTag } from "../services/card-collection-summary.js";

test("EVERY tag name must be created first; no hardcoded blocked words", async () => {
  const orig=CardCollector.findOne;
  try {
    CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:["cute","Very Cute","favorites"]})})});
    for (const tag of ["noooo","random","cats","sparkles","Not Created","test","cute extra"]) {
      await assert.rejects(()=>requireSavedCardTag("owner",tag),/Create it first/);
    }
    for (const tag of ["cute","CUTE","Very Cute","vErY cUtE","favorites"]) {
      assert.equal(await requireSavedCardTag("owner",tag),tag.toLocaleLowerCase());
    }
  } finally {CardCollector.findOne=orig;}
});

test("an existing tag on a card does not grant permission to create a new tag implicitly", async () => {
  const original={collector:CardCollector.findOne,copy:CardCopy.findOne,update:CardCopy.updateMany};
  let changed=0;
  try {
    CardCollector.findOne=()=>({select:()=>({lean:async()=>({createdTagNames:["cute"]})})});
    CardCopy.findOne=()=>({lean:async()=>({
      _id:"id1",publicId:"Abc12",tag:"oldcase",cardDefinitionId:"def1",
      ownerDiscordUserId:"owner",state:"owned",
    })});
    CardCopy.updateMany=()=>{changed++;throw Error("Must not modify an unsaved tag");};
    await assert.rejects(()=>updateOwnedCardTag({
      discordUserId:"owner",cardId:"Abc12",tag:"invented name",
    }),/Create it first/);
    assert.equal(changed,0);
  } finally {
    CardCollector.findOne=original.collector;CardCopy.findOne=original.copy;
    CardCopy.updateMany=original.update;
  }
});
