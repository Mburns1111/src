// Yield between small batches of startup reconciliation checks so READY
// maintenance does not monopolize the event loop during many old listings.
export const MAINTENANCE_BATCH_SIZE = 4;

export async function yieldAfterMaintenanceBatch(processed, {
  batchSize = MAINTENANCE_BATCH_SIZE,
  yieldFn = () => new Promise(resolve => setImmediate(resolve)),
} = {}) {
  if (!Number.isSafeInteger(processed) || processed < 1 ||
      !Number.isSafeInteger(batchSize) || batchSize < 1 ||
      typeof yieldFn !== "function") {
    throw new TypeError("Invalid maintenance batch parameters.");
  }
  if (processed % batchSize === 0) {
    await yieldFn();
    return true;
  }
  return false;
}
