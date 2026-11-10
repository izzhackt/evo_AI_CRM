// «Чеки от студента и реквизиты для оплаты» (решение владельца 10.11.2026, миграция 358). Сторону базы (права, идемпотентность, оплата через
// record_case_payment_v1, итоги, журнал, только добавление) доказывает supabase/tests/platform_student_payment_receipts.sql; здесь - строгие
// разборщики, правила суммы, проводка маршрутов и прокси, слова словаря (RU и KY) и устройство обработчиков.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PAYMENT_RECEIPT_ERROR_KEYS,
  minorToReceiptInput,
  parsePaymentCenter,
  paymentReceiptErrorKey,
  receiptAmountToMinor,
} from "../src/lib/portal/payment-center.ts";
import { getPortalStrings } from "../src/lib/portal/i18n.ts";
import { isConnectedPlatformApi, isConnectedStudentPortalApi } from "../src/lib/platform-route-contract.ts";
import { decodeStaffNotifications } from "../src/lib/platform-staff-notifications-contract.ts";
import { parsePaymentDetailsAdmin, parseStudentReceiptQueue } from "../src/lib/platform-student-receipts-contract.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const A = "35800000-0000-4000-8000-000000000001";
const B = "35800000-0000-4000-8000-000000000002";
const C = "35800000-0000-4000-8000-000000000003";
const entry = (over = {}) => ({
  kind: "receipt", entry_id: B, status: "review", amount_minor: 10050, currency: "USD", on_date: "2026-11-10", reject_reason: null,
  file_kind: "student_receipt", file_id: B, filename: "check.png", ...over,
});
const due = (over = {}) => ({
  obligation_id: A, label: "Первый платёж", category: "evo_service_fee", amount_minor: 100000, paid_minor: 40000, refunded_minor: 0, outstanding_minor: 60000,
  currency: "USD", due_at: "2027-01-20T00:00:00+00:00", derived_status: "partially_paid", overdue: false, next_action: null, entries: [entry()], ...over,
});
const center = (over = {}) => ({ details: null, dues: [due()], unassigned: [], can_upload: true, ...over });

test("the payment center parses a closed shape and rejects anything else", () => {
  const parsed = parsePaymentCenter(center({ details: { text: "IBAN", has_qr: true, qr_id: C, updated_at: "2026-11-10T09:00:00+00:00" } }));
  assert.ok(parsed);
  assert.equal(parsed.dues[0].entries[0].status, "review");
  assert.equal(parsed.details.qrId, C);
  const bad = [
    { ...center(), extra: 1 },
    center({ dues: [due({ outstanding_minor: 1 })] }),
    center({ dues: [due({ entries: [entry({ status: "rejected" })] })] }),
    center({ dues: [due({ entries: [entry({ status: "review", reject_reason: "x" })] })] }),
    center({ dues: [due({ entries: [entry({ file_id: null })] })] }),
    center({ dues: [due({ entries: [entry({ file_kind: "passport" })] })] }),
    center({ dues: [due({ derived_status: "weird" })] }),
    center({ dues: [due(), due()] }),
    center({ details: { text: "x", has_qr: true, qr_id: null, updated_at: "2026-11-10T09:00:00+00:00" } }),
    center({ can_upload: "yes" }),
    center({ unassigned: [entry({ amount_minor: 0 })] }),
    null,
    [],
  ];
  for (const value of bad) assert.equal(parsePaymentCenter(value), null);
  const rejected = parsePaymentCenter(center({ dues: [due({ entries: [entry({ status: "rejected", reject_reason: "Не видно сумму" })] })] }));
  assert.equal(rejected.dues[0].entries[0].rejectReason, "Не видно сумму");
});

test("odd text from the database never breaks a Student page: control characters are stripped, long text is cut, file names fall back", () => {
  const odd = parsePaymentCenter(center({
    details: { text: "IBAN\u0007 0000\nline2\tok", has_qr: false, qr_id: null, updated_at: "2026-11-10T09:00:00+00:00" },
    dues: [due({ label: "Платёж\u001b" + "я".repeat(400), next_action: "Шаг\u0000", entries: [
      entry({ filename: "\u0007\u0007", file_id: B }),
      entry({ entry_id: C, status: "rejected", reject_reason: "Причина\u0001\nвторая строка", filename: "я".repeat(400) }),
    ] })],
  }));
  assert.ok(odd);
  assert.equal(odd.details.text, "IBAN 0000\nline2\tok");
  assert.equal(Array.from(odd.dues[0].label).length, 300);
  assert.doesNotMatch(odd.dues[0].label, /[\u0000-\u001f]/);
  assert.equal(odd.dues[0].nextAction, "Шаг");
  assert.equal(odd.dues[0].entries[0].filename, "file");
  assert.equal(odd.dues[0].entries[1].rejectReason, "Причина\nвторая строка");
  assert.equal(Array.from(odd.dues[0].entries[1].filename).length, 255);
});

test("a long student name or label in the staff queue is cut for display, not refused", () => {
  const receipt = {
    receipt_id: A, student_case_id: B, student_display_name: "Я".repeat(500), payment_obligation_id: null, payment_label: "п".repeat(900), amount_minor: "1", currency: "USD",
    paid_on: "2026-11-10", original_filename: "f\u0007.png", submitted_at: "2026-11-10T09:05:39+00:00", status: "pending", reject_reason: null, reviewed_at: null,
    can_review: true, dues: [{ payment_obligation_id: C, label: "д".repeat(900), currency: "USD", outstanding_minor: "1" }],
  };
  const queue = parseStudentReceiptQueue({ organization_id: C, total: 1, receipts: [receipt] }, C);
  assert.equal(Array.from(queue.receipts[0].studentDisplayName).length, 300);
  assert.equal(Array.from(queue.receipts[0].paymentLabel).length, 500);
  assert.equal(queue.receipts[0].originalFilename, "f.png");
});

test("the upload and details routes clean file names and details text, and map the duplicate race", () => {
  const source = read("../src/lib/server/student-payment-receipts-route-handlers.ts");
  assert.match(source, /cleanReceiptFilename\(upload\.originalFilename\)/);
  assert.match(source, /cleanPaymentDetailsText\(body\)/);
  assert.match(source, /receipt_duplicate/);
  const sql = read("../supabase/migrations/358_platform_student_payment_receipts.sql");
  assert.match(sql, /EXCEPTION WHEN unique_violation/);
  assert.match(sql, /regexp_replace\(p_original_filename/);
  assert.match(sql, /body ~ E'\[/);
});

test("the Student is told about the decision in RU and KY, and the accept command can create the payment", () => {
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("admission", locale);
    assert.match(strings.receiptNotifAccepted, /\{value\}/);
    assert.match(strings.receiptNotifRejected, /\{value\}/);
  }
  assert.equal(getPortalStrings("admission", "ru").receiptNotifAccepted, "Чек принят: {value}");
  assert.equal(getPortalStrings("admission", "ru").receiptNotifRejected, "Чек отклонён: {value}");
  const sql = read("../supabase/migrations/358_platform_student_payment_receipts.sql");
  assert.match(sql, /p_new_due_label TEXT DEFAULT NULL/);
  assert.match(sql, /platform\.save_case_tranche_v1\(p_organization_id, platform_private\.p3c_request_child_id\(p_request_id, 'due'\)/);
  assert.match(sql, /own_payment_receipt_notifications/);
  const action = read("../src/lib/platform-student-receipts-actions.ts");
  assert.match(action, /new_due_label/);
});

test("the amount rules: two decimals, no zero, comma or point, minor units back to an input value", () => {
  assert.equal(receiptAmountToMinor("100.50"), "10050");
  assert.equal(receiptAmountToMinor("1 000,5"), "100050");
  assert.equal(receiptAmountToMinor("250"), "25000");
  for (const bad of ["", "0", "0.00", "abc", "1.234", "-5", "1e3", "99999999999999999"]) assert.equal(receiptAmountToMinor(bad), null, bad);
  assert.equal(minorToReceiptInput(10050), "100.50");
  assert.equal(minorToReceiptInput(100000), "1000");
  assert.equal(minorToReceiptInput(5), "0.05");
});

test("every server error code of the upload route maps to a dictionary key that exists in RU and KY", () => {
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("admission", locale);
    for (const key of new Set([...Object.values(PAYMENT_RECEIPT_ERROR_KEYS), "receiptErrorUnavailable"])) {
      assert.equal(typeof strings[key], "string", `${locale}:${key}`);
      assert.ok(strings[key].length > 5);
    }
  }
  assert.equal(paymentReceiptErrorKey("receipt_duplicate"), "receiptErrorDuplicate");
  assert.equal(paymentReceiptErrorKey("nope"), "receiptErrorUnavailable");
  assert.equal(paymentReceiptErrorKey(undefined), "receiptErrorUnavailable");
});

test("student words: «Платежи» replaced «Начисления», the empty state sends the Student to the curator", () => {
  const ru = getPortalStrings("admission", "ru");
  const ky = getPortalStrings("admission", "ky");
  assert.equal(ru.paymentsHeading, "Платежи");
  assert.equal(ru.paymentsEmptyBody, "Если вам сказали оплатить, напишите куратору.");
  assert.equal(ru.paymentsWriteCurator, "Написать куратору");
  assert.equal(ru.receiptStatusReview, "На проверке");
  assert.equal(ru.receiptStatusAccepted, "Принято");
  assert.equal(ru.receiptStatusRejected, "Отклонено");
  for (const strings of [ru, ky]) for (const value of Object.values(strings)) assert.doesNotMatch(String(value), /[Нн]ачислен|[Ээ]септөө/);
  assert.notEqual(ky.paymentsHeading, ru.paymentsHeading);
});

test("route contract: Student upload is one connected POST, staff receipt download and the details routes are connected platform APIs", () => {
  assert.equal(isConnectedStudentPortalApi("/api/portal/payment-receipts", "POST"), true);
  assert.equal(isConnectedStudentPortalApi("/api/portal/payment-receipts", "GET"), false);
  assert.equal(isConnectedStudentPortalApi("/api/portal/payment-receipts/x", "POST"), false);
  assert.equal(isConnectedPlatformApi(`/api/v2/student-payment-receipts/${A}/download`), true);
  assert.equal(isConnectedPlatformApi("/api/v2/student-payment-receipts/not-a-uuid/download"), false);
  assert.equal(isConnectedPlatformApi("/api/v3/settings/payment-details"), true);
  assert.equal(isConnectedPlatformApi("/api/v3/settings/payment-details/qr"), true);
  assert.equal(isConnectedPlatformApi("/api/v3/settings/payment-details/other"), false);
  for (const kind of ["student_receipt", "payment_details_qr"]) {
    assert.equal(isConnectedStudentPortalApi(`/api/portal/case-files/${kind}/${A}/download`, "GET"), true, kind);
  }
});

test("the staff queue parser is exact and tied to the organization", () => {
  const receipt = {
    receipt_id: A, student_case_id: B, student_display_name: "Тест", payment_obligation_id: null, payment_label: null, amount_minor: "25000", currency: "USD",
    paid_on: "2026-11-10", original_filename: "check.png", submitted_at: "2026-11-10T09:05:39+00:00", status: "pending", reject_reason: null, reviewed_at: null,
    can_review: true, dues: [{ payment_obligation_id: C, label: "Платёж", currency: "USD", outstanding_minor: "60000" }],
  };
  const queue = parseStudentReceiptQueue({ organization_id: C, status: "pending", total: 1, receipts: [receipt] }, C);
  assert.equal(queue.receipts[0].amountMinor, "25000");
  assert.equal(queue.receipts[0].dues[0].id, C);
  assert.throws(() => parseStudentReceiptQueue({ organization_id: A, total: 1, receipts: [receipt] }, C));
  assert.throws(() => parseStudentReceiptQueue({ organization_id: C, total: 1, receipts: [{ ...receipt, status: "weird" }] }, C));
  assert.throws(() => parseStudentReceiptQueue({ organization_id: C, total: 2, receipts: [receipt, receipt] }, C));
  const details = parsePaymentDetailsAdmin({ organization_id: C, version_no: 0, text: "", has_qr: false, qr_id: null, qr_filename: null, updated_at: null, updated_by_display_name: null }, C);
  assert.equal(details.versionNo, 0);
  assert.throws(() => parsePaymentDetailsAdmin({ organization_id: A, version_no: 0, text: "", has_qr: false }, C));
});

test("a student_receipt staff notification links to the money tab of the case", () => {
  const page = decodeStaffNotifications({ unread_count: "1", items: [{
    id: A, kind: "student_receipt", created_at: "2026-11-10T09:00:00+00:00", read_at: null, student_case_id: B, actor_display_name: "Студент", student_display_name: "Тест Студент",
  }] });
  assert.equal(page.items[0].kind, "student_receipt");
  assert.equal(page.items[0].href, `/profile?case=${B}&tab=money#case-receipts`);
  assert.throws(() => decodeStaffNotifications({ unread_count: "1", items: [{ id: A, kind: "student_receipt", created_at: "2026-11-10T09:00:00+00:00", read_at: null }] }));
});

test("the upload handler authorizes through the database before any bytes are stored and cleans up after a failed record", () => {
  const source = read("../src/lib/server/student-payment-receipts-route-handlers.ts");
  const upload = source.slice(source.indexOf("createStudentPaymentReceiptUploadHandler"), source.indexOf("createStaffStudentReceiptDownloadHandler"));
  assert.ok(upload.indexOf("student_payment_receipt_target_v1") < upload.indexOf("scanOrRespond"), "target check before the scan");
  assert.ok(upload.indexOf("scanOrRespond") < upload.indexOf(".upload(objectName"), "the scan before the storage write");
  assert.ok(upload.indexOf(".upload(objectName") < upload.indexOf("record_student_payment_receipt_v1"), "the record after the storage write");
  assert.match(upload, /Idempotency-Key/);
  assert.match(upload, /sameOrigin\(request\)/, "cookie transport needs the same Origin");
  assert.match(upload, /\.remove\(\[objectName\]\)/, "an orphaned object is removed");
  assert.match(upload, /resolveStudentPortalActor/);
  assert.match(upload, /resolveStudentPortalBearerActor/);
  assert.doesNotMatch(upload, /p_membership_id|membership_id:\s*request/, "the membership never comes from the client");
  assert.match(source, /staff_payment_details_v1/, "the admin gate is the database");
  assert.match(source, /isStaffPreview/);
});

test("the three routes are wired to their handlers", () => {
  assert.match(read("../src/app/api/portal/payment-receipts/route.ts"), /createStudentPaymentReceiptUploadHandler\(\)/);
  assert.match(read("../src/app/api/v2/student-payment-receipts/[receiptId]/download/route.ts"), /createStaffStudentReceiptDownloadHandler\(\)/);
  assert.match(read("../src/app/api/v3/settings/payment-details/route.ts"), /createPaymentDetailsSaveHandler\(\)/);
  assert.match(read("../src/app/api/v3/settings/payment-details/qr/route.ts"), /createPaymentDetailsQrHandler\(\)/);
});

test("the Student case-file door resolves a Student session in the browser (the staff resolver refused Students)", () => {
  const handler = read("../src/lib/server/platform-case-agreement-storage-route-handlers.ts");
  const student = handler.slice(handler.indexOf("createStudentPortalCaseFileDownloadHandler"));
  assert.match(student, /resolveStudentPortalActor/);
  assert.doesNotMatch(student, /resolvePlatformActor/);
});

test("the migration is a single forward step with the owner's rules in it", () => {
  const sql = read("../supabase/migrations/358_platform_student_payment_receipts.sql");
  assert.match(sql, /a358_already_applied/);
  assert.match(sql, /student_payment_receipts_no_delete/);
  assert.match(sql, /record_case_payment_v1\(p_organization_id, platform_private\.p3c_request_child_id/);
  assert.match(sql, /receipt_staff_can_review/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /DELETE FROM platform\.(payment_events|payment_obligations)/);
  assert.doesNotMatch(sql, /UPDATE platform\.payment_obligations/, "totals only change inside record_case_payment_v1");
});
