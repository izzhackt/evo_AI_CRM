import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXAM_SECONDS_PER_ITEM,
  SEED_PATH,
  TEX_COMMANDS,
  buildRows,
  checkNoCalculator,
  checkSvg,
  checkTex,
  checkText,
  generateSeed,
  loadCscaContent,
  texFragments,
  validateForms,
  validateItem,
  validateItems,
} from "./generate-csca-content-seed.mjs";

const content = loadCscaContent();
const rows = buildRows(content);
const firstItem = () => structuredClone(content.items.get("csca-math-exp-log-001"));

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => strings(entry, out));
  return out;
}

test("part 1 carries the pilot: 28 topics, 9 figures, 30 items, 3 lessons with practice, 2 forms, 6 sessions", () => {
  assert.equal(rows.topicRows.length, 28);
  assert.equal(rows.figureRows.length, 9);
  assert.equal(rows.itemRows.length, 30);
  assert.equal(rows.lessonRows.length, 6);
  assert.deepEqual(rows.lessonRows.map((row) => row.metadata.kind), ["lesson", "practice", "lesson", "practice",
    "lesson", "practice"]);
  assert.deepEqual(rows.lessonRows.map((row) => row.order_index), [1, 2, 3, 4, 5, 6]);
  assert.equal(rows.exerciseRows.length, 21);
  assert.equal(rows.formRows.length, 2);
  assert.equal(rows.sessionRows.length, 6);
  const pools = {};
  for (const row of rows.itemRows) pools[row.pool] = (pools[row.pool] ?? 0) + 1;
  assert.deepEqual(pools, { lesson: 12, practice: 9, diagnostic: 3, mock: 6 });
  assert.equal(rows.moduleRow.track, "csca-math");
  assert.equal(rows.moduleRow.metadata.sections.length, 4);
  assert.equal(rows.moduleRow.metadata.sections.flatMap((section) => section.points).length, 12);
  assert.equal(rows.moduleRow.metadata.sections.reduce((sum, section) => sum + section.mock_items_estimate, 0), 48);
});

test("practice lessons have no theory and only practice items; lessons hold only lesson items", () => {
  const pool = new Map(rows.itemRows.map((row) => [row.item_key, row.pool]));
  const lessonOf = new Map(rows.lessonRows.map((row) => [row.id, row]));
  for (const exercise of rows.exerciseRows) {
    const lesson = lessonOf.get(exercise.lesson_id);
    assert.equal(pool.get(exercise.exercise_key), lesson.metadata.kind, exercise.exercise_key);
    assert.deepEqual(exercise.body, { item_key: exercise.exercise_key });
  }
  for (const lesson of rows.lessonRows.filter((row) => row.metadata.kind === "practice")) {
    assert.deepEqual(lesson.theory, []);
    assert.match(lesson.lesson_key, /-p1$/u);
  }
});

test("forms follow the exam rules: the mock is 75 s per item without early finish", () => {
  const mock = rows.formRows.find((row) => row.kind === "mock");
  const diagnostic = rows.formRows.find((row) => row.kind === "diagnostic");
  assert.equal(mock.allow_early_finish, false);
  assert.equal(mock.duration_seconds, mock.item_keys.length * EXAM_SECONDS_PER_ITEM);
  assert.equal(diagnostic.allow_early_finish, true);
  assert.equal(new Set([...mock.item_keys, ...diagnostic.item_keys]).size, mock.item_keys.length + diagnostic.item_keys.length);
  const broken = structuredClone({ schema: "evo.csca.forms/0.1", ky_review: "pending",
    forms: content.forms.map((form) => ({ ...form })) });
  broken.forms.find((form) => form.kind === "mock").allow_early_finish = true;
  assert.throws(() => validateForms(broken, content.items), /no early finish/u);
  const slow = structuredClone({ schema: "evo.csca.forms/0.1", ky_review: "pending",
    forms: content.forms.map((form) => ({ ...form })) });
  slow.forms.find((form) => form.kind === "mock").duration_seconds = 600;
  assert.throws(() => validateForms(slow, content.items), /exam pace/u);
});

test("the verification wording fixes are applied (items 25, 19, 18, 17, 8, 6, 2 and lesson 2)", () => {
  assert.match(content.items.get("csca-math-line-circle-005").stem_en, /Find all possible values of \$b\$\./u);
  assert.match(content.items.get("csca-math-derivative-009").stem_en, /find the equation of the tangent line/u);
  assert.match(content.items.get("csca-math-derivative-008").stem_en, /strictly increasing/u);
  assert.match(content.items.get("csca-math-derivative-007").stem_en, /At time \$t\$ \(in seconds\)/u);
  assert.match(content.items.get("csca-math-exp-log-008").solution_ru[1], /\\left\(\\left\(\\frac\{1\}\{2\}\\right\)\^\{-2\}\\right\)/u);
  assert.match(content.items.get("csca-math-exp-log-006").options[0].explain_ru, /^Неверно: это значение \$a\$/u);
  assert.doesNotMatch(content.items.get("csca-math-exp-log-002").solution_ru[1], /вариант c\)/u);
  const derivative = content.lessons.find(({ lesson }) => lesson.topic_key === "m2-derivative").lesson;
  assert.match(derivative.blocks[0].ru, /\(rate of change\)/u);
  assert.match(derivative.blocks[7].ru, /\(critical point\)/u);
});

test("answer letters are balanced and every item has exactly one correct option", () => {
  const letters = { a: 0, b: 0, c: 0, d: 0 };
  for (const item of content.items.values()) {
    letters[item.options[item.answer_index].id] += 1;
    assert.equal(item.options.filter((option) => option.explain_ru.startsWith("Верно:")).length, 1, item.item_key);
    assert.equal(item.options.filter((option) => option.explain_ky.startsWith("Туура:")).length, 1, item.item_key);
  }
  for (const count of Object.values(letters)) assert.ok(count >= 6 && count <= 9);
});

test("every TeX fragment of the content is whitelisted and parsed by KaTeX", () => {
  let fragments = 0;
  for (const [name, raw] of Object.entries(content.sources)) {
    if (!name.endsWith(".json") || name.endsWith("sessions.json") || name.endsWith("forms.json")) continue;
    for (const text of strings(JSON.parse(raw))) fragments += texFragments(text, name).length;
  }
  assert.ok(fragments > 1500, `${fragments} TeX fragments`);
  for (const command of ["frac", "sqrt", "log", "leq", "geq", "mathbb"]) assert.ok(TEX_COMMANDS.has(command));
});

test("TeX outside the whitelist or not parseable is rejected", () => {
  assert.throws(() => checkTex("\\text{abc}", "t"), /not in the whitelist/u);
  assert.throws(() => checkTex("\\dfrac{1}{2}", "t"), /not in the whitelist/u);
  assert.throws(() => checkTex("\\begin{matrix}1\\end{matrix}", "t"), /not in the whitelist/u);
  assert.throws(() => checkTex("\\le 1", "t"), /not in the whitelist/u);
  assert.throws(() => checkTex("\\frac{1}{2", "t"), /KaTeX|braces/u);
  assert.throws(() => checkTex("x \\, y", "t"), /escape/u);
  assert.throws(() => checkText("Price is $5", "t"), /unbalanced \$/u);
  assert.throws(() => checkTex("x^{2}}", "t"), /unbalanced braces/u);
  assert.doesNotThrow(() => checkTex("\\left(\\frac{1}{2}\\right)^{-x} \\approx 1.41", "t"));
});

test("prose rules: no long dashes, no mixed alphabets, no score promises, no official material", () => {
  assert.throws(() => checkText("Ответ — пять.", "t"), /long dash/u);
  assert.throws(() => checkText("Ответ – пять.", "t"), /long dash/u);
  assert.throws(() => checkText("Наклон kасательной.", "t"), /mixes Cyrillic and Latin/u);
  for (const phrase of ["Ваш балл CSCA: 70.", "Вы в 90-м перцентиле.", "Нужно 80+ для гранта.",
    "Мы официальный партнёр CSCA.", "This is a sample question.", "Гарантируем поступление.",
    "Read the past paper."]) {
    assert.throws(() => checkText(phrase, "t"), /forbidden phrase/u, phrase);
  }
  assert.doesNotThrow(() => checkText("Это оценка EVO по нашим заданиям, а не балл экзамена.", "t"));
  assert.doesNotThrow(() => checkText("Наклон (slope) равен $2$.", "t"));
});

test("no calculator: long decimals and big numbers are rejected", () => {
  assert.throws(() => checkNoCalculator("Find $3.14159 \\cdot 2$.", "t"), /needs a calculator/u);
  assert.throws(() => checkNoCalculator("Compute $123456 + 1$.", "t"), /needs a calculator/u);
  assert.doesNotThrow(() => checkNoCalculator("Use $\\sqrt{2} \\approx 1.41$ and $2^{10} = 1024$.", "t"));
});

test("items: exactly 4 options, one correct, RU and KY разбор for each, English stems", () => {
  const { topics, figures } = content;
  assert.doesNotThrow(() => validateItem(firstItem(), topics, figures));
  const three = firstItem(); three.options.pop();
  assert.throws(() => validateItem(three, topics, figures), /exactly 4 options/u);
  const twoCorrect = firstItem();
  const wrongIndex = twoCorrect.answer_index === 0 ? 1 : 0;
  twoCorrect.options[wrongIndex].explain_ru = twoCorrect.options[twoCorrect.answer_index].explain_ru;
  assert.throws(() => validateItem(twoCorrect, topics, figures), /prefix/u);
  const noKy = firstItem(); noKy.options[2].explain_ky = " ";
  assert.throws(() => validateItem(noKy, topics, figures), /must not be blank/u);
  const russianStem = firstItem(); russianStem.stem_en = "Найдите $\\log_2 8$.";
  assert.throws(() => validateItem(russianStem, topics, figures), /English text contains Cyrillic/u);
  const calculator = firstItem(); calculator.stem_en = "Find $\\log_2 8.123$.";
  assert.throws(() => validateItem(calculator, topics, figures), /needs a calculator/u);
  const strayKey = firstItem(); strayKey.source = "csca.cn";
  assert.throws(() => validateItem(strayKey, topics, figures), /keys/u);
  const badSteps = firstItem(); badSteps.solution_ky = badSteps.solution_ky.slice(1);
  assert.throws(() => validateItem(badSteps, topics, figures), /equal steps/u);
});

test("the bank refuses official samples and unbalanced letters", () => {
  const doc = JSON.parse(content.sources["docs/design/portal/content/csca/math/items.json"]);
  const consulted = structuredClone(doc); consulted.provenance.official_sample_consulted = true;
  assert.throws(() => validateItems(consulted, content.topics, content.figures), /official sample/u);
  const skewed = structuredClone(doc);
  for (const item of skewed.items.slice(0, 12)) {
    const correct = item.options[item.answer_index];
    const first = item.options[0];
    [first.label, correct.label] = [correct.label, first.label];
    [first.explain_ru, correct.explain_ru] = [correct.explain_ru, first.explain_ru];
    [first.explain_ky, correct.explain_ky] = [correct.explain_ky, first.explain_ky];
    item.answer_index = 0;
  }
  assert.throws(() => validateItems(skewed, content.topics, content.figures), /answer letter/u);
});

test("SVG profile and the six-colour palette", () => {
  const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#ffffff"/>'
    + '<text x="1" y="2" font-size="14" fill="#191714">y = −1</text></svg>';
  assert.doesNotThrow(() => checkSvg(good, "0 0 400 300", "svg"));
  const cases = [
    [good.replace("<rect", "<script>x</script><rect"), /forbidden construct/u],
    [good.replace("#ffffff", "#00ff00"), /palette/u],
    [good.replace('fill="#ffffff"', 'style="fill:#ffffff"'), /forbidden construct/u],
    [good.replace("<rect", '<image width="1" height="1"/><rect'), /forbidden construct/u],
    [good.replace('font-size="14"', 'font-size="10"'), /below 12/u],
    [good.replace("−1", "-1"), /U\+2212/u],
    [good.replace("<rect", '<ellipse rx="1" ry="1"/><rect'), /not in the SVG profile/u],
    [good.replace('<rect width', '<rect onload="x()" width'), /not in the SVG profile/u],
  ];
  for (const [svg, pattern] of cases) assert.throws(() => checkSvg(svg, "0 0 400 300", "svg"), pattern);
  assert.throws(() => checkSvg(good, "0 0 800 300", "svg"), /viewBox/u);
  for (const figure of content.figures.values()) {
    assert.doesNotThrow(() => checkSvg(figure.svg, figure.view_box, figure.figure_key));
  }
});

test("generated seed exactly matches the committed 286 and inserts only private content", () => {
  const sql = generateSeed();
  assert.equal(readFileSync(SEED_PATH, "utf8"), sql);
  assert.equal((sql.match(/INSERT INTO platform_private\.learning_modules /gu) ?? []).length, 1);
  assert.equal((sql.match(/INSERT INTO /gu) ?? []).length, 8);
  assert.doesNotMatch(sql, /ON CONFLICT|UPDATE platform|DELETE FROM|INSERT INTO auth\.|INSERT INTO platform\./u);
  assert.doesNotMatch(sql, /csca\.cn\/files/u);
  assert.match(sql, /P286_CSCA_MATH_CONTENT_SEED_START/u);
  assert.match(sql, /P286_CSCA_MATH_CONTENT_SEED_ASSERTED/u);
  assert.equal((sql.match(/'evo_authored', '\{/gu) ?? []).length, 30);
  assert.ok(sql.endsWith("COMMIT;\n"));
  assert.ok(!sql.endsWith("\n\n"));
});
