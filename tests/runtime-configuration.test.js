import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeConfiguration, StartupConfigurationError } from "../services/runtime-configuration.js";
const env={
  DISCORD_TOKEN:"test-token-not-real",
  MONGODB_URI:"mongodb+srv://example:password@host.mongodb.net/db",
  DISCORD_CLIENT_ID:"123456789012345678",
  DISCORD_GUILD_ID:"234567890123456789",
};
test("static preflight requires no secrets and supports Node 20 / Node 22",()=>{
  assert.equal(validateRuntimeConfiguration({mode:"static",env:{},nodeVersion:"20.20.0"}).nodeMajor,20);
  assert.equal(validateRuntimeConfiguration({mode:"static",env:{},nodeVersion:"22.5.0"}).nodeMajor,22);
  assert.throws(()=>validateRuntimeConfiguration({mode:"static",env:{},nodeVersion:"19.9.0"}),/Node.js 20 or newer/);
});
test("bot configuration validation never returns secrets",()=>{
  const result=validateRuntimeConfiguration({env,mode:"bot"});
  assert.equal(result.mongoProtocol,"mongodb+srv");
  assert.equal(result.guildCommandRegistration,false);
  assert.doesNotMatch(JSON.stringify(result),/password|test-token/);
});
test("missing keys and invalid Mongo connection URI fail clearly",()=>{
  assert.throws(()=>validateRuntimeConfiguration({env:{...env,DISCORD_TOKEN:""}}),/DISCORD_TOKEN/);
  assert.throws(()=>validateRuntimeConfiguration({env:{...env,MONGODB_URI:"https://wrong.example"}}),/MONGODB_URI/);
  assert.throws(()=>validateRuntimeConfiguration({env:{...env,MONGODB_URI:"not-a-url"}}),/MONGODB_URI/);
});
test("registration mode validates Discord application and optional test guild IDs",()=>{
  const result=validateRuntimeConfiguration({env,mode:"register"});
  assert.equal(result.guildCommandRegistration,true);
  assert.throws(()=>validateRuntimeConfiguration({env:{...env,DISCORD_CLIENT_ID:"bad"},mode:"register"}),/DISCORD_CLIENT_ID/);
  assert.throws(()=>validateRuntimeConfiguration({env:{...env,DISCORD_GUILD_ID:"bad"},mode:"register"}),/DISCORD_GUILD_ID/);
});
test("bot mode does not require command-registration-only client ID",()=>{
  assert.equal(validateRuntimeConfiguration({env:{...env,DISCORD_CLIENT_ID:""}}).mode,"bot");
});
test("unknown preflight modes are rejected",()=>{
  assert.throws(()=>validateRuntimeConfiguration({env,mode:"ship-to-production"}),StartupConfigurationError);
});
