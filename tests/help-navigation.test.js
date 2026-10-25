import test from "node:test";
import assert from "node:assert/strict";
import {
  ApplicationCommandOptionType, MessageFlags,
} from "discord.js";
import {
  HELP_TOPICS, helpTopicPayload, execute, handleHelpTopicButton,
} from "../commands/help.js";

const userId="987654321012345678";
const guildId="908522799285538817";

function interaction(customId) {
  const calls=[];
  return {
    user:{id:userId},guildId, customId, calls,
    deferred:false,replied:false,
    inGuild:()=>true,
    async deferReply(payload){this.deferred=true;calls.push({action:"deferReply",payload});},
    async deferUpdate(){calls.push({action:"deferUpdate"});},
    async editReply(payload){calls.push({action:"editReply",payload});},
  };
}

test("member help menu presents exactly five topic buttons bound to its owner",()=>{
  const payload=helpTopicPayload("home",userId);
  assert.equal(payload.embeds.length,1);
  assert.equal(payload.components.length,1);
  const buttons=payload.components[0].toJSON().components;
  assert.equal(buttons.length,5);
  assert.deepEqual(buttons.map(b=>b.label),HELP_TOPICS.map(t=>t.label));
  assert.deepEqual(buttons.map(b=>b.custom_id),HELP_TOPICS.map(t=>"help:topic:"+t.id+":"+userId));
  assert.equal(buttons[0].disabled,true);
  assert.deepEqual(payload.allowedMentions,{parse:[]});
});

test("listings help explains the working photo picker and native video layout",()=>{
  const fields=helpTopicPayload("listings",userId).embeds[0].toJSON().fields;
  const combined=fields.map(f=>f.value).join(" ");
  assert.match(combined,/My house listings/);
  assert.match(combined,/My outfit listings/);
  assert.match(combined,/Choose photo/);
  assert.match(combined,/Videos remain playable above the styled card/);
  assert.match(combined,/Interested/);
});
test("shop and Points sections describe browsing, customization and balance",()=>{
  const shop=JSON.stringify(helpTopicPayload("shop",userId).embeds[0].toJSON());
  const points=JSON.stringify(helpTopicPayload("points",userId).embeds[0].toJSON());
  assert.match(shop,/shop browse/);
  assert.match(shop,/stickers/);
  assert.match(points,/shop balance/);
  assert.match(points,/server/);
});
test("all help pages respect Discord embed field caps",()=>{
  for(const item of HELP_TOPICS){
    const payload=helpTopicPayload(item.id,userId);
    const embed=payload.embeds[0].toJSON();
    assert.ok(embed.fields.length<=25);
    for(const field of embed.fields){
      assert.ok(field.value.length<=1024);
      assert.ok(field.name.length<=256);
    }
    assert.equal(payload.components[0].toJSON().components.filter(b=>b.disabled).length,1);
  }
});

test("slash /help acknowledges privately and does not query Mongo",async()=>{
  const i=interaction();
  await execute(i);
  assert.deepEqual(i.calls.map(c=>c.action),["deferReply","editReply"]);
  assert.equal(i.calls[0].payload.flags,MessageFlags.Ephemeral);
  assert.match(i.calls[1].payload.embeds[0].toJSON().title,/Getting started/);
});

test("a member can privately switch topics without creating another reply",async()=>{
  const i=interaction("help:topic:listings:"+userId);
  await handleHelpTopicButton(i);
  assert.deepEqual(i.calls.map(c=>c.action),["deferUpdate","editReply"]);
  assert.match(i.calls[1].payload.embeds[0].toJSON().title,/Houses, outfits/);
});

test("cross-user, malformed and prototype-key help controls are rejected before acknowledgement",async()=>{
  const values=[
    "help:topic:shop:123456789012345678",
    "help:topic:madeup:"+userId,
    "help:topic:constructor:"+userId,
    "help:topic:__proto__:"+userId,
    "help:topic:shop:"+userId+":extra",
  ];
  for(const customId of values){
    const i=interaction(customId);
    await assert.rejects(handleHelpTopicButton(i),/belongs to another member or has expired/);
    assert.deepEqual(i.calls,[]);
  }
  assert.throws(()=>helpTopicPayload("toString",userId),/no longer available/);
});

test("registered command help includes server commands and subcommands",async()=>{
  const i=interaction("help:topic:commands:"+userId);
  i.client={application:{commands:{fetch:async()=>new Map([
    ["profile",{name:"profile",description:"Profile",options:[]}],
    ["shop",{name:"shop",description:"Shop",options:[]}],
  ])}}};
  i.guild={commands:{fetch:async()=>new Map([
    ["shop",{name:"shop",description:"Server shop",options:[{
      type:ApplicationCommandOptionType.Subcommand,name:"balance",description:"Check balance",
    }]}],
  ])}};
  await handleHelpTopicButton(i);
  const content=i.calls.at(-1).payload.embeds[0].toJSON().fields.map(f=>f.value).join(" ");
  assert.match(content,/profile/);
  assert.match(content,/Server shop/);
  assert.match(content,/shop balance/);
});
test("registered-command API failures show fallback rather than breaking /help",async()=>{
  const i=interaction("help:topic:commands:"+userId);
  i.client={application:{commands:{fetch:async()=>{throw Error("offline")}}}};
  i.guild={commands:{fetch:async()=>new Map()}};
  const oldWarn=console.warn;
  console.warn=()=>{};
  try{
    await handleHelpTopicButton(i);
    const content=i.calls.at(-1).payload.embeds[0].toJSON().fields.map(f=>f.value).join(" ");
    assert.match(content,/couldn't load/);
  }finally{console.warn=oldWarn;}
});
