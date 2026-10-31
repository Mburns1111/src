import "dotenv/config";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import {initializeAchievements,freezeAchievementRelease} from "../services/card-achievement-engine.js";
// Local owner operation, dry-run by default. No registration or launch happens here.
const [filename,flag]=process.argv.slice(2);
if(!filename)throw Error("Usage: node scripts/configure-card-achievements.js config.json [--apply]");
const config=JSON.parse(await fs.readFile(filename,"utf8"));
if(!config.releaseId||!Array.isArray(config.secrets))throw Error("Expected releaseId and secrets array.");
if(config.secrets.length<6)throw Error("Author at least six release secrets before freezing the release.");
for(const tier of ["basic","medium","advanced"])if(config.secrets.filter(s=>s.tier===tier).length<2)throw Error("Include at least two secrets of each tier.");
if(!process.env.MONGODB_URI)throw Error("MONGODB_URI is required.");
await mongoose.connect(process.env.MONGODB_URI);
try{
 await initializeAchievements();
 const session=await mongoose.startSession();
 try{await session.withTransaction(async()=>{
  const release=await CardRelease.findOne({releaseId:config.releaseId,status:"draft"}).session(session);
  if(!release||release.achievementRoster?.length)throw Error("Only an unfrozen draft release may be configured.");
  release.achievementSecrets=config.secrets;await release.validate();
  if(flag!=="--apply"){console.log("Valid schema; dry-run only. Roster membership is checked on apply.");return;}
  await release.save({session});await freezeAchievementRelease(config.releaseId,session);
  console.log("Achievement roster and private release secrets frozen. Release remains a draft.");
 });}finally{await session.endSession();}
}finally{await mongoose.disconnect();}
