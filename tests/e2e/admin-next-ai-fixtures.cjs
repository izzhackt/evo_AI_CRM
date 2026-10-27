"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Синтетика «ИИ-агента» (ответы Gemini в чате продаж) для потока «admin»: материалы, лист сверки, Лаборатория, правила, расходы и автоответчик
 * в форме чтений `ai-agent-source`. Документы, числа, вопросы и люди ВЫДУМАНЫ; Gemini, Storage и базы здесь нет. Данные взяты из
 * `ai-agent-p2-static-render.cjs` и `ai-agent-p4-ui.test.mjs` (те же формы ответов базы 269–277), чтобы не придумывать их заново.
 */
const { ROOT, join } = require("./admin-next-env.cjs");

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const id = (n) => `eeeeeeee-7777-4777-8777-${String(n).padStart(12, "0")}`;
const SCAN = id(301), PRICE = id(302), POLICY = id(303), BOOKLET = id(304), BOOKLET_V2 = id(305), FAQ = id(306), PASSPORT = id(307), LOCKED = id(308), DISCOUNTS = id(309);

const doc = (docId, title, fields = {}) => ({
  id: docId, title, kind: "pdf", audience: "client", autosendAllowed: false, status: "ready", stage: null, progress: 100, errorCode: null,
  source: "upload", sourceRef: {}, editedInLab: false, docVersion: 1, rowVersion: 3, pageCount: 4, replacesId: null, supersededById: null,
  createdAt: "2026-10-06T05:00:00Z", updatedAt: "2026-10-06T06:12:00Z", indexedAt: "2026-10-06T05:10:00Z", chunkCount: 18, openReviewCount: 0, ...fields,
});
const DOCUMENTS = { items: [
  doc(BOOKLET_V2, "Буклет EVO 2026", { status: "processing", stage: "ocr", progress: 40, replacesId: BOOKLET, chunkCount: 0, pageCount: 12, updatedAt: "2026-10-06T07:40:00Z" }),
  doc(SCAN, "Прайс 2026 — Малайзия (скан)", { status: "review", openReviewCount: 3, pageCount: 3, chunkCount: 24, docVersion: 2, updatedAt: "2026-10-06T07:31:00Z" }),
  doc(PASSPORT, "scan_0042", { kind: "image", status: "failed", errorCode: "personal_document_suspected", chunkCount: 0, pageCount: 1, updatedAt: "2026-10-06T07:20:00Z" }),
  doc(PRICE, "Прайс 2026 — все страны", { kind: "xlsx", pageCount: 3, chunkCount: 41, updatedAt: "2026-10-06T07:05:00Z" }),
  doc(LOCKED, "Договор-оферта (черновик)", { status: "failed", errorCode: "file_encrypted", chunkCount: 0, pageCount: null, updatedAt: "2026-10-06T06:58:00Z" }),
  doc(FAQ, "Частые вопросы родителей", { kind: "docx", status: "queued", stage: null, progress: 0, chunkCount: 0, pageCount: null, updatedAt: "2026-10-06T06:50:00Z" }),
  doc(POLICY, "Политика возвратов", { kind: "docx", pageCount: 2, chunkCount: 9, editedInLab: true, docVersion: 3, updatedAt: "2026-10-06T06:30:00Z" }),
  doc(BOOKLET, "Буклет EVO 2026", { pageCount: 12, chunkCount: 33, updatedAt: "2026-10-05T12:30:00Z" }),
  doc(DISCOUNTS, "Правила скидок", { kind: "knowledge", source: "seed_kb", sourceRef: { nodeVersion: 2 }, audience: "internal", pageCount: null, chunkCount: 4, updatedAt: "2026-10-05T09:00:00Z" }),
], hasMore: false, canManage: true, isAdmin: false };

const PAGE_W = 1000, PAGE_H = 1300;
const ROWS = [["Компьютерные науки, бакалавриат", "1 250,00 $", "01.09.2027"], ["Бизнес и менеджмент, бакалавриат", "1 180,00 $", "01.09.2027"], ["Инженерия, бакалавриат", "1 390,00 $", "15.09.2027"]];
const PAGE_DETAIL = {
  document: DOCUMENTS.items[1], canManage: true,
  pages: [{ pageNo: 1, method: "ocr", hasImage: true, openReviewCount: 0 }, { pageNo: 2, method: "ocr", hasImage: true, openReviewCount: 2 }, { pageNo: 3, method: "ocr", hasImage: true, openReviewCount: 1 }],
};
const PAGE_2 = {
  documentId: SCAN, docVersion: 2, pageNo: 2, pageCount: 3,
  page: { sheetName: null, method: "ocr", confidence: 0.91, width: PAGE_W, height: PAGE_H, imagePath: `${ORG}/${SCAN}/pages/2.png`, textMd: ROWS.map((row) => `| ${row.join(" | ")} |`).join("\n"), lines: null },
  chunks: [
    { chunkId: 701, position: 3, sectionPath: "Прайс 2026 › Малайзия › Бакалавриат", unverified: true, content: "| Компьютерные науки, бакалавриат | 1 250,00 $ | 01.09.2027 |\n| Бизнес и менеджмент, бакалавриат | 1 180,00 $ | 01.09.2027 |", boxes: [[0.08, 0.235, 0.92, 0.42]] },
    { chunkId: 702, position: 4, sectionPath: "Прайс 2026 › Условия оплаты", unverified: false, content: "Оплата за первый семестр — до начала обучения.", boxes: [[0.08, 0.45, 0.92, 0.635]] },
  ],
  reviewItems: [{ id: id(601), status: "open", proposed: "1 250,00 $", bbox: [0.6, 0.2, 0.78, 0.25] }],
};
const review = (n, fields) => ({
  id: id(600 + n), documentId: SCAN, documentTitle: "Прайс 2026 — Малайзия (скан)", documentVersion: 2, pageNo: 2, kind: "number", status: "open",
  createdAt: `2026-10-06T07:3${n}:00Z`, contextLabel: null, errorCode: null, resolution: null, resolvedAt: null, resolvedByName: null, hasCrop: false, ...fields,
});
const REVIEW = { canManage: true, hasMore: false, counts: { open: 3, applying: 1 }, items: [
  review(1, { contextLabel: "строка «Компьютерные науки, бакалавриат»", proposed: "1 250,00 $", candidates: { tesseract: "1 280,00 $", vision: "1 250,00 $", arbiter: "1 250,00 $", arbiterModel: "gemini-3.1-pro-preview" } }),
  review(2, { contextLabel: "строка «Инженерия, бакалавриат»", proposed: "1 390,00 $", errorCode: "anchor_ambiguous", candidates: { tesseract: "1 890,00 $", vision: "1 390,00 $", arbiter: null, arbiterModel: null } }),
  review(4, { status: "applying", contextLabel: "строка «MBA, магистратура»", proposed: "2 900,00 $", value: "2 900,00 $", candidates: { tesseract: "2 600,00 $", vision: "2 900,00 $", arbiter: "2 900,00 $", arbiterModel: "gemini-3.1-pro-preview" } }),
] };

const REPLY = "Бакалавриат по компьютерным наукам в Малайзии стоит 1 250 $ в год, обучение начинается 1 сентября 2027 года.";
const ANSWER = {
  reply: REPLY, reason: "Цена и дата — из скана прайса (стр. 2).", question: "", language: "ru", warnings: [], citations: [{ n: 1, chunk_id: 701 }],
  reply_citations: [{ n: 1, start: 0, end: Array.from(REPLY).length }],
  sources: [{ n: 1, chunk_id: 701, document_id: SCAN, title: "Прайс 2026 — Малайзия (скан)", audience: "client", page_from: 2, page_to: 2, sheet_name: null, section_path: "Прайс 2026 › Малайзия › Бакалавриат", live: true, missing: false, unverified: true, unverified_values: ["1 250,00 $"], quote: "Компьютерные науки, бакалавриат — 1 250,00 $ в год." }],
};
const QUESTION = "Сколько стоит бакалавриат по компьютерным наукам в Малайзии?";
const LAB = { canManage: true, session: { revision: 2, updatedAt: "2026-10-06T07:44:00Z", expiresAt: "2026-10-06T09:44:00Z", payload: { question: QUESTION, answer: ANSWER, finding: "" } }, proposal: null };
const EXAMPLES = { canManage: true, hasMore: false, items: [
  { id: id(901), question: "Можно ли поступить в Малайзию без IELTS?", answer: "Да: сначала семестр подготовительного английского (640 $), затем бакалавриат.", confirmedAt: "2026-10-05T11:00:00Z", confirmedByName: "Куратор (синтетический)", valid: true, stale: { legacy: false, rules: false, model: false, documents: [] } },
  { id: id(902), question: "Сколько стоит медицина в Малайзии?", answer: "Специалитет по медицине — 4 750 $ в год.", confirmedAt: "2026-10-04T15:20:00Z", confirmedByName: "Менеджер продаж (синтетический)", valid: false, stale: { legacy: false, rules: false, model: false, documents: [SCAN] } },
] };
const SETTINGS = {
  version: 7, models: { answer: "gemini-3.8-flash", fast: "gemini-3.5-flash-lite", embedding: "gemini-embedding-2" }, unpricedModels: [], monthlyCapUsd: 50, ratePerMemberMinute: 20,
  consent: { recorded: true, at: "2026-10-06T04:30:00Z", byName: "Администратор (синтетический)", textVersion: "gemini-v1-2026-10-06" }, memoryEnabled: false, canManage: true, isAdmin: true,
};
const RULES = {
  current: { id: id(50), version: 2, body: "Тон: вежливо, на «вы». Не называем цену без программы и сроков.\nНе обещаем зачисление.", source: "manual", createdAt: "2026-10-06T08:00:00Z", createdByName: "Администратор (синтетический)", confirmedAt: null, confirmedByName: null, needsReview: true },
  versions: [
    { id: id(50), version: 2, source: "manual", createdAt: "2026-10-06T08:00:00Z", createdByName: "Администратор (синтетический)", confirmedAt: null, confirmedByName: null, bytes: 1200, current: true },
    { id: id(49), version: 1, source: "seed", createdAt: "2026-10-01T08:00:00Z", createdByName: null, confirmedAt: "2026-10-02T08:00:00Z", confirmedByName: "Куратор (синтетический)", bytes: 980, current: false },
  ], canManage: true,
};
const SPEND = {
  today: "2026-10-27", monthStart: "2026-10-01", todayUsd: 0.42, monthUsd: 11.8, monthEstimated: true, forecastUsd: 13.4, monthlyCapUsd: 50, reservedUsd: 0.2, remainingUsd: 38, answers: 120, averageAnswerUsd: 0.05,
  byGroup: [{ group: "answers", usd: 8.1, calls: 120, estimated: false }, { group: "search", usd: 1.2, calls: 420, estimated: true }],
  priceChanges: [{ model: "gemini-3.8-flash", kind: "output", effectiveFrom: "2026-11-01", usdPerMillion: 3, previousUsdPerMillion: 2.5 }],
};

const AUTOSEND_SETTINGS = {
  schedule: { mon: [{ from: "20:00", to: "09:00" }], tue: [{ from: "20:00", to: "09:00" }], wed: [{ from: "20:00", to: "09:00" }], thu: [{ from: "20:00", to: "09:00" }], fri: [{ from: "20:00", to: "09:00" }], sat: [{ from: "13:00", to: "15:00" }, { from: "20:00", to: "09:00" }], sun: [] },
  dateOverrides: [{ from: "2026-12-31", to: "2027-01-02", mode: "on" }], workingDays: [5, 1, 2, 3, 4], timezone: "Asia/Bishkek", delayMinSeconds: 30, delayMaxSeconds: 90,
  limitChatHour: 4, limitChatNight: 8, limitNumberHour: 30,
  phrases: {
    ru: { tomorrow: { text: "Завтра в рабочее время вам позвонит наш руководитель.", confirmed: true }, day: { text: "{day} в рабочее время вам позвонит наш руководитель.", confirmed: true } },
    ky: { tomorrow: { text: "Эртең иш убактысында биздин жетекчи сизге чалат.", confirmed: false }, day: { text: "{day} иш убактысында биздин жетекчи сизге чалат.", confirmed: false } },
    en: { tomorrow: { text: "Our manager will call you tomorrow during business hours.", confirmed: false }, day: { text: "Our manager will call you {day} during business hours.", confirmed: false } },
  },
  disclosureEnabled: true,
  disclosure: { ru: { text: "Пишет автоматический помощник EVO.", confirmed: false }, ky: { text: "EVO автоматтык жардамчысы жазып жатат.", confirmed: false }, en: { text: "This is the EVO automatic assistant.", confirmed: false } },
  liveTestConversationIds: [],
};
const autosendRaw = (statePatch = {}) => ({
  settings: AUTOSEND_SETTINGS,
  state: {
    enabled: true, shadowMode: true, consentRecorded: true, paused: null,
    window: { inside: true, intervalStart: "2026-10-27T14:00:00Z", intervalEnd: "2026-10-28T03:00:00Z", nextStart: "2026-10-28T14:00:00Z" },
    responsible: { membershipId: id(91), name: "Айгерим Синтетическая" }, enabledAt: "2026-10-25T14:02:00Z", sendErrorStreak: 0, geminiErrorStreak: 0, shadowNights: 1, shadowNightsRequired: 3,
    finalPhraseNow: { text: "Завтра в рабочее время вам позвонит наш руководитель.", variant: "tomorrow", callDate: "2026-10-28", day: null, confirmed: true, dayWordsReview: false },
    ...statePatch,
  },
  lastSummary: { id: id(40), intervalStart: "2026-10-26T14:00:00Z", intervalEnd: "2026-10-27T03:00:00Z", shadowNight: true, counts: {}, status: "ready" },
  canManage: true, canSend: true, version: 7,
});
const JOURNAL = {
  items: [
    { id: id(10), conversationId: id(1), status: "shadow", mode: "shadow", kind: "answer", language: "ru", createdAt: "2026-10-26T21:11:05Z", textHidden: false, text: "Здравствуйте! Магистратура в Малайзии длится полтора-два года." },
    { id: id(11), conversationId: id(2), status: "skipped", mode: "shadow", kind: null, reasonCode: "staff_active", reasonRu: "Сотрудник отвечал или был активен в чате последние 15 минут", createdAt: "2026-10-26T21:20:02Z", textHidden: true, text: null },
    { id: id(12), conversationId: id(3), status: "failed", mode: "live", kind: "final_phrase", language: "ru", callDate: "2026-10-28", outcomeCode: "provider_restricted", finalReasonCode: "intent_payment", createdAt: "2026-10-26T22:00:00Z", textHidden: false, text: "Завтра в рабочее время вам позвонит наш руководитель." },
  ],
  next: { beforeCreatedAt: "2026-10-26T22:00:00Z", beforeId: id(12) },
};
const SUMMARY = {
  summary: {
    id: id(40), intervalStart: "2026-10-26T14:00:00Z", intervalEnd: "2026-10-27T03:00:00Z", shadowNight: true, status: "ready",
    counts: { conversations: 2, considered: 5, answered: 2, finalPhrases: 1 },
    items: [
      { conversationId: id(1), considered: 3, answered: 2, finalPhrase: true, callDate: "2026-10-28", statuses: { shadow: 3 }, reasons: { limit_chat_hour: 1 }, qualification: { country: "Малайзия", grade_or_age: "11 класс", call_time: "после 18:00" }, taskId: null, taskSkipped: false, hidden: false },
      { hidden: true, considered: 2, answered: 0, finalPhrase: false, statuses: { skipped: 2 }, reasons: { staff_active: 1, media_only: 1 } },
    ],
  },
  shadowNights: 1,
};

/** Свойства «ИИ-агента» (нового вида) по подразделу — как их выдаёт `ai-agent/page.tsx`; `names` — чтения в форме приложения. */
function build() {
  const ai = require(join(ROOT, "src/lib/v3/ai-agent.ts"));
  const kn = require(join(ROOT, "src/lib/v3/ai-agent-knowledge.ts"));
  const au = require(join(ROOT, "src/lib/v3/ai-agent-autosend.ts"));
  const ok = (data) => ({ status: "available", data });
  const ids = (list) => Object.fromEntries(list.map((item, index) => [item.id, id(7000 + index)]));
  const documents = ai.normalizeAiDocuments(DOCUMENTS);
  const failed = documents.items.filter((item) => item.status === "failed");
  const reviewList = kn.normalizeAiReviewList(REVIEW);
  const examples = kn.normalizeAiExamples(EXAMPLES);
  return {
    settings: ai.normalizeAiSettings(SETTINGS),
    documents: ok(documents),
    documentIds: { upload: id(7100), retry: ids(failed), company: ids(failed), remove: ids(documents.items) },
    detail: kn.normalizeAiDocumentDetail(PAGE_DETAIL), page: kn.normalizeAiDocumentPage(PAGE_2),
    review: ok(reviewList), reviewIds: ids(reviewList.items),
    lab: kn.normalizeAiLabState(LAB), examples: ok(examples), exampleIds: ids(examples.items),
    rules: ok(ai.normalizeAiRules(RULES)), spend: ok(ai.normalizeAiSpend(SPEND)),
    autosend: (statePatch) => ok(au.normalizeAiAutosendState(autosendRaw(statePatch))),
    journal: ok(au.normalizeAiAutosendJournal(JOURNAL)), summary: ok(au.normalizeAiAutosendSummary(SUMMARY)),
    ids: { cap: id(7201), revoke: id(7202), memory: id(7203), consent: id(7204), editor: id(7205), confirm: id(7206), lab: { discard: id(7207), reject: id(7208) }, autosend: { settings: id(7301), toggle: id(7302), mode: id(7303), pause: id(7304), resume: id(7305) } },
  };
}

module.exports = { build, DOCUMENTS, SCAN, DISCOUNTS, PASSPORT, id };
