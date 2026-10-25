#!/usr/bin/env node
import "dotenv/config";
import { validateRuntimeConfiguration } from "../services/runtime-configuration.js";
// Read-only: no Mongo connection, Discord login, API requests, or secret output.
const args=process.argv.slice(2);
const mode=args.includes("--static")?"static":args.includes("--register")?"register":"bot";
if (args.some(x=>!["--static","--register"].includes(x)) ||
    (args.includes("--static") && args.includes("--register"))) {
  console.error("Usage: npm run preflight [-- --static | --register]");
  process.exitCode=1;
} else {
  try {
    const result=validateRuntimeConfiguration({mode});
    console.log("[Preflight] Configuration OK.",result);
    if (mode==="register") console.log("[Preflight] Validation only; no slash commands were registered.");
  } catch(error) {
    console.error("[Preflight] Configuration check failed:",error.message);
    process.exitCode=1;
  }
}
