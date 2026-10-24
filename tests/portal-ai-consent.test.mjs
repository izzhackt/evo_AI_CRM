import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_CONSENT_POLICY_VERSION,
  AI_CONSENT_PRIVACY_URL,
  AI_CONSENT_SOURCE,
  aiConsentApplies,
  aiConsentDate,
  aiConsentOutdated,
  aiConsentState,
  isAiConsentRequestId,
  isAiConsentStatus,
  parseAiConsent,
} from "../src/lib/portal/ai-consent.ts";
import {
  readAiConsentForTier,
  readAiConsentWith,
  writeAiConsentForTier,
  writeAiConsentWith,
} from "../src/lib/portal/ai-consent-rpc.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";

// Согласие студента на ИИ-помощников (решение владельца 25.10.2026, Apple
// 5.1.2(i)), веб-поток. Контракт RPC живёт в миграции 320 (поток db): здесь
// строгий разбор ответа, транспорт с точными аргументами, текст владельца
// слово в слово и проводка карточки «Главной» и строки «Профиля». Вопрос
// задаётся только клиенту EVO с делом на сопровождении (accessTier assisted):
// самостоятельный студент не видит ни карточку, ни строку, а база для него не
// читается и не пишется.
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
  assert.equal(aiConsentOutdated(GRANTED), false);
  assert.equal(aiConsentOutdated(ASKED), false);
  for (const status of ["granted", "declined"]) {
    const old = { ...GRANTED, status, policyVersion: "2026-01-01" };
    assert.equal(aiConsentState(old), "undecided", status);
    assert.equal(aiConsentOutdated(old), true, status);
  }
  // Сервер ушёл вперёд, браузер ещё на старом тексте: решение по тексту браузера не действует.
  assert.equal(aiConsentState({ ...GRANTED, currentPolicyVersion: "2026-12-01" }), "undecided");
});

test("the decision date is read in Bishkek time, day first", () => {
  assert.equal(aiConsentDate("2026-10-25T10:30:00.123456+00:00"), "25.10.2026");
  // 20:00 UTC уже 02:00 следующих суток по Бишкеку (UTC+6).
  assert.equal(aiConsentDate("2026-10-25T20:00:00+00:00"), "26.10.2026");
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

test("the Russian text is the owner's wording, word for word", () => {
  const ru = PORTAL_DICTIONARIES.aiConsent.ru;
  assert.equal(ru.title, "ИИ-помощники EVO");
  assert.equal(
    ru.body,
    "Сотрудникам EVO помогают ИИ-помощники: они читают вашу переписку с EVO и документы дела, чтобы готовить ответы и следить за сроками. Данные обрабатывают Anthropic (Claude, США) и Google (Gemini). Решения по делу принимают сотрудники EVO. Если не разрешите, помощники не будут читать ваши документы и переписку — работа с делом не изменится.",
  );
  assert.equal(ru.allow, "Разрешить");
  assert.equal(ru.decline, "Не разрешать");
  assert.equal(ru.policyLink, "Политика конфиденциальности");
  assert.equal(ru.rowHeading, "ИИ-помощники");
  assert.equal(ru.stateGranted, "Разрешено");
  assert.equal(ru.stateDeclined, "Не разрешено");
  assert.equal(ru.stateUndecided, "Не выбрано");
  assert.equal(ru.revoke, "Отозвать согласие");
});

test("the saved-choice lines report the fact only and promise nothing the code does not enforce", () => {
  // Условие об отказе произносит утверждённое владельцем тело; подтверждение — только факт записи.
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
  for (const name of ["Anthropic", "Claude", "Google", "Gemini"]) {
    assert.ok(ky.body.includes(name), name);
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
  assert.match(action, /revalidatePath\("\/portal"\);\s*revalidatePath\("\/portal\/home"\);\s*revalidatePath\("\/portal\/profile"\);/u);
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

test("the home card is read in the same wave and sits first in HomeView, without blocking anything", () => {
  const page = read("src/app/(portal)/portal/home/page.tsx");
  const wave = page.match(/await Promise\.all\(\[\n([\s\S]*?)\n {2}\]\);/u);
  assert.ok(wave, "home reads stay in one Promise.all");
  assert.match(wave[1], /^\s*readOwnAiConsent\(tier\),?$/mu, "the tier is already known from the actor: no extra read");
  assert.equal(page.match(/await Promise\.all\(/gu)?.length, 2, "no extra wave");
  assert.match(page, /aiConsent=\{aiConsentRead\.status === "ready" \? \(\s*<AiConsentHomeCard\s+initialConsent=\{aiConsentRead\.consent\}\s+strings=\{getPortalStrings\("aiConsent", locale\)\}/u);
  assert.doesNotMatch(page, /\.rpc\(|\.schema\(/u);
  // Сбой чтения прячет карточку и не трогает остальную «Главную».
  assert.match(page, /\) : null\}\s*locale=\{locale\}/u);
  const view = read("src/components/portal/home/HomeView.tsx");
  const card = view.indexOf("{aiConsentApplies(tier) ? aiConsent : null}");
  assert.ok(card > 0, "the view drops the card for a self-service student even if one is passed");
  assert.ok(card < view.indexOf('{tier === "assisted" ? null : journey}'), "first block of the home");
  assert.doesNotMatch(read("src/components/portal/consent/AiConsent.tsx"), /role="dialog"|aria-modal|createPortal|<dialog/u, "never a blocking modal");
});

test("the post-login screen /portal asks too: a sibling slot above the overview, hidden when the read fails", () => {
  const page = read("src/app/(portal)/portal/page.tsx");
  assert.match(page, /import \{ AiConsentSlot \} from "@\/components\/portal\/consent\/AiConsentSlot";/u);
  // Слот стоит после шапки и перед обзором, как сосед: его чтение идёт одновременно с остальными.
  const header = page.indexOf("</header>");
  const slot = page.indexOf("<AiConsentSlot locale={locale} accessTier={actor.accessTier} />");
  const overview = page.indexOf("<AdmissionOverview actor={actor} locale={locale} />");
  assert.ok(header > 0 && slot > header && overview > slot, "header, then the slot, then the overview");
  assert.equal(page.match(/readOwnAiConsent/gu), null, "the page itself does not read; the slot does");
  assert.doesNotMatch(page, /\.rpc\(|\.schema\(/u);
  // Замороженные смоук-якоря production на месте.
  assert.match(page, /<h1 className="pt-page-title">\{strings\.overviewTitle\}<\/h1>/u);
  const slotSource = read("src/components/portal/consent/AiConsentSlot.tsx");
  assert.doesNotMatch(slotSource, /^"use client"/mu, "the slot is a server component");
  assert.match(slotSource, /const read = await readOwnAiConsent\(accessTier\);/u);
  assert.match(slotSource, /read\.status === "ready" \? \(\s*<AiConsentHomeCard\s+initialConsent=\{read\.consent\}\s+strings=\{getPortalStrings\("aiConsent", locale\)\}/u);
  assert.match(slotSource, /\) : null\}\s*<\/div>/u, "a failed read leaves an empty slot");
  // Пустой слот не оставляет зазора.
  const css = read("src/app/(portal)/portal.css");
  assert.match(css, /\.pt-consent-slot \{\s*margin-top: 24px;\s*\}\s*\.pt-consent-slot:empty \{\s*display: none;\s*\}/u);
});

test("the settings row sits in the profile, with its own honest line when the read fails", () => {
  const page = read("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /const \[actor, locale\] = await Promise\.all\(\[\s*requireStudentPortalActor\(\),/u);
  assert.match(page, /readOwnAiConsent\(actor\.accessTier\),\n\s*\]\);/u);
  // Самостоятельный студент: ни раздела, ни заголовка, ни строки.
  assert.match(page, /\{aiConsent\.status === "not_applicable" \? null : \(\s*<section aria-labelledby="portal-profile-ai-consent" className="pt-profile-card">/u);
  assert.match(page, /\{aiConsentStrings\.rowHeading\}/u);
  assert.match(page, /<AiConsentSettingsRow initialConsent=\{aiConsent\.consent\} strings=\{aiConsentStrings\} \/>/u);
  assert.match(page, /<p role="alert" className="pt-account-deletion-error">\{aiConsentStrings\.unavailable\}<\/p>/u);
  // Строка стоит перед «Сессией» и «Удалением аккаунта».
  assert.ok(page.indexOf("portal-profile-ai-consent") < page.indexOf("portal-profile-session"));
  assert.ok(page.indexOf("portal-profile-ai-consent") < page.indexOf("portal-profile-deletion"));
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
  // Карточка: основная «Разрешить», вторая «Не разрешать», ссылка на политику рядом с текстом.
  assert.match(ui, /status="granted" primary>\{strings\.allow\}/u);
  assert.match(ui, /status="declined" primary=\{false\}>\{strings\.decline\}/u);
  assert.match(ui, /href=\{AI_CONSENT_PRIVACY_URL\}/u);
  // «Отозвать согласие» записывает отказ, «Разрешить» после отказа — согласие.
  assert.match(ui, /status="declined" primary=\{false\}>\{strings\.revoke\}/u);
  // Текст и версия не вшиты в компонент.
  assert.doesNotMatch(ui, /2026-10-25|Anthropic|evoadmissions\.com/u);
});

test("the styles use portal tokens only: no raw colours, no side stripes, targets of 44 px", () => {
  const css = read("src/app/(portal)/portal.css");
  const start = css.indexOf("Согласие на ИИ-помощников (решение владельца 25.10.2026)");
  const end = css.indexOf("/* ---------- Фото с атрибуцией ---------- */");
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|hsl/iu, "colours come from --pt-* tokens");
  assert.doesNotMatch(block, /border-(left|right|inline-start|inline-end)\s*:/u, "no coloured side stripe");
  assert.doesNotMatch(block, /@keyframes|animation:|gradient|backdrop-filter/u, "no new motion or decoration");
  assert.match(block, /\.pt-consent \{[^}]*box-shadow: var\(--pt-shadow-card\);/u);
  assert.match(block, /\.pt-consent-body \{\s*color: var\(--pt-text\);/u);
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

test("the decision can be recorded for a client with a case only; the action cannot be used to bypass the screen", async () => {
  const client = fakeClient((_fn, args) => ({ data: { ...GRANTED, status: args.p_status }, error: null }));
  let opened = 0;
  const open = () => { opened += 1; return Promise.resolve(client); };
  assert.deepEqual(await writeAiConsentForTier("assisted", open, "granted", REQUEST_ID), { ok: true, consent: GRANTED });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].fn, "portal_ai_consent_set_v1");
  opened = 0;
  for (const tier of ["approved", undefined, "pending"]) {
    assert.deepEqual(await writeAiConsentForTier(tier, open, "granted", REQUEST_ID), { ok: false }, String(tier));
  }
  assert.equal(opened, 0);
  assert.equal(client.calls.length, 1, "no write reaches the database for a self-service student");
  // Сбой открытия клиента — отказ, а не исключение.
  assert.deepEqual(
    await writeAiConsentForTier("assisted", () => Promise.reject(new Error("no session")), "granted", REQUEST_ID),
    { ok: false },
  );
});

test("rendered: the client's home and the post-login screen carry the consent card, the self-service home does not", () => {
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
  assert.ok(html("home-assisted").includes(CARD), "client home");
  assert.ok(html("admission-overview").includes(CARD), "client post-login screen");
  // Фикстура самостоятельной «Главной» намеренно получает карточку в пропсах: вид её не показывает.
  const approved = html("home-approved");
  assert.equal(approved.includes(CARD), false, "self-service home");
  assert.equal(approved.includes("ИИ-помощники EVO"), false);
  assert.equal(approved.includes('id="home-continue"'), true, "the rest of the home is intact");
});
