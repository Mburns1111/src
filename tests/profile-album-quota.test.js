import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_ALBUM_QUOTA_BYTES, beginProfileAlbumUpload,
  validateProfileUploadSizes, assertAlbumQuota, getProfileAlbumStorageBytes,
} from "../services/profile-album-quota.js";

const id = "123456789012345678", member = "234567890123456789";
const upload = size => [{ name: "photo.png", size }];

function fakeLock() {
  let held = false, expiresAt = 0, token = "";
  let releases = 0;
  const LockModel = {
    init: async () => {},
    updateOne: async (filter, change) => {
      if (held && expiresAt > filter.$or[1].expiresAt.$lte.getTime()) {
        throw Object.assign(new Error("duplicate key"), { code: 11000 });
      }
      held = true; expiresAt = change.$set.expiresAt.getTime();
      token = change.$set.token;
      return { acknowledged:true, upsertedCount:1 };
    },
    deleteOne: async filter => {
      if (filter.token === token) { held = false; releases++; }
    },
  };
  return { LockModel, get held(){return held;}, get releases(){return releases;} };
}
function filesWithBytes(bytes) {
  return { aggregate: stages => {
    assert.equal(stages[0].$match["metadata.guildId"], id);
    assert.equal(stages[0].$match["metadata.ownerId"], member);
    assert.equal(stages[1].$group.bytes.$sum, "$length");
    return { toArray: async () => bytes ? [{bytes}] : [] };
  } };
}
test("250 MiB allowance includes exact limit and rejects one byte beyond", () => {
  assert.equal(PROFILE_ALBUM_QUOTA_BYTES, 250 * 1024 * 1024);
  assert.doesNotThrow(() => assertAlbumQuota(PROFILE_ALBUM_QUOTA_BYTES - 5, 5));
  assert.throws(
    () => assertAlbumQuota(PROFILE_ALBUM_QUOTA_BYTES - 5, 6),
    /250 MB limit.*Remove some album photos/,
  );
});
test("per-photo and per-batch existing limits remain enforced", () => {
  assert.equal(validateProfileUploadSizes(upload(24*1024*1024)),24*1024*1024);
  assert.throws(() => validateProfileUploadSizes(upload(24*1024*1024+1)),/24 MB/);
  assert.throws(() => validateProfileUploadSizes(Array(4).fill({size:21*1024*1024})),/80 MB/);
  for (const size of [undefined,0,-1,NaN,1.25]) {
    assert.throws(()=>validateProfileUploadSizes(upload(size)),/valid photo size/);
  }
});
test("existing actual GridFS file lengths are counted, not the saved Discord size", async () => {
  assert.equal(await getProfileAlbumStorageBytes(id,member,filesWithBytes(245*1024*1024)),
    245*1024*1024);
});
test("quota accepts a member under their limit and releases the lease", async () => {
  const lock = fakeLock();
  const request = await beginProfileAlbumUpload(id,member,upload(5*1024*1024),{
    LockModel:lock.LockModel,filesCollection:filesWithBytes(245*1024*1024),
  });
  assert.equal(request.requestedBytes,5*1024*1024);
  assert.equal(lock.held,true);
  await request.release();
  await request.release();
  assert.equal(lock.held,false);
  assert.equal(lock.releases,1);
});
test("a rejected quota check releases its lease without deleting album photos",async()=>{
  const lock=fakeLock();
  await assert.rejects(beginProfileAlbumUpload(id,member,upload(3*1024*1024),{
    LockModel:lock.LockModel,filesCollection:filesWithBytes(249*1024*1024),
  }),/250 MB limit/);
  assert.equal(lock.held,false);
  assert.equal(lock.releases,1);
});
test("simultaneous album uploads do not both reserve storage",async()=>{
  const lock=fakeLock();
  const options={ LockModel:lock.LockModel,filesCollection:filesWithBytes(240*1024*1024) };
  const first=await beginProfileAlbumUpload(id,member,upload(5*1024*1024),options);
  await assert.rejects(beginProfileAlbumUpload(id,member,upload(5*1024*1024),options),
    /already running/);
  await first.release();
  const next=await beginProfileAlbumUpload(id,member,upload(5*1024*1024),options);
  await next.release();
});
test("expired upload leases can be reacquired after a crashed process",async()=>{
  const lock=fakeLock();
  const options={LockModel:lock.LockModel,filesCollection:filesWithBytes(0)};
  await beginProfileAlbumUpload(id,member,upload(5),{...options,now:()=>1000});
  const restarted=await beginProfileAlbumUpload(id,member,upload(5),{
    ...options,now:()=>1000+16*60*1000});
  assert.equal(lock.held,true);
  await restarted.release();
  assert.equal(lock.held,false);
});
