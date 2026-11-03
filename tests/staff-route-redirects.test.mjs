import { strict as assert } from "node:assert";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import nextConfig from "../next.config.ts";

// Issue #1328: staff pages live at the top level (`/main`, `/profile`, …) and every old `/v3/...` address keeps
// working through a permanent redirect that carries the path and the query string.
const APP = new URL("../src/app", import.meta.url).pathname;
const PUBLIC = new URL("../public", import.meta.url).pathname;

const staffSegments = () =>
  readdirSync(join(APP, "(staff)")).filter((name) => statSync(join(APP, "(staff)", name)).isDirectory());

test("old /v3 addresses answer a permanent redirect to the same path without the prefix", async () => {
  const redirects = await nextConfig.redirects();
  assert.deepEqual(redirects, [
    { source: "/v3", destination: "/", permanent: true },
    { source: "/v3/:path*", destination: "/:path*", permanent: true },
  ]);
  assert.ok(redirects.every((rule) => !rule.source.startsWith("/api")), "/api/v3 stays where it is");
});

test("no staff route collides with another top-level route, group or public file", () => {
  const segments = staffSegments();
  assert.ok(segments.includes("main") && segments.includes("profile") && segments.includes("universities"), segments.join(", "));
  assert.equal(segments.includes("v3"), false, "no v3 folder is left");
  assert.equal(existsSync(join(APP, "(v3)")), false);
  const others = readdirSync(APP).filter((name) => !name.startsWith("(") && statSync(join(APP, name)).isDirectory());
  for (const segment of segments) {
    assert.equal(others.includes(segment), false, `${segment}: also a top-level folder of src/app`);
    assert.equal(existsSync(join(PUBLIC, segment)), false, `${segment}: also in public/`);
    assert.equal(["portal", "api", "login", "auth", "apply", "metrics", "platform-pending", "transcription-lab"].includes(segment), false, segment);
  }
  assert.equal(existsSync(join(APP, "(staff)", "page.tsx")), false, "`/` belongs to src/app/page.tsx");
});
