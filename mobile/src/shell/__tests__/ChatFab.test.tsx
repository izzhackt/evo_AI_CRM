import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PortalApiProvider } from "@/api/PortalApi";
import { LangProvider } from "@/i18n/LangProvider";
import { ChatFab } from "@/shell/ChatFab";
import { CHAT_FAB_GAP, CHAT_FAB_SIZE, TAB_BAR_BODY, chatFabBottom, chatFabVisible, isConversationPath } from "@/shell/chat-fab-rules";
import { reportTabBarHeight } from "@/shell/tab-bar-metrics";
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
    expect(chatFabVisible("assisted", "/messages/updates")).toBe(false);
    // экраны решения (веб: /portal/notifications/..., /portal/document-notifications/..., /portal/package-notifications/...) вне
    // /portal/messages, и кнопка на них есть: прочитав ответ куратора, студент пишет команде оттуда
    expect(chatFabVisible("assisted", "/messages/reply/66666666-6666-4666-8666-666666666666")).toBe(true);
    expect(chatFabVisible("assisted", "/messages/document-decision/66666666-6666-4666-8666-666666666666")).toBe(true);
    expect(chatFabVisible("assisted", "/messages/package-decision/66666666-6666-4666-8666-666666666666")).toBe(true);
    expect(chatFabVisible("approved", "/messages/reply/66666666-6666-4666-8666-666666666666")).toBe(false);
    expect(chatFabVisible("assisted", "/professions")).toBe(true);
    expect(chatFabVisible("assisted", "/professions/evi")).toBe(false);
    expect(chatFabVisible("approved", "/home")).toBe(false);
  });

  it("над настоящим верхом панели: высота, которую панель измерила сама, поднимает кнопку; меньше обычной не бывает", () => {
    expect(chatFabBottom("assisted", 34, 62)).toBe(34 + 62 + CHAT_FAB_GAP);
    expect(chatFabBottom("assisted", 34, 90)).toBe(34 + 90 + CHAT_FAB_GAP); // панель выше обычной: кнопка выше
    expect(chatFabBottom("assisted", 34, 40)).toBe(34 + TAB_BAR_BODY + CHAT_FAB_GAP); // ниже обычной не опускаемся
    expect(chatFabBottom("assisted", 34, 0)).toBe(34 + TAB_BAR_BODY + CHAT_FAB_GAP); // ещё не измерена
    expect(chatFabBottom("assisted", 34, Number.NaN)).toBe(34 + TAB_BAR_BODY + CHAT_FAB_GAP);
    expect(chatFabBottom("approved", 34, 120)).toBe(34 + CHAT_FAB_GAP); // без панели измерение ничего не значит
  });

  it("кнопка никогда не ниже верха панели плюс зазор: кружок «Входящих» внутри панели ею не закрыт ни при какой высоте панели", () => {
    for (const bar of [40, 62, 70, 84, 100, 140]) {
      for (const safeBottom of [0, 12, 34]) {
        const edge = Math.max(safeBottom, 12);
        const barTop = edge + Math.max(bar, TAB_BAR_BODY); // верх панели от низа экрана
        expect(chatFabBottom("assisted", safeBottom, bar)).toBeGreaterThanOrEqual(barTop + CHAT_FAB_GAP);
      }
    }
  });

  it("беседы без панели вкладок: с командой и с Эви", () => {
    expect(isConversationPath("/messages/chat")).toBe(true);
    expect(isConversationPath("/professions/evi")).toBe(true);
    expect(isConversationPath("/professions")).toBe(false);
    expect(isConversationPath("/professions/evi/x")).toBe(false);
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

  describe("кнопка в оболочке читает высоту панели", () => {
    afterEach(() => reportTabBarHeight(0));

    it("панель не измерена: обычная высота; измерена выше: кнопка поднимается над ней; панель ушла: снова обычная", async () => {
      const anchor = () => screen.getByTestId("chat-fab-anchor").props.style as { bottom: number };
      await renderFab("assisted");
      expect(anchor().bottom).toBe(34 + TAB_BAR_BODY + CHAT_FAB_GAP);
      await act(async () => reportTabBarHeight(96));
      expect(anchor().bottom).toBe(34 + 96 + CHAT_FAB_GAP);
      await act(async () => reportTabBarHeight(0));
      expect(anchor().bottom).toBe(34 + TAB_BAR_BODY + CHAT_FAB_GAP);
      expect(CHAT_FAB_SIZE).toBe(52); // размер кнопки не зависит от панели
    });
  });
});
