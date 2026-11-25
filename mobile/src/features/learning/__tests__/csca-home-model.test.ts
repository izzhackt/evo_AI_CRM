// Главная CSCA «Занятия»: «Следующий шаг», плитки, строки тестов и программа по модулям считаются так же, как на вебе
// (components/portal/csca/LessonsView.tsx). Данные настоящих ответов learning_track_home_v1 (синтетический студент).
import { readFileSync } from "node:fs";
import path from "node:path";

import { sessionLabels } from "@web/components/portal/csca/session-labels";
import { parseCscaHome, type CscaHome } from "@web/lib/portal/csca";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { dayUnit, lessonActionLabel, nearestSession, nextStepModel, programSections, statTiles, testRowModel } from "@/features/learning/csca/home-model";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const home = (name: string, change: (raw: Record<string, any>) => void = () => undefined): CscaHome => {
  const raw = fx(name);
  change(raw);
  return parseCscaHome(raw);
};
const ru = getPortalStrings("csca", "ru");
const ky = getPortalStrings("csca", "ky");
const labelsOf = (h: CscaHome, lang: "ru" | "ky" = "ru") => sessionLabels(h.sessions, lang, lang === "ky" ? ky : ru, { serverNow: h.serverNow, today: h.today });

describe("«Следующий шаг»", () => {
  it("тест: название формы, значки «Заданий» и время, кнопка «Начать тест»", () => {
    const model = nextStepModel(home("csca_home_fresh"), "ru", ru);
    expect(model.title).toBe("Диагностика");
    expect(model.why).toBe(ru["nextStep.testWhy"]);
    expect(model.meta).toEqual(["Заданий: 3", "4 мин"]);
    expect(model.action?.label).toBe("Начать тест");
    expect(model.action?.target.kind).toBe("test");
  });

  it("тест с черновиком: «Продолжить тест»", () => {
    const h = home("csca_home_fresh", (raw) => {
      const form = raw.tests[0];
      form.draft = { attemptId: "71b33fd0-e89b-4102-8374-182354aa8882", revision: 2, startedAt: raw.serverNow, deadlineAt: raw.serverNow, answeredCount: 1 };
    });
    expect(nextStepModel(h, "ru", ru).action?.label).toBe("Продолжить тест");
  });

  it("урок или практика: вид, минуты, число заданий; причина по состоянию темы из списка тем", () => {
    const h = home("csca_home_after");
    const model = nextStepModel(h, "ru", ru);
    expect(model.title).toBe("Показательная и логарифмическая функции");
    expect(model.meta).toEqual(["Практика", "5 мин", "Заданий: 3"]);
    expect(model.why).toBe(ru["nextStep.why.gap"]);
    expect(model.action).toEqual({ label: "Начать практику", target: { kind: "lesson", lessonId: "22f0395c-b56d-5da0-8667-adec8f92a4e2" } });
    // Состояние темы берётся из списка тем, если оно уже изменилось с момента шага.
    const changed = home("csca_home_after", (raw) => {
      raw.topics.find((topic: { topicKey: string }) => topic.topicKey === "m2-exp-log").state = "shaky";
    });
    expect(nextStepModel(changed, "ru", ru).why).toBe(ru["nextStep.why.shaky"]);
  });

  it("кнопка урока по состоянию: черновик продолжают, пройденное повторяют, практика и урок начинают", () => {
    const base = { draftAttemptId: null, completed: false, metadata: { kind: "lesson" } } as unknown as Parameters<typeof lessonActionLabel>[0];
    const make = (patch: Record<string, unknown>) => ({ ...base, ...patch }) as typeof base;
    expect(lessonActionLabel(base, ru)).toBe("Начать урок");
    expect(lessonActionLabel(make({ metadata: { kind: "practice" } }), ru)).toBe("Начать практику");
    expect(lessonActionLabel(make({ completed: true }), ru)).toBe("Пройти ещё раз");
    expect(lessonActionLabel(make({ draftAttemptId: "x", completed: true }), ru)).toBe("Продолжить");
  });

  it("повторение: значок «К повторению сегодня: N» и кнопка «Повторить ошибки»", () => {
    const h = home("csca_home_after", (raw) => {
      raw.nextStep = { kind: "review" };
      raw.review.dueCount = 4;
    });
    const model = nextStepModel(h, "ru", ru);
    expect(model.title).toBe(ru["nextStep.reviewTitle"]);
    expect(model.meta).toEqual(["К повторению сегодня: 4"]);
    expect(model.action).toEqual({ label: "Повторить ошибки", target: { kind: "review" } });
  });

  it("шага нет или его теста нет в списке: «Опубликованные уроки пройдены» без кнопки", () => {
    const none = nextStepModel(home("csca_home_after", (raw) => (raw.nextStep = null)), "ru", ru);
    expect(none).toEqual({ title: ru["nextStep.noneTitle"], why: ru["nextStep.noneWhy"], meta: [], action: null });
    const orphan = nextStepModel(home("csca_home_fresh", (raw) => (raw.tests = raw.tests.slice(1))), "ru", ru);
    expect(orphan.action).toBeNull();
    expect(orphan.title).toBe(ru["nextStep.noneTitle"]);
  });

  it("KY: названия и подписи на кыргызском", () => {
    const model = nextStepModel(home("csca_home_after"), "ky", ky);
    expect(model.title).toBe(home("csca_home_after").lessons[1].metadata.title_ky);
    expect(model.action?.label).toBe(ky.startPractice);
  });
});

describe("плитки", () => {
  it("темы с пройденным уроком, ошибки на сегодня и ближайший экзамен с полной подписью дат", () => {
    const h = home("csca_home_after");
    const tiles = statTiles(h, labelsOf(h), "ru", ru);
    expect(tiles.topics).toEqual({ done: 1, total: 28, ratio: 1 / 28 });
    expect(tiles.review.due).toBe(0);
    // Сегодня 16.10, ближайшая сессия 14 и 15 ноября: 29 дней, подпись как в календаре, не одна дата.
    expect(tiles.exam).toEqual({ kind: "days", value: "29", unit: "дней", note: "14 и 15 ноября 2026 г." });
  });

  it("идущая или прошедшая сессия плиткой не берётся: следующая сессия", () => {
    const h = home("csca_home_after", (raw) => {
      raw.today = "2026-11-15";
    });
    expect(nearestSession(h)?.sessionKey).toBe("2026-12");
    const tiles = statTiles(h, labelsOf(h), "ru", ru);
    expect(tiles.exam).toMatchObject({ kind: "days", value: "34" });
  });

  it("в день начала экзамена «Сегодня», когда сессий впереди нет: «Даты не опубликованы»", () => {
    const today = home("csca_home_after", (raw) => {
      raw.today = "2026-11-14";
    });
    expect(statTiles(today, labelsOf(today), "ru", ru).exam).toMatchObject({ kind: "today", value: "Сегодня" });
    const empty = home("csca_home_after", (raw) => {
      raw.sessions = [];
    });
    expect(statTiles(empty, labelsOf(empty), "ru", ru).exam).toEqual({ kind: "none", note: ru["tile.examNone"] });
  });

  it("слово после числа дней: день, дня, дней", () => {
    expect([1, 2, 5, 21, 22, 25].map((days) => dayUnit(days, "ru", ru))).toEqual(["день", "дня", "дней", "день", "дня", "дней"]);
  });

  it("ни одной темы: доля ноль, без деления на ноль", () => {
    const h = home("csca_home_after", (raw) => {
      raw.topics = [];
      raw.lessons = [];
      raw.nextStep = null;
    });
    expect(statTiles(h, labelsOf(h), "ru", ru).topics).toEqual({ done: 0, total: 0, ratio: 0 });
  });
});

describe("тесты на время", () => {
  it("пройденный тест: день по Бишкеку, ссылка на разбор попытки и кнопка «Пройти ещё раз»", () => {
    const h = home("csca_home_after", (raw) => {
      // 18:30 UTC это 00:30 следующего дня в Бишкеке: день итога 17 октября, а не 16-е.
      raw.tests[0].lastResult.completedAt = "2026-10-16T18:30:00+00:00";
    });
    const row = testRowModel(h.tests[0], "ru", ru);
    expect(row.meta).toBe("Заданий: 3 · 4 мин");
    expect(row.last).toEqual({ label: "17 октября: верно 0 из 3", attemptId: "94c6025a-01d2-4d16-a9ee-ee0466ae6495" });
    expect(row.actionLabel).toBe("Пройти ещё раз");
  });

  it("черновик продолжают; тест без попыток начинают", () => {
    const h = home("csca_home_after");
    expect(testRowModel(h.tests[1], "ru", ru)).toMatchObject({ last: null, actionLabel: "Продолжить" });
    expect(testRowModel(home("csca_home_fresh").tests[0], "ru", ru).actionLabel).toBe("Начать");
  });
});

describe("программа по модулям", () => {
  it("модули с темами, «Пройдено X из Y», полоса по клетке на тему", () => {
    const h = home("csca_home_after");
    const sections = programSections(h, h.modules[0], "ru", ru);
    expect(sections.map((s) => [s.section, s.label, s.states.length, s.doneLabel])).toEqual([
      [1, "Модуль 1", 5, "Пройдено 0 из 5"],
      [2, "Модуль 2", 11, "Пройдено 1 из 11"],
      [3, "Модуль 3", 8, "Пройдено 0 из 8"],
      [4, "Модуль 4", 4, "Пройдено 0 из 4"],
    ]);
  });

  it("открыт модуль следующего шага; без шага по теме открыт первый", () => {
    const h = home("csca_home_after");
    expect(programSections(h, h.modules[0], "ru", ru).map((s) => s.initiallyOpen)).toEqual([false, true, false, false]);
    const test = home("csca_home_fresh");
    expect(programSections(test, test.modules[0], "ru", ru).map((s) => s.initiallyOpen)).toEqual([true, false, false, false]);
  });

  it("темы с уроками строками с кнопками урока и практики, остальные «без уроков»", () => {
    const h = home("csca_home_after");
    const two = programSections(h, h.modules[0], "ru", ru)[1];
    expect(two.rich.map((entry) => entry.topic.topicKey)).toEqual(["m2-exp-log", "m2-derivative"]);
    expect(two.rich[0].lessons.map((l) => [l.kindLabel, l.meta, l.done])).toEqual([
      ["Урок", "15 мин · Пройден", true],
      ["Практика", "5 мин", false],
    ]);
    expect(two.quiet).toHaveLength(9);
    expect(two.rich.length + two.quiet.length).toBe(11);
  });

  it("черновик урока важнее отметки «Пройден»", () => {
    const h = home("csca_home_after", (raw) => {
      raw.lessons[0].draftAttemptId = "71b33fd0-e89b-4102-8374-182354aa8882";
    });
    expect(programSections(h, h.modules[0], "ru", ru)[1].rich[0].lessons[0].meta).toBe("15 мин · Начат");
  });

  it("KY: названия модулей и тем на кыргызском", () => {
    const h = home("csca_home_after");
    const two = programSections(h, h.modules[0], "ky", ky)[1];
    expect(two.title).toBe(h.modules[0].metadata.sections[1].title_ky);
    expect(two.label).toBe(ky.sectionLabel.replace("{n}", "2"));
    expect(two.rich[0].title).toBe(h.topics.find((topic) => topic.topicKey === "m2-exp-log")?.metadata.title_ky);
  });
});
