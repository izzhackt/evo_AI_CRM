import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { EviScreen } from "@/features/learning/evi/EviScreen";
import type { EviApi } from "@/features/learning/evi/api";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const mockNavigate = jest.fn();
const mockDismissTo = jest.fn();
jest.mock("expo-router", () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args), dismissTo: (...args: unknown[]) => mockDismissTo(...args), canGoBack: () => false, back: jest.fn() },
  useRouter: () => ({ canGoBack: () => false, back: jest.fn(), navigate: (...args: unknown[]) => mockNavigate(...args) }),
}));
// Робот и точки без бегущего движения: проверяется поведение экрана, а не кадры (их проверяют EviRobot.test и TypingDots.test).
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => true }));

type Ask = EviApi["ask"];
const answer = (over: Record<string, unknown> = {}) => ({ ok: true as const, answer: { message: "Что тебе нравится делать?", mood: "talk" as const, options: ["Рисовать", "Считать"], multi: false, results: null, progress: { step: 1, total: 10 }, ...over } });

const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };

async function open(ask: Ask, lang: "ru" | "ky" = "ru") {
  const { transport } = fakeTransport({ portal_ai_consent_get_v1: GRANTED });
  const view = await renderPortal(<EviScreen api={{ ask }} />, testApi(transport), lang);
  // Согласие читается до чата (как страница веба).
  await screen.findByTestId("evi-screen");
  return view;
}

describe("«Подбор с Эви»", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockDismissTo.mockReset();
  });

  it("приветствие: имя, строка о том, что будет, и два варианта; шапки разговора ещё нет", async () => {
    await open(jest.fn());
    expect(screen.getByText("Привет! Я Эви")).toBeTruthy();
    expect(screen.getByTestId("evi-welcome-text").props.children).toMatch(/три профессии/u);
    expect(screen.getByTestId("evi-option-Начнём!")).toBeTruthy();
    expect(screen.getByTestId("evi-option-А как это работает?")).toBeTruthy();
    expect(screen.queryByTestId("evi-new-chat")).toBeNull();
  });

  it("вариант уходит на сервер историей «приветствие Эви, ответ ученика» с языком приложения; ответ и новые варианты показаны", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>(async () => answer());
    await open(ask, "ky");
    await fireEvent.press(screen.getByTestId("evi-option-Баштайлы!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(ask).toHaveBeenCalledTimes(1);
    const [history, lang] = ask.mock.calls[0]!;
    expect(lang).toBe("ky");
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe("assistant");
    expect(history[1]).toEqual({ role: "user", content: "Баштайлы!" });
    expect(screen.getByTestId("evi-option-Рисовать")).toBeTruthy();
    expect(screen.getByText("10 суроонун 1-суроосу")).toBeTruthy();
    expect(screen.getByTestId("evi-progress-fill", { includeHiddenElements: true }).props.style.width).toBe("10%");
  });

  it("поле ввода: сообщение отправляется, пустое - нет; пока Эви думает, вторая отправка не уходит", async () => {
    let release: (value: Awaited<ReturnType<Ask>>) => void = () => undefined;
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>(() => new Promise((resolve) => { release = resolve; }));
    await open(ask);
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    expect(screen.getByTestId("evi-typing")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("evi-input"), "Мне нравится биология");
    await fireEvent.press(screen.getByTestId("evi-send"));
    expect(ask).toHaveBeenCalledTimes(1);
    release(answer());
    await waitFor(() => expect(screen.queryByTestId("evi-typing")).toBeNull());
    await fireEvent.changeText(screen.getByTestId("evi-input"), "   ");
    await fireEvent.press(screen.getByTestId("evi-send"));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("несколько вариантов: «Готово» отправляет выбранное через запятую", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>().mockResolvedValueOnce(answer({ options: ["Музыка", "Спорт"], multi: true })).mockResolvedValueOnce(answer({ options: [] }));
    await open(ask);
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-option-Музыка")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("evi-option-Музыка"));
    await fireEvent.press(screen.getByTestId("evi-option-Спорт"));
    await fireEvent.press(screen.getByTestId("evi-done"));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[1]![0].at(-1)).toEqual({ role: "user", content: "Музыка, Спорт" });
  });

  it("итог: три профессии с названием, строкой «чем занимается» и «почему»; нажатие ведёт на карточку каталога", async () => {
    const results = [1, 2, 3].map((n) => ({ cardId: `card-${n}`, cardKey: `key-${n}`, title: `Профессия ${n}`, summary: n === 1 ? "Лечит людей" : null, why: `Причина ${n}` }));
    await open(jest.fn(async () => answer({ message: "Придумал!", mood: "eureka", options: [], results, progress: null })));
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-results")).toBeTruthy());
    expect(screen.getByText("Твои профессии")).toBeTruthy();
    expect(screen.getByText("Лечит людей")).toBeTruthy();
    expect(screen.getByText("Причина 3")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("evi-result-key-2"));
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/professions/[cardId]", params: { cardId: "card-2" } });
  });

  it("сбои как на вебе: busy и error - «Повторить» шлёт тот же вопрос; limit и invalid - только «Новый чат»; consent - «Открыть каталог»", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>().mockResolvedValueOnce({ ok: false, reason: "busy" }).mockResolvedValueOnce(answer());
    await open(ask);
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-failure").props.children).toMatch(/Слишком много сообщений/u));
    await fireEvent.press(screen.getByTestId("evi-retry"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(ask.mock.calls[1]![0]).toEqual(ask.mock.calls[0]![0]);
  });

  it("limit: поле закрыто, одно действие - «Новый чат», он возвращает приветствие", async () => {
    await open(jest.fn(async () => ({ ok: false as const, reason: "limit" as const })));
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-restart")).toBeTruthy());
    expect(screen.queryByTestId("evi-input")).toBeNull();
    await fireEvent.press(screen.getByTestId("evi-restart"));
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    expect(screen.getByTestId("evi-input")).toBeTruthy();
  });

  it("согласие отозвано (consent): «Эви сейчас недоступен», поле закрыто, «Открыть каталог» ведёт в Профессии; напоминаний о конфиденциальности нет", async () => {
    await open(jest.fn(async () => ({ ok: false as const, reason: "consent" as const })));
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-catalog")).toBeTruthy());
    expect(screen.getByText("Эви сейчас недоступен. Загляните позже.")).toBeTruthy();
    expect(screen.queryByTestId("evi-input")).toBeNull();
    await fireEvent.press(screen.getByTestId("evi-catalog"));
    // К каталогу, который уже в стеке (а не второй каталог поверх Эви): `dismissTo`, не `navigate`.
    expect(mockDismissTo).toHaveBeenCalledWith("/professions");
    expect(mockNavigate).not.toHaveBeenCalled();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toMatch(/конфиденц|персональн|согласи|privacy/iu);
  });

  it("на рабочем экране нет текстов о конфиденциальности ни до, ни после ответа (правило владельца 14.11)", async () => {
    await open(jest.fn(async () => answer()));
    const before = JSON.stringify(screen.toJSON());
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    for (const text of [before, JSON.stringify(screen.toJSON())]) expect(text).not.toMatch(/конфиденц|персональн|согласи|privacy|ИИ-помощник/iu);
  });
});
