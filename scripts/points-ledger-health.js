// Read-only operational verification for Wispbyte/Replit operators.
// npm: node scripts/points-ledger-health.js
// Uses MONGODB_URI already configured on the bot; prints no credentials.
import "dotenv/config";
import mongoose from "mongoose";
import PointsLedger from "../models/PointsLedger.js";
import PointsWallet from "../models/PointsWallet.js";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI to inspect the Points ledger.");
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
    const collection = PointsLedger.collection;
    const [receipts, wallets, recent, indexes] = await Promise.all([
      PointsLedger.estimatedDocumentCount(),
      PointsWallet.estimatedDocumentCount(),
      PointsLedger.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
      }),
      collection.listIndexes().toArray(),
    ]);
    const expected = [
      ["guildId", "discordUserId", "eventKey"],
      ["guildId", "discordUserId", "createdAt"],
      ["guildId", "createdAt"],
      ["guildId", "kind", "createdAt"],
    ];
    const installed = expected.map(fields => ({
      fields: fields.join(", "),
      present: indexes.some(index => fields.every((name, i) =>
        Object.keys(index.key)[i] === name)),
    }));
    console.log(JSON.stringify({
      ledgerCollection: collection.collectionName,
      totalApproximateTransactions: receipts,
      totalApproximateWallets: wallets,
      transactionsDuringLast7Days: recent,
      expectedIndexes: installed,
    }, null, 2));
    if (installed.some(x => !x.present)) {
      console.warn("WARNING: Missing an expected PointsLedger index. Run and verify index creation BEFORE large-scale audit queries.");
      process.exitCode = 2;
    }
    try {
      const stats = await mongoose.connection.db.command({ collStats: collection.collectionName });
      console.log(JSON.stringify({
        ledgerDataBytes: stats.size,
        ledgerStoredBytes: stats.storageSize,
        ledgerIndexBytes: stats.totalIndexSize,
      }, null, 2));
    } catch (error) {
      console.warn("Storage stats unavailable with this MongoDB user's permissions:", error.codeName || error.message);
    }
  } catch (error) {
    console.error("Points ledger health check failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}
