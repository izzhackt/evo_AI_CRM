import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCOUNT_DELETED_NOTICE,
  ACCOUNT_DELETED_PATH,
  accountDeletionDaysLeft,
  isDeletedAuthUserError,
  normalizeAccountDeletionNote,
  parseAccountDeletionDetail,
  parseAccountDeletionQueue,
  parseAccountDeletionStep,
  parseOwnAccountDeletion,
} from "../src/lib/account-deletion-contract.ts";
import { accountDeletionMailText, sendAccountDeletionMail } from "../src/lib/server/account-deletion-mail.ts";
import { markAccountDeletionDone, runAccountDeletion } from "../src/lib/server/account-deletion-processor.ts";

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
  recordError = null } = {}) {
  const log = [];
  const session = {
    schema: () => ({
      rpc: async (name, args) => {
        log.push(["rpc", name, args]);
        if (name === "process_account_deletion_v1") return processError ? { data: null, error: processError } : { data: processed, error: null };
        if (name === "complete_account_deletion_v1") return completeError ? { data: null, error: completeError } : { data: DONE, error: null };
        if (name === "mark_account_deletion_done_v1") {
          return markError ? { data: null, error: markError } : { data: { ...DONE, mode: "manual" }, error: null };
        }
        if (name === "record_account_deletion_email_v1") {
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
  return { log, services: { session, service: () => service, sendMail: async (mail) => { log.push(["mail", mail.to]); return "not_configured"; } } };
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
  const auth = fakes({ deleteError: { status: 500 } });
  assert.deepEqual(await runAccountDeletion(ID, null, auth.services), { status: "failed", step: "auth" });
  assert.ok(!auth.log.some((entry) => entry[1] === "complete_account_deletion_v1"));
  const complete = fakes({ completeError: { code: "55000", message: "account_deletion_auth_user_exists" } });
  assert.deepEqual(await runAccountDeletion(ID, null, complete.services), { status: "failed", step: "complete" });
  assert.ok(!complete.log.some((entry) => entry[0] === "mail"), "no mail before the database confirms");
  const email = fakes({ recordError: { code: "55000" } });
  assert.deepEqual(await runAccountDeletion(ID, null, email.services), { status: "failed", step: "email" });

  // Already completed with the email recorded: nothing runs again.
  const done = fakes({ processed: { ...DONE, email: null, emailStatus: "sent" } });
  assert.deepEqual(await runAccountDeletion(ID, null, done.services), { status: "completed", emailStatus: "sent" });
  assert.deepEqual(steps(done.log), ["process_account_deletion_v1"]);
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
  assert.equal(action.match(/isStaffPreview\(actor\)/gu)?.length, 2, "neither action runs in the role preview");
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
    "src/components/v3/settings/AccountDeletionProcess.tsx"]) {
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
