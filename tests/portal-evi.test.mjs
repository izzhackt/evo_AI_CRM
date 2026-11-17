import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

test("Эви's colours have a light and a dark value; the wash belongs to the Эви card only", () => {
  const tokens = [
    "--pt-evi-helmet", "--pt-evi-helmet-hi", "--pt-evi-helmet-lo", "--pt-evi-helmet-rim", "--pt-evi-ring", "--pt-evi-visor",
    "--pt-evi-visor-hi", "--pt-evi-visor-lo", "--pt-evi-eye", "--pt-evi-ear", "--pt-evi-ear-line", "--pt-evi-accent",
    "--pt-evi-nub-hi", "--pt-evi-nub-lo", "--pt-evi-shine", "--pt-evi-gloss", "--pt-evi-flash", "--pt-evi-bubble", "--pt-evi-wash",
  ];
  for (const token of tokens) assert.equal(CSS.split(`${token}:`).length - 1, 2, `${token} has a light and a dark value`);
  assert.equal(CSS.split("var(--pt-evi-wash)").length - 1, 1);
  assert.match(CSS, /\n\.pt-evi \{[^}]*background: var\(--pt-evi-wash\), var\(--pt-surface\);/u);
  assert.match(CSS, /\n\.pt-evi-bubble-mine \{[^}]*background: var\(--pt-accent\);[^}]*color: var\(--pt-on-accent\);/u);
});

/** Цвет токена в блоке темы; подсветка — слои radial-gradient(Wpx Hpx at X% Y%, rgb(r g b / a), transparent 70%). */
function theme(selector) {
  const start = CSS.indexOf(`${selector} {`);
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const hex = (name) => {
    const value = new RegExp(`\\n\\s*${name}:\\s*#([0-9a-f]{6});`, "u").exec(block)?.[1];
    assert.ok(value, `${selector} ${name}`);
    return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  };
  const washStart = block.indexOf("--pt-evi-wash:");
  const wash = [...block.slice(washStart, block.indexOf(";", washStart)).matchAll(
    /radial-gradient\((\d+)px (\d+)px at (\d+)% (\d+)%, rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\), transparent 70%\)/gu,
  )].map((match) => match.slice(1).map(Number));
  assert.equal(wash.length, 4, `${selector} wash has four layers`);
  return { hex, wash };
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

test("text and control edges stay readable on every point of the wash", () => {
  for (const [selector, edgeEverywhere] of [[".pt-shell", false], [':root[data-theme="dark"] .pt-shell', true]]) {
    const { hex, wash } = theme(selector);
    const surface = hex("--pt-surface");
    const minimum = { text: Infinity, "text-2": Infinity, error: Infinity, edge: Infinity };
    for (const [width, height] of [[1024, 680], [393, 560], [375, 440]]) {
      for (let y = 0; y <= height; y += 8) {
        for (let x = 0; x <= width; x += 8) {
          let color = [...surface];
          for (const [rx, ry, px, py, r, g, b, alpha] of [...wash].reverse()) {
            const t = Math.hypot((x - (px / 100) * width) / rx, (y - (py / 100) * height) / ry);
            const a = alpha * Math.max(0, 1 - t / 0.7);
            color = color.map((channel, index) => channel * (1 - a) + [r, g, b][index] * a);
          }
          const point = color.map(Math.round);
          minimum.text = Math.min(minimum.text, contrast(hex("--pt-text"), point));
          minimum["text-2"] = Math.min(minimum["text-2"], contrast(hex("--pt-text-2"), point));
          minimum.error = Math.min(minimum.error, contrast(hex("--pt-error"), point));
          if (edgeEverywhere || y >= height - 150) minimum.edge = Math.min(minimum.edge, contrast(hex("--pt-control-edge"), point));
        }
      }
    }
    for (const name of ["text", "text-2", "error"]) assert.ok(minimum[name] >= 4.5, `${selector} ${name} ${minimum[name].toFixed(2)}`);
    assert.ok(minimum.edge >= 3, `${selector} control edge ${minimum.edge.toFixed(2)}`);
  }
});
