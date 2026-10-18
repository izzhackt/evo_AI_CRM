import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import katex from "katex";

// S5.1 / part 2: versioned CSCA content -> immutable content migrations.
// Fork of scripts/generate-portal-learning-seed.mjs: deterministic SQL,
// sha256-stamped sources, --check byte-for-byte drift mode, --write to
// regenerate the UNAPPLIED part 2 migration.
//
// Releases. A release is one module row (module_key + version) that owns a
// complete copy of the content (topics, figures, items, lessons, forms); keys
// are stable between releases and progress goes by key (contract section 16).
//   1.0.0  part 1, migration *_platform_csca_math_part1.sql (286). APPLIED and
//          frozen: this script only pins its sha256 and never rewrites it.
//   1.1.0  part 2 (current sources), migration *_platform_csca_math_part2.sql,
//          the output of this script. All 28 topics have a lesson and a
//          practice set, the diagnostic has 24 items and the mock 48.
// The files are found by name, not by number, so a renumbering at merge keeps
// the hooks (scripts/test-csca-learning-postgres.sh does the same). Once part 2
// is applied, new content means a new version and a new forward migration,
// never an edit here.
//
// Content checks (DESIGN §6.9, plan §9.5): schema and references, disjoint
// pools, balanced answer letters, exactly 4 options with one correct and a
// RU + KY разбор for every option, English item text, TeX only from the
// whitelist and parsed by KaTeX, the SVG profile and six-colour palette, no
// calculator, no long dashes, no words mixing Cyrillic and Latin letters,
// no official CSC/CSCA material and no score promises.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CONTENT_DIR = "docs/design/portal/content/csca";
export const MATH_DIR = `${CONTENT_DIR}/math`;
export const SESSIONS_FILE = `${CONTENT_DIR}/sessions.json`;
export const RELEASE_FILE = `${MATH_DIR}/release.json`;
export const TOPICS_FILE = `${MATH_DIR}/topics.json`;
export const ITEMS_FILE = `${MATH_DIR}/items.json`;
export const FORMS_FILE = `${MATH_DIR}/forms.json`;
export const FIGURES_INDEX_FILE = `${MATH_DIR}/figures/index.json`;
// One file per topic, in syllabus order. The three pilot lessons keep their
// part 1 names (l01..l03, by writing order); the rest are t<order>-<topic>.
export const LESSON_FILES = [
  "t01-sets", "t02-ineq-basics", "t03-ineq-quadratic", "t04-ineq-rational", "t05-ineq-amgm",
  "t06-func-basics", "t07-func-properties", "t08-func-graphs", "t09-quadratic-power", "l01-exp-log",
  "t11-trig-basics", "t12-trig-identities", "t13-trig-graphs", "t14-seq-arithmetic", "t15-seq-geometric",
  "l02-derivative", "l03-line-circle", "t18-ellipse", "t19-hyperbola", "t20-parabola", "t21-vectors",
  "t22-complex", "t23-space-coords", "t24-solids", "t25-classical-probability", "t26-events",
  "t27-statistics", "t28-normal",
].map((name) => `${MATH_DIR}/lessons/${name}.json`);
export const MIGRATIONS_DIR = "supabase/migrations";
export const PART1_SUFFIX = "_platform_csca_math_part1.sql";
export const PART2_SUFFIX = "_platform_csca_math_part2.sql";
// Release 1.0.0 as applied (migration 286 as merged in #1207): immutable.
export const PART1_FROZEN = {
  sha256: "0dd78e6dc5ba39534273cbeb653b6cff5d432eb0144a2f9e99936379a515e033",
  bytes: 219763,
};

export function migrationFiles() {
  return readdirSync(resolve(root, MIGRATIONS_DIR)).filter((name) => /^\d{3}_.+\.sql$/u.test(name)).sort();
}

// The migration that ends with the given name, whatever its number. A missing
// file is allowed (--write creates it with the next free number).
export function migrationPath(suffix) {
  const found = migrationFiles().filter((name) => name.endsWith(suffix));
  assert.ok(found.length <= 1, `more than one migration ends with ${suffix}: ${found.join(", ")}`);
  return found.length ? resolve(root, MIGRATIONS_DIR, found[0]) : null;
}

export function nextMigrationName() {
  const last = migrationFiles().at(-1);
  return `${String(Number(last.slice(0, 3)) + 1).padStart(3, "0")}${PART2_SUFFIX}`;
}

export const EXAM_SECONDS_PER_ITEM = 75;

// TeX whitelist (DESIGN §7.7 plus the set and approximation symbols the
// syllabus and the «без калькулятора» rule need). Both renderers (KaTeX on
// the web, SwiftMath on iPhone) support every command here.
export const TEX_COMMANDS = new Set([
  "frac", "sqrt", "log", "ln", "sin", "cos", "tan", "lim", "to", "infty", "in", "mathbb",
  "cdot", "times", "leq", "geq", "ne", "pm", "Rightarrow", "Leftrightarrow", "left", "right",
  "quad", "Delta", "parallel", "perp", "pi", "alpha", "beta", "theta", "mu", "sigma", "omega",
  "varphi", "approx", "circ", "ldots", "cap", "cup", "subseteq", "emptyset", "notin",
]);
export const TEX_ESCAPES = new Set(["{", "}"]);

// Palette (portal.css): light values are stored, dark values replace them in
// the renderer.
export const PALETTE_LIGHT = {
  paper: "#ffffff", ink: "#191714", muted: "#6b6660", grid: "#e4dfd7", accent: "#d70217", ok: "#177245",
};
export const PALETTE_DARK = {
  paper: "#1e1c19", ink: "#f2efe9", muted: "#a39d94", grid: "#2c2925", accent: "#ff4a57", ok: "#4cc38a",
};
export const SVG_ELEMENTS = new Set(["svg", "title", "rect", "line", "circle", "path", "polygon", "text", "tspan"]);
export const SVG_ATTRIBUTES = new Set([
  "xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "dx", "dy", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "font-family",
  "font-size", "font-style", "font-weight", "text-anchor", "dominant-baseline",
]);
export const INTERACTIVE_WIDGETS = new Set([
  "number-line", "graph-transform", "unit-circle", "secant-tangent", "conic-sections", "vectors",
  "complex-plane", "normal-distribution",
]);
export const POOLS = ["lesson", "practice", "diagnostic", "mock"];

// Phrases that must never reach a student: score promises, percentiles,
// thresholds, partnership claims, and markers of official or leaked papers.
export const FORBIDDEN_PATTERNS = [
  /балл\p{L}*\s+CSCA/iu, /CSCA\s+балл/iu, /score\s+CSCA|CSCA\s+score/iu, /перцентил/iu, /percentile/iu,
  /проходн\p{L}*\s+балл/iu, /passing\s+score/iu, /гарант/iu, /guarantee/iu,
  /официальн\p{L}*\s+(партн|центр)/iu, /official\s+(partner|centre|center)/iu, /расмий\s+өнөктөш/iu,
  /sample\s+question/iu, /past\s+(exam|paper)/iu, /prediction\s+paper/iu, /recalled/iu,
  /csca\.cn\/files/iu, /样题|真题|考试大纲/u,
];
// Thresholds like «80+» are checked in prose only (TeX has «x^2 + 1»).
export const THRESHOLD_PATTERN = /\b\d{2,3}\s*\+(?!\s*\d)/u;

const CYRILLIC = /[Ѐ-ӿ]/u;
const LATIN = /[A-Za-z]/u;
const LONG_DASHES = /[‒–—―]/u;

export function contentUuid(kind, key) {
  const hash = createHash("sha256").update(`evo-csca-content-v1:${kind}:${key}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function assertNonEmptyString(value, field) {
  assert.equal(typeof value, "string", `${field} must be a string`);
  assert.ok(value.trim(), `${field} must not be blank`);
}

function assertExactKeys(value, keys, path) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${path} keys`);
}

function assertPair(value, prefix, path) {
  assertNonEmptyString(value[`${prefix}_ru`], `${path}.${prefix}_ru`);
  assertNonEmptyString(value[`${prefix}_ky`], `${path}.${prefix}_ky`);
}

function assertIntBetween(value, min, max, path) {
  assert.ok(Number.isInteger(value) && value >= min && value <= max, `${path} must be an integer ${min}..${max}`);
}

// ---------------------------------------------------------------------------
// TeX: $…$ inside text, whole strings in formula.tex and table {tex} cells.
// ---------------------------------------------------------------------------
export function texFragments(text, path) {
  assert.equal(typeof text, "string", `${path} must be a string`);
  const parts = text.split("$");
  assert.equal(parts.length % 2, 1, `${path}: unbalanced $ delimiters`);
  return parts.filter((_, index) => index % 2 === 1);
}

export function checkTex(tex, path) {
  assert.ok(tex.trim(), `${path}: empty TeX fragment`);
  let depth = 0;
  for (const char of tex) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    assert.ok(depth >= 0, `${path}: unbalanced braces in ${tex}`);
  }
  for (const match of tex.matchAll(/\\([A-Za-z]+|.)/gu)) {
    const command = match[1];
    if (/^[A-Za-z]+$/u.test(command)) {
      assert.ok(TEX_COMMANDS.has(command), `${path}: TeX command \\${command} is not in the whitelist`);
    } else {
      assert.ok(TEX_ESCAPES.has(command), `${path}: TeX escape \\${command} is not allowed`);
    }
  }
  assert.ok(!/[Ѐ-ӿ]/u.test(tex), `${path}: Cyrillic inside TeX ${tex}`);
  try {
    katex.renderToString(tex, { throwOnError: true, strict: "error", output: "htmlAndMathml" });
  } catch (error) {
    assert.fail(`${path}: KaTeX cannot parse ${tex}: ${error.message}`);
  }
}

// Text outside $…$: no long dashes, no word mixing Cyrillic and Latin
// letters, no forbidden phrase.
export function checkProse(text, path, { english = false } = {}) {
  assert.ok(!LONG_DASHES.test(text), `${path}: long dash (use a colon or a comma)`);
  const prose = text.split("$").filter((_, index) => index % 2 === 0).join(" ");
  for (const word of prose.split(/[^\p{L}]+/u)) {
    if (word && CYRILLIC.test(word) && LATIN.test(word)) {
      assert.fail(`${path}: word mixes Cyrillic and Latin letters: ${word}`);
    }
  }
  if (english) assert.ok(!CYRILLIC.test(prose), `${path}: English text contains Cyrillic`);
  for (const pattern of FORBIDDEN_PATTERNS) {
    assert.ok(!pattern.test(text), `${path}: forbidden phrase ${pattern}`);
  }
  assert.ok(!THRESHOLD_PATTERN.test(prose), `${path}: forbidden phrase (score threshold)`);
}

export function checkText(text, path, options = {}) {
  assertNonEmptyString(text, path);
  checkProse(text, path, options);
  for (const [index, fragment] of texFragments(text, path).entries()) checkTex(fragment, `${path} $${index}$`);
}

// Fields the web and iPhone print as plain text (term translations, example
// titles, lesson titles, table captions, which also feed aria-label, figure
// alt): no TeX there, a «$» would reach the student literally.
export function checkPlain(text, path, options = {}) {
  checkProse(text, path, options);
  assert.ok(!/[$\\]/u.test(text), `${path}: plain-text field must not contain TeX ($ or \\)`);
}

// Без калькулятора: decimals with at most 2 digits, integers up to 4 digits.
export function checkNoCalculator(text, path) {
  for (const match of text.matchAll(/\d+(?:\.\d+)?/gu)) {
    const [whole, fraction = ""] = match[0].split(".");
    assert.ok(fraction.length <= 2, `${path}: decimal ${match[0]} needs a calculator`);
    assert.ok(whole.length <= 4, `${path}: number ${match[0]} needs a calculator`);
  }
}

// ---------------------------------------------------------------------------
// SVG profile (mirrors platform_private.learning_svg_ok of migration 285).
// ---------------------------------------------------------------------------
// Figure width on the reference phone (375 px screen, 16 px gutters, the
// figure spans the card): the label floor of §15 holds there without scroll.
export const PHONE_FIGURE_WIDTH = 343;

export function checkSvg(svg, viewBox, path) {
  const size = /^0 0 ([0-9]{3})(?:\.[0-9]+)? ([0-9]{2,3})(?:\.[0-9]+)?$/u.exec(viewBox);
  assert.ok(size && Number(size[1]) >= 360 && Number(size[1]) <= 450 && Number(size[2]) >= 100
    && Number(size[2]) <= 600, `${path}: viewBox width 360..450, height 100..600`);
  const viewBoxWidth = Number(size[1]);
  assert.ok(Buffer.byteLength(svg, "utf8") <= 24576, `${path}: SVG larger than 24 KB`);
  assert.ok(svg.startsWith("<svg "), `${path}: SVG must start with <svg`);
  assert.ok(svg.trimEnd().endsWith("</svg>"), `${path}: SVG must end with </svg>`);
  assert.ok(!/(<!|<\?|script|<style|\sstyle\s*=|foreignobject|<image|href|url\(|javascript:|data:|@import)/iu.test(svg),
    `${path}: SVG contains a forbidden construct`);
  assert.equal((svg.match(/<svg[\s>]/gu) ?? []).length, 1, `${path}: exactly one <svg> root`);
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#[0-9]{1,6}|#x[0-9a-fA-F]{1,6});)/u.test(svg), `${path}: SVG entity`);
  const palette = new Set(Object.values(PALETTE_LIGHT));
  let rootViewBox = null;
  for (const tag of svg.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/gu)) {
    const [, name, attrs] = tag;
    assert.ok(SVG_ELEMENTS.has(name), `${path}: element <${name}> is not in the SVG profile`);
    const rest = attrs.replaceAll(/\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]*)"/gu, "");
    assert.match(rest, /^\s*\/?$/u, `${path}: malformed attributes on <${name}>`);
    for (const attr of attrs.matchAll(/\s+([a-zA-Z][a-zA-Z0-9-]*)="([^"<>]*)"/gu)) {
      const [, attrName, value] = attr;
      assert.ok(SVG_ATTRIBUTES.has(attrName), `${path}: attribute ${attrName} is not in the SVG profile`);
      if (attrName === "fill" || attrName === "stroke") {
        assert.ok(value === "none" || palette.has(value.toLowerCase()), `${path}: colour ${value} is not in the palette`);
      }
      if (attrName === "font-size") {
        // 12 units for text; 11 only for a sub- or superscript tspan.
        const minimum = name === "tspan" ? 11 : 12;
        assert.ok(Number(value) >= minimum, `${path}: font-size ${value} on <${name}> is below ${minimum}`);
        // The same floor in CSS px on a 375 px phone, where the figure spans
        // the card: 343 px for the viewBox width (contract §15).
        const onPhone = (Number(value) * PHONE_FIGURE_WIDTH) / viewBoxWidth;
        assert.ok(onPhone >= minimum - 1e-9,
          `${path}: font-size ${value} on <${name}> renders ${onPhone.toFixed(1)} px on a phone, below ${minimum} px`);
      }
      if (attrName === "xmlns") assert.equal(value, "http://www.w3.org/2000/svg", `${path}: xmlns`);
      if (name === "svg" && attrName === "viewBox") rootViewBox = value;
    }
  }
  for (const tag of svg.matchAll(/<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/gu)) {
    assert.ok(SVG_ELEMENTS.has(tag[1]), `${path}: closing </${tag[1]}> is not in the SVG profile`);
  }
  for (const colour of svg.matchAll(/#[0-9a-fA-F]{3,8}/gu)) {
    assert.ok(palette.has(colour[0].toLowerCase()), `${path}: colour ${colour[0]} is not in the palette`);
  }
  assert.equal(rootViewBox, viewBox, `${path}: viewBox differs from the index`);
  // Visible text uses the real minus sign U+2212, not a hyphen.
  for (const text of svg.matchAll(/<(text|tspan)[^<>]*>([^<]*)/gu)) {
    assert.ok(!/(^|[\s(=])-(?=\s*[\dA-Za-z(])/u.test(text[2]), `${path}: use U+2212 for minus in "${text[2]}"`);
  }
}

// ---------------------------------------------------------------------------
// Sources.
// ---------------------------------------------------------------------------
export function validateRelease(release) {
  assertExactKeys(release, ["schema", "track", "module_key", "version", "title_ru", "title_ky", "level_note_ru",
    "level_note_ky", "syllabus_edition", "syllabus_url", "ky_review"], "release");
  assert.equal(release.schema, "evo.csca.release/0.1");
  assert.equal(release.track, "csca-math");
  assert.equal(release.module_key, "csca-math");
  assert.match(release.version, /^\d+\.\d+\.\d+$/u, "release.version");
  const [major, minor, patch] = release.version.split(".").map(Number);
  assert.ok(major > 1 || minor > 0 || patch > 0, "release.version must be newer than the applied release 1.0.0");
  assertPair(release, "title", "release");
  assertPair(release, "level_note", "release");
  assert.match(release.syllabus_edition, /^\d{4}$/u);
  assert.equal(release.syllabus_url, "https://csca.cn/about/testprep", "only a link to the official syllabus page");
  assert.ok(["pending", "done"].includes(release.ky_review), "release.ky_review");
  return release;
}

export function validateTopics(doc) {
  assert.equal(doc.schema, "evo.csca.topics/0.1");
  assert.equal(doc.subject, "math");
  assert.equal(doc.exam_format.calculator, false, "the exam is taken without a calculator");
  assert.equal(doc.exam_format.items, 48);
  assert.equal(doc.exam_format.minutes, 60);
  assert.equal(doc.exam_format.items * EXAM_SECONDS_PER_ITEM, doc.exam_format.minutes * 60);
  assert.ok(["pending", "done"].includes(doc.ky_review), "topics.ky_review");
  assert.ok(Array.isArray(doc.modules) && doc.modules.length === 4, "four syllabus modules");
  doc.modules.forEach((module, index) => {
    assert.equal(module.module, index + 1, "modules are numbered 1..4");
    assertPair(module, "title", `module ${module.module}`);
    assertNonEmptyString(module.title_en, `module ${module.module}.title_en`);
    assertIntBetween(module.mock_items_estimate, 0, 48, `module ${module.module}.mock_items_estimate`);
  });
  assert.equal(doc.modules.reduce((sum, module) => sum + module.mock_items_estimate, 0), 48, "mock weights sum to 48");
  const points = new Map();
  for (const point of doc.syllabus_points) {
    assertExactKeys(point, ["point", "module", "label_ru", "label_ky", "label_en"], `point ${point.point}`);
    assert.match(point.point, /^[1-4]\.[1-9]$/u);
    assert.equal(Number(point.point.split(".")[0]), point.module, `point ${point.point} module`);
    assertPair(point, "label", `point ${point.point}`);
    assertNonEmptyString(point.label_en, `point ${point.point}.label_en`);
    assert.ok(!points.has(point.point), `duplicate point ${point.point}`);
    points.set(point.point, point);
  }
  for (const section of doc.modules) {
    const own = doc.syllabus_points.filter((point) => point.module === section.module).map((point) => point.point);
    assert.deepEqual(own, own.map((_, index) => `${section.module}.${index + 1}`), `points of module ${section.module}`);
  }
  const topics = new Map();
  doc.topics.forEach((topic, index) => {
    const path = `topic ${topic.topic_key}`;
    assertExactKeys(topic, ["topic_key", "order", "module", "syllabus_point", "title_ru", "title_ky", "title_en",
      "syllabus_fit", "lessons_planned", "mock_items_estimate", "likely_gap_kg_kz", "pilot_lesson"], path);
    assert.match(topic.topic_key, new RegExp(`^m${topic.module}-[a-z0-9][a-z0-9-]{0,70}$`, "u"), `${path}.topic_key`);
    assert.equal(topic.order, index + 1, `${path}.order`);
    assert.ok(points.has(topic.syllabus_point), `${path}.syllabus_point`);
    assert.equal(points.get(topic.syllabus_point).module, topic.module, `${path} point module`);
    assertPair(topic, "title", path);
    assertNonEmptyString(topic.title_en, `${path}.title_en`);
    assert.ok(["explicit", "implied"].includes(topic.syllabus_fit), `${path}.syllabus_fit`);
    assertIntBetween(topic.lessons_planned, 0, 12, `${path}.lessons_planned`);
    assertIntBetween(topic.mock_items_estimate, 0, 48, `${path}.mock_items_estimate`);
    assert.equal(typeof topic.likely_gap_kg_kz, "boolean", `${path}.likely_gap_kg_kz`);
    assert.ok(!topics.has(topic.topic_key), `duplicate topic ${topic.topic_key}`);
    topics.set(topic.topic_key, topic);
  });
  for (const section of doc.modules) {
    const sum = doc.topics.filter((topic) => topic.module === section.module)
      .reduce((total, topic) => total + topic.mock_items_estimate, 0);
    assert.equal(sum, section.mock_items_estimate, `topic weights of module ${section.module}`);
  }
  return { doc, points, topics };
}

export function validateFigures(index, readSvg) {
  assert.equal(index.schema, "evo.csca.figures/0.1");
  assert.deepEqual(index.palette_light, PALETTE_LIGHT, "light palette");
  assert.deepEqual(index.palette_dark, PALETTE_DARK, "dark palette");
  assert.ok(["pending", "done"].includes(index.ky_review), "figures.ky_review");
  const figures = new Map();
  for (const figure of index.figures) {
    const path = `figure ${figure.figure_key}`;
    assertExactKeys(figure, ["figure_key", "file", "view_box", "bytes", "sha256", "alt_ru", "alt_ky", "alt_en",
      "used_by"], path);
    assert.match(figure.figure_key, /^[a-z0-9][a-z0-9-]{0,79}$/u, `${path}.figure_key`);
    assert.equal(figure.file, `figures/${figure.figure_key}.svg`, `${path}.file`);
    const svg = readSvg(figure.file);
    assert.equal(createHash("sha256").update(svg, "utf8").digest("hex"), figure.sha256, `${path}: sha256 drift`);
    assert.equal(Buffer.byteLength(svg, "utf8"), figure.bytes, `${path}: byte count drift`);
    checkSvg(svg, figure.view_box, path);
    assertPair(figure, "alt", path);
    assertNonEmptyString(figure.alt_en, `${path}.alt_en`);
    for (const key of ["alt_ru", "alt_ky"]) checkPlain(figure[key], `${path}.${key}`);
    checkPlain(figure.alt_en, `${path}.alt_en`, { english: true });
    assert.ok(!figures.has(figure.figure_key), `duplicate figure ${figure.figure_key}`);
    figures.set(figure.figure_key, { ...figure, svg });
  }
  return figures;
}

const ITEM_KEYS = ["item_key", "topic_key", "syllabus_point", "skill", "difficulty", "pool", "est_seconds",
  "figure_key", "stem_en", "options", "answer_index", "solution_ru", "solution_ky", "terms", "status"];

function checkTerms(terms, min, max, path) {
  assert.ok(Array.isArray(terms) && terms.length >= min && terms.length <= max, `${path} length ${min}..${max}`);
  terms.forEach((term, index) => {
    const termPath = `${path}[${index}]`;
    assertExactKeys(term, ["en", "ru", "ky"], termPath);
    assertNonEmptyString(term.en, `${termPath}.en`);
    assertNonEmptyString(term.ru, `${termPath}.ru`);
    assertNonEmptyString(term.ky, `${termPath}.ky`);
    checkPlain(term.en, `${termPath}.en`, { english: true });
    checkPlain(term.ru, `${termPath}.ru`);
    checkPlain(term.ky, `${termPath}.ky`);
  });
}

export function validateItem(item, topics, figures) {
  const path = `item ${item.item_key}`;
  assertExactKeys(item, ITEM_KEYS, path);
  const topic = topics.get(item.topic_key);
  assert.ok(topic, `${path}: unknown topic ${item.topic_key}`);
  assert.match(item.item_key, new RegExp(`^csca-math-${item.topic_key.replace(/^m\d-/u, "")}-\\d{3}$`, "u"),
    `${path}: key follows csca-math-<topic>-NNN`);
  assert.equal(item.syllabus_point, topic.syllabus_point, `${path}.syllabus_point`);
  assert.match(item.skill, /^[a-z0-9][a-z0-9-]{0,63}$/u, `${path}.skill`);
  assertIntBetween(item.difficulty, 1, 3, `${path}.difficulty`);
  assert.ok(POOLS.includes(item.pool), `${path}.pool`);
  assertIntBetween(item.est_seconds, 20, 240, `${path}.est_seconds`);
  assert.ok(item.figure_key === null || figures.has(item.figure_key), `${path}.figure_key`);
  checkText(item.stem_en, `${path}.stem_en`, { english: true });
  checkNoCalculator(item.stem_en, `${path}.stem_en`);
  assert.ok(Array.isArray(item.options) && item.options.length === 4, `${path}: exactly 4 options`);
  assert.deepEqual(item.options.map((option) => option.id), ["a", "b", "c", "d"], `${path}: option ids a..d`);
  assert.equal(new Set(item.options.map((option) => option.label)).size, 4, `${path}: option labels differ`);
  assertIntBetween(item.answer_index, 0, 3, `${path}.answer_index`);
  item.options.forEach((option, index) => {
    const optionPath = `${path}.options[${option.id}]`;
    assertExactKeys(option, ["id", "label", "explain_ru", "explain_ky"], optionPath);
    checkText(option.label, `${optionPath}.label`, { english: true });
    checkNoCalculator(option.label, `${optionPath}.label`);
    checkText(option.explain_ru, `${optionPath}.explain_ru`);
    checkText(option.explain_ky, `${optionPath}.explain_ky`);
    // Exactly one correct option, every distractor names its own mistake.
    const correct = index === item.answer_index;
    assert.equal(option.explain_ru.startsWith("Верно:"), correct, `${optionPath}.explain_ru verdict prefix`);
    assert.equal(option.explain_ru.startsWith("Неверно:"), !correct, `${optionPath}.explain_ru mistake prefix`);
    assert.equal(option.explain_ky.startsWith("Туура:"), correct, `${optionPath}.explain_ky verdict prefix`);
    assert.equal(option.explain_ky.startsWith("Туура эмес:"), !correct, `${optionPath}.explain_ky mistake prefix`);
    assert.ok(!/^(all|none) of (the )?(above|these)$/iu.test(option.label.trim()), `${optionPath}: no «all/none of the above»`);
  });
  assert.ok(Array.isArray(item.solution_ru) && item.solution_ru.length >= 1 && item.solution_ru.length <= 8,
    `${path}.solution_ru length 1..8`);
  assert.equal(item.solution_ky.length, item.solution_ru.length, `${path}: solution RU and KY have equal steps`);
  item.solution_ru.forEach((step, index) => checkText(step, `${path}.solution_ru[${index}]`));
  item.solution_ky.forEach((step, index) => checkText(step, `${path}.solution_ky[${index}]`));
  checkTerms(item.terms, 1, 6, `${path}.terms`);
  assert.equal(item.status, "draft", `${path}.status (published only after subject review)`);
  return item;
}

export function validateItems(doc, topics, figures) {
  assert.equal(doc.schema, "evo.csca.items/0.1");
  assert.equal(doc.subject, "math");
  assert.equal(doc.item_language, "en", "items are written in English, like the exam");
  assert.deepEqual(doc.explanation_languages, ["ru", "ky"]);
  assert.equal(doc.provenance.type, "evo_original", "only EVO's own items");
  assert.equal(doc.provenance.official_sample_consulted, false, "official sample questions were not consulted");
  assert.ok(["pending", "done"].includes(doc.review.ky_review), "items.review.ky_review");
  const items = new Map();
  for (const item of doc.items) {
    validateItem(item, topics, figures);
    assert.ok(!items.has(item.item_key), `duplicate item ${item.item_key}`);
    items.set(item.item_key, item);
  }
  // Answer letters balanced across the bank: 20..30 % per letter.
  const letters = { a: 0, b: 0, c: 0, d: 0 };
  for (const item of doc.items) letters[item.options[item.answer_index].id] += 1;
  for (const [letter, count] of Object.entries(letters)) {
    assert.ok(count >= Math.floor(doc.items.length * 0.2) && count <= Math.ceil(doc.items.length * 0.3),
      `answer letter ${letter} used ${count} of ${doc.items.length}`);
  }
  return items;
}

const BLOCK_KEYS = {
  idea: ["kind", "ru", "ky"],
  formula: ["kind", "tex", "note_ru", "note_ky"],
  figure: ["kind", "figure_key", "caption_ru", "caption_ky"],
  table: ["kind", "caption_ru", "caption_ky", "header", "rows"],
  example: ["kind", "title_ru", "title_ky", "stem_en", "steps", "answer_ru", "answer_ky"],
  pitfalls: ["kind", "items"],
  tip: ["kind", "tip", "ru", "ky"],
  terms: ["kind", "terms"],
  interactive: ["kind", "widget", "params", "figure_key", "caption_ru", "caption_ky"],
};

function checkCell(cell, path) {
  if (Object.hasOwn(cell, "tex")) {
    assertExactKeys(cell, ["tex"], path);
    assertNonEmptyString(cell.tex, `${path}.tex`);
    checkTex(cell.tex, `${path}.tex`);
  } else {
    assertExactKeys(cell, ["ru", "ky"], path);
    checkText(cell.ru, `${path}.ru`);
    checkText(cell.ky, `${path}.ky`);
  }
}

export function validateBlock(block, figures, itemStems, path) {
  assert.ok(block && Object.hasOwn(BLOCK_KEYS, block.kind), `${path}: unknown block kind ${block?.kind}`);
  assertExactKeys(block, BLOCK_KEYS[block.kind], path);
  const figureKeys = [];
  switch (block.kind) {
    case "idea":
    case "tip":
      if (block.kind === "tip") assert.equal(block.tip, "no_calculator", `${path}.tip`);
      checkText(block.ru, `${path}.ru`);
      checkText(block.ky, `${path}.ky`);
      break;
    case "formula":
      assert.ok(Array.isArray(block.tex) && block.tex.length >= 1 && block.tex.length <= 6, `${path}.tex 1..6`);
      block.tex.forEach((tex, index) => {
        assertNonEmptyString(tex, `${path}.tex[${index}]`);
        checkTex(tex, `${path}.tex[${index}]`);
      });
      checkText(block.note_ru, `${path}.note_ru`);
      checkText(block.note_ky, `${path}.note_ky`);
      break;
    case "figure":
    case "interactive":
      assert.ok(figures.has(block.figure_key), `${path}: unknown figure ${block.figure_key}`);
      figureKeys.push(block.figure_key);
      checkText(block.caption_ru, `${path}.caption_ru`);
      checkText(block.caption_ky, `${path}.caption_ky`);
      if (block.kind === "interactive") {
        assert.ok(INTERACTIVE_WIDGETS.has(block.widget), `${path}.widget`);
        assert.ok(block.params && typeof block.params === "object" && !Array.isArray(block.params), `${path}.params`);
        assert.ok(JSON.stringify(block.params).length <= 2048, `${path}.params size`);
      }
      break;
    case "table":
      assertNonEmptyString(block.caption_ru, `${path}.caption_ru`);
      assertNonEmptyString(block.caption_ky, `${path}.caption_ky`);
      checkPlain(block.caption_ru, `${path}.caption_ru`);
      checkPlain(block.caption_ky, `${path}.caption_ky`);
      assert.ok(Array.isArray(block.header) && block.header.length >= 2 && block.header.length <= 6, `${path}.header`);
      block.header.forEach((cell, index) => checkCell(cell, `${path}.header[${index}]`));
      assert.ok(Array.isArray(block.rows) && block.rows.length >= 1 && block.rows.length <= 20, `${path}.rows`);
      block.rows.forEach((row, rowIndex) => {
        assert.equal(row.length, block.header.length, `${path}.rows[${rowIndex}] width`);
        row.forEach((cell, index) => checkCell(cell, `${path}.rows[${rowIndex}][${index}]`));
      });
      break;
    case "example":
      assertNonEmptyString(block.title_ru, `${path}.title_ru`);
      assertNonEmptyString(block.title_ky, `${path}.title_ky`);
      checkPlain(block.title_ru, `${path}.title_ru`);
      checkPlain(block.title_ky, `${path}.title_ky`);
      checkText(block.stem_en, `${path}.stem_en`, { english: true });
      checkNoCalculator(block.stem_en, `${path}.stem_en`);
      assert.ok(!itemStems.has(block.stem_en), `${path}: a worked example must not repeat a bank item`);
      assert.ok(Array.isArray(block.steps) && block.steps.length >= 3 && block.steps.length <= 6, `${path}.steps 3..6`);
      block.steps.forEach((step, index) => {
        assertExactKeys(step, ["ru", "ky"], `${path}.steps[${index}]`);
        checkText(step.ru, `${path}.steps[${index}].ru`);
        checkText(step.ky, `${path}.steps[${index}].ky`);
      });
      checkText(block.answer_ru, `${path}.answer_ru`);
      checkText(block.answer_ky, `${path}.answer_ky`);
      break;
    case "pitfalls":
      assert.ok(Array.isArray(block.items) && block.items.length >= 2 && block.items.length <= 4, `${path}.items 2..4`);
      block.items.forEach((entry, index) => {
        assertExactKeys(entry, ["ru", "ky"], `${path}.items[${index}]`);
        checkText(entry.ru, `${path}.items[${index}].ru`);
        checkText(entry.ky, `${path}.items[${index}].ky`);
      });
      break;
    case "terms":
      checkTerms(block.terms, 1, 24, `${path}.terms`);
      break;
    default:
      assert.fail(`${path}: unhandled block kind`);
  }
  return figureKeys;
}

const LESSON_KEYS = ["schema", "lesson_key", "subject", "topic_key", "syllabus_point", "order_in_topic", "kind",
  "est_minutes", "title_ru", "title_ky", "title_en", "goal_ru", "goal_ky", "prerequisites", "blocks",
  "check_items", "practice_items", "status"];

export function validateLesson(lesson, topics, items, figures) {
  const path = `lesson ${lesson.lesson_key}`;
  assertExactKeys(lesson, LESSON_KEYS, path);
  assert.equal(lesson.schema, "evo.csca.lesson/0.1");
  assert.equal(lesson.subject, "math");
  const topic = topics.get(lesson.topic_key);
  assert.ok(topic, `${path}: unknown topic`);
  assert.equal(lesson.lesson_key, `csca-math-${lesson.topic_key}-l${lesson.order_in_topic}`, `${path}.lesson_key`);
  assert.equal(lesson.syllabus_point, topic.syllabus_point, `${path}.syllabus_point`);
  assert.equal(lesson.kind, "lesson", `${path}.kind`);
  assertIntBetween(lesson.order_in_topic, 1, 9, `${path}.order_in_topic`);
  assertIntBetween(lesson.est_minutes, 1, 60, `${path}.est_minutes`);
  for (const key of ["goal_ru", "goal_ky"]) checkText(lesson[key], `${path}.${key}`);
  for (const key of ["title_ru", "title_ky"]) checkPlain(lesson[key], `${path}.${key}`);
  checkPlain(lesson.title_en, `${path}.title_en`, { english: true });
  for (const prerequisite of lesson.prerequisites) {
    const required = topics.get(prerequisite);
    assert.ok(required && required.order < topic.order, `${path}: prerequisite ${prerequisite} must be an earlier topic`);
  }
  assert.ok(Array.isArray(lesson.blocks) && lesson.blocks.length >= 1 && lesson.blocks.length <= 24, `${path}.blocks 1..24`);
  const itemStems = new Set([...items.values()].map((item) => item.stem_en));
  const figureKeys = lesson.blocks.flatMap((block, index) =>
    validateBlock(block, figures, itemStems, `${path}.blocks[${index}]`));
  assert.ok(Buffer.byteLength(JSON.stringify(lesson.blocks), "utf8") <= 65536, `${path}: theory over 64 KB`);
  assert.ok(lesson.check_items.length >= 3 && lesson.check_items.length <= 5, `${path}: 3..5 check items`);
  assert.ok(lesson.practice_items.length >= 1 && lesson.practice_items.length <= 15, `${path}: practice items`);
  for (const [list, pool] of [[lesson.check_items, "lesson"], [lesson.practice_items, "practice"]]) {
    for (const key of list) {
      const item = items.get(key);
      assert.ok(item, `${path}: unknown item ${key}`);
      assert.equal(item.pool, pool, `${path}: ${key} must be in pool ${pool}`);
      assert.equal(item.topic_key, lesson.topic_key, `${path}: ${key} belongs to another topic`);
    }
  }
  assert.ok(["pending", "done"].includes(lesson.status.ky_review), `${path}.status.ky_review`);
  return { lesson, figureKeys };
}

export function validateForms(doc, items) {
  assert.equal(doc.schema, "evo.csca.forms/0.1");
  assert.ok(["pending", "done"].includes(doc.ky_review), "forms.ky_review");
  const keys = new Set();
  for (const form of doc.forms) {
    const path = `form ${form.form_key}`;
    assertExactKeys(form, ["form_key", "kind", "duration_seconds", "allow_early_finish", "title_ru", "title_ky",
      "intro_ru", "intro_ky", "item_keys"], path);
    assert.match(form.form_key, /^csca-math-(diagnostic|mock)-\d+$/u, `${path}.form_key`);
    assert.ok(form.form_key.includes(`-${form.kind}-`), `${path}: key names the kind`);
    assert.ok(["diagnostic", "mock"].includes(form.kind), `${path}.kind`);
    for (const key of ["title_ru", "title_ky", "intro_ru", "intro_ky"]) checkText(form[key], `${path}.${key}`);
    assert.ok(form.item_keys.length >= 1 && form.item_keys.length <= 80, `${path}: 1..80 items`);
    assert.equal(new Set(form.item_keys).size, form.item_keys.length, `${path}: no repeated item`);
    for (const key of form.item_keys) {
      assert.ok(items.has(key), `${path}: unknown item ${key}`);
      assert.equal(items.get(key).pool, form.kind, `${path}: ${key} must be in pool ${form.kind}`);
      assert.ok(!keys.has(key), `${path}: ${key} is already used by another form`);
      keys.add(key);
    }
    for (const key of ["intro_ru", "intro_ky"]) {
      assert.ok(form[key].startsWith(`${form.item_keys.length} `), `${path}.${key} must start with the item count`);
    }
    if (form.kind === "mock") {
      // Как на экзамене: 75 секунд на задание, досрочного завершения нет.
      assert.equal(form.allow_early_finish, false, `${path}: a mock test has no early finish`);
      assert.equal(form.duration_seconds, form.item_keys.length * EXAM_SECONDS_PER_ITEM, `${path}: exam pace`);
    } else {
      assert.ok(form.duration_seconds >= form.item_keys.length * 60, `${path}: at least 60 s per item`);
    }
    assertIntBetween(form.duration_seconds, 60, 7200, `${path}.duration_seconds`);
  }
  return doc.forms;
}

export function validateSessions(doc) {
  assert.equal(doc.schema, "evo.csca.sessions/0.1");
  assert.match(doc.source_url, /^https:\/\/csca\.cn(\/[A-Za-z0-9/._-]*)?$/u, "sessions.source_url");
  assert.match(doc.verified_on, /^\d{4}-\d{2}-\d{2}$/u);
  checkProse(doc.method_ru, "sessions.method_ru");
  const keys = new Set();
  for (const session of doc.sessions) {
    const path = `session ${session.session_key}`;
    assertExactKeys(session, ["session_key", "exam_from", "exam_to", "registration_opens_at",
      "registration_closes_at"], path);
    assert.equal(session.session_key, session.exam_from.slice(0, 7), `${path}: key is the exam month`);
    const from = Date.parse(`${session.exam_from}T00:00:00Z`);
    const to = Date.parse(`${session.exam_to}T00:00:00Z`);
    assert.ok(from <= to && to - from <= 3 * 86400000, `${path}: exam days`);
    assert.equal(session.registration_opens_at === null, session.registration_closes_at === null, `${path}: window`);
    if (session.registration_opens_at !== null) {
      assert.ok(Date.parse(session.registration_opens_at) < Date.parse(session.registration_closes_at), `${path}: window order`);
      assert.ok(Date.parse(session.registration_closes_at) < from + 86400000, `${path}: registration closes before the exam`);
    }
    assert.ok(!keys.has(session.session_key), `duplicate ${path}`);
    keys.add(session.session_key);
  }
  return doc.sessions;
}

// ---------------------------------------------------------------------------
// Load everything and cross-check.
// ---------------------------------------------------------------------------
export function loadCscaContent(readText = (name) => readFileSync(resolve(root, name), "utf8")) {
  const sources = {};
  const read = (name) => {
    const raw = readText(name);
    sources[name] = raw;
    return JSON.parse(raw);
  };
  const release = validateRelease(read(RELEASE_FILE));
  const { doc: topicsDoc, points, topics } = validateTopics(read(TOPICS_FILE));
  const figureIndex = read(FIGURES_INDEX_FILE);
  const figures = validateFigures(figureIndex, (file) => {
    const name = `${MATH_DIR}/${file}`;
    const raw = readText(name);
    sources[name] = raw;
    return raw;
  });
  const items = validateItems(read(ITEMS_FILE), topics, figures);
  const lessons = LESSON_FILES.map((name) => validateLesson(read(name), topics, items, figures));
  const forms = validateForms(read(FORMS_FILE), items);
  const sessionsDoc = read(SESSIONS_FILE);
  const sessions = validateSessions(sessionsDoc);

  // Every item is used exactly once: a lesson check, a practice set or a form.
  const used = new Map();
  const use = (key, where) => {
    assert.ok(!used.has(key), `item ${key} is used twice (${used.get(key)} and ${where})`);
    used.set(key, where);
  };
  for (const { lesson } of lessons) {
    lesson.check_items.forEach((key) => use(key, lesson.lesson_key));
    lesson.practice_items.forEach((key) => use(key, `${lesson.lesson_key} practice`));
  }
  for (const form of forms) form.item_keys.forEach((key) => use(key, form.form_key));
  for (const key of items.keys()) assert.ok(used.has(key), `item ${key} is not used anywhere`);
  assert.equal(new Set(lessons.map(({ lesson }) => lesson.lesson_key)).size, lessons.length, "lesson keys unique");

  // Figures: the index «used_by» matches real use by lessons and items.
  for (const [key, figure] of figures) {
    const actual = [
      ...lessons.filter(({ figureKeys }) => figureKeys.includes(key)).map(({ lesson }) => lesson.lesson_key),
      ...[...items.values()].filter((item) => item.figure_key === key).map((item) => item.item_key),
    ].sort();
    assert.ok(actual.length > 0, `figure ${key} is not used`);
    for (const user of figure.used_by) {
      assert.ok(actual.includes(user) || items.has(user), `figure ${key}: used_by ${user} does not use it`);
    }
    for (const user of actual.filter((name) => !items.has(name))) {
      assert.ok(figure.used_by.includes(user), `figure ${key}: used_by misses ${user}`);
    }
  }
  return { release, topicsDoc, points, topics, figures, items, lessons, forms, sessions, sessionsDoc, sources };
}

// ---------------------------------------------------------------------------
// SQL.
// ---------------------------------------------------------------------------
function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonbLiteral(value) {
  return `${sqlString(JSON.stringify(value))}::JSONB`;
}

function insert(table, columns, rows) {
  return [
    `INSERT INTO ${table} (${columns.join(", ")})`,
    "VALUES",
    rows.map((row) => `  (${row.join(", ")})`).join(",\n") + ";",
  ].join("\n");
}

export const PRACTICE_GOAL_RU = "Задания по теме без таймера. После каждого ответа сразу виден разбор.";
export const PRACTICE_GOAL_KY = "Тема боюнча убакыт чектелбеген тапшырмалар. Ар бир жооптон кийин талдоо дароо көрүнөт.";

export function buildRows(content) {
  const { release, topicsDoc, topics, figures, items, lessons, forms } = content;
  const version = release.version;
  const moduleId = contentUuid("module", `${release.module_key}@${version}`);
  const sections = topicsDoc.modules.map((module) => ({
    section: module.module,
    title_ru: module.title_ru,
    title_ky: module.title_ky,
    title_en: module.title_en,
    mock_items_estimate: module.mock_items_estimate,
    points: topicsDoc.syllabus_points.filter((point) => point.module === module.module).map((point) => ({
      point: point.point, label_ru: point.label_ru, label_ky: point.label_ky, label_en: point.label_en,
    })),
  }));
  const moduleRow = {
    id: moduleId, module_key: release.module_key, version, track: release.track,
    metadata: {
      title_ru: release.title_ru, title_ky: release.title_ky,
      level_note_ru: release.level_note_ru, level_note_ky: release.level_note_ky,
      syllabus_edition: release.syllabus_edition, syllabus_url: release.syllabus_url,
      sections,
    },
  };
  const prerequisitesByTopic = new Map();
  for (const { lesson } of lessons) {
    const list = prerequisitesByTopic.get(lesson.topic_key) ?? [];
    for (const prerequisite of lesson.prerequisites) if (!list.includes(prerequisite)) list.push(prerequisite);
    prerequisitesByTopic.set(lesson.topic_key, list);
  }
  const topicRows = [...topics.values()].map((topic) => ({
    id: contentUuid("topic", `${topic.topic_key}@${version}`),
    topic_key: topic.topic_key,
    order_index: topic.order,
    metadata: {
      title_ru: topic.title_ru, title_ky: topic.title_ky, title_en: topic.title_en,
      section: topic.module, syllabus_point: topic.syllabus_point, syllabus_fit: topic.syllabus_fit,
      mock_items_estimate: topic.mock_items_estimate, likely_gap: topic.likely_gap_kg_kz,
      prerequisites: prerequisitesByTopic.get(topic.topic_key) ?? [],
      lessons_planned: topic.lessons_planned,
    },
  }));
  const figureRows = [...figures.values()].map((figure) => ({
    id: contentUuid("figure", `${figure.figure_key}@${version}`),
    figure_key: figure.figure_key, svg: figure.svg, view_box: figure.view_box,
    alt_ru: figure.alt_ru, alt_ky: figure.alt_ky, alt_en: figure.alt_en, sha256: figure.sha256,
  }));
  const itemRows = [...items.values()].map((item) => {
    const body = {
      stem_en: item.stem_en, options: item.options, answer_index: item.answer_index,
      solution_ru: item.solution_ru, solution_ky: item.solution_ky, terms: item.terms,
      skill: item.skill, est_seconds: item.est_seconds,
    };
    if (item.figure_key !== null) body.figure_key = item.figure_key;
    return {
      id: contentUuid("item", `${item.item_key}@${version}`), item_key: item.item_key,
      topic_key: item.topic_key, syllabus_point: item.syllabus_point, difficulty: item.difficulty,
      pool: item.pool, body,
    };
  });
  const ordered = [...lessons].sort((left, right) =>
    topics.get(left.lesson.topic_key).order - topics.get(right.lesson.topic_key).order
    || left.lesson.order_in_topic - right.lesson.order_in_topic);
  const lessonRows = [];
  const exerciseRows = [];
  for (const { lesson } of ordered) {
    const practiceKey = lesson.lesson_key.replace(/-l(\d+)$/u, "-p$1");
    const practiceSeconds = lesson.practice_items.reduce((sum, key) => sum + items.get(key).est_seconds, 0);
    for (const entry of [
      { key: lesson.lesson_key, kind: "lesson", goalRu: lesson.goal_ru, goalKy: lesson.goal_ky,
        minutes: lesson.est_minutes, theory: lesson.blocks, itemKeys: lesson.check_items },
      { key: practiceKey, kind: "practice", goalRu: PRACTICE_GOAL_RU, goalKy: PRACTICE_GOAL_KY,
        minutes: Math.max(1, Math.ceil(practiceSeconds / 60)), theory: [], itemKeys: lesson.practice_items },
    ]) {
      const lessonId = contentUuid("lesson", `${entry.key}@${version}`);
      lessonRows.push({
        id: lessonId, lesson_key: entry.key, order_index: lessonRows.length + 1,
        metadata: {
          title_ru: lesson.title_ru, title_ky: lesson.title_ky, title_en: lesson.title_en,
          goal_ru: entry.goalRu, goal_ky: entry.goalKy, topic_key: lesson.topic_key, kind: entry.kind,
          est_minutes: entry.minutes, syllabus_point: lesson.syllabus_point,
        },
        theory: entry.theory,
      });
      entry.itemKeys.forEach((itemKey, index) => exerciseRows.push({
        id: contentUuid("exercise", `${entry.key}:${itemKey}@${version}`), lesson_id: lessonId,
        exercise_key: itemKey, order_index: index + 1, body: { item_key: itemKey },
      }));
    }
  }
  const formRows = forms.map((form) => ({
    id: contentUuid("form", `${form.form_key}@${version}`), form_key: form.form_key, kind: form.kind,
    metadata: { title_ru: form.title_ru, title_ky: form.title_ky, intro_ru: form.intro_ru, intro_ky: form.intro_ky },
    duration_seconds: form.duration_seconds, allow_early_finish: form.allow_early_finish, item_keys: form.item_keys,
  }));
  return { moduleRow, topicRows, figureRows, itemRows, lessonRows, exerciseRows, formRows };
}

export function generateSeed() {
  const content = loadCscaContent();
  const rows = buildRows(content);
  const { moduleRow, topicRows, figureRows, itemRows, lessonRows, exerciseRows, formRows } = rows;
  const moduleId = sqlString(moduleRow.id);
  const statements = [
    insert("platform_private.learning_modules", ["id", "module_key", "version", "track", "metadata"], [[
      moduleId, sqlString(moduleRow.module_key), sqlString(moduleRow.version), sqlString(moduleRow.track),
      jsonbLiteral(moduleRow.metadata)]]),
    insert("platform_private.learning_topics", ["id", "module_id", "topic_key", "order_index", "metadata"],
      topicRows.map((row) => [sqlString(row.id), moduleId, sqlString(row.topic_key), String(row.order_index),
        jsonbLiteral(row.metadata)])),
    insert("platform_private.learning_figures", ["id", "module_id", "figure_key", "svg", "view_box", "alt_ru", "alt_ky",
      "alt_en", "sha256"],
    figureRows.map((row) => [sqlString(row.id), moduleId, sqlString(row.figure_key), sqlString(row.svg),
      sqlString(row.view_box), sqlString(row.alt_ru), sqlString(row.alt_ky), sqlString(row.alt_en),
      sqlString(row.sha256)])),
    insert("platform_private.learning_items", ["id", "module_id", "item_key", "topic_key", "syllabus_point", "difficulty",
      "pool", "provenance", "body"],
    itemRows.map((row) => [sqlString(row.id), moduleId, sqlString(row.item_key), sqlString(row.topic_key),
      sqlString(row.syllabus_point), String(row.difficulty), sqlString(row.pool), "'evo_authored'",
      jsonbLiteral(row.body)])),
    insert("platform_private.learning_lessons", ["id", "module_id", "lesson_key", "order_index", "metadata", "theory"],
      lessonRows.map((row) => [sqlString(row.id), moduleId, sqlString(row.lesson_key), String(row.order_index),
        jsonbLiteral(row.metadata), jsonbLiteral(row.theory)])),
    insert("platform_private.learning_exercises", ["id", "lesson_id", "exercise_key", "order_index", "exercise_type",
      "body"],
    exerciseRows.map((row) => [sqlString(row.id), sqlString(row.lesson_id), sqlString(row.exercise_key),
      String(row.order_index), "'item'", jsonbLiteral(row.body)])),
    insert("platform_private.learning_test_forms", ["id", "module_id", "form_key", "kind", "metadata",
      "duration_seconds", "allow_early_finish", "item_keys"],
    formRows.map((row) => [sqlString(row.id), moduleId, sqlString(row.form_key), sqlString(row.kind),
      jsonbLiteral(row.metadata), String(row.duration_seconds), row.allow_early_finish ? "TRUE" : "FALSE",
      jsonbLiteral(row.item_keys)])),
  ];
  const counts = {
    topics: topicRows.length, figures: figureRows.length, items: itemRows.length, lessons: lessonRows.length,
    exercises: exerciseRows.length, forms: formRows.length,
  };
  const failure = (what) => `RAISE EXCEPTION 'CSCA math part 2 seed assertion failed: ${what}'`;
  const assertions = `DO $csca_math2$
DECLARE
  seeded_module_id UUID;
  n INTEGER;
BEGIN
  SELECT module.id INTO seeded_module_id FROM platform_private.learning_modules module
    WHERE module.module_key = ${sqlString(moduleRow.module_key)} AND module.version = ${sqlString(moduleRow.version)}
      AND module.track = ${sqlString(moduleRow.track)};
  IF seeded_module_id IS NULL THEN
    ${failure("module row is missing")};
  END IF;
  SELECT count(*) INTO n FROM platform_private.learning_topics WHERE module_id = seeded_module_id;
  IF n <> ${counts.topics} THEN ${failure(`expected ${counts.topics} topics, found %`)}, n; END IF;
  SELECT count(*) INTO n FROM platform_private.learning_figures WHERE module_id = seeded_module_id;
  IF n <> ${counts.figures} THEN ${failure(`expected ${counts.figures} figures, found %`)}, n; END IF;
  SELECT count(*) INTO n FROM platform_private.learning_items
    WHERE module_id = seeded_module_id AND provenance = 'evo_authored';
  IF n <> ${counts.items} THEN ${failure(`expected ${counts.items} EVO items, found %`)}, n; END IF;
  SELECT count(*) INTO n FROM platform_private.learning_lessons WHERE module_id = seeded_module_id;
  IF n <> ${counts.lessons} THEN ${failure(`expected ${counts.lessons} lessons, found %`)}, n; END IF;
  SELECT count(*) INTO n FROM platform_private.learning_exercises exercise
    JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
    WHERE lesson.module_id = seeded_module_id AND exercise.exercise_type = 'item';
  IF n <> ${counts.exercises} THEN ${failure(`expected ${counts.exercises} item exercises, found %`)}, n; END IF;
  SELECT count(*) INTO n FROM platform_private.learning_test_forms WHERE module_id = seeded_module_id;
  IF n <> ${counts.forms} THEN ${failure(`expected ${counts.forms} forms, found %`)}, n; END IF;
  -- Pools stay disjoint: every item is used once (lesson, practice or one form).
  SELECT count(*) INTO n FROM platform_private.learning_items item
    WHERE item.module_id = seeded_module_id
      AND (SELECT count(*) FROM platform_private.learning_exercises exercise
          JOIN platform_private.learning_lessons lesson ON lesson.id = exercise.lesson_id
          WHERE lesson.module_id = seeded_module_id AND exercise.exercise_key = item.item_key)
        + (SELECT count(*) FROM platform_private.learning_test_forms form
          WHERE form.module_id = seeded_module_id AND form.item_keys ? item.item_key) <> 1;
  IF n <> 0 THEN ${failure("% items are not used exactly once")}, n; END IF;
  -- The release is the newest of its module key: the app reads it from now on.
  IF (SELECT module.id FROM platform_private.learning_track_modules(${sqlString(moduleRow.track)}) module
      WHERE module.module_key = ${sqlString(moduleRow.module_key)}) IS DISTINCT FROM seeded_module_id THEN
    ${failure("the release is not the current one of its module key")};
  END IF;
END $csca_math2$;`;
  const header = [
    "-- «Подготовка к CSCA: математика, часть 2» (выпуск 1.1.0 модуля csca-math): immutable content",
    "-- for the engine of migration 285, the full copy of release 1.0.0 (migration 286, frozen)",
    "-- plus the 25 remaining topics. Generated by scripts/portal/generate-csca-content-seed.mjs",
    "-- from docs/design/portal/content/csca; do not edit SQL content by hand.",
    "-- Keys of topics, items, lessons and forms are stable between releases, so progress,",
    "-- the answer log and the review bank carry over; a started attempt keeps its own rows.",
    "-- Changes after application require a new content version and a new forward migration.",
    "-- Only EVO's own items (provenance = evo_authored); answer keys and разборы live only in",
    "-- platform_private, behind the 285 RPC surface. KY text awaits native proofreading.",
    ...Object.keys(content.sources).sort().map((name) =>
      `-- ${name} sha256: ${createHash("sha256").update(content.sources[name]).digest("hex")}`),
  ];
  return [
    header.join("\n"),
    "BEGIN;",
    "SELECT 'CSCA_MATH_PART2_CONTENT_SEED_START' AS csca_math2_marker;",
    ...statements,
    assertions,
    "SELECT 'CSCA_MATH_PART2_CONTENT_SEED_ASSERTED' AS csca_math2_marker;",
    "NOTIFY pgrst, 'reload schema';",
    "COMMIT;",
  ].join("\n\n") + "\n";
}

// Migration 286 is applied and frozen: pin it instead of regenerating it.
export function checkPart1Frozen() {
  const path = migrationPath(PART1_SUFFIX);
  assert.ok(path, `the applied part 1 migration (*${PART1_SUFFIX}) is missing`);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, PART1_FROZEN.bytes, "the applied part 1 migration changed (bytes)");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PART1_FROZEN.sha256,
    "the applied part 1 migration changed (sha256); published content is immutable, add a new release instead");
}

function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ["--check", "--write"].includes(args[0])),
    "Usage: node scripts/portal/generate-csca-content-seed.mjs [--check|--write]");
  checkPart1Frozen();
  const sql = generateSeed();
  const existing = migrationPath(PART2_SUFFIX);
  if (args[0] === "--check") {
    assert.ok(existing, `the part 2 migration (*${PART2_SUFFIX}) is missing`);
    assert.equal(readFileSync(existing, "utf8"), sql, "The part 2 migration differs from the versioned CSCA sources");
    process.stdout.write("CSCA content seed: part 1 frozen, part 2 exact match\n");
  } else if (args[0] === "--write") {
    const target = existing ?? resolve(root, MIGRATIONS_DIR, nextMigrationName());
    writeFileSync(target, sql, "utf8");
    process.stdout.write(`Generated ${target.slice(root.length + 1)} from checked CSCA content\n`);
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
