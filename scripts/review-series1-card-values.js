#!/usr/bin/env node
/**
 * Series 1 value review. No fabricated scores or network scraping.
 *
 * Export an editable 108-row owner review file (does not alter MongoDB):
 *   node scripts/review-series1-card-values.js --export .hatchem-private/series1-values.json
 *
 * Read-only validation of reviewed scores, source links and roster:
 *   node scripts/review-series1-card-values.js --check .hatchem-private/series1-values.json
 *
 * Explicit development-only database write after source review:
 *   node scripts/review-series1-card-values.js --apply .hatchem-private/series1-values.json
 *
 * NEVER activates an egg, freezes achievements, alters hatch weights/rarity
 * or publishes a Discord message.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import {isCardGameTestMode} from "../services/card-game-mode.js";
import {
  series1ValueReviewTemplate,planSeries1ValueReviews,
} from "../services/card-series1-value-review-plan.js";

const [action,filename,...extra]=process.argv.slice(2);
if(!["--export","--check","--apply"].includes(action) || !filename || extra.length)
  throw Error("Usage: node scripts/review-series1-card-values.js --export|--check|--apply path/to/reviews.json");
if(!process.env.MONGODB_URI)throw Error("MONGODB_URI is required.");
if(action==="--apply" && (!isCardGameTestMode() ||
    !/^\d{17,20}$/.test(String(process.env.CARD_GAME_OWNER_DISCORD_ID||""))))
  throw Error("Reviewed values may be applied only by the configured owner on the development bot.");

const load=async(session=null)=>{
  const q=CardRelease.findOne({releaseId:"s1-r1",status:"draft"});
  if(session)q.session(session);
  const release=await q.lean();
  if(!release)throw Error("Official Series 1 draft was not found.");
  const defs=CardDefinition.find({releaseId:"s1-r1"});
  if(session)defs.session(session);
  const definitions=await defs.lean();
  return {release,definitions};
};
const file=path.resolve(filename);
await mongoose.connect(process.env.MONGODB_URI);
try{
  if(action==="--export"){
    const {definitions}=await load();
    const template=series1ValueReviewTemplate(definitions);
    await fs.mkdir(path.dirname(file),{recursive:true});
    // Refuse to silently overwrite edits or previously reviewed values.
    await fs.writeFile(file,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({mode:"EXPORT",cards:template.reviews.length,
      localFileCreated:true,databaseChanged:false,eggRemainsDraft:true},null,2));
  }else{
    const config=JSON.parse(await fs.readFile(file,"utf8"));
    const validate=async session=>{
      const {release,definitions}=await load(session);
      return planSeries1ValueReviews({release,definitions,config});
    };
    if(action==="--check"){
      const plan=await validate(null);
      const {changes,...report}=plan;
      console.log(JSON.stringify({...report,mode:"READ ONLY",databaseChanged:false},null,2));
    }else{
      const session=await mongoose.startSession();
      try{
        let report;
        await session.withTransaction(async()=>{
          const plan=await validate(session);
          for(const change of plan.changes){
            const result=await CardDefinition.updateOne({
              _id:change.id,releaseId:"s1-r1",enabled:true,artStatus:"approved",
              "valueReview.valueScore":null,
            },{$set:{valueReview:change.valueReview}},{session,runValidators:true});
            if(result.matchedCount!==1)
              throw Error("A reviewed pet changed concurrently; all value updates were rolled back.");
          }
          const {changes,...summary}=plan;
          report=summary;
        });
        console.log(JSON.stringify({...report,mode:"APPLIED",
          reviewsAdded:report.pendingReviews,eggRemainsDraft:true,
          rarityAndHatchWeightsUnchanged:true},null,2));
      }finally{await session.endSession();}
    }
  }
}finally{await mongoose.disconnect();}
