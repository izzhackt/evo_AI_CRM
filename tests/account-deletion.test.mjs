import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCOUNT_DELETED_NOTICE,
  ACCOUNT_DELETED_PATH,
  accountDeletionDaysLeft,
  accountDeletionDueText,
  accountDeletionKindWord,
  checkAccountDeletionNote,
  isDeletedAuthUserError,
  normalizeAccountDeletionNote,
  parseAccountDeletionDetail,
  parseAccountDeletionOpenCount,
  parseAccountDeletionQueue,
  parseAccountDeletionStep,
  parseOwnAccountDeletion,
} from "../src/lib/account-deletion-contract.ts";
import { accountDeletionMailText, sendAccountDeletionMail } from "../src/lib/server/account-deletion-mail.ts";
import {
  markAccountDeletionDone,
  resendAccountDeletionEmail,
  runAccountDeletion,
} from "../src/lib/server/account-deletion-processor.ts";
import { getPlatformSupabaseBackendConfig } from "../src/lib/server/platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "../src/lib/server/platform-supabase-service-client.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ID = "28000000-0000-4000-8000-000000000001";
const OWN = {
  requestId: "28000000-0000-4000-8000-000000001001",
  status: "requested",
  requestedAt: "2026-10-07T10:00:00+00:00",
  dueAt: "2026-11-06T10:00:00+00:00",
};
const ROW = {
  id: ID,
  kind: "student",
  status: "requested",
  mode: "manual",
  displayName: "Зарина Удалёва",
  email: "zarina@example.invalid",
  studentCaseId: "28000000-0000-4000-8000-000000000501",
  requestedAt: OWN.requestedAt,
  dueAt: OWN.dueAt,
  overdue: false,
  processingStartedAt: null,
  completedAt: null,
  confirmationEmailStatus: null,
  applicationSubmitted: null,
};

// Миграция 280: разбор строгий, дрейф формы не превращается в выдуманное состояние.
test("own deletion request: null means none, a drifted shape is an error", () => {
  assert.equal(parseOwnAccountDeletion(null), null);
  assert.deepEqual(parseOwnAccountDeletion(OWN), OWN);
  assert.deepEqual(parseOwnAccountDeletion({ ...OWN, status: "processing" }), { ...OWN, status: "processing" });
  for (const broken of [{}, [], { ...OWN, status: "completed" }, { ...OWN, extra: 1 }, { ...OWN, dueAt: "soon" }]) {
    assert.equal(parseOwnAccountDeletion(broken), undefined, JSON.stringify(broken));
  }
});

const COUNTS = { application: 2, profile: 0, consultations: 0, favourites: 0, tests: 0, journal: 1 };
const DETAIL = {
  ...ROW,
  reasons: ["case", "lead", "client", "payment"],
  otherTables: [],
  counts: { application: 0, profile: 0, consultations: 0, favourites: 0, tests: 0, journal: 0 },
  login: "active",
  authLog: null,
  manualNote: null,
  processingStartedBy: null,
  completedBy: null,
};

// Упрощение для 1.0: режим, причины, счётчики, вход.
test("staff queue and detail parse strictly", () => {
  const applicant = { ...ROW, kind: "applicant", mode: "automatic", studentCaseId: null, email: null };
  assert.deepEqual(parseAccountDeletionQueue([ROW, applicant]), [ROW, applicant]);
  for (const broken of [null, {}, [{ ...ROW, status: "acknowledged" }], [{ ...ROW, displayName: " " }],
    [{ ...ROW, overdue: "no" }], [{ ...ROW, mode: "review" }], [{ ...ROW, mode: null }]]) {
    assert.equal(parseAccountDeletionQueue(broken), null, JSON.stringify(broken));
  }
  const parsed = parseAccountDeletionDetail(DETAIL);
  assert.deepEqual(parsed?.reasons, ["case", "lead", "client", "payment"]);
  assert.equal(parsed?.login, "active");
  const automatic = parseAccountDeletionDetail({ ...DETAIL, mode: "automatic", reasons: [], counts: COUNTS });
  assert.deepEqual(automatic?.counts, COUNTS);
  // A manual completion has no counts: an empty object reads as zeros.
  assert.equal(parseAccountDeletionDetail({ ...DETAIL, status: "completed", counts: {}, manualNote: "Сделано по списку" })
    ?.counts.application, 0);
  assert.deepEqual(parseAccountDeletionDetail({ ...DETAIL, reasons: ["other_records"], otherTables: ["public.contacts"] })
    ?.otherTables, ["public.contacts"]);
  for (const broken of [
    { ...DETAIL, reasons: ["phone"] }, { ...DETAIL, otherTables: ["contacts; drop"] }, { ...DETAIL, login: "yes" },
    { ...DETAIL, counts: { ...COUNTS, application: -1 } }, { ...DETAIL, counts: { ...COUNTS, documents: 1 } },
    { ...DETAIL, manualNote: 5 },
  ]) {
    assert.equal(parseAccountDeletionDetail(broken), null, JSON.stringify(broken));
  }
  for (const key of ["reasons", "otherTables", "counts", "login", "manualNote", "completedBy"]) {
    const broken = { ...DETAIL };
    delete broken[key];
    assert.equal(parseAccountDeletionDetail(broken), null, `${key} is part of the detail`);
  }
});

// Миграция 313: два новых ключа читаются терпимо (ответ базы до миграции их не несёт) и строго (чужое значение — ошибка).
test("migration 313 keys: applicationSubmitted and authLog are optional, strict when present", () => {
  const { applicationSubmitted: _a, ...oldRow } = ROW;
  assert.equal(parseAccountDeletionQueue([oldRow])?.[0].applicationSubmitted, null, "an old database answer reads as unknown");
  for (const value of [true, false, null]) {
    assert.equal(parseAccountDeletionQueue([{ ...ROW, kind: "applicant", applicationSubmitted: value }])?.[0].applicationSubmitted, value);
  }
  for (const broken of ["yes", 1, {}]) {
    assert.equal(parseAccountDeletionQueue([{ ...ROW, applicationSubmitted: broken }]), null, JSON.stringify(broken));
  }
  const { authLog: _b, ...oldDetail } = DETAIL;
  assert.equal(parseAccountDeletionDetail(oldDetail)?.authLog, null, "an old database answer has no authLog");
  for (const value of ["erased", "not_erased", null]) assert.equal(parseAccountDeletionDetail({ ...DETAIL, authLog: value })?.authLog, value);
  for (const broken of ["partial", true, 0]) assert.equal(parseAccountDeletionDetail({ ...DETAIL, authLog: broken }), null, JSON.stringify(broken));
});

test("open count: exactly {open, overdue}, whole numbers, overdue never above open", () => {
  assert.deepEqual(parseAccountDeletionOpenCount({ open: 3, overdue: 1 }), { open: 3, overdue: 1 });
  assert.deepEqual(parseAccountDeletionOpenCount({ open: 0, overdue: 0 }), { open: 0, overdue: 0 });
  for (const broken of [null, [], {}, { open: 1 }, { open: 1, overdue: 2 }, { open: -1, overdue: 0 }, { open: 1.5, overdue: 0 },
    { open: "1", overdue: 0 }, { open: 1, overdue: 0, email: "a@b.cd" }]) {
    assert.equal(parseAccountDeletionOpenCount(broken), null, JSON.stringify(broken));
  }
});

// UI-F4: аккаунт без одобрения называется по тому, подавал ли он анкету.
test("kind word: student, application without approval, account without an application, unknown", () => {
  assert.equal(accountDeletionKindWord("student", null), "Студент");
  assert.equal(accountDeletionKindWord("student", true), "Студент");
  assert.equal(accountDeletionKindWord("applicant", true), "Анкета без одобрения");
  assert.equal(accountDeletionKindWord("applicant", false), "Аккаунт без анкеты");
  assert.equal(accountDeletionKindWord("applicant", null), "Аккаунт без дела");
});

// UI-F3: в день срока через минуты после due_at — «срок сегодня, прошёл», а не «просрочено на 1 дн.».
test("due text: calendar days in Bishkek; the due day after the hour is not «overdue by 1 day»", () => {
  const open = (dueAt, overdue) => ({ status: "requested", dueAt, overdue, completedAt: null });
  const due = "2026-11-06T10:00:00Z"; // 16:00 в Бишкеке
  assert.deepEqual(accountDeletionDueText(open(due, false), new Date("2026-10-07T10:00:00Z")), { text: "осталось 30 дн.", tone: "neutral" });
  assert.deepEqual(accountDeletionDueText(open(due, false), new Date("2026-11-01T10:00:00Z")), { text: "осталось 5 дн.", tone: "warn" });
  assert.deepEqual(accountDeletionDueText(open(due, false), new Date("2026-11-06T08:00:00Z")), { text: "срок сегодня", tone: "warn" });
  assert.deepEqual(accountDeletionDueText(open(due, true), new Date("2026-11-06T10:05:00Z")), { text: "срок сегодня, прошёл", tone: "danger" },
    "minutes after the hour of the due day");
  assert.deepEqual(accountDeletionDueText(open(due, true), new Date("2026-11-06T17:59:00Z")), { text: "срок сегодня, прошёл", tone: "danger" },
    "still the due day in Bishkek (23:59)");
  assert.deepEqual(accountDeletionDueText(open(due, true), new Date("2026-11-06T18:01:00Z")), { text: "просрочено на 1 дн.", tone: "danger" },
    "past midnight in Bishkek it is the next day");
  assert.deepEqual(accountDeletionDueText(open(due, true), new Date("2026-11-10T10:00:00Z")), { text: "просрочено на 4 дн.", tone: "danger" });
  // Часы базы и страницы расходятся: просрочка не прячется.
  assert.deepEqual(accountDeletionDueText(open(due, true), new Date("2026-11-05T10:00:00Z")), { text: "срок прошёл", tone: "danger" });
  const done = (completedAt) => ({ status: "completed", dueAt: due, overdue: false, completedAt });
  assert.deepEqual(accountDeletionDueText(done("2026-11-05T10:00:00Z"), new Date("2026-12-01T00:00:00Z")), { text: "в срок", tone: "neutral" });
  assert.deepEqual(accountDeletionDueText(done("2026-11-07T10:00:00Z"), new Date("2026-12-01T00:00:00Z")), { text: "выполнено после срока", tone: "neutral" });
});

// UI-F1: правило заметки показывается живым счётчиком; то же правило, что у базы.
test("note check: length after trimming, what is missing, control characters", () => {
  assert.deepEqual(checkAccountDeletionNote(""), { length: 0, missing: 10, control: false, ok: false });
  assert.deepEqual(checkAccountDeletionNote("  готово  "), { length: 6, missing: 4, control: false, ok: false });
  assert.deepEqual(checkAccountDeletionNote("Сделано по списку"), { length: 17, missing: 0, control: false, ok: true });
  assert.deepEqual(checkAccountDeletionNote("Сделано\r\nпо списку"), { length: 17, missing: 0, control: false, ok: true }, "CRLF counts as one");
  assert.equal(checkAccountDeletionNote("x".repeat(2000)).ok, true);
  assert.equal(checkAccountDeletionNote("x".repeat(2001)).ok, false);
  assert.equal(checkAccountDeletionNote("Сделано по\u0007 списку").control, true);
  assert.equal(checkAccountDeletionNote("Сделано по\u0007 списку").ok, false);
  for (const value of ["", "готово", "Сделано по списку", "x".repeat(2001), "Сделано по\u0007 списку"]) {
    assert.equal(normalizeAccountDeletionNote(value) !== null, checkAccountDeletionNote(value).ok, JSON.stringify(value));
  }
});

test("step results and the manual note", () => {
  const step = { id: ID, status: "processing", mode: null, authUserId: ID, email: "a@b.cd", emailStatus: null };
  assert.deepEqual(parseAccountDeletionStep(step), step);
  assert.equal(parseAccountDeletionStep({ ...step, status: "completed", mode: "manual", authUserId: null })?.mode, "manual");
  for (const broken of [{ ...step, authUserId: "nope" }, { ...step, status: "requested" }, { ...step, mode: "review" },
    { ...step, emailStatus: "queued" }, { ...step, id: 1 }]) {
    assert.equal(parseAccountDeletionStep(broken), null, JSON.stringify(broken));
  }
  assert.equal(normalizeAccountDeletionNote("  Сделано по списку\r\nвход отключён  "), "Сделано по списку\nвход отключён");
  assert.equal(normalizeAccountDeletionNote("готово"), null, "at least 10 characters");
  assert.equal(normalizeAccountDeletionNote("x".repeat(2001)), null);
  assert.equal(normalizeAccountDeletionNote("Сделано по\u0007 списку"), null);
});

test("days left: calendar days in Bishkek, due date in the past is negative", () => {
  assert.equal(accountDeletionDaysLeft("2026-11-06T10:00:00Z", new Date("2026-10-07T10:00:00Z")), 30);
  // Запрос в 19:26 UTC (уже 08.10 в Бишкеке) через минуту: всё ещё 30, не 29.
  assert.equal(accountDeletionDaysLeft("2026-11-06T19:26:27Z", new Date("2026-10-07T19:35:00Z")), 30);
  assert.equal(accountDeletionDaysLeft("2026-11-06T19:26:27Z", new Date("2026-11-06T19:00:00Z")), 0);
  assert.ok(accountDeletionDaysLeft("2026-10-01T10:00:00Z", new Date("2026-10-07T10:00:00Z")) < 0);
});

// Письмо: двуязычное, без тире, номер запроса, текст владельца; транспорт только по настройке.
test("confirmation mail: text, transports and honest statuses", async () => {
  const { subject, text } = accountDeletionMailText({ to: "a@b.cd", requestId: ID, requestedAt: OWN.requestedAt });
  assert.match(subject, /аккаунт удалён/u);
  assert.match(text, /Номер запроса: 28000000\./u);
  assert.match(text, /Сурамдын номери/u);
  assert.doesNotMatch(text, /[–—]/u);
  assert.match(text, /Мы удалили ваш аккаунт EVO Admissions и связанные с ним данные по вашему запросу от 07\.10\.2026\./u);
  assert.match(text, /Записи о договоре и оплатах хранятся обезличенно столько, сколько требует закон\./u);
  assert.match(text, /аккаунтуңузду жана ага байланышкан маалыматтарды өчүрдүк/u);
  // Nothing the code does not do: no review list, no WhatsApp or journal promises.
  assert.doesNotMatch(text, /WhatsApp|вручную|журнал|резервн/iu);

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

const STEP = { id: ID, status: "processing", mode: null, authUserId: OWN.requestId, email: "a@b.cd", emailStatus: null };
const DONE = { ...STEP, status: "completed", mode: "automatic", authUserId: null };

function fakes({ processed = STEP, processError = null, deleteError = null, completeError = null, markError = null,
  recordError = null, recordFailures = 0, completed = DONE, serviceThrows = false } = {}) {
  const log = [];
  let recordCalls = 0;
  const session = {
    schema: () => ({
      rpc: async (name, args) => {
        log.push(["rpc", name, args]);
        if (name === "process_account_deletion_v1") return processError ? { data: null, error: processError } : { data: processed, error: null };
        if (name === "complete_account_deletion_v1") return completeError ? { data: null, error: completeError } : { data: completed, error: null };
        if (name === "mark_account_deletion_done_v1") {
          return markError ? { data: null, error: markError } : { data: { ...DONE, mode: "manual" }, error: null };
        }
        if (name === "record_account_deletion_email_v1") {
          recordCalls += 1;
          if (recordCalls <= recordFailures) return { data: null, error: { code: "08006", message: "connection lost" } };
          return recordError ? { data: null, error: recordError }
            : { data: { ...DONE, email: null, emailStatus: args.p_status }, error: null };
        }
        return { data: null, error: { message: "unknown" } };
      },
    }),
  };
  const service = {
    auth: { admin: { deleteUser: async (id) => { log.push(["deleteUser", id]); return { error: deleteError }; } } },
  };
  return {
    log,
    services: {
      session,
      service: () => {
        if (serviceThrows) throw new Error("service role is not configured");
        return service;
      },
      sendMail: async (mail) => { log.push(["mail", mail.to]); return "not_configured"; },
      recordRetryDelaysMs: [0, 0],
    },
  };
}

const steps = (log) => log.map((entry) => entry[0] === "rpc" ? entry[1] : entry[0]);

// Порядок шагов: база, вход, подтверждение базы, письмо, статус письма; сбой называет шаг.
test("processor: automatic steps in order; a refusal or failure names its step", async () => {
  const ok = fakes();
  assert.deepEqual(await runAccountDeletion(ID, OWN.requestedAt, ok.services), { status: "completed", emailStatus: "not_configured" });
  assert.deepEqual(steps(ok.log), ["process_account_deletion_v1", "deleteUser", "complete_account_deletion_v1", "mail",
    "record_account_deletion_email_v1"]);
  assert.deepEqual(ok.log[2][2], { p_id: ID });
  assert.deepEqual(ok.log.at(-1)[2], { p_id: ID, p_status: "not_configured" });

  // Not simple: the database refuses, nothing else runs.
  const refused = fakes({ processError: { code: "55000", message: "account_deletion_not_simple", details: "case,lead" } });
  assert.deepEqual(await runAccountDeletion(ID, null, refused.services), { status: "failed", step: "not_simple" });
  assert.deepEqual(steps(refused.log), ["process_account_deletion_v1"]);

  const missingUser = fakes({ deleteError: { status: 404, code: "user_not_found" } });
  assert.equal((await runAccountDeletion(ID, null, missingUser.services)).status, "completed", "an already deleted user is not an error");
  // SQL-2 (миграция 313): сервер Auth не удалил вход, но база решает сама. Активный вход она отклоняет
  // (шаг «auth»), мягко отключённый принимает (запрос выполнен).
  const auth = fakes({ deleteError: { status: 500 }, completeError: { code: "55000", message: "account_deletion_auth_user_exists" } });
  assert.deepEqual(await runAccountDeletion(ID, null, auth.services), { status: "failed", step: "auth" });
  assert.deepEqual(steps(auth.log), ["process_account_deletion_v1", "deleteUser", "complete_account_deletion_v1"],
    "the database is asked after a failed deleteUser, and no mail follows its refusal");
  const disabled = fakes({ deleteError: { status: 500 } });
  assert.deepEqual(await runAccountDeletion(ID, null, disabled.services), { status: "completed", emailStatus: "not_configured" });
  assert.deepEqual(steps(disabled.log), ["process_account_deletion_v1", "deleteUser", "complete_account_deletion_v1", "mail",
    "record_account_deletion_email_v1"]);
  const complete = fakes({ completeError: { code: "55000", message: "account_deletion_auth_user_exists" } });
  assert.deepEqual(await runAccountDeletion(ID, null, complete.services), { status: "failed", step: "complete" });
  assert.ok(!complete.log.some((entry) => entry[0] === "mail"), "no mail before the database confirms");
  const email = fakes({ recordError: { code: "55000" } });
  assert.deepEqual(await runAccountDeletion(ID, null, email.services), { status: "failed", step: "email" });
  assert.equal(email.log.filter((entry) => entry[1] === "record_account_deletion_email_v1").length, 3,
    "the status write is tried three times, and the mail goes once");
  assert.equal(email.log.filter((entry) => entry[0] === "mail").length, 1);
  // F1: a blip of the database does not leave the address behind.
  const blip = fakes({ recordFailures: 2 });
  assert.deepEqual(await runAccountDeletion(ID, null, blip.services), { status: "completed", emailStatus: "not_configured" });
  assert.equal(blip.log.filter((entry) => entry[1] === "record_account_deletion_email_v1").length, 3);
  assert.equal(blip.log.filter((entry) => entry[0] === "mail").length, 1, "only the write is repeated, not the mail");

  // F2: the service role key is checked BEFORE the irreversible deletion in the database.
  const noKey = fakes({ serviceThrows: true });
  assert.deepEqual(await runAccountDeletion(ID, null, noKey.services), { status: "failed", step: "config" });
  assert.deepEqual(noKey.log, [], "not one database call before the key is known to work");
  // The same with the real configuration reader of the server: an environment without the key.
  const realConfig = fakes();
  const withoutKey = { ...realConfig.services, service: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig({})) };
  assert.deepEqual(await runAccountDeletion(ID, null, withoutKey), { status: "failed", step: "config" });
  assert.deepEqual(realConfig.log, [], "the real config check also runs before the database is touched");

  // Already completed with the email recorded: nothing runs again.
  const done = fakes({ processed: { ...DONE, email: null, emailStatus: "sent" } });
  assert.deepEqual(await runAccountDeletion(ID, null, done.services), { status: "completed", emailStatus: "sent" });
  assert.deepEqual(steps(done.log), ["process_account_deletion_v1"]);
});

// F1 и UI-F2: у выполненного запроса со статусом письма «не записан» есть «Повторить письмо».
test("processor: resend the confirmation email of a completed request", async () => {
  const ok = fakes({ completed: { ...DONE, email: "a@b.cd", emailStatus: null } });
  assert.deepEqual(await resendAccountDeletionEmail(ID, OWN.requestedAt, ok.services), { status: "completed", emailStatus: "not_configured" });
  assert.deepEqual(steps(ok.log), ["complete_account_deletion_v1", "mail", "record_account_deletion_email_v1"]);
  assert.deepEqual(ok.log[0][2], { p_id: ID });
  assert.deepEqual(ok.log.at(-1)[2], { p_id: ID, p_status: "not_configured" });
  // Already recorded: nothing is sent.
  const recorded = fakes({ completed: { ...DONE, email: null, emailStatus: "sent" } });
  assert.deepEqual(await resendAccountDeletionEmail(ID, null, recorded.services), { status: "completed", emailStatus: "sent" });
  assert.deepEqual(steps(recorded.log), ["complete_account_deletion_v1"]);
  // Not completed (or refused by the database): no mail, the step is named.
  const open = fakes({ completed: STEP });
  assert.deepEqual(await resendAccountDeletionEmail(ID, null, open.services), { status: "failed", step: "complete" });
  assert.deepEqual(steps(open.log), ["complete_account_deletion_v1"]);
  const refused = fakes({ completeError: { code: "55000", message: "account_deletion_not_processed" } });
  assert.deepEqual(await resendAccountDeletionEmail(ID, null, refused.services), { status: "failed", step: "complete" });
  assert.ok(!refused.log.some((entry) => entry[0] === "mail"));
  // The status write fails again: the same honest step.
  const again = fakes({ completed: { ...DONE, email: "a@b.cd", emailStatus: null }, recordError: { code: "55000" } });
  assert.deepEqual(await resendAccountDeletionEmail(ID, null, again.services), { status: "failed", step: "email" });
  // No service role key is needed: the key is never asked.
  const noKey = fakes({ completed: { ...DONE, email: "a@b.cd", emailStatus: null }, serviceThrows: true });
  assert.equal((await resendAccountDeletionEmail(ID, null, noKey.services)).status, "completed");
});

test("processor: manual «Отметить выполненным», database refusals by name", async () => {
  const ok = fakes();
  assert.deepEqual(await markAccountDeletionDone(ID, null, "Сделано по списку", ok.services),
    { status: "completed", emailStatus: "not_configured" });
  assert.deepEqual(steps(ok.log), ["mark_account_deletion_done_v1", "mail", "record_account_deletion_email_v1"]);
  assert.deepEqual(ok.log[0][2], { p_id: ID, p_note: "Сделано по списку" });
  for (const [message, step] of [["account_deletion_login_active", "login"], ["account_deletion_automatic_available", "automatic"],
    ["account_deletion_invalid", "invalid"], ["account_deletion_processing", "processing"], ["boom", "mark"]]) {
    const refused = fakes({ markError: { message } });
    assert.deepEqual(await markAccountDeletionDone(ID, null, "Сделано по списку", refused.services), { status: "failed", step });
    assert.equal(refused.log.length, 1, `${message}: nothing after the refusal`);
  }
});

test("wiring: settings section, applicant screens and service-role use stay where they belong", () => {
  const settings = source("src/components/v3/settings/types.ts");
  assert.match(settings, /\{ key: "deletion", view: null, title: "Запросы на удаление" \}/u);
  const action = source("src/lib/account-deletion/staff-actions.ts");
  assert.match(action, /^"use server";/u);
  assert.equal(action.match(/isStaffPreview\(actor\)/gu)?.length, 3, "no action runs in the role preview");
  assert.match(action, /export async function retryAccountDeletionEmailAction/u, "UI-F2: the retry of the email of a completed request");
  assert.match(action, /resendAccountDeletionEmail/u);
  assert.match(action, /ACCOUNT_DELETION_CONFIRM_WORD/u);
  assert.match(action, /ACCOUNT_DELETION_DONE_WORD/u);
  assert.match(action, /normalizeAccountDeletionNote/u);
  assert.doesNotMatch(action, /resolve_account_deletion_candidate|amocrm/iu, "no per-item review and no amoCRM logic");
  const section = source("src/components/v3/settings/AccountDeletionSection.tsx");
  assert.match(section, /Ручная обработка/u);
  assert.match(section, /<AccountDeletionManualDone /u);
  assert.match(section, /<AccountDeletionProcess /u);
  assert.match(section, /docs\/runbooks\/account-deletion\.md/u);
  const manual = source("src/components/v3/settings/AccountDeletionManualDone.tsx");
  assert.match(manual, /Отметить выполненным/u);
  assert.match(manual, /disabled=\{loginActive\}/u, "marking waits for the login to go");
  for (const file of ["src/components/v3/settings/AccountDeletionSection.tsx", "src/components/v3/settings/AccountDeletionManualDone.tsx",
    "src/components/v3/settings/AccountDeletionProcess.tsx", "src/components/v3/settings/AccountDeletionEmailRetry.tsx"]) {
    const strings = [...source(file).matchAll(/"([^"\n]*[А-Яа-яЁё][^"\n]*)"|>([^<>{}\n]*[А-Яа-яЁё][^<>{}\n]*)</gu)]
      .map((match) => match[1] ?? match[2]);
    assert.ok(strings.length > 5, file);
    for (const text of strings) assert.doesNotMatch(text, /[–—]/u, `${file}: ${text}`);
  }
  assert.ok(!existsSync(new URL("../src/components/v3/settings/AccountDeletionReview.tsx", import.meta.url)),
    "the review list is gone");
  for (const page of ["src/app/apply/status/page.tsx", "src/app/apply/page.tsx", "src/app/auth/account-pending/page.tsx",
    "src/app/(portal)/portal/profile/page.tsx"]) {
    assert.match(source(page), /<AccountDeletionPanel/u, page);
  }
  // Service role only on the server and only for Auth Admin.
  const processor = source("src/lib/server/account-deletion-processor.ts");
  assert.match(processor, /^import "server-only";/u);
  assert.doesNotMatch(processor, /service\.schema|service\.rpc|service\.from\(|service\.storage/u);
  // The owner's text, the same on the site and in the iPhone catalog.
  const i18n = source("src/lib/portal/i18n.ts");
  assert.match(i18n, /description: "Мы удалим аккаунт и связанные с ним данные в течение 30 дней\.",/u);
  assert.match(i18n, /keptNote: "Записи о договоре и оплатах хранятся обезличенно столько, сколько требует закон\.",/u);
  const catalog = JSON.parse(source("ios/EVOAdmissions/Resources/Localizable.xcstrings")).strings;
  const ru = (key) => catalog[key].localizations.ru.stringUnit.value;
  assert.equal(ru("account_deletion_description"), "Мы удалим аккаунт и связанные с ним данные в течение 30 дней.");
  assert.equal(ru("account_deletion_kept_note"), "Записи о договоре и оплатах хранятся обезличенно столько, сколько требует закон.");
  for (const [key, value] of Object.entries(catalog)) {
    if (!key.startsWith("account_deletion")) continue;
    for (const locale of ["ru", "ky"]) assert.doesNotMatch(value.localizations[locale].stringUnit.value, /[–—]/u, key);
  }
});

// Ревью 280, п. 4: старая сессия удалённого аккаунта ведёт на вход с «Аккаунт удалён».
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

// Ревью 280, доработки P3 (миграция 313): что проводит экран и где стоит счётчик.
test("P3 wiring: counts, labels, the email retry, the note rule and the Auth journal warning", () => {
  const section = source("src/components/v3/settings/AccountDeletionSection.tsx");
  assert.match(section, /accountDeletionDueText\(row, now\)/u, "UI-F3: the due word comes from the tested contract function");
  assert.match(section, /accountDeletionKindWord\(row\.kind, row\.applicationSubmitted\)/u, "UI-F4");
  assert.match(section, /accountDeletionKindWord\(d\.kind, d\.applicationSubmitted\)/u, "UI-F4, the card");
  assert.doesNotMatch(section, /function dueText|const KIND = /u, "no second copy of the due word and the kind word");
  assert.match(section, /d\.status === "completed" && d\.confirmationEmailStatus === null/u, "UI-F2: the retry only while the status is not recorded");
  assert.match(section, /<AccountDeletionEmailRetry /u);
  assert.match(section, /d\.authLog === "not_erased"/u, "SQL-1: the warning");
  assert.match(section, /Журнал входов Supabase Auth не очищен/u);
  assert.match(section, /d\.mode === "manual"\s*\n?\s*\? "Автоматическое удаление было начато, но у аккаунта появились связанные записи/u,
    "F3: a started request that stopped being simple is told apart from a retry");
  const retry = source("src/components/v3/settings/AccountDeletionEmailRetry.tsx");
  assert.match(retry, /^"use client";/u);
  assert.match(retry, /retryAccountDeletionEmailAction/u);
  assert.doesNotMatch(retry, /name="confirm"/u, "the retry deletes nothing and asks for no word");
  const manual = source("src/components/v3/settings/AccountDeletionManualDone.tsx");
  assert.match(manual, /checkAccountDeletionNote\(note\)/u, "UI-F1: the same rule as the database");
  assert.match(manual, /data-testid="v3-deletion-note-rule"/u);
  assert.match(manual, /data-testid="v3-deletion-submit-hint"/u);
  assert.match(manual, /aria-describedby=\{blocker && !pending \? submitHintId : undefined\}/u, "the disabled button names what is missing");
  for (const file of ["src/components/v3/settings/AccountDeletionProcess.tsx", "src/components/v3/settings/AccountDeletionManualDone.tsx"]) {
    assert.match(source(file), /state\.step === "email"\) router\.refresh\(\)/u, `${file}: the card refreshes when only the email status failed`);
  }
  assert.doesNotMatch(source("src/components/v3/settings/AccountDeletionProcess.tsx"), /письмо не уйдёт дважды/u,
    "no promise the code cannot keep: the retry of the email lives on the card");

  // UI-F6: the counter next to «Настройки» and next to «Запросы на удаление».
  const shell = source("src/components/v3/AppShell.tsx");
  assert.match(shell, /deletionRequests\?: AccountDeletionOpenCount \| null/u);
  assert.match(shell, /badge=\{settingsBadge\}/u);
  assert.match(shell, /aria-label=\{badge \? `\$\{link\.label\}: \$\{badge\.name\}` : undefined\}/u, "the link keeps its visible name and adds the count");
  const layout = source("src/app/(v3)/layout.tsx");
  assert.match(layout, /readOpenAccountDeletionCount\(actor\)/u);
  assert.match(layout, /deletionRequests=\{deletionRequests\}/u);
  const settingsPage = source("src/app/(v3)/v3/settings/page.tsx");
  assert.match(settingsPage, /readOpenAccountDeletionCount\(actor\)/u);
  assert.match(settingsPage, /deletionOpen=\{deletionOpen\}/u);
  assert.match(source("src/components/v3/settings/Settings.tsx"), /entry\.key === "deletion" && deletionOpen && deletionOpen\.open > 0/u);
  const reader = source("src/lib/v3/account-deletion-source.ts");
  const open = reader.slice(reader.indexOf("export async function readOpenAccountDeletionCount"));
  assert.ok(open.indexOf('actor.systemRole !== "admin" || isStaffPreview(actor)') < open.indexOf("createSupabaseServerClient()"),
    "a non-Admin and a role preview never reach the database");
  assert.match(open, /staff_account_deletion_open_count_v1/u);
  assert.match(open, /catch \{\s*return null;/u, "a failed read is «no counter», not a failed page");
  // The migration is the only writer of the new surface; its anchors name every replaced function.
  const migration = source("supabase/migrations/313_platform_account_deletion_p3.sql");
  const anchors = migration.slice(migration.indexOf("DO $a313_anchor$"), migration.indexOf("$a313_anchor$;"));
  assert.equal((anchors.match(/IS DISTINCT FROM '[0-9a-f]{32}'/gu) ?? []).length, 7, "seven md5 pre-image anchors");
  for (const fn of ["account_deletion_auth_log_erase", "process_account_deletion_v1", "complete_account_deletion_v1",
    "mark_account_deletion_done_v1", "account_deletion_plan", "account_deletion_queue_row", "staff_account_deletion_detail_v1"]) {
    assert.ok(anchors.includes(fn), `${fn} is anchored`);
  }
  assert.match(migration, /a313_already_applied/u);
});

// UI-F5: одна и та же фраза на сайте, в приложении и по-кыргызски, без намёка на другой способ отмены.
test("«Запрос нельзя отменить»: web, iPhone and Kyrgyz say the same, with no hint of another way to cancel", () => {
  const catalog = JSON.parse(source("ios/EVOAdmissions/Resources/Localizable.xcstrings")).strings;
  const iosRu = catalog.account_deletion_confirm_note.localizations.ru.stringUnit.value;
  const iosKy = catalog.account_deletion_confirm_note.localizations.ky.stringUnit.value;
  const i18n = source("src/lib/portal/i18n.ts");
  const webRu = /confirmNote: "(Запрос нельзя отменить[^"]*)"/u.exec(i18n)?.[1];
  const webKy = /confirmNote: "(Сурамды[^"]*)"/u.exec(i18n)?.[1];
  assert.equal(webRu, "Запрос нельзя отменить. Пока аккаунт не удалён, он работает как обычно.");
  assert.equal(iosRu, "Запрос нельзя отменить. Пока аккаунт не удалён, приложение работает как обычно.");
  assert.equal(webKy, "Сурамды жокко чыгарууга болбойт. Аккаунт өчүрүлгөнгө чейин ал кадимкидей иштейт.");
  assert.equal(iosKy, "Сурамды жокко чыгарууга болбойт. Аккаунт өчүрүлгөнгө чейин тиркеме кадимкидей иштейт.");
  for (const text of [webRu, iosRu, webKy, iosKy]) assert.doesNotMatch(text, /на сайте|в приложении|сайтта|тиркемеден/u, text);
  assert.equal(webRu.split(". ")[0], iosRu.split(". ")[0], "the same first sentence on both surfaces");
  assert.equal(webKy.split(". ")[0], iosKy.split(". ")[0], "the same first sentence on both surfaces, in Kyrgyz");
  assert.doesNotMatch(source("docs/runbooks/account-deletion.md"), /Отменить запрос на сайте нельзя/u);
});

// Решение C2: кыргызские тексты проверяет носитель языка. Список в инструкции полный и совпадает с источниками.
test("Kyrgyz account deletion texts: the review list in the runbook matches every source", () => {
  const doc = source("docs/runbooks/account-deletion.md");
  const section = doc.slice(doc.indexOf("## Кыргызские тексты"), doc.indexOf("## Что этот процесс не делает"));
  assert.ok(section.length > 1000, "the review section exists");
  const i18n = source("src/lib/portal/i18n.ts");
  const ky = /const accountDeletionKy[^{]*\{([\s\S]*?)\n\};/u.exec(i18n)[1];
  const webKy = [...ky.matchAll(/^\s+(\w+): "(.*)",$/gmu)];
  assert.ok(webKy.length >= 14, "the web dictionary is read");
  for (const [, key, value] of webKy) assert.ok(section.includes(`\`accountDeletion.${key}\` |`) && section.includes(`| ${value} |`), `web ${key}`);
  const catalog = JSON.parse(source("ios/EVOAdmissions/Resources/Localizable.xcstrings")).strings;
  const iosKeys = Object.keys(catalog).filter((key) => key.startsWith("account_delet"));
  assert.ok(iosKeys.length >= 14);
  for (const key of iosKeys) {
    assert.ok(section.includes(`\`${key}\` |`), `iPhone ${key} is listed`);
    assert.ok(section.includes(`| ${catalog[key].localizations.ky.stringUnit.value} |`), `iPhone ${key} text`);
  }
  assert.match(source("src/app/login/page.tsx"), /accountDeleted: "Аккаунт өчүрүлдү\."/u);
  assert.ok(section.includes("| Аккаунт өчүрүлдү. |"));
  // The mail: every Kyrgyz line the code sends.
  const { text, subject } = accountDeletionMailText({ to: "a@b.cd", requestId: ID, requestedAt: OWN.requestedAt });
  const undated = accountDeletionMailText({ to: "a@b.cd", requestId: ID, requestedAt: null }).text;
  const kyLines = (body) => body.split("---")[1].split("\n").map((line) => line.trim()).filter(Boolean);
  const lines = new Set([...kyLines(text).map((line) => line.replace("07.10.2026", "{date}").replace(/: [0-9a-f]{8}\./u, ": {номер}.")),
    ...kyLines(undated).map((line) => line.replace(/: [0-9a-f]{8}\./u, ": {номер}."))]);
  assert.ok(lines.size >= 5);
  for (const line of lines) assert.ok(section.includes(`| ${line} |`), `mail line «${line}» is listed`);
  assert.ok(section.includes(`| ${subject.split(" / ")[1]} |`), "the mail subject is listed");
  // The last column is «нет» until a native speaker says so (no invented sign-off); the runbook tells
  // the reviewer to write the date there, so a date (ДД.ММ.ГГГГ or ГГГГ-ММ-ДД) is a valid cell too.
  const rows = section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Где") && !line.startsWith("|---"));
  assert.ok(rows.length >= 30);
  for (const row of rows) assert.match(row, /\| (?:нет|\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}) \|$/u, row);
});
