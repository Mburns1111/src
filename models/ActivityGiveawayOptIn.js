import mongoose from "mongoose";

// Consent is scoped to one server. Activity counts use the current opt-in
// window, never an earlier opt-in session or a Discord role.
const schema=new mongoose.Schema({
 guildId:{type:String,required:true},
 userId:{type:String,required:true},
 active:{type:Boolean,default:false},
 optedInAt:{type:Date,default:null},
 // Minute counters are recorded in minute buckets. The current bucket is
 // cleared before re-entry so the new session can start immediately.
 countFrom:{type:Date,default:null},
 optedOutAt:{type:Date,default:null},
},{timestamps:true});
schema.index({guildId:1,userId:1},{unique:true});
schema.index({guildId:1,active:1,userId:1});
export default mongoose.models.ActivityGiveawayOptIn ||
 mongoose.model("ActivityGiveawayOptIn",schema);
