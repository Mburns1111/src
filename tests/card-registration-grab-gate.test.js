import test from "node:test";
import assert from "node:assert/strict";
import CardDrop from "../models/CardDrop.js";
import CardCollector from "../models/CardCollector.js";
import CardActionCooldown from "../models/CardActionCooldown.js";
import { handleCardGrab } from "../commands/cards.js";

test("unregistered member cannot grab from player egg or spend a 5-minute cooldown", async () => {
  const before = process.env.ENABLE_CARD_GAME_TEST;
  const original = {
    drop: CardDrop.findOne,
    registered: CardCollector.exists,
    cooldown: CardActionCooldown.findOneAndUpdate,
  };
  const user="123456789012345678";
  const guild="234567890123456789";
  const dropId="507f1f77bcf86cd799439011";
  const response = { content:null };
  try {
    process.env.ENABLE_CARD_GAME_TEST="1";
    CardDrop.findOne = () => ({select:()=>({lean:async()=>({
      _id:dropId, mode:"player",messageId:"999999999999999999",
    })})});
    CardCollector.exists = async query => {
      assert.equal(query.discordUserId,user);
      assert.equal(query.registeredGuildIds,guild);
      return null;
    };
    CardActionCooldown.findOneAndUpdate = () => {
      throw new Error("The unregistered player must not consume a cooldown.");
    };
    await handleCardGrab({
      guildId:guild, user:{id:user},
      customId:"cards:grab:"+dropId+":0",
      message:{id:"999999999999999999"},
      deferReply:async()=>{},
      editReply:async text=>{response.content=text;},
    });
    assert.match(response.content,/\.register/);
  } finally {
    if (before === undefined) delete process.env.ENABLE_CARD_GAME_TEST;
    else process.env.ENABLE_CARD_GAME_TEST=before;
    CardDrop.findOne=original.drop;
    CardCollector.exists=original.registered;
    CardActionCooldown.findOneAndUpdate=original.cooldown;
  }
});
