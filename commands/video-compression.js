import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { streamDiscordAttachment } from "../services/media-transfer.js";
import { recordMediaOperation } from "../services/media-telemetry.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { UserFacingError } from "./errors.js";
import { isVideoAttachment, prepareFiles } from "./shared.js";

const execFileAsync = promisify(execFile);
const maxOutputBytes = 8 * 1024 * 1024;
const maxInputBytes = 100 * 1024 * 1024;
const audioBitrate = 64_000;
const minimumVideoBitrate = 80_000;
const maxConcurrentVideoJobs = 2;
let activeVideoJobs = 0;
const ffprobeTimeoutMs = 20_000;
const ffmpegTimeoutMs = 180_000;

async function compressVideo(attachment, directory, index) {
  if (attachment.size > maxInputBytes) {
    throw new UserFacingError(
      "This video is too large for the bot to process (maximum input size: 100 MB). Use a hosted video link instead.",
    );
  }

  const inputPath = join(directory, `input-${index}`);
  const outputPath = join(directory, `compressed-${index}.mp4`);
  try {
    await streamDiscordAttachment(attachment.url, createWriteStream(inputPath), {
      maxBytes: maxInputBytes, timeoutMs: 60_000,
    });
  } catch (error) {
    console.error("Unable to download uploaded video:", error);
    throw new UserFacingError(
      "I couldn't download that video from Discord. Please upload it again or use a hosted video link.",
    );
  }

  let duration;
  try {
    const result = await execFileAsync(ffprobe.path, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ], { timeout: ffprobeTimeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    duration = Number(result.stdout.trim());
  } catch (error) {
    console.error("Unable to read uploaded video metadata:", error);
    throw new UserFacingError(
      "I couldn't read this video. Please try a standard MP4 or WebM file, or use a hosted video link.",
    );
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new UserFacingError(
      "I couldn't determine this video's length. Please try another file or use a hosted video link.",
    );
  }

  let videoBitrate = Math.floor(
    (maxOutputBytes * 0.88 * 8 / duration) - audioBitrate,
  );
  if (videoBitrate < minimumVideoBitrate) {
    throw new UserFacingError(
      "This video is too long to compress reliably under 8 MB. Shorten it or use a hosted video link.",
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await execFileAsync(ffmpegPath, [
        "-y",
        "-i", inputPath,
        "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-b:v", String(videoBitrate),
        "-maxrate", String(videoBitrate),
        "-bufsize", String(videoBitrate * 2),
        "-c:a", "aac",
        "-b:a", String(audioBitrate),
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        outputPath,
      ], { timeout: ffmpegTimeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    } catch (error) {
      console.error("Video compression failed:", error);
      throw new UserFacingError(
        "I couldn't compress this video. Please try another file or use a hosted video link.",
      );
    }

    if ((await stat(outputPath)).size <= maxOutputBytes) return outputPath;
    videoBitrate = Math.floor(videoBitrate * 0.8);
  }

  throw new UserFacingError(
    "This video couldn't be compressed under 8 MB. Shorten it or use a hosted video link.",
  );
}

export async function prepareMediaFiles(attachments, prefix) {
  const needsCompression = attachments.some(item =>
    isVideoAttachment(item) && item.size > maxOutputBytes);
  if (needsCompression && activeVideoJobs >= maxConcurrentVideoJobs) {
    throw new UserFacingError(
      "The bot is processing other videos. Please try uploading yours again shortly.",
    );
  }
  if (needsCompression) activeVideoJobs++;
  const startedAt = Date.now();
  let outcome = "success";
  let directory;
  const files = [];
  let firstImageName;

  try {
    for (const [index, attachment] of attachments.entries()) {
      if (isVideoAttachment(attachment) && attachment.size > maxOutputBytes) {
        directory ??= await mkdtemp(join(tmpdir(), "discord-video-"));
        const path = await compressVideo(attachment, directory, index);
        files.push({
          attachment: path,
          name: `${prefix}-${index + 1}-video.mp4`,
        });
        continue;
      }

      const prepared = prepareFiles([attachment], `${prefix}-${index + 1}`);
      files.push(...prepared.files);
      firstImageName ??= prepared.firstImageName;
    }
  } catch (error) {
    outcome = error?.code || error?.name || "error";
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("[Media] Could not clean unsuccessful video files:", cleanupError);
        recordMediaOperation("videoCompression", { outcome: "cleanupFailed" });
      }
    }
    throw error;
  } finally {
    if (needsCompression) {
      activeVideoJobs--;
      recordMediaOperation("videoCompression", {
        outcome, durationMs: Date.now() - startedAt,
      });
    }
  }

  let cleaned = false;
  return {
    files,
    firstImageName,
    cleanup: async () => {
      if (!directory || cleaned) return;
      try {
        await rm(directory, { recursive: true, force: true });
        cleaned = true;
      } catch (error) {
        recordMediaOperation("videoCompression", { outcome: "cleanupFailed" });
        throw error;
      }
    },
  };
}
