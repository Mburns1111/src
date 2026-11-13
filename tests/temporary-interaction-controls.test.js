import test from "node:test";
import assert from "node:assert/strict";
import {MessageFlags} from "discord.js";
import {
 isTemporaryPanel,showTemporaryPanel,acknowledgeTemporaryAction,finishTemporaryAction,
} from "../services/temporary-interaction-controls.js";

const temporary={flags:{has:flag=>flag===MessageFlags.Ephemeral}};
const publicMessage={flags:{has:()=>false}};

test("private menus update the existing ephemeral message instead of stacking another",async()=>{
 const calls=[];
 const interaction={message:temporary,
   update:async payload=>calls.push(["update",payload]),
   reply:async payload=>calls.push(["reply",payload])};
 await showTemporaryPanel(interaction,{content:"Next step",components:[]});
 assert.deepEqual(calls,[["update",{content:"Next step",components:[]}]]);
});

test("button input on a permanent staff card creates a private panel without modifying the card",async()=>{
 const calls=[];
 const interaction={message:publicMessage,
   update:async payload=>calls.push(["update",payload]),
   reply:async payload=>calls.push(["reply",payload])};
 assert.equal(isTemporaryPanel(interaction),false);
 await showTemporaryPanel(interaction,{content:"Private choice",components:[]});
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],"reply");
 assert.equal(calls[0][1].flags,MessageFlags.Ephemeral);
});

test("private confirmation acknowledges via message update and clears all controls",async()=>{
 const calls=[];
 const interaction={message:temporary,
   deferUpdate:async()=>calls.push(["deferUpdate"]),
   deferReply:async()=>calls.push(["deferReply"]),
   editReply:async payload=>calls.push(["editReply",payload])};
 assert.equal(await acknowledgeTemporaryAction(interaction),true);
 await finishTemporaryAction(interaction,"Completed");
 assert.deepEqual(calls,[
  ["deferUpdate"],["editReply",{content:"Completed",components:[]}]
 ]);
});

test("permanent message confirm does not update that public message",async()=>{
 const calls=[];
 const interaction={message:publicMessage,
   deferUpdate:async()=>calls.push(["deferUpdate"]),
   deferReply:async payload=>calls.push(["deferReply",payload]),
   editReply:async payload=>calls.push(["editReply",payload])};
 assert.equal(await acknowledgeTemporaryAction(interaction),false);
 await finishTemporaryAction(interaction,{content:"Completed",allowedMentions:{parse:[]}});
 assert.deepEqual(calls,[
  ["deferReply",{flags:MessageFlags.Ephemeral}],
  ["editReply",{content:"Completed",allowedMentions:{parse:[]},components:[]}]
 ]);
});

test("an unknown or missing flags property never authorizes editing permanent UI",async()=>{
 assert.equal(isTemporaryPanel({message:{id:"public"}}),false);
 assert.equal(isTemporaryPanel({}),false);
 const calls=[];
 await showTemporaryPanel({message:{id:"public"},
  reply:async x=>calls.push(x)}, {content:"Safe"});
 assert.equal(calls[0].flags,MessageFlags.Ephemeral);
});
