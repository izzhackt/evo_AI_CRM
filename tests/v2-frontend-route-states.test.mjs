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
