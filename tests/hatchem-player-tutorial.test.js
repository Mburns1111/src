import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { MessageFlags } from "discord.js";
import {
  HATCHEM_TUTORIAL_PAGES, TUTORIAL_BUTTON_PREFIX, hatchemTutorialEntryRow,
  hatchemTutorialPage, handleHatchemTutorialButton, sendHatchemTutorial,
} from "../commands/card-tutorial-ui.js";
import {
  HATCHEM_GUIDE, HATCHEM_HELP, parseHatchemText,
} from "../services/hatchem-text-commands.js";

const envKey="ENABLE_CARD_GAME_TEST",otherKey="ENABLE_CARD_GAME";
async function inMode(callback){
  const a=process.env[envKey],b=process.env[otherKey];
  try{
    process.env[envKey]="1"; delete process.env[otherKey];
    return await callback();
  } finally {
    if(a===undefined)delete process.env[envKey];else process.env[envKey]=a;
    if(b===undefined)delete process.env[otherKey];else process.env[otherKey]=b;
  }
}

test("a short, optional tutorial explains every player mechanic in correct order",()=>{
  assert.equal(HATCHEM_TUTORIAL_PAGES.length,6);
  const whole=HATCHEM_TUTORIAL_PAGES.map(p=>p.title+"\n"+p.description).join("\n");
  for(const command of [".register",".drop",".cooldowns",".collection",".inventory",
    ".view",".lock",".upgrade",".burn",".dustupgrade",".trade",".give",".shop",".achievements",".help"]){
    assert.ok(whole.includes(command),command+" should be explained in tutorial");
  }
  for(const detail of ["75 seconds","12 meaningful messages","20% chance","15 minutes","5-minute",
    "4 matching Normal","4 matching Neons","10 Points","20 Points","Card role"]){
    assert.ok(whole.includes(detail),detail+" should be taught");
  }
  assert.match(whole,/gets priority/i);
  assert.match(whole,/refunded/i);
  assert.doesNotMatch(whole,/test-s1|test-drop|CARD_GAME_OWNER|cards-owner/);
  assert.match(HATCHEM_GUIDE,/Learn to Play/);
  assert.match(HATCHEM_HELP,/\.tutorial/);
});

test("tutorial can be opened by anyone without registering or consuming actions",async()=>{
  assert.deepEqual(parseHatchemText(".tutorial"),{action:"tutorial",options:{}});
  assert.equal(parseHatchemText(".TUTORIAL")?.action,"tutorial");
  assert.equal(parseHatchemText("tutorial"),null);
  const b=hatchemTutorialEntryRow().toJSON().components[0];
  assert.equal(b.custom_id,TUTORIAL_BUTTON_PREFIX+"open");
  assert.equal(b.label,"Learn to Play");
  assert.equal(b.style,1);
  const source=await fs.readFile(new URL("../commands/card-tutorial-ui.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/CardCollector|CardCopy|GuildConfig|\$inc|claimCardActionCooldown|\.register\(/);
});

test("all six screens are Discord-sized, navigable, and have safe allowed mentions",()=>{
  for(let i=0;i<HATCHEM_TUTORIAL_PAGES.length;i++){
    const payload=hatchemTutorialPage(i);
    assert.deepEqual(payload.allowedMentions,{parse:[]});
    assert.equal(payload.embeds.length,1);
    assert.equal(payload.components.length,1);
    const e=payload.embeds[0].toJSON(),buttons=payload.components[0].toJSON().components;
    assert.ok(e.description.length<=4096);
    assert.match(e.footer.text,new RegExp("Page "+(i+1)+" of 6"));
    assert.equal(buttons.length,3);
    assert.equal(buttons[0].disabled,i===0);
    assert.equal(buttons[1].label,i===5?"Finish":"Next");
    assert.equal(buttons[1].custom_id,i===5?"cards:tutorial:close":"cards:tutorial:page:"+(i+1));
  }
  assert.throws(()=>hatchemTutorialPage(-1),/Invalid/);
  assert.throws(()=>hatchemTutorialPage(6),/Invalid/);
});

test("guide button opens private page, Next edits privately, Finish ends cleanly",async()=>{
  await inMode(async()=>{
    let replied,updated;
    const base={isButton:()=>true,inGuild:()=>true,
      reply:async payload=>{replied=payload;},update:async payload=>{updated=payload;}};
    assert.equal(await handleHatchemTutorialButton({...base,customId:"cards:tutorial:open"}),true);
    assert.equal(replied.flags,MessageFlags.Ephemeral);
    assert.match(replied.embeds[0].toJSON().title,/Welcome/);
    assert.equal(await handleHatchemTutorialButton({...base,customId:"cards:tutorial:page:1"}),true);
    assert.match(updated.embeds[0].toJSON().title,/Eggs/);
    assert.equal(updated.components.length,1);
    assert.equal(await handleHatchemTutorialButton({...base,customId:"cards:tutorial:close"}),true);
    assert.deepEqual(updated.embeds,[]);
    assert.deepEqual(updated.components,[]);
    assert.equal(await handleHatchemTutorialButton({...base,customId:"cards:tutorial:page:99"}),true);
    assert.match(replied.content,/isn\u0027t available/);
  });
});

test("the fifth Learn to Play page advances to page six and Finish closes it",async()=>{
  await inMode(async()=>{
    const updates=[];
    const interaction={
      isButton:()=>true,
      update:async payload=>updates.push(payload),
      reply:async()=>{ throw Error("Should update the existing tutorial"); },
    };
    await handleHatchemTutorialButton({...interaction,customId:"cards:tutorial:page:4"});
    assert.match(updates.at(-1).embeds[0].toJSON().footer.text,/Page 5 of 6/);
    assert.equal(updates.at(-1).components[0].toJSON().components[1].custom_id,
      "cards:tutorial:page:5");
    await handleHatchemTutorialButton({...interaction,customId:"cards:tutorial:page:5"});
    assert.match(updates.at(-1).embeds[0].toJSON().footer.text,/Page 6 of 6/);
    await handleHatchemTutorialButton({...interaction,customId:"cards:tutorial:close"});
    assert.deepEqual(updates.at(-1).embeds,[]);
    assert.deepEqual(updates.at(-1).components,[]);
  });
});

test("Next page buttons promptly acknowledge clicks before rendering each screen",async()=>{
  await inMode(async()=>{
    const calls=[];
    const interaction={
      isButton:()=>true,
      deferUpdate:async()=>{calls.push({type:"defer"});},
      editReply:async payload=>{calls.push({type:"edit",payload});},
      update:async()=>{throw Error("Direct update should not be used when deferUpdate is available");},
    };
    for(const index of [1,2,3,4,5]){
      calls.length=0;
      await handleHatchemTutorialButton({...interaction,customId:"cards:tutorial:page:"+index});
      assert.deepEqual(calls.map(call=>call.type),["defer","edit"]);
      assert.match(calls[1].payload.embeds[0].toJSON().footer.text,
        new RegExp("Page "+(index+1)+" of 6"));
    }
    calls.length=0;
    await handleHatchemTutorialButton({...interaction,customId:"cards:tutorial:close"});
    assert.deepEqual(calls.map(call=>call.type),["defer","edit"]);
    assert.deepEqual(calls[1].payload.embeds,[]);
  });
});

test("typed tutorial always offers the private in-channel button without sending DMs",async()=>{
  const sent=[],replies=[];
  const message={author:{send:async payload=>sent.push(payload)},
    reply:async payload=>replies.push(payload)};
  await sendHatchemTutorial(message);
  assert.equal(sent.length,0,"private tutorial must not send a DM");
  assert.equal(replies.length,1);
  assert.match(replies[0].content,/private Hatchem tutorial/i);
  assert.equal(replies[0].components[0].toJSON().components[0].custom_id,"cards:tutorial:open");
});

test("the setup guide and live button routing are wired without expanding /cards slash subcommands",async()=>{
  const setup=await fs.readFile(new URL("../commands/setup.js",import.meta.url),"utf8");
  const index=await fs.readFile(new URL("../index.js",import.meta.url),"utf8");
  assert.match(setup,/components: \[hatchemTutorialEntryRow\(\)\]/);
  assert.match(index,/startsWith\("cards:tutorial:"\)/);
  assert.match(index,/handleHatchemTutorialButton\(interaction\)/);
});
