import test from "node:test";
import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import {
  isDiscordMediaUrl, readDiscordAttachment, streamDiscordAttachment,
} from "../services/media-transfer.js";
import { Writable } from "node:stream";

const address = "https://cdn.discordapp.com/attachments/1/2/photo.png";
function makeReply(chunks, contentLength = null) {
  return {
    ok: true, status: 200,
    headers: { get: key => key === "content-length" ? contentLength : null },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
        controller.close();
      },
    }),
  };
}
test("only approved HTTPS Discord attachment hosts are permitted", () => {
  assert.equal(isDiscordMediaUrl(address), true);
  assert.equal(isDiscordMediaUrl("https://media.discordapp.net/attachments/1/2/x"), true);
  for (const url of [
    "http://cdn.discordapp.com/a", "https://discordapp.com.evil.test/a",
    "https://localhost/a", "file:///tmp/private", "https://evil.test/a",
    "https://someone@cdn.discordapp.com/a",
  ]) assert.equal(isDiscordMediaUrl(url), false, url);
});
test("a bounded download succeeds without trusting Content-Length", async () => {
  let options;
  const bytes = await readDiscordAttachment(address, {
    maxBytes: 5,
    fetchImpl: async (_url, opts) => { options = opts; return makeReply(["hi","!"]); },
  });
  assert.equal(bytes.toString(), "hi!");
  assert.equal(options.redirect,"error");
  assert.ok(options.signal);
});
test("Content-Length larger than the limit is rejected before streaming", async () => {
  await assert.rejects(readDiscordAttachment(address, {
    maxBytes: 2, fetchImpl: async () => makeReply(["x"], "100"),
  }), error => error.code === "TOO_LARGE");
});
test("an incorrect or missing Content-Length cannot bypass the byte limit", async () => {
  for (const length of [null, "2"]) {
    await assert.rejects(readDiscordAttachment(address, {
      maxBytes: 4, fetchImpl: async () => makeReply(["123","45"], length),
    }), error => error.code === "TOO_LARGE");
  }
});
test("non-Discord requests are rejected before fetch", async () => {
  let called = false;
  await assert.rejects(readDiscordAttachment("https://evil.test/a", {
    maxBytes: 10, fetchImpl: async () => { called = true; },
  }), error => error.code === "INVALID_URL");
  assert.equal(called,false);
});
test("streaming to a writable honors the limit and counts bytes", async () => {
  const saved = [];
  const sink = new Writable({write(chunk,_,cb){saved.push(chunk);cb();}});
  const size = await streamDiscordAttachment(address,sink,{
    maxBytes: 10,fetchImpl: async () => makeReply(["ab","cd"]),
  });
  assert.equal(size,4);
  assert.equal(Buffer.concat(saved).toString(),"abcd");
});
