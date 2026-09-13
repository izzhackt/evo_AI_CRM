import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import type { Stats } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { DOCUMENT_IMPORT_DOMAINS, parseDocumentImportManifest, planDocumentImportReconciliation } from "./document-import-manifest.ts";
import type { DocumentImportDomain, DocumentImportManifest, ImportMetadataRow, ImportReference } from "./document-import-manifest.ts";
import { isProfileFieldKey } from "./student-profile-fields.ts";

const MAX_BYTES = 64 * 1024 * 1024, MAX_ROWS = 10_000, MAX_CONTEXT = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png", DOCX, "video/mp4", "video/quicktime", "application/zip", "application/octet-stream"]);
// Complete source column names, not private column values. No source runtime import.
const COLUMNS: Record<DocumentImportDomain, string> = {
  students: "id first_name last_name created_at updated_at",
  documents: "id student_id kind original_name storage_name mime_type size_bytes sha256 current_version_id status progress error_code error_message created_at updated_at extraction_warnings",
  document_versions: "id document_id student_id kind original_name storage_name mime_type size_bytes sha256 status progress error_code error_message created_at updated_at replaced_at extraction_warnings",
  field_values: "student_id key value confidence source_document_id source_version_id source_page source_snippet state updated_at",
  field_candidates: "id student_id key value confidence source_document_id source_version_id source_page source_snippet created_at",
  event_log: "id student_id type message created_at",
  package_settings: "student_id settings generation updated_at",
  package_parts: "id student_id kind role original_name storage_name mime_type size_bytes sha256 options created_at",
  package_reviews: "student_id file_id version_id sha256 constraints_hash verified_pages reviewed_at",
  package_exports: "id student_id title mode filename storage_name size_bytes sha256 file_count revision manifest created_at",
  university_forms: "id metadata original_name sha256 file_format inspection mappings mapping_confirmed generation created_at updated_at",
  university_form_exports: "id student_id form_id metadata sha256 snapshot created_at",
};
const PROJECTIONS: Record<DocumentImportDomain, string> = {
  students: "id", documents: "id,student_id,current_version_id,sha256,size_bytes,mime_type",
  document_versions: "id,student_id,document_id,sha256,size_bytes,mime_type",
  field_values: "student_id,key,source_document_id,source_version_id,state",
  field_candidates: "id,student_id,key,source_document_id,source_version_id", event_log: "id,student_id",
  package_settings: "student_id,generation", package_parts: "id,student_id,sha256,size_bytes,mime_type",
  package_reviews: "student_id,file_id,version_id,sha256,constraints_hash",
  package_exports: "id,student_id,sha256,size_bytes",
  university_forms: "id,sha256,file_format,mapping_confirmed,generation",
  university_form_exports: "id,student_id,form_id,sha256",
};
type Row = Record<string, unknown>;
// The repo's Node20 declarations predate SQLite; this is native Node22, not a fallback.
type ReadonlyDatabase = { prepare(sql: string): { all(...parameters: (string | number)[]): Row[] }; exec(sql: string): void; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string, options: { readOnly: true; allowExtension: false; timeout: 0 }) => ReadonlyDatabase;
};
type UniversityFile = { domain: "university_forms" | "university_form_exports"; sourcePk: string; file: NonNullable<ImportMetadataRow["file"]> };
type Issue = { code: string; domain: DocumentImportDomain; sourcePk: string };
type ErrorCode = "invalid_context" | "invalid_snapshot_path" | "snapshot_unavailable" | "snapshot_too_large"
  | "snapshot_not_standalone" | "snapshot_hash_mismatch" | "snapshot_changed" | "unsupported_source_schema"
  | "source_row_limit" | "invalid_source_metadata" | "unsupported_source_mime";

export class DocumentImportSnapshotError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.name = "DocumentImportSnapshotError"; this.code = code; }
}
function fail(code: ErrorCode): never { throw new DocumentImportSnapshotError(code); }
function exact(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) return fail("invalid_context");
  return value as Row;
}
function emptyDomains() { return Object.fromEntries(DOCUMENT_IMPORT_DOMAINS.map(k => [k, [] as ImportMetadataRow[]])) as Record<DocumentImportDomain, ImportMetadataRow[]>; }
function readContext(json: string) {
  try {
    if (typeof json !== "string" || Buffer.byteLength(json) > MAX_CONTEXT) return fail("invalid_context");
    const c = exact(JSON.parse(json), ["schema", "sourceInstanceId", "snapshotSha256", "caseMappings", "targetCases", "ledger", "universityFiles"]);
    if (c.schema !== "evo-docs-snapshot-context/v1" || !Array.isArray(c.universityFiles) || c.universityFiles.length > MAX_ROWS) return fail("invalid_context");
    const base = parseDocumentImportManifest(JSON.stringify({ schema: "evo-docs-import-metadata/v1", sourceInstanceId: c.sourceInstanceId,
      snapshotSha256: c.snapshotSha256, domains: emptyDomains(), caseMappings: c.caseMappings, targetCases: c.targetCases, ledger: c.ledger }));
    const files: UniversityFile[] = c.universityFiles.map(value => {
      const d = exact(value, ["domain", "sourcePk", "file"]), f = exact(d.file, ["sha256", "byteSize", "mimeType"]);
      if ((d.domain !== "university_forms" && d.domain !== "university_form_exports") || typeof d.sourcePk !== "string" || !UUID.test(d.sourcePk)
        || typeof f.sha256 !== "string" || !SHA.test(f.sha256) || !Number.isSafeInteger(f.byteSize) || (f.byteSize as number) < 1
        || (f.byteSize as number) > 1024 ** 4 || (f.mimeType !== "application/pdf" && f.mimeType !== DOCX)) return fail("invalid_context");
      return { domain: d.domain, sourcePk: d.sourcePk, file: { sha256: f.sha256, byteSize: f.byteSize as number, mimeType: f.mimeType } };
    });
    return { base, files };
  } catch { return fail("invalid_context"); }
}
function snapshotStat(path: string): Stats {
  if (typeof path !== "string" || path.length > 4096 || !isAbsolute(path) || resolve(path) !== path || path.includes("\0")) return fail("invalid_snapshot_path");
  for (let component = path; ; component = dirname(component)) {
    if (lstatSync(component).isSymbolicLink()) return fail("invalid_snapshot_path");
    if (component === dirname(component)) break;
  }
  const s = lstatSync(path);
  if (!s.isFile() || s.nlink !== 1 || (lstatSync(dirname(path)).mode & 0o022) !== 0) return fail("invalid_snapshot_path");
  if (s.size > MAX_BYTES) return fail("snapshot_too_large");
  return s;
}
function noSidecars(path: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { lstatSync(path + suffix); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return fail("snapshot_unavailable");
    }
    fail("snapshot_not_standalone");
  }
}
function sameFile(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function fileHash(fd: number, size: number) {
  const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
  for (let offset = 0; offset < size;) {
    const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (!read) return fail("snapshot_changed");
    hash.update(buffer.subarray(0, read)); offset += read;
  }
  return hash.digest("hex");
}
function readRows(db: ReadonlyDatabase): Record<DocumentImportDomain, Row[]> {
  const objects = db.prepare("SELECT type,name FROM sqlite_schema WHERE type <> 'index' LIMIT 15").all();
  const tables = objects.filter(r => r.name !== "sqlite_sequence");
  if (objects.some(r => r.type !== "table") || tables.length !== DOCUMENT_IMPORT_DOMAINS.length
    || tables.some(r => !DOCUMENT_IMPORT_DOMAINS.includes(r.name as DocumentImportDomain))) return fail("unsupported_source_schema");
  const tableInfo = db.prepare("PRAGMA table_list").all();
  if (tableInfo.some(r => r.schema === "main" && r.type !== "table")) return fail("unsupported_source_schema");
  const result = {} as Record<DocumentImportDomain, Row[]>;
  let remaining = MAX_ROWS;
  for (const domain of DOCUMENT_IMPORT_DOMAINS) {
    const columns = db.prepare("SELECT name,hidden FROM pragma_table_xinfo(?) LIMIT 40").all(domain);
    const expected = COLUMNS[domain].split(" ").sort();
    if (columns.some(c => c.hidden !== 0) || columns.length !== expected.length
      || columns.map(c => c.name).sort().some((name, i) => name !== expected[i])) return fail("unsupported_source_schema");
    // Identifiers come only from constants; no filtering/join/dedup can hide source rows.
    const rows = db.prepare(`SELECT ${PROJECTIONS[domain]} FROM "${domain}" LIMIT ?`).all(remaining + 1);
    if (rows.length > remaining) return fail("source_row_limit");
    for (const row of rows) for (const value of Object.values(row)) {
      if (value !== null && !(typeof value === "string" && value.length <= 256)
        && !(typeof value === "number" && Number.isSafeInteger(value))) return fail("invalid_source_metadata");
    }
    remaining -= rows.length; result[domain] = rows;
  }
  return result;
}
function text(row: Row, key: string) { if (typeof row[key] !== "string") return fail("invalid_source_metadata"); return row[key] as string; }
function uuid(row: Row, key: string) { const s = text(row, key); if (!UUID.test(s)) return fail("invalid_source_metadata"); return s; }
function sha(row: Row, key: string) { const s = text(row, key); if (!SHA.test(s)) return fail("invalid_source_metadata"); return s; }
function integer(row: Row, key: string) { const n = row[key]; if (!Number.isSafeInteger(n) || (n as number) < 1) return fail("invalid_source_metadata"); return n as number; }
function identity(domain: DocumentImportDomain, row: Row): string {
  if (domain === "field_values") {
    const key = text(row, "key"); if (!isProfileFieldKey(key)) return fail("invalid_source_metadata");
    return `${uuid(row, "student_id")}:${key}`;
  }
  if (domain === "package_reviews") return `${uuid(row, "student_id")}:${uuid(row, "file_id")}`;
  if (domain === "package_settings") return uuid(row, "student_id");
  return domain === "field_candidates" || domain === "event_log" ? String(integer(row, "id")) : uuid(row, "id");
}
function manifestRows(source: Record<DocumentImportDomain, Row[]>, files: UniversityFile[]) {
  const domains = emptyDomains(), issues: Issue[] = [];
  const identities = Object.fromEntries(DOCUMENT_IMPORT_DOMAINS.map(d => [d, new Set(source[d].map(r => identity(d, r)))])) as Record<DocumentImportDomain, Set<string>>;
  const descriptors = new Map<string, UniversityFile[]>();
  for (const f of files) {
    const key = `${f.domain}:${f.sourcePk}`;
    descriptors.set(key, [...(descriptors.get(key) ?? []), f]);
    if (!identities[f.domain].has(f.sourcePk)) issues.push({ code: "file_descriptor_source_absent", domain: f.domain, sourcePk: f.sourcePk });
  }
  for (const domain of DOCUMENT_IMPORT_DOMAINS) for (const raw of source[domain]) {
    const sourcePk = identity(domain, raw), sourceStudentId = domain === "university_forms" ? null : uuid(raw, domain === "students" ? "id" : "student_id");
    const references: ImportReference[] = [];
    const ref = (relation: string, target: DocumentImportDomain, column: string) => {
      if (raw[column] !== null) references.push({ relation, domain: target, sourcePk: uuid(raw, column) });
    };
    if (domain === "documents") ref("current_version", "document_versions", "current_version_id");
    if (domain === "document_versions") ref("document", "documents", "document_id");
    if (domain === "field_values" || domain === "field_candidates") {
      if (!isProfileFieldKey(text(raw, "key"))) return fail("invalid_source_metadata");
      ref("source_document", "documents", "source_document_id"); ref("source_version", "document_versions", "source_version_id");
    }
    if (domain === "university_form_exports") ref("form", "university_forms", "form_id");
    if (domain === "package_reviews") {
      sha(raw, "sha256"); sha(raw, "constraints_hash");
      const fileId = uuid(raw, "file_id"), candidates = (["documents", "package_parts"] as const).filter(d => identities[d].has(fileId));
      if (candidates.length !== 1) issues.push({ code: "review_file_reference_unresolved", domain, sourcePk });
      else { ref("file", candidates[0], "file_id"); ref("version", candidates[0] === "documents" ? "document_versions" : "package_parts", "version_id"); }
    }
    if (domain === "field_values" && !["extracted", "needs_review", "conflict", "confirmed"].includes(text(raw, "state"))) return fail("invalid_source_metadata");
    if (domain === "package_settings" || domain === "university_forms") integer(raw, "generation");
    let file: ImportMetadataRow["file"] = null;
    if (["documents", "document_versions", "package_parts", "package_exports"].includes(domain)) {
      const mimeType = domain === "package_exports" ? "application/zip" : text(raw, "mime_type");
      if (!MIMES.has(mimeType)) return fail("unsupported_source_mime");
      file = { sha256: sha(raw, "sha256"), byteSize: integer(raw, "size_bytes"), mimeType };
    }
    if (domain === "university_forms" || domain === "university_form_exports") {
      const sourceSha = sha(raw, "sha256"), candidates = descriptors.get(`${domain}:${sourcePk}`) ?? [];
      if (domain === "university_forms" && (!["pdf", "docx"].includes(text(raw, "file_format")) || ![0, 1].includes(raw.mapping_confirmed as number))) return fail("invalid_source_metadata");
      if (candidates.length !== 1) issues.push({ code: candidates.length ? "duplicate_file_descriptor" : "file_size_descriptor_missing", domain, sourcePk });
      else if (candidates[0].file.sha256 !== sourceSha || (domain === "university_forms" && candidates[0].file.mimeType !== (raw.file_format === "pdf" ? "application/pdf" : DOCX))) {
        issues.push({ code: "file_descriptor_conflict", domain, sourcePk });
      } else file = candidates[0].file;
    }
    domains[domain].push({ sourcePk, sourceStudentId, references, file,
      metadataSha256: createHash("sha256").update(JSON.stringify(["evo-docs-source-projection/v1", domain, raw])).digest("hex"),
      legacyAssertion: domain === "field_values" ? raw.state === "confirmed" : domain === "university_forms" ? raw.mapping_confirmed === 1
        : ["package_reviews", "package_exports", "university_form_exports"].includes(domain) });
  }
  return { domains, issues };
}

/** One-time readonly input adapter, never a product database or import executor. */
export function readDocumentImportSnapshot(snapshotPath: string, contextJson: string) {
  const { base, files } = readContext(contextJson);
  let fd: number | undefined, db: ReadonlyDatabase | undefined;
  try {
    const before = snapshotStat(snapshotPath); noSidecars(snapshotPath);
    fd = openSync(snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!sameFile(before, fstatSync(fd))) return fail("snapshot_changed");
    const header = Buffer.alloc(100);
    if (readSync(fd, header, 0, 100, 0) !== 100 || header.subarray(0, 16).toString() !== "SQLite format 3\0"
      || header[18] !== 1 || header[19] !== 1) return fail("snapshot_not_standalone");
    if (fileHash(fd, before.size) !== base.snapshotSha256) return fail("snapshot_hash_mismatch");
    db = new DatabaseSync(snapshotPath, { readOnly: true, allowExtension: false, timeout: 0 });
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
    const source = readRows(db);
    db.close(); db = undefined;
    noSidecars(snapshotPath);
    if (!sameFile(before, snapshotStat(snapshotPath)) || !sameFile(before, fstatSync(fd))
      || fileHash(fd, before.size) !== base.snapshotSha256) return fail("snapshot_changed");
    const { domains, issues } = manifestRows(source, files);
    let manifest: DocumentImportManifest | null = null;
    if (!issues.length) {
      try { manifest = parseDocumentImportManifest(JSON.stringify({ ...base, domains })); }
      catch { return fail("invalid_source_metadata"); }
    }
    const plan = manifest ? planDocumentImportReconciliation(manifest) : null;
    return { status: issues.length || plan?.issues.length ? "blocked" as const : "planned" as const,
      snapshotVerified: true as const, metadataScope: "allowlisted_columns_only" as const,
      executionAllowed: false as const, sourceBytesVerified: false as const, liveAuthorityVerified: false as const, d5Complete: false as const,
      domainCounts: Object.fromEntries(DOCUMENT_IMPORT_DOMAINS.map(d => [d, source[d].length])),
      issues: [...issues, ...(plan?.issues ?? [])], manifest, plan };
  } catch (error) {
    if (error instanceof DocumentImportSnapshotError) throw error;
    return fail("snapshot_unavailable");
  } finally {
    try { try { db?.close(); } finally { if (fd !== undefined) closeSync(fd); } }
    catch { fail("snapshot_unavailable"); }
  }
}
