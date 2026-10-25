#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, extname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const skip=new Set(["node_modules",".git",".cache","coverage"]);
async function list(dir) {
  const files=[];
  for (const item of await readdir(dir,{withFileTypes:true})) {
    if (item.isDirectory() && !skip.has(item.name) && !item.name.startsWith(".")) {
      files.push(...await list(join(dir,item.name)));
    } else if (item.isFile() && extname(item.name)===".js") files.push(join(dir,item.name));
  }
  return files;
}
const files=(await list(root)).sort();
let failures=0;
for(const file of files) {
  try {
    execFileSync(process.execPath,["--check",file],{stdio:"pipe"});
    const source=await readFile(file,"utf8");
    // Match declarations beginning with import, not "from" regexes or text in tests.
    const imports=[...source.matchAll(/^\s*import\s+(?:[^;]*?\sfrom\s*)?["'](\.[^"']+)["']/gm)]
      .map(x=>x[1]);
    for(const specifier of imports) {
      const resolved=resolve(dirname(file),specifier);
      if (!existsSync(resolved) && !existsSync(resolved+".js"))
        throw new Error("Missing relative import: "+specifier);
    }
  } catch(error) {
    failures++;
    console.error("[Source check] "+file.slice(root.length+1)+": "+
      (error.stderr?.toString().trim() || error.message));
  }
}
if (failures) { console.error("[Source check] "+failures+" file(s) failed."); process.exitCode=1; }
else console.log("[Source check] "+files.length+" JS files passed syntax and relative imports.");
