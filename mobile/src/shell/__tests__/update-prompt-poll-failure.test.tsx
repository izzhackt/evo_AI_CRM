// Две карточки в одном углу кабинета: «Вышла новая версия» (features/app/UpdatePrompt) и «Не удалось обновить уведомления»
// (shell/PollFailureNotice). Вторая уступает первой, пока та ВИДНА; после «Позже» обновление остаётся скачанным до перезапуска,
// но карточки обновления уже нет, и сбой опроса показывается (разбор ревью #1565). Обе настоящие, `expo-updates` и сессия заменены.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { UpdatePrompt } from "@/features/app/UpdatePrompt";
import { LangProvider } from "@/i18n/LangProvider";
import { PollFailureNotice } from "@/shell/PollFailureNotice";
import { ThemeProvider } from "@/theme/ThemeProvider";

let mockFailed = true;
jest.mock("@/api/PortalPoll", () => ({ usePortalPollFailure: () => ({ failed: mockFailed, retry: jest.fn() }) }));
let mockPending = true;
jest.mock("expo-updates", () => ({
  __esModule: true,
  isEnabled: true,
  useUpdates: () => ({ isUpdatePending: mockPending }),
  reloadAsync: jest.fn(async () => undefined),
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(async () => ({ isNew: false })),
}));
jest.mock("@/session/SessionProvider", () => ({ useSession: () => ({ state: { kind: "active" } }) }));

const announce = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const tree = (showPrompt: boolean) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <ThemeProvider>
      <LangProvider initial="ru">
        {showPrompt ? <UpdatePrompt /> : null}
        <PollFailureNotice />
      </LangProvider>
    </ThemeProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  mockFailed = true;
  mockPending = true;
  announce.mockClear();
});

describe("карточка обновления и карточка сбоя опроса", () => {
  it("обновление скачано и опрос не удался: на виду карточка обновления, карточки сбоя нет", async () => {
    await render(tree(true));
    expect(screen.getByTestId("update-prompt")).toBeTruthy();
    expect(screen.queryByTestId("poll-failure")).toBeNull();
  });

  it("«Позже»: карточки обновления нет, обновление всё ещё скачано, сбой опроса показывается и читается вслух", async () => {
    await render(tree(true));
    await fireEvent.press(screen.getByTestId("update-prompt-later"));
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    expect(mockPending).toBe(true); // скачано до перезапуска: карточка сбоя не должна прятаться за скачанным обновлением
    expect(screen.getByTestId("poll-failure")).toBeTruthy();
    expect(announce).toHaveBeenCalledWith("Не удалось обновить уведомления.");
  });

  it("карточка обновления ушла (размонтирована, не «Позже»): карточка сбоя показывается", async () => {
    const view = await render(tree(true));
    expect(screen.queryByTestId("poll-failure")).toBeNull();
    await act(async () => view.rerender(tree(false)));
    expect(screen.getByTestId("poll-failure")).toBeTruthy();
  });

  it("обновления нет: только карточка сбоя", async () => {
    mockPending = false;
    await render(tree(true));
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    expect(screen.getByTestId("poll-failure")).toBeTruthy();
  });
});
