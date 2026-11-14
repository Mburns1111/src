import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { data as setup } from "../commands/setup.js";
import { data as giveaway, trialData } from "../commands/giveaway.js";
import { guildSetupComplete, cardSetupComplete, trialSetupComplete } from "../services/guild-setup-gate.js";
import { guidedGuildSetupSummary, generalSetupFields, generalSetupChannelFields, cardSetupFields } from "../commands/general-card-setup.js";
import { trialSetupSummary, trialSetupPreview } from "../commands/trial-giveaway-setup.js";
import { survivalAnnouncement, survivalFinalePayload } from "../services/survival-giveaways.js";
import { claimDuration, nextClaimCheckAt, automaticRerollLimit } from "../services/giveaway-claims.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";

const guild = "123456789012345678";
const channel = "234567890123456789";
const staff = "345678901234567890";
const member = "456789012345678901";
const role = "567890123456789012";
const secondRole = "678901234567890123";
const settings = {
  survivalTrialChannelId: channel,
  activityGiveawayReviewChannelId: staff,
  trialDefaultRequiredRoleId: role,
  trialRoleInstructions: "Pick up the role in #roles",
  trialShowRoleInstructions: true,
  trialClaimInstructions: "Open a private support ticket and enter the ticket details.",
  trialClaimWindowMinutes: 30,
  trialMaxAutoRerolls: 2,
  trialNotificationRoleIds: [role, secondRole],
  trialDefaultBannerNameKey: "",
};
function trial(overrides = {}) {
  return {
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa", mode: "survival", status: "ended",
    guildId: guild, channelId: channel, creatorId: member,
    title: "Trial of the Court", prize: "Neon pet",
    speedSeconds: 5, winnerCount: 1,
    entrantIds: [member, secondRole], winnerIds: [member],
    originalChampionId: member, gameEvents: [{ victimId: secondRole }],
    nextEventIndex: 1, endsAt: new Date("2026-11-09T14:00:00Z"),
    gameEndedAt: new Date("2026-11-09T14:00:00Z"),
    claimStartedAt: new Date("2026-11-09T14:00:00Z"),
    winnerAssignedAt: [new Date("2026-11-09T14:00:00Z")],
    claimWindowMinutes: 30, claimInstructions: "Open a ticket.",
    autoRerollClaims: true, trialTicketClaimsEnabled: true,
    maxAutoRerolls: 2, winnerClaims: [], claimResolvedSlots: [],
    ...overrides,
  };
}

test("each feature has its own guided /setup command; legacy saved channel IDs remain readable", () => {
  const names = setup.toJSON().options.map(item => item.name);
  for (const name of ["general", "giveaways", "activity-giveaways", "trials", "cards"])
    assert.ok(names.includes(name), name + " is available");
  assert.equal(names.includes("channels"),false,"retired /setup channels is no longer registered");
  assert.equal(generalSetupFields[0], "commandChannelId");
  assert.equal(generalSetupFields[1], "giveawayArchiveChannelId");
  assert.equal(generalSetupFields[2], "serverTimeZone");
  assert.ok(generalSetupFields.includes("scheduledPingsChannelId"));
  assert.ok(!generalSetupFields.includes("giveawayChannelId"));
  assert.deepEqual(cardSetupFields, ["hatchemChannelId", "cardRoleId", "hatchemAutoDropsEnabled"]);
  for (const field of ["initialSetupCompletedAt", "trialSetupCompletedAt", "cardSetupCompletedAt",
    "hatchemAutoDropsEnabled", "trialClaimWindowMinutes", "trialNotificationRoleIds"])
    assert.ok(GuildConfig.schema.path(field), field + " is saved independently");
  assert.ok(Giveaway.schema.path("trialTicketClaimsEnabled"));
  assert.ok(Giveaway.schema.path("announcementPingRoleIds"));
});

test("General Setup validates only channel IDs, not the server time zone", () => {
  assert.deepEqual(generalSetupChannelFields, generalSetupFields.filter(field => field.endsWith("ChannelId")));
  assert.ok(generalSetupChannelFields.includes("commandChannelId"));
  assert.ok(generalSetupChannelFields.includes("giveawayArchiveChannelId"));
  assert.ok(generalSetupChannelFields.includes("scheduledPingsChannelId"));
  assert.ok(!generalSetupChannelFields.includes("serverTimeZone"),
    "America/New_York must not be fetched or validated as a Discord channel when saving");
});

test("guild commands require actual first setup, not a blank Mongo record", () => {
  assert.equal(guildSetupComplete(null), false);
  assert.equal(guildSetupComplete({ guildId: guild }), false);
  assert.equal(guildSetupComplete({ commandChannelId: channel }), true,
    "legacy setup with a command channel still works");
  assert.equal(guildSetupComplete({ initialSetupCompletedAt: new Date() }), true);
  assert.equal(cardSetupComplete({ commandChannelId: channel }), false);
  assert.equal(cardSetupComplete({ commandChannelId: channel, hatchemChannelId: channel }), false);
  assert.equal(cardSetupComplete({
    commandChannelId: channel, hatchemChannelId: channel, cardRoleId: role,
  }), true);
  assert.equal(trialSetupComplete({ commandChannelId: channel }), false);
  assert.equal(trialSetupComplete({
    commandChannelId: channel, survivalTrialChannelId: staff,
  }), true);
});

test("General setup allows a giveaway-only or cards-only guild with all optional areas disabled", () => {
  const summary = guidedGuildSetupSummary("general", {
    commandChannelId: channel,
    profileChannelId: "", houseChannelId: "", outfitChannelId: "",
    inventoryChannelId: "", tradingPostChannelId: "", tradeVoteChannelId: "",
    shopChannelId: "", partyGamesChannelId: "",
  });
  assert.match(summary, /Bot Commands, Shared Staff Archives and Server Time Zone are mandatory/i);
  assert.match(summary, /Disabled \/ skipped/);
  assert.match(summary, /Giveaways, activity giveaways, Court's Trials and Hatchem/);
  assert.doesNotMatch(summary, /must enable a profile/i);
  const cards = guidedGuildSetupSummary("cards", {
    hatchemChannelId: staff, cardRoleId: role, hatchemAutoDropsEnabled: false,
  });
  assert.match(cards, /Disabled/);
  assert.match(cards, /manual card drops available/i);
});

test("Trials keep independent eligibility and claims but use one shared giveaway announcement role", () => {
  const summary = trialSetupSummary(settings);
  assert.match(summary, /30 minutes/);
  assert.match(summary, /Prize rerolls:.*Not allowed/);
  assert.match(summary, /Pick up the role/);
  assert.match(summary, new RegExp(role));
  assert.doesNotMatch(summary, new RegExp(secondRole),"only the first legacy notification role is recognized as shared");
  assert.match(summary, /only to new Trials/i);
  const preview = trialSetupPreview(settings, { userId: member });
  assert.match(preview.content, /PREVIEW/i);
  assert.match(preview.embeds[0].toJSON().description, /ticket number/i);
  assert.match(preview.embeds[0].toJSON().description, /forfeit/i);
  assert.equal(preview.components[0].components[0].data.disabled, true);
  assert.equal(automaticRerollLimit({mode:"survival",maxAutoRerolls:10}),0,
    "older Trials with a saved reroll budget must also forbid replacements");
  const trialOpts = trialData.toJSON().options.find(x => x.name === "start").options.map(x => x.name);
  for (const name of ["no_required_role", "show_role_help", "claim_minutes", "banner"])
    assert.ok(trialOpts.includes(name));
  for (const obsolete of ["rerolls","disable_auto_rerolls"])
    assert.ok(!trialOpts.includes(obsolete),"Trial reroll override must not be offered: "+obsolete);
  assert.ok(!giveaway.toJSON().options.find(x => x.name === "start").options.some(x => x.name === "rerolls"));
});

test("new Trial royal verdict supports winner ticket claim button; legacy Trials keep old appearance", () => {
  const active = survivalFinalePayload(trial());
  assert.ok(active.components.length);
  assert.equal(active.components[0].components[0].data.label, "Enter Ticket Claim info");
  assert.match(active.embeds[0].toJSON().description, /Awaiting ticket info/);
  assert.match(active.embeds[0].toJSON().description, /CLAIM BEFORE THE DEADLINE/i);
  const filled = survivalFinalePayload(trial({
    winnerClaims: [{ slot: 0, userId: member, ticketNumber: "ABC-7",
      ticketUrl: "https://discord.com/channels/123/456/789" }],
  }));
  assert.match(filled.embeds[0].toJSON().description, /Claim submitted/);
  assert.doesNotMatch(filled.embeds[0].toJSON().description, /ABC-7/,
    "ticket numbers never appear publicly");
  const old = survivalFinalePayload(trial({
    trialTicketClaimsEnabled: false, autoRerollClaims: false,
  }));
  assert.equal(old.components.length, 0);
});

test("Trial claims use per-minute deadlines and expiry checks, without rewriting old Trials", () => {
  const record = trial();
  assert.deepEqual(claimDuration(record).count, 30);
  assert.equal(nextClaimCheckAt(record)?.toISOString(), "2026-11-09T14:30:00.000Z");
  assert.equal(automaticRerollLimit(record),0,"Trial winner deadline remains enforced but never rerolled");
  assert.equal(nextClaimCheckAt({ ...record, trialTicketClaimsEnabled: false,
    autoRerollClaims: false }), null);
  assert.equal(nextClaimCheckAt({ ...record, status: "running" }), null);
  const signup = survivalAnnouncement(trial({
    status: "open", requiredRoleId: role, requiredRoleInstructions: "Read #rules",
    showRequiredRoleInstructions: false, announcementPingRoleIds: [role, secondRole],
  }));
  assert.ok(signup.content.includes("<@&" + role + ">"));
  assert.ok(signup.content.includes("<@&" + secondRole + ">"));
  assert.deepEqual(signup.allowedMentions, { parse: [] });
  assert.doesNotMatch(signup.embeds[0].toJSON().description, /Read #rules/);
});

test("new setup guides and wild eggs are wired into actual runtime handlers", async () => {
  const index = await fs.readFile(new URL("../index.js", import.meta.url), "utf8");
  const eggs = await fs.readFile(new URL("../services/card-automatic-drops.js", import.meta.url), "utf8");
  assert.match(index, /handleGuidedGuildSetupInteraction/);
  assert.match(index, /handleTrialGiveawaySetupInteraction/);
  assert.match(index, /guildSetupComplete\(saved\)/);
  assert.match(index, /cardSetupComplete\(cardConfig\)/);
  assert.match(eggs, /hatchemAutoDropsEnabled:\s*\{\s*\$ne:\s*false\s*\}/);
});
