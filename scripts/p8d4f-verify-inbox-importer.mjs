#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const P8D4F_CANDIDATE = "aaa9f618131f604f79c694e4b332a0b13afd7a30";
export const P8D4F_INBOX_TAG = `evo-inbox:${P8D4F_CANDIDATE}-linux-amd64`;
export const P8D4F_INBOX_IMAGE_ID = "sha256:d7be064bdd690ac42f9e18fbcb32b8fb42eac32f588256a983393ede9f8b79ca";
export const P8D4F_BUILD_EVIDENCE_BASENAME = `p8b2-input-${P8D4F_CANDIDATE}-linux-amd64`;
export const P8D4F_IMPORTER_EVIDENCE_FILE = "importer-runtime.json";

const SOURCE = "https://github.com/izzhackt/evo_AI_CRM";
const VERIFY_OUTPUT = { status: "knowledge_import_runtime_verified", version: 1 };

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mode(path) {
  return lstatSync(path).mode & 0o777;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} has unexpected keys`);
}

export function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function requireSuccess(result, label) {
  if (result.status !== 0 || result.signal) fail(`${label} failed`);
  return result.stdout.trim();
}

function inspectEvidenceRoot(input) {
  const requested = resolve(input);
  const rootInfo = lstatSync(requested);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("evidence root must be a real directory");
  const root = realpathSync(requested);
  if (root !== requested) fail("evidence root must not traverse symlinks");
  if (basename(root) !== P8D4F_BUILD_EVIDENCE_BASENAME || basename(dirname(root)) !== ".evo-release-evidence") {
    fail("unexpected P8D4F evidence root");
  }
  if (mode(root) !== 0o700) fail("evidence root mode must be 0700");
  return root;
}

function fileRecords(root, excluded = new Set(["collection-index.json"])) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => !excluded.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) fail(`unsafe evidence entry: ${entry.name}`);
      const path = join(root, entry.name);
      const fileMode = mode(path);
      if (fileMode !== 0o600) fail(`unsafe evidence mode: ${entry.name}`);
      return { file: entry.name, mode: 600, sha256: sha256(readFileSync(path)) };
    });
}

function verifyExistingIndex(root) {
  const indexPath = join(root, "collection-index.json");
  if (mode(indexPath) !== 0o600 || lstatSync(indexPath).isSymbolicLink()) fail("unsafe collection index");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  exactKeys(index, ["schema_version", "candidate_commit", "files"], "collection index");
  if (index.schema_version !== 1 || index.candidate_commit !== P8D4F_CANDIDATE || !Array.isArray(index.files)) {
    fail("collection index identity mismatch");
  }
  for (const [position, entry] of index.files.entries()) {
    exactKeys(entry, ["file", "mode", "sha256"], `collection index file ${position}`);
  }
  const actual = fileRecords(root);
  if (JSON.stringify(index.files) !== JSON.stringify(actual)) fail("collection index does not match retained evidence");
}

function dockerArgs(extra) {
  return [
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    "--user",
    "1001:1001",
    ...extra,
  ];
}

export function verifyP8D4FInboxImporter(evidenceRoot, runner = runCommand) {
  const root = inspectEvidenceRoot(evidenceRoot);
  const outputPath = join(root, P8D4F_IMPORTER_EVIDENCE_FILE);
  const outputTemp = join(root, `.${P8D4F_IMPORTER_EVIDENCE_FILE}.tmp.${process.pid}`);
  const indexPath = join(root, "collection-index.json");
  const indexTemp = join(root, `.collection-index.json.tmp.${process.pid}`);
  if (readdirSync(root).some((name) => name === P8D4F_IMPORTER_EVIDENCE_FILE || name.startsWith(".importer-runtime.json.tmp.") || name.startsWith(".collection-index.json.tmp."))) {
    fail("P8D4F importer evidence destination is not clean");
  }
  verifyExistingIndex(root);

  if (requireSuccess(runner("orb", ["status"]), "OrbStack preflight") !== "Running") fail("OrbStack must be Running");
  if (requireSuccess(runner("docker", ["context", "show"]), "Docker context preflight") !== "orbstack") {
    fail("Docker context must be exactly orbstack");
  }

  const inspect = JSON.parse(requireSuccess(runner("docker", ["image", "inspect", P8D4F_INBOX_TAG]), "Inbox image inspect"))[0];
  if (
    inspect?.Id !== P8D4F_INBOX_IMAGE_ID ||
    inspect?.Os !== "linux" ||
    inspect?.Architecture !== "amd64" ||
    (inspect?.Variant ?? "") !== "" ||
    inspect?.Config?.User !== "nextjs" ||
    inspect?.Config?.Labels?.["org.opencontainers.image.revision"] !== P8D4F_CANDIDATE ||
    inspect?.Config?.Labels?.["org.opencontainers.image.source"] !== SOURCE
  ) fail("Inbox candidate identity mismatch");

  const uid = requireSuccess(
    runner("docker", dockerArgs(["--entrypoint", "node", P8D4F_INBOX_TAG, "-e", "process.stdout.write(String(process.getuid?.() ?? -1))"])),
    "Inbox UID proof",
  );
  if (uid !== "1001") fail("Inbox importer did not run as UID 1001");

  const verifyRaw = requireSuccess(
    runner("docker", dockerArgs(["--entrypoint", "npm", P8D4F_INBOX_TAG, "--silent", "run", "knowledge:import", "--", "--verify-runtime"])),
    "Inbox importer runtime proof",
  );
  let verifyResult;
  try {
    verifyResult = JSON.parse(verifyRaw);
  } catch {
    fail("Inbox importer runtime output is not JSON");
  }
  if (JSON.stringify(verifyResult) !== JSON.stringify(VERIFY_OUTPUT)) fail("Inbox importer runtime output mismatch");

  const incomplete = runner("docker", dockerArgs(["--entrypoint", "npm", P8D4F_INBOX_TAG, "--silent", "run", "knowledge:import"]));
  if (!Number.isInteger(incomplete.status) || incomplete.status === 0 || incomplete.signal) {
    fail("Incomplete Inbox import did not fail closed");
  }

  const evidence = {
    schema_version: 1,
    candidate_commit: P8D4F_CANDIDATE,
    image: {
      name: "evo_inbox",
      tag: P8D4F_INBOX_TAG,
      image_id: P8D4F_INBOX_IMAGE_ID,
      platform: "linux/amd64",
      configured_user: "nextjs",
      observed_uid: 1001,
    },
    runtime: {
      network: "none",
      mounts: 0,
      injected_environment_variables: 0,
      verify_result_code: "knowledge_import_runtime_verified",
      incomplete_invocation: "rejected",
    },
  };

  let outputInstalled = false;
  try {
    writeFileSync(outputTemp, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(outputTemp, 0o600);
    requireSuccess(runner("gitleaks", ["detect", "--no-git", "--source", root, "--redact", "--exit-code", "1"]), "evidence privacy scan");

    const records = fileRecords(root, new Set(["collection-index.json", basename(outputTemp)]));
    records.push({ file: P8D4F_IMPORTER_EVIDENCE_FILE, mode: 600, sha256: sha256(readFileSync(outputTemp)) });
    records.sort((left, right) => left.file.localeCompare(right.file));
    const nextIndex = { schema_version: 1, candidate_commit: P8D4F_CANDIDATE, files: records };
    writeFileSync(indexTemp, `${JSON.stringify(nextIndex, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(indexTemp, 0o600);
    renameSync(outputTemp, outputPath);
    outputInstalled = true;
    renameSync(indexTemp, indexPath);
  } catch (error) {
    rmSync(outputTemp, { force: true });
    rmSync(indexTemp, { force: true });
    if (outputInstalled) rmSync(outputPath, { force: true });
    throw error;
  }
  return evidence;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--evidence-root");
  if (index < 0 || !process.argv[index + 1] || process.argv.length !== 4) {
    fail("usage: p8d4f-verify-inbox-importer.mjs --evidence-root <exact-build-evidence-directory>");
  }
  verifyP8D4FInboxImporter(process.argv[index + 1]);
  process.stdout.write("p8d4f_inbox_importer_verified\n");
}
