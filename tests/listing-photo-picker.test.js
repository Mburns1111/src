import test from "node:test";
import assert from "node:assert/strict";
import { photoPickerResponse, selectedGalleryPage, MAX_GALLERY_PICKER_OPTIONS } from "../services/listing-photo-picker.js";
import { houseActionComponents } from "../services/house-components.js";
import { outfitActionComponents } from "../services/outfit-controls.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import { handleHousePageButton, handleHousePhotoSelection } from "../commands/house.js";
import { handleOutfitPageButton, handleOutfitPhotoSelection } from "../commands/outfit.js";
import { houseGalleryCount } from "../services/house-gallery.js";

const id="6add69d69249c7f6f595751d";
const postId="888888888888888888";
const guildId="1561372971355086958";
const listing={_id:id,postMessageId:postId,galleryPageIndex:2};

test("public gallery keeps count and Previous/Next while adding direct photo access",()=>{
  for(const [kind,fn] of [["house",houseActionComponents],["outfit",outfitActionComponents]]) {
    const rows=fn(listing,6).map(row=>row.toJSON().components);
    assert.equal(rows.length,2);
    assert.deepEqual(rows[0].map(button=>button.label),
      ["◀ Previous","Photo 3 / 6","Next ▶","Choose photo"]);
    assert.equal(rows[0][3].custom_id,`${kind}:page:choose:${id}`);
    assert.equal(rows[1].length,3,"Existing seller/member actions remain intact");
  }
});

test("a picker offers every photo with only the selected number preselected",()=>{
  for(const kind of ["house","outfit"]) {
    const p=photoPickerResponse(kind,listing,6,postId);
    const menu=p.components[0].toJSON().components[0];
    assert.equal(menu.custom_id,`${kind}:photo-select:${id}:${postId}`);
    assert.deepEqual(menu.options.map(item=>item.value),["0","1","2","3","4","5"]);
    assert.equal(menu.options.filter(x=>x.default).length,1);
    assert.equal(menu.options[2].default,true);
    assert.match(p.content,/public listing/);
  }
});

test("a long legacy album shows at most 25 choices, always including current page",()=>{
  assert.equal(MAX_GALLERY_PICKER_OPTIONS,25);
  for(const current of [0,20,90]) {
    const menu=photoPickerResponse("house",{...listing,galleryPageIndex:current},100,postId)
      .components[0].toJSON().components[0];
    assert.ok(menu.options.length<=25);
    assert.ok(menu.options.some(x=>Number(x.value)===current && x.default));
  }
});

test("selections use zero-based pages and reject tampered, old, or out-of-range values",()=>{
  for(const [value,expected] of [["0",0],["5",5]]) {
    assert.equal(selectedGalleryPage({values:[value]},6),expected);
  }
  for(const value of ["-1","01","6","9999999999999999999999","x","","1.5"]) {
    assert.throws(()=>selectedGalleryPage({values:[value]},6),/photo|number/i);
  }
  assert.throws(()=>selectedGalleryPage({values:[]},6),/photo|number/i);
  assert.throws(()=>photoPickerResponse("house",listing,1,postId),/no longer available/);
  assert.throws(()=>photoPickerResponse("house",listing,6,"invalid"),/no longer available/);
});

function fakeButton(kind) {
  const calls=[];
  const i={
    guildId,message:{id:postId},
    customId:`${kind}:page:choose:${id}`,calls,
    async deferReply(arg){calls.push({method:"defer",arg})},
    async editReply(arg){calls.push({method:"edit",arg})},
    async deferUpdate(){calls.push({method:"update"})},
  };
  return i;
}
test("Choose photo acknowledges ephemerally before querying Mongo, never edits public post",async()=>{
  for(const [kind,handler,Model] of [
    ["house",handleHousePageButton,HouseListing],
    ["outfit",handleOutfitPageButton,OutfitListing],
  ]) {
    const old=Model.findOne;
    const i=fakeButton(kind);
    Model.findOne=async filter=>{
      assert.equal(i.calls[0].method,"defer");
      assert.ok(i.calls[0].arg.flags);
      assert.equal(filter.postMessageId,postId);
      return null;
    };
    try {
      await assert.rejects(handler(i),/no longer available/);
      assert.deepEqual(i.calls.map(c=>c.method),["defer"]);
    } finally {Model.findOne=old;}
  }
});

test("old and forged photo pickers reject invalid listing IDs before any edits",async()=>{
  for(const [kind,handler] of [
    ["house",handleHousePhotoSelection],
    ["outfit",handleOutfitPhotoSelection],
  ]) {
    const i={
      customId:`${kind}:photo-select:short:${postId}`,
      values:["0"],
      async deferUpdate(){throw new Error("Must not acknowledge malformed input")},
    };
    await assert.rejects(handler(i),/no longer valid/);
  }
});
