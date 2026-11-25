import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { PollFailureNotice } from "@/shell/PollFailureNotice";
import { ThemeProvider } from "@/theme/ThemeProvider";

let mockFailed = false;
const mockRetry = jest.fn();
jest.mock("@/api/PortalPoll", () => ({ usePortalPollFailure: () => ({ failed: mockFailed, retry: mockRetry }) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const renderNotice = (lang: "ru" | "ky" = "ru") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <PollFailureNotice />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockFailed = false;
  mockRetry.mockClear();
});

describe("карточка «Не удалось обновить уведомления» (веб: .pt-notification-error)", () => {
  it("опрос в порядке: карточки нет", async () => {
    await renderNotice();
    expect(screen.queryByTestId("poll-failure")).toBeNull();
  });

  it("сбой: карточка-тревога с текстом веба и «Повторить»; повтор зовёт опрос", async () => {
    mockFailed = true;
    await renderNotice();
    expect(screen.getByTestId("poll-failure").props.accessibilityRole).toBe("alert");
    expect(screen.getByText("Не удалось обновить уведомления.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("poll-failure-retry"));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("встаёт под верхней полосой справа, не шире 320", async () => {
    mockFailed = true;
    await renderNotice();
    const card = screen.getByTestId("poll-failure");
    expect(card.props.style).toMatchObject({ width: 320 });
    // отступ безопасной зоны 47 + полоса 52 + зазор 8
    expect(screen.getByTestId("poll-failure-anchor").props.style).toMatchObject({ position: "absolute", top: 47 + 52 + 8, right: 16 });
  });

  it("кыргызский язык", async () => {
    mockFailed = true;
    await renderNotice("ky");
    expect(screen.getByText("Билдирмелер жаңыртылган жок.")).toBeTruthy();
    expect(screen.getByText("Кайталоо")).toBeTruthy();
  });
});
