import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRepositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedSource = Object.freeze({
  commit: "1b2ee797a01bbf60d4bc75cabae72c0c6dc0c9d5",
  path: "agent-lead2-inbox/supabase/migrations",
  range: "001-039",
});
const immutableMigrationCount = 39;
const requiredP2BMigration =
  "040_platform_namespaces_and_secret_containment.sql";
const testRoot = process.env.EVO_SUPABASE_HISTORY_TEST_ROOT;
const isTestFixture = Boolean(testRoot) && process.env.NODE_ENV === "test";
const repositoryRoot = isTestFixture
  ? path.resolve(testRoot)
  : scriptRepositoryRoot;
const manifestPath = path.join(
  repositoryRoot,
  "supabase",
  "migration-history.json",
);
const migrationsDirectory = path.join(
  repositoryRoot,
  "supabase",
  "migrations",
);
const legacySupabaseDirectory = path.join(
  repositoryRoot,
  "agent-lead2-inbox",
  "supabase",
);

function fail(message) {
  throw new Error(message);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    fail(
      `${label} must contain exactly: ${sortedExpectedKeys.join(", ")}`,
    );
  }
}

async function loadManifest() {
  let source;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    fail(`cannot read ${path.relative(repositoryRoot, manifestPath)}: ${error.message}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    fail(`invalid migration history manifest JSON: ${error.message}`);
  }

  assertExactKeys(manifest, ["algorithm", "files", "source"], "manifest");
  if (manifest.algorithm !== "sha256") {
    fail('manifest algorithm must be "sha256"');
  }

  assertExactKeys(manifest.source, ["commit", "path", "range"], "manifest source");
  for (const [key, expected] of Object.entries(expectedSource)) {
    if (manifest.source[key] !== expected) {
      fail(`manifest source ${key} must be ${expected}`);
    }
  }

  if (!Array.isArray(manifest.files)) {
    fail("manifest files must be an array");
  }
  if (manifest.files.length !== immutableMigrationCount) {
    fail(
      `manifest must contain exactly ${immutableMigrationCount} immutable migrations; found ${manifest.files.length}`,
    );
  }

  return manifest;
}

async function listCanonicalMigrations() {
  let entries;
  try {
    entries = await readdir(migrationsDirectory, { withFileTypes: true });
  } catch (error) {
    fail(
      `cannot read canonical supabase/migrations directory: ${error.message}`,
    );
  }

  const invalidSqlEntries = entries.filter(
    (entry) => entry.name.endsWith(".sql") && !entry.isFile(),
  );
  if (invalidSqlEntries.length > 0) {
    fail(
      `canonical migration entries must be regular files: ${invalidSqlEntries
        .map((entry) => entry.name)
        .sort()
        .join(", ")}`,
    );
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

function validateManifestEntries(files) {
  const names = files.map((file, index) => {
    assertExactKeys(file, ["bytes", "name", "sha256"], `manifest file ${index + 1}`);
    if (
      typeof file.name !== "string" ||
      path.basename(file.name) !== file.name ||
      file.name.includes("\\")
    ) {
      fail(`manifest file ${index + 1} has an invalid name`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      fail(`manifest file ${file.name} has an invalid SHA-256`);
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      fail(`manifest file ${file.name} has an invalid byte count`);
    }
    return file.name;
  });

  const sortedNames = [...names].sort();
  if (JSON.stringify(names) !== JSON.stringify(sortedNames)) {
    fail("manifest files must be sorted by name");
  }
  if (new Set(names).size !== names.length) {
    fail("manifest files must not contain duplicate names");
  }

  names.forEach((name, index) => {
    const match = /^(\d{3})_.+\.sql$/.exec(name);
    if (!match) {
      fail(`migration name must start with a three-digit number: ${name}`);
    }
    const expectedNumber = index + 1;
    const actualNumber = Number.parseInt(match[1], 10);
    if (actualNumber !== expectedNumber) {
      fail(
        `migration sequence must be contiguous 001-039; expected ${String(
          expectedNumber,
        ).padStart(3, "0")}, found ${match[1]}`,
      );
    }
  });

  return names;
}

function validateCanonicalSequence(names) {
  if (names.length < immutableMigrationCount + 1) {
    fail(`canonical migration history must include required ${requiredP2BMigration}`);
  }

  names.forEach((name, index) => {
    const match = /^(\d{3})_.+\.sql$/.exec(name);
    if (!match) {
      fail(`migration name must start with a three-digit number: ${name}`);
    }

    const expectedNumber = index + 1;
    const actualNumber = Number.parseInt(match[1], 10);
    if (actualNumber !== expectedNumber) {
      fail(
        `canonical migration sequence must be contiguous; expected ${String(
          expectedNumber,
        ).padStart(3, "0")}, found ${match[1]}`,
      );
    }
  });

  if (names[immutableMigrationCount] !== requiredP2BMigration) {
    fail(`required migration 040 must be ${requiredP2BMigration}`);
  }
}

function assertSameNames(actualNames, expectedNames) {
  if (JSON.stringify(actualNames) === JSON.stringify(expectedNames)) {
    return;
  }

  const actualSet = new Set(actualNames);
  const expectedSet = new Set(expectedNames);
  const missing = expectedNames.filter((name) => !actualSet.has(name));
  const unexpected = actualNames.filter((name) => !expectedSet.has(name));
  const details = [
    missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
    unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  fail(`canonical migration set differs from manifest${details ? ` (${details})` : ""}`);
}

async function listRelativeFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    fail(
      `cannot read legacy companion Supabase pointer directory: ${error.message}`,
    );
  }

  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await listRelativeFiles(path.join(directory, entry.name), relativePath)),
      );
      continue;
    }
    files.push(entry.isFile() ? relativePath : `${relativePath} [not a regular file]`);
  }
  return files;
}

async function assertLegacyPathIsPointerOnly() {
  const files = await listRelativeFiles(legacySupabaseDirectory);
  if (files.length !== 1 || files[0] !== "README.md") {
    fail(
      "agent-lead2-inbox/supabase must contain only the README.md pointer",
    );
  }
}

async function verifyFile(file) {
  const canonicalPath = path.join(migrationsDirectory, file.name);
  const bytes = await readFile(canonicalPath);
  if (bytes.byteLength !== file.bytes) {
    fail(
      `${file.name} byte count changed: expected ${file.bytes}, found ${bytes.byteLength}`,
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== file.sha256) {
    fail(`${file.name} SHA-256 changed: expected ${file.sha256}, found ${sha256}`);
  }
}

async function main() {
  if (testRoot && !isTestFixture) {
    fail("EVO_SUPABASE_HISTORY_TEST_ROOT is available only when NODE_ENV=test");
  }

  const manifest = await loadManifest();
  const expectedNames = validateManifestEntries(manifest.files);
  const actualNames = await listCanonicalMigrations();

  validateCanonicalSequence(actualNames);
  assertSameNames(
    actualNames.slice(0, immutableMigrationCount),
    expectedNames,
  );
  await assertLegacyPathIsPointerOnly();
  for (const file of manifest.files) {
    await verifyFile(file);
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      checked: immutableMigrationCount,
      range: expectedSource.range,
      current: actualNames[actualNames.length - 1].slice(0, 3),
      total: actualNames.length,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `Supabase migration history verification failed: ${error.message}\n`,
  );
  process.exitCode = 1;
});
