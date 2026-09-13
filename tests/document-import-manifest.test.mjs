import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_IMPORT_DOMAINS, DocumentImportManifestError,
  parseDocumentImportManifest, planDocumentImportReconciliation,
} from "../src/lib/document-import-manifest.ts";

// Deliberately synthetic metadata only. No reader/service implementation is replaced.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = n => n.repeat(64);
const ref = (relation, domain, sourcePk) => ({ relation, domain, sourcePk });
const file = (mimeType = "application/pdf") => ({ sha256: hash("a"), byteSize: 100, mimeType });
const row = (sourcePk, overrides = {}) => ({ sourcePk, sourceStudentId: id(1), metadataSha256: hash("b"),
  references: [], file: null, legacyAssertion: false, ...overrides });
function fixture() {
  return { schema: "evo-docs-import-metadata/v1", sourceInstanceId: id(100), snapshotSha256: hash("c"),
    domains: {
      students: [row(id(1))],
      documents: [row(id(2), { file: file(), references: [ref("current_version", "document_versions", id(3))] })],
      document_versions: [row(id(3), { file: file(), references: [ref("document", "documents", id(2))] })],
      field_values: [row(`${id(1)}:passport_number`, { legacyAssertion: true,
        references: [ref("source_document", "documents", id(2)), ref("source_version", "document_versions", id(3))] })],
      field_candidates: [row("1")], event_log: [row("1")], package_settings: [row(id(1))],
      package_parts: [row(id(4), { file: file(), references: [ref("parent_version", "document_versions", id(3))] })],
      package_reviews: [row(`${id(1)}:${id(4)}`, { legacyAssertion: true,
        references: [ref("file", "package_parts", id(4)), ref("version", "package_parts", id(4))] })],
      package_exports: [row(id(5), { file: file("application/zip"), legacyAssertion: true,
        references: [ref("member", "document_versions", id(3)), ref("member", "package_parts", id(4))] })],
      university_forms: [row(id(6), { file: file(), sourceStudentId: null, legacyAssertion: true })],
      university_form_exports: [row(id(7), { file: file(), legacyAssertion: true,
        references: [ref("form", "university_forms", id(6))] })],
    },
    caseMappings: [{ sourceStudentId: id(1), organizationId: id(10), studentCaseId: id(11),
      approval: { decisionId: id(12), reviewerMembershipId: id(13), snapshotSha256: hash("c") } }],
    targetCases: [{ organizationId: id(10), studentCaseId: id(11) }], ledger: [],
  };
}
function core() {
  const m = fixture();
  for (const domain of DOCUMENT_IMPORT_DOMAINS) if (!["students", "documents", "document_versions"].includes(domain)) m.domains[domain] = [];
  return m;
}
const plan = m => planDocumentImportReconciliation(parseDocumentImportManifest(JSON.stringify(m)));
const codes = m => plan(m).issues.map(issue => issue.code);
function ledgerFor(m) {
  return plan(m).rows.map((r, i) => ({ sourceInstanceId: m.sourceInstanceId, domain: r.domain, sourcePk: r.sourcePk,
    recordSha256: r.recordSha256, organizationId: r.organizationId, studentCaseId: r.studentCaseId, targetId: id(200 + i) }));
}

test("all twelve source domains remain visible with truthful blocked boundaries", () => {
  const result = plan(fixture());
  assert.equal(result.rows.length, 12);
  assert.deepEqual(Object.keys(result.domainCounts), [...DOCUMENT_IMPORT_DOMAINS]);
  assert.ok(Object.values(result.domainCounts).every(count => count === 1));
  assert.equal(result.metadataConsistent, false);
  for (const flag of ["executionAllowed", "importExecuted", "sourceBytesVerified", "liveAuthorityVerified", "d5Complete"]) assert.equal(result[flag], false);
  assert.equal(result.rows.filter(r => r.issues.includes("target_import_boundary_unimplemented")).length, 8);
  assert.equal(result.rows.filter(r => r.issues.includes("legacy_assertion_requires_review")).length, 5);
  assert.ok(result.issues.some(i => i.code === "catalog_mapping_required"));
  assert.ok(!JSON.stringify(result).includes("reviewerMembershipId"));
});

test("consistent core metadata is unseen, never import permission or byte proof", () => {
  const result = plan(core());
  assert.equal(result.metadataConsistent, true);
  assert.ok(result.rows.every(r => r.disposition === "unseen"));
  assert.equal(result.executionAllowed, false);
  assert.equal(result.domainCounts.university_forms, 0);
});

test("caller-asserted ledger replay requires exact source fingerprint and case binding", () => {
  const m = core(); m.ledger = ledgerFor(m);
  const result = plan(m);
  assert.ok(result.rows.every(r => r.disposition === "already_recorded"));
  assert.equal(result.importExecuted, false);
  m.domains.documents[0].metadataSha256 = hash("d");
  assert.ok(codes(m).includes("ledger_record_or_binding_changed"));
});

test("same metadata digest cannot hide changed byte descriptors or source references", () => {
  const m = core(); m.ledger = ledgerFor(m);
  m.domains.documents[0].file.sha256 = hash("d");
  assert.ok(codes(m).includes("ledger_record_or_binding_changed"));
  assert.ok(codes(m).includes("current_version_file_mismatch"));
});

test("changed target binding is a conflict, never a name-based remap", () => {
  const m = core(); m.ledger = ledgerFor(m);
  m.caseMappings[0].studentCaseId = id(22); m.targetCases[0].studentCaseId = id(22);
  assert.ok(codes(m).includes("ledger_record_or_binding_changed"));
});

test("snapshot change does not create new source identity; new explicit approval is required", () => {
  const m = core(); m.ledger = ledgerFor(m); m.snapshotSha256 = hash("d");
  assert.ok(codes(m).includes("case_mapping_snapshot_changed"));
  m.caseMappings[0].approval.snapshotSha256 = hash("d");
  assert.ok(plan(m).rows.every(r => r.disposition === "already_recorded"));
});

for (const [name, change, expected] of [
  ["missing map", m => { m.caseMappings = []; }, "case_mapping_absent"],
  ["unapproved map", m => { m.caseMappings[0].approval = null; }, "case_mapping_unapproved"],
  ["duplicate map", m => { m.caseMappings.push(structuredClone(m.caseMappings[0])); }, "duplicate_case_mapping"],
  ["missing exact org/case", m => { m.targetCases[0].organizationId = id(99); }, "target_case_absent_or_ambiguous"],
  ["ambiguous target inventory", m => { m.targetCases.push(structuredClone(m.targetCases[0])); }, "target_case_absent_or_ambiguous"],
  ["unknown source student", m => { m.domains.students = []; }, "source_student_absent"],
]) test(name, () => {
  const m = core(); change(m); assert.ok(codes(m).includes(expected));
  assert.equal(plan(m).rows.find(r => r.domain === "documents").organizationId, null);
});

test("two source students cannot silently merge into one canonical case", () => {
  const m = core(); m.domains.students.push(row(id(8), { sourceStudentId: id(8) }));
  m.caseMappings.push({ ...structuredClone(m.caseMappings[0]), sourceStudentId: id(8) });
  assert.ok(codes(m).includes("case_mapping_collision"));
});

test("duplicate source keys are reported without dropping either row", () => {
  const m = core(); m.domains.students.push(structuredClone(m.domains.students[0]));
  const result = plan(m);
  assert.equal(result.rows.length, 4);
  assert.ok(result.issues.some(i => i.code === "duplicate_source_key"));
  assert.ok(result.issues.some(i => i.code === "source_student_ambiguous"));
});

test("identical bytes preserve distinct version identities and replay independently", () => {
  const m = core(); m.domains.document_versions.push({ ...structuredClone(m.domains.document_versions[0]), sourcePk: id(9) });
  assert.equal(plan(m).domainCounts.document_versions, 2);
  m.ledger = ledgerFor(m);
  const result = plan(m);
  const versions = result.rows.filter(r => r.domain === "document_versions");
  assert.equal(new Set(versions.map(r => r.targetId)).size, 2);
  assert.equal(versions.filter(r => r.disposition === "already_recorded").length, 2);
  assert.equal(result.metadataConsistent, true);
});

test("same-byte distinct versions sharing a ledger target require reconciliation for both", () => {
  const m = core(); m.domains.document_versions.push({ ...structuredClone(m.domains.document_versions[0]), sourcePk: id(9) });
  m.ledger = ledgerFor(m);
  const ledgerVersions = m.ledger.filter(r => r.domain === "document_versions");
  ledgerVersions[1].targetId = ledgerVersions[0].targetId;
  const result = plan(m);
  assert.equal(result.metadataConsistent, false);
  const versions = result.rows.filter(r => r.domain === "document_versions");
  assert.equal(versions.length, 2);
  for (const version of versions) {
    assert.equal(version.disposition, "reconciliation_required");
    assert.ok(version.issues.includes("ledger_target_collision"));
  }
  assert.ok(result.rows.filter(r => r.domain !== "document_versions").every(r => r.disposition === "already_recorded"));
});

test("target collision checks stay within the current source instance and domain", () => {
  const m = core(); m.ledger = ledgerFor(m);
  const version = m.ledger.find(r => r.domain === "document_versions");
  m.ledger.find(r => r.domain === "documents").targetId = version.targetId;
  assert.equal(plan(m).metadataConsistent, true);
  m.ledger.push({ ...version, sourceInstanceId: id(99), sourcePk: id(98) });
  assert.ok(codes(m).includes("ledger_foreign_instance"));
  assert.ok(!codes(m).includes("ledger_target_collision"));
});

for (const [name, change, expected] of [
  ["missing historical version", m => { m.domains.document_versions = []; }, "reference_absent"],
  ["missing current pointer", m => { m.domains.documents[0].references = []; }, "required_reference_absent"],
  ["duplicate pointer", m => { m.domains.documents[0].references.push(structuredClone(m.domains.documents[0].references[0])); }, "duplicate_reference"],
  ["current version wrong document", m => { m.domains.document_versions[0].references[0].sourcePk = id(99); }, "current_version_document_mismatch"],
  ["cross-student source", m => { m.domains.document_versions[0].sourceStudentId = id(99); }, "reference_cross_student"],
  ["duplicate version target", m => { m.domains.document_versions.push(structuredClone(m.domains.document_versions[0])); }, "reference_ambiguous"],
]) test(name, () => { const m = core(); change(m); assert.ok(codes(m).includes(expected)); });

test("field sources require a pair and exact document/version binding", () => {
  const m = fixture(); m.domains.field_values[0].references.pop();
  assert.ok(codes(m).includes("source_reference_pair_incomplete"));
  m.domains.field_values[0].references.push(ref("source_version", "document_versions", id(3)));
  m.domains.field_values[0].references[0].sourcePk = id(99);
  assert.ok(codes(m).includes("source_version_document_mismatch"));
});

test("package review cannot claim a different file or version", () => {
  const m = fixture(); m.domains.package_reviews[0].references[1] = ref("version", "document_versions", id(3));
  assert.ok(codes(m).includes("review_version_file_mismatch"));
});

for (const mimeType of ["video/mp4", "video/quicktime", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"])
  test(`unsupported student type remains visible: ${mimeType}`, () => {
    const m = core(); m.domains.documents[0].file.mimeType = mimeType;
    const result = plan(m); assert.equal(result.domainCounts.documents, 1);
    assert.ok(result.rows.find(r => r.domain === "documents").issues.includes("unsupported_file_type"));
  });

test("oversized original remains blocked; no conversion or scan-clean claim", () => {
  const m = core(); m.domains.documents[0].file.byteSize = 26 * 1024 * 1024;
  assert.ok(codes(m).includes("unsupported_file_size"));
  assert.ok(!JSON.stringify(plan(m)).includes('"clean"'));
});

test("ledger duplicates, absent rows and foreign source instances are explicit", () => {
  const m = core(); m.ledger = ledgerFor(m); m.ledger.push(structuredClone(m.ledger[0]));
  assert.ok(codes(m).includes("duplicate_ledger_key"));
  m.ledger[3].sourceInstanceId = id(99);
  assert.ok(codes(m).includes("ledger_foreign_instance"));
  m.ledger[3].sourceInstanceId = m.sourceInstanceId; m.ledger[3].sourcePk = id(99);
  assert.ok(codes(m).includes("ledger_source_absent"));
});

test("canonical plan is order-independent, immutable, and never mutates caller metadata", () => {
  const m = fixture(), before = structuredClone(m), first = planDocumentImportReconciliation(m);
  m.domains.package_exports[0].references.reverse();
  const second = planDocumentImportReconciliation(Object.fromEntries(Object.entries(m).reverse()));
  assert.deepEqual(second, first);
  m.domains.package_exports[0].references.reverse();
  assert.deepEqual(m, before);
  assert.ok(!Object.isFrozen(m)); assert.ok(Object.isFrozen(first.rows[0].issues));
  assert.throws(() => { first.rows.push({}); }, TypeError);
});

for (const [name, change] of [
  ["missing domain", m => { delete m.domains.event_log; }],
  ["unknown domain", m => { m.domains.credentials = []; }],
  ["raw applicant value", m => { m.domains.field_values[0].value = "SYNTHETIC_PRIVATE_SENTINEL"; }],
  ["file path", m => { m.domains.document_versions[0].file.path = "SYNTHETIC_PRIVATE_SENTINEL"; }],
  ["event message", m => { m.domains.event_log[0].message = "SYNTHETIC_PRIVATE_SENTINEL"; }],
  ["invented field reviewer", m => { m.domains.field_values[0].reviewerMembershipId = id(13); }],
  ["bad digest", m => { m.domains.students[0].metadataSha256 = "SYNTHETIC_PRIVATE_SENTINEL"; }],
  ["noncanonical UUID", m => { m.sourceInstanceId = "00000000-0000-0000-0000-000000000000"; }],
  ["unbounded event ID", m => { m.domains.event_log[0].sourcePk = "9007199254740992"; }],
  ["unknown field key", m => { m.domains.field_values[0].sourcePk = `${id(1)}:unknown`; }],
  ["wrong composite owner", m => { m.domains.field_values[0].sourceStudentId = id(8); }],
  ["private form owner", m => { m.domains.university_forms[0].sourceStudentId = id(1); }],
  ["missing file descriptor", m => { m.domains.documents[0].file = null; }],
  ["wrong relation domain", m => { m.domains.documents[0].references[0].domain = "students"; }],
  ["unknown relation", m => { m.domains.documents[0].references[0].relation = "SYNTHETIC_PRIVATE_SENTINEL"; }],
  ["legacy assertion on source file", m => { m.domains.documents[0].legacyAssertion = true; }],
]) test(`strict rejection: ${name}`, () => {
  const m = fixture(); change(m);
  assert.throws(() => plan(m), error => error instanceof DocumentImportManifestError
    && error.code === "invalid_metadata" && error.message === "invalid_metadata"
    && !String(error).includes("SYNTHETIC_PRIVATE_SENTINEL"));
});

test("JSON syntax errors never expose the input; input size is bounded", () => {
  assert.throws(() => parseDocumentImportManifest('{"SYNTHETIC_PRIVATE_SENTINEL'), { message: "invalid_json" });
  assert.throws(() => parseDocumentImportManifest(" ".repeat(8 * 1024 * 1024 + 1)), { message: "manifest_too_large" });
  const m = core(); m.domains.event_log = Array.from({ length: 10_001 }, (_, i) => row(String(i + 1)));
  assert.throws(() => plan(m), DocumentImportManifestError);
});

test("direct caller objects are revalidated without invoking object accessors", () => {
  const m = core(); Object.defineProperty(m, "snapshotSha256", { get() { throw new Error("SYNTHETIC_PRIVATE_SENTINEL"); }, enumerable: true });
  assert.throws(() => planDocumentImportReconciliation(m), { message: "invalid_metadata" });
});

test("direct caller arrays reject accessors, holes and extra properties before traversal", () => {
  for (const change of [
    a => Object.defineProperty(a, "0", { get() { throw new Error("SYNTHETIC_PRIVATE_SENTINEL"); }, enumerable: true }),
    a => { delete a[0]; },
    a => { a[Symbol.iterator] = () => { throw new Error("SYNTHETIC_PRIVATE_SENTINEL"); }; },
  ]) {
    const m = core(); change(m.domains.students);
    assert.throws(() => planDocumentImportReconciliation(m), { message: "invalid_metadata" });
  }
});

test("changing references changes the row fingerprint even with unchanged source digest", () => {
  const m = core(); m.domains.document_versions.push({ ...structuredClone(m.domains.document_versions[0]), sourcePk: id(9) });
  m.ledger = ledgerFor(m); m.domains.documents[0].references[0].sourcePk = id(9);
  assert.ok(codes(m).includes("ledger_record_or_binding_changed"));
});
