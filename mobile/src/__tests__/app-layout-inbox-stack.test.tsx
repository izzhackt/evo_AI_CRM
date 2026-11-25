// Вкладка «Входящие» на НАСТОЯЩЕМ expo-router и настоящих раскладках кабинета (`(app)/_layout`, `messages/_layout`), настоящая лента
// «Что нового» и беседа; остальное (список, решение, разделы) - метки. Что проверяется (разбор QA#2, D2):
// - в стек «Входящих» входят и снаружи (колокольчик, ссылка с «Главной», «Написать EVO»): expo-router делает это без якоря,
//   и в стеке один этот экран, списка под ним нет. Студент уходит «назад», а нажатие на «Входящие» открывало ту же ленту, не список;
// - при уходе с вкладки такой стек возвращается к списку, нажатие на уже открытую вкладку тоже ведёт к списку;
// - прямой заход и вход из списка работают как раньше; «Назад» с экрана решения (F9 ревью P2a) не изменилось;
// - стрелка «назад» называется по тому, куда ведёт: «Все чаты» только когда под экраном список.
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { type ComponentType, type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import * as AppLayoutModule from "@/app/(app)/_layout";
import * as MessagesLayoutModule from "@/app/(app)/messages/_layout";
import MessagesChatRoute from "@/app/(app)/messages/chat";
import MessagesUpdatesRoute from "@/app/(app)/messages/updates";
import PreparationsLayout from "@/app/(app)/preparations/_layout";
import { LangProvider } from "@/i18n/LangProvider";
import type { RpcTransport } from "@/lib/rpc";
import { SECTIONS } from "@/shell/sections";
import { ThemeProvider } from "@/theme/ThemeProvider";

// Нужна настоящая обёртка фокуса: уход с вкладки и возврат проверяются на самой навигации.
jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));
const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
const mockTransport: RpcTransport = async () => ({ data: null, error: { code: "42883" }, status: 404 });
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "https://portal.example.test" }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => (...args: Parameters<RpcTransport>) => mockTransport(...args) }));
jest.mock("@/api/PortalPoll", () => ({
  PortalPoll: ({ children }: { children: unknown }) => children,
  usePortalUnread: () => 0,
  usePokePoll: () => () => undefined,
  usePortalPollFailure: () => ({ failed: false, retry: () => undefined }),
}));
jest.mock("@/features/universities/IndexWarmup", () => ({ UniversityIndexWarmup: () => null }));
jest.mock("@/features/learning/csca/useCscaAccess", () => ({ useCscaAccess: () => ({ available: false }) }));
jest.mock("@/shell/ChatFab", () => ({ ChatFab: () => null }));
jest.mock("@/shell/MenuSheet", () => ({ MenuSheet: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">{children}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const signedIn = {
  kind: "active",
  session: {
    authority: { authUserId: "student-a", profileId: "p", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Тест Студентов", platformRole: "student", platformAccessVersion: 1 },
    portalCase: { id: "33333333-3333-4333-8333-333333333333", studentDisplayName: "Тест Студентов", targetCountry: null, caseState: "active", portalActivatedAt: "2026-11-01T00:00:00Z" },
    tier: "assisted",
  },
};

const marker = (name: string) =>
  function Marker() {
    return <Text testID={`route-${name}`}>{name}</Text>;
  };
/** Экран решения: метка со своей стрелкой «назад» (как у настоящих экранов решения: `router.back()`). */
function ReplyMarker() {
  return (
    <Pressable testID="reply-back" onPress={() => router.back()}>
      <Text testID="route-reply">решение</Text>
    </Pressable>
  );
}
/** Список «Входящих»: метка со ссылкой на ленту, как карточка «Что нового» настоящего списка. */
function InboxMarker() {
  return (
    <Pressable testID="inbox-to-updates" onPress={() => router.navigate("/messages/updates")}>
      <Text testID="route-inbox">список</Text>
    </Pressable>
  );
}

type Mod = ComponentType | Record<string, unknown>;
function files(): Record<string, Mod> {
  return {
    "(app)/_layout": AppLayoutModule as unknown as Mod,
    ...Object.fromEntries(SECTIONS.filter((section) => section.id !== "messages").map((section) => [`(app)/${section.id}`, marker(section.id)])),
    "(app)/application": marker("application"),
    "(app)/preparations/_layout": PreparationsLayout,
    "(app)/preparations/[applicationId]": marker("preparations"),
    "(app)/preparations/recovery": marker("recovery"),
    "(app)/messages/_layout": MessagesLayoutModule as unknown as Mod,
    "(app)/messages/index": InboxMarker,
    "(app)/messages/updates": MessagesUpdatesRoute,
    "(app)/messages/chat": MessagesChatRoute,
    "(app)/messages/reply/[notificationId]": ReplyMarker,
  };
}

const mount = (url: string) => {
  mockSession.state = signedIn;
  return renderRouter(files() as never, { initialUrl: url, wrapper: Wrapper });
};
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const visible = (testID: string) => screen.queryByTestId(testID) !== null;

/** Какой экран «Входящих» или «Главной» на виду (по одному на проверку: остальные не показаны). */
function shown(): string {
  return ["route-home", "route-inbox", "updates-screen", "chat-screen", "route-reply"].filter(visible).join(",");
}
const bell = () => screen.findByTestId("notification-bell");

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("вкладка «Входящие» после входа снаружи (QA#2, D2)", () => {
  it("колокольчик на «Главной» → лента → «назад» на «Главную» → вкладка «Входящие» открывает СПИСОК, а не ленту", async () => {
    await mount("/home");
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(screen.getByTestId("updates-back").props.accessibilityLabel).toBe("Назад"); // под лентой списка нет: «назад» ведёт, откуда пришли
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-home"));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("лента из колокольчика, студент уходит на другую вкладку (не «назад»): «Входящие» всё равно открывают список", async () => {
    await mount("/home");
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    await press("tab-documents");
    await waitFor(() => expect(screen.queryByTestId("route-documents")).not.toBeNull());
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("глубже: лента из колокольчика → решение из ленты → другая вкладка: «Входящие» открывают список, а не решение", async () => {
    await mount("/home");
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    await act(async () => router.navigate("/messages/reply/66666666-6666-4666-8666-666666666666")); // строка ленты ведёт на экран решения
    await waitFor(() => expect(shown()).toBe("route-reply"));
    await press("tab-documents");
    await waitFor(() => expect(screen.queryByTestId("route-documents")).not.toBeNull());
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("нажатие на уже открытую вкладку «Входящие» возвращает из ленты, открытой колокольчиком, к списку", async () => {
    await mount("/home");
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("беседа снаружи («Написать EVO» с «Главной»): «назад» ведёт на «Главную», а вкладка «Входящие» потом открывает список", async () => {
    await mount("/home");
    await act(async () => router.navigate("/messages/chat"));
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-back").props.accessibilityLabel).toBe("Назад");
    await press("chat-back");
    await waitFor(() => expect(shown()).toBe("route-home"));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });
});

describe("прямой заход и вход из списка не изменились", () => {
  it("«Входящие» с «Главной» → список; из списка в ленту: «Все чаты», а стрелка возвращает в список", async () => {
    await mount("/home");
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await press("inbox-to-updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(screen.getByTestId("updates-back").props.accessibilityLabel).toBe("Все чаты");
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("лента, открытая из списка, при уходе на другую вкладку остаётся: стек с настоящим основанием вкладка помнит", async () => {
    await mount("/home");
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await press("inbox-to-updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    await press("tab-documents");
    await waitFor(() => expect(screen.queryByTestId("route-documents")).not.toBeNull());
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
  });

  it("открытие по ссылке с нуля (холодный старт): под лентой лежит список, «назад» ведёт в него", async () => {
    await mount("/messages/updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(screen.getByTestId("updates-back").props.accessibilityLabel).toBe("Все чаты");
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });
});

describe("экран решения с «Главной» (F9 ревью P2a): «назад» прежнее", () => {
  it("вкладку «Входящие» ещё не открывали: решение → «назад» на «Главную»; вкладка потом открывает список, а не решение", async () => {
    await mount("/home");
    await act(async () => router.navigate("/messages/reply/66666666-6666-4666-8666-666666666666"));
    await waitFor(() => expect(shown()).toBe("route-reply"));
    await press("reply-back");
    await waitFor(() => expect(shown()).toBe("route-home"));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("вкладку уже открывали (список в стеке): решение ложится поверх списка, «назад» ведёт в список", async () => {
    await mount("/home");
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await press("tab-home");
    await waitFor(() => expect(shown()).toBe("route-home"));
    await act(async () => router.navigate("/messages/reply/66666666-6666-4666-8666-666666666666"));
    await waitFor(() => expect(shown()).toBe("route-reply"));
    await press("reply-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });
});
