import test from "node:test";
import assert from "node:assert/strict";
import {PermissionFlagsBits} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayBanner from "../models/GiveawayBanner.js";
import {data as giveawayCommand,execute as giveawayExecute} from "../commands/giveaway.js";
import {regularGiveawayWizardInteraction,regularGiveawayWizardReply}
  from "../commands/regular-giveaway-wizard.js";

const guildId="123456789012345678",
  publicId="345678901234567890",staffId="456789012345678901",
  owner="567890123456789012",pingId="678901234567890123";
const recordId="507f1f77bcf86cd799439999";
const old={
  config:GuildConfig.findOne,create:Giveaway.create,update:Giveaway.updateOne,
  find:GiveawayBanner.find,exists:GiveawayBanner.exists,
  upsert:GiveawayBanner.findOneAndUpdate,fetch:globalThis.fetch,
  intent:process.env.ENABLE_MESSAGE_CONTENT_INTENT,
};
function restore(){
  GuildConfig.findOne=old.config;Giveaway.create=old.create;
  Giveaway.updateOne=old.update;GiveawayBanner.find=old.find;
  GiveawayBanner.exists=old.exists;GiveawayBanner.findOneAndUpdate=old.upsert;
  globalThis.fetch=old.fetch;
  if(old.intent===undefined)delete process.env.ENABLE_MESSAGE_CONTENT_INTENT;
  else process.env.ENABLE_MESSAGE_CONTENT_INTENT=old.intent;
}
let nonce=0;
async function harness({defaultRole="",storedBanners=[]}={}){
  // Different invocation channel per test prevents a failed test leaving a
  // previously open wizard session for later tests.
  const commandsId=String(230000000000000000n+BigInt(++nonce));
  process.env.ENABLE_MESSAGE_CONTENT_INTENT="1";
  const prompts=[],publicPosts=[],staffPosts=[],writes=[],replies=[];
  const banners=storedBanners.slice();
  let n=0;
  const send=(list)=>async payload=>{
    const id=String(900000000000000000n+BigInt(++n));
    const msg={id,content:payload.content||"",components:payload.components||[],
      embeds:payload.embeds||[],...payload,url:"https://discord.com/channels/"+guildId+"/"+publicId+"/"+id};
    list.push(msg);return msg;
  };
  const commandChannel={id:commandsId,send:send(prompts)};
  const publicChannel={id:publicId,isTextBased:()=>true,send:send(publicPosts)};
  const staffChannel={id:staffId,messages:{fetch:async()=>({find:()=>null})},
    send:send(staffPosts),permissionsFor:role=>({has:permission=>
      role?.id!==guildId||permission!==PermissionFlagsBits.ViewChannel})};
  const config={
    guildId,commandChannelId:commandsId,giveawayChannelId:publicId,
    activityGiveawayReviewChannelId:staffId,
    giveawayPingRoleId:pingId,giveawayDefaultRequiredRoleId:defaultRole,
    giveawayDefaultBannerNameKey:"",activityClaimWindowHours:12,activityMaxAutoRerolls:2,
  };
  GuildConfig.findOne=()=>({
    then:(resolve,reject)=>Promise.resolve(config).then(resolve,reject),
    lean:async()=>config,select:()=>({lean:async()=>config})
  });
  GiveawayBanner.find=()=>({sort:()=>({limit:()=>({select:()=>({lean:async()=>banners})})})});
  GiveawayBanner.exists=async({nameKey})=>banners.some(b=>b.nameKey===nameKey);
  GiveawayBanner.findOneAndUpdate=async(q,update)=>{
    const found=banners.find(b=>b.nameKey===q.nameKey);
    if(found)Object.assign(found,{name:update.$set.name});
    else banners.push({nameKey:q.nameKey,name:update.$set.name});
    return {};
  };
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3,4,5]).buffer});
  Giveaway.create=async values=>{
    writes.push(values);
    return {...values,_id:recordId,toObject:()=>({...values,_id:recordId})};
  };
  Giveaway.updateOne=async()=>({modifiedCount:1});
  const guild={
    id:guildId,roles:{everyone:{id:guildId},fetch:async id=>({id})},
    members:{me:{id:"bot"},fetch:async()=>({
      id:owner,user:{id:owner},permissions:{has:b=>b===PermissionFlagsBits.ManageGuild},
      roles:{cache:new Map()}
    })},
    channels:{fetch:async id=>({[publicId]:publicChannel,[staffId]:staffChannel})[id]||null}
  };
  const client={user:{id:"bot"},channels:{fetch:async id=>
    ({[publicId]:publicChannel,[staffId]:staffChannel})[id]||null}};
  const interaction={guild,guildId,channelId:commandsId,channel:commandChannel,client,
    user:{id:owner},
    memberPermissions:{has:b=>b===PermissionFlagsBits.ManageGuild},
    options:{getSubcommand:()=>"start",getString:()=>null},
    editReply:async response=>replies.push(response)};
  await giveawayExecute(interaction);
  assert.match(String(replies.at(-1)),/setup has opened/i);
  const prompt=()=>prompts.filter(p=>p.content?.includes("Regular giveaway creation")).at(-1);
  const controls=()=>prompt().components.flatMap(row=>row.components.map(x=>x.toJSON()));
  const sessionId=controls()[0].custom_id.split(":")[1];
  const select=async(action,values=[])=>{
    const msg=prompt();
    const response=[];
    await regularGiveawayWizardInteraction({
      customId:"regularstart:"+sessionId+":"+action,message:{id:msg.id},
      channelId:commandsId,guildId,user:{id:owner},client,
      values,deferUpdate:async()=>{},reply:async x=>response.push(x)
    });
    assert.equal(response.length,0,"current staff controls should be accepted");
  };
  const type=async(content,attachment)=>{
    const before=prompts.length;
    assert.equal(regularGiveawayWizardReply({guildId,channelId:commandsId,
      author:{id:owner,bot:false},content,client,
      attachments:attachment?{size:1,first:()=>attachment}:{size:0,first:()=>null}
    }),true);
    for(let i=0;i<250&&prompts.length===before;i++)
      await new Promise(resolve=>setImmediate(resolve));
    assert.ok(prompts.length>before,
      "input should show the next prompt; last messages: "+
      prompts.slice(-3).map(m=>m.content?.slice(0,100)).join(" | "));
    // The channel send is published before the async wizard finally clears
    // its busy flag. Yield once so the next typed answer is not discarded.
    await new Promise(resolve=>setImmediate(resolve));
  };
  async function reachReview(){
    await type("TEST R1 — Regular");
    await type("TEST ONLY - No actual prize");
    await select("clearDescription");
    await select("minutes:2");
    await select("winners:1");
    await select("roleNone");
    await select("keep"); // Show role help setting
    await select("clearRules");
    await select("claim:1");
    await select("claimDefault");
    await select("bannerDefault");
    assert.match(prompt().content,/Review regular giveaway before posting/);
  }
  return {prompt,prompts,controls,select,type,reachReview,banners,publicPosts,
    staffPosts,writes,replies,client};
}

test("regular giveaway start has no old slash fields or plan editing subcommands",()=>{
  const options=giveawayCommand.toJSON().options;
  assert.deepEqual(options.find(x=>x.name==="start").options||[],[]);
  assert.ok(options.some(x=>x.name==="activity"));
  assert.ok(!options.some(x=>/^plan-|^prize-(add|edit|remove|move)$/.test(x.name)));
  assert.ok(options.some(x=>x.name==="banner-save"));
});

test("guided regular giveaway posts only after review and produces regular entry buttons",async()=>{
  try{
    const h=await harness();
    assert.match(h.prompt().content,/Step 1/);
    assert.equal(h.publicPosts.length,0,"no public giveaway before confirmation");
    await h.reachReview();
    assert.equal(h.publicPosts.length,0);
    const before=h.prompts.length;
    await h.select("preview");
    assert.equal(h.prompts.length,before+1,"preview appears in invoking command channel");
    const preview=h.prompts.at(-1);
    assert.match(preview.content,/PREVIEW/i);
    assert.deepEqual(preview.allowedMentions,{parse:[]});
    assert.equal(h.publicPosts.length,0);
    await h.select("post");
    assert.equal(h.writes.length,1);
    assert.equal(h.writes[0].mode,"standard");
    assert.equal(h.writes[0].winnerCount,1);
    assert.equal(h.writes[0].requiredRoleId,"");
    assert.equal(h.writes[0].claimWindowHours,1);
    assert.equal(h.publicPosts.length,1);
    assert.equal(h.publicPosts[0].content,"<@&"+pingId+">");
    assert.deepEqual(h.publicPosts[0].allowedMentions,{parse:[],roles:[pingId]});
    assert.equal(h.publicPosts[0].components[0].components[0].data.label,"Enter Giveaway");
    assert.equal(h.staffPosts.length,1,"staff record was posted separately");
  }finally{restore();}
});

test("review editing returns to review, not step one, and can change winner count",async()=>{
  try{
    const h=await harness();
    await h.reachReview();
    await h.select("edit",["winners"]);
    assert.match(h.prompt().content,/Editing Number of winners/);
    await h.select("winners:2");
    assert.match(h.prompt().content,/Review regular giveaway before posting/);
    assert.match(h.prompt().content,/Winners:\*\* 2/);
    await h.select("cancel");
    assert.equal(h.publicPosts.length,0);
  }finally{restore();}
});

test("banner chooser lists saved banners and can select one in guided start",async()=>{
  try{
    const h=await harness({storedBanners:[{name:"Pink Roses",nameKey:"pink roses"}]});
    await h.reachReview();
    await h.select("edit",["banner"]);
    assert.match(h.prompt().content,/Pink Roses/);
    assert.ok(h.controls().some(x=>x.type===3&&x.options.some(o=>o.value==="pink roses")));
    await h.select("selectBanner",["pink roses"]);
    assert.match(h.prompt().content,/Review regular giveaway before posting/);
    assert.match(h.prompt().content,/pink roses/);
    await h.select("cancel");
  }finally{restore();}
});

test("banner upload is available with empty catalog, saved by caption, and returns to review",async()=>{
  try{
    const h=await harness();
    await h.reachReview();
    await h.select("edit",["banner"]);
    assert.match(h.prompt().content,/None yet/);
    assert.ok(h.controls().some(x=>x.label==="Upload New Banner"));
    await h.select("uploadBanner");
    assert.match(h.prompt().content,/4 MB/);
    await h.type("Court Night",{
      name:"image.png",size:5,contentType:"image/png",
      url:"https://cdn.discordapp.com/attachments/123/456/test.png",
    });
    assert.match(h.prompt().content,/Review regular giveaway before posting/);
    assert.match(h.prompt().content,/court night/);
    assert.ok(h.banners.some(x=>x.nameKey==="court night"));
    await h.select("cancel");
  }finally{restore();}
});
