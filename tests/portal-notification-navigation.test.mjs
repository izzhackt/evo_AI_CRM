import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { notFound, permanentRedirect, redirect, unstable_rethrow } = require("next/navigation");

// Exercise the installed public API without parsing private router digests.
// This is a dependency check, not browser/Auth or notification-write evidence.
for (const [name, navigate] of [
  ["redirect", () => redirect("/login")],
  ["permanentRedirect", () => permanentRedirect("/login")],
  ["notFound", () => notFound()],
]) {
  test(`notification failure handling preserves Next ${name}`, () => {
    let navigationError;
    try {
      navigate();
    } catch (error) {
      navigationError = error;
    }
    assert.ok(navigationError instanceof Error);
    assert.throws(() => unstable_rethrow(navigationError), (error) => error === navigationError);
    assert.throws(
      () => unstable_rethrow(new Error("Wrapped navigation", { cause: navigationError })),
      (error) => error === navigationError,
    );
  });
}

test("ordinary command or transport errors remain available for local feedback", () => {
  assert.doesNotThrow(() => unstable_rethrow(new Error("Command failed")));
  assert.doesNotThrow(() => unstable_rethrow(new TypeError("Failed to fetch")));
});
