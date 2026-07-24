import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const PRODUCTION_ROOTS = ["/opt/evo-crm", "/opt/evo-inbox", "/var/lib/docker"];

function fail(message) {
  throw new Error(message);
}

export function assertSafeDestination(input) {
  if (!input || !isAbsolute(input)) fail("backup destination must be an absolute path");
  const destination = resolve(input);
  if (destination === "/" || destination === "/tmp" || destination === "/var/tmp") {
    fail("backup destination is too broad");
  }
  if (PRODUCTION_ROOTS.some((root) => destination === root || destination.startsWith(`${root}/`))) {
    fail("backup destination must not be inside a production path");
  }
  if (["/tmp", "/var/tmp"].includes(dirname(destination))) {
    fail("backup destination requires a dedicated private directory");
  }
  return destination;
}

function ensurePrivateDirectory(path) {
  if (existsSync(path)) {
    const stat = statSync(path);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid()) {
      fail("existing backup directory must be owned by the current user with mode 0700");
    }
    return;
  }
  const parent = dirname(path);
  if (!existsSync(parent)) fail("backup directory parent must already exist");
  const parentStat = statSync(parent);
  if (!parentStat.isDirectory() || (parentStat.mode & 0o777) !== 0o700 || parentStat.uid !== process.getuid()) {
    fail("backup directory parent must be private and owned by the current user");
  }
  mkdirSync(path, { mode: 0o700 });
}

function sha256(path) {
  const hash = createHash("sha256");
  const contents = readFileSync(path);
  hash.update(contents);
  return hash.digest("hex");
}

function inspectDatabase(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check").map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== "ok") {
      fail("SQLite integrity_check failed");
    }
    const foreignKeys = db.pragma("foreign_key_check");
    if (foreignKeys.length !== 0) fail("SQLite foreign_key_check failed");
    const schemaVersion = db.pragma("schema_version", { simple: true });
    const userVersion = db.pragma("user_version", { simple: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => name);
    if (tables.length === 0) fail("restored SQLite database contains no application tables");
    return { schemaVersion, userVersion, tableCount: tables.length };
  } finally {
    db.close();
  }
}

export async function createVerifiedBackup({ source, destination, store }) {
  if (!source || !isAbsolute(source)) fail("SQLite source must be an absolute path");
  if (!existsSync(source) || !statSync(source).isFile()) fail("SQLite source does not exist");
  const output = assertSafeDestination(destination);
  ensurePrivateDirectory(dirname(output));
  openSync(output, "a", 0o600);

  const started = process.hrtime.bigint();
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await sourceDb.backup(output);
  } finally {
    sourceDb.close();
  }
  chmodSync(output, 0o600);
  const verification = inspectDatabase(output);
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const manifest = {
    formatVersion: 1,
    kind: "evo-sqlite-online-backup",
    store,
    createdAt: new Date().toISOString(),
    artifact: basename(output),
    bytes: statSync(output).size,
    sha256: sha256(output),
    verification: { ...verification, integrityCheck: "ok", foreignKeyCheck: "ok" },
    durationMs: Math.round(durationMs),
  };
  const manifestPath = `${output}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  return { output, manifestPath, manifest };
}

export function verifyBackup({ artifact, manifestPath }) {
  const output = assertSafeDestination(artifact);
  if (!manifestPath || !existsSync(manifestPath)) fail("backup manifest is required");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const field of ["formatVersion", "kind", "store", "artifact", "bytes", "sha256", "verification"]) {
    if (manifest[field] === undefined) fail(`backup manifest is missing ${field}`);
  }
  if (manifest.artifact !== basename(output)) fail("manifest artifact does not match backup");
  if (manifest.bytes !== statSync(output).size) fail("backup size does not match manifest");
  if (manifest.sha256 !== sha256(output)) fail("backup checksum does not match manifest");
  const verification = inspectDatabase(output);
  return { manifest, verification };
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((value) => {
      const separator = value.indexOf("=");
      if (separator < 1) fail(`invalid argument: ${value}`);
      return [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
  const command = args.command || "backup";
  if (command === "backup") {
    const result = await createVerifiedBackup({
      source: args.source || process.env.EVO_DB_PATH || join(process.cwd(), "data", "edu-admin.db"),
      destination: args.destination,
      store: args.store || "main-crm",
    });
    console.log(JSON.stringify({ status: "verified", ...result.manifest }));
    return;
  }
  if (command === "verify") {
    const result = verifyBackup({ artifact: args.artifact, manifestPath: args.manifest });
    console.log(
      JSON.stringify({
        status: "verified",
        store: result.manifest.store,
        ...result.verification,
      }),
    );
    return;
  }
  fail(`unsupported command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(`backup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
