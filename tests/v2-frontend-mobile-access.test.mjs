import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { staffOperatingSurfaces } from "./helpers/staff-surfaces.mjs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Sales queue uses bounded cursor pages for practical mobile access", () => {
  const sales = source("src/app/(staff)/sales/SalesWorkspace.tsx");

  assert.match(sales, /requirePlatformSalesActor\(\)/);
  assert.match(
    sales,
    /listPlatformSalesLeads\(actor,\s*\{[\s\S]*?pageSize:\s*15,/,
  );
  assert.match(sales, /page\.hasNext && page\.nextCursor/);
  assert.match(sales, /rel="next"/);
  assert.doesNotMatch(sales, /listCanonicalSalesLeads/);
  assert.doesNotMatch(
    sales,
    /listPlatformSalesLeads\(actor,\s*\{[\s\S]*?pageSize:\s*50,/,
  );
});

test("selected Inbox work opens independently of the long mobile queue", () => {
  const inbox = source("src/components/v3/Inbox.tsx");

  assert.match(inbox, /open \? "hidden @4xl:block" : ""/);
  assert.match(inbox, /data-testid="v3-inbox-thread"/);
  assert.match(inbox, /href=\{view\.queueCurrentHref\}/);
  assert.match(inbox, /@4xl:hidden/);
  assert.match(inbox, /<span className="sr-only">Назад к списку диалогов<\/span>/);
});

test("operational queue case links keep a practical target size", () => {
  const routes = [
    "src/app/(staff)/applications/page.tsx",
    "src/app/(staff)/visa/page.tsx",
    "src/app/(staff)/finance/page.tsx",
  ];

  for (const route of routes) {
    const moduleSource = source(route);
    assert.match(
      moduleSource,
      /className="inline-flex min-h-11 shrink-0 items-start pt-0\.5 text-xs font-semibold text-accent hover:underline"/,
      `${route} must give its Student 360 link a 44 px target`,
    );
    assert.doesNotMatch(
      moduleSource,
      /className="shrink-0 text-xs font-semibold text-accent hover:underline"/,
      `${route} must not keep the 17 px inline target`,
    );
  }
});

test("staff surfaces size to the dynamic viewport, not the static one", () => {
  // On mobile Safari and Chrome, 100vh is the viewport with the browser
  // chrome retracted, so a full-height pane is taller than what is visible
  // and its last row sits under the address bar. 100dvh tracks the real one.
  for (const surface of staffOperatingSurfaces()) {
    const moduleSource = readFileSync(
      new URL(`../${surface}`, import.meta.url),
      "utf8",
    );
    // `h-screen` / `min-h-screen` / `max-h-screen` compile to 100vh in
    // Tailwind v4, so naming the unit is not the only way to reach it.
    const offenders = [
      ...(moduleSource.match(/\b\d*\.?\d*(?:vh|svh|lvh)\b/g) ?? []),
      ...(moduleSource.match(/\b(?:[a-z0-9-]+:)?(?:min-|max-)?h-screen\b/g) ?? []),
    ];
    assert.deepEqual(
      offenders,
      [],
      `${surface} sizes to ${offenders[0]}; use dvh so mobile browser chrome is accounted for`,
    );
  }
});
