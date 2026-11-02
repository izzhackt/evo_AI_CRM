import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNameStatus,
  parseNameStatus,
} from "../scripts/checks/classify-pr-changes.mjs";

const nul = (...fields) => Buffer.from(`${fields.join("\0")}\0`, "utf8");

test("D4 native template runtime and server adapter remain code, not ordinary documentation", () => {
  for (const path of ["scripts/document-source/launcher.c", "scripts/university-template/inspect.mjs",
    "scripts/university-template/build.mjs", "scripts/university-template/test-harness.mjs",
    "scripts/test-runners/run-university-template-runtime-tests.mjs", "src/lib/server/university-template-preflight.ts", "Dockerfile"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.code, true, path); assert.equal(result.unknown, false, path);
    assert.equal(result.ordinary_docs, false, path); assert.equal(result.lint, true, path);
  }
});

test("Playwright configs under config/playwright and the root default config are known code", () => {
  for (const path of ["playwright.config.ts", "config/playwright/accessibility.config.ts",
    "config/playwright/supabase-staff-auth.config.ts", "scripts/release/evo-fast-release.sh",
    "scripts/checks/classify-pr-changes.mjs"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.code, true, path); assert.equal(result.unknown, false, path);
    assert.equal(result.ordinary_docs, false, path); assert.equal(result.lint, true, path);
  }
  // A new top-level Playwright config is no longer a recognised location.
  assert.equal(classifyNameStatus(nul("A", "playwright.extra.config.ts")).unknown, true);
});

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
    "docs/presentations/release-overview.pptx",
    "A",
    "docs/specs/issues/example.specs.md",
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

test("the exact onboarding proof receipt is documentary without accepting arbitrary JSON", () => {
  const receipt = "docs/evidence/public-student-onboarding-local-2026-09-18.json";
  const result = classifyNameStatus(nul("A", receipt));
  assert.equal(result.has_changes, true);
  assert.equal(result.ordinary_docs, true);
  assert.equal(result.unknown, false);
  assert.equal(result.code, false);
  assert.equal(result.lint, false);
  assert.equal(result.build, false);
  assert.deepEqual(result.ordinary_prose_paths, [receipt]);
  for (const path of [
    "docs/evidence/unreviewed.json",
    "docs/evidence/public-student-onboarding-local-2026-09-19.json",
    `${receipt}.backup`,
    "docs/evidence/nested/public-student-onboarding-local-2026-09-18.json",
  ]) {
    assert.equal(classifyNameStatus(nul("A", path)).unknown, true, path);
    for (const paths of [[receipt, path], [path, receipt]]) {
      assert.equal(classifyNameStatus(nul("R100", ...paths)).unknown, true, paths.join(" -> "));
    }
  }
});

test("onboarding evidence preserves the union of application, migration, contract and proof-script checks", () => {
  const script = "scripts/local-dev/prove-public-student-onboarding-local.mjs";
  const scriptOnly = classifyNameStatus(nul("A", script));
  assert.equal(scriptOnly.unknown, false);
  assert.equal(scriptOnly.code, true);
  assert.equal(scriptOnly.lint, true);
  assert.equal(scriptOnly.ordinary_docs, false);
  const result = classifyNameStatus(nul(
    "A", "docs/evidence/public-student-onboarding-local-2026-09-18.json",
    "A", "docs/evidence/public-student-onboarding-local-2026-09-18.md",
    "A", script,
    "M", "docs/EVO_LAUNCH_PLAN.md",
    "A", "src/lib/student-signup-actions.ts",
    "A", "supabase/migrations/177_platform_public_student_applications.sql",
  ));
  assert.equal(result.unknown, false);
  assert.equal(result.ordinary_docs, false);
  assert.equal(result.contracts, true);
  assert.equal(result.migration_boundary, true);
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(result.build, true);
  assert.deepEqual(result.unknown_paths, []);
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

test("the safe environment example is a known runtime configuration contract", () => {
  const result = classifyNameStatus(nul("M", ".env.example"));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(result.build, false);
  assert.equal(result.unknown, false);
  assert.deepEqual(result.unknown_paths, []);
});

test("the shadcn CLI config is known code with lint but not a production build input", () => {
  const result = classifyNameStatus(nul("A", "components.json"));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(result.build, false);
  assert.equal(result.unknown, false);
  assert.deepEqual(result.unknown_paths, []);
});

test("the shared EVO edge config under deploy/edge is known infrastructure code", () => {
  for (const path of [
    "deploy/edge/Caddyfile.evo-edge",
    "deploy/edge/docker-compose.edge.yml",
    "deploy/edge/website-intake-header.caddy.example",
    "deploy/edge/README.md",
  ]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.code, true, path);
    assert.equal(result.lint, true, path);
    assert.equal(result.build, false, path);
    assert.equal(result.unknown, false, path);
    assert.deepEqual(result.unknown_paths, [], path);
  }
});

test("CODEOWNERS is a governance contract path, not an unknown path", () => {
  const result = classifyNameStatus(nul("M", ".github/CODEOWNERS"));
  assert.equal(result.contracts, true);
  assert.equal(result.unknown, false);
  assert.equal(result.build, false);
});

test("the retired Inbox and lead-agent roots accept only removal, never new or edited files", () => {
  const retired = ["agent-lead2-inbox/src/app/page.tsx", "agent-lead2-inbox/package.json", "evo-lead-agent/uv.lock"];
  for (const path of retired) {
    const removed = classifyNameStatus(nul("D", path));
    assert.equal(removed.unknown, false, path);
    assert.deepEqual(removed.unknown_paths, [], path);
    assert.equal(removed.lint, false, path);
    assert.equal(removed.build, false, path);
    assert.equal(removed.code, true, path);
    for (const status of ["A", "M", "T"]) {
      const changed = classifyNameStatus(nul(status, path));
      assert.equal(changed.unknown, true, `${status} ${path}`);
      assert.equal(changed.build, true, `${status} ${path}`);
    }
  }
  // Moving the edge config out is accepted; moving anything into a retired root is not.
  const moved = classifyNameStatus(nul("R100", "agent-lead2-inbox/deploy/Caddyfile.evo-edge", "deploy/edge/Caddyfile.evo-edge"));
  assert.equal(moved.unknown, false);
  assert.equal(moved.lint, true);
  assert.equal(moved.build, false);
  const into = classifyNameStatus(nul("R100", "src/lib/utils.ts", "agent-lead2-inbox/src/lib/utils.ts"));
  assert.equal(into.unknown, true);
  // A removal mixed with an unreviewed path keeps the unknown path unknown.
  const mixed = classifyNameStatus(nul("D", "evo-lead-agent/uv.lock", "M", "unclassified.binary"));
  assert.equal(mixed.unknown, true);
  assert.deepEqual(mixed.unknown_paths, ["unclassified.binary"]);
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

test("the pinned Student Profile runtime template requires a production build", () => {
  const result = classifyNameStatus(nul("A", "assets/templates/student-profile.docx"));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(result.build, true);
  assert.equal(result.ordinary_docs, false);
  assert.equal(result.unknown, false);
  for (const path of ["assets/templates/unreviewed.docx", "assets/unreviewed.bin"]) {
    assert.equal(classifyNameStatus(nul("A", path)).unknown, true);
  }
});

test("the exact reviewed PDF font bundle requires a build without allowing unrelated assets", () => {
  for (const path of [
    "assets/fonts/NotoSans-Regular.ttf",
    "assets/fonts/OFL.txt",
    "assets/fonts/README.md",
  ]) {
    const result = classifyNameStatus(nul("A", path));
    assert.equal(result.code, true, path);
    assert.equal(result.lint, true, path);
    assert.equal(result.build, true, path);
    assert.equal(result.ordinary_docs, false, path);
    assert.equal(result.unknown, false, path);
  }
  for (const path of [
    "assets/fonts/unreviewed.ttf",
    "assets/fonts/unreviewed.md",
    "assets/fonts/nested/NotoSans-Regular.ttf",
    "assets/unreviewed.bin",
  ]) {
    assert.equal(classifyNameStatus(nul("A", path)).unknown, true, path);
  }
});

test("native iOS client sources are known code with lint but no Node production build", () => {
  for (const path of [
    "ios/project.yml",
    "ios/EVOAdmissions/App/EVOApp.swift",
    "ios/Local.xcconfig.example",
    "ios/.gitignore",
  ]) {
    const result = classifyNameStatus(nul("A", path));
    assert.equal(result.code, true, path);
    assert.equal(result.lint, true, path);
    assert.equal(result.build, false, path);
    assert.equal(result.ordinary_docs, false, path);
    assert.equal(result.unknown, false, path);
  }
});

test("portal content drafts under docs/design/portal/content are ordinary docs", () => {
  for (const path of [
    "docs/design/portal/content/professions-draft.json",
    "docs/design/portal/content/english-module-1-notes.md",
  ]) {
    const result = classifyNameStatus(nul("A", path));
    assert.equal(result.ordinary_docs, true, path);
    assert.equal(result.code, false, path);
    assert.equal(result.unknown, false, path);
  }
  for (const path of [
    "docs/design/portal/content/rogue.bin",
    "docs/design/portal/other.json",
  ]) {
    assert.equal(classifyNameStatus(nul("A", path)).unknown, true, path);
  }
});
