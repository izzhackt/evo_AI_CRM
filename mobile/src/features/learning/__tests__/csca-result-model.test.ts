// Итог теста на время: разбивка по модулям и темам, факты, кнопки под итогом и правила вступления (веб: TestResultView.tsx,
// TimedTestRunner.tsx). Данные настоящих ответов (синтетический студент).
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseCscaHome, parseCscaTestAttempt } from "@web/lib/portal/csca";
import { getPortalStrings } from "@web/lib/portal/i18n";

import { introRules, resultActions, resultFacts, resultTallies } from "@/features/learning/test-runner/result-model";
import { navCellLabel } from "@/features/learning/test-runner/TestNavigator";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const home = parseCscaHome(fx("csca_home_after"));
const attempt = parseCscaTestAttempt(fx("csca_test_complete_diagnostic"));
const ru = getPortalStrings("csca", "ru");
const ky = getPortalStrings("csca", "ky");
const result = attempt.result!;

describe("разбивка итога", () => {
  it("модули названы «Модуль N. название», темы названием и английским под ним", () => {
    const tallies = resultTallies(result, home, "ru", ru);
    expect(tallies.titlesKnown).toBe(true);
    expect(tallies.sections.map((row) => row.label)).toEqual(["Модуль 2. Функции", "Модуль 3. Геометрия и алгебра"]);
    const topic = tallies.topics.find((row) => row.key === "m2-exp-log");
    expect(topic).toMatchObject({ label: "Показательная и логарифмическая функции", labelEn: "Exponential and logarithmic functions", correct: 0, total: 1, ratio: 0 });
    expect(tallies.sections.every((row) => row.labelEn === null)).toBe(true);
  });

  it("доля верных для полосы: верно 2 из 4 это половина, нет заданий это ноль", () => {
    const changed = { ...result, byTopic: [{ topicKey: "m2-exp-log", total: 4, answered: 4, correct: 2 }, { topicKey: "m2-derivative", total: 0, answered: 0, correct: 0 }] };
    const rows = resultTallies(changed, home, "ru", ru).topics;
    expect(rows.map((row) => row.ratio)).toEqual([0.5, 0]);
  });

  it("главная трека не прочиталась: названий нет (экран ждёт), ключ темы запасной, модуль называется номером", () => {
    const tallies = resultTallies(result, undefined, "ru", ru);
    expect(tallies.titlesKnown).toBe(false);
    expect(tallies.topics[0].label).toBe("m2-exp-log");
    expect(tallies.topics[0].labelEn).toBeNull();
    expect(tallies.sections[0].label).toBe("Модуль 2");
  });

  it("KY: названия на кыргызском", () => {
    const tallies = resultTallies(result, home, "ky", ky);
    expect(tallies.topics[0].label).toBe(home.topics.find((topic) => topic.topicKey === "m2-exp-log")?.metadata.title_ky);
    expect(tallies.sections[0].label).toBe(`${ky.sectionLabel.replace("{n}", "2")}. ${home.modules[0].metadata.sections[1].title_ky}`);
  });
});

describe("факты и кнопки под итогом", () => {
  it("три факта: как завершён, без ответа, темп; пробный тест по времени: «Время вышло»", () => {
    expect(resultFacts(result, ru).map((fact) => [fact.key, fact.label, fact.value])).toEqual([
      ["how", "Как завершён", "Завершён вами"],
      ["unanswered", "Без ответа", "1"],
      ["pace", "Темп", "В среднем 52 с на задание при ориентире экзамена 75 с."],
    ]);
    expect(resultFacts({ ...result, completion: "timeout" }, ru)[0].value).toBe("Время вышло");
    expect(resultFacts({ ...result, pace: { ...result.pace, avgSeconds: null } }, ru)[2].value).toBe(ru.resultPaceNone);
  });

  it("слабая тема с уроком: урок главной кнопкой, затем «К темам» и «Пройти ещё раз»", () => {
    const actions = resultActions(attempt, home, "ru", ru);
    expect(actions.map((action) => action.kind)).toEqual(["lesson", "topics", "restart"]);
    expect(actions.map((action) => action.primary)).toEqual([true, false, false]);
    expect(actions[0].label).toMatch(/^Следующий шаг: (урок|практика) «.+»$/u);
    expect(actions[1].label).toBe("К темам");
    expect(actions[2].label).toBe("Пройти ещё раз");
  });

  it("слабой темы нет (всё верно или главная не прочиталась): «К темам» главная кнопка", () => {
    const allCorrect = { result: { ...result, byTopic: result.byTopic.map((topic) => ({ ...topic, correct: topic.total })) } };
    expect(resultActions(allCorrect, home, "ru", ru).map((action) => [action.kind, action.primary])).toEqual([["topics", true], ["restart", false]]);
    expect(resultActions(attempt, undefined, "ru", ru).map((action) => action.kind)).toEqual(["topics", "restart"]);
  });

  it("KY: подпись урока слабой темы на кыргызском", () => {
    expect(resultActions(attempt, home, "ky", ky)[0].label).toMatch(/^Кийинки кадам|^Кийинки/u);
  });
});

describe("правила вступления и подписи навигатора", () => {
  it("диагностика: четыре строки с «Разбор откроется»; пробный тест: с «ответы отправятся сами»", () => {
    expect(introRules(true, ru, "Таймер идёт, даже если закрыть приложение.")).toEqual([
      ru.testRuleChange,
      ru.testRuleSave,
      "Таймер идёт, даже если закрыть приложение.",
      ru.testRuleReview,
    ]);
    const mock = introRules(false, ru, "x");
    expect(mock[3]).toBe(ru.testRuleMock);
    expect(mock).not.toContain(ru.testRuleReview);
  });

  it("подпись ячейки: номер, отвечено или без ответа, при флажке «вернуться позже»", () => {
    expect(navCellLabel(0, false, false, ru)).toBe("Задание 1, без ответа");
    expect(navCellLabel(4, true, false, ru)).toBe("Задание 5, отвечено");
    expect(navCellLabel(4, true, true, ru)).toBe("Задание 5, отвечено, вернуться позже");
  });
});
