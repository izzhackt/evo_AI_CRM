import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  EVI_BEAT,
  EVI_FAILURE_ACTION,
  EVI_LIMITS,
  eviSpeakMs,
  extractJsonObject,
  historyTooLong,
  parseEviHistory,
  parseEviReply,
} from "../src/lib/portal/evi.ts";
import { getPortalStrings } from "../src/lib/portal/i18n.ts";

// Вкладка «Подбор с Эви» (решение владельца 16.11.2026): сначала интерфейс, разговор с моделью — отдельным шагом.
// 17.11.2026 — два исключения из контракта кабинета: живой робот и подсветка карточки; тесты держат их узкими.
const KEYS = new Set(["software-developer", "data-scientist", "mechanical-engineer", "physician"]);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("progress comes only from the model and only when it is plausible", () => {
  const reply = (progress, results = null) => parseEviReply({ message: "Привет", progress, results }, KEYS);
  assert.deepEqual(reply({ step: 3, total: 6 })?.progress, { step: 3, total: 6 });
  assert.equal(reply(undefined)?.progress, null);
  assert.equal(reply({ step: 7, total: 6 })?.progress, null, "step past total");
  assert.equal(reply({ step: 0, total: 6 })?.progress, null);
  assert.equal(reply({ step: 2.5, total: 6 })?.progress, null);
  assert.equal(reply({ step: 3, total: EVI_LIMITS.maxQuestions + 1 })?.progress, null);
  assert.equal(reply("3/6")?.progress, null);
  const results = [
    { cardKey: "software-developer", why: "a" }, { cardKey: "data-scientist", why: "b" }, { cardKey: "physician", why: "c" },
  ];
  assert.equal(reply({ step: 6, total: 6 }, results)?.progress, null, "the result ends the questions");
  const chat = read(`${EVI_DIR}/EviChat.tsx`);
  assert.match(chat, /\{chat\.progress && !chat\.intro \? \(/u);
});

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
    progress: null,
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

const EVI_DIR = "src/components/portal/evi";
const eviFiles = () => readdirSync(new URL(`../${EVI_DIR}`, import.meta.url)).filter((name) => /\.tsx?$/u.test(name));
const CSS = read("src/app/(portal)/portal.css");
const BASE_MARK = "Эви — ИИ-профориентатор во вкладке";
const ROBOT_MARK = "Живой Эви (исключение владельца 17.11.2026";
const MOTION_MARK = "Движение кабинета студента (решение владельца 02.10";
const BASE = CSS.slice(CSS.indexOf(BASE_MARK), CSS.indexOf(ROBOT_MARK));
const ROBOT = CSS.slice(CSS.indexOf(ROBOT_MARK), CSS.indexOf(MOTION_MARK));

test("the professions page validates ?view= and keeps the catalogue as the default tab", () => {
  const page = read("src/app/(portal)/portal/professions/page.tsx");
  assert.match(page, /if \(rawView !== undefined && rawView !== "evi"\) notFound\(\);/u);
  assert.match(page, /<main className="pt-page pt-prof-page pt-prof-page-evi">/u);
  assert.match(page, /<ProfessionsTabs view="evi"/u);
  assert.match(page, /<ProfessionsTabs view="catalog"/u);
  assert.match(page, /readOwnAiConsentForProfile\(actor\.accessTier\)/u);
  const tabs = read("src/components/portal/professions/ProfessionsTabs.tsx");
  assert.match(tabs, /href="\/portal\/professions"/u);
  assert.match(tabs, /href="\/portal\/professions\?view=evi"/u);
});

test("without the model the chat says Эви is unavailable instead of inventing a reply", () => {
  const conversation = read(`${EVI_DIR}/useEviConversation.ts`);
  assert.match(conversation, /if \(!ask\) \{ setFailure\("unavailable"\); return; \}/u);
  for (const file of eviFiles()) {
    assert.doesNotMatch(read(`${EVI_DIR}/${file}`), /localStorage|sessionStorage|fetch\(/u, `${file}: nothing is stored in the browser or fetched directly`);
  }
  const tab = read(`${EVI_DIR}/EviTab.tsx`);
  assert.match(tab, /aiConsentState\(consent\.consent\) !== "granted"/u);
  assert.match(tab, /<EviConsentGate/u);
});

test("before the first answer the chat greets with a welcome stage, and the section always has one name", () => {
  const thread = read(`${EVI_DIR}/EviThread.tsx`);
  const chat = read(`${EVI_DIR}/EviChat.tsx`);
  // Приветствие: крупный робот и заголовок с id имени секции; шапка с тем же id — только в разговоре.
  assert.match(thread, /if \(intro && greeting\) \{/u);
  assert.match(thread, /<h2 id="pt-evi-name" className="pt-evi-welcome-title">\{strings\["evi\.welcomeTitle"\]\}<\/h2>/u);
  assert.match(chat, /\{chat\.intro \? null : \(\s*<div className="pt-evi-head">/u);
  assert.equal(chat.split('id="pt-evi-name"').length - 1, 1);
  // Хуки — до раннего выхода приветствия.
  assert.ok(thread.indexOf("useEffect(") < thread.indexOf("if (intro && greeting)"));
  // Пока Эви думает — облачко с точками, текст остаётся для читалки.
  assert.match(thread, /className="pt-evi-bubble pt-evi-typing" role="status">\s*<span className="pt-sr-only">\{strings\["evi\.thinking"\]\}<\/span>/u);
});

test("a new chat ignores replies that arrive for the old one", () => {
  const conversation = read(`${EVI_DIR}/useEviConversation.ts`);
  assert.match(conversation, /epochRef\.current \+= 1/u);
  assert.equal(conversation.split("if (epochRef.current !== mine) return;").length - 1, 2, "both the reply and the failure are checked");
  assert.doesNotMatch(conversation, /useTransition/u);
});

test("every failure has at most one recovery action, and the robot keeps a bounded beat", () => {
  assert.deepEqual(EVI_FAILURE_ACTION, { error: "retry", busy: "retry", limit: "restart", invalid: "restart", consent: "allow", unavailable: null });
  assert.equal(eviSpeakMs(""), 800);
  assert.equal(eviSpeakMs(Array(10).fill("слово").join(" ")), 1000);
  assert.equal(eviSpeakMs(Array(100).fill("слово").join(" ")), 2400);
  assert.equal(EVI_BEAT.react.eureka, 2400);
  assert.equal(EVI_BEAT.poke, 700);
});

test("the robot answers the student's actions: a picked option and a sent answer", () => {
  const conversation = read(`${EVI_DIR}/useEviConversation.ts`);
  assert.match(conversation, /const adding = !picked\.has\(option\);[\s\S]*if \(adding\) setPokes\(\(current\) => current \+ 1\);/u);
  const thread = read(`${EVI_DIR}/EviThread.tsx`);
  assert.match(thread, /speakMs=\{fresh \? eviSpeakMs\(message\.text\) : undefined\} poke=\{poke\}/u);
  assert.match(thread, /<EviMascot mood="thinking" hopOnMount \/>/u);
  const face = read(`${EVI_DIR}/useEviFace.ts`);
  assert.match(face, /if \(poking\) return \{ face: "happy", poking \};/u);
  assert.match(face, /window\.setTimeout\(\(\) => setSeenPoke\(poke\), EVI_BEAT\.poke\)/u);
  // На время радости робот не «успокоен» — иначе подскок не сыграет у старой реплики.
  assert.match(read(`${EVI_DIR}/EviMascot.tsx`), /settled=\{speakMs === undefined && !poking\}/u);
});

test("every catalogue profession has its photo, and a result card finds it by the card key", () => {
  const catalogue = read("supabase/migrations/359_platform_profession_cards_v1_1.sql");
  const keys = [...new Set([...catalogue.matchAll(/'([a-z]+(?:-[a-z]+)*)', '1\.1\.0'/gu)].map((match) => match[1]))].sort();
  assert.equal(keys.length, 24);
  const photos = read("src/components/portal/professions/profession-photo-files.ts");
  const mapped = [...photos.matchAll(/^ {2}"([a-z-]+)": [A-Za-z]+,$/gmu)].map((match) => match[1]).sort();
  assert.deepEqual(mapped, keys);
  for (const key of keys) {
    assert.match(photos, new RegExp(`from "\\.\\./\\.\\./\\.\\./content/professions/photos/${key}\\.webp";`, "u"), `${key} imports its own file`);
    assert.ok(existsSync(new URL(`../src/content/professions/photos/${key}.webp`, import.meta.url)), `${key}.webp exists`);
  }
  const results = read(`${EVI_DIR}/EviResults.tsx`);
  assert.match(results, /<ProfessionPhoto cardKey=\{result\.cardKey\} className="pt-evi-result-photo" \/>/u);
  const photo = read("src/components/portal/professions/ProfessionPhoto.tsx");
  assert.match(photo, /const photo = PROFESSION_PHOTOS\[cardKey\];\s*if \(!photo\) return null;/u);
  assert.match(photo, /alt=""/u, "the photo is decoration: the title names the card");
  // Тот же снимок — в каталоге, в «Подходят вам» и в шапке страницы профессии.
  assert.match(read("src/components/portal/professions/ProfessionsBrowser.tsx"), /<ProfessionPhoto cardKey=\{card\.cardKey\} className="pt-prof-photo" \/>/u);
  assert.match(read("src/components/portal/professions/ProfessionMatches.tsx"), /<ProfessionPhoto cardKey=\{card\.cardKey\} className="pt-prof-photo" \/>/u);
  assert.match(read("src/app/(portal)/portal/professions/[cardId]/page.tsx"), /<ProfessionPhoto cardKey=\{card\.cardKey\} className="pt-prof-detail-photo" eager \/>/u);
});

test("the results show the catalogue's own line and no score", () => {
  const results = read(`${EVI_DIR}/EviResults.tsx`);
  assert.match(results, /result\.summary \? <p className="pt-evi-result-what">/u);
  assert.doesNotMatch(results, /%|score|percent/iu);
});

test("Эви's components use cabinet tokens only: no raw colours and no glow", () => {
  for (const file of eviFiles()) {
    const source = read(`${EVI_DIR}/${file}`);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/iu, `${file} has a raw colour`);
    assert.doesNotMatch(source, /filter=|feGaussianBlur|drop-shadow/u, `${file} glows`);
  }
  const robot = read(`${EVI_DIR}/EviRobot.tsx`);
  assert.match(robot, /useId\(/u, "gradient ids are unique per robot");
  assert.match(robot, /url\(#/u);
});

test("the base Эви block has no motion of its own; durations come from tokens", () => {
  assert.equal(CSS.indexOf(ROBOT_MARK), CSS.lastIndexOf(ROBOT_MARK), "one robot block");
  assert.ok(BASE.length > 0 && ROBOT.length > 0);
  assert.doesNotMatch(BASE, /@keyframes|animation:|\binfinite\b|filter:|backdrop-filter/u);
  for (const literal of BASE.matchAll(/transition:[^;]+;/gu)) assert.doesNotMatch(literal[0], /\d+m?s\b/u, "durations come from tokens");
});

test("the robot's live motion is robot-only and switched off under reduced motion", () => {
  assert.doesNotMatch(ROBOT, /filter:|backdrop-filter/u);
  for (const match of ROBOT.matchAll(/@keyframes\s+([\w-]+)/gu)) assert.match(match[1], /^pt-evi-/u);
  const opener = "@media (prefers-reduced-motion: no-preference) {";
  const start = ROBOT.indexOf(opener);
  assert.ok(start > 0 && start === ROBOT.lastIndexOf(opener), "exactly one no-preference block");
  // Конец блока — по глубине скобок, а не до конца среза: правило после блока тоже должно ловиться.
  let depth = 1;
  let end = start + opener.length;
  while (depth > 0 && end < ROBOT.length) {
    if (ROBOT[end] === "{") depth += 1;
    if (ROBOT[end] === "}") depth -= 1;
    end += 1;
  }
  const inside = ROBOT.slice(start + opener.length, end - 1);
  const outside = (ROBOT.slice(0, start) + ROBOT.slice(end))
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gu, "");
  assert.doesNotMatch(outside, /animation(?:-[a-z-]+)?\s*:/u, "no animation outside the no-preference block");
  for (const rule of inside.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    assert.match(rule[2], /animation(?:-[a-z-]+)?\s*:/u, "the block holds only robot animations");
    // Запятые внутри :is(...) — часть одного селектора, делим только по верхнему уровню.
    const selectors = rule[1].replace(/\/\*[\s\S]*?\*\//gu, "").split(/,(?![^(]*\))/u).map((part) => part.trim()).filter(Boolean);
    for (const selector of selectors) assert.match(selector, /^\.pt-evi-mascot\b/u, `${selector} is not the robot`);
  }
  // Разовые реакции не повторяются у старой реплики.
  for (const reaction of ["pt-evi-hop", "pt-evi-pop", "pt-evi-jump", "pt-evi-star-in", "pt-evi-flash"]) {
    const rule = new RegExp(`([^{}]+)\\{\\s*animation: ${reaction} `, "u").exec(inside);
    assert.ok(rule, reaction);
    assert.match(rule[1].trim(), /^\.pt-evi-mascot:not\(\[data-settled\]\)/u, `${reaction} skips a settled robot`);
  }
});

test("every failure's words match its one action", () => {
  const thread = read(`${EVI_DIR}/EviThread.tsx`);
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("professions", locale);
    for (const [failure, action] of Object.entries(EVI_FAILURE_ACTION)) {
      const key = new RegExp(`${failure}: "([\\w.]+)"`, "u").exec(thread)?.[1];
      assert.ok(key && strings[key], `${failure} has text`);
      if (action === "restart") assert.match(strings[key], locale === "ru" ? /новый чат/iu : /жаңы маек/iu, `${locale} ${failure}`);
      if (action !== "retry") assert.doesNotMatch(strings[key], /ещё раз|кайра аракет/iu, `${locale} ${failure} promises a retry it does not offer`);
    }
  }
});

test("Эви's colours have a light and a dark value; no backdrop, and the input has no red frame", () => {
  const tokens = [
    "--pt-evi-helmet", "--pt-evi-helmet-hi", "--pt-evi-helmet-lo", "--pt-evi-helmet-rim", "--pt-evi-ring", "--pt-evi-visor",
    "--pt-evi-visor-hi", "--pt-evi-visor-lo", "--pt-evi-eye", "--pt-evi-ear", "--pt-evi-ear-line", "--pt-evi-accent",
    "--pt-evi-nub-hi", "--pt-evi-nub-lo", "--pt-evi-shine", "--pt-evi-gloss", "--pt-evi-flash", "--pt-evi-bubble",
  ];
  for (const token of tokens) assert.equal(CSS.split(`${token}:`).length - 1, 2, `${token} has a light and a dark value`);
  // Подсветки нет (решение 17.11.2026): белое окно на обычном фоне кабинета, без градиентов вкладки.
  assert.doesNotMatch(CSS, /--pt-evi-(?:wash|stage|window-shadow)/u);
  assert.doesNotMatch(CSS, /\.pt-content:has\(\.pt-prof-page-evi\)/u);
  assert.match(CSS, /\n\.pt-evi \{[^}]*background: var\(--pt-surface\);/u, "the window itself is a plain surface");
  // Поле ввода без красного: фокус — тёмная обводка поля, рамка общего правила textarea снята.
  assert.match(CSS, /\.pt-evi-composer:focus-within \{\s*border-color: var\(--pt-text\);/u);
  assert.match(CSS, /\.pt-page \.pt-evi-input:focus-visible \{\s*outline: none;/u);
  assert.match(CSS, /\n\.pt-evi-bubble-mine \{[^}]*background: var\(--pt-accent\);[^}]*color: var\(--pt-on-accent\);/u);
});



