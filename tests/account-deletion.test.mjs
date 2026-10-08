import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCOUNT_DELETED_NOTICE,
  ACCOUNT_DELETED_PATH,
  accountDeletionDaysLeft,
  isDeletedAuthUserError,
  parseAccountDeletionDetail,
  parseAccountDeletionProcessed,
  parseAccountDeletionQueue,
  parseAccountDeletionReviewDecision,
  parseOwnAccountDeletion,
} from "../src/lib/account-deletion-contract.ts";
import { accountDeletionMailText, sendAccountDeletionMail } from "../src/lib/server/account-deletion-mail.ts";
import { runAccountDeletion } from "../src/lib/server/account-deletion-processor.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ID = "27900000-0000-4000-8000-000000000001";
const OWN = {
  requestId: "27900000-0000-4000-8000-000000001001",
  status: "requested",
  requestedAt: "2026-10-07T10:00:00+00:00",
  dueAt: "2026-11-06T10:00:00+00:00",
};
const ROW = {
  id: ID,
  kind: "student",
  status: "requested",
  displayName: "Зарина Удалёва",
  email: "zarina@example.invalid",
  studentCaseId: "27900000-0000-4000-8000-000000000501",
  requestedAt: OWN.requestedAt,
  dueAt: OWN.dueAt,
  overdue: false,
  processingStartedAt: null,
  completedAt: null,
  confirmationEmailStatus: null,
};

// Миграция 279: разбор строгий, дрейф формы не превращается в выдуманное состояние.
test("own deletion request: null means none, a drifted shape is an error", () => {
  assert.equal(parseOwnAccountDeletion(null), null);
  assert.deepEqual(parseOwnAccountDeletion(OWN), OWN);
  assert.deepEqual(parseOwnAccountDeletion({ ...OWN, status: "processing" }), { ...OWN, status: "processing" });
  for (const broken of [{}, [], { ...OWN, status: "completed" }, { ...OWN, extra: 1 }, { ...OWN, dueAt: "soon" }]) {
    assert.equal(parseOwnAccountDeletion(broken), undefined, JSON.stringify(broken));
  }
});

test("staff queue and detail parse strictly", () => {
  assert.deepEqual(parseAccountDeletionQueue([ROW, { ...ROW, kind: "applicant", studentCaseId: null, email: null }]), [
    ROW, { ...ROW, kind: "applicant", studentCaseId: null, email: null },
  ]);
  for (const broken of [null, {}, [{ ...ROW, status: "acknowledged" }], [{ ...ROW, displayName: " " }], [{ ...ROW, overdue: "no" }]]) {
    assert.equal(parseAccountDeletionQueue(broken), null, JSON.stringify(broken));
  }
  const detail = {
    ...ROW,
    processingStartedBy: null,
    completedBy: null,
    pendingFiles: 0,
    authAccountExists: true,
    counts: { delete: { documents: 2, whatsappChats: 1 }, anonymize: { cases: 1 }, remain: { amocrmContacts: 1 } },
    amocrmContacts: 1,
    amocrm: { contactIds: ["5551"], leadIds: [], dispatchedCommands: 0 },
    review: [],
    reviewOpen: 0,
  };
  assert.deepEqual(parseAccountDeletionDetail(detail)?.counts, {
    delete: { documents: 2, whatsappChats: 1 }, anonymize: { cases: 1 }, remain: { amocrmContacts: 1 }, deleted: null,
  });
  assert.equal(parseAccountDeletionDetail(detail)?.amocrmContacts, 1);
  assert.deepEqual(parseAccountDeletionDetail(detail)?.amocrm, { contactIds: ["5551"], leadIds: [], dispatchedCommands: 0 });
  assert.equal(parseAccountDeletionDetail({ ...detail, counts: { delete: { documents: -1 }, anonymize: {}, remain: {} } }), null);
  for (const key of ["amocrmContacts", "amocrm", "review", "reviewOpen"]) {
    const broken = { ...detail };
    delete broken[key];
    assert.equal(parseAccountDeletionDetail(broken), null, `${key} is part of the detail`);
  }
  assert.equal(parseAccountDeletionDetail({ ...detail, amocrm: { contactIds: ["Зарина"], leadIds: [], dispatchedCommands: 0 } }),
    null, "amoCRM numbers are digits only");
});

// Дополнение к 279 (08.10): «Проверить вручную», строгий разбор каждой записи.
test("review list: each item parses strictly, an unknown kind, reason or fact is an error", () => {
  const item = {
    kind: "chat", id: ID, reasons: ["phone"], exists: true, title: "WhatsApp +996 ••• 27 92 79",
    facts: { messages: 3, lastMessageAt: OWN.requestedAt, caseId: null, caseName: null, leadId: ROW.studentCaseId },
    canErase: true, decision: null, decidedAt: null, decidedBy: null,
    amocrm: { contactIds: ["279"], leadIds: ["279"], dispatchedCommands: 0 },
  };
  const base = {
    ...ROW, processingStartedBy: null, completedBy: null, pendingFiles: 0, authAccountExists: true,
    counts: { delete: {}, anonymize: {}, remain: {} }, amocrmContacts: 0,
    amocrm: { contactIds: [], leadIds: [], dispatchedCommands: 0 }, reviewOpen: 1,
  };
  const parsed = parseAccountDeletionDetail({ ...base, review: [item, {
    ...item, kind: "case", reasons: ["shared"], facts: { state: "pending", hasAccount: false }, canErase: true,
    decision: "not_subject", decidedAt: OWN.requestedAt, decidedBy: "P279 Admin",
  }] });
  assert.equal(parsed?.review.length, 2);
  assert.equal(parsed?.review[0].facts.messages, 3);
  assert.equal(parsed?.review[1].decision, "not_subject");
  assert.equal(parsed?.reviewOpen, 1);
  for (const broken of [
    { ...item, kind: "message" }, { ...item, reasons: [] }, { ...item, reasons: ["name"] }, { ...item, facts: { phone: "+996" } },
    { ...item, facts: { messages: -1 } }, { ...item, decision: "deleted" }, { ...item, id: "x" },
    { ...item, amocrm: { contactIds: [], leadIds: [] } },
  ]) {
    assert.equal(parseAccountDeletionDetail({ ...base, review: [broken] }), null, JSON.stringify(broken));
  }
  assert.deepEqual(parseAccountDeletionReviewDecision({ kind: "lead", id: ID, decision: "erased", decidedAt: OWN.requestedAt }),
    { kind: "lead", id: ID, decision: "erased" });
  assert.equal(parseAccountDeletionReviewDecision({ kind: "lead", id: ID, decision: "kept", decidedAt: OWN.requestedAt }), null);
});

test("processing result refuses path tricks in Storage keys", () => {
  const ok = { id: ID, status: "processing", authUserId: ID, email: "a@b.cd", storageObjects: [{ bucket: "platform-documents", name: "a1/bb" }], amocrmContacts: 0, summary: {} };
  assert.equal(parseAccountDeletionProcessed(ok)?.storageObjects.length, 1);
  assert.equal(parseAccountDeletionProcessed(ok)?.amocrmContacts, 0);
  assert.equal(parseAccountDeletionProcessed({ ...ok, amocrmContacts: 2 })?.amocrmContacts, 2);
  assert.equal(parseAccountDeletionProcessed({ ...ok, amocrmContacts: "2" }), null);
  const withoutCount = { ...ok };
  delete withoutCount.amocrmContacts;
  assert.equal(parseAccountDeletionProcessed(withoutCount), null, "an open request always names its amoCRM links");
  assert.equal(parseAccountDeletionProcessed({ ...withoutCount, status: "completed", authUserId: null, email: null,
    storageObjects: [] })?.amocrmContacts, 0);
  assert.equal(parseAccountDeletionProcessed({ ...ok, storageObjects: [{ bucket: "platform-documents", name: "../x" }] }), null);
  assert.equal(parseAccountDeletionProcessed({ ...ok, authUserId: "nope" }), null);
});

test("days left: calendar days in Bishkek, due date in the past is negative", () => {
  assert.equal(accountDeletionDaysLeft("2026-11-06T10:00:00Z", new Date("2026-10-07T10:00:00Z")), 30);
  // Запрос в 19:26 UTC (уже 08.10 в Бишкеке) через минуту: всё ещё 30, не 29.
  assert.equal(accountDeletionDaysLeft("2026-11-06T19:26:27Z", new Date("2026-10-07T19:35:00Z")), 30);
  assert.equal(accountDeletionDaysLeft("2026-11-06T19:26:27Z", new Date("2026-11-06T19:00:00Z")), 0);
  assert.ok(accountDeletionDaysLeft("2026-10-01T10:00:00Z", new Date("2026-10-07T10:00:00Z")) < 0);
});

// Письмо: двуязычное, без тире, номер запроса; транспорт только по настройке.
test("confirmation mail: text, transports and honest statuses", async () => {
  const { subject, text } = accountDeletionMailText({ to: "a@b.cd", requestId: ID, requestedAt: OWN.requestedAt });
  assert.match(subject, /аккаунт удалён/u);
  assert.match(text, /Номер запроса: 27900000\./u);
  assert.match(text, /Сурамдын номери/u);
  assert.doesNotMatch(text, /[–—]/u);
  // Exactly what is deleted and kept (addendum 08.10): the bound WhatsApp
  // correspondence, the reviewed records, other people's records, backups.
  assert.match(text, /переписка WhatsApp, связанная только с вашей заявкой/u);
  assert.match(text, /переписку WhatsApp, связанную также с другими людьми, сотрудник проверил вручную/u);
  assert.match(text, /сотрудник проверил вручную/u);
  assert.match(text, /Записи других людей менялись только решением сотрудника\./u);
  assert.match(text, /Из журнала действий по вашим записям убраны ваше имя, телефон, email и номер документа\./u);
  assert.doesNotMatch(text, /не менялись|привязанная к вашей заявке/u);
  assert.match(text, /арызыңызга гана байланышкан WhatsApp/u);
  assert.match(text, /Резервные копии базы этим действием не изменяются\./u);
  assert.match(text, /камдык көчүрмөлөрү/u);

  assert.equal(await sendAccountDeletionMail({ to: null, requestId: ID, requestedAt: null }, {}), "no_address");
  assert.equal(await sendAccountDeletionMail({ to: "a@b.cd", requestId: ID, requestedAt: null }, {}), "not_configured");
  assert.equal(await sendAccountDeletionMail({ to: "a@b.cd", requestId: ID, requestedAt: null },
    { EVO_ACCOUNT_MAIL_TRANSPORT: "mailpit", EVO_MAILPIT_URL: "https://mail.example.com" }), "not_configured",
  "Mailpit only on loopback");

  const calls = [];
  const fakeFetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response("{}", { status: 200 }); };
  assert.equal(await sendAccountDeletionMail({ to: "a@b.cd", requestId: ID, requestedAt: null },
    { EVO_ACCOUNT_MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_testkey12345" }, fakeFetch), "sent");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers["idempotency-key"], `account-deletion:${ID}`);
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ["a@b.cd"]);
  const failing = async () => new Response("no", { status: 500 });
  assert.equal(await sendAccountDeletionMail({ to: "a@b.cd", requestId: ID, requestedAt: null },
    { EVO_ACCOUNT_MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_testkey12345" }, failing), "failed");
});

function fakes({ processed, processError = null, removeError = null, deleteError = null, completeError = null }) {
  const log = [];
  const session = {
    schema: () => ({
      rpc: async (name, args) => {
        log.push(["rpc", name, args]);
        if (name === "process_account_deletion_v1") return processError ? { data: null, error: processError } : { data: processed, error: null };
        return { data: { status: "completed" }, error: completeError };
      },
    }),
  };
  const service = {
    storage: { from: (bucket) => ({ remove: async (names) => { log.push(["remove", bucket, names]); return { error: removeError }; } }) },
    auth: { admin: { deleteUser: async (id) => { log.push(["deleteUser", id]); return { error: deleteError }; } } },
  };
  return { log, services: { session, service: () => service, sendMail: async () => "not_configured" } };
}

// Порядок шагов: база, файлы, вход, письмо, подтверждение базы; сбой — шаг.
test("processor: database, files, Auth user, mail, completion; a failure names its step", async () => {
  const processed = {
    id: ID, status: "processing", authUserId: OWN.requestId, email: "a@b.cd",
    storageObjects: [{ bucket: "platform-documents", name: "a1/x" }, { bucket: "platform-documents", name: "a1/y" }],
    amocrmContacts: 0,
    summary: {},
  };
  const ok = fakes({ processed });
  assert.deepEqual(await runAccountDeletion(ID, OWN.requestedAt, ok.services), { status: "completed", emailStatus: "not_configured" });
  assert.deepEqual(ok.log.map((entry) => entry[0] === "rpc" ? entry[1] : entry[0]), [
    "process_account_deletion_v1", "remove", "deleteUser", "complete_account_deletion_v1",
  ]);
  assert.deepEqual(ok.log[1], ["remove", "platform-documents", ["a1/x", "a1/y"]]);
  assert.deepEqual(ok.log[3][2], { p_id: ID, p_confirmation_email_status: "not_configured", p_amocrm_erased: false });

  // amoCRM links: without the Admin's confirmation nothing past the database step runs.
  // An open item of «Проверить вручную»: the database refuses, nothing else runs.
  const review = fakes({ processed, processError: { code: "55000", message: "account_deletion_review_unresolved" } });
  assert.deepEqual(await runAccountDeletion(ID, null, review.services), { status: "failed", step: "review" });
  assert.equal(review.log.length, 1);
  const reviewLate = fakes({ processed, completeError: { code: "55000", message: "account_deletion_review_unresolved" } });
  assert.deepEqual(await runAccountDeletion(ID, null, reviewLate.services), { status: "failed", step: "review" });

  const linked = { ...processed, amocrmContacts: 1 };
  const unconfirmed = fakes({ processed: linked });
  assert.deepEqual(await runAccountDeletion(ID, null, unconfirmed.services), { status: "failed", step: "amocrm" });
  assert.deepEqual(unconfirmed.log.map((entry) => entry[0] === "rpc" ? entry[1] : entry[0]), ["process_account_deletion_v1"]);
  const confirmed = fakes({ processed: linked });
  assert.equal((await runAccountDeletion(ID, null, confirmed.services, true)).status, "completed");
  assert.equal(confirmed.log.at(-1)[2].p_amocrm_erased, true);

  const storage = fakes({ processed, removeError: { message: "x" } });
  assert.deepEqual(await runAccountDeletion(ID, null, storage.services), { status: "failed", step: "storage" });
  assert.ok(!storage.log.some((entry) => entry[0] === "deleteUser"), "the Auth user stays until the files are gone");

  const missingUser = fakes({ processed, deleteError: { status: 404, code: "user_not_found" } });
  assert.equal((await runAccountDeletion(ID, null, missingUser.services)).status, "completed", "an already deleted user is not an error");

  const auth = fakes({ processed, deleteError: { status: 500 } });
  assert.deepEqual(await runAccountDeletion(ID, null, auth.services), { status: "failed", step: "auth" });

  const complete = fakes({ processed, completeError: { code: "55000" } });
  assert.deepEqual(await runAccountDeletion(ID, null, complete.services), { status: "failed", step: "complete" });

  const done = fakes({ processed: { ...processed, status: "completed", authUserId: null, email: null, storageObjects: [] } });
  assert.deepEqual(await runAccountDeletion(ID, null, done.services), { status: "completed", emailStatus: null });
  assert.equal(done.log.length, 1, "a completed request does nothing again");
});

test("wiring: settings section, applicant screens and service-role use stay where they belong", () => {
  const settings = source("src/components/v3/settings/types.ts");
  assert.match(settings, /\{ key: "deletion", view: null, title: "Запросы на удаление" \}/u);
  const action = source("src/lib/account-deletion/staff-actions.ts");
  assert.match(action, /^"use server";/u);
  assert.match(action, /isStaffPreview\(actor\)/u, "the role preview never deletes");
  assert.match(action, /ACCOUNT_DELETION_CONFIRM_WORD/u);
  assert.match(action, /"amocrm_erased"/u, "the amoCRM confirmation travels with the form");
  // «Проверить вручную»: one narrow decision per item, the same preview guard.
  assert.match(action, /export async function resolveAccountDeletionCandidateAction/u);
  assert.match(action, /rpc\("resolve_account_deletion_candidate_v1"/u);
  assert.equal(action.match(/isStaffPreview\(actor\)/gu)?.length, 2, "neither action runs in the role preview");
  const section = source("src/components/v3/settings/AccountDeletionSection.tsx");
  assert.match(section, /<AccountDeletionReview /u);
  const review = source("src/components/v3/settings/AccountDeletionReview.tsx");
  for (const word of ["Удалить этот чат", "Обезличить этого лида", "Обезличить этого клиента", "Не этот человек",
    "Проверить вручную"]) {
    assert.match(review, new RegExp(word, "u"), word);
  }
  assert.doesNotMatch(review, /[–—]/u);
  const processForm = source("src/components/v3/settings/AccountDeletionProcess.tsx");
  assert.match(processForm, /disabled=\{reviewOpen > 0\}/u, "the account cannot be deleted while an item is open");
  for (const page of ["src/app/apply/status/page.tsx", "src/app/apply/page.tsx", "src/app/auth/account-pending/page.tsx",
    "src/app/(portal)/portal/profile/page.tsx"]) {
    assert.match(source(page), /<AccountDeletionPanel/u, page);
  }
  // Service role only on the server and only for Storage and Auth Admin.
  const processor = source("src/lib/server/account-deletion-processor.ts");
  assert.match(processor, /^import "server-only";/u);
  assert.doesNotMatch(processor, /service\.schema|service\.rpc|service\.from\(/u);
});

// Ревью 279, п. 4: старая сессия удалённого аккаунта ведёт на вход с «Аккаунт удалён».
test("deleted account session: user_not_found, sign-out route, proxy and screens", () => {
  assert.equal(isDeletedAuthUserError({ code: "user_not_found", status: 403 }), true);
  for (const other of [null, undefined, {}, { code: "session_not_found" }, { name: "AuthSessionMissingError" }, "user_not_found"]) {
    assert.equal(isDeletedAuthUserError(other), false, JSON.stringify(other));
  }
  assert.equal(ACCOUNT_DELETED_PATH, "/auth/account-deleted");
  const route = source("src/app/auth/account-deleted/route.ts");
  assert.match(route, /export async function GET/u);
  assert.doesNotMatch(route, /export async function (POST|PUT|DELETE|PATCH)/u);
  assert.match(route, /sessionAccountDeleted\(client\)/u, "only a user Auth no longer knows is signed out");
  assert.match(route, /signOut\(\{ scope: "local" \}\)/u);
  assert.match(route, /notice=\$\{ACCOUNT_DELETED_NOTICE\}/u);
  assert.equal(ACCOUNT_DELETED_NOTICE, "account_deleted");
  const proxy = source("src/proxy.ts");
  assert.ok(proxy.indexOf("path === ACCOUNT_DELETED_PATH") < proxy.indexOf("await liveSessionState(request, requestHeaders);"),
    "the sign-out route opens before the session gate");
  assert.match(proxy, /accountDeleted: isDeletedAuthUserError\(error\)/u);
  for (const page of ["src/app/apply/page.tsx", "src/app/apply/status/page.tsx"]) {
    assert.match(source(page), /if \(isDeletedAuthUserError\(error\)\) redirect\(ACCOUNT_DELETED_PATH\);/u, page);
  }
  assert.match(source("src/app/auth/account-pending/page.tsx"),
    /catch \(error\) \{\n    if \(await sessionAccountDeleted\(\)\) redirect\(ACCOUNT_DELETED_PATH\);\n    throw error;/u);
  const login = source("src/app/login/page.tsx");
  assert.match(login, /accountDeleted: "Аккаунт удалён\."/u);
  assert.match(login, /accountDeleted: "Аккаунт өчүрүлдү\."/u);
  assert.match(login, /role="status"/u);
});
