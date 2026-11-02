import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import CardDrop from "../models/CardDrop.js";
import { data as adminCommands } from "../commands/cards-admin.js";
import { chooseAutomaticDropRelease, configureAutomaticDrops,
  AUTO_DROP_DEFAULT_MINUTES } from "../services/card-automatic-drops.js";
import { eligiblePlayerDrop } from "../services/card-achievement-engine.js";

test("scheduled eggs are an explicit distinct mode; managers can configure a per-server interval", () => {
  assert.ok(CardDrop.schema.path("mode").enumValues.includes("automatic"));
  const options = adminCommands.toJSON().options;
  const auto = options.find(x => x.name === "auto-drops");
  assert.ok(auto);
  assert.ok(auto.options.find(x => x.name === "enabled").required);
  assert.equal(auto.options.find(x => x.name === "minutes").min_value, 15);
  assert.equal(AUTO_DROP_DEFAULT_MINUTES, 60);
});

test("scheduling is disabled by default and stores a future due time only when enabled", async () => {
  assert.equal(GuildConfig.schema.path("hatchemAutoDropsEnabled").defaultValue, false);
  const previous = { find: GuildConfig.findOne, update: GuildConfig.updateOne };
  const calls = [];
  try {
    GuildConfig.findOne = () => ({ lean: async () => ({
      guildId: "111111111111111111", hatchemChannelId: "222222222222222222",
      hatchemAutoDropMinutes: 60,
    }) });
    GuildConfig.updateOne = async (filter, update) => {
      calls.push({ filter, update }); return { modifiedCount: 1 };
    };
    const now = new Date("2026-11-02T12:00:00.000Z");
    const enabled = await configureAutomaticDrops({
      guildId: "111111111111111111", enabled: true, minutes: 30, now,
    });
    assert.equal(enabled.minutes, 30);
    assert.equal(enabled.nextAt.toISOString(), "2026-11-02T12:30:00.000Z");
    assert.equal(calls[0].update.$set.hatchemAutoDropsEnabled, true);
    assert.equal(calls[0].update.$set.hatchemAutoDropMinutes, 30);
    const disabled = await configureAutomaticDrops({
      guildId: "111111111111111111", enabled: false, now,
    });
    assert.equal(disabled.nextAt, null);
    assert.equal(calls[1].update.$set.hatchemAutoDropsEnabled, false);
    assert.equal(calls[1].update.$set.hatchemNextAutoDropAt, null);
    await assert.rejects(() => configureAutomaticDrops({
      guildId: "111111111111111111", enabled: true, minutes: 1, now,
    }), /between 15 and 1440/);
  } finally {
    GuildConfig.findOne = previous.find; GuildConfig.updateOne = previous.update;
  }
});

test("automatic drops select active real eggs before a development-only fallback", () => {
  assert.equal(chooseAutomaticDropRelease([], true), null);
  assert.equal(chooseAutomaticDropRelease([{ releaseId: "test-s1-r1" }], false), null);
  assert.equal(chooseAutomaticDropRelease([{ releaseId: "test-s1-r1" }], true).releaseId, "test-s1-r1");
  const releases = [{ releaseId: "test-s1-r1" }, { releaseId: "s1-r1" }];
  assert.equal(chooseAutomaticDropRelease(releases, true).releaseId, "s1-r1");
});

test("automatic real-release grabs count for achievements, test-release grabs never do", () => {
  const previous = process.env.CARD_ACHIEVEMENTS_START_AT;
  try {
    process.env.CARD_ACHIEVEMENTS_START_AT = "2026-11-01T00:00:00Z";
    assert.equal(eligiblePlayerDrop({
      mode: "automatic", releaseId: "s1-r1", createdAt: new Date("2026-11-02T00:00:00Z"),
    }), true);
    assert.equal(eligiblePlayerDrop({
      mode: "automatic", releaseId: "test-s1-r1", createdAt: new Date("2026-11-02T00:00:00Z"),
    }), false);
    assert.equal(eligiblePlayerDrop({
      mode: "test", releaseId: "s1-r1", createdAt: new Date("2026-11-02T00:00:00Z"),
    }), false);
  } finally {
    if (previous === undefined) delete process.env.CARD_ACHIEVEMENTS_START_AT;
    else process.env.CARD_ACHIEVEMENTS_START_AT = previous;
  }
});
