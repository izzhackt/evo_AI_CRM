import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CSCA_FIGURE_DARK_PALETTE,
  CscaParseError,
  clockOffsetMs,
  cscaErrorCode,
  darkFigureSvg,
  daysBetween,
  formatClock,
  parseCscaAnswerReceipt,
  parseCscaHome,
  parseCscaLessonView,
  parseCscaProgress,
  parseCscaReview,
  parseCscaReviewReceipt,
  parseCscaTestAttempt,
  remainingSeconds,
  splitMathText,
  svgDataUrl,
  testSavePayload,
} from "../src/lib/portal/csca.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";

// Ответы RPC 285 с демо-стека evo-video-demo (синтетический студент, свой
// контент EVO из миграции 286), сохранённые как есть.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/portal-csca/${name}.json`, import.meta.url), "utf8"));
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("CSCA home, progress and review payloads parse into the contract shape", () => {
  const home = parseCscaHome(fixture("track-home"));
  assert.equal(home.track, "csca-math");
  assert.equal(home.topics.length, 28);
  assert.equal(home.modules[0].metadata.sections.length, 4);
  assert.ok(home.lessons.some((lesson) => lesson.metadata.kind === "practice"));
  assert.deepEqual(home.tests.map((entry) => entry.kind), ["diagnostic", "mock"]);
  assert.equal(home.tests[1].allowEarlyFinish, false);
  assert.ok(home.sessions.every((session) => session.sourceUrl.startsWith("https://csca.cn/")));
  assert.ok(home.nextStep === null || ["test", "lesson", "review"].includes(home.nextStep.kind));

  const progress = parseCscaProgress(fixture("track-progress"));
  assert.equal(progress.coverage.topicsTotal, 28);
  assert.equal(progress.pace.budgetSeconds, 75);

  const review = parseCscaReview(fixture("review-v2"));
  for (const entry of review.items) {
    assert.equal(entry.item.options.length, 4);
    assert.equal("explain" in entry.item, false);
  }
  const receipt = parseCscaReviewReceipt(fixture("review-record"));
  assert.equal(receipt.retired, receipt.dueOn === null);
  assert.equal(receipt.explain.options.length, 4);
});

test("lesson v2 keeps typed theory blocks, figures and keyless item projections", () => {
  const view = parseCscaLessonView(fixture("lesson-v2"));
  assert.equal(view.module.track, "csca-math");
  assert.deepEqual(
    [...new Set(view.lesson.theory.map((block) => block.kind))].sort(),
    ["example", "figure", "formula", "idea", "pitfalls", "table", "terms", "tip"],
  );
  for (const item of view.lesson.exercises) {
    assert.deepEqual(Object.keys(item).sort(), [
      "difficulty", "estSeconds", "exerciseId", "figureKey", "itemKey", "options", "orderIndex",
      "stemEn", "syllabusPoint", "topicKey",
    ]);
  }
  for (const block of view.lesson.theory) {
    if (block.kind === "figure") assert.ok(view.figures[block.figure_key], block.figure_key);
  }
  const figure = Object.values(view.figures)[0];
  assert.ok(figure.width >= 360 && figure.width <= 450);
});

test("parsers drop leaked answer keys and refuse foreign shapes", () => {
  const lesson = fixture("lesson-v2");
  lesson.lesson.exercises[0].answerIndex = 1;
  lesson.lesson.exercises[0].options[0].explainRu = "leak";
  const view = parseCscaLessonView(lesson);
  assert.equal("answerIndex" in view.lesson.exercises[0], false);
  assert.equal("explainRu" in view.lesson.exercises[0].options[0], false);

  const unknownBlock = fixture("lesson-v2");
  unknownBlock.lesson.theory.push({ kind: "hologram", ru: "x", ky: "x" });
  assert.equal(parseCscaLessonView(unknownBlock).lesson.theory.length, lesson.lesson.theory.length);

  const scripted = fixture("lesson-v2");
  const key = Object.keys(scripted.figures)[0];
  scripted.figures[key].svg = scripted.figures[key].svg.replace("<title>", "<script>alert(1)</script><title>");
  assert.throws(() => parseCscaLessonView(scripted), CscaParseError);

  const attempt = fixture("test-attempt-completed");
  attempt.answers["csca-math-not-in-form"] = "a";
  assert.throws(() => parseCscaTestAttempt(attempt), CscaParseError);

  const draftWithResult = fixture("test-attempt-completed");
  draftWithResult.status = "draft";
  assert.throws(() => parseCscaTestAttempt(draftWithResult), CscaParseError);

  const answer = {
    attemptId: "3220b018-35f1-4940-8c37-b4a7042665b9", revision: 2,
    exerciseId: "7b0e4dda-5cdb-5a7f-870c-74e3f9655d33", correct: false, verdict: { correct: false },
    explain: { ...fixture("review-record").explain, solutionKy: ["only one step"] },
    answeredCount: 1, exercisesTotal: 4,
  };
  assert.throws(() => parseCscaAnswerReceipt(answer), CscaParseError);
});

test("a completed test carries its result and the review of every item", () => {
  const attempt = parseCscaTestAttempt(fixture("test-attempt-completed"));
  assert.equal(attempt.status, "completed");
  assert.ok(attempt.result);
  assert.equal(attempt.review.length, attempt.items.length);
  assert.equal(attempt.result.answeredCount + attempt.result.unansweredCount, attempt.result.itemsTotal);
});

test("math text splits on $ and keeps an unclosed tail as text", () => {
  assert.deepEqual(splitMathText("Find $\\log_2 8$ now."), [
    { math: false, value: "Find " },
    { math: true, value: "\\log_2 8" },
    { math: false, value: " now." },
  ]);
  assert.deepEqual(splitMathText("$x$"), [{ math: true, value: "x" }]);
  assert.deepEqual(splitMathText("a $b"), [{ math: false, value: "a " }, { math: false, value: "$b" }]);
});

test("dark figures swap the six palette colours one to one", () => {
  const svg = '<svg viewBox="0 0 400 300"><rect fill="#FFFFFF"/><path stroke="#191714"/><path stroke="#d70217"/><path fill="#177245"/><line stroke="#e4dfd7"/><text fill="#6b6660"/><path fill="#123456"/></svg>';
  const dark = darkFigureSvg(svg);
  for (const [light, night] of Object.entries(CSCA_FIGURE_DARK_PALETTE)) {
    assert.equal(dark.toLowerCase().includes(`"${light}"`), false, light);
    assert.equal(dark.includes(`"${night}"`), true, night);
  }
  // Один проход: #ffffff не превращается сначала в #1e1c19, а затем дальше.
  assert.equal(darkFigureSvg('fill="#ffffff"'), 'fill="#1e1c19"');
  assert.equal(dark.includes('"#123456"'), true);
  assert.ok(svgDataUrl(svg).startsWith("data:image/svg+xml;charset=utf-8,%3Csvg"));
});

test("the test clock follows the server time with the client offset", () => {
  const received = Date.parse("2026-10-16T10:00:00.000Z");
  const offset = clockOffsetMs("2026-10-16T10:00:02.000Z", received);
  assert.equal(offset, 2000);
  assert.equal(remainingSeconds("2026-10-16T10:04:02.000Z", offset, received), 240);
  assert.equal(remainingSeconds("2026-10-16T10:04:02.000Z", offset, received + 241_000), 0);
  assert.equal(formatClock(241), "04:01");
  assert.equal(formatClock(3725), "1:02:05");
  assert.equal(daysBetween("2026-10-16", "2026-11-14"), 29);
});

test("test saves send only form items, unique flags and clamped seconds", () => {
  const payload = testSavePayload(
    [{ itemKey: "csca-math-a" }, { itemKey: "csca-math-b" }],
    { "csca-math-a": "c", "csca-math-x": "a", "csca-math-b": "z" },
    ["csca-math-b", "csca-math-b", "csca-math-x"],
    { "csca-math-a": 12.6, "csca-math-b": 99999, "csca-math-x": 3 },
  );
  assert.deepEqual(payload, {
    answers: { "csca-math-a": "c" },
    flags: ["csca-math-b"],
    itemSeconds: { "csca-math-a": 13, "csca-math-b": 3600 },
  });
});

test("named 22023 refusals map to their own screen codes", () => {
  assert.equal(cscaErrorCode({ code: "22023", message: "learning_test_deadline_passed" }), "deadline_passed");
  assert.equal(cscaErrorCode({ code: "22023", message: "learning_test_early_finish_forbidden" }), "early_finish_forbidden");
  assert.equal(cscaErrorCode({ code: "22023", message: "learning_report_limit" }), "report_limit");
  assert.equal(cscaErrorCode({ code: "22023", message: "Invalid learning request" }), "invalid");
  assert.equal(cscaErrorCode({ code: "40001" }), "conflict");
  assert.equal(cscaErrorCode({ code: "42501" }), "denied");
  assert.equal(cscaErrorCode({ code: "PGRST202" }), "unavailable");
});

test("CSCA wording: RU and KY, no long dashes, «оценка EVO» only, no score promises", () => {
  const { ru, ky } = PORTAL_DICTIONARIES.csca;
  for (const [locale, dictionary] of [["ru", ru], ["ky", ky]]) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.doesNotMatch(value, /[\u2013\u2014]/u, `${locale}.${key} has a long dash`);
      assert.doesNotMatch(value, /перцентил|проходн|80\+|гарант|official|официальн/iu, `${locale}.${key}`);
      assert.doesNotMatch(value, /Подготовк/u, `${locale}.${key}: «Подготовка» means document preparation`);
    }
  }
  // «балл CSCA» встречается только в обязательной подписи-отрицании.
  const mentions = Object.entries(ru).filter(([, value]) => /балл CSCA/u.test(value));
  assert.ok(mentions.length > 0);
  for (const [key, value] of mentions) assert.match(value, /оценка EVO .*а не балл CSCA/u, key);
  assert.equal(ru.resultCaption, "Это оценка EVO по нашим заданиям, а не балл CSCA.");
  assert.equal(ky.resultCaption, "Бул биздин тапшырмалар боюнча EVO берген баа, CSCA баллы эмес.");
});

test("CSCA sits next to «Английский» and its routes are connected exactly", async () => {
  const shell = source("src/components/portal/Shell.tsx");
  const hrefs = [...shell.matchAll(/href: "([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(hrefs.indexOf("/portal/csca"), hrefs.indexOf("/portal/english") + 1);

  const { isConnectedStudentPortalPage } = await import("../src/lib/platform-route-contract.ts");
  const id = "6a568c67-44e7-56dd-8ba5-c1b77305daba";
  for (const path of ["/portal/csca", "/portal/csca/math/review", "/portal/csca/math/progress",
    `/portal/csca/math/lesson/${id}`, `/portal/csca/math/test/${id}`]) {
    assert.equal(isConnectedStudentPortalPage(path), true, path);
  }
  for (const path of ["/portal/csca/", "/portal/csca/math", "/portal/csca/physics/lesson/" + id,
    "/portal/csca/math/lesson/not-an-id", `/portal/csca/math/test/${id}/child`]) {
    assert.equal(isConnectedStudentPortalPage(path), false, path);
  }
});

test("KaTeX stays on CSCA routes only and runners never refresh the route after a write", () => {
  const layout = source("src/app/(portal)/portal/csca/layout.tsx");
  assert.match(layout, /import "katex\/dist\/katex\.min\.css";/u);
  assert.doesNotMatch(source("src/app/(portal)/layout.tsx"), /katex/u);
  const mathText = source("src/components/portal/csca/MathText.tsx");
  assert.match(mathText, /output: "htmlAndMathml"/u);
  assert.match(mathText, /trust: false/u);
  const actions = source("src/lib/portal/csca-actions.ts");
  assert.doesNotMatch(actions, /revalidatePath\(/u);
  assert.match(source("package.json"), /"katex": "0\.19\.0"/u);
});
