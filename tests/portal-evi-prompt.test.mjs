import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EVI_LIMITS, parseEviReply } from "../src/lib/portal/evi.ts";
import { EVI_MODEL, EVI_OPENING, eviCatalogDossier, eviOpening, eviReplySchema, eviSystemPrompt } from "../src/lib/server/evi/prompt.ts";

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
  // Шкалы названы словами результата теста — теми же, что в вопросах промта.
  for (const label of ["Практическая работа", "Динамичная работа", "Изучение и знания"]) {
    assert.ok(dossier.includes(label) && PROMPT.split(label).length > 2, label);
  }
  assert.doesNotMatch(dossier, /Производство|Приключения|Эрудиция/u);
  // Порядок карточек из базы не меняет текст: промт кешируется побайтно.
  assert.equal(eviSystemPrompt([...CARDS].reverse(), "ru"), PROMPT);
});

test("the prompt is filled in completely, in the cabinet's language, with the limits the reply parser enforces", () => {
  const ky = eviSystemPrompt(CARDS, "ky");
  for (const prompt of [PROMPT, ky]) assert.doesNotMatch(prompt, /\{\{[A-Z_]*\}\}/u, "every placeholder is filled");
  assert.match(PROMPT, /Пиши по-русски;/u);
  assert.match(ky, /Пиши по-кыргызски;/u);
  // Досье написано по-русски; пересказ — на языке ответа, а не «по-кыргызски» в русском кабинете.
  assert.match(PROMPT, /Досье пересказывай своими словами на языке ответа/u);
  assert.doesNotMatch(PROMPT, /по-кыргызски пересказывай/u);
  // Раздел вузов и названия профессий — как в кабинете этого языка.
  assert.equal(PROMPT.split("«Где учиться в EVO»").length - 1, 4);
  assert.equal(ky.split("«EVO менен кайда окуса болот»").length - 1, 4);
  assert.equal(ky.split("\nПо-кыргызски: ").length - 1, 24);
  assert.doesNotMatch(PROMPT, /\nПо-кыргызски: /u);
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

test("a student who passed the interest test: Эви gets the result in words, in the cabinet note, without scores", () => {
  assert.equal(eviOpening(null), EVI_OPENING, "no test — only the cabinet note");
  const profile = {
    means: { creativity: 4.6, altruism: 4.3, erudition: 3.8, analysis: 3.1, organization: 2.9, leadership: 2.6, production: 2.0, adventure: 1.8 },
    topScales: ["creativity", "altruism"],
  };
  const note = eviOpening(profile);
  assert.ok(note.startsWith(`${EVI_OPENING}\n`));
  assert.match(note, /ведущие — Творчество, Помощь людям; дальше от сильных к слабым — Изучение и знания, Анализ, Организация, Лидерство; самые слабые — Практическая работа, Динамичная работа\./u);
  assert.doesNotMatch(note, /\d/u, "no scores reach the model");
  // Тест не отметил ведущих — ведущие по порядку; шкалы без ответа не выдумываются.
  assert.match(eviOpening({ means: { analysis: 4, production: 3.5, leadership: 2 }, topScales: [] }), /ведущие — Анализ, Практическая работа; самые слабые — Лидерство\./u);
  assert.equal(eviOpening({ means: {}, topScales: [] }), EVI_OPENING);
  // Ведущие у теста — шкалы с наибольшим средним; три и больше — профиль ровный, опоры нет.
  const flat = eviOpening({ means: { analysis: 3, creativity: 3, altruism: 3, leadership: 2 }, topScales: ["altruism", "analysis", "creativity"] });
  assert.match(flat, /явных ведущих интересов тест не выделил\.$/u);
  assert.doesNotMatch(flat, /ведущие — /u);
  // Системный промт одинаков для всех: результат теста живёт только в заметке.
  assert.doesNotMatch(PROMPT, /ведущие — /u);
  assert.match(PROMPT, /## 2а\. Если ученик прошёл тест интересов/u);
  // Разговор главнее теста; тест — не больше одной опоры и не единственная; отвергнутый тест — ни опора, ни минус.
  assert.match(PROMPT, /Ученик прямо выбрал другое — верь разговору: этот интерес теста уже не опора\./u);
  assert.match(PROMPT, /у карточки не больше одной такой опоры и не единственная/u);
  assert.match(PROMPT, /тест не опора и не минус, его не оценивай\./u);
  assert.match(PROMPT, /В заметке «явных ведущих тест не выделил» — работай как без теста\./u);
});
