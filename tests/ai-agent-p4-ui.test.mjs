// «ИИ-агент» P4 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §11, §12.1–12.2, §15 P4;
// ADR 0031): CRM-сторона «Автоответчика» — чистый контракт раздела (формы
// 277: настройки, состояние, журнал, утренняя сводка, чат), проверки настроек
// до записи (те же правила, что CHECK 275), маршрут «Автоответчик в этом чате»,
// контракт прокси, подпись «Автоответчик» в ленте, env-контракт выключателя и
// тексты интерфейса. База — подделка с записью вызовов; данные синтетические;
// ни агента, ни Gemini, ни WhatsApp. Что сотрудник может прочитать и изменить,
// решает база (275–277, supabase/tests/platform_ai_agent_p4.sql в ветке P4 SQL).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { build } from "esbuild";
import { NextRequest } from "next/server.js";

import {
  AI_AUTOSEND_COPY,
  AI_AUTOSEND_LIMIT_CEILING,
  AI_AUTOSEND_OUTCOME_RU,
  AI_AUTOSEND_SETTINGS_KEYS,
  aiAutosendAnswersHere,
  aiAutosendChatLine,
  aiAutosendConversationFromLink,
  aiAutosendJournalReason,
  aiAutosendLiveLock,
  aiAutosendMode,
  aiAutosendOvernight,
  aiAutosendPauseReason,
  aiAutosendSettingsIssues,
  aiAutosendSettingsPatch,
  aiAutosendTrimmed,
  aiAutosendWindowLine,
  nightsWord,
  normalizeAiAutosendChat,
  normalizeAiAutosendChatView,
  normalizeAiAutosendJournal,
  normalizeAiAutosendSettings,
  normalizeAiAutosendState,
  normalizeAiAutosendSummary,
} from "../src/lib/v3/ai-agent-autosend.ts";
import { AI_AGENT_SECTIONS, aiAgentHref, parseAiAgentRoute } from "../src/lib/v3/ai-agent.ts";
import {
  aiAutosendExclusionOutcome,
  createAiAutosendChatExclusionHandler,
  createAiAutosendChatReadHandler,
} from "../src/lib/server/ai-agent-route-handlers.ts";
import { aiAutosendServerState } from "../src/lib/server/ai-agent-send-config.ts";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
  isRetiredPlatformRoute,
} from "../src/lib/platform-route-contract.ts";
import {
  normalizePlatformWhatsAppChatMessage,
  normalizePlatformWhatsAppChatState,
} from "../src/lib/platform-communications.ts";
import { autoreplyOnBehalf, originWord, outgoingBubbles, speakerPrefix } from "../src/lib/v3/whatsapp-chat.ts";
import { validateAppEnvironmentContract } from "../scripts/evo-app-env-contract.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = (n) => `27700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = Object.freeze({ organizationId: ID(90), membershipId: ID(91) });

// ------------------------------------------------------------ 277 shapes

const SETTINGS = Object.freeze({
  schedule: {
    mon: [{ from: "20:00", to: "09:00" }], tue: [{ from: "20:00", to: "09:00" }], wed: [{ from: "20:00", to: "09:00" }],
    thu: [{ from: "20:00", to: "09:00" }], fri: [{ from: "20:00", to: "09:00" }], sat: [{ from: "13:00", to: "15:00" }, { from: "20:00", to: "09:00" }], sun: [],
  },
  dateOverrides: [{ from: "2026-12-31", to: "2027-01-02", mode: "on" }],
  workingDays: [5, 1, 2, 3, 4],
  timezone: "Asia/Bishkek",
  delayMinSeconds: 30, delayMaxSeconds: 90,
  limitChatHour: 4, limitChatNight: 8, limitNumberHour: 30,
  phrases: {
    ru: { tomorrow: { text: "Завтра в рабочее время вам позвонит наш руководитель.", confirmed: true },
      day: { text: "{day} в рабочее время вам позвонит наш руководитель.", confirmed: true } },
    ky: { tomorrow: { text: "Эртең иш убактысында биздин жетекчи сизге чалат.", confirmed: false },
      day: { text: "{day} иш убактысында биздин жетекчи сизге чалат.", confirmed: false } },
    en: { tomorrow: { text: "Our manager will call you tomorrow during business hours.", confirmed: false },
      day: { text: "Our manager will call you {day} during business hours.", confirmed: false } },
  },
  disclosureEnabled: true,
  disclosure: {
    ru: { text: "Пишет автоматический помощник EVO — менеджеры сейчас не на связи.", confirmed: false },
    ky: { text: "EVO автоматтык жардамчысы жазып жатат — менеджерлер азыр байланышта эмес.", confirmed: false },
    en: { text: "This is the EVO automatic assistant — our managers are offline right now.", confirmed: false },
  },
  liveTestConversationIds: [],
});
const STATE = Object.freeze({
  settings: SETTINGS,
  state: {
    enabled: true, shadowMode: true, consentRecorded: true, paused: null,
    window: { inside: true, intervalStart: "2026-10-06T14:00:00Z", intervalEnd: "2026-10-07T03:00:00Z", nextStart: "2026-10-07T14:00:00Z" },
    responsible: { membershipId: ID(91), name: "Айгерим Синтетическая" }, enabledAt: "2026-10-05T14:02:00Z",
    sendErrorStreak: 0, geminiErrorStreak: 0, shadowNights: 1, shadowNightsRequired: 3,
    finalPhraseNow: { text: "Завтра в рабочее время вам позвонит наш руководитель.", variant: "tomorrow", callDate: "2026-10-07", day: null, confirmed: true, dayWordsReview: false },
  },
  lastSummary: { id: ID(40), intervalStart: "2026-10-05T14:00:00Z", intervalEnd: "2026-10-06T03:00:00Z", shadowNight: true, counts: {}, status: "ready" },
  canManage: true, canSend: true, version: 7,
});
const state = (patch = {}, statePatch = {}) => normalizeAiAutosendState({ ...STATE, ...patch, state: { ...STATE.state, ...statePatch } });

test("state: the 277 shape — settings with its own keys, pause, window, responsible, nights, phrase now, rights", () => {
  const value = state();
  assert.equal(value.version, 7);
  assert.equal(aiAutosendMode(value), "shadow");
  assert.deepEqual(value.settings.workingDays, [1, 2, 3, 4, 5], "sorted ISO days");
  assert.equal(value.settings.delayMinSeconds, 30);
  assert.equal(value.settings.limitNumberHour, 30);
  assert.equal(value.settings.schedule.sat.length, 2);
  assert.deepEqual(value.responsible, { membershipId: ID(91), name: "Айгерим Синтетическая" });
  assert.deepEqual(value.window, { inside: true, start: "2026-10-06T14:00:00Z", end: "2026-10-07T03:00:00Z", nextStart: "2026-10-07T14:00:00Z" });
  assert.equal(aiAutosendWindowLine(value), "Сейчас интервал автоответчика — до 7 октября, 09:00");
  assert.equal(aiAutosendWindowLine(state({}, { window: { inside: false, intervalStart: null, intervalEnd: null, nextStart: "2026-10-07T14:00:00Z" } })),
    "Следующий интервал — с 7 октября, 20:00");
  assert.deepEqual(value.finalPhraseNow, { text: "Завтра в рабочее время вам позвонит наш руководитель.", callDate: "2026-10-07", confirmed: true });
  assert.equal(value.lastSummaryId, ID(40));
  assert.deepEqual(value.liveTestTitles, {}, "names come from the CRM conversation reader, not from 277");
  assert.equal(aiAutosendMode(state({}, { enabled: false })), "off");
  assert.equal(aiAutosendMode(state({}, { shadowMode: false })), "live");
  const paused = state({}, { paused: { code: "provider_down", byKind: "service", at: "2026-10-06T21:14:00Z", reasonRu: "Сессия WhatsApp не в работе" } });
  assert.deepEqual(paused.pause, { code: "provider_down", byKind: "service", at: "2026-10-06T21:14:00Z", reasonRu: "Сессия WhatsApp не в работе" });
  assert.equal(aiAutosendPauseReason(paused.pause), "WhatsApp не на связи");
  assert.equal(aiAutosendPauseReason({ code: "manual", byKind: "user", at: null, reasonRu: null }), "поставлена вручную");
  assert.equal(aiAutosendPauseReason({ code: "provider_restricted", byKind: "service", at: null, reasonRu: null }), "WhatsApp ограничил номер (ошибка 463 или 475)");
  for (const bad of [null, {}, { ...STATE, state: null }, { ...STATE, canManage: "yes" }, { ...STATE, version: 0 },
    { ...STATE, settings: { ...SETTINGS, delayMinSeconds: 20 } }, { ...STATE, settings: { ...SETTINGS, delayMaxSeconds: 25 } },
    { ...STATE, settings: { ...SETTINGS, limitChatHour: 5 } }, { ...STATE, settings: { ...SETTINGS, schedule: { ...SETTINGS.schedule, mon: [{ from: "25:00", to: "09:00" }] } } },
    { ...STATE, settings: { ...SETTINGS, phrases: { ...SETTINGS.phrases, en: null } } }, { ...STATE, state: { ...STATE.state, paused: { code: "Пауза" } } }]) {
    assert.throws(() => normalizeAiAutosendState(bad), /ai_agent_shape_invalid/u, JSON.stringify(bad)?.slice(0, 80));
  }
});

// ------------------------------------------------------------ checks before saving

const settings = (patch = {}) => ({ ...normalizeAiAutosendSettings(SETTINGS), ...patch });
const fields = (value) => aiAutosendSettingsIssues(value).map((issue) => issue.field);

test("settings checks mirror 275: phrases one line, no digits or links, exactly one {day}; delay, limits, dates, days, live test", () => {
  assert.deepEqual(aiAutosendSettingsIssues(settings()), [], "the shipped defaults pass");
  const phrase = (language, kind, text) => {
    const base = normalizeAiAutosendSettings(SETTINGS);
    return { ...base, phrases: { ...base.phrases, [language]: { ...base.phrases[language], [kind]: { text, confirmed: false } } } };
  };
  assert.deepEqual(fields(phrase("ru", "day", "В рабочее время вам позвонит наш руководитель.")), ["phrases.ru.day"], "day without {day}");
  assert.deepEqual(fields(phrase("ru", "day", "{day} и {day} позвонит руководитель.")), ["phrases.ru.day"]);
  assert.deepEqual(fields(phrase("ru", "tomorrow", "{day} позвонит руководитель.")), ["phrases.ru.tomorrow"], "{day} only in the day phrase");
  assert.deepEqual(fields(phrase("ru", "tomorrow", "Позвоним в 10 часов.")), ["phrases.ru.tomorrow"], "no digits");
  assert.deepEqual(fields(phrase("en", "tomorrow", "See evo.kg tomorrow.")), ["phrases.en.tomorrow"], "no links");
  assert.deepEqual(fields(phrase("en", "tomorrow", "See https://example.test")), ["phrases.en.tomorrow"]);
  assert.deepEqual(fields(phrase("ky", "tomorrow", "Эртең <чалат>.")), ["phrases.ky.tomorrow"], "no brackets");
  assert.deepEqual(fields(phrase("ru", "tomorrow", "   ")), ["phrases.ru.tomorrow"]);
  assert.deepEqual(fields(phrase("ru", "tomorrow", "Позвоним.\nЗавтра.")), ["phrases.ru.tomorrow"], "one line");
  assert.deepEqual(fields(settings({ delayMinSeconds: 60, delayMaxSeconds: 45 })), ["delay"]);
  assert.deepEqual(fields(settings({ delayMinSeconds: Number.NaN })), ["delay"]);
  assert.deepEqual(fields(settings({ limitChatHour: 5, limitChatNight: 0, limitNumberHour: 31 })), ["limitChatHour", "limitChatNight", "limitNumberHour"]);
  assert.deepEqual(AI_AUTOSEND_LIMIT_CEILING, { limitChatHour: 4, limitChatNight: 8, limitNumberHour: 30 });
  assert.deepEqual(fields(settings({ workingDays: [] })), ["workingDays"]);
  assert.deepEqual(fields(settings({ dateOverrides: [{ from: "2026-12-01", to: "2027-01-01", mode: "off" }] })), ["dateOverrides.0"], "32 days");
  assert.deepEqual(fields(settings({ dateOverrides: [{ from: "2026-12-01", to: "2026-12-31", mode: "off" }] })), [], "31 days");
  assert.deepEqual(fields(settings({ dateOverrides: [{ from: "2026-12-05", to: "2026-12-01", mode: "on" }] })), ["dateOverrides.0"]);
  assert.deepEqual(fields(settings({ liveTestConversationIds: [ID(1), ID(2), ID(3), ID(4)] })), ["liveTest"]);
  // Через полночь (275: from ≥ to) — подсказка «→ 09:00 след. дня».
  assert.equal(aiAutosendOvernight({ from: "20:00", to: "09:00" }), "→ 09:00 след. дня");
  assert.equal(aiAutosendOvernight({ from: "21:00", to: "21:00" }), "→ 21:00 след. дня", "a full day is overnight too");
  assert.equal(aiAutosendOvernight({ from: "13:00", to: "15:00" }), null);
  // Ссылка на чат «Продажи → WhatsApp» или сам id → id диалога.
  assert.equal(aiAutosendConversationFromLink(`https://crm.evoadmissions.com/v3/inbox?conversation=${ID(5).toUpperCase()}`), ID(5));
  assert.equal(aiAutosendConversationFromLink(`/v3/inbox?conversation=${ID(5)}&q=x`), ID(5));
  assert.equal(aiAutosendConversationFromLink(ID(6)), ID(6));
  for (const bad of ["", "чат Айгерим", `/v3/messages?conversation=${ID(5)}`, "/v3/inbox?conversation=x"]) assert.equal(aiAutosendConversationFromLink(bad), null, bad);
});

test("save: only the changed keys go to 277 — the live-test list only when it changed; phrases are written trimmed", () => {
  const base = normalizeAiAutosendSettings({ ...SETTINGS, liveTestConversationIds: [ID(2), ID(1)] });
  assert.deepEqual(Object.keys(aiAutosendSettingsPatch(base, base)), [], "nothing changed — nothing to write");
  // Сотрудник без права отправки меняет только лимит: список живого теста в записи не появляется
  // (277 при любом его наличии требует communication.manual.send и доступ к чатам).
  assert.deepEqual(aiAutosendSettingsPatch(base, { ...base, limitChatHour: 3 }), { limitChatHour: 3 });
  assert.deepEqual(Object.keys(aiAutosendSettingsPatch(base, { ...base, liveTestConversationIds: [ID(1), ID(2)] })), [],
    "the same chats in another order are the same list (277 stores it sorted)");
  assert.deepEqual(Object.keys(aiAutosendSettingsPatch(base, { ...base, workingDays: [5, 4, 3, 2, 1] })), []);
  assert.deepEqual(aiAutosendSettingsPatch(base, { ...base, liveTestConversationIds: [ID(1)] }), { liveTestConversationIds: [ID(1)] });
  const phrases = { ...base.phrases, ru: { ...base.phrases.ru, tomorrow: { text: base.phrases.ru.tomorrow.text, confirmed: false } } };
  assert.deepEqual(Object.keys(aiAutosendSettingsPatch(base, { ...base, phrases, delayMaxSeconds: 120 })), ["delayMaxSeconds", "phrases"]);
  assert.deepEqual([...AI_AUTOSEND_SETTINGS_KEYS].sort(), Object.keys(base).sort(), "every settings key is compared");
  // 275: text = btrim(text). Пробел по краям проходит проверку CRM (она смотрит на обрезанный текст) — пишется обрезанным.
  const spaced = { ...base, phrases: { ...base.phrases, ru: { ...base.phrases.ru, day: { text: " {day} в рабочее время вам позвонит наш руководитель. ", confirmed: true } } },
    disclosure: { ...base.disclosure, en: { text: "This is the EVO automatic assistant. ", confirmed: true } } };
  assert.deepEqual(aiAutosendSettingsIssues(spaced), []);
  const trimmed = aiAutosendTrimmed(spaced);
  assert.equal(trimmed.phrases.ru.day.text, "{day} в рабочее время вам позвонит наш руководитель.");
  assert.equal(trimmed.disclosure.en.text, "This is the EVO automatic assistant.");
  assert.deepEqual(aiAutosendTrimmed(base), base, "already trimmed settings are unchanged");
  assert.deepEqual(Object.keys(aiAutosendSettingsPatch(base, aiAutosendTrimmed({ ...base, phrases: {
    ...base.phrases, ru: { ...base.phrases.ru, tomorrow: { ...base.phrases.ru.tomorrow, text: `${base.phrases.ru.tomorrow.text}  ` } } } }))), [],
    "a trailing space alone is no change");
  // Действие и форма: форма шлёт обрезанные настройки и исходные; действие ещё раз обрезает и пишет разницу.
  const action = read("src/lib/platform-ai-agent-autosend-actions.ts");
  assert.match(action, /exactActionStringFields\(form, \["request_id", "expected_version", "settings", "baseline"\]\)/u);
  assert.match(action, /settings = aiAutosendTrimmed\(normalizeAiAutosendSettings\(JSON\.parse\(raw\)\)\);/u);
  assert.match(action, /const patch = aiAutosendSettingsPatch\(baseline, settings\);/u);
  const form = read("src/components/v3/ai-agent/AiAutosendSettingsForm.tsx");
  assert.match(form, /name="settings" value=\{JSON\.stringify\(aiAutosendTrimmed\(draft\)\)\}/u);
  assert.match(form, /name="baseline" value=\{JSON\.stringify\(initial\)\}/u);
  // Отказы списка живого теста — своим текстом, не «Нет права менять настройки».
  const source = read("src/lib/v3/ai-agent-autosend-source.ts");
  assert.match(source, /code === "42501" && message === "ai_autosend_sender_required"\) return "sender_required";/u);
  assert.match(source, /code === "42501" && message === "ai_conversation_unavailable"\) return "chat_unavailable";/u);
  assert.match(source, /p_patch: input\.patch,/u);
  assert.match(form, /sender_required: "Чаты живого теста меняет только тот, кто сам отвечает клиентам в WhatsApp\./u);
});

test("RPC names the CRM calls exist in the P4 schema (275–277): the chat read is ai_agent_autosend_conversation_v1", (t) => {
  const files = ["src/lib/server/ai-agent-route-handlers.ts", "src/lib/v3/ai-agent-autosend-source.ts", "src/lib/server/ai-agent-send.ts"];
  const called = new Set(files.flatMap((file) => [...read(file).matchAll(/"(ai_(?:agent_)?autosend[a-z_]*_v1)"/gu)].map((match) => match[1])));
  assert.ok(called.has("ai_agent_autosend_conversation_v1") && !called.has("ai_agent_autosend_chat_v1"));
  const migrations = ["275_platform_ai_agent_autosend_schema.sql", "276_platform_ai_agent_autosend_send_path.sql", "277_platform_ai_agent_autosend_rpc.sql"];
  // Ветка схемы P4 ещё не под этой (стек нелинейный): после посадки — файлы репозитория, до неё — git show ветки схемы.
  const ref = process.env.EVO_AI_P4_SCHEMA_REF ?? "origin/izzhackt/ai-agent-p4-schema";
  let sql;
  if (migrations.every((name) => existsSync(new URL(`../supabase/migrations/${name}`, import.meta.url)))) {
    sql = migrations.map((name) => read(`supabase/migrations/${name}`)).join("\n");
  } else {
    try {
      sql = migrations.map((name) => execFileSync("git", ["show", `${ref}:supabase/migrations/${name}`], {
        cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024,
      })).join("\n");
    } catch {
      t.skip(`P4 schema migrations are neither in this tree nor readable at ${ref}`);
      return;
    }
  }
  const defined = new Set([...sql.matchAll(/CREATE OR REPLACE FUNCTION platform\.(ai_(?:agent_)?autosend[a-z_]*_v1)\(/gu)].map((match) => match[1]));
  for (const name of called) assert.ok(defined.has(name), `${name} is not a platform function of 275–277`);
  // Коды итога, которые пишет маршрут отправки, имеют слова в журнале.
  for (const code of ["provider_restricted", "authorization_expired", "provider_down", "send_failed", "send_unknown"]) {
    assert.equal(typeof AI_AUTOSEND_OUTCOME_RU[code], "string", code);
  }
});

test("«Отвечает» lock: three shadow nights, confirmed RU phrases and disclosure, no pause — the same order 277 refuses in", () => {
  assert.equal(nightsWord(1), "1 ночь");
  assert.equal(nightsWord(2), "2 ночи");
  assert.equal(nightsWord(5), "5 ночей");
  assert.equal(nightsWord(11), "11 ночей");
  assert.equal(nightsWord(21), "21 ночь");
  assert.equal(aiAutosendLiveLock(state({}, { shadowNights: 1 })), "Нужно ещё 2 ночи проверки");
  assert.equal(aiAutosendLiveLock(state({}, { shadowNights: 2 })), "Нужно ещё 1 ночь проверки");
  const nights = { shadowNights: 3 };
  assert.equal(aiAutosendLiveLock(state({}, nights)), "Сначала подтвердите строку о помощнике");
  const confirmed = { ...SETTINGS, disclosure: { ...SETTINGS.disclosure, ru: { ...SETTINGS.disclosure.ru, confirmed: true } } };
  assert.equal(aiAutosendLiveLock(state({ settings: confirmed }, nights)), null);
  assert.equal(aiAutosendLiveLock(state({ settings: { ...SETTINGS, disclosureEnabled: false } }, nights)), null, "no disclosure line — nothing to confirm");
  const unconfirmedRu = { ...confirmed, phrases: { ...SETTINGS.phrases, ru: { ...SETTINGS.phrases.ru, day: { ...SETTINGS.phrases.ru.day, confirmed: false } } } };
  assert.equal(aiAutosendLiveLock(state({ settings: unconfirmedRu }, nights)), "Сначала подтвердите русские финальные фразы");
  assert.equal(aiAutosendLiveLock(state({ settings: confirmed }, { ...nights, paused: { code: "manual", byKind: "user", at: null } })), "Сначала снимите паузу");
});

// ------------------------------------------------------------ journal, summary, chat

test("journal: 277 rows with text only for readable chats, outcome codes in words, single-status filters", () => {
  const journal = normalizeAiAutosendJournal({
    items: [
      { id: ID(10), conversationId: ID(1), clientMessageId: ID(20), sourceAt: "2026-10-06T21:11:00Z", intervalStart: "2026-10-06T14:00:00Z",
        intervalEnd: "2026-10-07T03:00:00Z", status: "shadow", mode: "shadow", kind: "answer", reasonCode: null, reasonRu: null, language: "ru",
        citedChunkIds: [101], callDate: null, sendAt: "2026-10-06T21:12:00Z", delaySeconds: 42, outcomeCode: null, createdAt: "2026-10-06T21:11:05Z",
        committedAt: "2026-10-06T21:11:20Z", authorizedAt: null, finishedAt: null, textHidden: false,
        text: "Здравствуйте! Магистратура в Малайзии длится полтора-два года.", qualification: { country: "Малайзия" } },
      { id: ID(11), conversationId: ID(2), clientMessageId: ID(21), sourceAt: "2026-10-06T21:20:00Z", intervalStart: "2026-10-06T14:00:00Z",
        intervalEnd: "2026-10-07T03:00:00Z", status: "skipped", mode: "shadow", kind: null, reasonCode: "staff_active",
        reasonRu: "Сотрудник отвечал или был активен в чате последние 15 минут", language: null, citedChunkIds: [], callDate: null, sendAt: null,
        delaySeconds: null, outcomeCode: null, createdAt: "2026-10-06T21:20:02Z", committedAt: null, authorizedAt: null, finishedAt: null,
        textHidden: true, text: null, qualification: null },
      { id: ID(12), conversationId: ID(3), status: "failed", mode: "live", kind: "final_phrase", reasonRu: null, language: "ru", callDate: "2026-10-07",
        outcomeCode: "provider_restricted", createdAt: "2026-10-06T22:00:00Z", textHidden: false, text: "Завтра в рабочее время вам позвонит наш руководитель." },
    ],
    next: { beforeCreatedAt: "2026-10-06T22:00:00Z", beforeId: ID(12) },
  });
  assert.equal(journal.items.length, 3);
  assert.equal(journal.items[0].text, "Здравствуйте! Магистратура в Малайзии длится полтора-два года.");
  assert.equal(journal.items[0].conversationTitle, null, "names are resolved by the CRM reader");
  assert.equal(journal.items[1].text, null);
  assert.equal(journal.items[1].textHidden, true);
  assert.equal(aiAutosendJournalReason(journal.items[1]), "Сотрудник отвечал или был активен в чате последние 15 минут");
  assert.equal(aiAutosendJournalReason(journal.items[2]), "WhatsApp ограничил номер (463 или 475)");
  assert.equal(journal.items[2].callDate, "2026-10-07");
  assert.deepEqual(journal.next, { beforeCreatedAt: "2026-10-06T22:00:00Z", beforeId: ID(12) });
  assert.throws(() => normalizeAiAutosendJournal({ items: [{ id: ID(1), conversationId: ID(1), createdAt: "x", status: "sent" }] }), /ai_agent_shape_invalid/u);
  assert.throws(() => normalizeAiAutosendJournal({ items: [{ id: ID(1), conversationId: ID(1), createdAt: "2026-10-06T22:00:00Z", status: "maybe" }] }), /ai_agent_shape_invalid/u);
});

test("summary: hidden chats keep only counts and reasons; reason codes in Russian; qualification keys of 275; no summary yet", () => {
  const read = normalizeAiAutosendSummary({
    summary: {
      id: ID(40), intervalStart: "2026-10-05T14:00:00Z", intervalEnd: "2026-10-06T03:00:00Z", shadowNight: true, status: "ready",
      counts: { conversations: 2, considered: 5, answered: 2, finalPhrases: 1, shadow: 3, skipped: 2 },
      items: [
        { conversationId: ID(1), considered: 3, answered: 2, finalPhrase: true, callDate: "2026-10-06", statuses: { shadow: 3 },
          reasons: { limit_chat_hour: 1 }, qualification: { country: "Малайзия", grade_or_age: "11 класс", call_time: "после 18:00", phone: "+996" },
          taskId: null, taskSkipped: false, hidden: false },
        { hidden: true, considered: 2, answered: 0, finalPhrase: false, statuses: { skipped: 2 }, reasons: { staff_active: 1, media_only: 1, "Bad code": 3 } },
      ],
    },
    shadowNights: 1,
  });
  assert.equal(read.shadowNights, 1);
  const [visible, hidden] = read.summary.items;
  assert.deepEqual(visible.qualification, { country: "Малайзия", grade_or_age: "11 класс", call_time: "после 18:00" }, "only the seven keys");
  assert.deepEqual(visible.reasons, [{ ru: "Лимит ответов в чате за час", count: 1 }]);
  assert.equal(visible.callDate, "2026-10-06");
  assert.equal(hidden.conversationId, null);
  assert.equal(hidden.hidden, true);
  assert.deepEqual(hidden.qualification, {});
  assert.deepEqual(hidden.reasons.map((reason) => reason.ru).sort(), ["В сообщении только медиа", "Сотрудник отвечал или был активен в чате последние 15 минут"]);
  assert.deepEqual(read.summary.counts, { conversations: 2, considered: 5, answered: 2, finalPhrases: 1 });
  assert.equal(read.summary.shadow, true);
  assert.deepEqual(normalizeAiAutosendSummary({ summary: null, shadowNights: 0 }), { summary: null, shadowNights: 0 });
});

test("chat: off, shadow, live test, live; the chip only where it would really answer tonight", () => {
  const chat = (fields) => normalizeAiAutosendChat({ conversationId: ID(1), enabled: true, mode: "shadow", paused: false, pauseCode: null,
    inside: false, window: {}, excluded: false, handedOff: false, lastDecision: null, ...fields });
  assert.equal(chat({ enabled: false }).mode, "off");
  assert.equal(chat({}).mode, "shadow");
  assert.equal(chat({ mode: "live_test" }).liveTest, true);
  assert.equal(chat({ mode: "live" }).mode, "live");
  assert.equal(aiAutosendAnswersHere(chat({ mode: "live" }), true), true);
  assert.equal(aiAutosendAnswersHere(chat({ mode: "live_test" }), true), true);
  assert.equal(aiAutosendAnswersHere(chat({}), true), false, "shadow sends nothing");
  assert.equal(aiAutosendAnswersHere(chat({ mode: "live" }), false), false, "server switch off");
  assert.equal(aiAutosendAnswersHere(chat({ mode: "live", paused: true }), true), false);
  assert.equal(aiAutosendAnswersHere(chat({ mode: "live", excluded: true }), true), false);
  assert.equal(aiAutosendChatLine(chat({}), true), "Проверка без отправки — клиенту ничего не уходит.");
  assert.equal(aiAutosendChatLine(chat({ excluded: true }), true), "Чат исключён — автоответчик сюда не пишет.");
  assert.equal(aiAutosendChatLine(chat({ mode: "live" }), false), "Отправка выключена на сервере.");
  assert.equal(aiAutosendChatLine(chat({ mode: "live", handedOff: true }), true), "Финальная фраза сказана — до утра молчит.");
  assert.equal(aiAutosendChatLine(chat({ mode: "live_test" }), true), "Живой тест: ночью отвечает по-настоящему.");
  assert.throws(() => normalizeAiAutosendChat({ enabled: true, excluded: false, mode: "on" }), /ai_agent_shape_invalid/u);
  // Окно ИИ читает ответ маршрута — уже нормализованный вид — и проверяет его строго (живой тест не теряется).
  const liveTest = chat({ mode: "live_test" });
  assert.deepEqual(normalizeAiAutosendChatView(JSON.parse(JSON.stringify(liveTest))), liveTest);
  assert.deepEqual(normalizeAiAutosendChatView(JSON.parse(JSON.stringify(chat({ enabled: false })))), chat({ enabled: false }));
  for (const bad of [{ ...liveTest, mode: "live_test" }, { ...liveTest, enabled: false }, { ...liveTest, handedOff: undefined }]) {
    assert.throws(() => normalizeAiAutosendChatView(bad), /ai_agent_shape_invalid/u, JSON.stringify(bad));
  }
  assert.equal(aiAutosendServerState({ EVO_AI_AGENT_AUTOSEND: "1", EVO_AI_AGENT_SEND_SECRET: "a".repeat(40) }), "on");
  assert.equal(aiAutosendServerState({ EVO_AI_AGENT_AUTOSEND: "0", EVO_AI_AGENT_SEND_SECRET: "a".repeat(40) }), "off");
});

// ------------------------------------------------------------ section route

test("route: «Автоответчик» is the sixth sub-page; view, status and summary are strict and only where they belong", () => {
  assert.deepEqual(AI_AGENT_SECTIONS.at(-1), { key: "autosend", title: "Автоответчик" });
  assert.deepEqual(parseAiAgentRoute({ section: "autosend" })?.autosend, { view: "settings", journalFilter: "all", summaryId: null });
  assert.deepEqual(parseAiAgentRoute({ section: "autosend", view: "journal", status: "shadow" })?.autosend, { view: "journal", journalFilter: "shadow", summaryId: null });
  assert.deepEqual(parseAiAgentRoute({ section: "autosend", view: "summary", summary: ID(40).toUpperCase() })?.autosend, { view: "summary", journalFilter: "all", summaryId: ID(40) });
  for (const query of [
    { section: "autosend", view: "settings" }, { section: "autosend", view: "log" }, { section: "autosend", status: "sent" },
    { section: "autosend", view: "journal", status: "all" }, { section: "autosend", view: "journal", status: "problems" },
    { section: "autosend", view: "journal", summary: ID(40) }, { section: "autosend", view: "summary", summary: "x" },
    { section: "autosend", document: ID(1) }, { section: "spend", view: "journal" },
  ]) assert.equal(parseAiAgentRoute(query), null, JSON.stringify(query));
  assert.equal(Object.hasOwn(parseAiAgentRoute({ section: "spend" }), "autosend"), false, "other sections keep their exact shape");
  assert.equal(aiAgentHref("autosend"), "/v3/ai-agent?section=autosend");
  assert.equal(aiAgentHref("autosend", { view: "journal", status: "failed" }), "/v3/ai-agent?section=autosend&view=journal&status=failed");
});

// ------------------------------------------------------------ chat route

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    readChat: async (actor, conversationId) => { calls.push(["read", actor, conversationId]); return normalizeAiAutosendChat({ enabled: true, mode: "live", excluded: false, paused: false }); },
    setExclusion: async (actor, conversationId, excluded, requestId) => { calls.push(["exclude", actor, conversationId, excluded, requestId]); return { status: "saved" }; },
    serverOn: () => false,
    ...overrides,
  };
}
const origin = { origin: "https://crm.test", host: "crm.test" };
const autosendPath = (id = ID(1)) => `/api/v3/ai-agent/conversations/${id}/autosend`;
const get = (path = autosendPath()) => new Request(`https://crm.test${path}`);
const put = (body, headers = origin, path = autosendPath()) => new Request(`https://crm.test${path}`, {
  method: "PUT", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const conversation = (id = ID(1)) => ({ params: Promise.resolve({ conversationId: id }) });

test("GET …/autosend: the chat's state and the server switch through the staff session; refusals are honest", async () => {
  const dependencies = deps();
  const response = await createAiAutosendChatReadHandler(dependencies)(get(), conversation());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { chat: { enabled: true, mode: "live", paused: false, excluded: false, liveTest: false, handedOff: false }, serverOn: false });
  assert.deepEqual(dependencies.calls, [["read", ACTOR, ID(1)]]);
  for (const [overrides, status, code] of [
    [{ authorize: async () => ({ status: "anonymous", actor: null }) }, 401, "authentication_required"],
    [{ authorize: async () => ({ status: "preview", actor: null }) }, 403, "preview"],
    [{ readChat: async () => "forbidden" }, 403, "forbidden"],
    [{ readChat: async () => "not_found" }, 404, "not_found"],
    [{ readChat: async () => { throw new Error("db down"); } }, 503, "unavailable"],
  ]) {
    const result = await createAiAutosendChatReadHandler(deps(overrides))(get(), conversation());
    assert.equal(result.status, status, code);
    assert.deepEqual(await result.json(), { error: { code } });
  }
  assert.equal((await createAiAutosendChatReadHandler(deps())(get(`${autosendPath()}?x=1`), conversation())).status, 400);
  assert.equal((await createAiAutosendChatReadHandler(deps())(get(), conversation("x"))).status, 400);
});

test("PUT …/autosend: same origin, exactly {requestId, excluded}; the 277 receipt decides; nothing is sent", async () => {
  const dependencies = deps();
  const response = await createAiAutosendChatExclusionHandler(dependencies)(put({ requestId: ID(7), excluded: true }), conversation());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { excluded: true });
  assert.deepEqual(dependencies.calls, [["exclude", ACTOR, ID(1), true, ID(7)]]);
  for (const [request, status] of [
    [put({ requestId: ID(7), excluded: true }, { host: "crm.test" }), 403],
    [put({ requestId: ID(7), excluded: true }, { origin: "https://evil.test", host: "crm.test" }), 403],
    [put({ requestId: ID(7) }), 400],
    [put({ requestId: ID(7), excluded: "yes" }), 400],
    [put({ requestId: ID(7), excluded: false, text: "x" }), 400],
    [put({ requestId: "x", excluded: false }), 400],
    [put({ requestId: ID(7), excluded: false }, origin, `${autosendPath()}?all=1`), 400],
  ]) {
    const calls = deps();
    assert.equal((await createAiAutosendChatExclusionHandler(calls)(request, conversation())).status, status);
    assert.equal(calls.calls.length, 0, "nothing reaches the database");
  }
  for (const [result, status, code] of [
    [{ status: "conflict" }, 409, "request_conflict"], [{ status: "forbidden" }, 403, "forbidden"],
    [{ status: "not_found" }, 404, "not_found"], [{ status: "invalid" }, 400, "invalid_request"], [{ status: "unavailable" }, 503, "unavailable"],
  ]) {
    const result2 = await createAiAutosendChatExclusionHandler(deps({ setExclusion: async () => result }))(put({ requestId: ID(7), excluded: false }), conversation());
    assert.equal(result2.status, status);
    assert.deepEqual(await result2.json(), { error: { code } });
  }
  // Квитанция 277: {status: 'applied', conversationId, excluded, cancelled}; другая форма — сбой.
  assert.deepEqual(aiAutosendExclusionOutcome(null, { status: "applied", conversationId: ID(1), excluded: true, cancelled: 1 }, true), { status: "saved" });
  assert.deepEqual(aiAutosendExclusionOutcome(null, { status: "applied", excluded: false }, true), { status: "unavailable" });
  assert.deepEqual(aiAutosendExclusionOutcome(null, null, true), { status: "unavailable" });
  assert.deepEqual(aiAutosendExclusionOutcome({ code: "42501" }, null, true), { status: "forbidden" });
  assert.deepEqual(aiAutosendExclusionOutcome({ code: "PT409" }, null, true), { status: "conflict" });
});

// ------------------------------------------------------------ route contract (урок 06.10)

const AUTOSEND_NEAR_MISSES = [
  "/api/v3/ai-agent/conversations/autosend",
  `/api/v3/ai-agent/conversations/${ID(1)}/autosend/`,
  `/api/v3/ai-agent/conversations/${ID(1)}/autosend/send`,
  `/api/v3/ai-agent/conversations/${ID(1)}/autosends`,
  "/api/v3/ai-agent/conversations/0D6F2C3E-9A41-4B7E-B2A8-5C1E7F90AB34/autosend",
  "/api/v3/ai-agent/conversations/27700000-0000-0000-8000-000000000001/autosend",
  "/api/v3/ai-agent/conversations/x/autosend",
  `/api/v3/ai-agent/autosend/${ID(1)}`,
];
const SEND_NEAR_MISSES = [
  "/api/internal/ai-agent/send/", "/api/internal/ai-agent/send/x", "/api/internal/ai-agent/sends", "/api/internal/ai-agent/Send",
  "/api/internal/ai-agent", "/api/internal/ai-agent/send.json", "/api/v3/ai-agent/send",
];

test("route contract: the send route is one exact private path; the chat route is a strict browser API; near misses stay closed", () => {
  assert.equal(isConnectedPlatformPrivateApi("/api/internal/ai-agent/send"), true);
  assert.equal(isConnectedPlatformApi("/api/internal/ai-agent/send"), true);
  assert.equal(isConnectedPlatformPage("/api/internal/ai-agent/send"), false);
  for (const path of SEND_NEAR_MISSES) {
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
  for (const id of [ID(1), "0d6f2c3e-9a41-4b7e-b2a8-5c1e7f90ab34"]) {
    const path = autosendPath(id);
    assert.equal(isConnectedPlatformApi(path), true, path);
    assert.equal(isConnectedPlatformPrivateApi(path), false, path);
    assert.equal(isRetiredPlatformRoute(path), false, path);
  }
  for (const path of AUTOSEND_NEAR_MISSES) assert.equal(isConnectedPlatformApi(path), false, path);
  // Урок 06.10: каждый новый route.ts — под шаблоном контракта, иначе в production 403.
  const chatRoute = read("src/app/api/v3/ai-agent/conversations/[conversationId]/autosend/route.ts");
  assert.match(chatRoute, /export const GET = createAiAutosendChatReadHandler\(\);/u);
  assert.match(chatRoute, /export const PUT = createAiAutosendChatExclusionHandler\(\);/u);
  assert.doesNotMatch(chatRoute, /export const (?:POST|PATCH|DELETE)/u);
  const sendRoute = read("src/app/api/internal/ai-agent/send/route.ts");
  assert.match(sendRoute, /export const runtime = "nodejs";/u);
  assert.match(sendRoute, /export const dynamic = "force-dynamic";/u);
});

async function loadBundledProxy() {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL("../src/proxy.ts", import.meta.url))],
    bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports.proxy;
}

test("real proxy: the send route passes to its own handler without a session; the chat route meets the session gate; near misses are 403", async () => {
  const proxy = await loadBundledProxy();
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:45421";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_routing-boundary-only";
  const request = (path, method) => new NextRequest(`https://crm.evoadmissions.com${path}`, { method, headers: { host: "crm.evoadmissions.com" } });
  try {
    const send = await proxy(request("/api/internal/ai-agent/send", "POST"));
    assert.equal(send.headers.get("x-middleware-next"), "1", "the handler owns switch, HMAC and body");
    for (const method of ["GET", "PUT"]) {
      const response = await proxy(request(autosendPath(), method));
      assert.equal(response.status, 401, method);
      assert.deepEqual(await response.json(), { error: "authentication_required" }, method);
    }
    for (const path of [...AUTOSEND_NEAR_MISSES, ...SEND_NEAR_MISSES]) {
      const response = await proxy(request(path, "POST"));
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error, "platform_route_not_connected", path);
    }
  } finally {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
  }
});

// ------------------------------------------------------------ transcript (276)

const message = (fields = {}) => ({
  message_id: ID(30), direction: "outbound", body_text: "Здравствуйте! Магистратура длится полтора-два года.", created_at: "2026-10-06T21:12:30Z",
  media: [], waha_ack_name: "SERVER", waha_ack_observed_at: "2026-10-06T21:12:31Z", origin: "autoreply",
  sender_name: "Айгерим Синтетическая", sender_membership_id: ID(91), ...fields,
});

test("transcript: «Автоответчик» rows carry the responsible member; never inbound, never without a sender; manual rows unchanged", () => {
  const row = normalizePlatformWhatsAppChatMessage(message());
  assert.equal(row.origin, "autoreply");
  assert.equal(row.senderMembershipId, ID(91));
  for (const bad of [message({ sender_membership_id: null, sender_name: null }), message({ direction: "inbound" }), message({ origin: "robot" })]) {
    assert.throws(() => normalizePlatformWhatsAppChatMessage(bad), undefined, JSON.stringify(bad.origin));
  }
  assert.equal(normalizePlatformWhatsAppChatMessage(message({ origin: "crm" })).origin, "crm");
  assert.throws(() => normalizePlatformWhatsAppChatMessage(message({ origin: "phone" })), undefined, "a phone message names no member");
  const chat = { inbound: false, origin: "autoreply", senderName: "Айгерим Синтетическая", senderIsViewer: true };
  assert.equal(originWord(chat), "Автоответчик", "the label is the same for the responsible member");
  assert.equal(speakerPrefix(chat), "Автоответчик, от имени Айгерим Синтетическая:");
  assert.equal(autoreplyOnBehalf("Айгерим Синтетическая"), "от имени Айгерим Синтетическая");
  assert.equal(autoreplyOnBehalf(null), null);
  assert.equal(originWord({ ...chat, origin: "crm", senderIsViewer: true }), "из CRM, вы");
});

const attempt = (fields = {}) => ({
  attempt_id: null, work_item_id: ID(50), request_id: ID(51), status: "queued", reconciliation_required: false,
  final_text: "Завтра в рабочее время вам позвонит наш руководитель.", authorized_by_membership_id: ID(91),
  authorized_by_name: "Айгерим Синтетическая", authorized_at: "2026-10-06T21:12:00Z", claimed_at: null, failure_code: null,
  latest_reconciliation_outcome: null, last_reconciled_at: null, source_message_id: ID(20), readback_settled: false, ...fields,
});
const chatState = (attempts) => ({
  latest_inbound_message_id: ID(20), latest_inbound_at: "2026-10-06T21:11:00Z", newest_message_id: ID(20),
  newest_message_at: "2026-10-06T21:11:00Z", attempts,
});

test("chat state: only an autoresponder attempt carries kind (276); manual attempts parse exactly as before", () => {
  const parsed = normalizePlatformWhatsAppChatState(chatState([attempt(), attempt({ work_item_id: ID(52), kind: "ai_autosend" })]));
  assert.deepEqual(parsed.attempts.map((item) => item.kind), ["manual", "ai_autosend"]);
  assert.throws(() => normalizePlatformWhatsAppChatState(chatState([attempt({ kind: "robot" })])));
  assert.throws(() => normalizePlatformWhatsAppChatState(chatState([attempt({ kind: "ai_autosend", extra: 1 })])));
  // Пузырь автоответа: своя подпись, без «Повторить» и «Вернуть текст в поле» (автор — не смотрящий).
  const [bubble] = outgoingBubbles([{
    autoreply: true, attemptId: null, workItemId: ID(52), requestId: ID(53), status: "queued", reconciliationRequired: false,
    text: "Завтра в рабочее время вам позвонит наш руководитель.", authorName: "Айгерим Синтетическая", authorIsViewer: false,
    at: "2026-10-06T21:12:00Z", claimedAt: null, sourceMessageId: ID(20), failureCode: null, readback: null, readbackSettled: false,
  }], [], new Set(), new Set(), Date.parse("2026-10-06T21:15:00Z"));
  assert.equal(bubble.autoreply, true);
  assert.equal(bubble.state, "stalled", "an unclaimed autoreply after a minute no longer holds the chat");
  assert.equal(bubble.resend, null);
  const source = read("src/lib/v3/inbox-source.ts");
  assert.match(source, /authorIsViewer: !autoreply && attempt\.authorizedByMembershipId === viewerMembershipId\.toLowerCase\(\),/u);
  const chatView = read("src/components/v3/inbox/InboxChat.tsx");
  assert.match(chatView, /const returnAction = canAct && !bubble\.autoreply/u);
  assert.match(chatView, /Не ушло: автоответ не отправлен/u);
});

// ------------------------------------------------------------ env contract

test("env: EVO_AI_AGENT_AUTOSEND is '', 0 or 1; 1 needs the agent secret and its own send secret; both examples ship it off", () => {
  const exampleText = read("deploy/env.production.example");
  assert.match(exampleText, /^EVO_AI_AGENT_AUTOSEND=0$/mu);
  assert.match(exampleText, /^EVO_AI_AGENT_SEND_SECRET=$/mu);
  assert.match(read(".env.example"), /^EVO_AI_AGENT_AUTOSEND=0$/mu);
  const ref = "aaaaaaaaaaaaaaaaaaaa";
  const internal = "s".repeat(24) + "-synthetic-ai-agent-secret";
  const sendSecret = "a".repeat(24) + "-synthetic-autosend-send-secret";
  const base = {
    EVO_CRM_DOMAIN: "crm.evoadmissions.com", EVO_CADDY_NETWORK: "evo_public_web",
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_runtime_safe",
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_ssssssssssssssssssssssss", EVO_PLATFORM_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
    EVO_STAFF_ADMIN_LOGIN_EMAIL: "", EVO_PLATFORM_WAHA_INGRESS_ENABLED: "0", EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET: "",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: "", EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "0", EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "",
    ANTHROPIC_API_KEY: "", ZAI_API_KEY: "", NEXT_PUBLIC_TRANSCRIPTION_SPLINE_SCENE_URL: "", EVO_ENABLE_LOCAL_TRANSCRIPTION: "0",
  };
  const text = (extra = {}) => Object.entries({ ...base, ...extra }).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`).join("\n");
  const check = (actualText) => validateAppEnvironmentContract({ exampleText, actualText, expectedSupabaseProjectRef: ref });
  const valid = { ok: true, code: "valid" };
  assert.deepEqual(check(text()), valid, "a release without the names stays valid (off)");
  assert.deepEqual(check(text({ EVO_AI_AGENT_AUTOSEND: "" })), valid);
  assert.deepEqual(check(text({ EVO_AI_AGENT_AUTOSEND: "0", EVO_AI_AGENT_SEND_SECRET: sendSecret })), valid, "a staged secret with the switch off");
  assert.deepEqual(check(text({ EVO_AI_AGENT_AUTOSEND: "1", EVO_AI_AGENT_INTERNAL_SECRET: internal, EVO_AI_AGENT_SEND_SECRET: sendSecret })), valid);
  for (const flag of ["true", "yes", "2", "on", "01"]) {
    assert.throws(() => check(text({ EVO_AI_AGENT_AUTOSEND: flag })), /unsafe_runtime_flag/u, flag);
  }
  assert.throws(() => check(text({ EVO_AI_AGENT_AUTOSEND: "1", EVO_AI_AGENT_SEND_SECRET: sendSecret })), /enabled_feature_configuration_missing/u, "no agent");
  assert.throws(() => check(text({ EVO_AI_AGENT_AUTOSEND: "1", EVO_AI_AGENT_INTERNAL_SECRET: internal })), /enabled_feature_configuration_missing/u, "no send secret");
  for (const bad of ["short", `${sendSecret} space`]) {
    assert.throws(() => check(text({ EVO_AI_AGENT_SEND_SECRET: bad })), /optional_feature_configuration_invalid/u, bad);
  }
  assert.throws(() => check(text({ EVO_AI_AGENT_INTERNAL_SECRET: internal, EVO_AI_AGENT_SEND_SECRET: internal })),
    /optional_feature_configuration_invalid/u, "the send secret is its own");
});

// ------------------------------------------------------------ UI source

test("UI copy: the spec's Russian words, one red action, switch semantics, AI-window strip under the memory block", () => {
  const view = read("src/components/v3/ai-agent/AiAutosendView.tsx");
  const form = read("src/components/v3/ai-agent/AiAutosendSettingsForm.tsx");
  const mode = read("src/components/v3/ai-agent/AiAutosendModeSwitch.tsx");
  const contract = read("src/lib/v3/ai-agent-autosend.ts");
  for (const phrase of ["Проверка без отправки", "Отвечает", "Нужно ещё ${nightsWord(left)} проверки", "след. дня", "Включён весь день",
    "Выключен", "нужна проверка", "Проверено", "Настройки изменились — обновите страницу", "Автоответчик на паузе", "Снять паузу",
    "Отправка выключена на сервере", "Ночью отвечает автоответчик", "Автоответчик в этом чате"]) {
    assert.ok(contract.includes(phrase), phrase);
  }
  assert.match(view, /Ответственный: <span className="text-fg">/u);
  assert.match(view, /AI_AUTOSEND_COPY\.pauseBanner\}:<\/span> \{aiAutosendPauseReason\(state\.pause\)\}/u);
  assert.equal((form.match(/\bbtnCls\b/gu) ?? []).length, 2, "«Сохранить настройки» is the one red action (import + one use)");
  assert.match(form, /className=\{`\$\{btnCls\} \$\{SAVE_IDLE\}`\} disabled=\{pending\} aria-disabled=\{!dirty \|\| undefined\}/u, "and only with changes");
  assert.doesNotMatch(view, /btnCls\b/u, "enable, pause and disable are never red");
  assert.match(mode, /aria-pressed=\{selected\}/u);
  assert.match(mode, /aria-disabled=\{locked \|\| pending \|\| undefined\}/u);
  // «Отвечает» — настоящие ответы клиентам: только после подтверждения плашкой; «Проверка без отправки» — сразу.
  assert.match(mode, /if \(next === "shadow"\) \{ submit\("shadow"\); return; \}/u);
  assert.match(mode, /data-testid="v3-ai-autosend-live-confirm"/u);
  assert.match(mode, /submit\("live"\);/u);
  assert.equal((mode.match(/submit\("live"\)/gu) ?? []).length, 1, "the only live write is the confirm button");
  const toggle = read("src/components/v3/inbox/InboxAiAutosend.tsx");
  assert.match(toggle, /role="switch"/u);
  assert.match(toggle, /aria-checked=\{on\}/u);
  assert.match(toggle, /if \(load\.kind === "hidden" \|\| load\.kind === "loading"\) return null;/u, "an org without the autoresponder shows nothing");
  const assistant = read("src/components/v3/inbox/InboxAiAssistant.tsx");
  const body = assistant.slice(assistant.indexOf('<div className="v3-ai-body">'));
  assert.ok(body.indexOf("<InboxAiMemory conversationId={conversationId} />") < body.indexOf("<InboxAiAutosend conversationId={conversationId} />"));
  assert.ok(body.indexOf("<InboxAiAutosend conversationId={conversationId} />") < body.indexOf('phase.kind === "loading"'));
  const inbox = read("src/components/v3/Inbox.tsx");
  assert.match(inbox, /open\.chat\.autoreplyAtNight \? \(/u);
  const page = read("src/app/(v3)/v3/ai-agent/page.tsx");
  assert.match(page, /readAiAutosend\(actor\),/u, "the pause line is read on every sub-page");
  assert.match(page, /compactHref=\{aiAgentHref\("autosend"\)\}/u);
  // Ни один экран не обращается к WAHA или маршруту отправки из браузера.
  for (const file of ["src/components/v3/ai-agent/AiAutosendView.tsx", "src/components/v3/ai-agent/AiAutosendSettingsForm.tsx",
    "src/components/v3/inbox/InboxAiAutosend.tsx"]) {
    assert.doesNotMatch(read(file), /api\/internal|sendText|waha/iu, file);
  }
  assert.equal(AI_AUTOSEND_COPY.chatToggle, "Автоответчик в этом чате");
});
