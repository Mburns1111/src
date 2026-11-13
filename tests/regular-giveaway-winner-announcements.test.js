import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import {giveawayAnnouncement} from "../services/giveaways.js";
import {handleGiveawayButton} from "../commands/giveaway.js";

const guildId="123456789012345678",source="234567890123456789",
 destination="345678901234567890",originalId="456789012345678901",
 currentId="567890123456789012",firstWinner="678901234567890123";
const id="507f1f77bcf86cd799439011";

test("one canonical Giveaway Winners result contains explicit winner, claim button and no internal record ID",()=>{
 const payload=giveawayAnnouncement({_id:id,guildId,mode:"standard",status:"ended",
  creatorId:"789012345678901234",title:"Pet",prize:"Mystery pet",
  winnerIds:[firstWinner],entrantIds:[firstWinner],winnerCount:1,claimResolvedSlots:[],
  endsAt:new Date(),claimWindowHours:12,winnerAssignedAt:[new Date()]});
 const embed=payload.embeds[0].toJSON();
 assert.match(embed.fields.map(f=>f.value).join("\n"),new RegExp(firstWinner));
 assert.doesNotMatch(embed.footer.text,/Giveaway ID:/i);
 assert.equal(payload.components[0].components[0].data.custom_id,"giveaway:claim:"+id);
 assert.deepEqual(payload.allowedMentions,{parse:[]});
});

test("claims use the moved canonical Winners message, never the deleted Giveaway List post",async()=>{
 const previous=Giveaway.findOne,answers=[];
 try{
  Giveaway.findOne=()=>({lean:async()=>({_id:id,guildId,mode:"standard",
   status:"ended",channelId:destination,messageId:currentId,
   resultChannelId:destination,listChannelId:"",listMessageId:"",
   winnerIds:[firstWinner],claimResolvedSlots:[],winnerClaims:[],
   claimWindowHours:12,winnerAssignedAt:[new Date()]})});
  const make=(channelId,messageId)=>({
    guildId,guild:{},channelId,message:{id:messageId},
    customId:"giveaway:claim:"+id,user:{id:firstWinner,bot:false},
    showModal:async modal=>answers.push({type:"modal",modal}),
    reply:async payload=>answers.push({type:"reply",payload}),
  });
  await handleGiveawayButton(make(destination,currentId));
  assert.equal(answers[0].type,"modal");
  await handleGiveawayButton(make(source,originalId));
  assert.equal(answers[1].type,"reply");
  assert.match(answers[1].payload.content,/could not be verified/);
 }finally{Giveaway.findOne=previous;}
});
