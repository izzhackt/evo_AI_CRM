import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DocumentImportSnapshotError, readDocumentImportSnapshot } from "../src/lib/document-import-snapshot.ts";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = value => createHash("sha256").update(value).digest("hex");
const sha = "a".repeat(64);
const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
// Synthetic source schema and rows, independent of the reader's projections.
const schema = `
CREATE TABLE students(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY,student_id TEXT,kind TEXT,original_name TEXT,storage_name TEXT,mime_type TEXT,size_bytes INTEGER,sha256 TEXT,current_version_id TEXT,status TEXT,progress INTEGER,error_code TEXT,error_message TEXT,created_at TEXT,updated_at TEXT,extraction_warnings TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT,student_id TEXT,kind TEXT,original_name TEXT,storage_name TEXT,mime_type TEXT,size_bytes INTEGER,sha256 TEXT,status TEXT,progress INTEGER,error_code TEXT,error_message TEXT,created_at TEXT,updated_at TEXT,replaced_at TEXT,extraction_warnings TEXT);
CREATE TABLE field_values(student_id TEXT,key TEXT,value TEXT,confidence REAL,source_document_id TEXT,source_version_id TEXT,source_page INTEGER,source_snippet TEXT,state TEXT,updated_at TEXT,PRIMARY KEY(student_id,key));
CREATE TABLE field_candidates(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id TEXT,key TEXT,value TEXT,confidence REAL,source_document_id TEXT,source_version_id TEXT,source_page INTEGER,source_snippet TEXT,created_at TEXT);
CREATE TABLE event_log(id INTEGER PRIMARY KEY AUTOINCREMENT,student_id TEXT,type TEXT,message TEXT,created_at TEXT);
CREATE TABLE package_settings(student_id TEXT PRIMARY KEY,settings TEXT,generation INTEGER,updated_at TEXT);
CREATE TABLE package_parts(id TEXT PRIMARY KEY,student_id TEXT,kind TEXT,role TEXT,original_name TEXT,storage_name TEXT,mime_type TEXT,size_bytes INTEGER,sha256 TEXT,options TEXT,created_at TEXT);
CREATE TABLE package_reviews(student_id TEXT,file_id TEXT,version_id TEXT,sha256 TEXT,constraints_hash TEXT,verified_pages INTEGER,reviewed_at TEXT,PRIMARY KEY(student_id,file_id));
CREATE TABLE package_exports(id TEXT PRIMARY KEY,student_id TEXT,title TEXT,mode TEXT,filename TEXT,storage_name TEXT,size_bytes INTEGER,sha256 TEXT,file_count INTEGER,revision TEXT,manifest TEXT,created_at TEXT);
CREATE TABLE university_forms(id TEXT PRIMARY KEY,metadata TEXT,original_name TEXT,sha256 TEXT,file_format TEXT,inspection TEXT,mappings TEXT,mapping_confirmed INTEGER,generation INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE university_form_exports(id TEXT PRIMARY KEY,student_id TEXT,form_id TEXT,metadata TEXT,sha256 TEXT,snapshot TEXT,created_at TEXT);
`;
function fixture(t, change = () => {}) {
  const dir = mkdtempSync(join(root, ".d5-snapshot-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "source.sqlite"), db = new DatabaseSync(path);
  db.exec(schema);
  const insert = (table, values) => db.prepare(`INSERT INTO ${table}(${Object.keys(values).join(",")}) VALUES(${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  insert("students", { id: id(1), first_name: "PRIVATE_CANARY", last_name: "PRIVATE_CANARY" });
  insert("documents", { id: id(2), student_id: id(1), current_version_id: id(3), mime_type: "application/pdf", size_bytes: 123, sha256: sha, original_name: "PRIVATE_CANARY", storage_name: "PRIVATE_CANARY" });
  insert("document_versions", { id: id(3), document_id: id(2), student_id: id(1), mime_type: "application/pdf", size_bytes: 123, sha256: sha });
  insert("field_values", { student_id: id(1), key: "passport_number", value: "PRIVATE_CANARY", source_document_id: id(2), source_version_id: id(3), state: "confirmed" });
  insert("field_candidates", { student_id: id(1), key: "passport_number", value: "PRIVATE_CANARY", source_document_id: id(2), source_version_id: id(3) });
  insert("event_log", { student_id: id(1), message: "PRIVATE_CANARY" });
  insert("package_settings", { student_id: id(1), settings: "PRIVATE_CANARY", generation: 1 });
  insert("package_parts", { id: id(4), student_id: id(1), mime_type: "application/pdf", size_bytes: 123, sha256: sha, options: "PRIVATE_CANARY" });
  insert("package_reviews", { student_id: id(1), file_id: id(4), version_id: id(4), sha256: sha, constraints_hash: sha });
  insert("package_exports", { id: id(5), student_id: id(1), size_bytes: 123, sha256: sha, manifest: "PRIVATE_CANARY" });
  insert("university_forms", { id: id(6), sha256: sha, file_format: "pdf", mapping_confirmed: 1, generation: 1, metadata: "PRIVATE_CANARY", mappings: "PRIVATE_CANARY" });
  insert("university_form_exports", { id: id(7), student_id: id(1), form_id: id(6), sha256: sha, snapshot: "PRIVATE_CANARY" });
  try { change(db); } finally { db.close(); }
  const snapshotSha256 = hash(readFileSync(path));
  const context = { schema: "evo-docs-snapshot-context/v1", sourceInstanceId: id(100), snapshotSha256,
    caseMappings: [{ sourceStudentId: id(1), organizationId: id(10), studentCaseId: id(11),
      approval: { decisionId: id(12), reviewerMembershipId: id(13), snapshotSha256 } }],
    targetCases: [{ organizationId: id(10), studentCaseId: id(11) }], ledger: [],
    universityFiles: ["university_forms", "university_form_exports"].map((domain, index) => ({
      domain, sourcePk: id(6 + index), file: { sha256: sha, byteSize: 123, mimeType: "application/pdf" },
    })),
  };
  return { dir, path, context, read: () => readDocumentImportSnapshot(path, JSON.stringify(context)) };
}

test("reads all twelve synthetic source domains into the real planner without changing the snapshot", t => {
  const f = fixture(t), before = readFileSync(f.path), modified = statSync(f.path).mtimeMs;
  const result = f.read();
  assert.equal(Object.keys(result.domainCounts).length, 12);
  assert.ok(Object.values(result.domainCounts).every(count => count === 1));
  assert.equal(result.plan.rows.length, 12);
  assert.equal(result.status, "blocked"); // History/persistence are still not import-ready.
  assert.equal(result.executionAllowed, false);
  assert.equal(result.sourceBytesVerified, false);
  assert.equal(result.liveAuthorityVerified, false);
  assert.equal(result.d5Complete, false);
  assert.equal(result.manifest.domains.package_parts[0].references.length, 0);
  assert.equal(result.manifest.domains.package_exports[0].references.length, 0);
  assert.equal(result.manifest.domains.field_values[0].legacyAssertion, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CANARY|source\.sqlite/u);
  assert.deepEqual(readFileSync(f.path), before);
  assert.equal(statSync(f.path).mtimeMs, modified);
  assert.deepEqual(readdirSync(f.dir), ["source.sqlite"]);
});

function errorCode(run, expected) {
  assert.throws(run, error => error instanceof DocumentImportSnapshotError
    && error.code === expected && error.message === expected && !Object.hasOwn(error, "cause"));
}
function coreFixture(t) {
  const f = fixture(t, db => {
    for (const table of ["field_candidates", "event_log", "package_settings", "package_parts", "package_reviews", "package_exports", "university_forms", "university_form_exports"]) db.exec(`DELETE FROM ${table}`);
    db.exec("UPDATE field_values SET state='extracted'");
  });
  f.context.universityFiles = [];
  return f;
}
test("valid core snapshot reaches metadata-consistent planning and exact ledger replay, never execution", t => {
  const f = coreFixture(t), first = f.read();
  assert.equal(first.status, "planned");
  assert.equal(first.plan.metadataConsistent, true);
  f.context.ledger = first.plan.rows.map((row, i) => ({ sourceInstanceId: f.context.sourceInstanceId,
    domain: row.domain, sourcePk: row.sourcePk, recordSha256: row.recordSha256,
    organizationId: row.organizationId, studentCaseId: row.studentCaseId, targetId: id(200 + i) }));
  assert.ok(f.read().plan.rows.every(row => row.disposition === "already_recorded"));
  assert.deepEqual(readdirSync(f.dir), ["source.sqlite"]);
});

test("missing university sizes block a complete manifest while preserving all twelve counts", t => {
  const f = fixture(t); f.context.universityFiles = [];
  const result = f.read();
  assert.equal(result.status, "blocked");
  assert.equal(result.manifest, null); assert.equal(result.plan, null);
  assert.deepEqual(result.issues.map(i => i.code), ["file_size_descriptor_missing", "file_size_descriptor_missing"]);
  assert.equal(result.domainCounts.university_forms, 1); assert.equal(result.domainCounts.university_form_exports, 1);
});
for (const [name, change, code] of [
  ["duplicate", f => f.context.universityFiles.push(f.context.universityFiles[0]), "duplicate_file_descriptor"],
  ["foreign source", f => f.context.universityFiles.push({ ...f.context.universityFiles[0], sourcePk: id(900) }), "file_descriptor_source_absent"],
  ["changed source hash", f => { f.context.universityFiles[0].file.sha256 = "b".repeat(64); }, "file_descriptor_conflict"],
  ["wrong template MIME", f => { f.context.universityFiles[0].file.mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; }, "file_descriptor_conflict"],
]) test(`${name} university descriptor blocks without a partial manifest`, t => {
  const f = fixture(t); change(f); const result = f.read();
  assert.equal(result.status, "blocked"); assert.equal(result.manifest, null);
  assert.ok(result.issues.some(i => i.code === code));
});
test("historical export MIME comes from its descriptor, never the current template format", t => {
  const f = fixture(t); f.context.universityFiles[1].file.mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const result = f.read();
  assert.equal(result.manifest.domains.university_forms[0].file.mimeType, "application/pdf");
  assert.equal(result.manifest.domains.university_form_exports[0].file.mimeType, f.context.universityFiles[1].file.mimeType);
});
for (const [name, pathFor, code] of [
  ["relative", () => "source.sqlite", "invalid_snapshot_path"],
  ["file URI", f => `file://${f.path}`, "invalid_snapshot_path"],
  ["dot traversal", f => `${f.dir}/../${f.dir.split("/").at(-1)}/source.sqlite`, "invalid_snapshot_path"],
  ["directory", f => f.dir, "invalid_snapshot_path"],
  ["missing", f => join(f.dir, "missing.sqlite"), "snapshot_unavailable"],
  ["NUL", f => `${f.path}\0`, "invalid_snapshot_path"],
  ["symlink file", f => { const p = join(f.dir, "link.sqlite"); symlinkSync(f.path, p); return p; }, "invalid_snapshot_path"],
  ["symlink ancestor", f => { const p = join(f.dir, "link"); symlinkSync(f.dir, p); return `${p}/source.sqlite`; }, "invalid_snapshot_path"],
  ["hardlink", f => { const p = join(f.dir, "hard.sqlite"); linkSync(f.path, p); return p; }, "invalid_snapshot_path"],
  ["writable shared parent", f => { chmodSync(f.dir, 0o777); return f.path; }, "invalid_snapshot_path"],
]) test(`rejects ${name} snapshot paths without source changes`, t => {
  const f = fixture(t), before = readFileSync(f.path);
  const path = pathFor(f);
  errorCode(() => readDocumentImportSnapshot(path, JSON.stringify(f.context)), code);
  assert.deepEqual(readFileSync(f.path), before);
});
for (const suffix of ["-wal", "-shm", "-journal"]) test(`rejects existing ${suffix} without deleting or repairing it`, t => {
  const f = fixture(t), sidecar = f.path + suffix; writeFileSync(sidecar, "SYNTHETIC_SIDECAR");
  errorCode(f.read, "snapshot_not_standalone");
  assert.equal(readFileSync(sidecar, "utf8"), "SYNTHETIC_SIDECAR");
});
test("rejects a completed WAL-format SQLite database even when close removed sidecars", t => {
  const f = fixture(t, db => db.exec("PRAGMA journal_mode=WAL"));
  assert.deepEqual(readdirSync(f.dir), ["source.sqlite"]);
  errorCode(f.read, "snapshot_not_standalone");
  assert.deepEqual(readdirSync(f.dir), ["source.sqlite"]);
});
test("snapshot hash mismatch fails before reading metadata", t => {
  const f = fixture(t); f.context.snapshotSha256 = "b".repeat(64);
  errorCode(f.read, "snapshot_hash_mismatch");
});
test("rejects non-SQLite bytes and a snapshot beyond the byte bound", t => {
  const f = fixture(t); writeFileSync(f.path, Buffer.alloc(100));
  errorCode(f.read, "snapshot_not_standalone");
  truncateSync(f.path, 64 * 1024 * 1024 + 1);
  errorCode(f.read, "snapshot_too_large");
});
for (const [name, sql] of [
  ["missing table", "DROP TABLE event_log"],
  ["additional table", "CREATE TABLE unsupported(id TEXT)"],
  ["renamed required column", "ALTER TABLE documents RENAME COLUMN sha256 TO checksum"],
  ["unknown column", "ALTER TABLE students ADD COLUMN unknown TEXT"],
  ["view", "CREATE VIEW projected AS SELECT id FROM students"],
  ["trigger", "CREATE TRIGGER unsupported AFTER INSERT ON students BEGIN SELECT 1; END"],
  ["virtual table", "CREATE VIRTUAL TABLE unsupported USING fts5(value)"],
  ["generated known column", "ALTER TABLE event_log DROP COLUMN type; ALTER TABLE event_log ADD COLUMN type TEXT GENERATED ALWAYS AS ('event') VIRTUAL"],
]) test(`rejects unsupported schema: ${name}`, t => {
  const f = fixture(t, db => db.exec(sql)), before = readFileSync(f.path);
  errorCode(f.read, "unsupported_source_schema");
  assert.deepEqual(readFileSync(f.path), before);
  assert.deepEqual(readdirSync(f.dir), ["source.sqlite"]);
});
test("total row overflow is rejected, never LIMIT-truncated into a valid manifest", t => {
  const f = fixture(t, db => db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO event_log(student_id) SELECT '${id(1)}' FROM n`));
  errorCode(f.read, "source_row_limit");
});
for (const [name, sql, code] of [
  ["malformed UUID", "UPDATE event_log SET student_id='PRIVATE_CANARY'", "invalid_source_metadata"],
  ["long scalar", `UPDATE event_log SET student_id='${"x".repeat(257)}'`, "invalid_source_metadata"],
  ["BLOB identity", "UPDATE event_log SET student_id=x'0102'", "invalid_source_metadata"],
  ["unknown field key", "UPDATE field_candidates SET key='PRIVATE_CANARY'", "invalid_source_metadata"],
  ["invalid assertion", "UPDATE university_forms SET mapping_confirmed=2", "invalid_source_metadata"],
  ["unsupported MIME", "UPDATE documents SET mime_type='application/msword'", "unsupported_source_mime"],
  ["invalid size", "UPDATE package_parts SET size_bytes=0", "invalid_source_metadata"],
  ["invalid hash", "UPDATE package_reviews SET sha256='PRIVATE_CANARY'", "invalid_source_metadata"],
]) test(`invalid source metadata: ${name} returns only a fixed error`, t => {
  const f = fixture(t, db => db.exec(sql)); errorCode(f.read, code);
});
test("known unsupported student MIME remains visible as a planner issue", t => {
  const f = fixture(t, db => db.exec("UPDATE documents SET mime_type='video/mp4'; UPDATE document_versions SET mime_type='video/mp4'"));
  const result = f.read();
  assert.equal(result.manifest.domains.documents[0].file.mimeType, "video/mp4");
  assert.ok(result.issues.some(i => i.code === "unsupported_file_type"));
});
for (const [name, sql, expected] of [
  ["unknown student", `UPDATE event_log SET student_id='${id(999)}'`, "source_student_absent"],
  ["foreign document version", `UPDATE document_versions SET student_id='${id(999)}'`, "reference_cross_student"],
  ["missing source document", `UPDATE document_versions SET document_id='${id(999)}'`, "reference_absent"],
]) test(`${name} is blocked by the existing planner without dropping the row`, t => {
  const f = fixture(t, db => db.exec(sql)), result = f.read();
  assert.equal(result.status, "blocked"); assert.equal(result.plan.rows.length, 12);
  assert.ok(result.issues.some(i => i.code === expected), JSON.stringify(result.issues.map(i => i.code)));
});
test("unresolved review file IDs block rather than inventing a target domain", t => {
  const f = fixture(t, db => db.exec(`UPDATE package_reviews SET file_id='${id(999)}'`)), result = f.read();
  assert.equal(result.manifest, null);
  assert.ok(result.issues.some(i => i.code === "review_file_reference_unresolved"));
});
test("missing mapping never creates implicit canonical case identity", t => {
  const f = coreFixture(t); f.context.caseMappings = [];
  assert.ok(f.read().issues.some(i => i.code === "case_mapping_absent"));
});
for (const [name, mutate, expected] of [
  ["unapproved mapping", c => { c.caseMappings[0].approval = null; }, "case_mapping_unapproved"],
  ["foreign case descriptor", c => { c.targetCases[0].studentCaseId = id(999); }, "target_case_absent_or_ambiguous"],
  ["foreign organization descriptor", c => { c.targetCases[0].organizationId = id(999); }, "target_case_absent_or_ambiguous"],
]) test(`${name} is rejected by the composed planner`, t => {
  const f = coreFixture(t); mutate(f.context);
  const result = f.read(); assert.equal(result.status, "blocked");
  assert.ok(result.issues.some(i => i.code === expected));
  assert.ok(result.plan.rows.every(row => row.organizationId === null && row.studentCaseId === null));
});
test("same-byte distinct historical versions are retained as distinct source identities", t => {
  const f = fixture(t, db => db.prepare("INSERT INTO document_versions(id,document_id,student_id,mime_type,size_bytes,sha256) VALUES(?,?,?,?,?,?)")
    .run(id(8), id(2), id(1), "application/pdf", 123, sha));
  const rows = f.read().manifest.domains.document_versions;
  assert.deepEqual(rows.map(r => r.sourcePk), [id(3), id(8)]);
  assert.equal(rows[0].file.sha256, rows[1].file.sha256);
});
test("omitted private payload changes alter snapshot SHA but not claim projected row-level reconciliation", t => {
  const f = fixture(t), first = f.read(), db = new DatabaseSync(f.path);
  db.exec("UPDATE field_values SET value='CHANGED_PRIVATE_CANARY'; UPDATE event_log SET message='CHANGED_PRIVATE_CANARY'"); db.close();
  const nextHash = hash(readFileSync(f.path)); assert.notEqual(nextHash, f.context.snapshotSha256);
  f.context.snapshotSha256 = nextHash; f.context.caseMappings[0].approval.snapshotSha256 = nextHash;
  const second = f.read();
  assert.equal(second.metadataScope, "allowlisted_columns_only");
  assert.equal(first.manifest.domains.field_values[0].metadataSha256, second.manifest.domains.field_values[0].metadataSha256);
  assert.doesNotMatch(JSON.stringify(second), /PRIVATE_CANARY/u);
});
for (const [name, mutate] of [
  ["unknown key", c => { c.privateValue = "PRIVATE_CANARY"; }],
  ["unknown schema", c => { c.schema = "other"; }],
  ["invalid mapping", c => { c.caseMappings[0].sourceStudentId = "PRIVATE_CANARY"; }],
  ["invalid file size", c => { c.universityFiles[0].file.byteSize = -1; }],
  ["private descriptor key", c => { c.universityFiles[0].file.path = "PRIVATE_CANARY"; }],
  ["foreign descriptor domain", c => { c.universityFiles[0].domain = "documents"; }],
]) test(`rejects context ${name} without accessing any snapshot`, t => {
  const f = fixture(t); mutate(f.context);
  errorCode(() => readDocumentImportSnapshot("/missing.sqlite", JSON.stringify(f.context)), "invalid_context");
});
test("invalid or oversized context is rejected without filesystem access", () => {
  for (const json of ["{", "null", "[]", "x".repeat(8 * 1024 * 1024 + 1)]) errorCode(() => readDocumentImportSnapshot("/missing.sqlite", json), "invalid_context");
});
