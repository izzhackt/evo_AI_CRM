import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./helpers/platform-waha-local-fetch.cjs", import.meta.url),
  "utf8",
);

test("the browser harness rewrites only the exact private WAHA origin to loopback", () => {
  assert.match(source, /requested\.origin === "http:\/\/evo-crm-waha:3000"/);
  assert.match(source, /target\.hostname !== "127\.0\.0\.1"/);
  assert.match(source, /target\.hostname !== "localhost"/);
  assert.match(source, /return originalFetch\(requested, init\)/);
  assert.match(source, /return originalFetch\(input, init\)/);
  assert.doesNotMatch(source, /EVO_V2_WAHA|evo-inbox-waha|fallback/i);
});
