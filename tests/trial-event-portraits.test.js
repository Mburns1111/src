import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import {
  TRIAL_IMAGE_WIDTH, TRIAL_IMAGE_HEIGHT,
  renderTrialEventPortrait, buildTrialEventPortrait,
} from "../services/trial-event-portraits.js";
import { survivalEventPayload } from "../services/survival-giveaways.js";

const victimId = "234567890123456789";
const actorId = "345678901234567890";
const record = { _id: "507f1f77bcf86cd799439011",
  gameEvents: [{}], entrantIds: [victimId, actorId] };
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("gothic portraits render real PNGs at Discord-friendly dimensions for both duel and solo", async () => {
  const avatar = createCanvas(64, 64);
  const ctx = avatar.getContext("2d");
  ctx.fillStyle = "#e13e99";
  ctx.fillRect(0, 0, 64, 64);
  const image = await loadImage(avatar.toBuffer("image/png"));
  const users = {
    victim: { name: "Rose Fallen", image },
    actor: { name: "Challenger Thorn", image },
  };
  const duel = renderTrialEventPortrait({ victimId, actorId }, users);
  const solo = renderTrialEventPortrait({ victimId }, users);
  for (const png of [duel, solo]) {
    assert.ok(Buffer.isBuffer(png));
    assert.ok(png.subarray(0, 8).equals(signature));
    assert.equal(png.readUInt32BE(16), TRIAL_IMAGE_WIDTH);
    assert.equal(png.readUInt32BE(20), TRIAL_IMAGE_HEIGHT);
    assert.ok(png.length > 15_000, "portrait contains frame and artwork");
    const decoded = await loadImage(png);
    assert.equal(decoded.width, TRIAL_IMAGE_WIDTH);
    assert.equal(decoded.height, TRIAL_IMAGE_HEIGHT);
  }
  assert.notDeepEqual(duel, solo, "solo and duel use distinct layouts");
  assert.notDeepEqual(
    duel,
    renderTrialEventPortrait({ victimId, actorId }, {
      actor: { name: "Different user", image },
      victim: users.victim,
    }),
    "avatar labels affect the actual picture",
  );
});

test("when Discord users or avatars cannot be fetched, placeholder portraits still render", async () => {
  const client = { users: { fetch: async () => { throw Error("Discord unavailable"); } } };
  for (const event of [{ victimId }, { victimId, actorId }]) {
    const png = await buildTrialEventPortrait(client, event);
    assert.ok(png.subarray(0, 8).equals(signature));
    assert.ok(png.length > 15_000);
  }
  const absentClient = {};
  const fallback = await buildTrialEventPortrait(absentClient, { victimId });
  assert.ok(fallback.subarray(0, 8).equals(signature));
});

test("event payload links attached PNG without losing restart marker, count or story", () => {
  const duel = { victimId, actorId, description: "A thorny duel", remaining: 1 };
  const solo = { victimId, description: "The rose withers", remaining: 1 };
  for (const event of [duel, solo]) {
    const fileName = "trial-event-test.png";
    const embed = survivalEventPayload(record, event, 0, fileName);
    assert.equal(embed.embeds[0].data.image.url, "attachment://" + fileName);
    assert.equal(embed.embeds[0].data.footer.text, "Trial " + record._id + " · Event 1");
    assert.ok(embed.embeds[0].data.description.includes(event.description));
    assert.equal(embed.allowedMentions.parse.length, 0);
  }
  const withoutAttachment = survivalEventPayload(record, solo, 0);
  assert.equal(withoutAttachment.embeds[0].data.image, undefined,
    "text-only fallback remains safe if canvas fails");
  const png = renderTrialEventPortrait(duel);
  const file = new AttachmentBuilder(png, { name: "trial-event-test.png" });
  assert.equal(file.name, "trial-event-test.png");
  assert.ok(Buffer.isBuffer(file.attachment));
});
