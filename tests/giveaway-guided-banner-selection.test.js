import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import {DEFAULT_CLAIM_INSTRUCTIONS} from "../services/giveaway-claims.js";
import GiveawayBanner from "../models/GiveawayBanner.js";
import {startTrialGiveawaySetup,handleTrialGiveawaySetupInteraction,trialGiveawaySetupReply} from "../commands/trial-giveaway-setup.js";
import {startRegularGiveawaySetup,startActivityGiveawaySetup,
  handleActivityGiveawaySetupInteraction,activityGiveawaySetupReply} from "../commands/activity-giveaway-setup.js";
import {registeredSetupBanners,bannerCatalogText,bannerUploadFromMessage} from "../services/giveaway-banner-setup.js";

const guildId="123456789012345678";
const trialId="234567890123456789",staffId="345678901234567890";
const listId="456789012345678901",winnersId="567890123456789012";
const attachment={
  name:"Violet Roses.png",size:5,contentType:"image/png",
  url:"https://cdn.discordapp.com/attachments/123/456/roses.png",
};

const original={
  config:GuildConfig.findOne,find:GiveawayBanner.find,
  exists:GiveawayBanner.exists,save:GiveawayBanner.findOneAndUpdate,fetch:globalThis.fetch,
};
let nextKey=1;
async function harness(mode,{banners=[]}={}){
  const suffix=String(nextKey++).padStart(6,"0");
  const userId="700000000000"+suffix;
  const channelId="800000000000"+suffix;
  const records=[],responses=[],updates=[];
  const values=banners.map(x=>({...x}));
  const sessionInfo={id:guildId,
  roles:{everyone:{id:guildId},fetch:async id=>({id})},
  members:{me:{id:"bot"}},
  channels:{fetch:async id=>({id,send:async()=>({id:"posted"}),
    permissionsFor:member=>({has:()=>member?.id!==guildId})})}};
  const channel={id:channelId,send:async payload=>{
    const id=String(900000000000000000n+BigInt(records.length+1));
    const message={id,...payload,edit:async change=>{Object.assign(message,change);return message;}};
    records.push(message);return message;
  }};
  const config={guildId,commandChannelId:channelId,serverTimeZone:"America/New_York",
    survivalTrialChannelId:trialId,activityGiveawayReviewChannelId:staffId,
    giveawayChannelId:trialId,giveawayArchiveChannelId:"678901234567890123",
    activityGiveawayListChannelId:listId,
    activityGiveawayWinnersChannelId:winnersId,
    activityParticipationRoleId:"678901234567890123",
    giveawayExcludedRoleId:"789012345678901234",trialDefaultBannerNameKey:"",
    giveawayDefaultBannerNameKey:""};
  GuildConfig.findOne=()=>({lean:async()=>config});
  GiveawayBanner.find=()=>({sort:()=>({limit:()=>({select:()=>({
    lean:async()=>values.slice().sort((a,b)=>a.nameKey.localeCompare(b.nameKey))
  })})})});
  GiveawayBanner.exists=async ({guildId:id,nameKey})=>id===guildId&&values.some(b=>b.nameKey===nameKey);
  GiveawayBanner.findOneAndUpdate=async (query,change)=>{
    updates.push({query,change});
    const name=change.$set.name, nameKey=query.nameKey;
    const index=values.findIndex(v=>v.nameKey===nameKey);
    const row={name,nameKey};
    if(index<0)values.push(row);else values[index]=row;
    return row;
  };
  globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3,4,5]).buffer});
  const starter=mode==="trial"?startTrialGiveawaySetup:
    mode==="regular"?startRegularGiveawaySetup:startActivityGiveawaySetup;
  const handler=mode==="trial"?handleTrialGiveawaySetupInteraction:handleActivityGiveawaySetupInteraction;
  const replyHandler=mode==="trial"?trialGiveawaySetupReply:activityGiveawaySetupReply;
  const prefix=mode==="trial"?"trialconfig":"actconfig";
  const identity={guildId,channelId,user:{id:userId},channel,guild:sessionInfo,
    editReply:async value=>responses.push(value)};
  await starter(identity);
  const current=()=>records.at(-1);
  const controls=()=>current().components.flatMap(row=>row.components.map(x=>x.toJSON()));
  const getSessionId=()=>controls()[0].custom_id.split(":")[1];
  const sessionId=getSessionId();
  const step=async(action,valuesForSelect=[])=>{
    const msg=current();
    await handler({customId:prefix+":"+sessionId+":"+action,guildId,channelId,
      user:{id:userId},message:{id:msg.id},memberPermissions:{has:()=>true},
      values:valuesForSelect,
      deferReply:async()=>{},editReply:async x=>responses.push(x),
      reply:async x=>responses.push(x)});
  };
  const goToBanner=async()=>{
    // Traverse the actual guided steps instead of assuming a fixed count:
    // the activity setup now includes a mandatory opt-in role.
    const atBanner=()=>controls().some(c=>c.label==="Upload New Banner");
    for(let i=0;i<24&&!atBanner();i++){
      assert.ok(controls().some(c=>/^Keep\b/i.test(c.label)),
        "Cannot advance through setup step: "+current().content);
      await step("keep");
    }
    assert.ok(atBanner(),"Wizard never reached the Default banner step: "+current().content);
    return current();
  };
  const sendReply=async({content="",attachment:upload=null})=>{
    const before=records.length;
    const msg={guildId,channelId,author:{id:userId,bot:false},content,
      attachments:upload?{size:1,first:()=>upload}:{size:0,first:()=>null}};
    assert.equal(replyHandler(msg),true);
    // Reply listeners dispatch asynchronous work; wait until the next prompt.
    for(let i=0;i<200&&records.length===before;i++)await new Promise(r=>setImmediate(r));
    assert.ok(records.length>before,"typing/uploading should show the next setup prompt");
  };
  return {identity,records,responses,updates,values,config,current,controls,step,
    goToBanner,sendReply,channelId};
}
function restore(){
  GuildConfig.findOne=original.config;GiveawayBanner.find=original.find;
  GiveawayBanner.exists=original.exists;GiveawayBanner.findOneAndUpdate=original.save;
  globalThis.fetch=original.fetch;
}
function assertReview(h,selectedName){
  assert.match(h.current().content,/Setup Review|Setup — Review/);
  assert.match(h.current().content,new RegExp(selectedName));
}
const roses=[{name:"Pink Roses",nameKey:"pink roses"},{name:"Moonlight",nameKey:"moonlight"}];

test("server banner catalog is sorted, guild-scoped, and displays saved names",async()=>{
  GuildConfig.findOne=original.config;
  GiveawayBanner.find=()=>({sort:()=>({limit:()=>({select:()=>({
    lean:async()=>roses
  })})})});
  try{
    const saved=await registeredSetupBanners(guildId);
    assert.equal(saved.length,2);
    assert.match(bannerCatalogText(saved),/Pink Roses/);
    assert.match(bannerCatalogText(saved),/Moonlight/);
    assert.match(bannerCatalogText([]),/None yet/);
  }finally{restore();}
});

test("regular giveaway setup includes the shared Giveaway Winners channel picker",async()=>{
 try{
  const h=await harness("regular");
  assert.match(h.current().content,/manual-entry giveaways/);
  await h.step("keep");
  assert.match(h.current().content,/\*\*Giveaway Winners\*\* channel/);
  assert.match(h.current().content,/both regular and activity giveaway results/);
  assert.ok(h.controls().some(c=>c.type===8),"The channel picker must appear in regular setup");
  await h.step("channel",[winnersId]);
  assert.match(h.current().content,/private, staff-only/);
  await h.goToBanner();
  await h.step("keep");
  assert.match(h.current().content,/Giveaway Winners/);
  assert.match(h.current().content,new RegExp(winnersId));
  await h.step("edit",["winners"]);
  assert.match(h.current().content,/Editing Giveaway Winners channel/);
  await h.step("keep");
  assert.match(h.current().content,/Setup — Review|Setup Review/);
  await h.step("cancel");
 }finally{restore();}
});

test("regular setup saves the shared Giveaway Winners channel without introducing another setting",async()=>{
 const originalSave=GuildConfig.findOneAndUpdate;
 try{
  const h=await harness("regular");
  const regularId="987654321098765432";
  const saved=[];
  h.identity.guild.members={me:{id:"bot"}};
  h.identity.guild.roles.fetch=async id=>({id});
  h.identity.guild.channels={fetch:async id=>({
   id,send:async()=>({id:"111111111111111111"}),
   permissionsFor:member=>({has:()=>member?.id!==guildId}),
  })};
  GuildConfig.findOneAndUpdate=async (query,changes)=>{
   saved.push({query,changes});Object.assign(h.config,changes.$set);
   return h.config;
  };
  await h.step("channel",[regularId]);
  await h.step("channel",[winnersId]);
  await h.goToBanner();
  await h.step("keep");
  await h.step("save");
  assert.equal(saved.length,1);
  assert.equal(saved[0].changes.$set.giveawayChannelId,regularId);
  assert.equal(saved[0].changes.$set.activityGiveawayWinnersChannelId,winnersId);
  assert.ok(!Object.hasOwn(saved[0].changes.$set,"giveawayWinnersChannelId"),
   "keep a single shared winners channel, compatible with existing settings");
  assert.match(h.current().content,/Regular giveaway setup saved/);
 }finally{GuildConfig.findOneAndUpdate=originalSave;restore();}
});

for(const mode of ["trial","regular","activity"]){
  test(mode+" setup offers an upload even when there are no saved banners",async()=>{
    try{
      const h=await harness(mode);
      await h.goToBanner();
      assert.match(h.current().content,/None yet/);
      assert.ok(h.controls().some(c=>c.label==="Upload New Banner"));
      assert.equal(h.controls().some(c=>c.type===3),false);
      await h.step("uploadBanner");
      assert.match(h.current().content,/4 MB/);
      await h.sendReply({attachment});
      assertReview(h,"violet roses");
      assert.equal(h.updates.length,1);
      assert.equal(h.updates[0].query.guildId,guildId);
      assert.equal(h.updates[0].query.nameKey,"violet roses");
      assert.equal(h.updates[0].change.$set.imageData.length,5);
      await h.step("cancel");
    }finally{restore();}
  });
  test(mode+" setup lists saved banners and selects directly without restarting setup",async()=>{
    try{
      const h=await harness(mode,{banners:roses});
      await h.goToBanner();
      assert.match(h.current().content,/Pink Roses/);
      assert.match(h.current().content,/Moonlight/);
      const select=h.controls().find(x=>x.type===3);
      assert.ok(select,"saved banners should be in a dropdown");
      assert.ok(select.options.some(x=>x.value==="pink roses"));
      await h.step("selectSavedBanner",["pink roses"]);
      assertReview(h,"pink roses");
      assert.doesNotMatch(h.current().content,/Step 1 of/);
      // Edit again from review, ensuring fromReview is respected.
      await h.step("edit",["banner"]);
      assert.match(h.current().content,/Editing Default banner/);
      await h.step("selectSavedBanner",["moonlight"]);
      assertReview(h,"moonlight");
      await h.step("cancel");
    }finally{restore();}
  });
  test(mode+" setup Back from banner upload returns to banner choices (including from review edit)",async()=>{
    try{
      const h=await harness(mode,{banners:roses});
      await h.goToBanner();
      await h.step("uploadBanner");
      assert.match(h.current().content,/4 MB/);
      await h.step("back");
      assert.match(h.current().content,/Pink Roses/);
      await h.step("selectSavedBanner",["moonlight"]);
      assertReview(h,"moonlight");
      await h.step("edit",["banner"]);
      assert.match(h.current().content,/Editing Default banner/);
      await h.step("uploadBanner");
      await h.sendReply({content:"Trial Night",attachment});
      assertReview(h,"trial night");
      await h.step("cancel");
    }finally{restore();}
  });
  test(mode+" setup accepts a typed saved name and returns to review, not step one",async()=>{
    try{
      const h=await harness(mode,{banners:roses});
      await h.goToBanner();
      await h.step("chooseBanner");
      assert.match(h.current().content,/Pink Roses/);
      assert.match(h.current().content,/Moonlight/);
      await h.sendReply({content:"Pink Roses"});
      assertReview(h,"pink roses");
      assert.doesNotMatch(h.current().content,/Step 1 of/);
      await h.step("cancel");
    }finally{restore();}
  });
}

test("upload name can come from same-message caption and invalid files stay rejected",()=>{
 assert.equal(bannerUploadFromMessage({content:"Court Roses",
   attachments:{first:()=>attachment}}).name,"Court Roses");
 assert.equal(bannerUploadFromMessage({content:"",
   attachments:{first:()=>attachment}}).name,"Violet Roses");
 assert.throws(()=>bannerUploadFromMessage({content:"A name",attachments:{first:()=>null}}),/Attach/);
 assert.throws(()=>bannerUploadFromMessage({content:"default",attachments:{first:()=>attachment}}),/name/);
 assert.throws(()=>bannerUploadFromMessage({content:"x".repeat(61),
   attachments:{first:()=>attachment}}),/1–60/);
});

for(const mode of ["regular","activity","trial"]){
  test(mode+" server setup shows current built-in claim instructions and exposes direct editing from review",async()=>{
    try{
      const h=await harness(mode);
      await h.goToBanner();
      await h.step("keep");
      assert.match(h.current().content,/Setup Review|Setup — Review/);
      assert.ok(h.current().content.includes(DEFAULT_CLAIM_INSTRUCTIONS),
        "review should show the exact built-in default claim instructions");
      assert.ok(h.controls().some(c=>c.label==="Edit Claim Instructions"));
      await h.step("editClaims");
      assert.match(h.current().content,/Built-in default/i);
      assert.ok(h.current().content.includes(DEFAULT_CLAIM_INSTRUCTIONS));
      assert.ok(h.controls().some(c=>/Write \/ Edit .*Instructions/.test(c.label)),
        "there should be an explicit action to type custom server instructions");
      await h.step(mode==="trial"?"writeInstructions":"custom");
      assert.match(h.current().content,/custom claim instructions/i);
      await h.sendReply({content:"Create a private ticket in #claim-here and provide your Roblox username."});
      assert.match(h.current().content,/Setup Review|Setup — Review/);
      assert.match(h.current().content,/Create a private ticket in #claim-here/);
      await h.step("cancel");
    }finally{restore();}
  });
}
