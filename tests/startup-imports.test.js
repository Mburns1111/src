import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const entrypoint of ["index.js", "register-commands.js"]) {
  test(`${entrypoint} never imports a deleted relative module`, () => {
    const source = readFileSync(resolve(root, entrypoint), "utf8");
    // Import declarations in these two entrypoints use an explicit "from".
    // Check the actual target file rather than relying only on syntax tests.
    const relativeImports = [...source.matchAll(/\\bfrom\\s+["'](\\.[^"']+)["']/g)]
      .map(match => match[1]);
    assert.ok(relativeImports.length > 0, "Expected to find relative imports");
    for (const specifier of relativeImports) {
      assert.ok(
        existsSync(resolve(root, specifier)),
        `${entrypoint} imports missing module ${specifier}`,
      );
    }
  });
}

test("retired migration command is not registered by the application", () => {
  const entrypoint = readFileSync(resolve(root, "index.js"), "utf8");
  const registration = readFileSync(resolve(root, "register-commands.js"), "utf8");
  for (const source of [entrypoint, registration]) {
    assert.doesNotMatch(source, /migrate-old-posts|migrate_old_posts|executeMigrateOldPosts/);
  }
});
