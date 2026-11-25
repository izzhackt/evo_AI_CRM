import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";

import { PortalApiProvider, usePortalApi } from "@/api/PortalApi";
import { EviMemoryProvider } from "@/features/learning/evi/EviMemory";
import { EviScreen } from "@/features/learning/evi/EviScreen";
import type { EviApi } from "@/features/learning/evi/api";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args), dismissTo: jest.fn(), canGoBack: () => false, back: jest.fn() },
  useRouter: () => ({ canGoBack: () => false, back: jest.fn(), navigate: (...args: unknown[]) => mockNavigate(...args) }),
}));
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => true }));

type Ask = EviApi["ask"];
const answer = (over: Record<string, unknown> = {}) => ({ ok: true as const, answer: { message: "Что тебе нравится делать?", mood: "talk" as const, options: ["Рисовать", "Считать"], multi: false, results: null, progress: { step: 1, total: 10 }, ...over } });
const results = [1, 2, 3].map((n) => ({ cardId: `card-${n}`, cardKey: `key-${n}`, title: `Профессия ${n}`, summary: n === 1 ? "Лечит людей" : null, why: `Причина ${n}` }));
const scrollToEnd = ScrollView.prototype.scrollToEnd as unknown as jest.Mock;

/**
 * Оболочка кабинета в миниатюре: память стоит снаружи экрана, экран можно закрыть («Назад» в «Профессии») и открыть снова, а
 * студента на том же месте - сменить (в приложении это невозможно без выхода, но чат не должен на это полагаться).
 */
function Cabinet({ ask }: { ask: Ask }) {
  const base = usePortalApi();
  const client = useQueryClient();
  const [open, setOpen] = useState(true);
  const [student, setStudent] = useState(base.userKey);
  return (
    <EviMemoryProvider>
      <Pressable testID="leave" onPress={() => setOpen(false)} />
      <Pressable testID="return" onPress={() => setOpen(true)} />
      <Pressable testID="student-b" onPress={() => setStudent("user-b")} />
      <Pressable testID="student-a" onPress={() => setStudent(base.userKey)} />
      {open ? (
        <PortalApiProvider api={{ ...base, userKey: student }} client={client}>
          <EviScreen api={{ ask }} />
        </PortalApiProvider>
      ) : (
        <Text testID="elsewhere">Профессии</Text>
      )}
    </EviMemoryProvider>
  );
}

const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };

async function openCabinet(ask: Ask, lang: "ru" | "ky" = "ru") {
  const { transport } = fakeTransport({ portal_ai_consent_get_v1: GRANTED });
  const view = await renderPortal(<Cabinet ask={ask} />, testApi(transport), lang);
  await screen.findByTestId("evi-screen");
  return view;
}

async function leaveAndReturn() {
  await fireEvent.press(screen.getByTestId("leave"));
  expect(screen.queryByTestId("evi-screen")).toBeNull();
  await fireEvent.press(screen.getByTestId("return"));
  // Согласие уже в кэше кабинета: чат возвращается сразу, без ожидания.
  expect(screen.getByTestId("evi-screen")).toBeTruthy();
}

async function startTalking() {
  await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
  await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
}

describe("«Подбор с Эви» помнит разговор, пока открыт кабинет (веб #1530)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    scrollToEnd.mockClear();
    jest.mocked(AsyncStorage.setItem).mockClear();
  });

  it("«Назад» и снова «Подбор с Эви»: реплики, варианты и полоса вопроса на месте, нового запроса нет", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>(async () => answer());
    await openCabinet(ask);
    await startTalking();
    await leaveAndReturn();
    expect(screen.queryByTestId("evi-welcome")).toBeNull();
    expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy();
    expect(screen.getByTestId("evi-bubble-mine")).toBeTruthy();
    expect(screen.getByTestId("evi-option-Рисовать")).toBeTruthy();
    expect(screen.getByText("Вопрос 1 из 10")).toBeTruthy();
    expect(screen.getByTestId("evi-progress-fill", { includeHiddenElements: true }).props.style.width).toBe("10%");
    expect(screen.getByTestId("evi-new-chat")).toBeTruthy();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("итог с тремя профессиями возвращается: нажатие по-прежнему ведёт на карточку каталога", async () => {
    await openCabinet(jest.fn(async () => answer({ message: "Придумал!", mood: "eureka", options: [], results, progress: null })));
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-results")).toBeTruthy());
    await leaveAndReturn();
    expect(screen.getByText("Придумал!")).toBeTruthy();
    expect(screen.getByText("Твои профессии")).toBeTruthy();
    expect(screen.getByText("Лечит людей")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("evi-result-key-3"));
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/professions/[cardId]", params: { cardId: "card-3" } });
  });

  it("после возврата уходит вся прежняя переписка в том же виде, что и на вебе: только role и content, язык приложения", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>(async () => answer());
    await openCabinet(ask, "ky");
    await fireEvent.press(screen.getByTestId("evi-option-Баштайлы!"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    await leaveAndReturn();
    await fireEvent.press(screen.getByTestId("evi-option-Рисовать"));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    const [first, second] = ask.mock.calls;
    expect(second![1]).toBe("ky");
    // Первый ход: приветствие Эви и ответ ученика. Второй: те же два хода, ответ Эви из памяти и новый ответ ученика.
    expect(second![0]).toEqual([
      ...first![0],
      { role: "assistant", content: "Что тебе нравится делать?" },
      { role: "user", content: "Рисовать" },
    ]);
    for (const turn of second![0]) expect(Object.keys(turn).sort()).toEqual(["content", "role"]);
  });

  it("новый кабинет (выход или новый запуск приложения): только приветствие, прежнего разговора нет", async () => {
    const view = await openCabinet(jest.fn(async () => answer()));
    await startTalking();
    await view.unmount();
    await openCabinet(jest.fn());
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    expect(screen.queryByTestId("evi-bubble-mine")).toBeNull();
    expect(screen.queryByTestId("evi-new-chat")).toBeNull();
  });

  it("другой студент на том же месте видит только приветствие, и разговор первого не возвращается никому", async () => {
    await openCabinet(jest.fn(async () => answer()));
    await startTalking();
    await fireEvent.press(screen.getByTestId("student-b"));
    // У другого студента своё согласие в кэше: пока оно читается, чата нет, потом - только приветствие.
    expect(await screen.findByTestId("evi-welcome")).toBeTruthy();
    expect(screen.queryByText("Что тебе нравится делать?")).toBeNull();
    // Первый вернулся, но его разговор стёрт приветствием второго - так же на вебе.
    await fireEvent.press(screen.getByTestId("student-a"));
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    await leaveAndReturn();
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
  });

  it("«Новый чат» стирает память: после «Назад» и возврата снова приветствие", async () => {
    await openCabinet(jest.fn(async () => answer()));
    await startTalking();
    await fireEvent.press(screen.getByTestId("evi-new-chat"));
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    await leaveAndReturn();
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    expect(screen.queryByTestId("evi-bubble-mine")).toBeNull();
  });

  it("«Разговор получился длинным» остаётся тем же: только «Новый чат», поля нет", async () => {
    await openCabinet(jest.fn(async () => ({ ok: false as const, reason: "limit" as const })));
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-restart")).toBeTruthy());
    await leaveAndReturn();
    expect(screen.getByTestId("evi-restart")).toBeTruthy();
    expect(screen.getByTestId("evi-failure").props.children).toMatch(/длинн/u);
    expect(screen.queryByTestId("evi-input")).toBeNull();
    expect(screen.queryByTestId("evi-retry")).toBeNull();
    await fireEvent.press(screen.getByTestId("evi-restart"));
    expect(screen.getByTestId("evi-welcome")).toBeTruthy();
    expect(screen.getByTestId("evi-input")).toBeTruthy();
  });

  it("«Нет согласия» не запирает чат после возврата: страница проверит согласие заново, у студента один «Повторить»", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>().mockResolvedValueOnce({ ok: false, reason: "consent" }).mockResolvedValueOnce(answer());
    await openCabinet(ask);
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    await waitFor(() => expect(screen.getByTestId("evi-catalog")).toBeTruthy());
    await leaveAndReturn();
    expect(screen.queryByTestId("evi-catalog")).toBeNull();
    expect(screen.getByTestId("evi-retry")).toBeTruthy();
    expect(screen.getByTestId("evi-input")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("evi-retry"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(ask.mock.calls[1]![0]).toEqual(ask.mock.calls[0]![0]);
  });

  it("ушёл, пока Эви печатала: при возврате видны его реплика и «Повторить», повтор шлёт тот же вопрос", async () => {
    const ask = jest.fn<ReturnType<Ask>, Parameters<Ask>>(() => new Promise(() => undefined));
    await openCabinet(ask);
    await fireEvent.press(screen.getByTestId("evi-option-Начнём!"));
    expect(screen.getByTestId("evi-typing")).toBeTruthy();
    await leaveAndReturn();
    expect(screen.queryByTestId("evi-typing")).toBeNull();
    expect(screen.getByTestId("evi-bubble-mine")).toBeTruthy();
    expect(screen.getByTestId("evi-failure").props.children).toMatch(/Не получилось/u);
    ask.mockResolvedValueOnce(answer());
    await fireEvent.press(screen.getByTestId("evi-retry"));
    await waitFor(() => expect(screen.getByText("Что тебе нравится делать?")).toBeTruthy());
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]![0]).toEqual(ask.mock.calls[0]![0]);
  });

  it("вернувшийся разговор открывается на последней реплике: первый замер содержимого прокручивает к концу без анимации, один раз", async () => {
    await openCabinet(jest.fn(async () => answer()));
    await startTalking();
    await leaveAndReturn();
    const pinned = () => scrollToEnd.mock.calls.filter(([options]) => options?.animated === false);
    await fireEvent(screen.getByTestId("evi-log"), "contentSizeChange", 390, 0);
    expect(pinned()).toHaveLength(0);
    await fireEvent(screen.getByTestId("evi-log"), "contentSizeChange", 390, 900);
    expect(pinned()).toHaveLength(1);
    await fireEvent(screen.getByTestId("evi-log"), "contentSizeChange", 390, 1200);
    expect(pinned()).toHaveLength(1);
  });

  it("свежий чат (приветствие) к концу не прокручивается: закрепление только у вернувшегося разговора", async () => {
    await openCabinet(jest.fn());
    await fireEvent(screen.getByTestId("evi-log"), "contentSizeChange", 390, 900);
    expect(scrollToEnd.mock.calls.filter(([options]) => options?.animated === false)).toHaveLength(0);
  });

  it("на устройство ничего не пишется: AsyncStorage не тронут ни ходом разговора, ни возвратом (веб: только память страницы)", async () => {
    await openCabinet(jest.fn(async () => answer()));
    await startTalking();
    await leaveAndReturn();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
  });
});
