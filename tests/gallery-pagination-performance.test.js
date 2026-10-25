import test from "node:test";
import assert from "node:assert/strict";
import HouseGalleryImage from "../models/HouseGalleryImage.js";
import OutfitGalleryImage from "../models/OutfitGalleryImage.js";
import { getHouseGalleryPage } from "../services/house-gallery.js";
import { getOutfitGalleryPage } from "../services/outfit-gallery.js";

async function verifyPagination(Model, getPage, type) {
  const prevCount=Model.countDocuments, prevFind=Model.findOne;
  const seen = [];
  Model.countDocuments=async () => 3;
  Model.findOne=filter => {
    seen.push({kind:"find",filter});
    return { sort(){return this;},skip(page){seen.push({kind:"skip",page});return this;},
      select(){return this;},lean:async()=>({imageData:Buffer.from("image")}) };
  };
  try {
    const found=await getPage("guild","id",5);
    assert.equal(found.count,3);
    assert.equal(found.page,2);
    assert.equal(found.imageBuffer.toString(),"image");
    assert.equal(seen.filter(x=>x.kind==="find").length,1);
    assert.deepEqual(seen.filter(x=>x.kind==="skip").map(x=>x.page),[2]);
  } finally {Model.countDocuments=prevCount;Model.findOne=prevFind;}
}
test("house gallery paginates in Mongo instead of materializing all gallery image bytes",async()=>{
  await verifyPagination(HouseGalleryImage,getHouseGalleryPage,"house");
});
test("outfit gallery paginates in Mongo instead of materializing all gallery image bytes",async()=>{
  await verifyPagination(OutfitGalleryImage,getOutfitGalleryPage,"outfit");
});
