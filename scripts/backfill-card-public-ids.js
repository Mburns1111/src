// One-time allocation for cards minted before public IDs existed.
// Dry-run by default; no card ownership, rarity, tags or upgrade data changes.
import "dotenv/config";
import mongoose from "mongoose";
import CardCopy from "../models/CardCopy.js";
import { allocateCardId } from "../services/card-identifiers.js";

const apply = process.argv.includes("--apply");
if (process.argv.some(arg => arg.startsWith("--") && arg !== "--apply")) {
  throw new Error("Only --apply is supported");
}
if (apply && (process.env.ENABLE_CARD_GAME_TEST !== "1" || process.env.CARD_ID_BACKFILL_APPROVED !== "YES")) {
  throw new Error("Requires ENABLE_CARD_GAME_TEST=1 and CARD_ID_BACKFILL_APPROVED=YES");
}
if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");
await mongoose.connect(process.env.MONGODB_URI);
try {
  const missing = { $or: [{ publicId: { $exists: false } }, { publicId: null }] };
  const count = await CardCopy.countDocuments(missing);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", cardsMissingPublicId: count, modifiesOnly: "CardCopy.publicId" }));
  if (!apply) {
    console.log("Dry-run only. No card records modified.");
  } else {
    await CardCopy.init(); // unique index must exist before allocating.
    let assigned = 0;
    while (true) {
      const oldest = await CardCopy.findOne(missing).sort({ createdAt: 1, _id: 1 }).select("_id").lean();
      if (!oldest) break;
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const match = await CardCopy.findOne({ _id: oldest._id, ...missing }).session(session);
          if (!match) return; // Already assigned by concurrent operation.
          const publicId = await allocateCardId(session);
          const result = await CardCopy.updateOne({ _id: oldest._id, ...missing }, { $set: { publicId } }, { session });
          if (result.modifiedCount !== 1) throw new Error("Concurrent card ID assignment. Transaction rolled back.");
          assigned++;
        });
      } finally {
        await session.endSession();
      }
    }
    console.log(JSON.stringify({ assigned, remaining: await CardCopy.countDocuments(missing) }));
  }
} finally {
  await mongoose.disconnect();
}
