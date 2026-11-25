// Результат теста как на сайте (G60, G61): сводка и темы английского с разбором по заданиям, восемь шкал по убыванию с пояснениями,
// профессии со всеми деталями и источником, «Как читать результат и его ограничения». Чтение идёт по настоящему пути
// приложения (слой RPC, строгие разборщики) на поддельном транспорте; данные синтетические.
import { fireEvent, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo, Linking } from "react-native";

import { AssessmentScreen } from "@/features/learning/tests/AssessmentScreen";
import { RESULT_ATTEMPT_ID, completedCareer, completedEnglish } from "@/test-fixtures/assessment-results";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), back: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

async function open(key: "english36" | "orvis92", attempt: unknown, lang: "ru" | "ky" = "ru") {
  const { transport } = fakeTransport({ student_assessments_v1: { instruments: [], attempts: [] }, student_assessment_attempt_v1: attempt });
  await renderPortal(<AssessmentScreen instrumentKey={key} attemptId={RESULT_ATTEMPT_ID} />, testApi(transport), lang);
  return screen.findByTestId("assessment-result");
}
const toggle = (id: string) => fireEvent.press(screen.getByTestId(`${id}-toggle`));

describe("результат английского", () => {
  it("сводка: «Завершён», счёт, уровень по результату, пояснение и «Результат сохранён» (уровень только когда он есть)", async () => {
    await open("english36", completedEnglish());
    expect(screen.getByText("Завершён")).toBeTruthy();
    expect(screen.getByTestId("result-score")).toHaveTextContent("6 из 10");
    expect(screen.getByTestId("result-band")).toHaveTextContent("Развивающийся результат на этом тесте");
    expect(screen.getByText(/Это не сертификат, а срез по этим заданиям/)).toBeTruthy();
    expect(screen.getByText("Результат сохранён.")).toBeTruthy();
  });

  it("нет уровня в ответе: строки уровня нет (раньше показывалась «Результат на этом наборе заданий» всегда)", async () => {
    const attempt = completedEnglish();
    delete (attempt.result.english as { band?: string }).band;
    await open("english36", attempt);
    expect(screen.queryByTestId("result-band")).toBeNull();
    expect(screen.queryByText("Результат на этом наборе заданий")).toBeNull();
  });

  it("темы: доля, подпись по порогам сайта (меньше 4 заданий; от 75 %; остальное), совет, полоса с названием темы по-русски", async () => {
    await open("english36", completedEnglish());
    const grammar = within(screen.getByTestId("topic-grammar"));
    expect(grammar.getByText("Грамматика")).toBeTruthy();
    expect(grammar.getByText("3 / 4")).toBeTruthy();
    expect(grammar.getByText(/большинство заданий выполнены верно/)).toBeTruthy(); // 3 из 4 = 75 %
    expect(grammar.getByText("Совет по грамматике.")).toBeTruthy();
    expect(grammar.getByLabelText("Грамматика: 3 из 4")).toBeTruthy();
    const words = within(screen.getByTestId("topic-vocabulary"));
    expect(words.getByText(/Начните с разбора ошибок ниже/)).toBeTruthy(); // 1 из 4
    expect(words.getByLabelText("Слова в контексте: 1 из 4")).toBeTruthy(); // не сырой ключ «vocabulary»
    const reading = within(screen.getByTestId("topic-reading"));
    expect(reading.getByText(/Мало заданий для уверенного вывода/)).toBeTruthy(); // всего 2
    expect(reading.getByLabelText("Чтение: 2 из 2")).toBeTruthy();
  });

  it("разбор по заданиям: «N. Верно / Нужно разобрать — навык», строки свёрнуты, внутри текст, формулировка, оба ответа и объяснение", async () => {
    await open("english36", completedEnglish());
    expect(screen.getByText("Разбор заданий")).toBeTruthy();
    expect(screen.getByText("Повтор этого же теста после разбора не является независимой проверкой уровня.")).toBeTruthy();
    // Подпись навыка из метаданных, затем тема, затем запасная.
    expect(screen.getByText("1. Верно — Регулярные действия: Present Simple")).toBeTruthy();
    expect(screen.getByText("4. Нужно разобрать — Грамматика")).toBeTruthy();
    expect(screen.getByText("5. Верно — Слова в контексте")).toBeTruthy();
    expect(screen.getAllByText(/^\d+\. (Верно|Нужно разобрать) — /)).toHaveLength(10);
    expect(screen.queryByText("Разбор задания e1.")).toBeNull();
    await toggle("feedback-1");
    expect(screen.getByTestId("feedback-1-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText("A short passage for the first task.")).toBeTruthy();
    expect(screen.getByText("Choose the answer 1")).toBeTruthy();
    expect(screen.getByText(/Ваш ответ:/)).toHaveTextContent("Ваш ответ: alpha 1");
    // Верный ответ показывается и когда студент ответил верно.
    expect(screen.getByText(/Правильный ответ:/)).toHaveTextContent("Правильный ответ: alpha 1");
    expect(screen.getByText("Разбор задания e1.")).toBeTruthy();
    await toggle("feedback-4");
    expect(screen.getByText("Правильный ответ: alpha 4")).toBeTruthy();
    expect(screen.getByText("Ваш ответ: beta 4")).toBeTruthy();
    await toggle("feedback-1");
    expect(screen.queryByText("Разбор задания e1.")).toBeNull();
  });

  it("запасная подпись: нет навыка и тема не из словаря", async () => {
    const attempt = completedEnglish();
    attempt.result.english!.feedback[4].topic = "other-topic";
    await open("english36", attempt);
    expect(screen.getByText("5. Верно — Разбор задания")).toBeTruthy();
  });

  it("«Как читать результат и его ограничения» свёрнуто и открывает ограничения содержания", async () => {
    await open("english36", completedEnglish());
    expect(screen.queryByText(/Ограничение один/)).toBeNull();
    await toggle("limitations");
    expect(screen.getByText(/Ограничение один/)).toBeTruthy();
    expect(screen.getByText(/Ограничение два/)).toBeTruthy();
  });

  it("кыргызский: подписи интерфейса из словаря, название темы и полоса по-кыргызски", async () => {
    await open("english36", completedEnglish(), "ky");
    expect(screen.getByTestId("result-score")).toHaveTextContent("10 ичинен 6");
    expect(screen.getByLabelText("Грамматика: 4 ичинен 3")).toBeTruthy();
    expect(screen.getByLabelText("Контексттеги сөздөр: 4 ичинен 1")).toBeTruthy();
    expect(screen.getByText("1. Туура — Регулярные действия: Present Simple")).toBeTruthy(); // подпись навыка - содержание, оно русское
    expect(screen.getByText("4. Талдоо керек — Грамматика")).toBeTruthy();
  });

  it("читалка слышит заголовок результата, как веб переводит на него фокус", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await open("english36", completedEnglish());
    expect(announce).toHaveBeenCalledWith("6 из 10");
    announce.mockRestore();
  });
});

describe("результат профориентации", () => {
  const order = () => screen.getAllByTestId(/^scale-/).map((node) => String(node.props.testID).replace("scale-", ""));

  it("шкалы по убыванию среднего, два знака после запятой, на русском название из содержания и пояснение под полосой", async () => {
    await open("orvis92", completedCareer());
    expect(order()).toEqual(["analysis", "erudition", "altruism", "production", "creativity", "leadership", "organization", "adventure"]);
    const analysis = within(screen.getByTestId("scale-analysis"));
    expect(analysis.getByText("Анализ и исследование (содержание)")).toBeTruthy();
    expect(analysis.getByText("4.50 / 5")).toBeTruthy();
    expect(analysis.getByText("Пояснение к шкале: analysis.")).toBeTruthy();
    // Подпись полосы для читалки - название из словаря, как на сайте.
    expect(analysis.getByLabelText("Анализ: 4.50 из 5")).toBeTruthy();
    expect(within(screen.getByTestId("scale-adventure")).getByText("1.25 / 5")).toBeTruthy();
  });

  it("кыргызский: названия шкал остаются из словаря приложения (решение владельца D12), пояснение - содержание", async () => {
    await open("orvis92", completedCareer(), "ky");
    const leadership = within(screen.getByTestId("scale-leadership"));
    expect(leadership.getByText("Лидерлик")).toBeTruthy();
    expect(leadership.queryByText(/содержание/)).toBeNull();
    expect(leadership.getByText("Пояснение к шкале: leadership.")).toBeTruthy();
    expect(leadership.getByText("2.00 / 5")).toBeTruthy();
  });

  it("профессии: пометка об источнике, предпочтительные (под лучшие шкалы) видны, остальные в «Посмотреть остальные направления»", async () => {
    await open("orvis92", completedCareer());
    expect(screen.getByText("Профессии, которые можно исследовать")).toBeTruthy();
    expect(screen.getByText("Использованы сведения O*NET (синтетическая пометка для теста).")).toBeTruthy();
    expect(screen.getByText("Аналитик данных")).toBeTruthy();
    expect(screen.getByText("Переводчик")).toBeTruthy();
    expect(screen.queryByText("Менеджер проектов")).toBeNull();
    expect(screen.queryByText("Учитель")).toBeNull();
    await fireEvent.press(screen.getByText("Посмотреть остальные направления"));
    expect(screen.getByText("Менеджер проектов")).toBeTruthy();
    expect(screen.getByText("Учитель")).toBeTruthy();
  });

  it("карточка профессии: день, навыки, направления, путь, «Попробуйте», пометка и источник со ссылками на профиль и лицензию", async () => {
    const open_ = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await open("orvis92", completedCareer());
    await toggle("profession-data-analyst");
    const card = within(screen.getByTestId("profession-data-analyst"));
    expect(card.getByText("Краткое описание: Аналитик данных.")).toBeTruthy();
    expect(card.getByText("Что делают в течение дня")).toBeTruthy();
    expect(card.getByText("• Задача один: Аналитик данных.")).toBeTruthy();
    expect(card.getByText(/Навык А · Навык Б/)).toHaveTextContent("Что развивать: Навык А · Навык Б");
    expect(card.getByText(/Направление А · Направление Б/)).toHaveTextContent("Что изучать: Направление А · Направление Б");
    expect(card.getByText(/Стажёр → Аналитик → Ведущий аналитик/)).toHaveTextContent("Возможное развитие: Стажёр → Аналитик → Ведущий аналитик");
    expect(card.getByText(/Попробуйте задание для профессии/)).toHaveTextContent("Попробуйте: Попробуйте задание для профессии Аналитик данных.");
    expect(card.getByText("Редакционная связь: Аналитик данных.")).toBeTruthy();
    const source = card.getByText(/Адаптация EVO по/);
    expect(source).toHaveTextContent(/Адаптация EVO по профилю O\*NET® 00-12000\.00, O\*NET 31\.0; CC BY 4\.0\. Источник проверен 2026-09-09\. Описание профессии относится к контексту США/);
    await fireEvent.press(card.getByText("профилю O*NET® 00-12000.00"));
    expect(open_).toHaveBeenLastCalledWith("https://onet.example.test/data-analyst");
    await fireEvent.press(card.getByText("CC BY 4.0"));
    expect(open_).toHaveBeenLastCalledWith("https://license.example.test/by");
    open_.mockRestore();
  });

  it("у профессии без пути развития строки «Возможное развитие» нет", async () => {
    await open("orvis92", completedCareer());
    await toggle("profession-translator");
    expect(within(screen.getByTestId("profession-translator")).queryByText(/Возможное развитие/)).toBeNull();
  });

  it("ограничения: на результате профориентации они тоже есть (раньше жили только на экране «Перед началом»)", async () => {
    await open("orvis92", completedCareer());
    expect(screen.queryByText(/Ограничение один/)).toBeNull();
    await toggle("limitations");
    expect(screen.getByText(/Ограничение один/)).toBeTruthy();
    expect(screen.getByText("Как читать результат и его ограничения")).toBeTruthy();
  });

  it("заголовок «Ваша карта интересов», пояснение и «Результат сохранён»; читалка слышит заголовок", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    await open("orvis92", completedCareer());
    expect(screen.getByTestId("result-score")).toHaveTextContent("Ваша карта интересов");
    expect(screen.getByText(/Более высокий средний ответ показывает больший интерес/)).toBeTruthy();
    expect(screen.getByText("Результат сохранён.")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Ваша карта интересов");
    announce.mockRestore();
  });

  it("кнопки «Пройти заново» и «Вернуться к тестам» на месте", async () => {
    await open("orvis92", completedCareer());
    expect(screen.getByTestId("assessment-restart")).toBeTruthy();
    expect(screen.getByTestId("assessment-back-to-tests")).toBeTruthy();
  });
});
