import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isConnectedStudentPortalApi } from "../src/lib/platform-route-contract.ts";
import { getPortalStrings } from "../src/lib/portal/i18n.ts";
import { normalizeStudentPortalCaseFile } from "../src/lib/v3/portal-source.ts";

// Свои договор и чеки студента (миграция 352): только чтение, точная форма, свой маршрут скачивания. Данные выдуманы.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ID = "35200000-0000-4000-8000-000000000921";
const row = { file_kind: "contract", file_id: ID, original_filename: "contract.png", declared_mime_type: "image/png", byte_size: 128, added_at: "2026-11-08T10:00:00+00:00" };

test("the Student case file row has an exact shape and a closed set of kinds", () => {
  assert.deepEqual({ ...normalizeStudentPortalCaseFile(row) }, { kind: "contract", fileId: ID, originalFilename: "contract.png", declaredMimeType: "image/png", byteSize: 128, addedAt: "2026-11-08T10:00:00+00:00" });
  for (const kind of ["receipt", "pending_receipt"]) assert.equal(normalizeStudentPortalCaseFile({ ...row, file_kind: kind }).kind, kind);
  for (const bad of [{ ...row, sha256_hex: "a".repeat(64) }, { ...row, storage_object_name: "x" }, { ...row, file_kind: "passport" }, { ...row, file_id: "nope" },
    { ...row, declared_mime_type: "text/html" }, { ...row, byte_size: 0 }, (({ added_at, ...rest }) => rest)(row)]) {
    assert.throws(() => normalizeStudentPortalCaseFile(bad));
  }
});

test("the download route is a connected Student API for GET only, for the five kinds only", () => {
  for (const kind of ["contract", "receipt", "pending_receipt", "student_receipt", "payment_details_qr"]) {
    assert.equal(isConnectedStudentPortalApi(`/api/portal/case-files/${kind}/${ID}/download`, "GET"), true, kind);
    assert.equal(isConnectedStudentPortalApi(`/api/portal/case-files/${kind}/${ID}/download`, "POST"), false, kind);
  }
  assert.equal(isConnectedStudentPortalApi(`/api/portal/case-files/passport/${ID}/download`, "GET"), false);
  assert.equal(isConnectedStudentPortalApi(`/api/portal/case-files/contract/not-a-uuid/download`, "GET"), false);
});

test("the handler authorizes through the Student target RPC before any signing and never takes a path from the client", () => {
  const handler = read("../src/lib/server/platform-case-agreement-storage-route-handlers.ts");
  const student = handler.slice(handler.indexOf("createStudentPortalCaseFileDownloadHandler"));
  assert.ok(student.indexOf("student_portal_case_file_target_v1") < student.indexOf("createSignedUrl"), "authorize first, sign second");
  assert.match(student, /storage_object_name/);
  assert.match(student, /"Cache-Control": "no-store"/);
  assert.match(read("../src/app/api/portal/case-files/[fileKind]/[fileId]/download/route.ts"), /createStudentPortalCaseFileDownloadHandler\(\)/);
});

test("the Student page shows the block read-only on the documents page and its labels exist in RU and KY", () => {
  const page = read("../src/app/(portal)/portal/documents/page.tsx");
  assert.match(page, /<CaseFilesCard files=\{caseFiles\} locale=\{locale\} \/>/);
  assert.match(page, /readStudentPortalCaseFiles\(\)\.catch\(\(\) => \[\]\)/, "a failed read hides the block, it does not break the checklist");
  const card = read("../src/components/portal/admission/CaseFilesCard.tsx");
  assert.equal(/<form|method="post"|onClick|upload/i.test(card), false, "read-only: no form, no upload, no handler");
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("admission", locale);
    for (const key of ["caseFilesTitle", "caseFilesLead", "caseFileContract", "caseFileReceipt", "caseFileReceiptAttached", "caseFileReceiptPending"]) {
      assert.equal(typeof strings[key], "string", `${locale}:${key}`);
      assert.ok(strings[key].length > 0, `${locale}:${key}`);
    }
  }
  assert.notEqual(getPortalStrings("admission", "ky").caseFilesTitle, getPortalStrings("admission", "ru").caseFilesTitle);
});

test("migration 352: the Student read lists no amounts, hashes or storage names, and queueing needs no money permission", () => {
  const sql = read("../supabase/migrations/352_platform_document_kind_followups.sql");
  const files = sql.slice(sql.indexOf("CREATE FUNCTION platform.student_portal_case_files_v1"), sql.indexOf("CREATE FUNCTION platform.student_portal_case_file_target_v1"));
  assert.equal(/sha256|storage_object_name|payment_event_id|amount|membership/i.test(files), false);
  assert.match(files, /superseded_at IS NULL/);
  assert.match(files, /allocated_at IS NULL/);
  const record = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION platform.record_pending_receipt_v1"), sql.indexOf("-- 2) Студент читает"));
  assert.match(record, /'document\.manage', 'student_case'/);
  assert.equal(/case\.update\.append/.test(record.replace(/--[^\n]*/g, "")), false);
});
