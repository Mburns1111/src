import test from "node:test";
import assert from "node:assert/strict";
import {
  renderListingCardCached, clearListingRenderCache, listingRenderCacheStats,
  LISTING_RENDER_CACHE_MAX_BYTES, LISTING_RENDER_CACHE_TTL_MS,
} from "../services/listing-render-cache.js";

const fresh = () => ({
  type:"outfit", data:{title:"Jacket",galleryIndex:1,galleryCount:2},
  images:{photo:Buffer.from("photo1")},appearance:{frame:"default"},
});
test("a listing card is reused only for exactly identical inputs",async()=>{
  clearListingRenderCache();
  let calls=0;
  const render=async()=>{calls++;return Buffer.from("PNG"+calls);};
  const first=await renderListingCardCached(fresh(),{render});
  const repeat=await renderListingCardCached(fresh(),{render});
  assert.equal(calls,1);
  assert.deepEqual(repeat,first);
  repeat[0]=0;
  const again=await renderListingCardCached(fresh(),{render});
  assert.equal(again.toString(),"PNG1","callers cannot modify the cached PNG");
});
test("different page, photo bytes, card text and appearance invalidate a prior render",async()=>{
  clearListingRenderCache();
  let calls=0;
  const render=async()=>Buffer.from("PNG"+ ++calls);
  const baseline=fresh();
  const variants=[
    baseline,
    {...fresh(),data:{...fresh().data,galleryIndex:2}},
    {...fresh(),images:{photo:Buffer.from("photo2")}},
    {...fresh(),data:{...fresh().data,title:"New jacket"}},
    {...fresh(),appearance:{frame:"silverFloral"}},
    {...fresh(),type:"house"},
  ];
  for(const value of variants) await renderListingCardCached(value,{render});
  assert.equal(calls,variants.length);
});
test("two requests for one listing render only once while work is pending",async()=>{
  clearListingRenderCache();
  let finish, calls=0;
  const render=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const first=renderListingCardCached(fresh(),{render});
  const second=renderListingCardCached(fresh(),{render});
  await Promise.resolve();
  assert.equal(calls,1);
  finish(Buffer.from("COMPLETE"));
  const results=await Promise.all([first,second]);
  assert.equal(results[0].toString(),"COMPLETE");
  assert.equal(results[1].toString(),"COMPLETE");
  assert.equal(listingRenderCacheStats().pending,0);
});
test("failed listing render is never reused as a fallback",async()=>{
  clearListingRenderCache();
  let calls=0;
  const render=async()=>{calls++;if(calls===1)throw new Error("canvas failed");
    return Buffer.from("RECOVERED");};
  await assert.rejects(renderListingCardCached(fresh(),{render}),/canvas failed/);
  assert.equal((await renderListingCardCached(fresh(),{render})).toString(),"RECOVERED");
  assert.equal(calls,2);
  assert.equal(listingRenderCacheStats().pending,0);
});
test("entries expire and old PNGs do not stay forever",async()=>{
  clearListingRenderCache();
  let calls=0;
  const render=async()=>Buffer.from(String(++calls));
  await renderListingCardCached(fresh(),{render,now:()=>100});
  await renderListingCardCached(fresh(),{render,now:()=>100+LISTING_RENDER_CACHE_TTL_MS-1});
  assert.equal(calls,1);
  await renderListingCardCached(fresh(),{render,now:()=>100+LISTING_RENDER_CACHE_TTL_MS});
  assert.equal(calls,2);
});
test("profiles and dynamic remote image sources are never cached",async()=>{
  clearListingRenderCache();
  let calls=0;
  const render=async()=>Buffer.from(String(++calls));
  const profile={...fresh(),type:"profile"};
  const remote={...fresh(),images:{photo:"https://cdn.discordapp.com/attachments/a/b"}};
  await renderListingCardCached(profile,{render});
  await renderListingCardCached(profile,{render});
  await renderListingCardCached(remote,{render});
  await renderListingCardCached(remote,{render});
  assert.equal(calls,4);
});
test("cache enforces byte and entry bounds",async()=>{
  clearListingRenderCache();
  const render=async()=>Buffer.alloc(1_000_000,1);
  for(let index=0;index<40;index++) {
    await renderListingCardCached({...fresh(),data:{galleryIndex:index}},{render});
  }
  const stats=listingRenderCacheStats();
  assert.ok(stats.entries<=24);
  assert.ok(stats.bytes<=LISTING_RENDER_CACHE_MAX_BYTES);
  assert.equal(stats.pending,0);
});
