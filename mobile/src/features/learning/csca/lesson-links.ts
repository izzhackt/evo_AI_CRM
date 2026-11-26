// Куда ведёт итог урока и практики (веб: `math/lesson/[lessonId]/page.tsx`, `nextLinks`): из урока к практике той же темы, из
// практики к уроку, затем «К темам». Соседний урок берётся из списка уроков главной (те же `learning_modules_v2`): первый по
// порядку программы из другого вида в этой же теме, сам урок не считается.
import type { CscaLessonSummary } from "@web/lib/portal/csca";

export type SiblingLink = { lessonId: string; kind: "lesson" | "practice" };

export function siblingLessonLink(
  lessons: readonly Pick<CscaLessonSummary, "lessonId" | "orderIndex" | "metadata">[],
  current: { lessonId: string; topicKey: string; kind: "lesson" | "practice" },
): SiblingLink | null {
  const wanted = current.kind === "practice" ? "lesson" : "practice";
  const next = lessons
    .filter((entry) => entry.metadata.topic_key === current.topicKey && entry.lessonId !== current.lessonId && entry.metadata.kind === wanted)
    .sort((a, b) => a.orderIndex - b.orderIndex)[0];
  return next ? { lessonId: next.lessonId, kind: next.metadata.kind } : null;
}
