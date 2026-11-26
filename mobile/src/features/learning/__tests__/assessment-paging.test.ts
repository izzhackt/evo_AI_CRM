// Страницы теста (G57): правило веба без изменений. Файл веба прочитан напрямую: если там поменяют размер страницы,
// заголовок или нумерацию, этот тест напомнит перенести то же в приложение (подход файлов сверки `*-parity`).
import { readFileSync } from "node:fs";
import path from "node:path";

import { assessmentPageCount, assessmentPageSize, firstOpenPage, pageQuestions } from "@/features/learning/tests/paging";
import { answersFor, questionsFor } from "@/test-fixtures/assessment";

const web = (file: string) => readFileSync(path.join(__dirname, "../../../../..", "src/components/portal/tests", file), "utf8");

describe("страницы теста", () => {
  it("english36 по одному заданию, orvis92 по четыре утверждения: 92 вопроса - 23 страницы", () => {
    expect(assessmentPageSize("english36")).toBe(1);
    expect(assessmentPageSize("orvis92")).toBe(4);
    expect(assessmentPageCount(92, 4)).toBe(23);
    expect(assessmentPageCount(36, 1)).toBe(36);
    expect(assessmentPageCount(90, 4)).toBe(23); // неполная последняя страница считается
  });

  it("вопросы страницы: последняя целая, за ней (шаг завершения) пусто", () => {
    const questions = questionsFor("orvis92");
    expect(pageQuestions(questions, 0, 4).map((q) => q.id)).toEqual(["o1", "o2", "o3", "o4"]);
    expect(pageQuestions(questions, 22, 4).map((q) => q.id)).toEqual(["o89", "o90", "o91", "o92"]);
    expect(pageQuestions(questions, 23, 4)).toEqual([]);
    expect(pageQuestions(questionsFor("orvis92", 90), 22, 4).map((q) => q.id)).toEqual(["o89", "o90"]);
  });

  it("страница первого пропущенного вопроса; ответили на всё или ни на что - первая страница", () => {
    const questions = questionsFor("orvis92");
    expect(firstOpenPage(questions, {}, 4)).toBe(0);
    expect(firstOpenPage(questions, answersFor("orvis92", 3), 4)).toBe(0);
    expect(firstOpenPage(questions, answersFor("orvis92", 4), 4)).toBe(1);
    expect(firstOpenPage(questions, answersFor("orvis92", 91), 4)).toBe(22);
    expect(firstOpenPage(questions, answersFor("orvis92", 92), 4)).toBe(0);
    // Пропуск в середине: первый пропущенный, а не последний отвеченный.
    expect(firstOpenPage(questions, { ...answersFor("orvis92", 20), o6: undefined as unknown as string }, 4)).toBe(1);
  });
});

describe("правило страниц совпадает с вебом (файлы веба прочитаны напрямую)", () => {
  it("размер страницы, заголовок «Часть N из M» только у orvis92, «Задание N из M» у english36, нумерация утверждений", () => {
    const runner = web("AssessmentRunner.tsx");
    expect(runner).toContain('const pageSize = instrument.instrumentKey === "english36" ? 1 : 4;');
    expect(runner).toMatch(/instrument\.instrumentKey === "english36"\s*\?\s*formatPortalString\(strings\.taskOf, \{ n: String\(page \+ 1\), total: String\(total\) \}\)\s*:\s*formatPortalString\(strings\.partOf, \{ n: String\(page \+ 1\), parts: String\(pageCount\) \}\)/);
    expect(runner).toContain("const pageCount = Math.ceil(total / pageSize);");
    expect(runner).toContain("const firstUnanswered = initialAttempt?.questions.findIndex(q => !initialAttempt.answers[q.id]) ?? 0;");
    expect(runner).toContain("useState(Math.floor(Math.max(0, firstUnanswered) / pageSize))");
    expect(web("AssessmentQuestion.tsx")).toContain('{instrumentKey === "orvis92" ? `${number}. ` : ""}');
  });

  it("веб показывает одну цельную полосу прогресса «Прогресс: N из M» для обоих тестов", () => {
    const runner = web("AssessmentRunner.tsx");
    expect(runner).toContain("<progress");
    expect(runner).toContain("aria-label={formatPortalString(strings.progressAria");
  });
});
