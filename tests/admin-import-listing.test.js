import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import {
  data, execute, buildAdminImportModal, claimAdminImportTicket,
  adminImportValues,
} from "../commands/admin-import-listing.js";
import { houseCardPayload } from "../services/house-card.js";
import { unifiedOutfitPayload } from "../services/outfit-card.js";
import { validateHouseCreationUploads } from "../commands/house.js";
import { validateOutfitCreationUploads } from "../commands/outfit.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";

const guildId="908522799285538817", adminId="627535541847588878";
const ownerId="123456789012345678", botId="333333333333333333";
const listingId="6add69d69249c7f6f595751d";
const token="abc123456789";
const makeFields=map=>({getTextInputValue:key=>map[key]});
const houseFields={
  title:"Historic cottage",description:"A restored garden home",
  asking_price:"20 VAL",estimated_value:"30 VAL",
};
const outfitFields={
  title:"Imported dress",description:"A blue vintage outfit",cost:"5 VAL",video_url:"",
};
function fakeAdmin({admin=true,owner=ownerId}={}){
  let modal=null;
  const i={
    guildId,user:{id:adminId},client:{user:{id:botId}},
    memberPermissions:{has:flag=>flag===PermissionFlagsBits.ManageGuild&&admin},
    inGuild:()=>true,
    options:{
      getSubcommand:()=> "house",
      getUser:key=>key==="member"?{id:owner,bot:false}:null,
    },
    guild:{members:{fetch:async id=>({id,displayName:"Target Member",user:{id,bot:false}})}},
    showModal:async value=>{modal=value;},
  };
  return {i,getModal:()=>modal};
}

test("admin-import is a ManageGuild-only command with target member options",()=>{
  const json=data.toJSON();
  assert.equal(json.name,"admin-import");
  assert.equal(json.default_member_permissions,String(PermissionFlagsBits.ManageGuild));
  assert.deepEqual(json.options.map(x=>x.name),["house","outfit","inventory","trading"]);
  for(const option of json.options){
    const user=option.options.find(o=>o.name==="member");
    assert.ok(user?.required);
    assert.equal(user.type,6);
  }
});

test("house and outfit import modals match existing creation field limits and media count",()=>{
  for(const [type,expected] of [
    ["house",["title","description","asking_price","estimated_value","house_media"]],
    ["outfit",["title","description","cost","video_url","outfit_media"]],
  ]) {
    const json=buildAdminImportModal(type,token,"Target Member").toJSON();
    assert.deepEqual(json.components.map(x=>x.component.custom_id),expected);
    assert.equal(json.components.at(-1).component.min_values,1);
    assert.equal(json.components.at(-1).component.max_values,10);
    assert.equal(json.components[0].component.max_length,100);
    assert.equal(json.components[1].component.max_length,1000);
  }
});

test("command refuses non-manager before showing any form",async()=>{
  const {i,getModal}=fakeAdmin({admin:false});
  await assert.rejects(execute(i),/Only a server manager/);
  assert.equal(getModal(),null);
});
test("admin modal opens promptly without waiting for a Discord member API request",async()=>{
  const {i,getModal}=fakeAdmin();
  i.options.getUser=()=>({id:ownerId,bot:false,username:"MigratedMember"});
  i.guild.members.fetch=async()=>{ throw new Error("Modal must not wait for member lookup"); };
  await execute(i);
  const modal=getModal().toJSON();
  assert.match(modal.title,/MigratedMember/);
  assert.equal(claimAdminImportTicket(modal.custom_id,i).ownerId,ownerId);
});

test("command cannot assign the listing to a bot account",async()=>{
  const {i,getModal}=fakeAdmin();
  i.options.getUser=()=>({id:botId,bot:true});
  await assert.rejects(execute(i),/real server member/);
  assert.equal(getModal(),null);
});

test("one-use import form is bound to admin, guild and selected member",async()=>{
  const {i,getModal}=fakeAdmin();
  await execute(i);
  const customId=getModal().toJSON().custom_id;
  const valid=claimAdminImportTicket(customId,i);
  assert.equal(valid.ownerId,ownerId);
  assert.equal(valid.adminId,adminId);
  assert.equal(valid.guildId,guildId);
  assert.equal(valid.type,"house");
  await assert.rejects(async()=>claimAdminImportTicket(customId,i),/expired or has already been submitted/);
});
test("another admin cannot steal an open import ticket",async()=>{
  const {i,getModal}=fakeAdmin();
  await execute(i);
  const customId=getModal().toJSON().custom_id;
  const other={...i,user:{id:"444444444444444444"}};
  assert.throws(()=>claimAdminImportTicket(customId,other),/expired or has already been submitted/);
  assert.equal(claimAdminImportTicket(customId,i).ownerId,ownerId);
});
test("ticket rejects invalid subcommand and malformed tokens",()=>{
  const {i}=fakeAdmin();
  for(const id of ["admin-import:house:bad","admin-import:__proto__:"+token,
      "admin-import:outfit:"+token+":extra"]) {
    assert.throws(()=>claimAdminImportTicket(id,i),/invalid/);
  }
});
test("values have same validation and trimming as normal house and outfit creation",()=>{
  assert.deepEqual(adminImportValues("house",makeFields({
    ...houseFields,title:"  Old cottage ",asking_price:" 20 VAL ",
  })),{
    title:"Old cottage",description:houseFields.description,
    askingPrice:"20 VAL",estimatedValue:"30 VAL",videoUrl:"",
  });
  assert.deepEqual(adminImportValues("outfit",makeFields({
    ...outfitFields,cost:" ",
  })),{
    title:outfitFields.title,description:outfitFields.description,cost:"",videoUrl:"",
  });
  assert.throws(()=>adminImportValues("house",makeFields({...houseFields,asking_price:" "})),/house prices/);
  assert.throws(()=>adminImportValues("outfit",makeFields({...outfitFields,title:"x".repeat(101)})),/title/);
});
test("imports cannot bypass current normal upload limits",()=>{
  const photo={name:"front.png",contentType:"image/png",url:"https://cdn.discordapp.com/photo.png"};
  const video={name:"walk.mp4",contentType:"video/mp4",url:"https://cdn.discordapp.com/video.mp4"};
  assert.deepEqual(validateHouseCreationUploads([photo]),{photos:[photo],videos:[]});
  assert.deepEqual(validateOutfitCreationUploads([photo]),{photos:[photo],videos:[]});
  assert.throws(()=>validateHouseCreationUploads([]),/Upload at least one/);
  assert.throws(()=>validateOutfitCreationUploads([]),/Upload at least one/);
  assert.throws(()=>validateHouseCreationUploads(Array(10).fill(video)),/at most nine videos/);
  assert.throws(()=>validateOutfitCreationUploads(Array(10).fill(video)),/no more than nine videos/);
});
test("public cards show the actual member as maker, without pinging on migration",()=>{
  const listing={
    _id:listingId,title:"Cottage",ownerId,ownerName:"Target Member",
    interestedUserIds:[],notifyOnInterest:false,galleryPageIndex:0,
  };
  const house=houseCardPayload(listing,{count:0},Buffer.from("card"));
  const outfit=unifiedOutfitPayload(listing,{count:0},[],Buffer.from("card"));
  for(const payload of [house,outfit]){
    assert.match(payload.content,new RegExp("<@"+ownerId+">"));
    assert.match(payload.content,/Target Member/);
    assert.deepEqual(payload.allowedMentions,{parse:[]});
    assert.ok(payload.components.flatMap(r=>r.toJSON().components)
      .some(button=>button.custom_id.endsWith(":"+listingId)));
  }
});
test("audit field exists on both listing schemas and is not the owner field",()=>{
  for(const model of [HouseListing,OutfitListing]){
    assert.equal(model.schema.path("importedById").instance,"String");
    assert.equal(model.schema.path("ownerId").isRequired,true);
    assert.equal(model.schema.path("importedById").defaultValue,"");
  }
});
