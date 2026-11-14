import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import GuildConfig from "../models/GuildConfig.js";
import {startGuidedGuildSetup} from "../commands/general-card-setup.js";

const guildId="123456789012345678";
const commandsId="234567890123456789";

test("initial General Setup refuses a publicly readable Bot Commands wizard",async()=>{
 const old=GuildConfig.findOne;
 try{
  GuildConfig.findOne=()=>({lean:async()=>null});
  const guild={id:guildId,roles:{everyone:{id:guildId}}};
  await assert.rejects(()=>startGuidedGuildSetup({
   guild,guildId,channelId:commandsId,
   memberPermissions:{has:()=>true},user:{id:"345678901234567890"},
   channel:{id:commandsId,permissionsFor:()=>({has:()=>true})}
  }),/private staff-only text channel hidden from @everyone/);
 }finally{GuildConfig.findOne=old;}
});

test("display text modal submissions reach the same activity/regular setup handler as its buttons",()=>{
 const index=readFileSync(new URL("../index.js",import.meta.url),"utf8");
 const at=index.indexOf('interaction.customId.startsWith("actconfig:")');
 assert.ok(at>0,"setup handler must be routed");
 const branch=index.slice(at-220,at+190);
 assert.match(branch,/interaction\.isModalSubmit\(\)/);
 assert.match(branch,/handleActivityGiveawaySetupInteraction\(interaction\)/);
});

test("opening Help never automatically creates a member profile",()=>{
 const index=readFileSync(new URL("../index.js",import.meta.url),"utf8");
 const start=index.indexOf("// Profiles are optional");
 const end=index.indexOf("].includes(interaction.commandName)",start);
 assert.ok(start>0&&end>start);
 assert.match(index.slice(start,end),/helpCommand\.name/);
});

test("public Help and scheduled-ping dashboard use distinct optional General Setup fields",async()=>{
 const {generalSetupFields}=await import("../commands/general-card-setup.js");
 assert.ok(generalSetupFields.includes("helpChannelId"));
 assert.ok(generalSetupFields.includes("scheduledPingsChannelId"));
 assert.equal(generalSetupFields.indexOf("helpChannelId")>2,true);
});
