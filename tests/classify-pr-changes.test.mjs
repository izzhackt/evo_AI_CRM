import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNameStatus,
  parseNameStatus,
} from "../scripts/classify-pr-changes.mjs";

const nul = (...fields) => Buffer.from(`${fields.join("\0")}\0`, "utf8");

test("only the retired Inbox manifests select its isolated dependency checks", () => {
  for (const path of ["agent-lead2-inbox/package.json", "agent-lead2-inbox/package-lock.json"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.inbox_dependencies, true, path);
    assert.equal(result.unknown, false, path);
    assert.equal(result.code, true, path);
    assert.equal(result.ordinary_docs, false, path);
    assert.equal(result.lint, false, path);
    assert.equal(result.build, false, path);
  }
  for (const path of ["agent-lead2-inbox/package.json.backup", "agent-lead2-inbox/nested/package.json"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.inbox_dependencies, false, path);
    assert.equal(result.unknown, true, path);
    assert.equal(result.build, true, path);
  }
});

test("Inbox maintenance preserves stronger checks for mixed changes and both rename paths", () => {
  const mixed = classifyNameStatus(nul("M", "agent-lead2-inbox/package-lock.json", "M", "src/app/page.tsx"));
  assert.equal(mixed.inbox_dependencies, true);
  assert.equal(mixed.lint, true);
  assert.equal(mixed.build, true);
  assert.equal(mixed.unknown, false);
  const docs = classifyNameStatus(nul("M", "agent-lead2-inbox/package.json", "M", "docs/EVO_LAUNCH_PLAN.md"));
  assert.equal(docs.inbox_dependencies, true);
  assert.equal(docs.contracts, true);
  assert.equal(docs.unknown, false);
  for (const paths of [
    ["agent-lead2-inbox/package.json", "agent-lead2-inbox/retired-package.json"],
    ["agent-lead2-inbox/unreviewed.json", "agent-lead2-inbox/package-lock.json"],
  ]) {
    const renamed = classifyNameStatus(nul("R100", ...paths));
    assert.equal(renamed.inbox_dependencies, true);
    assert.equal(renamed.unknown, true);
  }
  assert.equal(classifyNameStatus(nul("M", "agent-lead2-inbox/deploy/Caddyfile.evo-edge")).inbox_dependencies, false);
  assert.equal(classifyNameStatus(Buffer.alloc(0)).inbox_dependencies, false);
});

test("D4 native template runtime and server adapter remain code, not ordinary documentation", () => {
  for (const path of ["scripts/document-source/launcher.c", "scripts/university-template/inspect.mjs",
    "scripts/university-template/build.mjs", "scripts/university-template/test-harness.mjs",
    "scripts/run-university-template-runtime-tests.mjs", "src/lib/server/university-template-preflight.ts", "Dockerfile"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.code, true, path); assert.equal(result.unknown, false, path);
    assert.equal(result.ordinary_docs, false, path); assert.equal(result.lint, true, path);
  }
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
  const script = "scripts/prove-public-student-onboarding-local.mjs";
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

test("the shared EVO edge Caddy source is a known infrastructure path", () => {
  const result = classifyNameStatus(nul(
    "M",
    "agent-lead2-inbox/deploy/Caddyfile.evo-edge",
  ));
  assert.equal(result.code, true);
  assert.equal(result.lint, true);
  assert.equal(result.build, false);
  assert.equal(result.unknown, false);
});

test("only the exact shared edge Compose and non-secret import example are recognized", () => {
  for (const path of [
    "agent-lead2-inbox/deploy/docker-compose.edge.yml",
    "agent-lead2-inbox/deploy/website-intake-header.caddy.example",
  ]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.code, true, path);
    assert.equal(result.lint, true, path);
    assert.equal(result.build, false, path);
    assert.equal(result.unknown, false, path);
    assert.deepEqual(result.unknown_paths, [], path);
  }
  for (const path of [
    "agent-lead2-inbox/deploy/docker-compose.other.yml",
    "agent-lead2-inbox/deploy/website-intake-header.caddy",
  ]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.unknown, true, path);
    assert.equal(result.build, true, path);
    assert.deepEqual(result.unknown_paths, [path]);
  }
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


test("lead-agent dependency scope stays narrow and preserves mixed/rename gates", () => {
  for (const path of ["evo-lead-agent/pyproject.toml", "evo-lead-agent/uv.lock"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.lead_agent_dependencies, true);
    assert.equal(result.unknown, false);
    assert.equal(result.lint, false);
    assert.equal(result.build, false);
    assert.equal(result.code, true);
  }
  for (const path of ["evo-lead-agent/src/evo_lead_agent/main.py", "evo-lead-agent/uv.lock.bak", "evo-lead-agent/nested/uv.lock"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.lead_agent_dependencies, false);
    assert.equal(result.unknown, true);
  }
  const mixed = classifyNameStatus(nul("M", "evo-lead-agent/uv.lock", "M", "src/app/page.tsx"));
  assert.equal(mixed.lead_agent_dependencies, true);
  assert.equal(mixed.lint, true);
  assert.equal(mixed.build, true);
  assert.equal(mixed.unknown, false);
  for (const paths of [["evo-lead-agent/uv.lock", "evo-lead-agent/old.lock"], ["evo-lead-agent/old.lock", "evo-lead-agent/uv.lock"]]) {
    const result = classifyNameStatus(nul("R100", ...paths));
    assert.equal(result.lead_agent_dependencies, true);
    assert.equal(result.unknown, true);
  }
});


test("dependency smoke and its workflow select the actual Python lane", () => {
  for (const path of ["scripts/smoke-lead-agent-dependencies.py", ".github/workflows/evo-fast-pr-checks.yml"]) {
    const result = classifyNameStatus(nul("M", path));
    assert.equal(result.lead_agent_dependencies, true);
    assert.equal(result.unknown, false);
  }
});


test("Inbox formatting candidates require byte proof and preserve unknown/rename boundaries", () => {
  const path = "agent-lead2-inbox/src/app/page.tsx";
  const modified = classifyNameStatus(nul("M", path));
  assert.equal(modified.inbox_formatting, true);
  assert.equal(modified.inbox_dependencies, false);
  assert.equal(modified.unknown, false);
  assert.equal(modified.lint, false);
  assert.equal(modified.build, false);
  for (const status of ["A", "D", "T"]) {
    const result = classifyNameStatus(nul(status, path));
    assert.equal(result.inbox_formatting, false);
    assert.equal(result.unknown, true);
  }
  const renamed = classifyNameStatus(nul("R100", path, "agent-lead2-inbox/src/app/renamed.tsx"));
  assert.equal(renamed.inbox_formatting, false);
  assert.equal(renamed.unknown, true);
  const mixed = classifyNameStatus(nul("M", path, "M", "unclassified.binary"));
  assert.equal(mixed.inbox_formatting, true);
  assert.equal(mixed.unknown, true);
  for (const control of [".editorconfig", ".prettierrc", ".prettierignore", "src/prettier.config.mjs", "supabase/migrations/001.sql", "public/opus/encoder.js"]) {
    assert.equal(classifyNameStatus(nul("M", `agent-lead2-inbox/${control}`)).unknown, true, control);
  }
  assert.equal(classifyNameStatus(nul("M", "agent-lead2-inbox/deploy/docker-compose.edge.yml")).inbox_formatting, false);
  assert.equal(classifyNameStatus(nul("M", "scripts/verify-inbox-format.mjs")).inbox_dependencies, true);
});
