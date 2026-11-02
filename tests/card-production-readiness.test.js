import test from "node:test";
import assert from "node:assert/strict";
import { cardGameMode, isCardGameEnabled, isCardGameTestMode,
  validateCardGameMode } from "../services/card-game-mode.js";
import { validateRuntimeConfiguration } from "../services/runtime-configuration.js";
import { buildCardCommandRegistration } from "../services/card-command-registration.js";
import { data as cardsCommand, ownerCardOptions, execute as executeCards } from "../commands/cards.js";
import { data as cardsAdminCommand } from "../commands/cards-admin.js";
import { data as cardsOwnerCommand, cardsReleaseCommand,
  RELEASE_LIFECYCLE_SUBCOMMANDS } from "../commands/cards-owner.js";

const OWNER="123456789012345678";
const token="not-a-real-token";
const base={DISCORD_TOKEN:token,DISCORD_CLIENT_ID:OWNER,
  MONGODB_URI:"mongodb+srv://test:password@host.mongodb.net/test",
  ENABLE_MESSAGE_CONTENT_INTENT:"1",CARD_GAME_OWNER_DISCORD_ID:OWNER};
const registration=env=>buildCardCommandRegistration({
  env,playerCards:cardsCommand,cardsAdminCommand,cardsOwnerCommand,
  cardsReleaseCommand,ownerCardOptions,releaseSubcommands:RELEASE_LIFECYCLE_SUBCOMMANDS,
});

test("Hatchem is off by default, and live/test modes are independently explicit",()=>{
  assert.equal(cardGameMode({}),"disabled");
  assert.equal(cardGameMode({ENABLE_CARD_GAME_TEST:"1"}),"test");
  assert.equal(cardGameMode({ENABLE_CARD_GAME:"1"}),"production");
  assert.equal(isCardGameEnabled({ENABLE_CARD_GAME:"1"}),true);
  assert.equal(isCardGameTestMode({ENABLE_CARD_GAME:"1"}),false);
  assert.equal(isCardGameEnabled({}),false);
  assert.throws(()=>cardGameMode({ENABLE_CARD_GAME:"1",ENABLE_CARD_GAME_TEST:"1"}),/exactly one Hatchem mode/);
});

test("live mode rejects missing owner configuration, missing privileged text intent and mixed switches",()=>{
  const live={...base,ENABLE_CARD_GAME:"1"};
  assert.equal(validateCardGameMode(live),"production");
  assert.equal(validateRuntimeConfiguration({mode:"bot",env:live}).mode,"bot");
  assert.equal(validateRuntimeConfiguration({mode:"register",env:live}).mode,"register");
  assert.throws(()=>validateRuntimeConfiguration({mode:"bot",env:{...live,CARD_GAME_OWNER_DISCORD_ID:""}}),/CARD_GAME_OWNER_DISCORD_ID/);
  assert.throws(()=>validateRuntimeConfiguration({mode:"register",env:{...live,ENABLE_MESSAGE_CONTENT_INTENT:"0"}}),/ENABLE_MESSAGE_CONTENT_INTENT/);
  assert.throws(()=>validateRuntimeConfiguration({mode:"bot",env:{...live,ENABLE_CARD_GAME_TEST:"1"}}),/exactly one Hatchem mode/);
  assert.equal(validateRuntimeConfiguration({mode:"bot",env:{...base,ENABLE_CARD_GAME_TEST:"1"}}).mode,"bot");
});

test("production registers real Hatchem commands globally, but no testing commands",()=>{
  const commands=registration({...base,ENABLE_CARD_GAME:"1"});
  assert.deepEqual(commands.testGuildCardCommands,[]);
  assert.deepEqual(commands.globalCardCommands.map(x=>x.name),
    ["cards","cards-admin","cards-owner","cards-release"]);
  const owner=commands.globalCardCommands.find(x=>x.name==="cards-owner");
  assert.equal(owner.default_member_permissions,"0");
  const ownerTools=new Set(owner.options.map(x=>x.name));
  for(const production of ["releases","create-release","art-upload","art-review","art-info","art-list"])
    assert.ok(ownerTools.has(production),production+" is required to manage live art and releases");
  for(const devOnly of ["test-drop","egg-art-upload","art-assign"])
    assert.equal(ownerTools.has(devOnly),false,"production exposes "+devOnly);
  const release=commands.globalCardCommands.find(x=>x.name==="cards-release");
  assert.deepEqual(release.options.map(x=>x.name),RELEASE_LIFECYCLE_SUBCOMMANDS);
  for(const cmd of commands.globalCardCommands){
    assert.ok(cmd.options.length<=25,cmd.name+" exceeds Discord limit");
  }
});

test("development registers only in test guild and retains owner testing commands",()=>{
  const commands=registration({...base,ENABLE_CARD_GAME_TEST:"1"});
  assert.deepEqual(commands.globalCardCommands,[]);
  assert.deepEqual(commands.testGuildCardCommands.map(x=>x.name),
    ["cards","cards-admin","cards-owner","cards-release"]);
  const owner=commands.testGuildCardCommands.find(x=>x.name==="cards-owner");
  for(const name of ["test-drop","egg-art-upload","art-assign","art-review"])
    assert.ok(owner.options.some(x=>x.name===name),name);
  const off=registration(base);
  assert.deepEqual(off.globalCardCommands,[]);
  assert.deepEqual(off.testGuildCardCommands,[]);
});

test("live Hatchem rejects a forged test-drop interaction without touching data",async()=>{
  const previous={live:process.env.ENABLE_CARD_GAME,test:process.env.ENABLE_CARD_GAME_TEST};
  try{
    process.env.ENABLE_CARD_GAME="1";
    delete process.env.ENABLE_CARD_GAME_TEST;
    let reply="";
    await executeCards({
      user:{id:OWNER},options:{getSubcommand:()=>"test-drop"},
      editReply:response=>{reply=response;},
    });
    assert.match(reply,/Test drops are available on the development bot only/);
  }finally{
    if(previous.live===undefined)delete process.env.ENABLE_CARD_GAME;
    else process.env.ENABLE_CARD_GAME=previous.live;
    if(previous.test===undefined)delete process.env.ENABLE_CARD_GAME_TEST;
    else process.env.ENABLE_CARD_GAME_TEST=previous.test;
  }
});
