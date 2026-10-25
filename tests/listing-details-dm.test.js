import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import HouseListing from "../models/HouseListing.js";
import MemberDmPanel from "../models/MemberDmPanel.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { makeMemberListingDirectory } from "../commands/member-listings.js";
import {
  currentListingDetails, validateListingDetails,
  listingDetailsModal, listingDetailsControls, listingDetailsPreview,
  openListingDetailsDM, handleListingDetailsDM,
} from "../commands/listing-details-editor.js";
import { houseActionComponents } from "../services/house-components.js";
import { outfitActionComponents } from "../services/outfit-controls.js";

const houseId="6add69d69249c7f6f595751d";
const outfitId="6add69d69249c7f6f595751e";
const guildId="908522799285538817";
const ownerId="627535541847588878";
const channelId="222222222222222222";
const postId="333333333333333333";
const dmChannelId="444444444444444444";
const dmMessageId="555555555555555555";
const botId="666666666666666666";
const token="123456789abc";
const house={
  _id:houseId,guildId,ownerId,status:"active",publicationState:"published",
  title:"Pink Cottage",description:"Garden, stairs and a pool",
  askingPrice:"20 VAL",estimatedValue:"30 VAL",ownerName:"LILLY",
  ownerRobloxUsername:"Guest",postChannelId:channelId,postMessageId:postId,
  galleryPageIndex:0, postAppearance:null,
};
const outfit={
  ...house,_id:outfitId,title:"Princess Dress",
  description:"Pink outfit",cost:"5 VAL",
};
const ownership=Object.fromEntries(Object.entries(FREE_APPEARANCE)
  .map(([key,values])=>[key,new Set(values)]));

test("both listing cards gain an Edit details button without hiding existing actions",()=>{
  for(const [type,fn,post] of [["house",houseActionComponents,house],["outfit",outfitActionComponents,outfit]]) {
    const buttons=fn(post,2)[1].toJSON().components;
    assert.equal(buttons.length,4);
    assert.equal(buttons.at(-1).label,"Edit details");
    assert.equal(buttons.at(-1).custom_id,type+":edit:"+post._id);
    assert.ok(buttons.some(x=>/Interest DMs/.test(x.label)));
  }
});

test("My Listings directory includes a private Edit selector linking listed IDs only",()=>{
  const items=[house,{...house,_id:outfitId,title:"Another"}];
  const directory=makeMemberListingDirectory("house",guildId,ownerId,items,2,0);
  const menus=directory.components[0].toJSON().components;
  assert.equal(menus[0].type,3);
  assert.equal(menus[0].custom_id,"member:edit:house:"+ownerId);
  assert.deepEqual(menus[0].options.map(x=>x.value),[houseId,outfitId]);
  assert.match(directory.content,/Edit menu below/);
});
test("drafts are limited to listing text and price fields",()=>{
  const hd=currentListingDetails("house",house);
  assert.deepEqual(hd,{
    title:house.title,description:house.description,
    askingPrice:house.askingPrice,estimatedValue:house.estimatedValue,
  });
  assert.deepEqual(currentListingDetails("outfit",outfit),{
    title:outfit.title,description:outfit.description,cost:outfit.cost,
  });
  assert.ok(!Object.hasOwn(hd,"mediaAttachments"));
  assert.deepEqual(validateListingDetails("house",{
    ...hd,title:"  Edited cottage  ",askingPrice:" 21 VAL ",mediaAttachments:["never saved"],
  }),{...hd,title:"Edited cottage",askingPrice:"21 VAL"});
});
test("no one can save empty house prices, overlong titles, or invalid descriptions",()=>{
  assert.throws(()=>validateListingDetails("house",{...house,askingPrice:""}),/askingPrice/);
  assert.throws(()=>validateListingDetails("house",{...house,title:"X".repeat(101)}),/title/);
  assert.throws(()=>validateListingDetails("house",{...house,description:" \n "}),/description/);
  assert.throws(()=>validateListingDetails("outfit",{...outfit,cost:"x".repeat(81)}),/cost/);
  assert.equal(validateListingDetails("outfit",{...outfit,cost:" "}).cost,"",
    "Empty outfit cost remains optional");
});

test("DM modal is prefilled and respects original house and outfit length limits",()=>{
  for(const [type,post,fields] of [
    ["house",house,["title","description","askingPrice","estimatedValue"]],
    ["outfit",outfit,["title","description","cost"]],
  ]) {
    const modal=listingDetailsModal(type,token,currentListingDetails(type,post)).toJSON();
    assert.equal(modal.custom_id,"listing:details:modal:"+token);
    assert.deepEqual(modal.components.map(c=>c.component.custom_id),fields);
    assert.equal(modal.components[0].component.value,post.title);
    assert.equal(modal.components[1].component.max_length,1000);
    assert.equal(modal.components[1].component.required,true);
    if(type==="outfit") assert.equal(modal.components[2].component.required,false);
  }
});
test("private controls use explicit Edit, Save and Discard actions",()=>{
  const buttons=listingDetailsControls(token)[0].toJSON().components;
  assert.deepEqual(buttons.map(x=>x.label),["Edit details","Save changes","Discard"]);
  assert.deepEqual(buttons.map(x=>x.custom_id),[
    "listing:details:edit:"+token,"listing:details:save:"+token,
    "listing:details:discard:"+token,
  ]);
});

test("preview renders draft text with the same gallery page and original listing style",async()=>{
  const result=[];
  const payload=await listingDetailsPreview("house",house,{
    ...currentListingDetails("house",house),
    title:"Updated garden house",askingPrice:"25 VAL",
  },token,{
    profile:null,ownership,
    loadGallery:async(type,post)=>{
      assert.equal(type,"house");assert.equal(post._id,houseId);
      return {count:3,page:1,imageBuffer:Buffer.from("fake-photo")};
    },
    render:async options=>{
      result.push(options);
      return Buffer.from("fake-png");
    },
  });
  assert.equal(result.length,1);
  assert.equal(result[0].type,"house");
  assert.equal(result[0].data.title,"Updated garden house");
  assert.equal(result[0].data.askingPrice,"25 VAL");
  assert.equal(result[0].data.galleryIndex,2);
  assert.equal(result[0].data.galleryCount,3);
  assert.deepEqual(result[0].images.photo,Buffer.from("fake-photo"));
  assert.equal(payload.files.length,1);
  assert.equal(payload.files[0].name,"house-details-preview.png");
  assert.match(payload.content,/private preview/i);
  assert.match(payload.content,/photos, videos and purchased style/);
});

test("forged directory edit menu is rejected before fetching any owner listing",async()=>{
  const fake={
    customId:"member:edit:house:123456789012345678",
    values:[houseId],guildId,user:{id:ownerId},
    isStringSelectMenu:()=>true,
    async deferReply(){throw Error("must not acknowledge a forged menu")},
  };
  await assert.rejects(openListingDetailsDM(fake),/belongs to another member/);
});
test("member's owner ID is required for public Edit button before any DM opens",async()=>{
  const old=HouseListing.findOne;
  const reads=[];
  HouseListing.findOne=async filter=>{reads.push(filter);return null;};
  const i={
    customId:"house:edit:"+houseId,
    user:{id:ownerId},guildId,
    isButton:()=>true,
    message:{id:postId},
    async deferReply(options){assert.equal(options.flags,MessageFlags.Ephemeral)},
  };
  try{
    await assert.rejects(openListingDetailsDM(i),/no longer active/);
    assert.equal(reads.length,1);
    assert.equal(reads[0].ownerId,ownerId);
    assert.deepEqual(reads[0].publicationState,{$ne:"staging"});
  }finally{HouseListing.findOne=old;}
});

test("stale DM tokens and other members' panels cannot open modal",async()=>{
  const old=MemberDmPanel.findOne;
  MemberDmPanel.findOne=async filter=>{
    assert.equal(filter.discordUserId,ownerId);
    return null;
  };
  const i={
    customId:"listing:details:edit:"+token,
    client:{user:{id:botId}},user:{id:ownerId},
    channelId:dmChannelId,message:{id:dmMessageId},
  };
  try{
    await assert.rejects(handleListingDetailsDM(i),/expired/);
  }finally{MemberDmPanel.findOne=old;}
});

test("save fails closed before changing Mongo when public post is not owned by this bot",async()=>{
  const origPanel=MemberDmPanel.findOne;
  const origFind=HouseListing.findOne;
  const origUpdate=HouseListing.findOneAndUpdate;
  let wrote=false;
  MemberDmPanel.findOne=async()=>({
    _id:"panel",token,channelId:dmChannelId,messageId:dmMessageId,
    guildId,appearanceTargetType:"house",appearanceTargetId:houseId,
    detailsDraft:currentListingDetails("house",house),
  });
  HouseListing.findOne=async filter=>{assert.equal(filter.ownerId,ownerId);return house;};
  HouseListing.findOneAndUpdate=async()=>{wrote=true;throw Error("Must not write");};
  const i={
    customId:"listing:details:save:"+token,
    user:{id:ownerId},message:{id:dmMessageId},channelId:dmChannelId,
    client:{
      user:{id:botId},
      guilds:{fetch:async()=>({
        members:{fetch:async()=>({id:ownerId})},
        channels:{fetch:async()=>({
          messages:{fetch:async()=>({author:{id:"another-bot"}})},
        })},
      })},
    },
    isButton:()=>true,
    async deferUpdate(){},
  };
  try{
    await assert.rejects(handleListingDetailsDM(i),/couldn't verify the original/);
    assert.equal(wrote,false);
  }finally{
    MemberDmPanel.findOne=origPanel;
    HouseListing.findOne=origFind;
    HouseListing.findOneAndUpdate=origUpdate;
  }
});
