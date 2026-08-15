import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worksheet = readFileSync(
  new URL("../docs/lead-agent/GOLDEN_ANSWER_DRAFTS_RU.md", import.meta.url),
  "utf8",
);
const rankedDraft = readFileSync(
  new URL("../docs/lead-agent/TOP_50_REAL_WHATSAPP_INTENTS_DRAFT.md", import.meta.url),
  "utf8",
);

function parseWorksheetSections(markdown) {
  const matches = [...markdown.matchAll(/^## (\d{2}) — `([a-z0-9_]+)`$/gmu)];
  return matches.map((match, index) => ({
    rank: Number(match[1]),
    intent: match[2],
    body: markdown.slice(match.index, matches[index + 1]?.index ?? markdown.indexOf("\n## Что должен сделать", match.index)),
  }));
}

function parseRankedIntents(markdown) {
  return [...markdown.matchAll(/^\| (\d+) \| `([a-z0-9_]+)` \|/gmu)]
    .map((match) => ({ rank: Number(match[1]), intent: match[2] }));
}

test("owner worksheet covers the exact real WhatsApp Top-50 in rank order", () => {
  const sections = parseWorksheetSections(worksheet);
  const rankedIntents = parseRankedIntents(rankedDraft);
  assert.equal(sections.length, 50);
  assert.equal(new Set(sections.map((section) => section.intent)).size, 50);
  assert.deepEqual(
    sections.map(({ rank, intent }) => ({ rank, intent })),
    rankedIntents,
  );
});

test("every draft has the required owner-review fields", () => {
  for (const section of parseWorksheetSections(worksheet)) {
    assert.match(section.body, /- \*\*Цель:\*\* .+/u, `${section.intent}: goal`);
    assert.match(section.body, /- \*\*Рекомендуемый ответ:\*\* .+/u, `${section.intent}: answer`);
    assert.match(section.body, /- \*\*Обязательные вопросы:\*\* .+/u, `${section.intent}: questions`);
    assert.match(section.body, /- \*\*Передать сотруднику:\*\* .+/u, `${section.intent}: handoff`);
  }
  assert.match(worksheet, /Status: `owner_review_required`/u);
  assert.doesNotMatch(worksheet, /Status: `owner_approved`/u);
});

test("draft answers contain no customer contact data or unsupported hard claims", () => {
  const answers = parseWorksheetSections(worksheet)
    .map((section) => section.body.match(/- \*\*Рекомендуемый ответ:\*\* (.+)/u)?.[1] ?? "")
    .join("\n");
  assert.doesNotMatch(answers, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu);
  assert.doesNotMatch(answers, /\+?\d[\d\s().-]{5,}\d/u);
  assert.doesNotMatch(answers, /https?:\/\//iu);
  assert.doesNotMatch(answers, /гарантируем (?:вам )?(?:визу|зачисление)|(?:виза|зачисление) гарантирован[оаы]?/iu);
  assert.doesNotMatch(answers, /\b\d[\d\s,.]*(?:usd|cny|сом|доллар(?:ов|а)?|юан(?:ей|я)?|rm)\b/iu);
});

test("worksheet does not authorize runtime activation", () => {
  assert.match(worksheet, /не являются[\s\S]*production prompt/u);
  assert.match(worksheet, /не являются[\s\S]*разрешением на\s+автоматическую отправку/u);
  assert.match(worksheet, /До этого данный файл остаётся только\s+worksheet/u);
});
