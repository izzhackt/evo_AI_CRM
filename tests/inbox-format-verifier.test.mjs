import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inspectInboxFormatScope, stableFormat, verifyInboxFormat } from "../scripts/verify-inbox-format.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const companion = resolve(repository, "agent-lead2-inbox");
const prettier = await import(pathToFileURL(resolve(companion, "node_modules/prettier/index.mjs")).href);
const sourcePath = "agent-lead2-inbox/src/lib/utils.ts";

test("the locked formatter reaches a verified fixed point for the two affected real sources", async () => {
  const cwd = process.cwd();
  process.chdir(companion);
  try {
    for (const relative of ["src/components/pipelines/deal-form.tsx", "src/lib/automations/engine.ts"]) {
      const filepath = resolve(companion, relative);
      const options = { ...await prettier.resolveConfig(filepath, { editorconfig: true, useCache: false }), filepath };
      const original = readFileSync(filepath, "utf8");
      const formatted = await stableFormat(prettier, original, options);
      assert.equal(await prettier.format(formatted, options), formatted, relative);
      assert.equal(await prettier.check(formatted, options), true, relative);
    }
  } finally { process.chdir(cwd); }
});

// Exercise the actual Git/Prettier toolchain using a copy of an existing source
// blob; this is a CI-gate test, not simulated product/provider acceptance.
test("Inbox formatter proof accepts the real transformation and rejects scope or behavior drift", async (context) => {
  const root = mkdtempSync(resolve(tmpdir(), "evo-format-gate-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, content) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  git("init", "-q");
  git("config", "user.name", "Formatter gate test");
  git("config", "user.email", "formatter-gate@example.invalid");
  for (const path of ["package.json", "package-lock.json", ".prettierrc", ".prettierignore", ".editorconfig", ".gitignore", "src/lib/utils.ts"]) {
    write(`agent-lead2-inbox/${path}`, readFileSync(resolve(companion, path)));
  }
  // Keep exercising a transformation after the real repository baseline is
  // formatted too; only harmless leading spaces are added to this temp copy.
  write(sourcePath, `   ${readFileSync(resolve(companion, "src/lib/utils.ts"), "utf8")}`);
  symlinkSync(resolve(companion, "node_modules"), resolve(root, "agent-lead2-inbox/node_modules"), "dir");
  git("add", ".");
  git("commit", "-qm", "test: original tracked inputs");
  const base = git("rev-parse", "HEAD");
  const filepath = resolve(root, sourcePath);
  const original = readFileSync(filepath, "utf8");
  const cwd = process.cwd();
  let formatted;
  process.chdir(resolve(root, "agent-lead2-inbox"));
  try {
    const options = await prettier.resolveConfig(filepath, { editorconfig: true, useCache: false });
    formatted = await prettier.format(original, { ...options, filepath });
  } finally { process.chdir(cwd); }
  assert.notEqual(formatted, original, "The existing baseline source must actually need formatting");
  const commit = () => { git("add", "."); git("commit", "-qm", "test: candidate transformation"); return git("rev-parse", "HEAD"); };
  const reset = () => git("reset", "--hard", base);

  await context.test("exact formatter output plus documentation", async () => {
    write(sourcePath, formatted);
    write("docs/format-receipt.md", "Formatting evidence.\n");
    const head = commit();
    assert.deepEqual(inspectInboxFormatScope(root, base, head), [sourcePath]);
    const result = await verifyInboxFormat({ root, base, head });
    assert.equal(result.files, 1);
    assert.equal(result.prettier, prettier.version);
    reset();
  });
  await context.test("a formatted semantic edit fails byte proof", async () => {
    write(sourcePath, `${formatted}\nexport const formattingGateSemanticChange = true;\n`);
    const head = commit();
    await assert.rejects(verifyInboxFormat({ root, base, head }), /Not the exact base formatting result/u);
    reset();
  });
  const forbidden = [
    ["dependencies", () => write("agent-lead2-inbox/package.json", "{}\n")],
    ["EditorConfig", () => write("agent-lead2-inbox/.editorconfig", "root = false\n")],
    ["nested formatter config", () => write("agent-lead2-inbox/src/.prettierrc", "{}\n")],
    ["mixed root code", () => write("scripts/not-formatting.mjs", "console.log(1);\n")],
    ["unknown child path", () => write("agent-lead2-inbox/private.bin", "unreviewed")],
    ["new source file", () => write("agent-lead2-inbox/src/new.ts", "export {};\n")],
    ["mode change", () => chmodSync(filepath, 0o755)],
    ["rename", () => renameSync(filepath, resolve(root, "agent-lead2-inbox/src/lib/renamed.ts"))],
    ["symlink", () => { rmSync(filepath); symlinkSync("../../package.json", filepath); }],
    ["known Caddyfile mixed with formatting", () => write("agent-lead2-inbox/deploy/Caddyfile.evo-edge", "# unsupported\n")],
  ];
  for (const [name, mutate] of forbidden) {
    await context.test(name, () => {
      write(sourcePath, formatted);
      mutate();
      const head = commit();
      assert.throws(() => inspectInboxFormatScope(root, base, head), /Unsupported|Mixed|mode changed|regular tracked/u);
      reset();
    });
  }
});
