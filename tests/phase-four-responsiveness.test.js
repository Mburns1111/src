import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  MAINTENANCE_BATCH_SIZE, yieldAfterMaintenanceBatch,
} from "../services/maintenance-batches.js";

test("reconciliation yields only after a bounded number of checked listings",async()=>{
  let yields=0;
  for(let checked=1;checked<=10;checked++) {
    const didYield=await yieldAfterMaintenanceBatch(checked,{
      batchSize:3, yieldFn:async()=>{yields++;},
    });
    assert.equal(didYield,checked%3===0);
  }
  assert.equal(yields,3);
  assert.equal(MAINTENANCE_BATCH_SIZE,4);
});
test("invalid maintenance batch arguments cannot silently disable yielding",async()=>{
  await assert.rejects(yieldAfterMaintenanceBatch(0),/Invalid maintenance batch/);
  await assert.rejects(yieldAfterMaintenanceBatch(1,{batchSize:0}),/Invalid maintenance batch/);
});
test("slash commands do not wait for potentially long startup reconciliation",()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const index=readFileSync(resolve(root,"index.js"),"utf8");
  assert.match(index,/await interaction\.deferReply\(\{ flags: MessageFlags\.Ephemeral \}\)/);
  assert.doesNotMatch(index,/await\s+startupMaintenancePromise/);
  assert.match(index,/void \(async \(\) => \{/);
  assert.match(index,/Startup channel maintenance failed/);
});
