import mongoose from "mongoose";

// One effective cooldown per server/member; a separate history remains after
// expiry or staff removal. No TTL: private staff audit needs to survive.
const auditSchema=new mongoose.Schema({
  action:{type:String,enum:["apply","remove","adjust"],required:true},
  at:{type:Date,required:true},
  staffId:{type:String,required:true},
  sourceGiveawayId:{type:String,default:""},
  days:{type:Number,min:1,max:365,default:null},
  requestedExpiresAt:{type:Date,default:null},
},{_id:false});
const schema=new mongoose.Schema({
  guildId:{type:String,required:true},
  userId:{type:String,required:true},
  expiresAt:{type:Date,required:true},
  sourceGiveawayId:{type:String,default:""},
  days:{type:Number,min:1,max:365,default:null},
  appliedBy:{type:String,default:""},
  appliedAt:{type:Date,default:null},
  removedAt:{type:Date,default:null},
  removedBy:{type:String,default:""},
  history:{type:[auditSchema],default:[]},
},{timestamps:true});
schema.index({guildId:1,userId:1},{unique:true});
schema.index({guildId:1,expiresAt:1});
export default mongoose.models.GiveawayWinnerCooldown ||
 mongoose.model("GiveawayWinnerCooldown",schema);
