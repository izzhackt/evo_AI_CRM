import { strict as assert } from "node:assert";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Next.js refuses to serve when one path position mixes dynamic slug names
// (e.g. api/x/[a]/... next to api/x/[b]/...): the app boots, then every
// request dies with "You cannot use different slug names for the same
// dynamic path". `next build` does NOT catch it — release
// v3-r35425318843-a1-bebe5df9 was honestly rolled back by exactly this, so
// this walk pins the invariant at unit-test speed.
function dynamicChildren(dir) {
  return readdirSync(dir).filter((name) => {
    if (!name.startsWith("[") || !name.endsWith("]")) return false;
    return statSync(join(dir, name)).isDirectory();
  });
}
function walk(dir, offenders) {
  const dynamic = dynamicChildren(dir);
  if (new Set(dynamic).size > 1) offenders.push(`${dir}: ${dynamic.join(", ")}`);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, offenders);
  }
}
test("no app directory mixes dynamic slug names at one position", () => {
  const offenders = [];
  walk(new URL("../src/app", import.meta.url).pathname, offenders);
  assert.deepEqual(offenders, []);
});
