import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_CONSENT_POLICY_VERSION,
  AI_CONSENT_PRIVACY_URL,
  AI_CONSENT_SOURCE,
  aiConsentApplies,
  aiConsentState,
  isAiConsentRequestId,
  isAiConsentStatus,
  parseAiConsent,
} from "../src/lib/portal/ai-consent.ts";
import {
  readAiConsentForProfile,
  readAiConsentForTier,
  readAiConsentWith,
  writeAiConsentForTier,
  writeAiConsentWith,
} from "../src/lib/portal/ai-consent-rpc.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";

// Согласие студента на ИИ-помощников (решение владельца 25.10.2026, Apple
// 5.1.2(i)), веб-поток. Контракт RPC живёт в миграции 320 (поток db): здесь
// строгий разбор ответа, транспорт с точными аргументами, текст владельца
// слово в слово и проводка строки «Профиля» (с 14.11.2026 — одна строка секции
// «Конфиденциальность», без объяснений о данных: решение владельца). Строка
// есть у любого студента кабинета (345); для остальных база не читается и не
// пишется.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Исходник без комментариев: проверки «в коде нет …» не цепляют пояснения. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

const REQUEST_ID = "5b1a6c52-7a0e-4f0a-9d0e-2f3b9d8f4c11";
const ASKED = {
  status: null,
  policyVersion: null,
  decidedAt: null,
  currentPolicyVersion: "2026-10-25",
};
const GRANTED = {
  status: "granted",
  policyVersion: "2026-10-25",
  decidedAt: "2026-10-25T10:30:00.123456+00:00",
  currentPolicyVersion: "2026-10-25",
};
const DECLINED = { ...GRANTED, status: "declined" };

/** Клиент Supabase, который записывает вызовы RPC и отвечает заданным результатом. */
function fakeClient(result) {
  const calls = [];
  return {
    calls,
    schema(name) {
      return {
        rpc(fn, args) {
          calls.push({ schema: name, fn, args });
          return Promise.resolve(typeof result === "function" ? result(fn, args) : result);
        },
      };
    },
  };
}

test("the shared contract constants are exactly the ones the other streams code against", () => {
  assert.equal(AI_CONSENT_POLICY_VERSION, "2026-10-25");
  assert.equal(AI_CONSENT_SOURCE, "portal_web");
  assert.equal(AI_CONSENT_PRIVACY_URL, "https://evoadmissions.com/ru/privacy/");
  assert.equal(isAiConsentStatus("granted"), true);
  assert.equal(isAiConsentStatus("declined"), true);
  for (const wrong of ["Granted", "revoked", "", null, undefined, 1, true]) {
    assert.equal(isAiConsentStatus(wrong), false, String(wrong));
  }
  assert.equal(isAiConsentRequestId(REQUEST_ID), true);
  for (const wrong of ["", "not-a-uuid", `${REQUEST_ID}0`, null, 7]) {
    assert.equal(isAiConsentRequestId(wrong), false, String(wrong));
  }
});

test("the RPC answer parses strictly: asked, granted, declined and nothing in between", () => {
  assert.deepEqual(parseAiConsent(ASKED), ASKED);
  assert.deepEqual(parseAiConsent(GRANTED), GRANTED);
  assert.deepEqual(parseAiConsent(DECLINED), DECLINED);
  const { currentPolicyVersion, ...withoutCurrent } = GRANTED;
  assert.ok(currentPolicyVersion);
  for (const broken of [
    null,
    undefined,
    [],
    "granted",
    {},
    withoutCurrent,
    { ...GRANTED, extra: 1 },
    { ...GRANTED, status: "revoked" },
    { ...GRANTED, status: undefined },
    // «Не спрашивали»: версия и время решения тоже пусты.
    { ...ASKED, policyVersion: "2026-10-25" },
    { ...ASKED, decidedAt: "2026-10-25T10:30:00+00:00" },
    // Решение без версии или времени, чужая форма времени и версии.
    { ...GRANTED, policyVersion: null },
    { ...GRANTED, decidedAt: null },
    { ...GRANTED, decidedAt: "yesterday" },
    { ...GRANTED, decidedAt: "2026-10-25" },
    { ...GRANTED, currentPolicyVersion: "" },
    { ...GRANTED, currentPolicyVersion: null },
    { ...GRANTED, policyVersion: "2026 10 25" },
  ]) {
    assert.equal(parseAiConsent(broken), null, JSON.stringify(broken));
  }
});

test("only a decision on the current policy version counts; an older one asks again", () => {
  assert.equal(aiConsentState(ASKED), "undecided");
  assert.equal(aiConsentState(GRANTED), "granted");
  assert.equal(aiConsentState(DECLINED), "declined");
  for (const status of ["granted", "declined"]) {
    const old = { ...GRANTED, status, policyVersion: "2026-01-01" };
    assert.equal(aiConsentState(old), "undecided", status);
  }
  // Сервер ушёл вперёд, браузер ещё на старом тексте: решение по тексту браузера не действует.
  assert.equal(aiConsentState({ ...GRANTED, currentPolicyVersion: "2026-12-01" }), "undecided");
});

test("reading calls portal_ai_consent_get_v1 in schema platform and fails closed", async () => {
  const ok = fakeClient({ data: GRANTED, error: null });
  assert.deepEqual(await readAiConsentWith(ok), GRANTED);
  assert.deepEqual(ok.calls, [{ schema: "platform", fn: "portal_ai_consent_get_v1", args: undefined }]);
  assert.deepEqual(await readAiConsentWith(fakeClient({ data: ASKED, error: null })), ASKED);
  assert.equal(await readAiConsentWith(fakeClient({ data: null, error: { code: "42501" } })), null);
  assert.equal(await readAiConsentWith(fakeClient({ data: null, error: null })), null);
  assert.equal(await readAiConsentWith(fakeClient({ data: { ...GRANTED, extra: 1 }, error: null })), null);
});

test("writing sends the exact RPC arguments with the version and source chosen by the server module", async () => {
  const client = fakeClient((_fn, args) => ({
    data: { ...GRANTED, status: args.p_status },
    error: null,
  }));
  assert.deepEqual(await writeAiConsentWith(client, "granted", REQUEST_ID), { ok: true, consent: GRANTED });
  assert.deepEqual(await writeAiConsentWith(client, "declined", REQUEST_ID), { ok: true, consent: DECLINED });
  assert.deepEqual(client.calls[0], {
    schema: "platform",
    fn: "portal_ai_consent_set_v1",
    args: {
      p_status: "granted",
      p_policy_version: "2026-10-25",
      p_source: "portal_web",
      p_request_id: REQUEST_ID,
    },
  });
  assert.equal(client.calls[1].args.p_status, "declined");
});

test("writing never calls the database for a bad status or a bad request id", async () => {
  const client = fakeClient({ data: GRANTED, error: null });
  for (const [status, id] of [
    ["revoked", REQUEST_ID],
    [null, REQUEST_ID],
    ["granted", "nope"],
    ["granted", undefined],
    [{ toString: () => "granted" }, REQUEST_ID],
  ]) {
    assert.deepEqual(await writeAiConsentWith(client, status, id), { ok: false });
  }
  assert.deepEqual(client.calls, []);
});

test("writing refuses an answer that does not confirm this very choice on the current version", async () => {
  for (const data of [
    DECLINED, // ответили другим решением
    { ...GRANTED, policyVersion: "2026-01-01" }, // записано по старому тексту
    ASKED, // сервер «забыл» запись
    { ...GRANTED, extra: 1 },
    null,
  ]) {
    assert.deepEqual(await writeAiConsentWith(fakeClient({ data, error: null }), "granted", REQUEST_ID), { ok: false });
  }
  // Отказ базы (чужой идентификатор, неверная версия, сеть): без выдуманного успеха.
  assert.deepEqual(
    await writeAiConsentWith(fakeClient({ data: null, error: { message: "ai_consent_version" } }), "granted", REQUEST_ID),
    { ok: false },
  );
});

test("the Profile row has a plain label, a state word and one button: no explanatory text (owner, 14.11.2026)", () => {
  const { ru, ky } = PORTAL_DICTIONARIES.aiConsent;
  assert.equal(ru.title, "ИИ-помощники EVO");
  assert.equal(ru.allow, "Разрешить ИИ-помощников");
  assert.equal(ru.revoke, "Отозвать согласие на ИИ");
  assert.equal(ru.stateGranted, "Разрешено");
  assert.equal(ru.stateDeclined, "Не разрешено");
  assert.equal(ru.stateUndecided, "Не выбрано");
  // Объяснение, кто и что читает, и условие отказа живут только в регистрации и на экране «Конфиденциальность».
  for (const removed of ["body", "decline", "policyLink", "rowHeading", "changeInProfile", "policyUpdated"]) {
    assert.equal(Object.hasOwn(ru, removed), false, `ru.${removed}`);
    assert.equal(Object.hasOwn(ky, removed), false, `ky.${removed}`);
  }
  const gate = PORTAL_DICTIONARIES.consentGate.ru;
  assert.equal(gate.aiLabel, "Разрешаю ИИ-помощникам EVO читать мою переписку и документы дела");
  assert.match(gate.aiDetail, /Anthropic \(Claude, США\) и Google \(Gemini\)/u);
});

test("the saved-choice lines report the fact only and promise nothing the code does not enforce", () => {
  // Подтверждение — только факт записи.
  const { ru, ky } = PORTAL_DICTIONARIES.aiConsent;
  assert.equal(ru.savedGranted, "Разрешение сохранено.");
  assert.equal(ru.savedDeclined, "Отказ сохранён.");
  assert.equal(ky.savedGranted, "Уруксат сакталды.");
  assert.equal(ky.savedDeclined, "Баш тартуу сакталды.");
  assert.doesNotMatch(ru.savedDeclined, /не будут читать|читать/u);
  assert.doesNotMatch(ky.savedDeclined, /окубайт/u);
});

test("the Kyrgyz draft covers every key, keeps the names of the processors and is not marked as reviewed", () => {
  const { ru, ky } = PORTAL_DICTIONARIES.aiConsent;
  assert.deepEqual(Object.keys(ky).sort(), Object.keys(ru).sort());
  for (const [key, value] of Object.entries(ky)) assert.notEqual(value.trim(), "", key);
  // Названия обработчиков остаются там, где студент даёт согласие: на экране «Конфиденциальность».
  for (const name of ["Anthropic", "Claude", "Google", "Gemini"]) {
    assert.ok(PORTAL_DICTIONARIES.consentGate.ky.aiDetail.includes(name), name);
  }
  const dictionary = read("src/lib/portal/i18n.ts");
  const block = dictionary.slice(dictionary.indexOf("const aiConsentKy"), dictionary.indexOf("export const PORTAL_DICTIONARIES"));
  assert.doesNotMatch(block, /проверен(?!ой)|reviewed/iu, "no string is claimed as reviewed");
  assert.match(dictionary, /вычитка носителем владельца ожидается/u);
});

test("the action is a server action that checks the student, then writes through the RPC transport only", () => {
  const action = read("src/lib/portal/ai-consent-actions.ts");
  assert.match(action, /^"use server";/u);
  assert.match(action, /const actor = await requireStudentPortalActor\(\);/u);
  assert.match(action, /writeAiConsentForTier\(\s*actor\.accessTier,\s*createSupabaseServerClient,\s*status,\s*requestId,?\s*\)/u);
  assert.match(action, /revalidatePath\("\/portal"\);\s*revalidatePath\("\/portal\/profile"\);/u);
  // Версию и источник выбирает серверный модуль, а не аргументы из браузера.
  assert.match(action, /status: unknown,\s*requestId: unknown,/u);
  assert.doesNotMatch(action, /policyVersion|p_policy_version|portal_web|\.rpc\(/u);
  const rpc = read("src/lib/portal/ai-consent-rpc.ts");
  assert.match(rpc, /p_policy_version: AI_CONSENT_POLICY_VERSION,/u);
  assert.match(rpc, /p_source: AI_CONSENT_SOURCE,/u);
  assert.doesNotMatch(code("src/lib/portal/ai-consent-rpc.ts"), /auth\.uid|getUser|userId|user_id/u, "the RPC derives the student itself");
  const source = read("src/lib/portal/ai-consent-source.ts");
  assert.match(source, /^import "server-only";/u);
  assert.match(source, /readAiConsentForTier\(accessTier, createSupabaseServerClient\)/u);
  assert.match(rpc, /catch \{\s*return \{ status: "unavailable" \};/u);
});

test("09.11.2026: the Home card is gone, the home does not read the consent any more", () => {
  const page = read("src/app/(portal)/portal/page.tsx");
  assert.doesNotMatch(page, /readOwnAiConsent|AiConsentHomeCard|aiConsent/u);
  assert.equal(page.match(/await Promise\.all\(/gu)?.length, 2, "no extra wave");
  assert.doesNotMatch(page, /\.rpc\(|\.schema\(/u);
  const view = read("src/components/portal/home/HomeView.tsx");
  assert.doesNotMatch(view, /aiConsent|AiConsent/u);
  const component = read("src/components/portal/consent/AiConsent.tsx");
  assert.doesNotMatch(component, /AiConsentHomeCard|ai-consent-card/u);
  assert.doesNotMatch(component, /role="dialog"|aria-modal|createPortal|<dialog/u, "never a blocking modal");
  // Отозвать по-прежнему можно в «Профиле».
  assert.match(component, /export function AiConsentSettingsRow/u);
  assert.match(read("src/app/(portal)/portal/profile/page.tsx"), /<AiConsentSettingsRow /u);
  const old = read("src/app/(portal)/portal/home/page.tsx");
  assert.match(old, /redirect\("\/portal"\);/u);
  assert.equal(existsSync(new URL("../src/components/portal/consent/AiConsentSlot.tsx", import.meta.url)), false);
  // Обновление после ответа обновляет единственную «Главную».
  assert.match(read("src/lib/portal/ai-consent-actions.ts"), /revalidatePath\("\/portal"\);/u);
});

test("the settings row sits in the profile privacy section, with its own honest line when the read fails", () => {
  const page = read("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /const \[actor, locale\] = await Promise\.all\(\[\s*requireStudentPortalActor\(\),/u);
  // 345 (07.11.2026): строка «Профиля» у любого студента кабинета — согласие из регистрации можно отозвать сразу.
  assert.match(page, /readOwnAiConsentForProfile\(actor\.accessTier\),\n\s*\]\);/u);
  // Не студент кабинета: ни строки, ни её сбоя. Строка стоит в секции «Конфиденциальность» (14.11.2026).
  assert.match(page, /\{aiConsent\.status === "not_applicable" \? null : \(\s*<li className="pt-privacy-item pt-privacy-item-block">/u);
  assert.match(page, /<AiConsentSettingsRow initialConsent=\{aiConsent\.consent\} strings=\{aiConsentStrings\} \/>/u);
  assert.match(page, /<p role="alert" className="pt-account-deletion-error">\{aiConsentStrings\.unavailable\}<\/p>/u);
  // Отдельной карточки «ИИ-помощники» и своего заголовка у строки больше нет.
  assert.doesNotMatch(page, /portal-profile-ai-consent|aiConsentStrings\.rowHeading|ProfileIcon name="ai"/u);
  // Строка стоит после двух ссылок и перед «Удалить аккаунт»; «Выйти» с 03.11.2026 — в шапке профиля над настройками.
  assert.ok(page.indexOf("href={AI_CONSENT_PRIVACY_URL}") < page.indexOf("<AiConsentSettingsRow"));
  assert.ok(page.indexOf("href={PORTAL_SUPPORT_URL}") < page.indexOf("<AiConsentSettingsRow"));
  assert.ok(page.indexOf("<AiConsentSettingsRow") < page.indexOf("<AccountDeletionPanel"));
  assert.doesNotMatch(page, /portal-profile-session/u);
  assert.ok(page.indexOf("<ProfileHero") < page.indexOf("logoutStudentPortalAction}>"));
  assert.ok(page.indexOf("logoutStudentPortalAction}>") < page.indexOf("portal-profile-privacy"));
});

test("the controls keep the decision honest: pending lock, stable attempt id, confirmed state, focus kept", () => {
  const ui = read("src/components/portal/consent/AiConsent.tsx");
  assert.match(ui, /^"use client";/u);
  // Один запрос за раз; повтор того же выбора после сбоя отправляет тот же request_id.
  assert.match(ui, /if \(pendingRef\.current\) return;/u);
  assert.match(ui, /attempt\.current\?\.status === status\s+\? attempt\.current\.requestId\s+: crypto\.randomUUID\(\)/u);
  assert.match(ui, /if \(result\.ok\) \{\s*attempt\.current = null;\s*setConsent\(result\.consent\);\s*setFresh\(true\);/u);
  assert.match(ui, /\} else \{\s*setFailed\(true\);/u);
  assert.match(ui, /\} catch \{\s*setFailed\(true\);/u);
  // Кнопки остаются в разметке и сохраняют фокус (aria-disabled, не disabled).
  assert.match(ui, /aria-disabled=\{decision\.pending\}/u);
  assert.doesNotMatch(ui, /(?<![-\w])disabled=/u);
  // Подтверждение — в живой области, ошибка — role="alert", кнопка остаётся для повтора.
  assert.match(ui, /<p role="status" tabIndex=\{-1\} ref=\{liveRef\} className="pt-consent-live" data-phase=\{phase\}>/u);
  assert.match(ui, /<p role="alert" className="pt-consent-error">\{strings\.error\}<\/p>/u);
  assert.match(ui, /<CheckMark fresh \/>/u);
  assert.match(ui, /active === null \|\| active === document\.body/u);
  // Одна кнопка по состоянию: «Отозвать согласие на ИИ» записывает отказ, «Разрешить» после отказа — согласие.
  assert.match(ui, /status="declined" primary=\{false\}>\{strings\.revoke\}/u);
  assert.match(ui, /status="granted" primary>\{strings\.allow\}/u);
  // Ни второй кнопки «Не разрешать», ни ссылки на политику, ни абзаца-объяснения в строке нет (14.11.2026).
  assert.doesNotMatch(ui, /strings\.decline|strings\.body|strings\.policyLink|AI_CONSENT_PRIVACY_URL|<a /u);
  // Текст и версия не вшиты в компонент.
  assert.doesNotMatch(ui, /2026-10-25|Anthropic|evoadmissions\.com/u);
});

test("the styles use portal tokens only: no raw colours, no side stripes, targets of 44 px", () => {
  const css = read("src/app/(portal)/portal.css");
  const start = css.indexOf("«Профиль → Конфиденциальность» (решение владельца 14.11.2026)");
  const end = css.indexOf("/* ---------- Фото с атрибуцией ---------- */");
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|hsl/iu, "colours come from --pt-* tokens");
  assert.doesNotMatch(block, /border-(left|right|inline-start|inline-end)\s*:/u, "no coloured side stripe");
  assert.doesNotMatch(block, /@keyframes|animation:|gradient|backdrop-filter/u, "no new motion or decoration");
  assert.match(block, /\.pt-gate-card \{[^}]*box-shadow: var\(--pt-shadow-card\);/u);
  // Ссылки секции — строки не ниже 44 px.
  assert.match(block, /\.pt-privacy-link \{[^}]*min-height: 52px;/u);
  // Кнопки и ссылка — общие классы портала с высотой 44 px.
  assert.match(css, /\.pt-btn,\n\.pt-btn-ghost \{[^}]*min-height: 44px;/u);
  assert.match(css, /\.pt-link \{[^}]*min-height: 44px;/u);
});

test("the question applies to a client with a case on accompaniment only; anything else fails closed", () => {
  assert.equal(aiConsentApplies("assisted"), true);
  // «approved» — самостоятельный студент без дела на сопровождении: его данные ИИ-помощники не читают.
  assert.equal(aiConsentApplies("approved"), false);
  for (const wrong of [undefined, null, "", "Assisted", "pending", "active", 1, true, {}]) {
    assert.equal(aiConsentApplies(wrong), false, String(wrong));
  }
  // Граница — серверный accessTier, а не вторая локальная деривация из caseState.
  const authority = read("src/lib/supabase/student-portal-authority.ts");
  assert.match(authority, /accessTier: portalCase\.case_state === "pending" \? "approved" : "assisted"/u);
  assert.doesNotMatch(code("src/lib/portal/ai-consent.ts"), /caseState|case_state/u);
});

test("a client with a case is asked: one RPC read, a failed read hides the question instead of inventing a state", async () => {
  let opened = 0;
  const client = fakeClient({ data: ASKED, error: null });
  const open = () => { opened += 1; return Promise.resolve(client); };
  assert.deepEqual(await readAiConsentForTier("assisted", open), { status: "ready", consent: ASKED });
  assert.equal(opened, 1);
  assert.deepEqual(client.calls, [{ schema: "platform", fn: "portal_ai_consent_get_v1", args: undefined }]);
  // Сбой RPC, чужая форма ответа, сбой открытия клиента: «unavailable».
  for (const failing of [
    () => Promise.resolve(fakeClient({ data: null, error: { code: "42501" } })),
    () => Promise.resolve(fakeClient({ data: { ...GRANTED, extra: 1 }, error: null })),
    () => Promise.reject(new Error("no session")),
  ]) {
    assert.deepEqual(await readAiConsentForTier("assisted", failing), { status: "unavailable" });
  }
});

test("a self-service student is never asked: no client, no RPC, nothing to render", async () => {
  const client = fakeClient({ data: ASKED, error: null });
  let opened = 0;
  const open = () => { opened += 1; return Promise.resolve(client); };
  for (const tier of ["approved", undefined, null, "pending", ""]) {
    assert.deepEqual(await readAiConsentForTier(tier, open), { status: "not_applicable" }, String(tier));
  }
  assert.equal(opened, 0, "the database client is not even opened");
  assert.deepEqual(client.calls, []);
});

test("the decision can be recorded by any cabinet student (345); the action cannot be used to bypass the screen", async () => {
  const client = fakeClient((_fn, args) => ({ data: { ...GRANTED, status: args.p_status }, error: null }));
  let opened = 0;
  const open = () => { opened += 1; return Promise.resolve(client); };
  assert.deepEqual(await writeAiConsentForTier("assisted", open, "granted", REQUEST_ID), { ok: true, consent: GRANTED });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].fn, "portal_ai_consent_set_v1");
  // 345: a self-service student (approved tier) gave the consent at registration and may withdraw it.
  assert.deepEqual(await writeAiConsentForTier("approved", open, "declined", REQUEST_ID), { ok: true, consent: { ...GRANTED, status: "declined" } });
  assert.equal(client.calls.length, 2);
  opened = 0;
  for (const tier of [undefined, "pending", "", null]) {
    assert.deepEqual(await writeAiConsentForTier(tier, open, "granted", REQUEST_ID), { ok: false }, String(tier));
  }
  assert.equal(opened, 0);
  assert.equal(client.calls.length, 2, "no write reaches the database without a cabinet tier");
  // Сбой открытия клиента — отказ, а не исключение.
  assert.deepEqual(
    await writeAiConsentForTier("assisted", () => Promise.reject(new Error("no session")), "granted", REQUEST_ID),
    { ok: false },
  );
});

test("rendered: no home carries the consent card any more, the consent screen renders", () => {
  // Тот же статический рендер реальных компонентов, что гонит a11y-гейт портала.
  const surfaces = JSON.parse(
    execFileSync(process.execPath, [new URL("./e2e/portal-static-render.cjs", import.meta.url).pathname], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const html = (name) => {
    const surface = surfaces.find((candidate) => candidate.name === name);
    assert.ok(surface, name);
    return surface.html;
  };
  const CARD = 'data-testid="ai-consent-card"';
  for (const name of ["home-assisted", "home-approved", "admission-overview"]) assert.equal(html(name).includes(CARD), false, name);
  assert.equal(html("home-approved").includes('id="home-dates"'), true, "the rest of the home is intact");
  const gate = html("consent-gate");
  assert.equal((gate.match(/<input [^>]*type="checkbox"/gu) ?? []).length, 2, "two checkboxes");
  assert.equal((gate.match(/<input [^>]*type="checkbox" required/gu) ?? []).length, 2, "both required");
  assert.ok(gate.includes("Принимаю") && gate.includes("https://evoadmissions.com/ru/privacy/"));
  assert.ok(gate.includes("Разрешаю ИИ-помощникам EVO читать мою переписку и документы дела"));
  // 14.11.2026: единственная строка о файлах — на этом экране, где студент ставит галочки.
  assert.ok(gate.includes("Файлы хранятся закрыто и проверяются антивирусом; их видят сотрудники EVO, которые ведут ваше дело."));
  // Рабочие экраны: ни объяснений о данных, ни строки о файлах под списком документов.
  const documents = html("admission-documents");
  for (const phrase of ["Загружая документы", "проверяются на вирусы", "видите только вы", "Политика конфиденциальности"]) {
    assert.equal(documents.includes(phrase), false, `documents: ${phrase}`);
  }
  const profile = html("profile-ai-consent");
  for (const phrase of ["Конфиденциальность", "Политика конфиденциальности", "Поддержка EVO", "Отозвать согласие на ИИ", "Разрешить ИИ-помощников", "Удалить аккаунт"]) {
    assert.ok(profile.includes(phrase), `profile: ${phrase}`);
  }
  for (const phrase of ["читают вашу переписку", "Anthropic", "Не разрешать", "в течение 30 дней", "хранятся обезличенно", "Условия обновились"]) {
    assert.equal(profile.includes(phrase), false, `profile: ${phrase}`);
  }
});

test("345: the Profile row reads for every cabinet student, the Home card only for a client with a case", async () => {
  const client = fakeClient(() => ({ data: GRANTED, error: null }));
  const open = () => Promise.resolve(client);
  assert.deepEqual(await readAiConsentForProfile("approved", open), { status: "ready", consent: GRANTED });
  assert.deepEqual(await readAiConsentForProfile("assisted", open), { status: "ready", consent: GRANTED });
  assert.deepEqual(await readAiConsentForTier("approved", open), { status: "not_applicable" }, "the Home card does not ask");
  for (const tier of [undefined, null, "pending", ""]) {
    assert.deepEqual(await readAiConsentForProfile(tier, open), { status: "not_applicable" }, String(tier));
  }
});
