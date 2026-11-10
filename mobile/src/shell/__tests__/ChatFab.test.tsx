import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PortalApiProvider } from "@/api/PortalApi";
import { LangProvider } from "@/i18n/LangProvider";
import { ChatFab } from "@/shell/ChatFab";
import { CHAT_FAB_GAP, TAB_BAR_BODY, chatFabBottom, chatFabVisible } from "@/shell/chat-fab-rules";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { testApi } from "@/test-fixtures/render";

const mockNavigate = jest.fn();
let mockPathname = "/home";
jest.mock("expo-router", () => ({ usePathname: () => mockPathname, router: { navigate: (...args: unknown[]) => mockNavigate(...args) } }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderFab(tier: "approved" | "assisted", lang: "ru" | "ky" = "ru") {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <PortalApiProvider api={testApi(async () => ({ data: null, error: null, status: 200 }), { tier })}>
            <ChatFab />
          </PortalApiProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("плавающая кнопка «Написать EVO»", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockPathname = "/home";
  });

  it("правила показа: только assisted, не на «Входящих» и не в беседе", () => {
    expect(chatFabVisible("assisted", "/home")).toBe(true);
    expect(chatFabVisible("assisted", "/universities/abc")).toBe(true);
    expect(chatFabVisible("assisted", "/messages")).toBe(false);
    expect(chatFabVisible("assisted", "/messages/chat")).toBe(false);
    expect(chatFabVisible("approved", "/home")).toBe(false);
  });

  it("встаёт над панелью вкладок и безопасной зоной; без панели - просто над краем", () => {
    expect(chatFabBottom("assisted", 34)).toBe(34 + TAB_BAR_BODY + CHAT_FAB_GAP);
    expect(chatFabBottom("assisted", 0)).toBe(12 + TAB_BAR_BODY + CHAT_FAB_GAP);
    expect(chatFabBottom("approved", 34)).toBe(34 + CHAT_FAB_GAP);
  });

  it("имя «Написать EVO» и переход в беседу; кыргызское имя", async () => {
    await renderFab("assisted");
    const button = screen.getByLabelText("Написать EVO");
    await fireEvent.press(button);
    expect(mockNavigate).toHaveBeenCalledWith("/messages/chat");
  });

  it("KY: доступное имя на кыргызском", async () => {
    await renderFab("assisted", "ky");
    expect(screen.getByTestId("chat-fab").props.accessibilityLabel).toBe("EVO'го жазуу");
  });

  it("на «Входящих» и у approved кнопки нет", async () => {
    mockPathname = "/messages";
    await renderFab("assisted");
    expect(screen.queryByTestId("chat-fab")).toBeNull();
  });
});
