// Порт CSCADecodingTests (iPhone 1.1): настоящие ответы сервера (фикстуры iOS) разбираются строгими
// парсерами, общими с вебом; лишний ключ (утёкший ключ ответа) и неизвестная форма отклоняются.
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseCscaAnswerReceipt,
  parseCscaHome,
  parseCscaLessonAttempt,
  parseCscaLessonView,
  parseCscaModuleLessons,
  parseCscaProgress,
  parseCscaReview,
  parseCscaReviewReceipt,
  parseCscaTargetReceipt,
  parseCscaTestAttempt,
  parseCscaTestSaveReceipt,
} from "@web/lib/portal/csca";

import { cscaFailure } from "@/features/learning/csca/api";
import { classifyRpcFailure, RpcError } from "@/lib/rpc";

const fx = (name: string): unknown => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));

describe("главная трека", () => {
  it("свежая, после теста и после пробного", () => {
    for (const name of ["csca_home_fresh", "csca_home_after", "csca_home_after_mock"]) {
      const home = parseCscaHome(fx(name));
      expect(home.track).toBe("csca-math");
      expect(home.topics.length).toBeGreaterThan(0);
      expect(home.sessions.every((s) => s.sourceUrl.startsWith("https://"))).toBe(true);
    }
  });
  it("следующий шаг у свежей главной: диагностика", () => {
    expect(parseCscaHome(fx("csca_home_fresh")).nextStep?.kind).toBe("test");
  });
  it("неизвестный вид nextStep отклоняется, а не угадывается", () => {
    const raw = JSON.parse(JSON.stringify(fx("csca_home_fresh")));
    raw.nextStep = { kind: "teleport" };
    expect(() => parseCscaHome(raw)).toThrow();
  });
  it("карта модулей CSCA и английского", () => {
    expect(parseCscaModuleLessons(fx("csca_modules_v2_csca")).length).toBeGreaterThan(0);
  });
});

describe("урок и практика", () => {
  it.each(["csca_lesson_m2-derivative-l1", "csca_lesson_m2-derivative-p1", "csca_lesson_m2-exp-log-l1", "csca_lesson_m2-exp-log-p1", "csca_lesson_m3-line-circle-l1", "csca_lesson_m3-line-circle-p1"])("%s", (name) => {
    const view = parseCscaLessonView(fx(name));
    expect(view.lesson.exercises.length).toBeGreaterThan(0);
    for (const ex of view.lesson.exercises) {
      expect(ex.options).toHaveLength(4);
      expect(JSON.stringify(ex)).not.toContain("correctOptionId"); // ключ ответа до ответа не приходит
    }
  });
  it("утёкший ключ ответа не доходит до состояния: проекция задания собирается по белому списку", () => {
    const raw = JSON.parse(JSON.stringify(fx("csca_lesson_m2-exp-log-p1")));
    raw.lesson.exercises[0].correctOptionId = "a";
    raw.lesson.exercises[0].solutionRu = ["утечка"];
    const exercise = parseCscaLessonView(raw).lesson.exercises[0];
    expect(Object.keys(exercise)).not.toContain("correctOptionId");
    expect(JSON.stringify(exercise)).not.toContain("утечка");
  });
  it("квитанции ответа и попытки", () => {
    for (const name of ["csca_lesson_save_1", "csca_lesson_save_2", "csca_lesson_save_3", "csca_lesson_save_4"]) {
      const receipt = parseCscaAnswerReceipt(fx(name));
      expect(receipt.explain.options).toHaveLength(4);
    }
    expect(parseCscaLessonAttempt(fx("csca_lesson_start")).status).toBe("draft");
    expect(parseCscaLessonAttempt(fx("csca_lesson_complete")).status).toBe("completed");
  });
});

describe("тест на время", () => {
  it("старт диагностики и пробного", () => {
    const diag = parseCscaTestAttempt(fx("csca_test_start_diagnostic"));
    expect(diag.status).toBe("draft");
    expect(diag.allowEarlyFinish).toBe(true);
    expect(diag.result).toBeNull();
    expect(diag.review).toBeNull();
    const mock = parseCscaTestAttempt(fx("csca_test_start_mock"));
    expect(mock.allowEarlyFinish).toBe(false);
  });
  it("итог и разбор приходят только после завершения", () => {
    const done = parseCscaTestAttempt(fx("csca_test_complete_diagnostic"));
    expect(done.status).toBe("completed");
    expect(done.result?.itemsTotal).toBe(3);
    expect(done.review).toHaveLength(3);
    const timeout = parseCscaTestAttempt(fx("csca_test_mock_timeout"));
    expect(timeout.completion).toBe("timeout");
    expect(timeout.kind).toBe("mock");
  });
  it("квитанции сохранения не говорят о правильности", () => {
    for (const name of ["csca_test_save", "csca_test_save_mock"]) {
      const receipt = parseCscaTestSaveReceipt(fx(name));
      expect(JSON.stringify(receipt)).not.toMatch(/correct/i);
    }
  });
});

describe("повторение, прогресс, отчёт, сессия", () => {
  it("повторение: срок наступил и не наступил", () => {
    expect(parseCscaReview(fx("csca_review_v2_due")).items.length).toBeGreaterThan(0);
    expect(parseCscaReview(fx("csca_review_v2_not_due")).items).toHaveLength(0);
    expect(parseCscaReviewReceipt(fx("csca_record_review_first")).box).toBe(1);
    expect(parseCscaReviewReceipt(fx("csca_record_review_correct")).correct).toBe(true);
  });
  it("прогресс", () => {
    for (const name of ["csca_progress", "csca_progress_after_mock"]) {
      const p = parseCscaProgress(fx(name));
      expect(p.coverage.topicsTotal).toBeGreaterThan(0);
    }
  });
  it("сессия выбрана, сообщение принято", () => {
    expect(parseCscaTargetReceipt(fx("csca_target_session")).targetSessionKey).not.toBeNull();
  });
});

describe("классификация ошибок без текста сервера (csca_error_*)", () => {
  const error = (name: string) => fx(name) as { code: string; message: string };
  // Транспорт кладёт в RpcError только имя из закрытого списка; текст сервера не хранится.
  function toRpc(name: string): RpcError {
    const raw = error(name);
    const base = classifyRpcFailure(raw.code, 400);
    return base.kind === "invalid" ? new RpcError(base.kind, base.code, 400, raw.message === "learning_test_early_finish_forbidden" ? "early_finish_forbidden" : raw.message === "learning_review_not_due" ? "review_not_due" : raw.message === "learning_test_completed" ? "test_completed" : null) : base;
  }
  it.each([
    ["csca_error_stale_revision.error", "conflict"],
    ["csca_error_mock_early_finish.error", "early_finish_forbidden"],
    ["csca_error_review_not_due.error", "review_not_due"],
    ["csca_error_test_completed.error", "test_completed"],
    ["csca_error_unknown_track.error", "invalid"],
  ])("%s → %s", (name, expected) => {
    expect(cscaFailure(toRpc(name))).toBe(expected);
  });
  it("обрыв и 5xx это «нет связи», повтор тем же запросом", () => {
    expect(cscaFailure(new RpcError("transport"))).toBe("unavailable");
    expect(cscaFailure(new RpcError("server", null, 503))).toBe("unavailable");
    expect(cscaFailure(new Error("boom"))).toBe("unavailable");
  });
  it("42501 это «нет доступа»", () => {
    expect(cscaFailure(new RpcError("forbidden", "42501", 403))).toBe("denied");
  });
});
