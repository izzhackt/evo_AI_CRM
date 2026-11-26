// Страницы теста: сколько вопросов на экране и на какой странице что лежит. Правило взято у веба без изменений:
// `AssessmentRunner.tsx` (`pageSize = instrument.instrumentKey === "english36" ? 1 : 4`). english36 идёт по одному заданию
// (в нём есть текст для чтения), orvis92 - по четыре утверждения: 92 вопроса дают 23 страницы, а не 92 экрана.
// Страница с номером `pageCount` - шаг «Готовы завершить?» после последней.
import type { AssessmentAnswers, AssessmentQuestion, StudentAssessmentKey } from "@web/lib/student-assessment-contract";

export function assessmentPageSize(key: StudentAssessmentKey): number {
  return key === "english36" ? 1 : 4;
}

export function assessmentPageCount(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize);
}

/** Вопросы страницы; за последней страницей (шаг завершения) вопросов нет. */
export function pageQuestions(questions: readonly AssessmentQuestion[], page: number, pageSize: number): AssessmentQuestion[] {
  return questions.slice(page * pageSize, (page + 1) * pageSize);
}

/** Страница первого вопроса без ответа; если ответили на все (или не отвечали), первая страница, как в вебе. */
export function firstOpenPage(questions: readonly AssessmentQuestion[], answers: Readonly<AssessmentAnswers>, pageSize: number): number {
  const first = questions.findIndex((question) => answers[question.id] === undefined);
  return Math.floor(Math.max(0, first) / pageSize);
}
