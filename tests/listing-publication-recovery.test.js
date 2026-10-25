import test from "node:test";
import assert from "node:assert/strict";
import { recoverStagedListingPosts, isFinishedListingMessage } from "../services/listing-publication-recovery.js";

const guildId = "123456789012345678", botId = "234567890123456789";
const house = { _id: "a".repeat(24), guildId, status: "active", publicationState: "staging",
  postChannelId: "345678901234567890", postMessageId: "456789012345678901",
  mediaMessageId: "567890123456789012", expectedPhotoCount: 2, expectedVideoCount: 1 };
const outfit = { ...house, _id: "b".repeat(24),
  postMessageId: "678901234567890123", mediaMessageId: "",
  expectedPhotoCount: 1, expectedVideoCount: 1 };
const message = (type, id, videos=0) => ({ author: { id: botId },
  components: [{ components: ["sold","interest","notify"].map(action => ({ customId: `${type}:${action}:${id}` })) }],
  attachments: new Map(Array.from({ length: videos }, (_, i) => [String(i), {
    id: String(i), name: `video-${i}.mp4`, contentType: "video/mp4",
  }])) });
function fixture({ housePost = message("house", house._id, 1), outfitPost = message("outfit", outfit._id, 1),
  videos = 1, photos = {house: 2, outfit:1} } = {}) {
  const writes = [], guild = { id: guildId, client: { user: { id: botId } },
    channels: { fetch: async () => ({ messages: { fetch: async id => id === house.postMessageId
      ? housePost : id === outfit.postMessageId ? outfitPost : message("house", house._id, videos) } }) } };
  const Model = { updateOne: async (q,patch) => { writes.push({q,patch}); return { matchedCount: 1 }; } };
  return { guild, writes,
    options: { records: {house:[house],outfit:[outfit]}, models:{house:Model,outfit:Model},
      countPhotos: async (type) => photos[type] } };
}
test("only this bot's fully published listing controls qualify for recovery", () => {
  assert.equal(isFinishedListingMessage("house",house,message("house",house._id),botId),true);
  assert.equal(isFinishedListingMessage("house",house,message("outfit",house._id),botId),false);
  assert.equal(isFinishedListingMessage("house",house,{...message("house",house._id),author:{id:"other"}},botId),false);
  assert.equal(isFinishedListingMessage("house",house,{author:{id:botId},components:[]},botId),false);
});
test("restarts safely promote completed Discord posts with verified photos and videos", async () => {
  const { guild, writes, options } = fixture();
  const result = await recoverStagedListingPosts(guild,options);
  assert.deepEqual(result,{ scanned:2,recovered:2,pending:0,unavailable:0 });
  assert.equal(writes.length,2);
  assert.ok(writes.every(x=>x.patch.$set.publicationState==="published"));
});
test("failed or incomplete uploads retain staging state and original references", async () => {
  const {guild,writes,options}=fixture({ photos:{house:1,outfit:1},outfitPost:message("outfit",outfit._id,0),videos:0 });
  const result=await recoverStagedListingPosts(guild,options);
  assert.equal(result.recovered,0);
  assert.equal(result.pending,2);
  assert.deepEqual(writes,[]);
});
test("unavailable Discord messages never cause media deletion or false publication", async () => {
  const {guild,writes,options}=fixture();
  guild.channels.fetch=async()=>{throw Object.assign(new Error("Forbidden"),{code:50001});};
  const result=await recoverStagedListingPosts(guild,options);
  assert.equal(result.unavailable,2);
  assert.equal(writes.length,0);
});

test("staged house without its expected native video stays pending", async () => {
  const {guild,writes,options} = fixture({ housePost: message("house", house._id, 0) });
  options.records.outfit=[];
  options.records.house=[{...house,mediaMessageId:""}];
  const result=await recoverStagedListingPosts(guild,options);
  assert.equal(result.pending,1);
  assert.deepEqual(writes,[]);
});

test("staged listing with partial archive stays pending even if the public post is complete", async () => {
  const {guild,writes,options} = fixture({photos:{house:2,outfit:0}});
  options.records.house=[];
  const result=await recoverStagedListingPosts(guild,options);
  assert.equal(result.pending,1);
  assert.deepEqual(writes,[]);
});
