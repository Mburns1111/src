import test from "node:test";
import assert from "node:assert/strict";
import { validateOptionalWebUrl } from "../commands/shared.js";
import { makeCreateListingModal } from "../commands/outfit.js";
import { houseArtworkIsEmbedded } from "../services/house-artwork.js";
import { houseNeedsFormatUpgrade } from "../services/house-availability.js";

test("optional outfit video URLs accept blank, none and N/A", () => {
  for (const raw of ["", "  ", undefined, null, "N/A", "n/a", "none",
    "No", "no link", "no video", "not applicable", "skip", "-"]) {
    assert.equal(validateOptionalWebUrl(raw, "Outfit video"), "", String(raw));
  }
  assert.equal(
    validateOptionalWebUrl("  https://youtu.be/example  ", "Outfit video"),
    "https://youtu.be/example",
  );
  assert.throws(
    () => validateOptionalWebUrl("hello world", "Outfit video"),
    /Outfit video must be a valid http or https URL/,
  );
});

test("outfit modal clearly explains optional link may be left blank", () => {
  const modal = makeCreateListingModal("123456789012345678", {
    channelId: "234567890123456789", id: "345678901234567890",
  }).toJSON();
  const label = modal.components.find(item =>
    item.component?.custom_id === "video_url");
  assert.match(label.label,/optional.*leave blank/i);
  assert.equal(label.component.required, false);
});

const id = "6add69d69249c7f6f595751d";
const base = {
  cardLayoutVersion:2, mediaMessageId:"", mediaAttachments:[],
  interestedUserIds:[],notifyOnInterest:false,_id:id,
};
function message(url, hasAttachment = true) {
  return {
    attachments: new Map(hasAttachment ? [["card", {name:"house-style-card.png"}]] : []),
    embeds: [{image:{url}}],
    components: [{components:["sold","interest","notify"].map(
      action => ({customId:`house:${action}:${id}`}))}],
  };
}

test("embedded house artwork counts even if Discord omits its image attachment", () => {
  for (const url of [
    "attachment://house-style-card.png",
    "https://cdn.discordapp.com/attachments/1/2/house-style-card.png?ex=123",
    "https://media.discordapp.net/attachments/1/2/house-style-card.png?width=1200",
  ]) {
    const post = message(url, false);
    assert.equal(houseArtworkIsEmbedded(post), true);
    assert.equal(houseNeedsFormatUpgrade(base, post), false);
  }
});

test("house reconciliation still catches a genuinely missing image embed", () => {
  const post = message("https://cdn.discordapp.com/attachments/1/2/unrelated.png");
  assert.equal(houseArtworkIsEmbedded(post), false);
  assert.equal(houseNeedsFormatUpgrade(base, post), true);
});
