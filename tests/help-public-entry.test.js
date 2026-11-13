import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import {ensurePublicHelpEntry,handlePublicHelpEntry} from "../commands/help.js";

const guildId="123456789012345678",channelId="234567890123456789";
test("public Help posts one persistent entry button and refreshes rather than duplicating",async()=>{
 const original={find:GuildConfig.findOne,update:GuildConfig.updateOne};
 const config={helpChannelId:channelId,helpMessageId:""};
 const sends=[],edits=[];
 const message={id:"345678901234567890",author:{id:"bot"},
   edit:async payload=>{edits.push(payload);}};
 const channel={send:async payload=>{sends.push(payload);return message;},
   messages:{fetch:async id=>id===message.id?message:null}};
 const client={user:{id:"bot"},channels:{fetch:async id=>{
   assert.equal(id,channelId);return channel;
 }}};
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>config})});
  GuildConfig.updateOne=async(q,change)=>{Object.assign(config,change.$set);};
  assert.equal(await ensurePublicHelpEntry(client,guildId),true);
  assert.equal(sends.length,1);
  assert.equal(sends[0].components[0].components[0].data.custom_id,"help:open");
  assert.equal(await ensurePublicHelpEntry(client,guildId),true);
  assert.equal(sends.length,1);
  assert.equal(edits.length,1);
 }finally{
  GuildConfig.findOne=original.find;
  GuildConfig.updateOne=original.update;
 }
});

test("public Help opens a private menu without a profile or a public follow-up",async()=>{
 const calls=[];
 await handlePublicHelpEntry({
  guildId,user:{id:"345678901234567890"},
  deferReply:async arg=>calls.push(["defer",arg]),
  editReply:async arg=>calls.push(["edit",arg]),
 });
 assert.equal(calls.length,2);
 assert.ok(calls[0][1].flags);
 assert.ok(calls[1][1].components.length>0);
 assert.equal(calls[1][1].components[0].components[0].data.custom_id.startsWith("help:topic:"),true);
});
