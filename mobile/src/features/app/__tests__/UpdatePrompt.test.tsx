// Предложение обновиться (G4 аудита паритета 25.11.2026): карточка «Вышла новая версия» только когда обновление скачано и
// обновления включены; молчит без обновлений, в разработке и при любом сбое. Настоящий `expo-updates` заменён: путь OTA в
// приложении ещё ни разу не проходился до конца.
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text as RNText } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { UpdatePrompt } from "@/features/app/UpdatePrompt";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

const mockUpdates: { isEnabled: boolean; state: () => { isUpdatePending: boolean }; reloadAsync: jest.Mock } = {
  isEnabled: true,
  state: () => ({ isUpdatePending: false }),
  reloadAsync: jest.fn(async () => undefined),
};
jest.mock("expo-updates", () => ({
  __esModule: true,
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  useUpdates: () => mockUpdates.state(),
  reloadAsync: (...args: unknown[]) => mockUpdates.reloadAsync(...args),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderPrompt = (lang: "ru" | "ky" = "ru") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <RNText testID="app-body">приложение</RNText>
          <UpdatePrompt />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockUpdates.isEnabled = true;
  mockUpdates.state = () => ({ isUpdatePending: false });
  mockUpdates.reloadAsync = jest.fn(async () => undefined);
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
