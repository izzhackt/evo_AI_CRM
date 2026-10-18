import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXAM_SECONDS_PER_ITEM,
  PART1_FROZEN,
  PART1_SUFFIX,
  PART2_SUFFIX,
  TEX_COMMANDS,
  buildRows,
  checkNoCalculator,
  checkPart1Frozen,
  checkPlain,
  checkSvg,
  checkTex,
  checkText,
  generateSeed,
  loadCscaContent,
  migrationFiles,
  migrationPath,
  nextMigrationName,
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

test("part 2 is the full release 1.1.0: 28 topics each with a lesson and a practice set, 228 items, 2 forms", () => {
  assert.equal(rows.moduleRow.version, "1.1.0");
  assert.equal(rows.topicRows.length, 28);
  assert.equal(rows.figureRows.length, 55);
  assert.equal(rows.itemRows.length, 228);
  assert.equal(rows.lessonRows.length, 56);
  assert.deepEqual(rows.lessonRows.map((row) => row.metadata.kind), Array.from({ length: 28 }, () => ["lesson", "practice"]).flat());
  assert.deepEqual(rows.lessonRows.map((row) => row.order_index), Array.from({ length: 56 }, (_, index) => index + 1));
  assert.equal(rows.exerciseRows.length, 93 + 63);
  assert.equal(rows.formRows.length, 2);
  const pools = {};
  for (const row of rows.itemRows) pools[row.pool] = (pools[row.pool] ?? 0) + 1;
  assert.deepEqual(pools, { lesson: 93, practice: 63, diagnostic: 24, mock: 48 });
  assert.equal(rows.moduleRow.track, "csca-math");
  assert.equal(rows.moduleRow.metadata.sections.length, 4);
  assert.equal(rows.moduleRow.metadata.sections.flatMap((section) => section.points).length, 12);
  assert.equal(rows.moduleRow.metadata.sections.reduce((sum, section) => sum + section.mock_items_estimate, 0), 48);
  assert.equal("sessionRows" in rows, false, "the exam calendar lives in part 1 and is not repeated");
});

test("every topic has exactly one lesson with 3 to 5 checks and a practice set; topics name their lesson", () => {
  const perTopic = new Map();
  for (const { lesson } of content.lessons) perTopic.set(lesson.topic_key, (perTopic.get(lesson.topic_key) ?? 0) + 1);
  assert.deepEqual([...perTopic.keys()].sort(), [...content.topics.keys()].sort());
  for (const [topicKey, count] of perTopic) assert.equal(count, 1, topicKey);
  for (const { lesson } of content.lessons) {
    assert.ok(lesson.check_items.length >= 3 && lesson.check_items.length <= 5, lesson.lesson_key);
    assert.ok(lesson.practice_items.length >= 1, lesson.lesson_key);
    assert.equal(content.topics.get(lesson.topic_key).pilot_lesson, lesson.lesson_key);
  }
  const state = rows.topicRows.map((row) => row.metadata.lessons_planned);
  assert.ok(state.every((planned) => Number.isInteger(planned) && planned >= 1));
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

test("forms follow the exam rules: a 48 item mock at 75 s per item without early finish, a 24 item diagnostic", () => {
  const mock = rows.formRows.find((row) => row.kind === "mock");
  const diagnostic = rows.formRows.find((row) => row.kind === "diagnostic");
  assert.equal(mock.form_key, "csca-math-mock-2");
  assert.equal(diagnostic.form_key, "csca-math-diagnostic-2");
  assert.equal(mock.allow_early_finish, false);
  assert.equal(mock.item_keys.length, 48);
  assert.equal(mock.duration_seconds, 48 * EXAM_SECONDS_PER_ITEM);
  assert.equal(mock.duration_seconds, 60 * 60);
  assert.equal(diagnostic.allow_early_finish, true);
  assert.equal(diagnostic.item_keys.length, 24);
  assert.equal(diagnostic.duration_seconds, 30 * 60);
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

test("the mock follows DESIGN 8.2: modules 7, 19, 14, 8, difficulty 14, 24, 10, topic weights as estimated", () => {
  const mock = rows.formRows.find((row) => row.kind === "mock");
  const bank = new Map(rows.itemRows.map((row) => [row.item_key, row]));
  const byModule = {};
  const byDifficulty = {};
  const byTopic = {};
  mock.item_keys.forEach((key) => {
    const row = bank.get(key);
    const module = Number(row.topic_key[1]);
    byModule[module] = (byModule[module] ?? 0) + 1;
    byDifficulty[row.difficulty] = (byDifficulty[row.difficulty] ?? 0) + 1;
    byTopic[row.topic_key] = (byTopic[row.topic_key] ?? 0) + 1;
  });
  assert.deepEqual(byModule, { 1: 7, 2: 19, 3: 14, 4: 8 });
  assert.deepEqual(byDifficulty, { 1: 14, 2: 24, 3: 10 });
  for (const row of rows.topicRows) assert.equal(byTopic[row.topic_key], row.metadata.mock_items_estimate, row.topic_key);
  // Order: by module, inside a module from simpler to harder.
  const modules = mock.item_keys.map((key) => Number(bank.get(key).topic_key[1]));
  assert.deepEqual(modules, [...modules].sort((left, right) => left - right));
  for (const module of [1, 2, 3, 4]) {
    const levels = mock.item_keys.map((key) => bank.get(key)).filter((row) => Number(row.topic_key[1]) === module)
      .map((row) => row.difficulty);
    assert.deepEqual(levels, [...levels].sort((left, right) => left - right), `module ${module}`);
  }
  // Time budget: the estimates fit the hour with a margin.
  const seconds = mock.item_keys.reduce((sum, key) => sum + bank.get(key).body.est_seconds, 0);
  assert.ok(seconds <= mock.duration_seconds, `${seconds} s estimated for ${mock.duration_seconds} s`);
});

test("the diagnostic has two items on each of the 12 syllabus points, difficulty 2, and covers every module", () => {
  const diagnostic = rows.formRows.find((row) => row.kind === "diagnostic");
  const bank = new Map(rows.itemRows.map((row) => [row.item_key, row]));
  const points = {};
  for (const key of diagnostic.item_keys) {
    const row = bank.get(key);
    points[row.syllabus_point] = (points[row.syllabus_point] ?? 0) + 1;
    assert.equal(row.difficulty, 2, key);
  }
  assert.deepEqual(Object.keys(points).sort(), content.points ? [...content.points.keys()].sort() : Object.keys(points));
  assert.equal(Object.keys(points).length, 12);
  for (const count of Object.values(points)) assert.equal(count, 2);
  assert.deepEqual([...new Set(diagnostic.item_keys.map((key) => bank.get(key).topic_key[1]))].sort(), ["1", "2", "3", "4"]);
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
  const total = content.items.size;
  for (const count of Object.values(letters)) {
    assert.ok(count >= Math.floor(total * 0.2) && count <= Math.ceil(total * 0.3), `${count} of ${total}`);
  }
  // Each form is balanced too: no letter carries more than 35 % of a form.
  for (const form of content.forms) {
    const counts = { a: 0, b: 0, c: 0, d: 0 };
    for (const key of form.item_keys) {
      const item = content.items.get(key);
      counts[item.options[item.answer_index].id] += 1;
    }
    for (const count of Object.values(counts)) assert.ok(count <= Math.ceil(form.item_keys.length * 0.35), form.form_key);
  }
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

test("plain-text fields (terms, captions, example and lesson titles, figure alt) refuse TeX", () => {
  assert.throws(() => checkPlain("сумма первых $n$ членов", "t"), /plain-text field/u);
  assert.throws(() => checkPlain("угол \\alpha", "t"), /plain-text field/u);
  assert.doesNotThrow(() => checkPlain("сумма первых n членов", "t"));
  // The content obeys: no «$» reaches the student in a plain field (web TheoryBlocks prints these as text and
  // puts the table caption into aria-label).
  for (const { lesson } of content.lessons) {
    for (const block of lesson.blocks) {
      if (block.kind === "table") assert.doesNotMatch(block.caption_ru + block.caption_ky, /\$/u, lesson.lesson_key);
      if (block.kind === "example") assert.doesNotMatch(block.title_ru + block.title_ky, /\$/u, lesson.lesson_key);
      if (block.kind === "terms") {
        for (const term of block.terms) assert.doesNotMatch(term.en + term.ru + term.ky, /[$\\]/u, lesson.lesson_key);
      }
    }
  }
  for (const item of content.items.values()) {
    for (const term of item.terms) assert.doesNotMatch(term.en + term.ru + term.ky, /[$\\]/u, item.item_key);
  }
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
  for (const item of skewed.items.slice(0, 80)) {
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
    [good.replace('font-size="14"', 'font-size="13"'), /renders 11\.1 px on a phone, below 12 px/u],
    [good.replace("−1", "-1"), /U\+2212/u],
    [good.replace("<rect", '<ellipse rx="1" ry="1"/><rect'), /not in the SVG profile/u],
    [good.replace('<rect width', '<rect onload="x()" width'), /not in the SVG profile/u],
  ];
  for (const [svg, pattern] of cases) assert.throws(() => checkSvg(svg, "0 0 400 300", "svg"), pattern);
  assert.throws(() => checkSvg(good, "0 0 800 300", "svg"), /viewBox/u);
  // 13 units are enough on a 360 viewBox (13 × 343 / 360 = 12.4 px), not on 400.
  const narrow = good.replace('viewBox="0 0 400 300"', 'viewBox="0 0 360 300"').replace('font-size="14"', 'font-size="13"');
  assert.doesNotThrow(() => checkSvg(narrow, "0 0 360 300", "svg"));
  for (const figure of content.figures.values()) {
    assert.doesNotThrow(() => checkSvg(figure.svg, figure.view_box, figure.figure_key));
  }
});

test("generated seed exactly matches the committed part 2 migration and inserts only private content", () => {
  const path = migrationPath(PART2_SUFFIX);
  assert.ok(path, "the part 2 migration exists");
  const sql = generateSeed();
  assert.equal(readFileSync(path, "utf8"), sql);
  assert.equal((sql.match(/INSERT INTO platform_private\.learning_modules /gu) ?? []).length, 1);
  assert.equal((sql.match(/INSERT INTO /gu) ?? []).length, 7);
  assert.doesNotMatch(sql, /ON CONFLICT|UPDATE platform|DELETE FROM|INSERT INTO auth\.|INSERT INTO platform\./u);
  assert.doesNotMatch(sql, /INSERT INTO platform_private\.csca_exam_sessions/u, "the calendar is not repeated");
  assert.doesNotMatch(sql, /csca\.cn\/files/u);
  assert.match(sql, /CSCA_MATH_PART2_CONTENT_SEED_START/u);
  assert.match(sql, /CSCA_MATH_PART2_CONTENT_SEED_ASSERTED/u);
  assert.equal((sql.match(/'evo_authored', '\{/gu) ?? []).length, 228);
  assert.ok(sql.endsWith("COMMIT;\n"));
  assert.ok(!sql.endsWith("\n\n"));
});

test("migration numbering: found by name, one file, next free number offered for a new one", () => {
  const names = migrationFiles();
  assert.equal(names.filter((name) => name.endsWith(PART1_SUFFIX)).length, 1);
  assert.equal(names.filter((name) => name.endsWith(PART2_SUFFIX)).length, 1);
  const part1 = names.find((name) => name.endsWith(PART1_SUFFIX));
  const part2 = names.find((name) => name.endsWith(PART2_SUFFIX));
  assert.ok(part1 < part2, "part 2 sorts after part 1");
  assert.match(nextMigrationName(), new RegExp(`^\\d{3}${PART2_SUFFIX.replace(".", "\\.")}$`, "u"));
  assert.ok(nextMigrationName() > names.at(-1), "a new file would sort after every existing migration");
});

// ---------------------------------------------------------------------------
// Release 1.0.0 (migration 286) is applied and immutable; release 1.1.0 carries
// its content unchanged, so keys, bodies and progress stay valid.
// ---------------------------------------------------------------------------
function readSqlRows(sql, table) {
  const start = sql.indexOf(`INSERT INTO ${table} (`);
  assert.ok(start >= 0, `${table} is inserted`);
  const columns = /\(([^)]*)\)/u.exec(sql.slice(start + `INSERT INTO ${table} `.length))[1].split(",").map((name) => name.trim());
  let at = sql.indexOf("\nVALUES\n", start) + "\nVALUES\n".length;
  const rowsOut = [];
  const readString = () => {
    assert.equal(sql[at], "'");
    at += 1;
    let out = "";
    for (;;) {
      const quote = sql.indexOf("'", at);
      assert.ok(quote >= 0, "unterminated SQL string");
      out += sql.slice(at, quote);
      if (sql[quote + 1] === "'") { out += "'"; at = quote + 2; } else { at = quote + 1; return out; }
    }
  };
  for (;;) {
    while (sql[at] === " " || sql[at] === "\n") at += 1;
    assert.equal(sql[at], "(");
    at += 1;
    const values = [];
    for (;;) {
      while (sql[at] === " ") at += 1;
      if (sql[at] === "'") {
        const text = readString();
        let json = false;
        if (sql.startsWith("::", at)) {
          const cast = /^::([A-Z]+)/u.exec(sql.slice(at))[0];
          json = cast === "::JSONB";
          at += cast.length;
        }
        values.push(json ? JSON.parse(text) : text);
      } else {
        const word = /^[A-Za-z0-9.+-]+/u.exec(sql.slice(at))[0];
        at += word.length;
        values.push(/^-?\d+$/u.test(word) ? Number(word) : word);
      }
      if (sql[at] === ",") { at += 1; continue; }
      assert.equal(sql[at], ")");
      at += 1;
      break;
    }
    rowsOut.push(Object.fromEntries(columns.map((name, index) => [name, values[index]])));
    if (sql[at] === ",") { at += 1; continue; }
    assert.equal(sql[at], ";");
    return rowsOut;
  }
}

test("part 1 (286) is pinned by hash and size: published content is never edited", () => {
  assert.doesNotThrow(() => checkPart1Frozen());
  const bytes = readFileSync(migrationPath(PART1_SUFFIX));
  assert.equal(bytes.length, PART1_FROZEN.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), PART1_FROZEN.sha256);
});

test("release 1.1.0 carries every row of release 1.0.0 unchanged (keys, bodies, theory, figures)", () => {
  const sql = readFileSync(migrationPath(PART1_SUFFIX), "utf8");
  const v1Items = readSqlRows(sql, "platform_private.learning_items");
  const v1Figures = readSqlRows(sql, "platform_private.learning_figures");
  const v1Lessons = readSqlRows(sql, "platform_private.learning_lessons");
  const v1Topics = readSqlRows(sql, "platform_private.learning_topics");
  const v1Exercises = readSqlRows(sql, "platform_private.learning_exercises");
  const v1Module = readSqlRows(sql, "platform_private.learning_modules")[0];
  assert.deepEqual([v1Items.length, v1Figures.length, v1Lessons.length, v1Topics.length, v1Exercises.length], [30, 9, 6, 28, 21]);
  assert.equal(v1Module.version, "1.0.0");
  assert.deepEqual(rows.moduleRow.metadata, v1Module.metadata, "module metadata (title, level note, 4 sections, 12 points)");

  const items = new Map(rows.itemRows.map((row) => [row.item_key, row]));
  for (const old of v1Items) {
    const now = items.get(old.item_key);
    assert.ok(now, `${old.item_key} is kept`);
    assert.deepEqual([now.topic_key, now.syllabus_point, now.difficulty, now.pool],
      [old.topic_key, old.syllabus_point, old.difficulty, old.pool], old.item_key);
    assert.deepEqual(now.body, old.body, `${old.item_key} body`);
  }
  const figures = new Map(rows.figureRows.map((row) => [row.figure_key, row]));
  for (const old of v1Figures) {
    const now = figures.get(old.figure_key);
    assert.ok(now, `${old.figure_key} is kept`);
    for (const field of ["svg", "view_box", "alt_ru", "alt_ky", "alt_en", "sha256"]) assert.equal(now[field], old[field], `${old.figure_key} ${field}`);
  }
  const lessons = new Map(rows.lessonRows.map((row) => [row.lesson_key, row]));
  for (const old of v1Lessons) {
    const now = lessons.get(old.lesson_key);
    assert.ok(now, `${old.lesson_key} is kept`);
    assert.deepEqual(now.metadata, old.metadata, `${old.lesson_key} metadata`);
    assert.deepEqual(now.theory, old.theory, `${old.lesson_key} theory`);
  }
  const lessonKey = new Map(v1Lessons.map((row) => [row.id, row.lesson_key]));
  const v1Order = new Map();
  for (const exercise of v1Exercises) {
    const list = v1Order.get(lessonKey.get(exercise.lesson_id)) ?? [];
    list.push(exercise.exercise_key);
    v1Order.set(lessonKey.get(exercise.lesson_id), list);
  }
  const idToKey = new Map(rows.lessonRows.map((row) => [row.id, row.lesson_key]));
  const nowOrder = new Map();
  for (const exercise of rows.exerciseRows) {
    const list = nowOrder.get(idToKey.get(exercise.lesson_id)) ?? [];
    list.push(exercise.exercise_key);
    nowOrder.set(idToKey.get(exercise.lesson_id), list);
  }
  for (const [key, list] of v1Order) assert.deepEqual(nowOrder.get(key), list, `${key} exercises and their order`);
  const topics = new Map(rows.topicRows.map((row) => [row.topic_key, row]));
  for (const old of v1Topics) {
    const now = topics.get(old.topic_key);
    assert.equal(now.order_index, old.order_index, old.topic_key);
    const { prerequisites: oldPrerequisites, ...oldRest } = old.metadata;
    const { prerequisites: nowPrerequisites, ...nowRest } = now.metadata;
    assert.deepEqual(nowRest, oldRest, `${old.topic_key} metadata`);
    for (const prerequisite of oldPrerequisites) assert.ok(nowPrerequisites.includes(prerequisite), `${old.topic_key} keeps ${prerequisite}`);
  }
  // The old content ids are not reused: a new release has its own rows.
  const oldIds = new Set([...v1Items, ...v1Figures, ...v1Lessons, ...v1Topics, v1Module].map((row) => row.id));
  for (const row of [...rows.itemRows, ...rows.figureRows, ...rows.lessonRows, ...rows.topicRows, rows.moduleRow]) {
    assert.ok(!oldIds.has(row.id), `${row.id} is new`);
  }
});

test("the pilot forms of release 1.0.0 are replaced by the full ones with new keys", () => {
  const sql = readFileSync(migrationPath(PART1_SUFFIX), "utf8");
  const v1Forms = readSqlRows(sql, "platform_private.learning_test_forms");
  assert.deepEqual(v1Forms.map((row) => row.form_key).sort(), ["csca-math-diagnostic-1", "csca-math-mock-1"]);
  assert.deepEqual(rows.formRows.map((row) => row.form_key).sort(), ["csca-math-diagnostic-2", "csca-math-mock-2"]);
  // Every item of the pilot forms is reused by the full form of its kind.
  for (const old of v1Forms) {
    const now = rows.formRows.find((row) => row.kind === old.kind);
    for (const key of old.item_keys) assert.ok(now.item_keys.includes(key), `${key} in ${now.form_key}`);
  }
});
