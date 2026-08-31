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
