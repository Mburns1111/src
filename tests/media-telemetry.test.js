import test from "node:test";
import assert from "node:assert/strict";
import {
  flushMediaTelemetry, recordMediaOperation, mediaTelemetrySnapshot,
} from "../services/media-telemetry.js";

test("media diagnostics count events without file URLs or member identifiers", () => {
  mediaTelemetrySnapshot({reset:true});
  recordMediaOperation("download", {bytes:1000,durationMs:30});
  recordMediaOperation("download", {bytes:100,durationMs:10});
  recordMediaOperation("download", {outcome:"TOO_LARGE",durationMs:12});
  recordMediaOperation("videoCompression", {outcome:"TIMEOUT",durationMs:300});
  const got=mediaTelemetrySnapshot();
  assert.deepEqual(got["download:success"],{count:2,bytes:1100,durationMs:40});
  assert.deepEqual(got["download:TOO_LARGE"],{count:1,bytes:0,durationMs:12});
  assert.equal(got["videoCompression:TIMEOUT"].count,1);
  assert.doesNotMatch(JSON.stringify(got),/discordapp\.com|http|ownerId/);
  let lines=0;
  assert.deepEqual(flushMediaTelemetry(()=>{lines++;}),got);
  assert.equal(lines,1);
  assert.deepEqual(mediaTelemetrySnapshot(),{});
  assert.deepEqual(flushMediaTelemetry(()=>{lines++;}),{});
  assert.equal(lines,1);
});
test("media metrics reject unregistered categories rather than logging arbitrary inputs", () => {
  assert.throws(()=>recordMediaOperation("bad"),/Unknown media operation/);
});
