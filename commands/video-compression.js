import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { UserFacingError } from "./errors.js";
import { isVideoAttachment, prepareFiles } from "./shared.js";

const execFileAsync = promisify(execFile);
const maxOutputBytes = 8 * 1024 * 1024;
const maxInputBytes = 100 * 1024 * 1024;
const audioBitrate = 64_000;
const minimumVideoBitrate = 80_000;

async function compressVideo(attachment, directory, index) {
  if (attachment.size > maxInputBytes) {
    throw new UserFacingError(
      "This video is too large for the bot to process (maximum input size: 100 MB). Use a hosted video link instead.",
    );
  }

  const inputPath = join(directory, `input-${index}`);
  const outputPath = join(directory, `compressed-${index}.mp4`);
  let response;
  try {
    response = await fetch(attachment.url);
    if (!response.ok || !response.body) {
      throw new Error(`Video download returned HTTP ${response.status}.`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(inputPath));
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
    ]);
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
      ]);
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
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    files,
    firstImageName,
    cleanup: () => directory
      ? rm(directory, { recursive: true, force: true })
      : Promise.resolve(),
  };
}
