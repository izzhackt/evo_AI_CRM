// Оболочка кабинета (`(app)/_layout.tsx`) на НАСТОЯЩЕМ expo-router. В `Tabs` показываются только объявленные экраны: маршрут без
// `Tabs.Screen` ничего не рисует и отправляет на «Главную» (и переход `router.navigate`, и ссылка снаружи). Поэтому каждый файл
// в `app/(app)`, который не раздел меню ☰ (`SECTIONS`), обязан быть объявлен в оболочке. Тест читает папку и падает, когда
// появляется новый экран без объявления и без проверки здесь. Остальное (сессия, транспорт, опрос, меню, кнопка чата) подменено.
//
// Новый экран `(app)/<имя>` вне меню: добавить `<Tabs.Screen name="<имя>" options={{ title: "<имя>" }} />` в оболочку и запись в
// `HIDDEN` ниже (пример пути и файлы маршрута).
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { readdirSync } from "node:fs";
import path from "node:path";
import { type ComponentType, type ReactNode } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AppLayout from "@/app/(app)/_layout";
import OverviewRedirect from "@/app/overview";
import PreparationRoute from "@/app/(app)/preparations/[applicationId]";
import PreparationsLayout from "@/app/(app)/preparations/_layout";
import { preparationHref, preparationPath } from "@/features/preparations/routes";
import { LangProvider } from "@/i18n/LangProvider";
import type { RpcTransport } from "@/lib/rpc";
import { SECTIONS } from "@/shell/sections";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { initializeReceipt, starterReadiness, uninitializedReadiness } from "@/test-fixtures/preparations";
import { failure, fakeTransport, preparationRow, uuidN } from "@/test-fixtures/universities";

// Здесь нужна настоящая обёртка фокуса: уход с экрана и возврат проверяются на самой навигации (в остальных тестах её подменяет jest.setup.ts).
jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));
const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
let mockTransport: RpcTransport = async () => ({ data: null, error: { code: "42883" }, status: 404 });
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "https://portal.example.test" }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => (...args: Parameters<RpcTransport>) => mockTransport(...args) }));
// `usePortalPollFailure`: его читает `PollFailureNotice` (#1565) в оболочке; без него граница ошибок скрывала бы падение, но React писал бы «Caught error» в каждом тесте.
jest.mock("@/api/PortalPoll", () => ({
  PortalPoll: ({ children }: { children: unknown }) => children,
  usePortalUnread: () => 0,
  usePortalPollFailure: () => ({ failed: false, retry: () => undefined }),
}));
jest.mock("@/features/universities/IndexWarmup", () => ({ UniversityIndexWarmup: () => null }));
jest.mock("@/features/learning/csca/useCscaAccess", () => ({ useCscaAccess: () => ({ available: false }) }));
jest.mock("@/shell/ChatFab", () => ({ ChatFab: () => null }));
jest.mock("@/shell/MenuSheet", () => ({ MenuSheet: () => null }));

const PROGRAM_A = uuidN(1, "bbbbbbbb");
const PROGRAM_B = uuidN(2, "bbbbbbbb");
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

const signedIn = (tier: "assisted" | "approved") => ({
  kind: "active",
  session: {
    authority: { authUserId: "student-a", profileId: "p", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Тест Студентов", platformRole: "student", platformAccessVersion: 1 },
    portalCase: { id: "33333333-3333-4333-8333-333333333333", studentDisplayName: "Тест Студентов", targetCountry: null, caseState: "active", portalActivatedAt: "2026-11-01T00:00:00Z" },
    tier,
  },
});

const marker = (name: string) => function Marker() {
  return <Text testID={`route-${name}`}>{name}</Text>;
};

/** Экраны кабинета вне меню ☰: путь для проверки и файлы маршрута (у `preparations` свой стек, он настоящий). */
const HIDDEN: Record<string, { url: string; files: Record<string, ComponentType> }> = {
  application: { url: "/application", files: { "(app)/application": marker("application") } },
  preparations: { url: `/preparations/${PROGRAM_A}`, files: { "(app)/preparations/_layout": PreparationsLayout, "(app)/preparations/[applicationId]": marker("preparations") } },
};

const APP_DIR = path.join(__dirname, "../app/(app)");
const routeNames = readdirSync(APP_DIR)
  .filter((file) => file !== "_layout.tsx")
  .map((file) => file.replace(/\.tsx$/u, ""));
const sectionIds: string[] = SECTIONS.map((section) => section.id);
const hiddenNames = routeNames.filter((name) => !sectionIds.includes(name));

function files(overrides: Record<string, ComponentType> = {}): Record<string, ComponentType> {
  return {
    "(app)/_layout": AppLayout,
    ...Object.fromEntries(SECTIONS.map((section) => [`(app)/${section.id}`, marker(section.id)])),
    ...Object.assign({}, ...Object.values(HIDDEN).map((entry) => entry.files)),
    ...overrides,
  };
}

async function mount(url: string, options: { tier?: "assisted" | "approved"; overrides?: Record<string, ComponentType> } = {}) {
  mockSession.state = signedIn(options.tier ?? "assisted");
  return renderRouter(files(options.overrides), { initialUrl: url, wrapper: Wrapper });
}

const go = (url: string) => act(async () => router.navigate(url as never));

beforeEach(() => {
  mockTransport = async () => ({ data: null, error: { code: "42883" }, status: 404 });
});

describe("каждый экран кабинета объявлен в оболочке", () => {
  it("папка `(app)`: всё, что не раздел меню, перечислено здесь и проверяется (новый экран без объявления не пройдёт)", () => {
    // Список «нет в проверке» должен быть пуст: такой экран нужно объявить вкладкой в оболочке и добавить в `HIDDEN`.
    expect({ нет_в_проверке: hiddenNames.filter((name) => !(name in HIDDEN)) }).toEqual({ нет_в_проверке: [] });
    expect({ нет_файла: Object.keys(HIDDEN).filter((name) => !hiddenNames.includes(name)) }).toEqual({ нет_файла: [] });
    // и наоборот: у каждого раздела меню есть файл маршрута
    expect({ нет_файла_раздела: sectionIds.filter((id) => !routeNames.includes(id)) }).toEqual({ нет_файла_раздела: [] });
  });

  it("`overview` лежит в корне, а не в `(app)`: это перенаправление на «Главную» со старыми параметрами и от вкладок не зависит", async () => {
    mockSession.state = signedIn("assisted");
    const view = await renderRouter({ ...files(), overview: OverviewRedirect }, { initialUrl: "/overview?path=open", wrapper: Wrapper });
    expect(view.getPathname()).toBe("/home");
    expect(view.getSearchParams()).toMatchObject({ path: "open" });
    await go("/overview?view=programs");
    expect(view.getPathname()).toBe("/home");
    expect(view.getSearchParams()).toMatchObject({ list: "programs" });
  });

  it("разделы меню и скрытые экраны открываются переходом, остаются на своём пути и рисуют свой экран", async () => {
    const view = await mount("/home");
    const targets = [...sectionIds.map((id) => ({ name: id, url: `/${id}` })), ...Object.entries(HIDDEN).map(([name, entry]) => ({ name, url: entry.url }))];
    for (const target of targets) {
      await go(target.url);
      expect({ target: target.name, path: view.getPathname() }).toEqual({ target: target.name, path: target.url });
      expect(screen.queryByTestId(`route-${target.name}`)).toBeTruthy();
    }
  });

  it("ссылки других срезов (`preparationHref` и `preparationPath`) приводят на экран программы, а не на «Главную»", async () => {
    const view = await mount("/home");
    await act(async () => router.navigate(preparationHref(PROGRAM_B)));
    expect(view.getPathname()).toBe(`/preparations/${PROGRAM_B}`);
    expect(screen.queryByTestId("route-preparations")).toBeTruthy();
    await go("/home");
    await go(preparationPath(PROGRAM_A));
    expect(view.getPathname()).toBe(`/preparations/${PROGRAM_A}`);
    expect(screen.queryByTestId("route-preparations")).toBeTruthy();
  });

  it.each(Object.entries(HIDDEN))("скрытый экран %s открывается и по ссылке снаружи (холодный старт)", async (name, entry) => {
    const view = await mount(entry.url);
    expect(view.getPathname()).toBe(entry.url);
    expect(screen.queryByTestId(`route-${name}`)).toBeTruthy();
  });

  it.each(Object.entries(HIDDEN))("скрытый экран %s доступен и студенту без сопровождения (approved)", async (name, entry) => {
    const view = await mount("/home", { tier: "approved" });
    await go(entry.url);
    expect(view.getPathname()).toBe(entry.url);
    expect(screen.queryByTestId(`route-${name}`)).toBeTruthy();
  });

  it("панель вкладок рисует три вкладки и ничего для скрытых экранов; на скрытом экране панель цела", async () => {
    await mount("/home");
    for (const id of ["home", "documents", "messages"]) expect(screen.getByTestId(`tab-${id}`)).toBeTruthy();
    for (const [name, entry] of Object.entries(HIDDEN)) {
      await go(entry.url);
      expect(screen.queryByTestId(`tab-${name}`)).toBeNull();
      expect(screen.getByTestId("tab-home")).toBeTruthy();
      // ни одна из трёх вкладок не выглядит выбранной на скрытом экране
      for (const id of ["home", "documents", "messages"]) expect(screen.getByTestId(`tab-${id}`).props.accessibilityState).toMatchObject({ selected: false });
    }
  });
});

describe("«Требования программы» в оболочке: стопка и «назад»", () => {
  const rows = [preparationRow(1), preparationRow(2)];
  const real = { "(app)/preparations/[applicationId]": PreparationRoute };

  function useHandlers(extra: Record<string, unknown> = {}, readiness: unknown = starterReadiness()) {
    const { transport, calls } = fakeTransport({ student_catalog_preparations_v1: rows, application_package_readiness_v1: readiness, ...extra });
    mockTransport = transport;
    return calls;
  }

  it("«Главная» -> A -> «Главная» -> B -> «назад»: на «Главную», а не на закрытую программу A", async () => {
    const view = await mount("/home", { overrides: { "(app)/preparations/[applicationId]": marker("preparations") } });
    await go(`/preparations/${PROGRAM_A}`);
    expect(view.getPathname()).toBe(`/preparations/${PROGRAM_A}`);
    await go("/home");
    await go(`/preparations/${PROGRAM_B}`);
    expect(view.getPathname()).toBe(`/preparations/${PROGRAM_B}`);
    await act(async () => router.back());
    expect(view.getPathname()).toBe("/home");
  });

  it("переход с программы A на программу B меняет параметр того же экрана, второй экран в стопку не кладётся", async () => {
    const view = await mount(`/preparations/${PROGRAM_A}`, { overrides: { "(app)/preparations/[applicationId]": marker("preparations") } });
    await go(`/preparations/${PROGRAM_B}`);
    expect(view.getPathname()).toBe(`/preparations/${PROGRAM_B}`);
    await act(async () => router.back());
    expect(view.getPathname()).toBe("/home");
  });

  it("уход на другую вкладку и возврат: текст ошибки прежнего показа не висит на экране", async () => {
    const calls = useHandlers({ student_initialize_application_requirements_v1: failure("42501", 403) }, uninitializedReadiness());
    await mount(`/preparations/${PROGRAM_A}`, { overrides: real });
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-error")).toBeTruthy();
    await go("/documents");
    await go(`/preparations/${PROGRAM_A}`);
    expect(await screen.findByTestId("prep-title")).toBeTruthy();
    expect(screen.queryByTestId("prep-error")).toBeNull();
    // кнопка по-прежнему на месте: список не открыт, повторить можно
    expect(screen.getByTestId("prep-continue")).toBeTruthy();
    expect(calls.filter((c) => c.name === "student_initialize_application_requirements_v1")).toHaveLength(1);
  });

  it("уход и возврат снимают замороженный запрос: после обрыва повторное нажатие шлёт НОВЫЙ requestId, а не прежний", async () => {
    let attempts = 0;
    const ids: string[] = [];
    useHandlers(
      {
        student_initialize_application_requirements_v1: (args: Record<string, unknown> | undefined) => {
          attempts += 1;
          ids.push(String(args?.p_request_id));
          // одно нажатие делает три попытки подряд: обрыв, обрыв, обрыв (исход неизвестен); дальше связь есть
          if (attempts <= 3) throw new Error("Network request failed");
          return initializeReceipt(String(args?.p_request_id));
        },
      },
      uninitializedReadiness(),
    );
    await mount(`/preparations/${PROGRAM_A}`, { overrides: real });
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-error", {}, { timeout: 4000 })).toHaveTextContent("Не получилось проверить, сохранилось ли действие.", { exact: false });
    expect(new Set(ids).size).toBe(1);
    await go("/documents");
    await go(`/preparations/${PROGRAM_A}`);
    expect(screen.queryByTestId("prep-error")).toBeNull();
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    await waitFor(() => expect(ids).toHaveLength(4));
    expect(ids[3]).not.toBe(ids[0]);
  });

  it("другая программа начинает с чистого состояния: ошибка программы A не переходит на программу B", async () => {
    useHandlers({ student_initialize_application_requirements_v1: failure("42501", 403) }, uninitializedReadiness());
    await mount(`/preparations/${PROGRAM_A}`, { overrides: real });
    await fireEvent.press(await screen.findByTestId("prep-continue"));
    expect(await screen.findByTestId("prep-error")).toBeTruthy();
    await go(`/preparations/${PROGRAM_B}`);
    expect(await screen.findByTestId("prep-title")).toBeTruthy();
    expect(screen.queryByTestId("prep-error")).toBeNull();
  });
});
