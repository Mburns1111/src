import test from "node:test";
import assert from "node:assert/strict";
import {EmbedBuilder} from "discord.js";
import GiveawayBanner from "../models/GiveawayBanner.js";
import {validateBannerUpload,saveGiveawayBanner,attachGiveawayBanner,
  MAX_GIVEAWAY_BANNER_BYTES} from "../services/giveaway-banners.js";

const attachment={url:"https://cdn.discordapp.com/attachments/123/456/flowers.png",
  size:5,contentType:"image/png"};
test("a registered banner is a Discord image attachment, not an arbitrary remote fetch",()=>{
 assert.equal(validateBannerUpload(attachment).mimeType,"image/png");
 assert.throws(()=>validateBannerUpload({...attachment,contentType:"text/html"}),/PNG/);
 assert.throws(()=>validateBannerUpload({...attachment,size:MAX_GIVEAWAY_BANNER_BYTES+1}),/4 MB/);
 assert.throws(()=>validateBannerUpload({...attachment,url:"https://example.org/private"}),/Discord command/);
});
test("saving a named banner persists reusable bytes with a guild-scoped key",async()=>{
 const old=GiveawayBanner.findOneAndUpdate;
 let saved;
 try {
  GiveawayBanner.findOneAndUpdate=async(query,update)=>{saved={query,update};return {};};
  const key=await saveGiveawayBanner({guildId:"123456789012345678",name:"Pink Roses",
    attachment,fetchImage:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3,4,5]).buffer})});
  assert.equal(key,"pink roses");
  assert.equal(saved.query.guildId,"123456789012345678");
  assert.equal(saved.update.$set.mimeType,"image/png");
  assert.deepEqual([...saved.update.$set.imageData],[1,2,3,4,5]);
 }finally{GiveawayBanner.findOneAndUpdate=old;}
});
test("embed banner is an attached image, retained on resend and editable results",()=>{
 const payload=attachGiveawayBanner({embeds:[new EmbedBuilder().setTitle("Giveaway")],allowedMentions:{parse:[]}},
  {mimeType:"image/png",imageData:Buffer.from([1,2,3])});
 assert.equal(payload.embeds[0].toJSON().image.url,"attachment://giveaway-banner.png");
 assert.equal(payload.files.length,1);
 assert.equal(payload.files[0].name,"giveaway-banner.png");
 assert.deepEqual(payload.attachments,[]);
});
