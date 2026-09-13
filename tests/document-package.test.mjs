import assert from "node:assert/strict";
import test from "node:test";
import { computePackageRulesHash, resolveDocumentPackage } from "../src/lib/document-package.ts";
import { fixture, generatedFixture, id } from "./fixtures/document-package.mjs";

test("an exact reviewed current original satisfies its required package slot without public-ready claims", async () => {
  const snapshot = await fixture(), before = JSON.stringify(snapshot);
  const result = await resolveDocumentPackage(snapshot, 1);
  assert.equal(result.contentReady, true);
  assert.deepEqual(result.checks, []);
  assert.equal(result.items[0].draftEligible, true);
  assert.equal(result.items[0].finalEligible, true);
  assert.equal(result.items[0].path, `documents/original/${id(6)}.pdf`);
  assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(Object.isFrozen(result.items[0]));
  assert.equal("ready" in result, false);
});

test("a newer original version invalidates the selected review even with identical bytes", async () => {
  const snapshot = await fixture();
  snapshot.currentDocumentVersions[0].versionId = id(20);
  const result = await resolveDocumentPackage(snapshot, 1);
  assert.equal(result.contentReady, false);
  assert.equal(result.items[0].draftEligible, false);
  assert.ok(result.checks.some(check => check.code === "source_version_stale"));
});

test("translation review belongs to the exact current parent original version", async () => {
  const snapshot = await fixture();
  snapshot.rules.slots[0].role = "translation";
  snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  const item = snapshot.items[0];
  item.source.role = "translation";
  item.source.parent = { documentId: id(11), versionId: id(12), sha256: "b".repeat(64) };
  item.review.parent = { ...item.source.parent };
  item.review.rulesSha256 = snapshot.rules.sha256;
  snapshot.currentDocumentVersions.push({ ...item.source.parent });
  assert.equal((await resolveDocumentPackage(snapshot, 1)).contentReady, true);
  snapshot.currentDocumentVersions[1].versionId = id(13);
  const stale = await resolveDocumentPackage(snapshot, 1);
  assert.equal(stale.contentReady, false);
  assert.equal(stale.items[0].draftEligible, false);
  assert.ok(stale.checks.some(check => check.code === "parent_version_stale"));
});

test("parent identity and hash are bound by review, independently of the current-version list", async () => {
  const snapshot = await fixture(), item = snapshot.items[0];
  snapshot.rules.slots[0].role = "translation"; snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  item.source.role = "translation";
  item.source.parent = { documentId: id(11), versionId: id(12), sha256: "b".repeat(64) };
  item.review.parent = { ...item.source.parent }; item.review.rulesSha256 = snapshot.rules.sha256;
  snapshot.currentDocumentVersions.push({ ...item.source.parent });
  assert.equal((await resolveDocumentPackage(snapshot, 1)).contentReady, true);
  item.source.parent.sha256 = "c".repeat(64); snapshot.currentDocumentVersions[1].sha256 = "c".repeat(64);
  const result = await resolveDocumentPackage(snapshot, 1);
  assert.equal(result.items[0].draftEligible, false);
  assert.ok(result.checks.some(check => check.code === "review_stale"));
});

test("a ready immutable profile export and university form remain distinct exact references", async () => {
  for (const kind of ["student_profile_export", "university_form_export"]) {
    const snapshot = await generatedFixture(kind), result = await resolveDocumentPackage(snapshot, 1);
    assert.equal(result.contentReady, true);
    assert.equal(result.items[0].path, `${kind}/${id(6)}.pdf`);
    assert.equal(result.items[0].source.export.generationReceiptId, id(27));
  }
});

test("profile, confirmed-field digest, template, mapping and review revisions invalidate a generated artifact", async () => {
  for (const [key, value] of [["profileRevision", 3], ["fieldReviewsSha256", "d".repeat(64)], ["templateSha256", "d".repeat(64)],
    ["templateVersionId", id(50)], ["mappingVersionId", id(50)], ["mappingSha256", "d".repeat(64)], ["mappingReviewVersionId", id(50)]]) {
    const snapshot = await generatedFixture("university_form_export");
    snapshot.items[0].source.export.currentInput[key] = value;
    const result = await resolveDocumentPackage(snapshot, 1);
    assert.equal(result.contentReady, false, key);
    assert.equal(result.items[0].draftEligible, false, key);
    assert.ok(result.checks.some(check => check.code === "export_input_stale"), key);
  }
});

test("pending, unknown or failed generation never supplies draft bytes; an existing reviewed draft is draft-only", async () => {
  for (const outcome of ["pending", "unknown", "failed"]) {
    const snapshot = await generatedFixture(); snapshot.items[0].source.export.outcome = outcome;
    const result = await resolveDocumentPackage(snapshot, 1);
    assert.equal(result.items[0].draftEligible, false);
    assert.ok(result.checks.some(check => check.code === "export_not_ready"));
  }
  const snapshot = await generatedFixture(); snapshot.items[0].source.export.mode = "draft";
  const result = await resolveDocumentPackage(snapshot, 1);
  assert.equal(result.contentReady, false); assert.equal(result.items[0].draftEligible, true); assert.equal(result.items[0].finalEligible, false);
  snapshot.items[0].source.export.inputSha256 = "f".repeat(64);
  assert.equal((await resolveDocumentPackage(snapshot, 1)).items[0].draftEligible, false);
});

test("the generation receipt belongs to the exact exported artifact reference and bytes", async () => {
  for (const [key, value] of [["exportId", id(70)], ["artifactSha256", "e".repeat(64)]]) {
    const snapshot = await generatedFixture(); snapshot.items[0].source.export[key] = value;
    const result = await resolveDocumentPackage(snapshot, 1);
    assert.equal(result.items[0].draftEligible, false);
    assert.ok(result.checks.some(check => check.code === "export_reference_mismatch"));
  }
});

test("exact review/source/rule and ordinary availability/page constraints are required", async () => {
  for (const [mutate, code] of [
    [s => { s.items[0].review = null; }, "review_missing"],
    [s => { s.items[0].review.state = "rejected"; }, "review_rejected"],
    [s => { s.items[0].review.sourceSha256 = "b".repeat(64); }, "review_stale"],
    [s => { s.items[0].review.rulesVersionId = id(51); }, "review_stale"],
    [s => { s.items[0].source.available = false; }, "source_unavailable"],
    [s => { s.items[0].review.verifiedPages = null; }, "pages_unverified"],
    [s => { s.items[0].source.documentTypeCode = "diploma"; }, "source_slot_mismatch"],
    [s => { s.items[0].source.sizeBytes = 2048; }, "rule_size_exceeded"],
    [s => { s.items[0].selected = false; }, "required_not_selected"],
    [s => { s.items = []; }, "required_slot_missing"],
    [s => { s.items[0].source = null; }, "source_missing"],
  ]) {
    const snapshot = await fixture(); mutate(snapshot);
    const result = await resolveDocumentPackage(snapshot, 1);
    assert.equal(result.contentReady, false, code); assert.ok(result.checks.some(check => check.code === code), code);
    assert.ok(result.items.every(item => !item.draftEligible), code);
  }
});

test("rule revisions and optimistic package revision cannot reuse earlier evidence", async () => {
  const snapshot = await fixture();
  await assert.rejects(resolveDocumentPackage(snapshot, 2), { code: "package_revision_conflict" });
  snapshot.rules.slots[0].minPages = 2;
  await assert.rejects(resolveDocumentPackage(snapshot, 1), { code: "package_rules_mismatch" });
  snapshot.rules.sha256 = await computePackageRulesHash(snapshot.rules);
  const result = await resolveDocumentPackage(snapshot, 1);
  assert.ok(result.checks.some(check => check.code === "review_stale"));
});

test("snapshots stay scoped even for an unselected source and generated catalogue binding", async () => {
  const snapshot = await fixture(); snapshot.items[0].selected = false; snapshot.items[0].source.studentCaseId = id(60);
  await assert.rejects(resolveDocumentPackage(snapshot, 1), { code: "package_scope_mismatch" });
  const form = await generatedFixture("university_form_export"); form.catalogInstitutionId = id(60);
  await assert.rejects(resolveDocumentPackage(form, 1), { code: "package_scope_mismatch" });
});

test("bounded canonical inputs reject excessive asset metadata and exclude private labels", async () => {
  const snapshot = await fixture(); snapshot.items[0].source.originalFilename = "Synthetic private label.pdf";
  const clean = await resolveDocumentPackage(snapshot, 1);
  assert.equal(JSON.stringify(clean).includes("private label"), false);
  snapshot.items = Array.from({ length: 41 }, () => snapshot.items[0]);
  await assert.rejects(resolveDocumentPackage(snapshot, 1), { code: "invalid_package_snapshot" });
  const large = await fixture(); large.items[0].source.sizeBytes = 25 * 1024 * 1024 + 1;
  await assert.rejects(resolveDocumentPackage(large, 1), { code: "invalid_package_snapshot" });
});

test("aggregate declared bytes are bounded before loading originals, and async input capture is immutable", async () => {
  const snapshot = await fixture(), promise = resolveDocumentPackage(snapshot, 1);
  snapshot.items[0].source.available = false;
  assert.equal((await promise).contentReady, true);
  const large = await fixture(); large.rules.slots[0].maxBytes = null; large.items[0].source.sizeBytes = 25 * 1024 * 1024;
  for (let index = 1; index < 3; index++) {
    large.rules.slots.push({ ...large.rules.slots[0], id: id(100 + index) });
    const item = structuredClone(large.items[0]); item.id = id(200 + index); item.slotId = id(100 + index); item.review.itemId = item.id;
    large.items.push(item);
  }
  large.rules.sha256 = await computePackageRulesHash(large.rules);
  large.items.forEach(item => { item.review.rulesSha256 = large.rules.sha256; });
  await assert.rejects(resolveDocumentPackage(large, 1), { code: "package_too_large" });
});
