import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const queueRoutes = ["applications", "visa", "finance", "tasks"];

test("canonical staff queues own localized loading and error boundaries", () => {
  for (const route of queueRoutes) {
    const loading = source(`src/app/(staff)/${route}/loading.tsx`);
    const error = source(`src/app/(staff)/${route}/error.tsx`);

    assert.match(loading, /CanonicalQueueRouteLoading/, route);
    assert.match(loading, /getLocale/, route);
    assert.match(loading, new RegExp(`route="${route}"`), route);
    assert.match(error, /CanonicalQueueRouteError/, route);
    assert.match(error, new RegExp(`route="${route}"`), route);
    assert.match(error, new RegExp(`href="\/${route}"`), route);
  }
});

test("shared queue loading state announces progress and respects reduced motion", () => {
  const loading = source(
    "src/components/platform/core/CanonicalQueueRouteLoading.tsx",
  );

  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /motion-reduce:animate-none/);
  assert.match(loading, /md:hidden/);
  assert.match(loading, /md:block/);
});

test("shared queue error state is actionable and fails closed", () => {
  const error = source(
    "src/components/platform/core/CanonicalQueueRouteError.tsx",
  );
  const copy = source(
    "src/components/platform/core/canonical-queue-route-copy.ts",
  );

  assert.match(error, /role="alert"/);
  assert.match(error, /onClick=\{reset\}/);
  assert.match(error, /href=\{href\}/);
  assert.match(error, /useSyncExternalStore/);
  assert.match(copy, /PostgreSQL did not respond/);
  assert.match(copy, /No legacy source or fallback screen is used/);
  assert.doesNotMatch(copy, /Supabase|fixture|mock|provider connected/i);
});

test("a rejected query never claims the database failed", () => {
  const routes = [
    ["/clients", "src/app/(staff)/clients/StudentQueue.tsx"],
    ["/applications", "src/app/(staff)/applications/page.tsx"],
    ["/visa", "src/app/(staff)/visa/page.tsx"],
    ["/finance", "src/app/(staff)/finance/page.tsx"],
    ["/sales", "src/app/(staff)/sales/SalesWorkspace.tsx"],
  ];

  for (const [route, path] of routes) {
    const moduleSource = source(path);
    assert.match(
      moduleSource,
      /catch\b/,
      `${route} must catch its own query normalization failure`,
    );
    assert.match(
      moduleSource,
      /invalid:\s*$/m,
      `${route} must own a rejected-filter message`,
    );
  }

  for (const [route, path] of routes.slice(0, 4)) {
    assert.match(
      source(path),
      /canonical-queue-filter-rejected/,
      `${route} must render the rejected filter in page, not through the error boundary`,
    );
  }
});

test("every core staff queue owns a nearest loading boundary", () => {
  const queues = [
    ["/sales", "src/app/(staff)/sales/(queue)/loading.tsx", "sales"],
    ["/clients", "src/app/(staff)/clients/(queue)/loading.tsx", "clients"],
    ["/applications", "src/app/(staff)/applications/loading.tsx", "applications"],
    ["/documents", "src/app/(staff)/documents/(queue)/loading.tsx", null],
    ["/visa", "src/app/(staff)/visa/loading.tsx", "visa"],
    ["/finance", "src/app/(staff)/finance/loading.tsx", "finance"],
    ["/tasks", "src/app/(staff)/tasks/loading.tsx", "tasks"],
    ["/whatsapp", "src/app/(staff)/whatsapp/loading.tsx", null],
  ];

  for (const [route, path, sharedRoute] of queues) {
    const moduleSource = source(path);
    assert.match(
      moduleSource,
      /export default async function \w+Loading\(\)/,
      `${route} must export a loading boundary`,
    );
    if (sharedRoute) {
      assert.match(
        moduleSource,
        new RegExp(`route="${sharedRoute}"`),
        `${route} must use its own shared queue loading copy`,
      );
    }
  }

  const copy = source(
    "src/components/platform/core/canonical-queue-route-copy.ts",
  );
  for (const key of ["sales", "clients"]) {
    assert.match(
      copy,
      new RegExp(`^\\s{2}${key}: \\{`, "m"),
      `shared queue copy must cover ${key}`,
    );
  }
});

test("queue loading skeletons never cover a detail route", () => {
  // loading.tsx applies to a segment AND its children, so a queue skeleton
  // placed at src/app/(staff)/sales/loading.tsx would also flash on
  // /sales/[id]. The route group scopes it to the queue itself, matching the
  // pattern /documents already uses.
  for (const [route, group] of [
    ["/sales", "src/app/(staff)/sales"],
    ["/clients", "src/app/(staff)/clients"],
    ["/documents", "src/app/(staff)/documents"],
  ]) {
    assert.ok(
      !existsSync(new URL(`../${group}/loading.tsx`, import.meta.url)),
      `${route} must not own a segment-level loading.tsx that covers its detail routes`,
    );
    assert.ok(
      existsSync(new URL(`../${group}/(queue)/loading.tsx`, import.meta.url)),
      `${route} must scope its skeleton to the (queue) group`,
    );
  }
});

test("denied and not-connected states carry their own document title", () => {
  const denied = source("src/app/(staff)/access-denied/page.tsx");
  const pending = source("src/app/platform-pending/page.tsx");

  for (const [route, moduleSource] of [
    ["/access-denied", denied],
    ["/platform-pending", pending],
  ]) {
    assert.match(
      moduleSource,
      /export async function generateMetadata\(\): Promise<Metadata>/,
      `${route} must export route metadata`,
    );
    assert.match(
      moduleSource,
      /buildRouteMetadata\(\{\s*ru: COPY\.ru\.\w+,\s*ky: COPY\.ky\.\w+,\s*en: COPY\.en\.\w+,\s*\}\)/,
      `${route} must title the tab with its own localized state copy`,
    );
    // A tab title is a short noun phrase, not the page sentence — in EVERY
    // locale, and it is rendered through the root "%s | EVO Admissions CRM"
    // template, so the suffix counts toward what a tab can actually show.
    const SUFFIX = " | EVO Admissions CRM".length;
    const titleKey = moduleSource.match(/buildRouteMetadata\(\{\s*ru: COPY\.ru\.(\w+)/)?.[1];
    assert.ok(titleKey, `${route} must name its title copy key`);
    const titles = [
      ...moduleSource.matchAll(new RegExp(`\\n\\s+${titleKey}:\\s*"([^"]+)"`, "g")),
    ].map((match) => match[1]);
    assert.equal(
      titles.length,
      3,
      `${route} must define ${titleKey} for ru, ky and en`,
    );
    for (const title of titles) {
      assert.ok(
        title.length + SUFFIX <= 52,
        `${route} tab title "${title}" renders ${title.length + SUFFIX} chars with the template, too long for a browser tab`,
      );
    }
  }
});

test("a rejected query states no counts about a queue it never read", () => {
  const queue = source("src/app/(staff)/clients/StudentQueue.tsx");

  // The metric row must sit behind the same guard as the rejected message,
  // or the page asserts "0 active / 0 paused / 0 closed" about a queue it has
  // just told the operator it did not read.
  assert.match(
    queue,
    /\{params\.listInvalid \? null : \(\s*<div[^>]*>\s*<Metric label=\{copy\.found\}/,
    "the /clients metric row must not render for a rejected filter",
  );

  const sales = source("src/app/(staff)/sales/SalesWorkspace.tsx");
  assert.match(
    sales,
    /listInvalid \? \(/,
    "/sales keeps its counts inside the same guard",
  );
});
