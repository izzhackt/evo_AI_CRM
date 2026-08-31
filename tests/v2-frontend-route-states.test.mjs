import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
