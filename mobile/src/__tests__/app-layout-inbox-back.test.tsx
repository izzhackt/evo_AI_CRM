// Стрелка «назад» на ленте «Что нового» и в беседе на НАСТОЯЩЕМ expo-router, настоящих раскладках кабинета (`(app)/_layout`,
// `messages/_layout`), настоящих экранах ленты и беседы и настоящем `useInboxBack` (QA#3, N3: на устройстве подпись всегда была
// «Назад», в том числе при входе из списка, где она должна быть «Все чаты»). Остальное (список, решение, разделы) - метки.
//
// Почему проверяется КАЖДЫЙ кадр экрана, а не только подпись на экране в конце. В expo-router 58 `navigation.getState()` в кадре,
// где экран кладут в стек, отдаёт состояние прошлой отрисовки (списка под экраном «ещё нет»), а со следующего кадра - верное.
// Приложение собирается с компилятором React и запоминает первое чтение навсегда; в Jest компилятора нет, следующий кадр успевает
// поправить подпись, и проверка «подпись на экране» проходила на неисправном коде. Верное правило поэтому: НИ ОДИН кадр экрана
// не показывает подпись, которой у него быть не должно. `useInboxBack` обёрнут только записью отданных подписей, логика его
// настоящая; состояние навигации не подменяется нигде (прежние проверки на подменённом `getState()` убраны: они и пропустили ошибку).
// Второй блок (по независимому ревью #1602): подпись остаётся верной, пока лента на месте. Её кладёт поверх другой экран (читается
// ключ СВОЕГО маршрута, а не «фокусного»), меняют язык, заменяют экран под ней (подпись следует за стеком, а не замёрзла на первом
// кадре). Последний блок - запасная ветка «назад некуда» на настоящем роутере из одних стеков.
import { router, Stack, useNavigation, useRoute } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { type ComponentType, type ReactNode, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import * as AppLayoutModule from "@/app/(app)/_layout";
import * as MessagesLayoutModule from "@/app/(app)/messages/_layout";
import MessagesChatRoute from "@/app/(app)/messages/chat";
import MessagesUpdatesRoute from "@/app/(app)/messages/updates";
import PreparationsLayout from "@/app/(app)/preparations/_layout";
import { useInboxBack } from "@/features/inbox/useInboxBack";
import { LangProvider, useLang } from "@/i18n/LangProvider";
import type { Lang } from "@/i18n";
import type { RpcTransport } from "@/lib/rpc";
import { SECTIONS } from "@/shell/sections";
import { ThemeProvider } from "@/theme/ThemeProvider";

// Нужна настоящая обёртка фокуса: уход с вкладки и возврат проверяются на самой навигации.
jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));
const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
const mockUnavailable: RpcTransport = async () => ({ data: null, error: { code: "42883" }, status: 404 });
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "https://portal.example.test" }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => (...args: Parameters<RpcTransport>) => mockUnavailable(...args) }));
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

// Подписи, которые настоящий `useInboxBack` отдал экранам с последнего сброса: по записи на каждый кадр каждого экрана.
const mockRendered: string[] = [];
jest.mock("@/features/inbox/useInboxBack", () => {
  const actual = jest.requireActual<typeof import("@/features/inbox/useInboxBack")>("@/features/inbox/useInboxBack");
  return {
    useInboxBack: () => {
      const back = actual.useInboxBack();
      mockRendered.push(back.label);
      return back;
    },
  };
});
/** Какие подписи вообще были в кадрах (без повторов): должна быть ровно одна, верная с первого кадра. */
const framesSince = () => [...new Set(mockRendered)];
const forgetFrames = () => {
  mockRendered.length = 0;
};

/** Даёт тесту сменить язык, пока экран на месте (запись во внешнюю переменную только в эффекте: правило react-hooks/globals). */
let switchLang: ((lang: Lang) => void) | null = null;
function LangProbe() {
  const { setLang } = useLang();
  useEffect(() => {
    switchLang = setLang;
  }, [setLang]);
  return null;
}
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children, lang }: { children: ReactNode; lang: Lang }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <LangProbe />
          {children}
        </LangProvider>
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

const REPLY = "/messages/reply/66666666-6666-4666-8666-666666666666";
const marker = (name: string) =>
  function Marker() {
    return <Text testID={`route-${name}`}>{name}</Text>;
  };
/** Экран решения: метка (его настоящая рамка с собственной стрелкой здесь не нужна). */
const stackHandle: { dispatch: (action: unknown) => void; stackKey: string; routeKey: string } = { dispatch: () => undefined, stackKey: "", routeKey: "" };
function ReplyMarker() {
  const navigation = useNavigation();
  const { key } = useRoute();
  // Ручка стека, чтобы тест мог заменить экран под лентой (как `useRestoreInboxRoot`): запись во внешнюю переменную только в эффекте.
  useEffect(() => {
    stackHandle.dispatch = (action) => navigation.dispatch(action as never);
    stackHandle.stackKey = navigation.getState()?.key ?? "";
    stackHandle.routeKey = key;
  }, [navigation, key]);
  return <Text testID="route-reply">решение</Text>;
}
/** Список «Входящих»: метка с двумя строками, как у настоящего списка: «Что нового» и беседа (`go` = `router.navigate`). */
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

const mount = (url: string, lang: Lang = "ru") => {
  mockSession.state = signedIn;
  return renderRouter(files() as never, { initialUrl: url, wrapper: ({ children }: { children: ReactNode }) => <Wrapper lang={lang}>{children}</Wrapper> });
};
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const visible = (testID: string) => screen.queryByTestId(testID) !== null;
const labelOf = (testID: string) => screen.getByTestId(testID).props.accessibilityLabel;
/** Какой экран «Входящих» или «Главной» на виду (по одному на проверку: остальные не показаны). */
const shown = () => ["route-home", "route-inbox", "updates-screen", "chat-screen", "route-reply"].filter(visible).join(",");
const bell = () => screen.findByTestId("notification-bell");
/** «Входящие» с «Главной»: в стеке настоящее основание - список. */
async function openList(lang: Lang = "ru") {
  await mount("/home", lang);
  await press("tab-messages");
  await waitFor(() => expect(shown()).toBe("route-inbox"));
}

beforeEach(() => {
  forgetFrames();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear(); // язык, выбранный в тесте, хранится на устройстве: упавший тест не должен оставить его следующим
});

describe("лента «Что нового»: подпись стрелки верна с первого кадра", () => {
  it("колокольчик на «Главной»: под лентой списка нет - «Назад», и стрелка ведёт на «Главную»", async () => {
    await mount("/home");
    forgetFrames();
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(framesSince()).toEqual(["Назад"]);
    expect(labelOf("updates-back")).toBe("Назад");
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-home"));
  });

  it("строка «Что нового» в списке: под лентой список - «Все чаты» с самого первого кадра, и стрелка ведёт в список", async () => {
    await openList();
    forgetFrames();
    await press("inbox-to-updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(framesSince()).toEqual(["Все чаты"]);
    expect(labelOf("updates-back")).toBe("Все чаты");
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("открытие по ссылке с нуля (холодный старт): под лентой лежит список - «Все чаты», стрелка ведёт в него", async () => {
    await mount("/messages/updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(framesSince()).toEqual(["Все чаты"]);
    expect(labelOf("updates-back")).toBe("Все чаты");
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });

  it("под лентой не список, а экран решения: «Назад», и стрелка ведёт на этот экран", async () => {
    await mount("/home");
    await act(async () => router.navigate(REPLY));
    await waitFor(() => expect(shown()).toBe("route-reply"));
    forgetFrames();
    await act(async () => router.navigate("/messages/updates"));
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(framesSince()).toEqual(["Назад"]);
    await press("updates-back");
    await waitFor(() => expect(shown()).toBe("route-reply"));
  });

  it("кыргызский язык, слова из общего словаря: из списка «Бардык маектер», с колокольчика «Артка»", async () => {
    await openList("ky");
    forgetFrames();
    await press("inbox-to-updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(framesSince()).toEqual(["Бардык маектер"]);
    expect(labelOf("updates-back")).toBe("Бардык маектер");
  });

  it("кыргызский язык, вход с колокольчика: «Артка»", async () => {
    await mount("/home", "ky");
    forgetFrames();
    await fireEvent.press(await bell());
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(framesSince()).toEqual(["Артка"]);
    expect(labelOf("updates-back")).toBe("Артка");
  });
});

describe("беседа: подпись стрелки верна с первого кадра", () => {
  it("«Написать EVO» с «Главной»: под беседой списка нет - «Назад», и стрелка ведёт на «Главную»", async () => {
    await mount("/home");
    forgetFrames();
    await act(async () => router.navigate("/messages/chat"));
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(framesSince()).toEqual(["Назад"]);
    expect(labelOf("chat-back")).toBe("Назад");
    await press("chat-back");
    await waitFor(() => expect(shown()).toBe("route-home"));
  });

  it("строка беседы в списке: под беседой список - «Все чаты» с самого первого кадра, и стрелка ведёт в список", async () => {
    await openList();
    forgetFrames();
    await press("inbox-to-chat");
    await waitFor(() => expect(shown()).toBe("chat-screen"));
    expect(framesSince()).toEqual(["Все чаты"]);
    expect(labelOf("chat-back")).toBe("Все чаты");
    await press("chat-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
  });
});

describe("подпись стрелки обновляется, пока лента на месте", () => {
  it("лента, поверх которой положили экран решения, не меняет подпись: ни одного кадра «Назад» (подпись зависит от ключа своего маршрута)", async () => {
    await openList();
    await press("inbox-to-updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    forgetFrames();
    await act(async () => router.navigate(REPLY));
    await waitFor(() => expect(shown()).toBe("route-reply"));
    expect(framesSince()).not.toContain("Назад");
  });

  it("язык сменили, пока лента на месте: подпись переходит на новый язык и обратно", async () => {
    await openList("ru");
    await press("inbox-to-updates");
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(labelOf("updates-back")).toBe("Все чаты");
    await act(async () => switchLang!("ky"));
    await waitFor(() => expect(labelOf("updates-back")).toBe("Бардык маектер"));
    await act(async () => switchLang!("ru")); // язык хранится на устройстве (AsyncStorage): не оставляем «ky» следующему тесту
    await waitFor(() => expect(labelOf("updates-back")).toBe("Все чаты"));
  });

  it("под лентой заменили экран решения на список: подпись была «Назад», стала «Все чаты»", async () => {
    await mount("/home");
    await act(async () => router.navigate(REPLY));
    await waitFor(() => expect(shown()).toBe("route-reply"));
    await act(async () => router.navigate("/messages/updates"));
    await waitFor(() => expect(shown()).toBe("updates-screen"));
    expect(labelOf("updates-back")).toBe("Назад");
    await act(async () => stackHandle.dispatch({ type: "REPLACE", payload: { name: "index" }, source: stackHandle.routeKey, target: stackHandle.stackKey }));
    await waitFor(() => expect(labelOf("updates-back")).toBe("Все чаты"));
  });
});

// Запасная ветка стрелки: назад некуда (`router.canGoBack() === false`), стрелка открывает список «Входящих». В кабинете её не бывает:
// «Входящие» не первая вкладка, и у вкладок «назад» всегда есть (на «Главную»; проверено на настоящем кабинете: после `router.replace`
// ленты вместо списка `canGoBack()` остаётся `true`, стрелка ведёт на «Главную»). Поэтому ветка проверяется на настоящем роутере из
// одних стеков без вкладок, где назад на самом деле некуда; хук настоящий, ничего не подменяется.
function PlainStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
function FeedProbe() {
  const back = useInboxBack();
  return (
    <Pressable testID="probe-back" accessibilityLabel={back.label} onPress={back.onPress}>
      <Text testID="route-probe-feed">лента</Text>
    </Pressable>
  );
}

describe("стрелка, когда назад некуда (`canGoBack() === false`)", () => {
  it("в стеке одна лента и истории нет: стрелка открывает список «Входящих», а не молчит и не уводит в другое место", async () => {
    await renderRouter({ _layout: PlainStack, "messages/_layout": PlainStack, "messages/index": InboxMarker, "messages/updates": FeedProbe } as never, {
      initialUrl: "/messages",
      wrapper: ({ children }: { children: ReactNode }) => <Wrapper lang="ru">{children}</Wrapper>,
    });
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    await act(async () => router.replace("/messages/updates")); // лента вместо списка: в стеке одна она
    await waitFor(() => expect(visible("route-probe-feed")).toBe(true));
    expect(router.canGoBack()).toBe(false); // условие проверки: иначе она шла бы по другой ветке
    expect(labelOf("probe-back")).toBe("Назад");
    await press("probe-back");
    await waitFor(() => expect(shown()).toBe("route-inbox"));
    expect(visible("route-probe-feed")).toBe(false);
  });
});
