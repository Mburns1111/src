import mongoose from "mongoose";

// One configurable activity giveaway plan. Each planned drawing snapshots its prize,
// watched-rule settings and eligible entrants into a permanent Giveaway record.
const schema=new mongoose.Schema({
  guildId:{type:String,required:true},
  name:{type:String,required:true,trim:true,maxlength:60},
  nameKey:{type:String,required:true},
  title:{type:String,required:true,maxlength:100},
  watchNameKey:{type:String,required:true}, // 'general' or one saved GiveawayWatchRule
  creatorId:{type:String,required:true},
  channelId:{type:String,required:true},
  winnerCount:{type:Number,default:1,min:1,max:10},
  claimWindowHours:{type:Number,default:48,min:1,max:720},
  prizes:{type:[String],default:[]},
  nextPrizeIndex:{type:Number,default:0,min:0},
  repeatPrizes:{type:Boolean,default:true},
  recurring:{type:Boolean,default:false},
  nextRunAt:{type:Date,required:true},
  status:{type:String,enum:["active","paused","completed"],default:"active"},
  leaseUntil:{type:Date,default:null},
  leaseKey:{type:String,default:""},
  lastRunAt:{type:Date,default:null},
  lastResult:{type:String,default:""},
}, {timestamps:true});
schema.index({guildId:1,nameKey:1},{unique:true});
schema.index({status:1,nextRunAt:1,leaseUntil:1});
export const planNameKey = value => String(value||"").trim().toLocaleLowerCase("en-US");
export default mongoose.models.GiveawayPlan || mongoose.model("GiveawayPlan",schema);
