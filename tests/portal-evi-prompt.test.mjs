import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EVI_LIMITS, parseEviReply } from "../src/lib/portal/evi.ts";
import { EVI_MODEL, eviCatalogDossier, eviReplySchema, eviSystemPrompt } from "../src/lib/server/evi/prompt.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Опубликованные карточки «Профессий» — те же тела, что кладёт миграция 359.
const CARDS = [...read("supabase/migrations/359_platform_profession_cards_v1_1.sql").matchAll(/'(\{"id":.*?\})'/gu)]
  .map((match) => JSON.parse(match[1].replaceAll("''", "'")))
  .map((body) => ({ cardId: body.id, cardKey: body.id, version: "1.1.0", body }));
const KEYS = CARDS.map((card) => card.cardKey);
const PROMPT = eviSystemPrompt(CARDS, "ru");

test("Эви runs on Claude Sonnet 5.5 and sees every catalogue card, sorted, with its dossier", () => {
  assert.equal(EVI_MODEL, "claude-sonnet-5-5");
  assert.equal(CARDS.length, 24);
  const dossier = eviCatalogDossier(CARDS);
  const headers = [...dossier.matchAll(/^### ([a-z-]+) — /gmu)].map((match) => match[1]);
  assert.deepEqual(headers, [...KEYS].sort(), "one block per card, by key");
  for (const field of ["Суть", "Интересы (ORVIS)", "Школьные предметы", "Обстановка", "Навыки", "Чем нравится", "Что трудно", "Учиться на"]) {
    assert.equal(dossier.split(`\n${field}: `).length - 1, 24, field);
  }
  assert.doesNotMatch(dossier, /scale\.|undefined/u, "scale names come from the cabinet dictionary");
  // Порядок карточек из базы не меняет текст: промт кешируется побайтно.
  assert.equal(eviSystemPrompt([...CARDS].reverse(), "ru"), PROMPT);
});

test("the prompt is filled in completely, in the cabinet's language, with the limits the reply parser enforces", () => {
  const ky = eviSystemPrompt(CARDS, "ky");
  for (const prompt of [PROMPT, ky]) assert.doesNotMatch(prompt, /\{\{[A-Z_]*\}\}/u, "every placeholder is filled");
  assert.match(PROMPT, /Пиши по-русски;/u);
  assert.match(ky, /Пиши по-кыргызски;/u);
  assert.match(PROMPT, new RegExp(`"message": строка 1–${EVI_LIMITS.maxAssistantChars} символов`, "u"));
  assert.match(PROMPT, new RegExp(`"options": 0–${EVI_LIMITS.maxOptions} разных непустых строк, каждая до ${EVI_LIMITS.maxOptionChars} символов`, "u"));
  assert.match(PROMPT, new RegExp(`"why" — 1–${EVI_LIMITS.maxWhyChars} символов`, "u"));
  assert.match(PROMPT, new RegExp(`\\{"step": N, "total": ${EVI_LIMITS.maxQuestions}\\}`, "u"));
  assert.ok(PROMPT.length < 60_000, `prompt is ${PROMPT.length} characters`);
});

test("both reply samples in the prompt pass the same parser as the model's real replies", () => {
  const samples = PROMPT.split("\n").filter((line) => line.startsWith('{"message":')).map((line) => JSON.parse(line));
  assert.equal(samples.length, 2);
  const [question, result] = samples.map((sample) => parseEviReply(sample, new Set(KEYS)));
  assert.ok(question && result);
  assert.deepEqual(question.progress, { step: 4, total: EVI_LIMITS.maxQuestions });
  assert.equal(question.picks, null);
  assert.equal(result.picks?.length, 3);
  assert.equal(result.progress, null);
  // Образцы проходят и схему ответа: ровно шесть полей, ключи карточек — из каталога.
  const schema = eviReplySchema(KEYS);
  for (const sample of samples) assert.deepEqual(Object.keys(sample).sort(), [...schema.required].sort());
});

test("the deep match is required and stays hidden: every card is checked in thinking, the student gets only JSON", () => {
  assert.match(PROMPT, /Рассуждай скрыто, ученику — только JSON\./u);
  assert.match(PROMPT, /## 5\. Итог: полный прогон по каталогу\nОбязательно, в мыслях:/u);
  assert.match(PROMPT, /ВСЕ карточки каталога по порядку, строка на каждую/u);
  // Просьба вывести рассуждение в ответ — повод для отказа модели (reasoning_extraction): её в промте нет.
  assert.doesNotMatch(PROMPT, /(напиши|покажи|выведи)\s+(своё\s+)?рассуждени/iu);
  // Карта областей для разнообразия тройки покрывает каталог ровно один раз.
  const areas = /Области: ([^\n]+?)\. Мечта ученика/u.exec(PROMPT)?.[1] ?? "";
  for (const key of KEYS) assert.equal(areas.split(new RegExp(`(?<![a-z-])${key}(?![a-z-])`, "u")).length - 1, 1, key);
});

test("the prompt keeps the cabinet's rules: catalogue only, no numbers or promises, no data reminders", () => {
  assert.match(PROMPT, /ровно три профессии, только из каталога ниже/u);
  assert.match(PROMPT, /Никаких процентов совпадения, баллов, рейтингов, «идеально подходит», чисел зарплат, гарантий поступления, вузов и фактов не из досье\./u);
  assert.match(PROMPT, /никаких напоминаний про данные, конфиденциальность, ИИ\./u);
  assert.match(PROMPT, /Не спрашивай имя, телефон, адрес, документы, оценки цифрами/u);
  assert.match(PROMPT, /"eureka" не пиши никогда: её ставит сервер\./u);
});

test("the reply schema matches the parser: six required fields, closed objects, card keys from the catalogue", () => {
  const schema = eviReplySchema(KEYS);
  assert.deepEqual([...schema.required], ["message", "mood", "options", "multi", "results", "progress"]);
  const objects = [schema, schema.properties.results.anyOf[0].items, schema.properties.progress.anyOf[0]];
  for (const object of objects) assert.equal(object.additionalProperties, false);
  assert.deepEqual([...schema.properties.results.anyOf[0].items.properties.cardKey.enum], [...KEYS].sort());
  // Ограничения длины и количества схема не выражает (structured outputs их не поддерживают) — их держит parseEviReply.
  assert.doesNotMatch(JSON.stringify(schema), /minLength|maxLength|minimum|maximum|minItems|maxItems/u);
});
