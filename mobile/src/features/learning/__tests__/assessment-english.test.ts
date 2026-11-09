import { normalizeAssessmentAttempt } from "@/features/learning/tests/assessment-decode";
import { AssessmentSession, ASSESSMENT_RETRY_MS, ASSESSMENT_SAVE_MS, type AssessmentEnv } from "@/features/learning/tests/assessment-session";
import { emptyExerciseValue, exerciseValueComplete, exerciseValueToAnswer } from "@/features/learning/english/exercise-value";
import type { RpcTransport } from "@/lib/rpc";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: ATTEMPT_ID,
    instrumentKey: "english36",
    versionId: VERSION_ID,
    version: "1.0.0",
    locale: "ru",
    status: "draft",
    revision: 1,
    metadata: { title: "Английский", description: "d", instructions: ["i"], limitations: ["l"] },
    questions: [
      { id: "q1", prompt: "Pick", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "idk", label: "Не знаю" }] },
      { id: "q2", prompt: "Pick 2", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    ],
    answers: {},
    result: null,
    createdAt: "2026-11-09T10:00:00+00:00",
    updatedAt: "2026-11-09T10:00:00+00:00",
    completedAt: null,
    ...overrides,
  };
}

function harness(replies: Record<string, unknown[]>) {
  let now = 0;
  let next = 1;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const transport: RpcTransport = async (name, args) => {
    calls.push({ name, args: { ...(args ?? {}) } });
    const q = replies[name];
    const reply = q && q.length > 1 ? q.shift() : q?.[0];
    if (reply === "NETWORK") return { data: null, error: { code: null, message: "net" }, status: null };
    if (reply === "CONFLICT") return { data: null, error: { code: "40001", message: "Learning attempt changed" }, status: 409 };
    return { data: reply, error: null, status: 200 };
  };
  const env: AssessmentEnv = {
    transport,
    setTimer: (fn, ms) => {
      const h = next++;
      timers.set(h, { at: now + ms, fn });
      return h;
    },
    clearTimer: (h) => void timers.delete(h as number),
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  };
  async function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = Math.max(now, due[1].at);
      timers.delete(due[0]);
      due[1].fn();
      for (let i = 0; i < 30; i += 1) await Promise.resolve();
    }
    now = target;
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  }
  return { env, calls, advance };
}

describe("тесты: декодер", () => {
  it("принимает черновик; ключи проверки в вопрос не попадают", () => {
    const raw = attempt();
    (raw.questions[0] as Record<string, unknown>).correctOptionId = "a";
    const parsed = normalizeAssessmentAttempt(raw);
    expect(Object.keys(parsed.questions[0])).not.toContain("correctOptionId");
  });
  it("ответ не из вариантов вопроса отклоняется", () => {
    expect(() => normalizeAssessmentAttempt(attempt({ answers: { q1: "zzz" } }))).toThrow();
  });
});

describe("тесты: сессия прохождения", () => {
  it("автосохранение через 0,9 с, одна отправка на несколько выборов, ревизия из ответа", async () => {
    const h = harness({ start_student_assessment_v1: [attempt()], save_student_assessment_answers_v1: [attempt({ revision: 2 })] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("q1", "a");
    await h.advance(ASSESSMENT_SAVE_MS - 100);
    session.select("q2", "b");
    await h.advance(ASSESSMENT_SAVE_MS - 1);
    expect(h.calls.filter((c) => c.name === "save_student_assessment_answers_v1")).toHaveLength(0);
    await h.advance(10);
    const saves = h.calls.filter((c) => c.name === "save_student_assessment_answers_v1");
    expect(saves).toHaveLength(1);
    expect(saves[0].args.p_answers).toEqual({ q1: "a", q2: "b" });
    expect(saves[0].args.p_expected_revision).toBe(1);
    expect(session.getState().saveStatus).toBe("saved");
    expect(session.debug().revision).toBe(2);
    session.dispose();
  });

  it("обрыв: повтор тем же замороженным запросом, затем новые ответы отдельно", async () => {
    const h = harness({ start_student_assessment_v1: [attempt()], save_student_assessment_answers_v1: ["NETWORK", "NETWORK", "NETWORK", attempt({ revision: 2 }), attempt({ revision: 3 })] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("q1", "a");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    expect(session.getState().saveStatus).toBe("unconfirmed");
    session.select("q2", "b");
    await h.advance(ASSESSMENT_RETRY_MS + 10);
    const saves = h.calls.filter((c) => c.name === "save_student_assessment_answers_v1");
    expect(saves.slice(0, 4).every((c) => c.args.p_request_id === saves[0].args.p_request_id)).toBe(true);
    expect(saves[3].args.p_answers).toEqual({ q1: "a" });
    expect(saves[saves.length - 1].args.p_answers).toEqual({ q1: "a", q2: "b" });
    expect(saves[saves.length - 1].args.p_request_id).not.toBe(saves[0].args.p_request_id);
    session.dispose();
  });

  it("старт замораживает запрос: повтор после обрыва с тем же p_request_id", async () => {
    const h = harness({ start_student_assessment_v1: ["NETWORK", "NETWORK", "NETWORK", attempt()] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    expect(session.getState().phase).toBe("intro");
    await session.start();
    const starts = h.calls.filter((c) => c.name === "start_student_assessment_v1");
    expect(new Set(starts.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(session.getState().phase).toBe("running");
    session.dispose();
  });

  it("завершить можно только с ответами на все вопросы; сначала досылается несохранённое", async () => {
    const done = attempt({ status: "completed", revision: 4, completedAt: "2026-11-09T10:05:00+00:00", answers: { q1: "a", q2: "b" }, result: { instrumentKey: "english36", version: "1.0.0", metadata: { title: "t", description: "d", instructions: ["i"], limitations: ["l"] }, answeredCount: 2, questionCount: 2, completedAt: "2026-11-09T10:05:00+00:00", english: { correctCount: 1, totalCount: 2, topics: [{ topic: "grammar", correctCount: 1, totalCount: 2 }], feedback: [{ questionId: "q1", selectedOptionId: "a", correctOptionId: "a", correct: true, explanation: "e", topic: "grammar" }, { questionId: "q2", selectedOptionId: "b", correctOptionId: "a", correct: false, explanation: "e", topic: "grammar" }] } } });
    const h = harness({ start_student_assessment_v1: [attempt()], save_student_assessment_answers_v1: [attempt({ revision: 2 })], complete_student_assessment_v1: [done] });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("q1", "a");
    await session.complete();
    expect(session.getState().error).toBe("invalid"); // не все вопросы
    expect(h.calls.some((c) => c.name === "complete_student_assessment_v1")).toBe(false);
    session.select("q2", "b");
    await session.complete();
    const order = h.calls.map((c) => c.name);
    expect(order.indexOf("save_student_assessment_answers_v1")).toBeLessThan(order.indexOf("complete_student_assessment_v1"));
    expect(session.getState().phase).toBe("result");
    expect(session.getState().attempt?.result?.english?.correctCount).toBe(1);
    session.dispose();
  });

  it("конфликт ревизии: показываются сохранённые ответы сервера", async () => {
    const h = harness({
      start_student_assessment_v1: [attempt()],
      save_student_assessment_answers_v1: ["CONFLICT"],
      student_assessment_attempt_v1: [attempt({ revision: 5, answers: { q1: "b" } })],
    });
    const session = new AssessmentSession(h.env, "english36", null);
    await session.start();
    session.select("q2", "a");
    await h.advance(ASSESSMENT_SAVE_MS + 10);
    expect(session.getState().answers).toEqual({ q1: "b" });
    expect(session.debug().revision).toBe(5);
    session.dispose();
  });
});

describe("английский: ввод упражнений", () => {
  const matching = { exerciseId: "e", exerciseKey: "k", orderIndex: 1, type: "matching" as const, lefts: ["a", "b", "c"], rights: [{ rightRu: "1", rightKy: "1" }, { rightRu: "2", rightKy: "2" }, { rightRu: "3", rightKy: "3" }] };
  it("сопоставление: полный и без повторов", () => {
    const empty = emptyExerciseValue(matching);
    expect(exerciseValueComplete(matching, empty)).toBe(false);
    expect(exerciseValueComplete(matching, { kind: "matching", matches: [0, 1, 1] })).toBe(false);
    const full = { kind: "matching" as const, matches: [2, 0, 1] };
    expect(exerciseValueComplete(matching, full)).toBe(true);
    expect(exerciseValueToAnswer(full)).toEqual({ matches: [2, 0, 1] });
  });
  it("короткий ответ обрезается и не пустой", () => {
    expect(exerciseValueToAnswer({ kind: "short_answer", text: "  hello " })).toEqual({ text: "hello" });
    expect(exerciseValueToAnswer({ kind: "short_answer", text: "   " })).toBeNull();
  });
});
