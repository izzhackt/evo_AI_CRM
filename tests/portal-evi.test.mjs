import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EVI_LIMITS,
  extractJsonObject,
  historyTooLong,
  parseEviHistory,
  parseEviReply,
} from "../src/lib/portal/evi.ts";

// Вкладка «Подбор с Эви» (решение владельца 16.11.2026): сначала интерфейс, разговор с моделью — отдельным шагом.
const KEYS = new Set(["software-developer", "data-scientist", "mechanical-engineer", "physician"]);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a question reply keeps the message, a known mood and clean distinct options", () => {
  const reply = parseEviReply({
    message: "  Отлично! Какие предметы тебе нравятся?  ",
    mood: "happy",
    options: ["Математика", "Математика", " Физика ", "", 7, "x".repeat(EVI_LIMITS.maxOptionChars + 1)],
    multi: true,
    results: null,
  }, KEYS);
  assert.deepEqual(reply, {
    message: "Отлично! Какие предметы тебе нравятся?",
    mood: "happy",
    options: ["Математика", "Физика"],
    multi: true,
    picks: null,
  });
});

test("an unknown mood falls back to talk, eureka without results is not trusted, and multi needs two options", () => {
  assert.equal(parseEviReply({ message: "Привет", mood: "angry" }, KEYS)?.mood, "talk");
  assert.equal(parseEviReply({ message: "Привет", mood: "eureka" }, KEYS)?.mood, "talk");
  assert.equal(parseEviReply({ message: "Привет", options: ["Да"], multi: true }, KEYS)?.multi, false);
  const many = Array.from({ length: 10 }, (_, index) => `Вариант ${index}`);
  assert.equal(parseEviReply({ message: "Привет", options: many }, KEYS)?.options.length, EVI_LIMITS.maxOptions);
});

test("results are exactly three distinct catalogue cards, and then the mood is eureka", () => {
  const results = [
    { cardKey: "software-developer", why: "Любишь информатику." },
    { cardKey: "data-scientist", why: "Любишь считать." },
    { cardKey: "mechanical-engineer", why: "Собираешь своё." },
  ];
  const reply = parseEviReply({ message: "Готово!", mood: "talk", options: [], results }, KEYS);
  assert.equal(reply?.mood, "eureka");
  assert.deepEqual(reply?.picks, results);
  // Профессия вне каталога, повтор, не три штуки или пустое «почему» — отказ всего ответа.
  assert.equal(parseEviReply({ message: "x", results: [...results.slice(0, 2), { cardKey: "astronaut", why: "Мечта." }] }, KEYS), null);
  assert.equal(parseEviReply({ message: "x", results: [results[0], results[0], results[1]] }, KEYS), null);
  assert.equal(parseEviReply({ message: "x", results: results.slice(0, 2) }, KEYS), null);
  assert.equal(parseEviReply({ message: "x", results: [results[0], results[1], { cardKey: "physician", why: " " }] }, KEYS), null);
});

test("the reply must carry a non-empty message within the limit", () => {
  assert.equal(parseEviReply({ message: "" }, KEYS), null);
  assert.equal(parseEviReply({ message: "x".repeat(EVI_LIMITS.maxAssistantChars + 1) }, KEYS), null);
  assert.equal(parseEviReply(["message"], KEYS), null);
  assert.equal(parseEviReply(null, KEYS), null);
});

test("JSON is taken from the whole text, a fenced block or the outermost braces", () => {
  assert.deepEqual(extractJsonObject('{"message":"a"}'), { message: "a" });
  assert.deepEqual(extractJsonObject('Вот ответ:\n```json\n{"message":"b"}\n```'), { message: "b" });
  assert.deepEqual(extractJsonObject('Ответ: {"message":"c"} — всё.'), { message: "c" });
  assert.equal(extractJsonObject("без JSON"), null);
  assert.equal(extractJsonObject("[1,2]"), null);
});

test("history from the browser: known roles, limits, and the student speaks last", () => {
  assert.deepEqual(parseEviHistory([
    { role: "assistant", content: "Привет! Начнём?" },
    { role: "user", content: " Начнём! " },
  ]), [
    { role: "assistant", content: "Привет! Начнём?" },
    { role: "user", content: "Начнём!" },
  ]);
  assert.equal(parseEviHistory([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), null);
  assert.equal(parseEviHistory([{ role: "system", content: "a" }]), null);
  assert.equal(parseEviHistory([{ role: "user", content: "x".repeat(EVI_LIMITS.maxUserChars + 1) }]), null);
  assert.equal(parseEviHistory([]), null);
  const long = Array.from({ length: EVI_LIMITS.maxTurns + 1 }, () => ({ role: "user", content: "a" }));
  assert.equal(parseEviHistory(long), null);
  assert.equal(historyTooLong(long), true);
  assert.equal(historyTooLong(long.slice(1)), false);
});

test("the professions page validates ?view= and keeps the catalogue as the default tab", () => {
  const page = read("src/app/(portal)/portal/professions/page.tsx");
  assert.match(page, /if \(rawView !== undefined && rawView !== "evi"\) notFound\(\);/u);
  assert.match(page, /<ProfessionsTabs view="evi"/u);
  assert.match(page, /<ProfessionsTabs view="catalog"/u);
  assert.match(page, /readOwnAiConsentForProfile\(actor\.accessTier\)/u);
  const tabs = read("src/components/portal/professions/ProfessionsTabs.tsx");
  assert.match(tabs, /href="\/portal\/professions"/u);
  assert.match(tabs, /href="\/portal\/professions\?view=evi"/u);
});

test("without the model the chat says Эви is unavailable instead of inventing a reply", () => {
  const chat = read("src/components/portal/evi/EviChat.tsx");
  assert.match(chat, /if \(!ask\) \{ setFailure\("unavailable"\); return; \}/u);
  assert.doesNotMatch(chat, /localStorage|sessionStorage|fetch\(/u, "nothing is stored in the browser or fetched directly");
  const tab = read("src/components/portal/evi/EviTab.tsx");
  assert.match(tab, /aiConsentState\(consent\.consent\) !== "granted"/u);
  assert.match(tab, /<EviConsentGate/u);
});

test("the mascot and the chat use cabinet tokens only: no raw colours, no glow, nothing looping", () => {
  for (const file of ["EviMascot.tsx", "EviChat.tsx", "EviResults.tsx", "EviConsentGate.tsx", "EviTab.tsx"]) {
    const source = read(`src/components/portal/evi/${file}`);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/iu, `${file} has a raw colour`);
    assert.doesNotMatch(source, /filter=|feGaussianBlur|drop-shadow/u, `${file} glows`);
  }
  const css = read("src/app/(portal)/portal.css");
  const evi = css.slice(css.indexOf("Эви — ИИ-профориентатор во вкладке"), css.indexOf("Движение кабинета студента (решение владельца 02.10"));
  assert.ok(evi.length > 0);
  assert.doesNotMatch(evi, /@keyframes|animation:|\binfinite\b|filter:|backdrop-filter/u);
  for (const literal of evi.matchAll(/transition:[^;]+;/gu)) assert.doesNotMatch(literal[0], /\d+m?s\b/u, "durations come from tokens");
  for (const token of ["--pt-evi-helmet", "--pt-evi-ring", "--pt-evi-visor", "--pt-evi-eye", "--pt-evi-ear", "--pt-evi-accent", "--pt-evi-shine"]) {
    assert.equal(css.split(`${token}:`).length - 1, 2, `${token} has a light and a dark value`);
  }
});
