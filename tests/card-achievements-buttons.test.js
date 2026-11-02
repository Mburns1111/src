import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { achievementMessage, handleCardAchievementButton } from "../commands/card-achievements-ui.js";
import { achievementPages } from "../services/card-achievements.js";

const owner = "123456789012345678";
const other = "234567890123456789";
const rows = Array.from({length: 29}, (_, i) => ({
  key: "milestone-" + i, name: "Milestone " + i,
  description: "Win " + (i+1) + " player eggs to complete this goal.",
  goal: 50, current: i, secret: false, earned: false,
}));
rows.wallet = {bonusGrabs: 1, bonusDrops: 1};

function buttonData(payload) {
  assert.deepEqual(payload.allowedMentions, {parse: []});
  assert.equal(payload.components.length, 1);
  return payload.components[0].toJSON().components;
}

test("achievements have Previous and Next buttons that reuse the same private message", () => {
  const first = achievementMessage(rows, owner);
  assert.match(first.content, /Page 1\/3/);
  assert.equal(new Set(buttonData(first).map(b => b.custom_id)).size, 4,
    "Discord requires different custom IDs for all buttons, even disabled ones");
  const buttons = buttonData(first);
  assert.deepEqual(buttons.map(b => b.label), ["◀ Previous","Page 1/3","Next ▶","Show Details"]);
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].disabled, true);
  assert.equal(buttons[1].custom_id, "cards:achievements:indicator:compact:1:" + owner);
  assert.equal(buttons[2].disabled, false);
  assert.equal(buttons[2].custom_id, "cards:achievements:next:compact:2:" + owner);
  assert.equal(buttons[3].custom_id, "cards:achievements:toggle:details:1:" + owner);
  const middle = achievementMessage(rows, owner, {page: 2});
  const middleButtons = buttonData(middle);
  assert.match(middle.content, /Page 2\/3/);
  assert.ok(!middle.content.includes("Milestone 0 —"));
  assert.equal(middleButtons[0].custom_id, "cards:achievements:previous:compact:1:" + owner);
  assert.equal(middleButtons[2].custom_id, "cards:achievements:next:compact:3:" + owner);
  assert.equal(middleButtons[0].disabled, false);
  const last = achievementMessage(rows, owner, {page: 900});
  assert.match(last.content, /Page 3\/3/);
  assert.equal(buttonData(last)[2].disabled, true);
  assert.equal(new Set(buttonData(last).map(b => b.custom_id)).size, 4,
    "Last-page Next and indicator IDs must differ");
  assert.equal(new Set(middleButtons.map(b => b.custom_id)).size, 4);
  const single = achievementMessage(rows.slice(0, 1), owner);
  const onePageButtons = buttonData(single);
  assert.equal(onePageButtons[0].disabled, true);
  assert.equal(onePageButtons[2].disabled, true);
  assert.equal(new Set(onePageButtons.map(b => b.custom_id)).size, 4,
    "Both disabled arrows and the page indicator must be unique on a one-page list");
});

test("compact and detailed views are toggles on the same page, not extra commands", () => {
  const compact = achievementMessage(rows, owner, {page: 1});
  const detailed = achievementMessage(rows, owner, {view: "details", page: 1});
  assert.equal(compact.content.includes(rows[0].description), false);
  assert.equal(detailed.content.includes(rows[0].description), true);
  const controls = buttonData(detailed);
  assert.equal(controls[3].label, "Compact");
  assert.equal(controls[3].custom_id, "cards:achievements:toggle:compact:1:" + owner);
  assert.equal(controls[2].custom_id, "cards:achievements:next:details:2:" + owner);
  assert.deepEqual(detailed.content, achievementPages(rows, {detailed: true})[0]);
  assert.throws(() => achievementMessage(rows, "invalid"), /Invalid achievement owner/);
});

test("other users cannot navigate private achievements or spoof malformed button IDs", async () => {
  const requested = [];
  const mock = (id, actor = other, guildId = "345678901234567890") => ({
    isButton: () => true, customId: id, guildId, user: {id: actor},
    reply: async payload => { requested.push(payload); },
    deferUpdate: () => { throw Error("Unauthorized button must not defer or fetch achievement data."); },
  });
  const own = "cards:achievements:next:compact:2:" + owner;
  await handleCardAchievementButton(mock(own));
  assert.equal(requested[0].flags, 64);
  assert.match(requested[0].content, /another collector/);
  await handleCardAchievementButton(mock("cards:achievements:next:compact:0:" + owner, owner));
  await handleCardAchievementButton(mock("cards:achievements:toggle:details:1:invalid", owner));
  await handleCardAchievementButton(mock("cards:achievements:next:secret:1:" + owner, owner));
  for(const notice of requested.slice(1)) assert.match(notice.content, /invalid/);
  assert.equal(requested.length, 4);
});

test("the same button handler is wired for private inventory, DM and slash interactions", () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const slash = readFileSync(new URL("../commands/cards.js", import.meta.url), "utf8");
  const inventory = readFileSync(new URL("../commands/card-inventory-ui.js", import.meta.url), "utf8");
  const pageButtons = readFileSync(new URL("../commands/card-achievements-ui.js", import.meta.url), "utf8");
  assert.match(source, /handleCardAchievementButton\(interaction\)/);
  assert.match(slash, /loadAchievementMessage\(interaction\.user\.id/);
  assert.match(inventory, /loadAchievementMessage\(userId\)/);
  assert.match(pageButtons, /await interaction\.deferUpdate\(\)/);
  assert.match(pageButtons, /interaction\.editReply\(await loadAchievementMessage/);
});
