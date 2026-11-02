import test from "node:test";
import assert from "node:assert/strict";
import { makeCreateTradeModal, makeTradeEmbed, resolveTradePictureInput } from "../commands/trade.js";

const ownerId = "123456789012345678";
const message = { channelId: "222222222222222222", id: "333333333333333333" };
const attachment = {
  id: "asset-1",
  url: "https://cdn.discordapp.com/attachments/example/photo.png",
  name: "trade.png",
  contentType: "image/png",
  size: 4096,
};

test("trade-vote modal has upload OR image-link inputs within the five-field Discord limit", () => {
  const modal = makeCreateTradeModal(ownerId, message, Date.now() + 60000).toJSON();
  assert.equal(modal.components.length, 5);
  const inputs = modal.components.map(item => item.component);
  assert.deepEqual(inputs.map(item => item.custom_id),
    ["title", "picture", "picture_url", "video_url", "video"]);
  const uploader = inputs.find(item => item.custom_id === "picture");
  assert.equal(uploader.min_values, 0);
  assert.equal(uploader.max_values, 1);
  assert.equal(uploader.required, false);
  assert.equal(inputs.find(item => item.custom_id === "picture_url").required, false);
});

test("uploaded picture without a URL is accepted", () => {
  assert.deepEqual(resolveTradePictureInput({ picture: attachment }), {
    picture: attachment,
    pictureUrl: "",
  });
});

test("pasted Discord image link is accepted and normalized", () => {
  const result = resolveTradePictureInput({
    pictureUrl: "  https://cdn.discordapp.com/attachments/123/456/photo.png?ex=test  ",
  });
  assert.equal(result.picture, undefined);
  assert.equal(result.pictureUrl, "https://cdn.discordapp.com/attachments/123/456/photo.png?ex=test");
});

test("trade picture requires exactly one image source", () => {
  assert.throws(() => resolveTradePictureInput({}), /Add one picture/i);
  assert.throws(() => resolveTradePictureInput({ picture: attachment, pictureUrl: "https://i.imgur.com/pet.png" }),
    /either an uploaded picture or a picture link/i);
  assert.throws(() => resolveTradePictureInput({
    picture: { ...attachment, name: "rules.pdf", contentType: "application/pdf" },
  }), /image file/i);
  assert.throws(() => resolveTradePictureInput({ pictureUrl: "javascript:alert(1)" }), /http or https/i);
});

test("URL-based image remains on trade vote embed when votes refresh", () => {
  const listing = {
    _id: "6ad000000000000000000001",
    title: "Fair trade?",
    ownerName: "Example",
    ownerRobloxUsername: "PetCollector",
    createdAt: new Date("2026-11-01T12:00:00Z"),
    videoUrl: "",
    imageUrl: "https://cdn.discordapp.com/attachments/123/456/trade.webp",
    qualityVotes: new Map([["123", "good"]]),
    decisionVotes: new Map(),
    votes: new Map(),
  };
  const image = makeTradeEmbed(listing).toJSON().image;
  assert.equal(image?.url, listing.imageUrl);
  listing.imageUrl = "";
  assert.equal(makeTradeEmbed(listing).toJSON().image, undefined,
    "file-upload trade posts should keep the existing native-attachment presentation");
});
