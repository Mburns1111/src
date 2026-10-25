import test from "node:test";
import assert from "node:assert/strict";
import {
  isDeletedDiscordMessage, checkOutfitListingMessage,
  outfitNeedsFormatUpgrade, outfitArtworkIsEmbedded, reconcileOutfitsForGuild,
  findCustomizableOutfits,
} from "../services/outfit-reconciliation.js";

const guildId = "123456789012345678";
const botId = "999999999999999999";
const postId = "111111111111111111";
const channelId = "222222222222222222";
const listingId = "a".repeat(24);
const guild = (fetchMessage) => ({
  id: guildId,
  client: { user: { id: botId } },
  channels: { fetch: async id => {
    assert.equal(id, channelId);
    return { messages: { fetch: fetchMessage } };
  }},
});
const listing = overrides => ({
  _id: listingId, guildId,
  postChannelId: channelId, postMessageId: postId,
  ownerId: "888888888888888888", status: "active",
  interestedUserIds: [], ...overrides,
});
const currentMessage = {
  author: { id: botId },
  attachments: new Map([["style", { name: "outfit-style-card.png" }]]),
  embeds: [{ image: { url: "attachment://outfit-style-card.png" } }],
  components: [{
    components: ["interest", "notify", "sold"].map(action => ({
      customId: `outfit:${action}:${listingId}`,
    })),
  }],
};

test("only Discord Unknown Message means confirmed deleted; permission error is not deletion", () => {
  assert.equal(isDeletedDiscordMessage({ code: 10008 }), true);
  assert.equal(isDeletedDiscordMessage({ code: 50001 }), false);
  assert.equal(isDeletedDiscordMessage({ code: 50013 }), false);
  assert.equal(isDeletedDiscordMessage(new Error("socket hang up")), false);
});

test("post deleted while offline is archived without erasing style or gallery", async () => {
  const record = listing({ postAppearance: { background: "rosePastel" },
    galleryMessageId: "333333333333333333" });
  let archived;
  const Model = { updateOne: async (query, patch) => {
    assert.equal(query.postMessageId, postId);
    assert.equal(query.status, "active");
    archived = patch.$set;
    return { modifiedCount: 1 };
  } };
  const g = guild(async () => { throw Object.assign(new Error("Unknown Message"), { code: 10008 }); });
  const result = await checkOutfitListingMessage(g, record, { ListingModel: Model });
  assert.equal(result.state, "missing");
  assert.equal(result.changed, true);
  assert.equal(archived.status, "missing");
  assert.ok(archived.missingAt instanceof Date);
  assert.equal(record.postAppearance.background, "rosePastel");
  assert.equal(record.galleryMessageId, "333333333333333333");
});

test("permission failures cannot archive an outfit or destroy saved media", async () => {
  let writes = 0;
  const Model = { updateOne: async () => { writes++; } };
  const g = guild(async () => { throw Object.assign(new Error("Missing Access"), { code: 50001 }); });
  const result = await checkOutfitListingMessage(g, listing(), { ListingModel: Model });
  assert.equal(result.state, "unavailable");
  assert.equal(writes, 0);
});

test("outfit from another bot cannot be edited but is never marked deleted", async () => {
  let writes = 0;
  const g = guild(async () => ({ author: { id: "another-bot" } }));
  const result = await checkOutfitListingMessage(g, listing(), {
    ListingModel: { updateOne: async () => { writes++; } },
  });
  assert.equal(result.state, "unavailable");
  assert.equal(writes, 0);
});

test("current one-message cards are recognized, old image/gallery/actions are upgraded", () => {
  assert.equal(outfitNeedsFormatUpgrade(listing(), currentMessage), false);
  assert.equal(outfitNeedsFormatUpgrade(listing({ galleryMessageId: "333" }), currentMessage), true);
  assert.equal(outfitNeedsFormatUpgrade(listing({ controlsMessageId: "444" }), currentMessage), true);
  assert.equal(outfitNeedsFormatUpgrade(listing({ styleCardMessageId: "555" }), currentMessage), true);
  assert.equal(outfitNeedsFormatUpgrade(listing(), {
    ...currentMessage, components: [],
  }), true);
  assert.equal(outfitNeedsFormatUpgrade(listing(), {
    ...currentMessage, attachments: new Map(),
  }), false, "Embed-backed artwork can be absent from attachment metadata");
  assert.equal(outfitNeedsFormatUpgrade(listing(), {
    ...currentMessage, embeds: [],
  }), true);
});

test("startup reconciliation automatically upgrades outdated outfit messages and skips current ones", async () => {
  const a = listing({ _id: "a".repeat(24), galleryMessageId: "333" });
  const b = listing({ _id: "b".repeat(24) });
  const c = listing({ _id: "c".repeat(24) });
  const d = listing({ _id: "d".repeat(24) });
  const upgraded = [];
  const result = await reconcileOutfitsForGuild({ id: guildId }, {
    records: [a,b,c,d],
    check: async (_guild, item) => {
      if (item === c) return { state: "missing" };
      if (item === d) return { state: "unavailable" };
      // Each current Discord button must identify the listing under test.
      const message = {
        ...currentMessage,
        components: [{
          components: ["interest", "notify", "sold"].map(action => ({
            customId: `outfit:${action}:${item._id}`,
          })),
        }],
      };
      return { state: "present", message };
    },
    refresh: async (_guild, item) => upgraded.push(String(item._id)),
  });
  assert.deepEqual(upgraded, [String(a._id)]);
  assert.deepEqual(result, {
    scanned: 4, converted: 1, missing: 1, current: 1, unavailable: 1, failed: 0,
  });
});

test("startup reconciliation continues after one outfit render fails", async () => {
  const a = listing({ _id: "a".repeat(24), galleryMessageId: "333" });
  const b = listing({ _id: "b".repeat(24), galleryMessageId: "444" });
  const success = [];
  const result = await reconcileOutfitsForGuild({ id: guildId }, {
    records: [a,b],
    check: async () => ({ state: "present", message: currentMessage }),
    refresh: async (_, item) => {
      if (item === a) throw new Error("Missing legacy image bytes");
      success.push(String(item._id));
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(result.converted, 1);
  assert.deepEqual(success, [String(b._id)]);
});

test("customization picker hides offline-deleted outfits even before next restart", async () => {
  const a = listing({ _id: "a".repeat(24), title: "Good outfit" });
  const b = listing({ _id: "b".repeat(24), title: "Deleted outfit" });
  const c = listing({ _id: "c".repeat(24), title: "Permissions issue" });
  const result = await findCustomizableOutfits({ id: guildId }, a.ownerId, {
    records: [a,b,c],
    check: async (_, item) => item === a ? { state: "present" } :
      item === b ? { state: "missing" } : { state: "unavailable" },
  });
  assert.deepEqual(result.available, [a]);
  assert.equal(result.missing, 1);
  assert.equal(result.unavailable, 1);
});

test("outfit embed CDN URLs do not trigger needless startup restyling", () => {
  for (const url of [
    "attachment://outfit-style-card.png",
    "https://cdn.discordapp.com/attachments/1/2/outfit-style-card.png?ex=123",
    "https://media.discordapp.net/attachments/1/2/outfit-style-card.png?width=1200",
  ]) {
    const post = { ...currentMessage, attachments: new Map(),
      embeds: [{ image: { url } }] };
    assert.equal(outfitArtworkIsEmbedded(post), true);
    assert.equal(outfitNeedsFormatUpgrade(listing(), post), false);
  }
});
