import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fixedRoleCanAccessRoute } from "../src/lib/fixed-role-policy.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("active staff navigation and role policy point messaging to the V3 Inbox", () => {
  const domain = source("src/lib/domain.ts");
  assert.match(domain, /whatsapp: "\/v3\/inbox"/u);
  assert.match(
    domain,
    /href: APP_ROUTES\.staff\.whatsapp,[\s\S]*?labelKey: "whatsapp"/u,
  );

  for (const role of ["admin", "sales", "admissions"]) {
    assert.equal(fixedRoleCanAccessRoute(role, "/v3/inbox"), true, role);
  }
});

test("active cross-module Inbox emitters no longer send staff to the V2 route", () => {
  const activeEmitters = [
    "src/app/platform-pending/page.tsx",
    "src/components/StaffNav.tsx",
    "src/lib/platform-guards.ts",
    "src/lib/server/platform-dashboard-model.ts",
  ];

  for (const path of activeEmitters) {
    const contents = source(path);
    assert.match(contents, /["'`]\/v3\/inbox(?:["'`]|\b)/u, path);
    assert.doesNotMatch(contents, /["'`]\/whatsapp(?:["'`]|\b)/u, path);
  }

  const staffLayout = source("src/app/(staff)/layout.tsx");
  assert.match(staffLayout, /hrefs: \["\/v3\/inbox"\]/u);
  assert.doesNotMatch(staffLayout, /hrefs: \["\/whatsapp"\]/u);
});
