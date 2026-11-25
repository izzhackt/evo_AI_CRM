// Вкладка «Входящие» на НАСТОЯЩЕМ expo-router и настоящих раскладках кабинета (`(app)/_layout`, `messages/_layout`), настоящая лента
// «Что нового» и беседа; остальное (список, решение, разделы) - метки. Что проверяется (разбор QA#2, D2):
// - в стек «Входящих» входят и снаружи (колокольчик, ссылка с «Главной», «Написать EVO»): expo-router делает это без якоря,
//   и в стеке один этот экран, списка под ним нет. Студент уходит «назад», а нажатие на «Входящие» открывало ту же ленту, не список;
// - при уходе с вкладки такой стек возвращается к списку, нажатие на уже открытую вкладку тоже ведёт к списку;
// - прямой заход и вход из списка работают как раньше; «Назад» с экрана решения (F9 ревью P2a) не изменилось;
// - стрелка «назад» называется по тому, куда ведёт: «Все чаты» только когда под экраном список;
// - беседа с неотправленным (черновик, сообщение в пути или не ушедшее) при уходе с вкладки НЕ закрывается: сброс унёс бы набранное
//   (ревью #1590); то же при нажатии на уже открытую вкладку «Входящие» (лента или список поверх беседы) и когда в стеке две беседы;
//   беседа без неотправленного сбрасывается к списку, как решено в D2.
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { type ComponentType, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import * as AppLayoutModule from "@/app/(app)/_layout";
import * as MessagesLayoutModule from "@/app/(app)/messages/_layout";
import MessagesChatRoute from "@/app/(app)/messages/chat";
import MessagesUpdatesRoute from "@/app/(app)/messages/updates";
import PreparationsLayout from "@/app/(app)/preparations/_layout";
import { LangProvider } from "@/i18n/LangProvider";
import type { RpcTransport } from "@/lib/rpc";
import { SECTIONS } from "@/shell/sections";
import { holdRpc } from "@/test-fixtures/hold-rpc";
import { MSG_A, MSG_B, POST_RECEIPT, chatMessage, chatPage } from "@/test-fixtures/inbox";
import { failure, fakeTransport } from "@/test-fixtures/universities";
import { ThemeProvider } from "@/theme/ThemeProvider";

// Нужна настоящая обёртка фокуса: уход с вкладки и возврат проверяются на самой навигации.
jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));
const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
const unavailable: RpcTransport = async () => ({ data: null, error: { code: "42883" }, status: 404 });
let mockTransport: RpcTransport = unavailable;
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
/** Список «Входящих»: метка со ссылкой на ленту («Что нового») и строкой беседы, как у настоящего списка (`go` = `router.navigate`). */
function InboxMarker() {
  return (
    <View>
      <Pressable testID="inbox-to-updates" onPress={() => router.navigate("/messages/updates")}>
        <Text testID="route-inbox">список</Text>
      </Pressable>
      <Pressable testID="inbox-to-chat" onPress={() => router.navigate("/messages/chat")}>
        <Text>беседа</Text>
      </Pressable>
    </View>
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

const mount = (url: string, state: unknown = signedIn) => {
  mockSession.state = state;
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
  mockTransport = unavailable;
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

describe("беседа с неотправленным не закрывается сбросом стека «Входящих»: при уходе с вкладки, при нажатии на открытую вкладку, при двух беседах и при отправке в пути (ревью #1590)", () => {
  const FIRST = chatMessage(MSG_A, "11", true, "Здравствуйте", "2026-09-07T08:00:00+00:00");
  const SECOND = chatMessage(MSG_B, "12", false, "Принесите оригинал паспорта", "2026-09-07T08:30:00+00:00");
  const THIRD = chatMessage("a0000000-0000-4000-8000-000000000009", "13", false, "Новое от команды", "2026-09-07T09:00:00+00:00");
  /**
   * Сервер беседы. `post` - ответ на отправку (по умолчанию принимает и кладёт в ленту `reply`, по умолчанию «Новое от команды»);
   * `wrap` оборачивает транспорт (например, придержать отправку).
   */
  function serveChat(options: { post?: unknown; reply?: ReturnType<typeof chatMessage>; wrap?: (inner: RpcTransport) => RpcTransport } = {}) {
    let page = chatPage([SECOND, FIRST]);
    const inner = fakeTransport({
      portal_case_chat_page_v1: () => page,
      mark_own_case_chat_notifications_read_v1: null,
      portal_case_chat_post_v1:
        options.post ??
        ((args: Record<string, unknown> | undefined) => {
          page = chatPage([options.reply ?? THIRD, SECOND, FIRST]);
          return POST_RECEIPT(String(args?.p_request_id), "13");
        }),
    });
    mockTransport = options.wrap ? options.wrap(inner.transport) : inner.transport;
  }
  /** «Написать EVO» с «Главной»: в стеке «Входящих» одна беседа, списка под ней нет. */
  async function openChat(state: unknown = signedIn) {
    const view = await mount("/home", state);
    await act(async () => router.navigate("/messages/chat"));
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    await screen.findByText("Здравствуйте");
    return view;
  }
  const typeIntoChat = (text: string) => fireEvent.changeText(screen.getByTestId("chat-input"), text);
  const backHomeAndReturn = async () => {
    await press("chat-back");
    await waitFor(() => expect(visible("route-home")).toBe(true));
    await press("tab-messages");
  };

  it("черновик: «назад» на «Главную», затем вкладка «Входящие» - та же беседа и черновик в поле, а не пустой список", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Добрый день, у меня вопрос по визе");
    await backHomeAndReturn();
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-input").props.value).toBe("Добрый день, у меня вопрос по визе");
  });

  it("черновик: студент ушёл на другую вкладку (не «назад», например из меню ☰) и вернулся - беседа и черновик на месте", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Письмо, которое ещё не дописано");
    await act(async () => router.navigate("/documents"));
    await waitFor(() => expect(visible("route-documents")).toBe(true));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-input").props.value).toBe("Письмо, которое ещё не дописано");
  });

  it("сообщение не ушло (сбой отправки): после ухода и возврата оно в ленте с «Повторить», а не пропало", async () => {
    serveChat({ post: failure("42501", 403) });
    await openChat();
    await typeIntoChat("Это не отправилось");
    await press("chat-send");
    await screen.findByTestId("outbox-failed");
    await backHomeAndReturn();
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("outbox-failed")).toBeTruthy();
    expect(screen.getByText("Это не отправилось")).toBeTruthy();
    expect(screen.getByTestId("chat-retry")).toBeTruthy();
  });

  it("отправлено (поле и очередь пусты): беседа без неотправленного сбрасывается к списку, как решено в D2", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Привет, вот скан");
    await press("chat-send");
    await screen.findByText("Новое от команды");
    await waitFor(() => expect(screen.queryByTestId("outbox-sending")).toBeNull());
    expect(screen.getByTestId("chat-input").props.value).toBe("");
    await backHomeAndReturn();
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("в поле остались одни пробелы (текст стёрли): это не черновик, беседа сбрасывается к списку", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Начал писать");
    await typeIntoChat("   ");
    await backHomeAndReturn();
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("другой студент на том же устройстве: чужого черновика у него нет, а его беседа без черновика сбрасывается к списку", async () => {
    serveChat();
    const first = await openChat();
    await typeIntoChat("Личное письмо первого студента");
    await first.unmount(); // выход: кабинет закрыт вместе с беседой
    const second = { ...signedIn, session: { ...signedIn.session, authority: { ...signedIn.session.authority, authUserId: "student-b" } } };
    await openChat(second);
    expect(screen.getByTestId("chat-input").props.value).toBe("");
    await backHomeAndReturn();
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("путь A: черновик, затем колокольчик (лента поверх беседы): нажатие на открытую вкладку «Входящие» ничего не меняет, «назад» из ленты возвращает беседу с черновиком", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Черновик под лентой");
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    await press("tab-messages"); // вкладка уже открыта: возврат к списку закрыл бы беседу и унёс черновик
    expect(shown()).toBe("updates-screen");
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-input").props.value).toBe("Черновик под лентой");
  });

  it("путь B: черновик, затем ☰ «Входящие» (список поверх беседы): нажатие на открытую вкладку не закрывает беседу, «назад» возвращает её с черновиком", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Черновик под списком");
    await act(async () => router.navigate("/messages")); // пункт ☰ «Входящие»
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await press("tab-messages");
    expect(shown()).toBe("route-inbox");
    await act(async () => router.back());
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-input").props.value).toBe("Черновик под списком");
  });

  it("беседа без неотправленного под лентой: нажатие на открытую вкладку по-прежнему возвращает к списку (D2)", async () => {
    serveChat();
    await openChat();
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("две беседы в стеке (☰ «Входящие», затем строка беседы в списке): во второй написали и стёрли - черновик первой остаётся, уход с вкладки не закрывает ни одну", async () => {
    serveChat();
    await openChat();
    await typeIntoChat("Черновик первой беседы");
    await act(async () => router.navigate("/messages")); // [беседа, список]
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await press("inbox-to-chat"); // [беседа, список, беседа]
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-input").props.value).toBe(""); // это вторая беседа
    await typeIntoChat("Второй черновик");
    await typeIntoChat(""); // стёрли: у второй неотправленного нет, у первой есть
    await act(async () => router.navigate("/documents"));
    await waitFor(() => expect(visible("route-documents")).toBe(true));
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("chat-screen")); // стек не сброшен
    await act(async () => router.back()); // вторая беседа -> список
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await act(async () => router.back()); // список -> первая беседа
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(screen.getByTestId("chat-input").props.value).toBe("Черновик первой беседы");
  });

  it("отправка в пути («Отправляем…»): уход с вкладки беседу не закрывает; отправка закончилась без студента - при возврате беседа и сообщение на месте, следующий уход сбрасывает к списку", async () => {
    const SENT = chatMessage("a0000000-0000-4000-8000-00000000000a", "13", true, "Отправляю при выходе", "2026-09-07T09:00:00+00:00");
    const gate: { held: ReturnType<typeof holdRpc> | null } = { held: null };
    serveChat({
      reply: SENT,
      wrap: (inner) => {
        gate.held = holdRpc(inner, "portal_case_chat_post_v1");
        return gate.held.transport;
      },
    });
    await openChat();
    gate.held!.hold(); // отправка зависает на сервере
    await typeIntoChat("Отправляю при выходе");
    await press("chat-send");
    await screen.findByTestId("outbox-sending");
    await act(async () => router.navigate("/documents")); // ушли, пока отправка в пути
    await waitFor(() => expect(visible("route-documents")).toBe(true));
    await act(async () => gate.held!.release()); // отправка закончилась, пока беседа под другой вкладкой
    await press("tab-messages");
    await waitFor(() => expect(shown()).toBe("chat-screen")); // беседа не сброшена к списку
    expect(screen.getByTestId("chat-back").props.accessibilityLabel).toBe("Назад"); // в стеке одна беседа, списка под ней нет
    await waitFor(() => expect(screen.queryByTestId("outbox-sending")).toBeNull());
    expect(screen.getAllByText("Отправляю при выходе")).toHaveLength(1);
    await backHomeAndReturn(); // теперь неотправленного нет
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });
});
