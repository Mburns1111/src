import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { recordMediaOperation } from "./media-telemetry.js";

export function isDiscordMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export class MediaTransferError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MediaTransferError";
    this.code = code;
  }
}

/** Hard-limit actual streamed bytes; never trust only Content-Length. */
export async function streamDiscordAttachment(url, writable, {
  maxBytes, timeoutMs = 20_000, fetchImpl = fetch,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("A positive maxBytes limit is required.");
  }
  const startedAt = Date.now();
  let outcome = "success", receivedBytes = 0;
  if (!isDiscordMediaUrl(url)) {
    recordMediaOperation("download", { outcome: "INVALID_URL" });
    throw new MediaTransferError("Invalid Discord media URL.", "INVALID_URL");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    // Reject untrusted redirects instead of fetching private or arbitrary hosts.
    const response = await fetchImpl(url, {
      signal: controller.signal, redirect: "error",
    });
    if (!response?.ok || !response.body) {
      throw new MediaTransferError(
        "Discord media download returned HTTP " + (response?.status ?? "unknown") + ".",
        "HTTP_ERROR");
    }
    const length = Number(response.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new MediaTransferError("Discord media exceeds the allowed file size.", "TOO_LARGE");
    }
    let size = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        receivedBytes = size;
        if (size > maxBytes) {
          callback(new MediaTransferError("Discord media exceeds the allowed file size.", "TOO_LARGE"));
        } else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limiter, writable, {
      signal: controller.signal,
    });
    if (!size) throw new MediaTransferError("Discord media was empty.", "EMPTY_FILE");
    return size;
  } catch (error) {
    outcome = controller.signal.aborted ? "TIMEOUT" :
      (error?.code || error?.name || "error");
    if (controller.signal.aborted) {
      throw new MediaTransferError("Discord media download timed out.", "TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    recordMediaOperation("download", {
      outcome, bytes: outcome === "success" ? receivedBytes : 0,
      durationMs: Date.now() - startedAt,
    });
  }
}

export async function readDiscordAttachment(url, options) {
  const parts = [];
  const writable = new Writable({
    write(chunk, encoding, callback) {
      parts.push(Buffer.from(chunk));
      callback();
    },
  });
  await streamDiscordAttachment(url, writable, options);
  return Buffer.concat(parts);
}
