import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  accountDeletionDaysLeft,
  parseAccountDeletionDetail,
  parseAccountDeletionProcessed,
  parseAccountDeletionQueue,
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
    counts: { delete: { documents: 2 }, anonymize: { cases: 1 }, remain: { whatsappChats: 0 } },
  };
  assert.deepEqual(parseAccountDeletionDetail(detail)?.counts, {
    delete: { documents: 2 }, anonymize: { cases: 1 }, remain: { whatsappChats: 0 }, deleted: null,
  });
  assert.equal(parseAccountDeletionDetail({ ...detail, counts: { delete: { documents: -1 }, anonymize: {}, remain: {} } }), null);
});

test("processing result refuses path tricks in Storage keys", () => {
  const ok = { id: ID, status: "processing", authUserId: ID, email: "a@b.cd", storageObjects: [{ bucket: "platform-documents", name: "a1/bb" }], summary: {} };
  assert.equal(parseAccountDeletionProcessed(ok)?.storageObjects.length, 1);
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

function fakes({ processed, removeError = null, deleteError = null, completeError = null }) {
  const log = [];
  const session = {
    schema: () => ({
      rpc: async (name, args) => {
        log.push(["rpc", name, args]);
        if (name === "process_account_deletion_v1") return { data: processed, error: null };
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
    summary: {},
  };
  const ok = fakes({ processed });
  assert.deepEqual(await runAccountDeletion(ID, OWN.requestedAt, ok.services), { status: "completed", emailStatus: "not_configured" });
  assert.deepEqual(ok.log.map((entry) => entry[0] === "rpc" ? entry[1] : entry[0]), [
    "process_account_deletion_v1", "remove", "deleteUser", "complete_account_deletion_v1",
  ]);
  assert.deepEqual(ok.log[1], ["remove", "platform-documents", ["a1/x", "a1/y"]]);
  assert.deepEqual(ok.log[3][2], { p_id: ID, p_confirmation_email_status: "not_configured" });

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
  for (const page of ["src/app/apply/status/page.tsx", "src/app/apply/page.tsx", "src/app/auth/account-pending/page.tsx",
    "src/app/(portal)/portal/profile/page.tsx"]) {
    assert.match(source(page), /<AccountDeletionPanel/u, page);
  }
  // Service role only on the server and only for Storage and Auth Admin.
  const processor = source("src/lib/server/account-deletion-processor.ts");
  assert.match(processor, /^import "server-only";/u);
  assert.doesNotMatch(processor, /service\.schema|service\.rpc|service\.from\(/u);
});
