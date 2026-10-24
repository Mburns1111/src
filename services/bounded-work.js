// Fixed-concurrency execution for voice ticks. Processing members one at a
// time multiplies MongoDB round-trip latency and can miss minute ticks in busy
// guilds; unrestricted Promise.all can exhaust database connections.
export const VOICE_TICK_CONCURRENCY = 10;
export async function runBounded(items, worker, concurrency = VOICE_TICK_CONCURRENCY) {
  if (!Array.isArray(items) || !Number.isSafeInteger(concurrency) ||
      concurrency < 1 || concurrency > 32 || typeof worker !== "function") {
    throw new Error("Invalid bounded-work arguments");
  }
  let cursor = 0;
  const threads = Math.min(concurrency, items.length);
  return Promise.all(Array.from({ length: threads }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}
