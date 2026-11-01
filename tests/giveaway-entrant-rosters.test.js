import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import {
  data as giveawayData, trialData, execute as executeEvent,
  formatGiveawayEntrants, ENTRANTS_PER_PAGE,
} from "../commands/giveaway.js";

const guildId = "123456789012345678";
const admin = "234567890123456789";
const id = "507f1f77bcf86cd799439011";
const members = Array.from({ length: 120 }, (_, i) => String(400000000000000000n + BigInt(i)));
const sample = (overrides = {}) => ({
  _id: id, guildId, channelId: "345678901234567890", messageId: "456789012345678901",
  title: "Evening Court Gathering", status: "open",
  mode: "standard", entrantIds: members, ...overrides,
});
const stub = (records, object, key, value) => {
  records.push([object, key, object[key]]);
  object[key] = value;
};
const restore = records => {
  for (const [obj, key, value] of records.reverse()) obj[key] = value;
};

test("staff can view any giveaway or Court's Trial entrants with 25-per-page roster", () => {
  assert.equal(ENTRANTS_PER_PAGE, 25);
  for (const command of [giveawayData, trialData]) {
    const spec = command.toJSON();
    assert.equal(spec.default_member_permissions, "32");
    assert.ok(spec.options.some(o => o.name === "entrants"));
  }
  const page2 = formatGiveawayEntrants(sample(), 2);
  assert.match(page2, /120/);
  assert.match(page2, /Page:\*\* 2\/5/);
  assert.ok(page2.includes(members[25]));
  assert.ok(page2.includes(members[49]));
  assert.ok(!page2.includes(members[24]));
  assert.ok(!page2.includes(members[50]));
  assert.ok(page2.length < 2000, "ephemeral roster must respect Discord limit");
  assert.match(formatGiveawayEntrants(sample({ mode: "survival" }), 5), /Trial contestants/);
  assert.match(formatGiveawayEntrants(sample({ entrantIds: [] })), /No members have entered/);
  assert.throws(() => formatGiveawayEntrants(sample(), 6), /page/i);
});

function interaction(commandName, reference = id, page = 1, canManage = true) {
  let output;
  return {
    guild: { id: guildId }, guildId, commandName,
    user: { id: admin },
    memberPermissions: { has: bit => canManage && bit === PermissionFlagsBits.ManageGuild },
    options: {
      getSubcommand: () => "entrants",
      getString: () => reference,
      getInteger: () => page,
    },
    editReply: async result => { output = result; },
    replyResult: () => output,
  };
}

test("/giveaway entrants is restricted to staff and lists either type; /trial entrants is trial-only", async () => {
  const changes = [];
  let current = sample({ entrantIds: members.slice(0, 3) });
  try {
    stub(changes, Giveaway, "findOne", query => ({
      lean: async () => {
        assert.equal(query.guildId, guildId);
        return current;
      },
    }));
    let user = interaction("giveaway", id, 1, false);
    await executeEvent(user);
    assert.match(user.replyResult(), /Only members with Manage Server/);

    user = interaction("giveaway");
    await executeEvent(user);
    assert.match(user.replyResult().content, /Giveaway entrants/);
    assert.equal(user.replyResult().allowedMentions.parse.length, 0);
    current = sample({ mode: "survival", entrantIds: members.slice(0, 3) });
    user = interaction("giveaway");
    await executeEvent(user);
    assert.match(user.replyResult().content, /Trial contestants/);

    user = interaction("trial");
    await executeEvent(user);
    assert.match(user.replyResult().content, /Trial contestants/);

    current = sample({ mode: "standard" });
    user = interaction("trial");
    await executeEvent(user);
    assert.match(user.replyResult().content, /Use \/giveaway entrants/);
  } finally { restore(changes); }
});
