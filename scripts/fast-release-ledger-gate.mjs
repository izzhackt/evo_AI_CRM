#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSelfHostedLedgerRows } from "./lib/selfhosted-database.mjs";

const PROJECT_REF = /^[a-z0-9]{20}$/u;

export function expectedMigrationVersions(directory) {
  const versions = readdirSync(directory)
    .filter((name) => /^\d{3}_.+\.sql$/u.test(name))
    .map((name) => name.slice(0, 3))
    .sort();
  if (versions.length === 0 || new Set(versions).size !== versions.length) {
    throw new Error("migration source ledger is invalid");
  }
  versions.forEach((version, index) => {
    if (version !== String(index + 1).padStart(3, "0")) {
      throw new Error("migration source ledger is not contiguous");
    }
  });
  return versions;
}

export function normalizeRemoteMigrationVersions(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("production migration ledger is invalid");
  }
  const versions = payload.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("production migration ledger is invalid");
    }
    const keys = Object.keys(row);
    if (!keys.includes("version") || keys.some((key) => key !== "version" && key !== "name")) {
      throw new Error("production migration ledger is invalid");
    }
    if (typeof row.version !== "string" || !/^\d{3}$/u.test(row.version)) {
      throw new Error("production migration ledger is invalid");
    }
    if (row.name !== undefined && typeof row.name !== "string") {
      throw new Error("production migration ledger is invalid");
    }
    return row.version;
  });
  versions.forEach((version, index) => {
    if (version !== String(index + 1).padStart(3, "0")) {
      throw new Error("production migration ledger is invalid");
    }
  });
  return versions;
}

function compareLedger(expected, actual) {
  if (actual.join("\0") !== expected.join("\0")) {
    throw new Error("production migration ledger does not match the release tree");
  }
  return {
    ok: true,
    count: actual.length,
    range: `${actual[0]}-${actual.at(-1)}`,
  };
}

export async function verifyProductionMigrationLedger({
  projectRef,
  accessToken,
  migrationDirectory,
  fetchImpl = fetch,
}) {
  if (!PROJECT_REF.test(projectRef) || typeof accessToken !== "string" || accessToken.length < 1) {
    throw new Error("invalid migration gate configuration");
  }
  const expected = expectedMigrationVersions(migrationDirectory);
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("production migration ledger lookup failed");
  const actual = normalizeRemoteMigrationVersions(await response.json());
  return compareLedger(expected, actual);
}

// Режим selfhosted (docs/runbooks/selfhosted-cutover.md): леджер читается из базы
// self-hosted Supabase по SSH, без Management API. Сравнение то же самое.
export async function verifySelfHostedMigrationLedger({
  migrationDirectory,
  readRemoteRows = readSelfHostedLedgerRows,
}) {
  const expected = expectedMigrationVersions(migrationDirectory);
  const actual = normalizeRemoteMigrationVersions(await readRemoteRows());
  return compareLedger(expected, actual);
}

// Не задана или пуста = cloud (как раньше). Любое иное значение, кроме двух, — отказ.
export function resolveSupabaseTarget(value) {
  const target = value === undefined || value === "" ? "cloud" : value;
  if (target !== "cloud" && target !== "selfhosted") {
    throw new Error("invalid migration gate configuration");
  }
  return target;
}

async function main() {
  const migrationDirectory = resolve(process.env.EVO_RELEASE_REPO ?? ".", "supabase/migrations");
  const target = resolveSupabaseTarget(process.env.EVO_SUPABASE_TARGET);
  const result = target === "selfhosted"
    ? await verifySelfHostedMigrationLedger({ migrationDirectory })
    : await verifyProductionMigrationLedger({
      projectRef: process.env.EVO_SUPABASE_PROJECT_REF ?? "",
      accessToken: process.env.SUPABASE_ACCESS_TOKEN ?? "",
      migrationDirectory,
    });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("production migration ledger gate failed\n");
    process.exitCode = 2;
  });
}
