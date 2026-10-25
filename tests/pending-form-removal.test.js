import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder } from "discord.js";
import {
  addRemoveFormButton, claimPendingFormOperation, releasePendingFormOperation,
  handleRemovePendingForm,
} from "../commands/pending-forms.js";
import { UserFacingError } from "../commands/errors.js";

const guildId = "123456789012345678";
const channelId = "234567890123456789";
const messageId = "345678901234567890";
const ownerId = "456789012345678901";
const managerId = "567890123456789012";
const botId = "678901234567890123";

const message = (type, author = botId) => ({
  id: messageId, author: { id: author },
  components: [{ components: [
    { customId: `${type}:new:${ownerId}`, disabled: false },
    { customId: `form:remove:${type}:${ownerId}` },
  ] }],
  delete: async () => {},
});
const FormModel = (log) => ({
  findOne: async filter => {
    assert.deepEqual(filter,{ guildId,channelId,messageId,ownerId,type:log.type });
    return { _id: "pending-record" };
  },
  deleteOne: async () => { log.actions.push("mongo"); },
});
function mock(type="house", userId=ownerId, { hasListing=false, deleteError=null, author=botId } = {}) {
  const log = { type, actions: [] };
  const msg = message(type,author);
  msg.delete = async () => {
    log.actions.push("discord");
    if (deleteError) throw deleteError;
  };
  const interaction = {
    customId: `form:remove:${type}:${ownerId}`, guildId, channelId,
    message: msg,
    user: { id: userId },
    memberPermissions: { has: flag => flag === PermissionFlagsBits.ManageGuild && userId === managerId },
    client: { user: { id: botId } },
    deferReply: async () => { log.actions.push("defer"); },
    editReply: async result => { log.reply = result; },
  };
  const Form = FormModel(log);
  const ListingModels = Object.fromEntries(["house","outfit","trade"].map(t => [t,{
    exists: async filter => {
      assert.equal(filter.postMessageId,messageId);
      return hasListing ? { _id:"listing" } : null;
    },
  }]));
  const forget = (...args) => { log.actions.push("forget"); log.forgot = args; };
  return { interaction, dependencies: { FormModel:Form, ListingModels, forget }, log };
}

test("Remove form button is appended to existing create controls for all three forms", () => {
  for (const type of ["house","outfit","trade"]) {
    const row = addRemoveFormButton(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${type}:new:${ownerId}`).setLabel("Create")
        .setStyle(3),
    ),type,ownerId).toJSON();
    assert.deepEqual(row.components.map(x=>x.custom_id),
      [`${type}:new:${ownerId}`, `form:remove:${type}:${ownerId}`]);
    assert.equal(row.components[1].label,"Remove form");
  }
});

test("original owner can remove an unfinished house form and clears tracked state", async () => {
  const {interaction,dependencies,log}=mock("house");
  await handleRemovePendingForm(interaction,dependencies);
  assert.deepEqual(log.actions,["defer","discord","mongo","forget"]);
  assert.deepEqual(log.forgot,["house",guildId,ownerId,messageId,channelId]);
  assert.match(log.reply.content,/removed/);
});

test("server managers can remove another member's abandoned outfit or trade form", async () => {
  for(const type of ["outfit","trade"]) {
    const {interaction,dependencies,log}=mock(type,managerId);
    await handleRemovePendingForm(interaction,dependencies);
    assert.deepEqual(log.actions,["defer","discord","mongo","forget"]);
  }
});

test("other members cannot remove forms they don't own", async () => {
  const {interaction,dependencies,log}=mock("outfit", "999999999999999999");
  await assert.rejects(handleRemovePendingForm(interaction,dependencies),UserFacingError);
  assert.deepEqual(log.actions,[]);
});

test("saved publication and staging records block destructive manual form removal", async () => {
  const {interaction,dependencies,log}=mock("house", ownerId,{hasListing:true});
  await assert.rejects(handleRemovePendingForm(interaction,dependencies),/saved listing/);
  assert.deepEqual(log.actions,["defer"]);
});

test("referenced message authored by another bot cannot be deleted", async () => {
  const {interaction,dependencies,log}=mock("trade",ownerId,{author:"other-bot"});
  await assert.rejects(handleRemovePendingForm(interaction,dependencies),/only remove unfinished forms posted by this bot/);
  assert.deepEqual(log.actions,["defer"]);
});

test("failed Discord deletion retains database reference for future retries", async () => {
  const {interaction,dependencies,log}=mock("outfit",ownerId,{deleteError: new Error("Discord unavailable")});
  await assert.rejects(handleRemovePendingForm(interaction,dependencies),/Discord unavailable/);
  assert.deepEqual(log.actions,["defer","discord"]);
});

test("form operation lock blocks racing removal and releases after completion", async () => {
  assert.equal(claimPendingFormOperation(guildId,channelId,messageId),true);
  assert.equal(claimPendingFormOperation(guildId,channelId,messageId),false);
  const {interaction,dependencies}=mock("house");
  await assert.rejects(handleRemovePendingForm(interaction,dependencies),/being submitted or handled/);
  releasePendingFormOperation(guildId,channelId,messageId);
  assert.equal(claimPendingFormOperation(guildId,channelId,messageId),true);
  releasePendingFormOperation(guildId,channelId,messageId);
});
