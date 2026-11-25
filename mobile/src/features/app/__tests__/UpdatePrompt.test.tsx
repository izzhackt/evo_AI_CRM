// Предложение обновиться (G4 аудита паритета 25.11.2026): карточка «Вышла новая версия» только когда обновление скачано и
// обновления включены; молчит без обновлений, в разработке и при любом сбое. Настоящий `expo-updates` заменён: путь OTA в
// приложении ещё ни разу не проходился до конца.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, AppState, type AppStateStatus, Text as RNText } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RELOAD_RESET_MS, UpdatePrompt } from "@/features/app/UpdatePrompt";
import { LangProvider } from "@/i18n/LangProvider";
import { TOP_BAR_HEIGHT } from "@/shell/top-bar-metrics";
import { ThemeProvider } from "@/theme/ThemeProvider";

type UpdatesState = { isUpdatePending: boolean; isDownloading?: boolean; isRestarting?: boolean };
const mockUpdates: { isEnabled: boolean; state: () => UpdatesState; reloadAsync: jest.Mock; check: jest.Mock; fetch: jest.Mock } = {
  isEnabled: true,
  state: () => ({ isUpdatePending: false }),
  reloadAsync: jest.fn(async () => undefined),
  check: jest.fn(async () => ({ isAvailable: false })),
  fetch: jest.fn(async () => ({ isNew: false })),
};
jest.mock("expo-updates", () => ({
  __esModule: true,
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  useUpdates: () => mockUpdates.state(),
  reloadAsync: (...args: unknown[]) => mockUpdates.reloadAsync(...args),
  checkForUpdateAsync: (...args: unknown[]) => mockUpdates.check(...args),
  fetchUpdateAsync: (...args: unknown[]) => mockUpdates.fetch(...args),
}));
let mockSessionKind = "signedOut";
jest.mock("@/session/SessionProvider", () => ({ useSession: () => ({ state: { kind: mockSessionKind } }) }));
// Общая константа высоты верхней полосы читается через геттер: тест может подменить число и увидеть, что карточка берёт его
// оттуда, а не своим числом. Настоящее значение сверяется отдельно (`jest.requireActual`).
let mockBarHeight = 52;
jest.mock("@/shell/top-bar-metrics", () => ({
  get TOP_BAR_HEIGHT() {
    return mockBarHeight;
  },
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const promptTree = (lang: "ru" | "ky" = "ru") => (
  <SafeAreaProvider initialMetrics={metrics}>
    <ThemeProvider>
      <LangProvider initial={lang}>
        <RNText testID="app-body">приложение</RNText>
        <UpdatePrompt />
      </LangProvider>
    </ThemeProvider>
  </SafeAreaProvider>
);
const renderPrompt = (lang: "ru" | "ky" = "ru") => render(promptTree(lang));

const announced = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

beforeEach(() => {
  mockSessionKind = "signedOut";
  mockBarHeight = 52;
  announced.mockClear();
  mockUpdates.isEnabled = true;
  mockUpdates.state = () => ({ isUpdatePending: false });
  mockUpdates.reloadAsync = jest.fn(async () => undefined);
  mockUpdates.check = jest.fn(async () => ({ isAvailable: false }));
  mockUpdates.fetch = jest.fn(async () => ({ isNew: false }));
});

describe("когда карточки нет", () => {
  it("обновлений нет: карточка молчит", async () => {
    await renderPrompt();
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    expect(screen.getByTestId("app-body")).toBeTruthy();
  });

  it("обновления выключены (разработка, Expo Go): молчит, даже если хук что-то вернул", async () => {
    mockUpdates.isEnabled = false;
    mockUpdates.state = () => ({ isUpdatePending: true });
    await renderPrompt();
    expect(screen.queryByTestId("update-prompt")).toBeNull();
  });

  it("обновление найдено, но ещё не скачано: молчит (предлагать перезапуск нечем)", async () => {
    mockUpdates.state = () => ({ isUpdatePending: false, isUpdateAvailable: true } as { isUpdatePending: boolean });
    await renderPrompt();
    expect(screen.queryByTestId("update-prompt")).toBeNull();
  });

  it("сбой хука или отрисовки не роняет приложение: карточки нет, остальное на месте", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mockUpdates.state = () => {
        throw new Error("native module is missing");
      };
      await renderPrompt();
      expect(screen.queryByTestId("update-prompt")).toBeNull();
      expect(screen.getByTestId("app-body")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("обновление скачано", () => {
  beforeEach(() => {
    mockUpdates.state = () => ({ isUpdatePending: true });
  });

  it("карточка с текстом, «Обновить» и «Позже» (RU)", async () => {
    await renderPrompt();
    expect(screen.getByText("Вышла новая версия — обновите приложение.")).toBeTruthy();
    expect(screen.getByText("Обновить")).toBeTruthy();
    expect(screen.getByText("Позже")).toBeTruthy();
    // страница не упоминается: в приложении её нет
    expect(screen.queryByText(/страниц/)).toBeNull();
  });

  it("KY", async () => {
    await renderPrompt("ky");
    expect(screen.getByText("Жаңы версия чыкты — колдонмону жаңыртыңыз.")).toBeTruthy();
    expect(screen.getByText("Жаңыртуу")).toBeTruthy();
    expect(screen.getByText("Кийинчерээк")).toBeTruthy();
  });

  it("«Обновить» перезапускает приложение один раз, двойное нажатие игнорируется", async () => {
    let finish: () => void = () => undefined;
    mockUpdates.reloadAsync = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await renderPrompt();
    await fireEvent.press(screen.getByTestId("update-prompt-reload"));
    await fireEvent.press(screen.getByTestId("update-prompt-reload"));
    expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: true, disabled: true });
    finish();
  });

  it("перезапуск не удался: приложение цело, кнопка снова нажимается", async () => {
    mockUpdates.reloadAsync = jest.fn(async () => {
      throw new Error("reload failed");
    });
    await renderPrompt();
    await fireEvent.press(screen.getByTestId("update-prompt-reload"));
    await waitFor(() => expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: false, disabled: false }));
    await fireEvent.press(screen.getByTestId("update-prompt-reload"));
    expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("app-body")).toBeTruthy();
  });

  it("«Позже» убирает карточку до следующего запуска", async () => {
    await renderPrompt();
    await fireEvent.press(screen.getByTestId("update-prompt-later"));
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
  });

  it("карточка не перехватывает касания остального экрана (обёртка пропускает их)", async () => {
    await renderPrompt();
    expect(screen.getByTestId("update-prompt-host").props.pointerEvents).toBe("box-none");
  });
});

// Рецензия #1568: низкие находки 1б, 1в, 1г и подписка 1а.
describe("карточка обновления: доработки после рецензии", () => {
  beforeEach(() => {
    mockUpdates.state = () => ({ isUpdatePending: true });
  });

  it("(в) появление карточки озвучивается читалке один раз: iOS не слышит живые области", async () => {
    await renderPrompt();
    expect(announced).toHaveBeenCalledTimes(1);
    expect(announced).toHaveBeenCalledWith("Вышла новая версия — обновите приложение.");
  });

  it("(в) пока карточки нет, читалке ничего не говорится; когда обновление скачано, говорится", async () => {
    mockUpdates.state = () => ({ isUpdatePending: false });
    const view = await renderPrompt();
    expect(announced).not.toHaveBeenCalled();
    mockUpdates.state = () => ({ isUpdatePending: true });
    await view.rerender(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <LangProvider initial="ru">
            <UpdatePrompt />
          </LangProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(announced).toHaveBeenCalledTimes(1);
  });

  it("(в) на кыргызском озвучивается кыргызский текст", async () => {
    await renderPrompt("ky");
    expect(announced).toHaveBeenCalledWith("Жаңы версия чыкты — колдонмону жаңыртыңыз.");
  });

  it("(в) у карточки нет живой области: её говорит `announce`, иначе на Android карточка прозвучала бы дважды", async () => {
    await renderPrompt();
    const card = screen.getByTestId("update-prompt");
    expect(card.props.accessibilityRole).toBe("alert");
    expect(card.props.accessibilityLiveRegion).toBe("none");
    expect(announced).toHaveBeenCalledTimes(1);
  });

  describe("(г) карточка не закрывает верхнюю полосу кабинета", () => {
    it("в кабинете (есть полоса) она под полосой: отступ безопасной зоны 47 + полоса 52 + 8", async () => {
      mockSessionKind = "active";
      await renderPrompt();
      expect(screen.getByTestId("update-prompt-host").props.style.top).toBe(47 + 52 + 8);
    });

    it("на экранах без полосы (вход, анкета, шлюз) она у верха безопасной зоны", async () => {
      for (const kind of ["signedOut", "needsApplication", "applicationStatus", "accessPending", "needsConsent"]) {
        mockSessionKind = kind;
        const view = await renderPrompt();
        expect(screen.getByTestId("update-prompt-host").props.style.top).toBe(47 + 8);
        await view.unmount();
      }
    });

    it("высота полосы берётся из общей константы `shell/top-bar-metrics`, а не числом в карточке", async () => {
      mockSessionKind = "active";
      mockBarHeight = 64;
      const view = await renderPrompt();
      expect(TOP_BAR_HEIGHT).toBe(64);
      expect(screen.getByTestId("update-prompt-host").props.style.top).toBe(47 + 64 + 8);
      // без полосы (вход, анкета, шлюз) константа не нужна
      mockSessionKind = "signedOut";
      await view.rerender(promptTree());
      expect(screen.getByTestId("update-prompt-host").props.style.top).toBe(47 + 8);
    });

    it("настоящее значение константы - высота ряда полосы кабинета, 52 (пока полоса держит своё число, `TopBar.tsx`: `height: 52`)", () => {
      expect(jest.requireActual<{ TOP_BAR_HEIGHT: number }>("@/shell/top-bar-metrics").TOP_BAR_HEIGHT).toBe(52);
    });
  });

  describe("(б) кнопка «Обновить» не остаётся занятой", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("перезапуск вернулся, а приложение живо: через 8 секунд кнопка снова нажимается", async () => {
      await renderPrompt();
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: true, disabled: true });
      // восемь секунд записаны числом: правка константы не должна незаметно сдвинуть ожидание
      expect(RELOAD_RESET_MS).toBe(8_000);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(7_999);
      });
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: true, disabled: true });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2);
      });
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: false, disabled: false });
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(2);
    });

    it("перезапуск завис и не вернулся: то же самое через 8 секунд", async () => {
      mockUpdates.reloadAsync = jest.fn(() => new Promise<void>(() => undefined));
      await renderPrompt();
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(8_001);
      });
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: false, disabled: false });
    });

    it("идёт загрузка обновления: кнопка занята, нажатие не ставит перезапуск в очередь за загрузкой", async () => {
      mockUpdates.state = () => ({ isUpdatePending: true, isDownloading: true });
      await renderPrompt();
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: true, disabled: true });
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
    });

    it("идёт перезапуск (`isRestarting`): кнопка занята, нажатие игнорируется", async () => {
      mockUpdates.state = () => ({ isUpdatePending: true, isRestarting: true });
      await renderPrompt();
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: true, disabled: true });
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
    });

    it("перезапуск стоит в очереди за загрузкой: через 8 секунд кнопка остаётся занятой, пока загрузка идёт, и второй перезапуск не ставится", async () => {
      mockUpdates.reloadAsync = jest.fn(() => new Promise<void>(() => undefined));
      const view = await renderPrompt();
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
      // expo-updates сообщает, что идёт загрузка: `reloadAsync` ждёт её и не возвращается
      mockUpdates.state = () => ({ isUpdatePending: true, isDownloading: true });
      await view.rerender(promptTree());
      await act(async () => {
        await jest.advanceTimersByTimeAsync(8_001);
      });
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: true, disabled: true });
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);

      // загрузка закончилась, а перезапуска нет: кнопка снова нажимается
      mockUpdates.state = () => ({ isUpdatePending: true, isDownloading: false });
      await view.rerender(promptTree());
      expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: false, disabled: false });
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(2);
    });

    it("отказ перезапуска возвращает кнопку сразу и снимает таймер", async () => {
      mockUpdates.reloadAsync = jest.fn(async () => {
        throw new Error("reload failed");
      });
      await renderPrompt();
      // у остального экрана таймеров много: следим за тем одним, что ставит карточка на RELOAD_RESET_MS
      const setSpy = jest.spyOn(globalThis, "setTimeout");
      const clearSpy = jest.spyOn(globalThis, "clearTimeout");
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      await waitFor(() => expect(screen.getByTestId("update-prompt-reload").props.accessibilityState).toEqual({ busy: false, disabled: false }));
      const index = setSpy.mock.calls.findIndex(([, delay]) => delay === RELOAD_RESET_MS);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[index]?.value);
    });

    it("при уходе карточки таймер не остаётся висеть", async () => {
      mockUpdates.reloadAsync = jest.fn(() => new Promise<void>(() => undefined));
      const view = await renderPrompt();
      const setSpy = jest.spyOn(globalThis, "setTimeout");
      const clearSpy = jest.spyOn(globalThis, "clearTimeout");
      await fireEvent.press(screen.getByTestId("update-prompt-reload"));
      const index = setSpy.mock.calls.findIndex(([, delay]) => delay === RELOAD_RESET_MS);
      expect(index).toBeGreaterThanOrEqual(0);
      const id = setSpy.mock.results[index]?.value;
      expect(clearSpy).not.toHaveBeenCalledWith(id);
      await view.unmount();
      expect(clearSpy).toHaveBeenCalledWith(id);
    });
  });

  it("(а) карточка следит за возвратом на передний план даже когда обновления ещё нет: через час «active» проверяет и скачивает", async () => {
    mockUpdates.state = () => ({ isUpdatePending: false });
    mockUpdates.check = jest.fn(async () => ({ isAvailable: true }));
    let now = 9_000_000;
    const handlers: ((status: AppStateStatus) => void)[] = [];
    jest.spyOn(Date, "now").mockImplementation(() => now);
    jest.spyOn(AppState, "addEventListener").mockImplementation(((type: string, listener: (status: AppStateStatus) => void) => {
      if (type === "change") handlers.push(listener);
      return { remove: () => undefined };
    }) as never);
    try {
      await renderPrompt();
      now += 61 * 60_000;
      await act(async () => {
        for (const handler of handlers) handler("active");
        await new Promise((resolve) => setImmediate(resolve));
      });
      expect(mockUpdates.check).toHaveBeenCalledTimes(1);
      expect(mockUpdates.fetch).toHaveBeenCalledTimes(1);
      // скачанное показывает уже существующая карточка, у проверки своего интерфейса нет
      expect(screen.queryByTestId("update-prompt")).toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });
});
