import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import {
  data, execute, buildAdminImportModal, claimAdminImportTicket, adminImportValues,
} from "../commands/admin-import-listing.js";
import { importInventoryForMember } from "../commands/inventory-video.js";
import { importTradingPostForMember } from "../commands/trading-post.js";
import UserProfile from "../models/UserProfile.js";
import TradingPost from "../models/TradingPost.js";
import GuildConfig from "../models/GuildConfig.js";

const adminId="627535541847588878", ownerId="123456789012345678";
const guildId="908522799285538817", botId="555555555555555555";
const nonce="abcdef123456";
const owner={id:ownerId,displayName:"Original Seller",user:{username:"Seller",bot:false}};
const fields=values=>({getTextInputValue:key=>values[key] ?? ""});

function commandInteraction(type, {admin=true, member=owner}={}) {
  let shown;
  const interaction={
    inGuild:()=>true, guildId, user:{id:adminId},client:{user:{id:botId}},
    memberPermissions:{has:flag=>flag===PermissionFlagsBits.ManageGuild && admin},
    options:{getSubcommand:()=>type,getUser:()=>({id:member.id,username:"Seller",bot:member.user.bot})},
    async showModal(modal){shown=modal.toJSON();},
  };
  return {interaction,getModal:()=>shown};
}

test("admin migration lists all four supported types with member ownership targets",()=>{
  const json=data.toJSON();
  assert.deepEqual(json.options.map(o=>o.name),["house","outfit","inventory","trading"]);
  assert.equal(json.default_member_permissions,String(PermissionFlagsBits.ManageGuild));
  for(const sub of json.options) {
    const member=sub.options.find(x=>x.name==="member");
    assert.equal(member?.required,true);
    assert.equal(member?.type,6);
  }
});

test("inventory modal permits one optional upload or external video link",()=>{
  const json=buildAdminImportModal("inventory",nonce,"Seller").toJSON();
  assert.match(json.title,/Inventory for Seller/);
  assert.deepEqual(json.components.map(c=>c.component.custom_id),["video_url","inventory_media"]);
  assert.equal(json.components[0].component.max_length,500);
  assert.equal(json.components[0].component.required,false);
  // Discord requires required:false whenever a file upload allows min_values:0.
  assert.equal(json.components[1].component.required,false);
  assert.equal(json.components[1].component.min_values,0);
  assert.equal(json.components[1].component.max_values,1);
});

test("Trading Post modal offers the existing two editable fields only",()=>{
  const json=buildAdminImportModal("trading",nonce,"Seller").toJSON();
  assert.match(json.title,/Trading Post/);
  assert.deepEqual(json.components.map(c=>c.component.custom_id),
    ["looking_for","willing_to_trade"]);
  assert.ok(json.components.every(c=>c.component.max_length===1000 &&
    c.component.required===false));
});

test("inventory and Trading Post import tickets bind a manager and chosen owner",async()=>{
  for(const type of ["inventory","trading"]){
    const {interaction,getModal}=commandInteraction(type);
    await execute(interaction);
    const ticket=claimAdminImportTicket(getModal().custom_id,interaction);
    assert.equal(ticket.type,type);
    assert.equal(ticket.adminId,adminId);
    assert.equal(ticket.ownerId,ownerId);
    await assert.rejects(async()=>claimAdminImportTicket(getModal().custom_id,interaction),
      /expired or has already been submitted/);
  }
});

test("inventory links are validated and Trading Post must have at least one text field",()=>{
  assert.deepEqual(adminImportValues("inventory",fields({video_url:"https://example.org/demo.mp4"})),
    {videoUrl:"https://example.org/demo.mp4"});
  assert.deepEqual(adminImportValues("inventory",fields({video_url:""})),{videoUrl:""});
  assert.throws(()=>adminImportValues("inventory",fields({video_url:"javascript:alert(1)"})),
    /valid http or https URL/);
  assert.deepEqual(adminImportValues("trading",fields({
    looking_for:"   Pets  ",willing_to_trade:"   Clothes ",
  })),{lookingFor:"Pets",willingToTrade:"Clothes"});
  assert.throws(()=>adminImportValues("trading",fields({})),/Enter something/);
  assert.throws(()=>adminImportValues("trading",fields({
    looking_for:"a".repeat(1001),
  })),/at most 1000/);
});

test("existing inventory entry blocks migration before posting or changing the owner",async()=>{
  const origConfig=GuildConfig.findOne,origProfile=UserProfile.findOne;
  let sent=false;
  GuildConfig.findOne=async()=>({inventoryChannelId:"222222222222222222"});
  UserProfile.findOne=async filter=>{
    assert.equal(filter.discordUserId,ownerId);
    return {inventoryVideoPostMessageId:"111111111111111111",inventoryVideoUrl:"https://discord.com/old"};
  };
  const interaction={
    guildId,guild:{channels:{fetch:async()=>({
      isTextBased:()=>true,
      send:async()=>{sent=true;throw Error("No post should be published");},
    })}},
  };
  try{
    await assert.rejects(importInventoryForMember(interaction,{
      owner,videoUrl:"https://example.org/video",importedById:adminId,
    }),/already has an inventory video/);
    assert.equal(sent,false);
  }finally{GuildConfig.findOne=origConfig;UserProfile.findOne=origProfile;}
});

test("inventory import requires exactly one media source and never treats admin as owner",async()=>{
  await assert.rejects(importInventoryForMember({},{
    owner, video:null,videoUrl:"",importedById:adminId,
  }),/exactly one/);
  await assert.rejects(importInventoryForMember({},{
    owner,video:{name:"a.mp4"},videoUrl:"https://example.org/a",importedById:adminId,
  }),/exactly one/);
  assert.equal(UserProfile.schema.path("inventoryVideoImportedById").instance,"String");
  assert.equal(UserProfile.schema.path("discordUserId").isRequired,true);
});

test("existing Trading Post cannot be overwritten during import",async()=>{
  const origConfig=GuildConfig.findOne,origPost=TradingPost.findOne;
  let wrote=false;
  GuildConfig.findOne=async()=>({tradingPostChannelId:"222222222222222222"});
  TradingPost.findOne=async filter=>{
    assert.equal(filter.ownerId,ownerId);
    return {ownerId,lookingFor:"Owner's unsaved work",deletePending:false};
  };
  const interaction={
    guildId,guild:{channels:{fetch:async()=>({
      isTextBased:()=>true,send:async()=>{wrote=true;},
    })}},
  };
  try{
    await assert.rejects(importTradingPostForMember(interaction,{
      owner,lookingFor:"Old pets",willingToTrade:"Cars",importedById:adminId,
    }),/already has a Trading Post/);
    assert.equal(wrote,false);
  }finally{GuildConfig.findOne=origConfig;TradingPost.findOne=origPost;}
});

test("Trading Post pending deletion blocks migration, preserving tombstone",async()=>{
  const origConfig=GuildConfig.findOne,origPost=TradingPost.findOne;
  GuildConfig.findOne=async()=>({tradingPostChannelId:"222222222222222222"});
  TradingPost.findOne=async()=>({deletePending:true});
  const interaction={
    guildId,guild:{channels:{fetch:async()=>({isTextBased:()=>true,send:async()=>{}})}},
  };
  try{
    await assert.rejects(importTradingPostForMember(interaction,{
      owner,lookingFor:"Old pets",willingToTrade:"",importedById:adminId,
    }),/deletion is pending/);
  }finally{GuildConfig.findOne=origConfig;TradingPost.findOne=origPost;}
});
test("Trading Post keeps an independent owner and importing-admin audit field",()=>{
  assert.equal(TradingPost.schema.path("importedById").instance,"String");
  assert.equal(TradingPost.schema.path("ownerId").isRequired,true);
  assert.ok(TradingPost.schema.indexes().some(([keys])=>keys.guildId===1 && keys.ownerId===1));
});
