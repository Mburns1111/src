import mongoose from "mongoose";
import {DEFAULT_CLAIM_HOURS} from "../services/giveaway-claims.js";

// One configurable activity giveaway plan. Each planned drawing snapshots its prize,
// watched-rule settings and eligible entrants into a permanent Giveaway record.
const schema=new mongoose.Schema({
  guildId:{type:String,required:true},
  name:{type:String,required:true,trim:true,maxlength:60},
  nameKey:{type:String,required:true},
  title:{type:String,required:true,maxlength:100},
  watchNameKey:{type:String,required:true}, // 'general' or one saved GiveawayWatchRule
  creatorId:{type:String,required:true},
  channelId:{type:String,required:true}, // result channel at creation; configured winners channel can override
  listChannelId:{type:String,default:""},
  listMessageId:{type:String,default:""},
  listFingerprint:{type:String,default:""},
  bannerNameKey:{type:String,default:""},
  winnerCount:{type:Number,default:1,min:1,max:10},
  requireStaffReview:{type:Boolean,default:false},
  progressEnabled:{type:Boolean,default:false},
  announceEmptyResults:{type:Boolean,default:true},
  // A manually bounded one-time activity window, inclusive start / exclusive end.
  customActivityStartAt:{type:Date,default:null},
  customActivityEndAt:{type:Date,default:null},
  roleBonuses:[{roleId:{type:String,required:true},extraEntries:{type:Number,min:1,max:20,required:true}}],
  // Optional per-plan override. Null inherits the named watch's total goal.
  minimumTotalMessages:{type:Number,default:null,min:1,max:10000},
  claimWindowHours:{type:Number,default:DEFAULT_CLAIM_HOURS,min:1,max:720},
  prizes:{type:[String],default:[]},
  nextPrizeIndex:{type:Number,default:0,min:0},
  repeatPrizes:{type:Boolean,default:true},
  recurring:{type:Boolean,default:false}, // retained for older weekly plans
  repeatMode:{type:String,enum:["once","daily","weekly","interval"],default:null},
  intervalMinutes:{type:Number,default:null,min:60,max:43200},
  activityPeriod:{type:String,enum:["daily","weekly"],default:"weekly"},
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
