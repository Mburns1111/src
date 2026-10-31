import mongoose from "mongoose";

const schema = new mongoose.Schema({
  releaseId: { type: String, required: true, unique: true, immutable: true },
  seriesId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  eggName: { type: String, required: true },
  eggImageUrl: { type: String, default: "" },
  cardBackgroundKey: { type: String, default: "" },
  cardFrameKey: { type: String, default: "" },
  eggArtworkId: { type: String, default: "" },
  eggImageFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
  eggImageBucket: { type: String, default: "" },
  hatchOdds: {
    Common: { type: Number, default: 26, min: 0, max: 100 },
    Uncommon: { type: Number, default: 26, min: 0, max: 100 },
    Rare: { type: Number, default: 26, min: 0, max: 100 },
    "Ultra-Rare": { type: Number, default: 14, min: 0, max: 100 },
    Legendary: { type: Number, default: 8, min: 0, max: 100 },
  },
  // Frozen owner-authored achievement roster and private release secrets.
  achievementRoster: {type:[String],default:[]},
  achievementSecrets: {type:[new mongoose.Schema({
    key:{type:String,required:true},name:{type:String,required:true},
    description:{type:String,required:true},tier:{type:String,enum:["basic","medium","advanced"],required:true},
    metric:{type:String,enum:["acquiredDesigns","ownedDesigns","neonDesigns","megaDesigns"],required:true},
    definitionIds:{type:[String],required:true},activeOnly:{type:Boolean,default:true},
  },{_id:false})],default:[]},
  status: { type: String, enum: ["draft", "active", "retired"], default: "draft" },
}, { timestamps: true });

export default mongoose.models.CardRelease || mongoose.model("CardRelease", schema);
