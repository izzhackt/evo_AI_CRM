import { createHash } from "node:crypto";
import { isProfileFieldKey } from "./student-profile-fields.ts";

/** D5 metadata planning only. No source reader, service client or write capability. */
export const DOCUMENT_IMPORT_DOMAINS = Object.freeze([
  "students", "documents", "document_versions", "field_values", "field_candidates", "event_log",
  "package_settings", "package_parts", "package_reviews", "package_exports", "university_forms", "university_form_exports",
] as const);
export type DocumentImportDomain = typeof DOCUMENT_IMPORT_DOMAINS[number];
export type ImportReference = Readonly<{ relation: string; domain: DocumentImportDomain; sourcePk: string }>;
export type ImportMetadataRow = Readonly<{
  sourcePk: string; sourceStudentId: string | null; metadataSha256: string;
  references: readonly ImportReference[];
  file: Readonly<{ sha256: string; byteSize: number; mimeType: string }> | null;
  legacyAssertion: boolean;
}>;
export type ImportCaseMapping = Readonly<{
  sourceStudentId: string; organizationId: string; studentCaseId: string;
  approval: Readonly<{ decisionId: string; reviewerMembershipId: string; snapshotSha256: string }> | null;
}>;
export type ImportLedgerEntry = Readonly<{
  sourceInstanceId: string; domain: DocumentImportDomain; sourcePk: string; recordSha256: string;
  organizationId: string | null; studentCaseId: string | null; targetId: string;
}>;
export type DocumentImportManifest = Readonly<{
  schema: "evo-docs-import-metadata/v1"; sourceInstanceId: string; snapshotSha256: string;
  domains: Readonly<Record<DocumentImportDomain, readonly ImportMetadataRow[]>>;
  caseMappings: readonly ImportCaseMapping[];
  targetCases: readonly Readonly<{ organizationId: string; studentCaseId: string }>[];
  ledger: readonly ImportLedgerEntry[];
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const MAX_ROWS = 10_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const FILE_DOMAINS = new Set<DocumentImportDomain>([
  "documents", "document_versions", "package_parts", "package_exports", "university_forms", "university_form_exports",
]);
const ASSERTION_DOMAINS = new Set<DocumentImportDomain>([
  "field_values", "package_reviews", "package_exports", "university_forms", "university_form_exports",
]);
const PENDING_DOMAINS = new Set<DocumentImportDomain>([
  "field_candidates", "event_log", "package_settings", "package_parts", "package_reviews", "package_exports",
  "university_forms", "university_form_exports",
]);
const MIME_TYPES = ["application/pdf", "image/jpeg", "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "video/mp4", "video/quicktime", "application/zip", "application/octet-stream"];
const RELATIONS: Record<DocumentImportDomain, Readonly<Record<string, readonly DocumentImportDomain[]>>> = {
  students: {}, documents: { current_version: ["document_versions"] }, document_versions: { document: ["documents"] },
  field_values: { source_document: ["documents"], source_version: ["document_versions"] },
  field_candidates: { source_document: ["documents"], source_version: ["document_versions"] }, event_log: {},
  package_settings: {}, package_parts: { parent_version: ["document_versions"] },
  package_reviews: { file: ["documents", "package_parts"], version: ["document_versions", "package_parts"] },
  package_exports: { member: ["document_versions", "package_parts", "university_form_exports"] },
  university_forms: {}, university_form_exports: { form: ["university_forms"] },
};

export class DocumentImportManifestError extends Error {
  readonly code: string;
  constructor(code: "invalid_json" | "invalid_metadata" | "manifest_too_large") {
    super(code); this.name = "DocumentImportManifestError"; this.code = code;
  }
}
function invalid(): never { throw new DocumentImportManifestError("invalid_metadata"); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]))) return invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit
    || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(descriptors, index) || !("value" in descriptors[index])) return invalid();
  }
  return value;
}
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) return invalid(); return value; }
function sha(value: unknown): string { if (typeof value !== "string" || !SHA.test(value)) return invalid(); return value; }
function domain(value: unknown): DocumentImportDomain {
  if (!DOCUMENT_IMPORT_DOMAINS.includes(value as DocumentImportDomain)) return invalid();
  return value as DocumentImportDomain;
}
function primaryKey(value: unknown, kind: DocumentImportDomain): string {
  if (typeof value !== "string") return invalid();
  if (kind === "field_candidates" || kind === "event_log") {
    if (!/^[1-9][0-9]{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value))) return invalid();
  } else if (kind === "field_values" || kind === "package_reviews") {
    if (value[36] !== ":" || !UUID.test(value.slice(0, 36))) return invalid();
    if (kind === "field_values" ? !isProfileFieldKey(value.slice(37)) : !UUID.test(value.slice(37))) return invalid();
  } else uuid(value);
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function row(value: unknown, kind: DocumentImportDomain): ImportMetadataRow {
  const r = object(value, ["sourcePk", "sourceStudentId", "metadataSha256", "references", "file", "legacyAssertion"]);
  const sourcePk = primaryKey(r.sourcePk, kind);
  const sourceStudentId = kind === "university_forms" ? (r.sourceStudentId === null ? null : invalid()) : uuid(r.sourceStudentId);
  if ((kind === "students" || kind === "package_settings") && sourcePk !== sourceStudentId) return invalid();
  if ((kind === "field_values" || kind === "package_reviews") && sourcePk.slice(0, 36) !== sourceStudentId) return invalid();
  if (typeof r.legacyAssertion !== "boolean" || (r.legacyAssertion && !ASSERTION_DOMAINS.has(kind))) return invalid();
  const references = array(r.references, 16).map(value => {
    const ref = object(value, ["relation", "domain", "sourcePk"]), targetDomain = domain(ref.domain);
    if (typeof ref.relation !== "string" || !Object.hasOwn(RELATIONS[kind], ref.relation)
      || !RELATIONS[kind][ref.relation].includes(targetDomain)) return invalid();
    return { relation: ref.relation, domain: targetDomain, sourcePk: primaryKey(ref.sourcePk, targetDomain) };
  }).sort((a, b) => compare(canonical(a), canonical(b)));
  let file: ImportMetadataRow["file"] = null;
  if (FILE_DOMAINS.has(kind)) {
    const f = object(r.file, ["sha256", "byteSize", "mimeType"]);
    if (!Number.isSafeInteger(f.byteSize) || (f.byteSize as number) < 1 || (f.byteSize as number) > 1024 ** 4
      || !MIME_TYPES.includes(f.mimeType as string)) return invalid();
    file = { sha256: sha(f.sha256), byteSize: f.byteSize as number, mimeType: f.mimeType as string };
  } else if (r.file !== null) return invalid();
  return { sourcePk, sourceStudentId, metadataSha256: sha(r.metadataSha256), references, file, legacyAssertion: r.legacyAssertion };
}

function validate(value: unknown): DocumentImportManifest {
  const m = object(value, ["schema", "sourceInstanceId", "snapshotSha256", "domains", "caseMappings", "targetCases", "ledger"]);
  if (m.schema !== "evo-docs-import-metadata/v1") return invalid();
  const inputDomains = object(m.domains, DOCUMENT_IMPORT_DOMAINS);
  const domains = {} as Record<DocumentImportDomain, ImportMetadataRow[]>;
  let count = 0;
  for (const kind of DOCUMENT_IMPORT_DOMAINS) {
    const rows = array(inputDomains[kind], MAX_ROWS); count += rows.length;
    if (count > MAX_ROWS) throw new DocumentImportManifestError("manifest_too_large");
    domains[kind] = Array.from(rows, value => row(value, kind)).sort((a, b) => compare(a.sourcePk, b.sourcePk) || compare(canonical(a), canonical(b)));
  }
  const caseMappings = Array.from(array(m.caseMappings, 1000), value => {
    const c = object(value, ["sourceStudentId", "organizationId", "studentCaseId", "approval"]);
    let approval: ImportCaseMapping["approval"] = null;
    if (c.approval !== null) {
      const a = object(c.approval, ["decisionId", "reviewerMembershipId", "snapshotSha256"]);
      approval = { decisionId: uuid(a.decisionId), reviewerMembershipId: uuid(a.reviewerMembershipId), snapshotSha256: sha(a.snapshotSha256) };
    }
    return { sourceStudentId: uuid(c.sourceStudentId), organizationId: uuid(c.organizationId), studentCaseId: uuid(c.studentCaseId), approval };
  }).sort((a, b) => compare(canonical(a), canonical(b)));
  const targetCases = Array.from(array(m.targetCases, 1000), value => {
    const c = object(value, ["organizationId", "studentCaseId"]);
    return { organizationId: uuid(c.organizationId), studentCaseId: uuid(c.studentCaseId) };
  }).sort((a, b) => compare(canonical(a), canonical(b)));
  const ledger = Array.from(array(m.ledger, MAX_ROWS), value => {
    const l = object(value, ["sourceInstanceId", "domain", "sourcePk", "recordSha256", "organizationId", "studentCaseId", "targetId"]);
    const kind = domain(l.domain), global = kind === "university_forms";
    if (global && (l.organizationId !== null || l.studentCaseId !== null)) return invalid();
    return { sourceInstanceId: uuid(l.sourceInstanceId), domain: kind, sourcePk: primaryKey(l.sourcePk, kind), recordSha256: sha(l.recordSha256),
      organizationId: global ? null : uuid(l.organizationId), studentCaseId: global ? null : uuid(l.studentCaseId), targetId: uuid(l.targetId) };
  }).sort((a, b) => compare(canonical(a), canonical(b)));
  return freeze({ schema: m.schema, sourceInstanceId: uuid(m.sourceInstanceId), snapshotSha256: sha(m.snapshotSha256), domains, caseMappings, targetCases, ledger });
}

export function parseDocumentImportManifest(json: string): DocumentImportManifest {
  if (typeof json !== "string") return invalid();
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) throw new DocumentImportManifestError("manifest_too_large");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new DocumentImportManifestError("invalid_json"); }
  return validate(value);
}

type Issue = Readonly<{ code: string; domain: DocumentImportDomain; sourcePk: string }>;
type PlannedRow = Readonly<{
  domain: DocumentImportDomain; sourcePk: string; recordSha256: string;
  organizationId: string | null; studentCaseId: string | null; targetId: string | null;
  disposition: "unseen" | "already_recorded" | "reconciliation_required"; issues: readonly string[];
}>;
function key(kind: DocumentImportDomain, pk: string): string { return `${kind}:${pk}`; }
function group<T>(items: readonly T[], identify: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const k = identify(item), entries = result.get(k);
    if (entries) entries.push(item); else result.set(k, [item]);
  }
  return result;
}

export function planDocumentImportReconciliation(input: DocumentImportManifest) {
  const m = validate(input), issues: Issue[] = [], rows: PlannedRow[] = [];
  const source = new Map(DOCUMENT_IMPORT_DOMAINS.flatMap(kind => m.domains[kind].map(r => [key(kind, r.sourcePk), r] as const)));
  const duplicates = new Set(DOCUMENT_IMPORT_DOMAINS.flatMap(kind => [...group(m.domains[kind], r => r.sourcePk)]
    .filter(([, records]) => records.length > 1).map(([pk]) => key(kind, pk))));
  const mappings = group(m.caseMappings, c => c.sourceStudentId);
  const destinations = group(m.caseMappings, c => `${c.organizationId}:${c.studentCaseId}`);
  const targetCases = group(m.targetCases, c => `${c.organizationId}:${c.studentCaseId}`);
  const currentLedger = m.ledger.filter(l => l.sourceInstanceId === m.sourceInstanceId);
  const prior = group(currentLedger, l => key(l.domain, l.sourcePk));
  const targetCollisions = new Set([...group(currentLedger, l => key(l.domain, l.targetId)).values()]
    .filter(entries => new Set(entries.map(entry => entry.sourcePk)).size > 1)
    .flatMap(entries => entries.map(entry => key(entry.domain, entry.sourcePk))));
  for (const mapping of m.caseMappings) {
    if (!source.has(key("students", mapping.sourceStudentId))) issues.push({ code: "mapping_source_absent", domain: "students", sourcePk: mapping.sourceStudentId });
  }
  for (const entry of m.ledger) {
    if (entry.sourceInstanceId !== m.sourceInstanceId) issues.push({ code: "ledger_foreign_instance", domain: entry.domain, sourcePk: entry.sourcePk });
    else if (!source.has(key(entry.domain, entry.sourcePk))) issues.push({ code: "ledger_source_absent", domain: entry.domain, sourcePk: entry.sourcePk });
  }
  for (const kind of DOCUMENT_IMPORT_DOMAINS) for (const r of m.domains[kind]) {
    const codes = new Set<string>(), recordSha256 = digest(r);
    let binding: ImportCaseMapping | undefined;
    if (duplicates.has(key(kind, r.sourcePk))) codes.add("duplicate_source_key");
    if (r.sourceStudentId !== null) {
      if (!source.has(key("students", r.sourceStudentId))) codes.add("source_student_absent");
      if (duplicates.has(key("students", r.sourceStudentId))) codes.add("source_student_ambiguous");
      const choices = mappings.get(r.sourceStudentId) ?? [];
      if (choices.length !== 1) codes.add(choices.length ? "duplicate_case_mapping" : "case_mapping_absent");
      else {
        const choice = choices[0], destination = `${choice.organizationId}:${choice.studentCaseId}`;
        if (!choice.approval) codes.add("case_mapping_unapproved");
        else if (choice.approval.snapshotSha256 !== m.snapshotSha256) codes.add("case_mapping_snapshot_changed");
        if (destinations.get(destination)!.length !== 1) codes.add("case_mapping_collision");
        if ((targetCases.get(destination)?.length ?? 0) !== 1) codes.add("target_case_absent_or_ambiguous");
        if (codes.size === 0) binding = choice;
      }
    }
    const refs = group(r.references, ref => ref.relation);
    for (const [relation, entries] of refs) if (relation !== "member" && entries.length !== 1) codes.add("duplicate_reference");
    if (new Set(r.references.map(canonical)).size !== r.references.length) codes.add("duplicate_reference");
    const required = kind === "documents" ? ["current_version"] : kind === "document_versions" ? ["document"]
      : kind === "package_reviews" ? ["file", "version"] : kind === "university_form_exports" ? ["form"] : [];
    if (required.some(relation => !refs.has(relation))) codes.add("required_reference_absent");
    if (refs.has("source_document") !== refs.has("source_version")) codes.add("source_reference_pair_incomplete");
    for (const ref of r.references) {
      const target = source.get(key(ref.domain, ref.sourcePk));
      if (!target) codes.add("reference_absent");
      else if (target.sourceStudentId !== null && target.sourceStudentId !== r.sourceStudentId) codes.add("reference_cross_student");
      if (duplicates.has(key(ref.domain, ref.sourcePk))) codes.add("reference_ambiguous");
    }
    const linked = (relation: string) => {
      const ref = refs.get(relation)?.[0]; return ref ? source.get(key(ref.domain, ref.sourcePk)) : undefined;
    };
    const linkedDocument = (version: ImportMetadataRow | undefined) => version?.references.find(ref => ref.relation === "document")?.sourcePk;
    if (kind === "documents" && linked("current_version")) {
      if (linkedDocument(linked("current_version")) !== r.sourcePk) codes.add("current_version_document_mismatch");
      if (canonical(r.file) !== canonical(linked("current_version")!.file)) codes.add("current_version_file_mismatch");
    }
    if (linked("source_version") && linkedDocument(linked("source_version")) !== linked("source_document")?.sourcePk) codes.add("source_version_document_mismatch");
    if (kind === "package_reviews" && refs.has("file") && refs.has("version")) {
      const fileRef = refs.get("file")![0], versionRef = refs.get("version")![0];
      if (r.sourcePk.slice(37) !== fileRef.sourcePk || (fileRef.domain === "package_parts"
        ? versionRef.domain !== "package_parts" || versionRef.sourcePk !== fileRef.sourcePk
        : versionRef.domain !== "document_versions" || linkedDocument(linked("version")) !== fileRef.sourcePk)) codes.add("review_version_file_mismatch");
    }
    if (r.file) {
      const mime = r.file.mimeType;
      const supported = kind === "package_exports" ? mime === "application/zip"
        : kind === "university_forms" || kind === "university_form_exports" ? [MIME_TYPES[0], MIME_TYPES[3]].includes(mime)
          : MIME_TYPES.slice(0, 3).includes(mime);
      if (!supported) codes.add("unsupported_file_type");
      if ((kind === "documents" || kind === "document_versions" || kind === "package_parts") && r.file.byteSize > 25 * 1024 * 1024) codes.add("unsupported_file_size");
    }
    if (r.legacyAssertion) codes.add("legacy_assertion_requires_review");
    if (PENDING_DOMAINS.has(kind)) codes.add("target_import_boundary_unimplemented");
    if (kind === "university_forms") codes.add("catalog_mapping_required");
    const entries = prior.get(key(kind, r.sourcePk)) ?? [];
    if (entries.length > 1) codes.add("duplicate_ledger_key");
    if (targetCollisions.has(key(kind, r.sourcePk))) codes.add("ledger_target_collision");
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (entry && (entry.recordSha256 !== recordSha256 || entry.organizationId !== (binding?.organizationId ?? null)
      || entry.studentCaseId !== (binding?.studentCaseId ?? null))) codes.add("ledger_record_or_binding_changed");
    const rowIssues = [...codes].sort();
    rows.push({ domain: kind, sourcePk: r.sourcePk, recordSha256, organizationId: binding?.organizationId ?? null,
      studentCaseId: binding?.studentCaseId ?? null, targetId: entry?.targetId ?? null,
      disposition: rowIssues.length ? "reconciliation_required" : entry ? "already_recorded" : "unseen", issues: rowIssues });
    rowIssues.forEach(code => issues.push({ code, domain: kind, sourcePk: r.sourcePk }));
  }
  return freeze({ schema: "evo-docs-import-plan/v1" as const, sourceInstanceId: m.sourceInstanceId, snapshotSha256: m.snapshotSha256,
    manifestSha256: digest(m), executionAllowed: false as const, importExecuted: false as const, sourceBytesVerified: false as const,
    liveAuthorityVerified: false as const, d5Complete: false as const, metadataConsistent: issues.length === 0,
    domainCounts: Object.fromEntries(DOCUMENT_IMPORT_DOMAINS.map(kind => [kind, m.domains[kind].length])) as Record<DocumentImportDomain, number>,
    rows, issues: issues.sort((a, b) => compare(canonical(a), canonical(b))) });
}
