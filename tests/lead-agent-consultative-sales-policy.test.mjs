import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const evaluation = readFileSync(
  new URL("../docs/lead-agent/CONSULTATIVE_SALES_EVALUATION_RU.md", import.meta.url),
  "utf8",
);
const rankedDraft = readFileSync(
  new URL("../docs/lead-agent/TOP_50_REAL_WHATSAPP_INTENTS_DRAFT.md", import.meta.url),
  "utf8",
);
const salesPrompt = readFileSync(
  new URL("../evo-lead-agent/src/evo_lead_agent/sales_prompt.py", import.meta.url),
  "utf8",
);

test("Top-50 remains a real intent coverage catalog without fixed golden answers", () => {
  const cases = [
    ...rankedDraft.matchAll(/^\| (\d+) \| `([^`]+)` \| (.+) \| \d+ \| \d+ \|$/gmu),
  ];
  assert.equal(cases.length, 50);
  assert.deepEqual(
    cases.map((match) => Number(match[1])),
    Array.from({ length: 50 }, (_, index) => index + 1),
  );
  assert.match(evaluation, /Top-50 — это coverage catalog/u);
  assert.match(evaluation, /не эталонную формулировку/u);
  assert.doesNotMatch(evaluation, /^## \d{2} —/gmu);
  assert.doesNotMatch(evaluation, /\*\*Рекомендуемый ответ:\*\*/u);
});

test("evaluation defines context-sensitive scoring and hard safety gates", () => {
  for (const field of [
    "name",
    "age",
    "english_level",
    "current_education",
    "countries_considered",
  ]) {
    assert.match(evaluation, new RegExp(`\\b${field}\\b`, "u"));
  }
  for (const criterion of [
    "Прямой ответ",
    "Использование памяти",
    "Grounding",
    "Персонализация",
    "Discovery",
    "Продажная полезность",
    "Человечность",
    "Границы",
    "Handoff",
    "Приватность",
  ]) {
    assert.match(evaluation, new RegExp(criterion, "u"));
  }
  assert.match(evaluation, /не менее `17\/20`/u);
  assert.match(evaluation, /не могут иметь `0`/u);
});

test("supervised edits are retained but never become automatic training", () => {
  for (const field of [
    "generated_text",
    "reviewed_text",
    "review_reason",
    "проверившего",
  ]) {
    assert.match(evaluation, new RegExp(field, "u"));
  }
  assert.match(evaluation, /не меняет prompt автоматически/u);
  assert.match(evaluation, /held-out реальных кейсах/u);
  assert.match(evaluation, /не разрешает[\s\S]*автоматическое обучение/u);
  assert.match(evaluation, /Разрешён только draft\/shadow/u);
});

test("versioned sales prompt uses memory, consultative selling and fail-closed grounding", () => {
  assert.match(salesPrompt, /SALES_PROMPT_VERSION = "evo-consultative-sales-v1"/u);
  assert.match(salesPrompt, /Answer the direct question first/u);
  assert.match(salesPrompt, /Do not ask for a known field again/u);
  assert.match(salesPrompt, /Ask at most two natural follow-up questions/u);
  assert.match(salesPrompt, /without pressure, manipulation, fake urgency/u);
  assert.match(salesPrompt, /Use only supplied knowledge_matches/u);
  assert.match(salesPrompt, /every response is a draft for employee review/u);
  assert.match(salesPrompt, /Return strict JSON only/u);
});
