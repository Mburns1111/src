import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MEMBER_LISTING_PAGE_SIZE, directoryQuery,
  makeMemberListingDirectory, handleMemberListingDirectory,
} from "../commands/member-listings.js";

const guildId = "908522799285538817";
const memberId = "627535541847588878";
const otherId = "123456789012345678";
const channelId = "222222222222222222";
const postId = "333333333333333333";
function record(title, offset=0) {
  return { title, postChannelId:channelId,
    postMessageId:String(BigInt(postId)+BigInt(offset)) };
}
function fakeModel(count, entries) {
  const calls=[];
  return {
    calls,
    async countDocuments(filter) {
      calls.push({op:"count",filter});
      return count;
    },
    find(filter) {
      calls.push({op:"find",filter});
      const query={
        sort(x){calls.push({op:"sort",value:x});return query;},
        skip(x){calls.push({op:"skip",value:x});return query;},
        limit(x){calls.push({op:"limit",value:x});return query;},
        select(x){calls.push({op:"select",value:x});return query;},
        async lean(){calls.push({op:"lean"});return entries;},
      };
      return query;
    },
  };
}
function interaction(customId, userId=memberId) {
  const calls=[];
  return {
    customId,guildId,user:{id:userId},calls,
    async deferReply(payload){calls.push({op:"deferReply",payload});},
    async deferUpdate(){calls.push({op:"deferUpdate"});},
    async editReply(payload){calls.push({op:"editReply",payload});},
  };
}

test("channel-entry panels offer read-only My listings buttons without replacing Create buttons",()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  for(const type of ["house","outfit"]) {
    const source=readFileSync(resolve(root,"commands",type+".js"),"utf8");
    assert.match(source,new RegExp('customId: "'+type+':mine"'));
    assert.match(source,new RegExp('customId: "'+type+':entry"'));
    assert.match(source,new RegExp(type+':new:'));
  }
});

test("directory is scoped to the requesting member, active and published listings only",()=>{
  const query=directoryQuery(guildId,memberId);
  assert.equal(query.guildId,guildId);
  assert.equal(query.ownerId,memberId);
  assert.equal(query.status,"active");
  assert.deepEqual(query.publicationState,{$ne:"staging"});
  assert.throws(()=>directoryQuery(guildId,"no member"),/from your server/);
});
test("private directory presents safe clickable Discord links, not raw mentions",()=>{
  const result=makeMemberListingDirectory("house",guildId,memberId,
    [record("A lovely house",1),record("@everyone [wow](unsafe)",2)],2,0);
  assert.match(result.content,/A lovely house/);
  assert.match(result.content,/https:\/\/discord.com\/channels\//);
  assert.doesNotMatch(result.content,/@everyone/);
  assert.deepEqual(result.allowedMentions,{parse:[]});
  assert.deepEqual(result.components,[]);
});
test("directory excludes broken links from URLs and handles empty state",()=>{
  const result=makeMemberListingDirectory("outfit",guildId,memberId,
    [{title:"Older outfit",postChannelId:"",postMessageId:"3"}],1,0);
  assert.match(result.content,/post link unavailable/);
  assert.doesNotMatch(result.content,/discord\.com\/channels\//);
  const empty=makeMemberListingDirectory("outfit",guildId,memberId,[],0,0);
  assert.match(empty.content,/don't have any active published listings/);
});
test("pagination displays eight items per page and owner-bound buttons",()=>{
  assert.equal(MEMBER_LISTING_PAGE_SIZE,8);
  const payload=makeMemberListingDirectory("outfit",guildId,memberId,
    [record("Last entry")],17,2);
  assert.match(payload.content,/Page 3 of 3/);
  const row=payload.components[0].toJSON().components;
  assert.equal(row[0].custom_id,"outfit:mine:1:"+memberId);
  assert.equal(row[1].disabled,true);
});

test("first click acknowledges privately then performs a bounded read-only query",async()=>{
  for(const type of ["house","outfit"]) {
    const Model=fakeModel(2,[record("One"),record("Two",1)]);
    const i=interaction(type+":mine");
    await handleMemberListingDirectory(i,{models:{[type]:Model}});
    assert.deepEqual(i.calls.map(c=>c.op),["deferReply","editReply"]);
    assert.ok(i.calls[0].payload.flags,"Private ephemeral response");
    assert.match(i.calls[1].payload.content,/2 active/);
    assert.equal(Model.calls.find(c=>c.op==="limit").value,8);
    assert.deepEqual(Model.calls.find(c=>c.op==="skip").value,0);
    assert.deepEqual(Model.calls.find(c=>c.op==="count").filter.ownerId,memberId);
    assert.ok(Model.calls.every(c=>!["delete","update"].includes(c.op)));
  }
});
test("next page edits only the member's ephemeral directory",async()=>{
  const Model=fakeModel(20,[record("Page two")]);
  const i=interaction("house:mine:1:"+memberId);
  await handleMemberListingDirectory(i,{models:{house:Model}});
  assert.deepEqual(i.calls.map(c=>c.op),["deferUpdate","editReply"]);
  assert.equal(Model.calls.find(c=>c.op==="skip").value,8);
  assert.match(i.calls[1].payload.content,/Page 2 of 3/);
});
test("stale page clamps to current count without ever querying out-of-range data",async()=>{
  const Model=fakeModel(1,[record("Still active")]);
  const i=interaction("house:mine:999:"+memberId);
  await handleMemberListingDirectory(i,{models:{house:Model}});
  assert.equal(Model.calls.find(c=>c.op==="skip").value,0);
  assert.match(i.calls[1].payload.content,/Page 1 of 1/);
});
test("one member cannot page through another member's listing directory",async()=>{
  const Model=fakeModel(100,[record("Hidden")]);
  const i=interaction("outfit:mine:1:"+otherId);
  await assert.rejects(handleMemberListingDirectory(i,{models:{outfit:Model}}),
    /belongs to someone else/);
  assert.deepEqual(i.calls,[]);
  assert.deepEqual(Model.calls,[]);
});
test("malformed paging controls are rejected without a database query",async()=>{
  const Model=fakeModel(100,[]);
  for(const customId of ["house:mine:-1:"+memberId,
      "house:mine:01:"+memberId,"house:mine:1",
      "house:mine:9999999999999999999999:"+memberId]) {
    await assert.rejects(handleMemberListingDirectory(
      interaction(customId),{models:{house:Model}}));
  }
  assert.deepEqual(Model.calls,[]);
});
