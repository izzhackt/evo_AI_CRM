// Куда ведёт итог урока: к практике, из практики к уроку (веб: `nextLinks` в math/lesson/[lessonId]/page.tsx).
import { siblingLessonLink } from "@/features/learning/csca/lesson-links";

const lesson = (lessonId: string, topicKey: string, kind: "lesson" | "practice", orderIndex: number) =>
  ({ lessonId, orderIndex, metadata: { topic_key: topicKey, kind } }) as Parameters<typeof siblingLessonLink>[0][number];

describe("siblingLessonLink", () => {
  const list = [
    lesson("l1", "exp", "lesson", 1),
    lesson("p2", "exp", "practice", 4),
    lesson("p1", "exp", "practice", 2),
    lesson("l-other", "line", "lesson", 5),
    lesson("p-other", "line", "practice", 6),
  ];

  it("из урока: первая по порядку программы практика той же темы, список не обязан быть упорядочен", () => {
    expect(siblingLessonLink(list, { lessonId: "l1", topicKey: "exp", kind: "lesson" })).toEqual({ lessonId: "p1", kind: "practice" });
  });

  it("из практики: урок той же темы", () => {
    expect(siblingLessonLink(list, { lessonId: "p1", topicKey: "exp", kind: "practice" })).toEqual({ lessonId: "l1", kind: "lesson" });
  });

  it("чужая тема и сам урок не считаются; соседа нет: null", () => {
    expect(siblingLessonLink([lesson("l1", "exp", "lesson", 1), lesson("p-other", "line", "practice", 6)], { lessonId: "l1", topicKey: "exp", kind: "lesson" })).toBeNull();
    expect(siblingLessonLink([lesson("l1", "exp", "lesson", 1)], { lessonId: "l1", topicKey: "exp", kind: "lesson" })).toBeNull();
    expect(siblingLessonLink([], { lessonId: "x", topicKey: "exp", kind: "practice" })).toBeNull();
  });
});
