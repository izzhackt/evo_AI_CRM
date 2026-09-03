import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

test("V2-8B has no SQLite application, visa, or finance mutation entry points", () => {
  assert.equal(
    existsSync(new URL("../src/lib/actions.ts", import.meta.url)),
    false,
  );
});

test("V2-8B has no superseded SQLite staff queue repository", () => {
  assert.equal(
    existsSync(new URL("../src/lib/queries.ts", import.meta.url)),
    false,
  );
});

test("V2-8B does not seed fake application, visa, or payment records", () => {
  assert.equal(
    existsSync(new URL("../src/lib/db.ts", import.meta.url)),
    false,
  );
});
