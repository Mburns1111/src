import mongoose from "mongoose";
const model=(name,fields,indexes=[])=>{
 const schema=new mongoose.Schema(fields,{timestamps:true});
 for(const [keys,options] of indexes)schema.index(keys,options);
 return mongoose.models[name]||mongoose.model(name,schema);
};
export const AchievementControl=model("AchievementControl",{_id:String,startAt:Date,sequence:{type:Number,default:0}});
export const AchievementEvent=model("AchievementEvent",{
 _id:String,userId:String,kind:String,releaseId:String,channelId:String,guildId:String,
 at:Date,day:String,count:Number,partner:String,flags:[String],
},[[{userId:1,at:1},{}]]);
export const CardAcquisition=model("CardAcquisition",{
 userId:String,copyId:String,definitionId:String,releaseId:String,petId:String,rarity:String,
 fromPlayerDrop:Boolean,acquiredAt:Date,
},[[{userId:1,copyId:1},{unique:true}],[{userId:1,definitionId:1},{}]]);
export const AchievementDiscovery=model("AchievementDiscovery",{_id:String,value:{type:Number,default:0}});
export const AchievementReleaseFirst=model("AchievementReleaseFirst",{_id:String,userId:String,key:String,releaseId:String});
export const CardBonusUse=model("CardBonusUse",{
 _id:String,userId:String,action:String,sourceId:String,refundedAt:{type:Date,default:null},
});
