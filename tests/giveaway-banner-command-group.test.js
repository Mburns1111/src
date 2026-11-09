import test from "node:test";
import assert from "node:assert/strict";
import {data as giveawayCommand} from "../commands/giveaway.js";
import {resolveGiveawayBannerOperation} from "../commands/giveaway-banners.js";

test("Discord slash registration nests all five banners under /giveaway banner",()=>{
  const spec=giveawayCommand.toJSON();
  const groups=spec.options.filter(o=>o.type===2);
  assert.deepEqual(groups.map(x=>x.name),["banner"]);
  assert.deepEqual(groups[0].options.map(x=>x.name),["save","list","default","clear","remove"]);
  const save=groups[0].options.find(x=>x.name==="save");
  assert.deepEqual(save.options.map(x=>x.name),["name","image"]);
  const standardList=spec.options.find(x=>x.name==="list");
  assert.equal(standardList.type,1,"ordinary giveaway list remains a distinct command");
  assert.equal(spec.options.some(o=>o.name.startsWith("banner-")),false);
});

test("grouped banner actions resolve without confusing /giveaway list or the legacy commands",()=>{
  for(const name of ["save","list","default","clear","remove"]){
    const interaction={options:{getSubcommand:()=>name,getSubcommandGroup:()=>"banner"}};
    assert.equal(resolveGiveawayBannerOperation(interaction),name);
    const legacy={options:{getSubcommand:()=>"banner-"+name,getSubcommandGroup:()=>null}};
    assert.equal(resolveGiveawayBannerOperation(legacy),name);
  }
  assert.equal(resolveGiveawayBannerOperation({options:{
    getSubcommand:()=>"list",getSubcommandGroup:()=>null
  }}),null);
  assert.equal(resolveGiveawayBannerOperation({options:{
    getSubcommand:()=>"start",getSubcommandGroup:()=>null
  }}),null);
});
