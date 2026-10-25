/**
 * Minimal in-memory media telemetry. No member IDs, photo names, URLs,
 * downloaded file contents, or tokens are included in these counters.
 * Counters reset after each summary so logs remain small on Wispbyte.
 */
const counters = new Map();
let timer = null;

export function recordMediaOperation(kind, {
  outcome = "success", bytes = 0, durationMs = 0,
} = {}) {
  if (!["download", "videoCompression", "profileAlbum"].includes(kind)) {
    throw new TypeError("Unknown media operation");
  }
  const key = kind + ":" + String(outcome).slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "");
  const value = counters.get(key) || { count: 0, bytes: 0, durationMs: 0 };
  value.count++;
  value.bytes += Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  value.durationMs += Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  counters.set(key, value);
}

export function mediaTelemetrySnapshot({ reset = false } = {}) {
  const report = Object.fromEntries([...counters].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, { ...value }]));
  if (reset) counters.clear();
  return report;
}

export function flushMediaTelemetry(log = console.info) {
  const result = mediaTelemetrySnapshot({ reset: true });
  if (Object.keys(result).length) {
    log("[Media metrics] Last hour:", result);
  }
  return result;
}

export function startMediaTelemetry() {
  if (timer) return;
  timer = setInterval(() => flushMediaTelemetry(), 60 * 60 * 1000);
  timer.unref?.();
}
