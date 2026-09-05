import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNameStatus,
  parseNameStatus,
} from "../scripts/classify-pr-changes.mjs";

const nul = (...fields) => Buffer.from(`${fields.join("\0")}\0`, "utf8");

test("name-status parser handles safe NUL-delimited changes and renames", () => {
  assert.deepEqual(
    parseNameStatus(nul("M", "docs/note.md", "R100", "src/old.ts", "docs/new.md")),
    [
      { status: "M", paths: ["docs/note.md"] },
      { status: "R100", paths: ["src/old.ts", "docs/new.md"] },
    ],
  );
  assert.throws(() => parseNameStatus(nul("M", "../secret")), /Unsafe changed path/u);
  assert.throws(() => parseNameStatus(nul("R100", "src/old.ts")), /Truncated/u);
});

test("ordinary prose documentation skips contract and code checks", () => {
  const result = classifyNameStatus(nul(
    "M",
    "docs/operator-note.md",
    "A",
    "README.md",
    "A",
    "docs/evidence/browser-proof.png",
    "A",
    "presentations/release-overview.pptx",
  ));
  assert.equal(result.ordinary_docs, true);
  assert.equal(result.contracts, false);
  assert.equal(result.migration_boundary, false);
  assert.equal(result.lint, false);
  assert.equal(Object.hasOwn(result, "typecheck"), false);
  assert.equal(result.build, false);
});

test("authoritative contracts request only the contract lane", () => {
  const result = classifyNameStatus(nul(
    "M",
    "AGENTS.md",
    "M",
    "docs/EVO_LAUNCH_PLAN.md",
    "M",
    "deploy/fast-app-release.md",
    "M",
    "deploy/production-release.md",
  ));
  assert.equal(result.ordinary_docs, false);
  assert.equal(result.contracts, true);
  assert.equal(result.code, false);
  assert.equal(result.build, false);
});

test("empty changed range fails closed", () => {
  const result = classifyNameStatus(Buffer.alloc(0));
  assert.equal(result.has_changes, false);
  assert.equal(result.unknown, true);
});

test("migration paths request the explicit migration-boundary lane", () => {
  const result = classifyNameStatus(nul("A", "supabase/migrations/117_example.sql"));
  assert.equal(result.migration_boundary, true);
  assert.equal(result.code, false);
  assert.equal(result.build, false);
});

test("known code, mixed and rename histories route to stronger checks", () => {
  for (const input of [
    nul("M", "src/app/page.tsx"),
    nul("M", "src/embedded-instructions.md"),
    nul("M", "docs/note.md", "M", "src/app/page.tsx"),
    nul("R100", "src/retired.ts", "docs/replacement.md"),
  ]) {
    const result = classifyNameStatus(input);
    assert.equal(result.code, true);
    assert.equal(result.lint, true);
    assert.equal(Object.hasOwn(result, "typecheck"), false);
    assert.equal(result.build, true);
    assert.equal(result.unknown, false);
  }
});

test("an unclassified path fails closed and also selects lint plus production build", () => {
  const result = classifyNameStatus(nul("M", "unclassified.binary"));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(Object.hasOwn(result, "typecheck"), false);
  assert.equal(result.build, true);
  assert.equal(result.unknown, true);
  assert.deepEqual(result.unknown_paths, ["unclassified.binary"]);
});

test("test and script changes lint without repeating the TypeScript or Next graph", () => {
  const result = classifyNameStatus(nul(
    "M",
    "tests/example.test.mjs",
    "M",
    "scripts/example.mjs",
  ));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(Object.hasOwn(result, "typecheck"), false);
  assert.equal(result.build, false);
  assert.equal(result.unknown, false);
});

test("runtime schemas and Node-version changes receive the production build gate", () => {
  const result = classifyNameStatus(nul(
    "M",
    "docs/schemas/provider-evidence.schema.json",
    "M",
    ".nvmrc",
  ));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(Object.hasOwn(result, "typecheck"), false);
  assert.equal(result.build, true);
  assert.equal(result.unknown, false);
});

test("control characters and dot segments in paths fail closed", () => {
  assert.throws(() => classifyNameStatus(nul("M", "docs/bad\nname.md")), /Unsafe changed path/u);
  assert.throws(() => classifyNameStatus(nul("M", "docs/./note.md")), /Unsafe changed path/u);
});
