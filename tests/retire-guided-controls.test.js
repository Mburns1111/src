import test from "node:test";
import assert from "node:assert/strict";
import {retireGuidedControls} from "../services/retire-guided-controls.js";

test("a previous guided prompt keeps history but loses all buttons and select menus",async()=>{
 const edits=[];
 const old={id:"123",edit:async payload=>{edits.push(payload);}};
 assert.equal(await retireGuidedControls(old),true);
 assert.deepEqual(edits,[{components:[]}]);
});
test("a saved prompt ID can be fetched after a wizard reply or process restart",async()=>{
 const edits=[];
 const old={id:"345"};
 const channel={messages:{fetch:async id=>{
   assert.equal(id,"345");return {id,edit:async payload=>edits.push(payload)};
 }}};
 assert.equal(await retireGuidedControls(old,channel),true);
 assert.deepEqual(edits,[{components:[]}]);
});
test("missing or inaccessible old prompt never interrupts the next wizard step",async()=>{
 assert.equal(await retireGuidedControls(null),false);
 assert.equal(await retireGuidedControls({id:"456"}),false);
 const oldWarn=console.warn;
 try{
   console.warn=()=>{};
   assert.equal(await retireGuidedControls({id:"456",edit:async()=>{throw Error("Forbidden");}}),false);
 }finally{console.warn=oldWarn;}
});
