#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.env.EVO_DRIZZLE_HISTORY_ROOT
  ? path.resolve(process.env.EVO_DRIZZLE_HISTORY_ROOT)
  : path.join(process.cwd(), "drizzle");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(root)) {
  fail(`Drizzle migration root is missing: ${root}`);
}

const migrationFiles = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();
if (migrationFiles.length === 0) {
  fail(`Drizzle migration root has no SQL migrations: ${root}`);
}

const metaRoot = path.join(root, "meta");
const journalFile = path.join(metaRoot, "_journal.json");
if (!existsSync(journalFile)) {
  fail(`Drizzle journal file is missing: ${journalFile}`);
}

const journal = JSON.parse(readFileSync(journalFile, "utf8"));
if (journal?.dialect !== "postgresql" || !Array.isArray(journal?.entries)) {
  fail(`Drizzle journal has an unexpected shape: ${journalFile}`);
}

for (const fileName of migrationFiles) {
  const sqlFile = path.join(root, fileName);
  const tag = fileName.slice(0, -4);
  const prefix = tag.match(/^[0-9]+/)?.[0];
  if (!prefix) {
    fail(`Migration file name must start with a numeric prefix: ${fileName}`);
  }
  const snapshotFile = path.join(metaRoot, `${prefix}_snapshot.json`);

  if (!existsSync(snapshotFile)) {
    fail(`Migration snapshot is missing: ${snapshotFile}`);
  }
  if (!statSync(sqlFile).isFile() || !statSync(snapshotFile).isFile()) {
    fail(`Migration artifacts must be regular files: ${fileName}`);
  }
  if (!journal.entries.some((entry) => entry?.tag === tag)) {
    fail(`Drizzle journal is missing migration tag: ${tag}`);
  }
}

console.log(`Drizzle migration history is structurally valid: ${root}`);
