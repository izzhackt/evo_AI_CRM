import { readFileSync } from "node:fs";
import path from "node:path";

import { parseCscaLessonView } from "@web/lib/portal/csca";

import { LessonSession } from "@/features/learning/csca/lesson-session";
import type { RpcTransport } from "@/lib/rpc";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const NETWORK = { code: null, message: "net", status: null };

function setup(script: Record<string, unknown[]>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let id = 0;
  const transport: RpcTransport = async (name, args) => {
    calls.push({ name, args: { ...(args ?? {}) } });
    const q = script[name];
    const reply = q && q.length > 1 ? q.shift() : q?.[0];
    if (reply && typeof reply === "object" && "message" in (reply as object) && !("attemptId" in (reply as object))) {
      const e = reply as { code: string | null; message: string; status: number | null };
      return { data: null, error: { code: e.code, message: e.message }, status: e.status };
    }
    return { data: reply, error: null, status: 200 };
  };
  const view = parseCscaLessonView(fx("csca_lesson_m2-exp-log-p1"));
  const session = new LessonSession(transport, view.lesson.lessonId, view.lesson.exercises, view.draft, view.latestCompleted, () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`);
  return { calls, session, view };
}

describe("урок и практика: замороженные записи (порт CSCALessonModel)", () => {
  it("обрыв при ответе: повтор уходит тем же p_request_id и теми же аргументами", async () => {
    const { calls, session } = setup({
      start_learning_lesson_v1: [fx("csca_lesson_start")],
      save_learning_answer_v1: [NETWORK, NETWORK, NETWORK, fx("csca_lesson_save_1")],
    });
    session.select("a");
    await session.submit();
    expect(session.getState().error).toBe("unavailable");
    expect(Object.keys(session.getState().answered)).toHaveLength(0);
    await session.submit(); // «Повторить»: выбор остался на экране
    const saveCalls = calls.filter((c) => c.name === "save_learning_answer_v1");
    expect(new Set(saveCalls.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(new Set(saveCalls.map((c) => JSON.stringify(c.args))).size).toBe(1);
    expect(calls.filter((c) => c.name === "start_learning_lesson_v1")).toHaveLength(1);
    expect(Object.keys(session.getState().answered)).toHaveLength(1);
    expect(session.getState().error).toBeNull();
  });

  it("ответ финален: вердикт и разбор берутся из квитанции, ключа нет до ответа", async () => {
    const { session, view } = setup({ start_learning_lesson_v1: [fx("csca_lesson_start")], save_learning_answer_v1: [fx("csca_lesson_save_1")] });
    expect(JSON.stringify(view.lesson.exercises)).not.toContain("explain");
    session.select("b");
    await session.submit();
    const answered = Object.values(session.getState().answered)[0];
    expect(answered.explain.options).toHaveLength(4);
    expect(typeof answered.correct).toBe("boolean");
  });

  it("после последнего ответа попытка завершается тем же запросом при повторе", async () => {
    const last = fx("csca_lesson_save_4");
    const { calls, session } = setup({
      start_learning_lesson_v1: [fx("csca_lesson_start")],
      save_learning_answer_v1: [{ ...last, answeredCount: last.exercisesTotal }],
      complete_learning_lesson_v1: [NETWORK, NETWORK, NETWORK, fx("csca_lesson_complete")],
    });
    session.select("a");
    await session.submit();
    // Завершение не дошло: ответ принят, попытка остаётся открытой для кнопки «Завершить».
    expect(session.getState().attemptId).not.toBeNull();
    await session.finishDraft();
    const completes = calls.filter((c) => c.name === "complete_learning_lesson_v1");
    expect(new Set(completes.map((c) => c.args.p_request_id)).size).toBe(1);
    expect(session.getState().attemptId).toBeNull();
  });

  it("новый выбор после сбоя не повторяет прежний запрос", async () => {
    const { calls, session } = setup({
      start_learning_lesson_v1: [fx("csca_lesson_start")],
      save_learning_answer_v1: [NETWORK, NETWORK, NETWORK, fx("csca_lesson_save_1")],
    });
    session.select("a");
    await session.submit();
    session.select("c");
    await session.submit();
    const saveCalls = calls.filter((c) => c.name === "save_learning_answer_v1");
    expect(new Set(saveCalls.map((c) => c.args.p_request_id)).size).toBe(2);
    expect((saveCalls[saveCalls.length - 1].args.p_answer as { selected: string }).selected).toBe("c");
  });
});
