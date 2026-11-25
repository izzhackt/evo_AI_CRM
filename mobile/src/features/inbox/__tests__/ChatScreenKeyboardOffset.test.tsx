// Чат: смещение клавиатуры на iPhone равно отступу безопасной зоны плюс высота верхней полосы кабинета. Высота берётся из общей меры
// `shell/top-bar-metrics`, а не своим числом (разбор ревью #1566): тест подменяет меру и видит, что экран идёт за ней.
import { screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import { ChatScreen } from "@/features/inbox/ChatScreen";
import { reportTopNoticeHeight } from "@/shell/top-chrome";
import { MSG_A, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn() },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
  useNavigation: () => ({ getState: () => ({ index: 1, routes: [{ name: "index" }, { name: "chat" }] }) }),
  usePathname: () => "/messages/chat",
}));
jest.mock("@/features/inbox/visibility", () => ({ useScreenVisible: jest.fn(() => true) }));
// Настоящий `KeyboardAvoidingView` в дереве испытаний не виден (только его вложенный `View`), поэтому заменён: он отдаёт смещение наружу
// обычным свойством.
jest.mock("react-native/Libraries/Components/Keyboard/KeyboardAvoidingView", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => React.createElement(View, props as never, children),
  };
});
let mockBarHeight = 52;
jest.mock("@/shell/top-bar-metrics", () => ({
  get TOP_BAR_HEIGHT() {
    return mockBarHeight;
  },
}));

afterEach(() => reportTopNoticeHeight(0));

describe("Чат: смещение клавиатуры", () => {
  it("iPhone: отступ безопасной зоны (47) + общая мера высоты верхней полосы, а не число в экране", async () => {
    mockBarHeight = 64;
    const { transport } = fakeTransport({ portal_case_chat_page_v1: chatPage([chatMessage(MSG_A, "11", false, "Здравствуйте")]), mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    expect(Platform.OS).toBe("ios");
    expect((await screen.findByTestId("chat-screen")).props.keyboardVerticalOffset).toBe(47 + 64);
  });

  it("карточка «Не удалось обновить уведомления» стоит в потоке над экраном: её высота входит в смещение (иначе поле ввода остаётся под клавиатурой)", async () => {
    mockBarHeight = 64;
    reportTopNoticeHeight(60);
    const { transport } = fakeTransport({ portal_case_chat_page_v1: chatPage([chatMessage(MSG_A, "11", false, "Здравствуйте")]), mark_own_case_chat_notifications_read_v1: null });
    await renderPortal(<ChatScreen />, testApi(transport));
    expect((await screen.findByTestId("chat-screen")).props.keyboardVerticalOffset).toBe(47 + 64 + 60);
  });
});
