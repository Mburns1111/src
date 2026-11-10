import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import {data as setupCommand} from "../commands/setup.js";
import {activityWizardPrompts,defaultActivityWizardSettings} from "../commands/activity-wizard.js";
import {describeActivityGiveawaySetup,claimAnnouncementPreview,currentGiveawayClaimInstructions} from "../commands/activity-giveaway-setup.js";
import {validateTicketClaim} from "../services/giveaway-ticket-claims.js";
import {giveawayAnnouncement} from "../services/giveaways.js";
import {giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";
import {DEFAULT_CLAIM_INSTRUCTIONS,DEFAULT_MAX_AUTO_REROLLS,automaticRerollLimit,automaticRerollsUsed,
  prizeClaimLines} from "../services/giveaway-claims.js";
import {GUIDED_EDIT_FIELDS,validateGuidedStaffEdit} from "../services/guided-staff-actions.js";

const guild="123456789012345678";
const ticketLink="https://discord.com/channels/123456789012345678/234567890123456789/345678901234567890?tab=messages&jump=true";
const claimSettings={
 activityGiveawayListChannelId:"123456789012345678",
 activityGiveawayWinnersChannelId:"234567890123456789",
 activityGiveawayReviewChannelId:"345678901234567890",
 activityClaimInstructions:"Open #tickets and include your Roblox username.",
 activityClaimWindowHours:12,
 activityMaxAutoRerolls:2,
 activityNotificationRoleIds:["456789012345678901","567890123456789012"],
 activityAnnounceEmptyResults:false,
 giveawayDefaultBannerNameKey:"clover",
};

test("separate activity setup exposes channels, editable summary and preview",()=>{
 const subcommands=setupCommand.toJSON().options.map(c=>c.name);
 assert.ok(subcommands.includes("activity-giveaways"));
 const config=new GuildConfig({guildId:guild});
 assert.equal(config.activityClaimWindowHours,12);
 assert.equal(config.activityMaxAutoRerolls,2);
 assert.equal(config.activityAnnounceEmptyResults,true);
 assert.deepEqual(config.activityNotificationRoleIds,[]);
 const description=describeActivityGiveawaySetup(claimSettings,{updateExisting:true});
 assert.match(description,/Activity Giveaway Setup/);
 assert.match(description,/Open #tickets/);
 assert.match(description,/456789012345678901/);
 assert.match(description,/Apply new claim instructions/);
 assert.match(description,/existing giveaways/);
 const preview=claimAnnouncementPreview(claimSettings);
 const embed=preview.embeds[0].toJSON();
 assert.equal(embed.title,"✦ Giveaway Results");
 assert.match(preview.content,/Winner Announcement Preview/);
 assert.match(embed.footer.text,/PREVIEW ONLY/);
 const rendered=[embed.description,...(embed.fields||[]).map(field=>field.value)].join("\n");
 assert.match(rendered,/Enter Ticket Claim info/);
 assert.match(rendered,/ticket number/);
 assert.match(rendered,/Discord message link/);
 assert.match(rendered,/FORFEIT YOUR WIN/);
 assert.match(rendered,/2 automatic rerolls/);
 assert.equal(preview.components[0].components[0].data.disabled,true);
 assert.equal(preview.components[0].components[0].data.label,"Enter Ticket Claim info");
 assert.deepEqual(preview.allowedMentions,{parse:[]});
 assert.equal(preview.files,undefined);
});

test("winner announcement preview attaches saved banner and matches actual regular/activity layouts",()=>{
 const banner={nameKey:"clover",mimeType:"image/png",imageData:Buffer.from([1,2,3,4])};
 for(const mode of ["regular","activity"]){
   const preview=claimAnnouncementPreview({...claimSettings,
     giveawayDefaultRequiredRoleId:"456789012345678901",
     giveawayRoleInstructions:"Get your role in <#234567890123456789>",
     giveawayShowRoleInstructions:false,
   },{mode,previewUserId:"234567890123456789",banner});
   const embed=preview.embeds[0].toJSON();
   assert.match(embed.description,/<@234567890123456789>/);
   assert.doesNotMatch(embed.description,/Required to enter/);
   assert.doesNotMatch(embed.description,/Get your role in/);
   assert.equal(embed.image.url,"attachment://giveaway-banner.png");
   assert.equal(preview.files[0].name,"giveaway-banner.png");
   assert.equal(preview.components[0].components[0].data.disabled,true);
   assert.match(embed.footer.text,/PREVIEW ONLY/);
   if(mode==="activity")assert.match(embed.description,/The Court Has Chosen/);
   else assert.match(embed.description,/fox cackles/);
 }
});
test("regular and activity setup display the actual default claim message when no custom instructions are saved",()=>{
  for(const mode of ["regular","activity"]){
    const settings={...claimSettings,activityClaimInstructions:""};
    const current=currentGiveawayClaimInstructions(settings);
    assert.equal(current,DEFAULT_CLAIM_INSTRUCTIONS);
    assert.match(current,/Open a support ticket/);
    assert.match(current,/Discord message link/);
    const summary=describeActivityGiveawaySetup(settings,{mode});
    assert.ok(summary.includes(DEFAULT_CLAIM_INSTRUCTIONS));
  }
  assert.equal(currentGiveawayClaimInstructions(claimSettings),claimSettings.activityClaimInstructions);
  assert.equal(currentGiveawayClaimInstructions({...claimSettings,activityClaimInstructions:"  Custom ticket steps  "}),"Custom ticket steps");
});
test("every guided activity can override server claim settings and role notification options",()=>{
 const defaults=defaultActivityWizardSettings("host");
 assert.equal(defaults.maxAutoRerolls,2);
 assert.equal(defaults.announceEmptyResults,true);
 assert.deepEqual(defaults.notificationRoleIds,[]);
 for(const key of ["claimChoice","claimText","claimPreview","rerollsChoice","notifyRoles","emptyResults"])
   assert.ok(activityWizardPrompts[key],key);
 const fields=GUIDED_EDIT_FIELDS.map(x=>x.value);
 for(const name of ["claimWindowHours","claimInstructions","maxAutoRerolls","notificationRoleIds","announceEmptyResults"])
   assert.ok(fields.includes(name),name);
 const event={activityStartAt:new Date("2026-11-08T00:00:00Z"),activityEndAt:new Date("2026-11-11T00:00:00Z")};
 assert.deepEqual(validateGuidedStaffEdit("maxAutoRerolls","2",event),{maxAutoRerolls:2});
 assert.deepEqual(validateGuidedStaffEdit("claimInstructions","Open a ticket.",event),
   {claimInstructions:"Open a ticket."});
 assert.deepEqual(validateGuidedStaffEdit("announceEmptyResults","off",event),
   {announceEmptyResults:false});
});

test("ticket number and exact Discord ticket message link are preserved",()=>{
 const clean=validateTicketClaim("ticket-7",ticketLink);
 assert.equal(clean.ticketNumber,"ticket-7");
 assert.equal(clean.ticketUrl,ticketLink);
 assert.throws(()=>validateTicketClaim("7","https://example.com/channels/123/123/123"),/Discord message link/);
 assert.throws(()=>validateTicketClaim("7","https://discord.com/channels/1/2"),/Discord message link/);
 const winner="111111111111111111";
 const giveaway={
   _id:"507f1f77bcf86cd799439011",mode:"activity",status:"ended",
   title:"Check Claims",prize:"Pet",creatorId:winner,
   endsAt:new Date("2026-11-08T12:00:00Z"),winnerCount:1,
   winnerIds:[winner],claimWindowHours:12,autoRerollClaims:true,
   claimStartedAt:new Date("2026-11-08T12:00:00Z"),
   entrantIds:[winner],winnerClaims:[{slot:0,userId:winner,...clean}],
 };
 const post=giveawayAnnouncement(giveaway);
 const fields=post.embeds[0].toJSON().fields;
 assert.ok(fields.every(f=>!f.value.includes(ticketLink)),"private ticket link must not be public");
 assert.doesNotMatch(post.embeds[0].toJSON().description,/ticket-7/);
 const privateRecord=giveawayStaffRecordPayload(giveaway);
 assert.ok(privateRecord.embeds[0].toJSON().fields.some(f=>f.value.includes(ticketLink)),
   "the private staff record keeps the full original ticket URL");
 assert.ok(fields.some(f=>/FORFEIT YOUR WIN/.test(f.value)),"mandatory warning stays visible in a field");
 assert.match(post.embeds[0].toJSON().description,/Claim submitted/);
 assert.equal(post.components[0].components[0].data.label,"Enter Ticket Claim info");
});

test("two automatic rerolls per winner by default; no changes to manual rerolls",()=>{
 assert.equal(DEFAULT_MAX_AUTO_REROLLS,2);
 assert.equal(automaticRerollLimit({}),2);
 assert.equal(automaticRerollLimit({maxAutoRerolls:0}),0);
 const record={maxAutoRerolls:2,rerollHistory:[
   {slot:0,reason:"staff"},{slot:0,reason:"claim-expired"},
   {slot:0,reason:"claim-expired"},{slot:1,reason:"claim-expired"},
 ]};
 assert.equal(automaticRerollsUsed(record,0),2);
 assert.equal(automaticRerollsUsed(record,1),1);
 const output=prizeClaimLines({mode:"activity",winnerIds:["111111111111111111"],
   claimInstructions:"Submit your Roblox name in your ticket.",
   claimWindowHours:12,autoRerollClaims:true,maxAutoRerolls:2,
   claimStartedAt:new Date("2026-11-08T00:00:00Z")},{finished:true}).join("\n");
 assert.match(output,/FORFEIT YOUR WIN/);
 assert.match(output,/2 automatic rerolls/);
 assert.match(output,/Roblox name/);
 assert.doesNotMatch(output,/hammertime\.cyou/, "custom instructions replace defaults");
});
