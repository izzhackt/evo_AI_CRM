// Карточка «Не удалось обновить уведомления» в НАСТОЯЩЕЙ раскладке кабинета (`(app)/_layout.tsx`, настоящий expo-router, настоящая
// верхняя полоса и панель вкладок). QA#2, D4: плавающая карточка (absolute, 320 pt, ниже полосы) закрывала верх экрана - блок сбоя
// теста («Повторить сохранение», «Выйти без сохранения») встаёт наверху прокрутки ровно под ней, и нажатия попадали в карточку.
// Jest не считает раскладку, поэтому проверяется то, из чего она следует: карточка стоит в потоке той же колонки, что полоса и
// вкладки, ДО них и не вложена ни в один экран. Колонка раскладывает детей друг под другом: всё, что ниже карточки, начинается
// под ней, и закрыть верх прокрутки ей нечем. Сбой опроса даёт карточку сразу и там, где тест уже показывает свой блок сбоя.
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { type ComponentType, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import * as AppLayoutModule from "@/app/(app)/_layout";
import PreparationsLayout from "@/app/(app)/preparations/_layout";
import { LangProvider } from "@/i18n/LangProvider";
import type { RpcTransport } from "@/lib/rpc";
import { SECTIONS } from "@/shell/sections";
import { reportUpdatePromptVisible } from "@/shell/update-prompt-visibility";
import { ThemeProvider } from "@/theme/ThemeProvider";

jest.mock("@/lib/focus", () => jest.requireActual("@/lib/focus"));
const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
const mockPoll = { failed: false, retry: jest.fn() };
const mockTransport: RpcTransport = async () => ({ data: null, error: { code: "42883" }, status: 404 });
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "https://portal.example.test" }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => (...args: Parameters<RpcTransport>) => mockTransport(...args) }));
jest.mock("@/api/PortalPoll", () => ({
  PortalPoll: ({ children }: { children: unknown }) => children,
  usePortalUnread: () => 0,
  usePokePoll: () => () => undefined,
  usePortalPollFailure: () => mockPoll,
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

const onTopControl = jest.fn();
/** Экран с прокруткой, у которой наверху управляющий элемент: как блок сбоя теста, который прокручивают к верху. */
function HomeWithScroll() {
  return (
    <ScrollView testID="home-scroll">
      <Pressable testID="top-control" onPress={onTopControl}>
        <Text testID="route-home">верх прокрутки</Text>
      </Pressable>
    </ScrollView>
  );
}
const marker = (name: string) =>
  function Marker() {
    return <Text testID={`route-${name}`}>{name}</Text>;
  };
type Mod = ComponentType | Record<string, unknown>;
function files(): Record<string, Mod> {
  return {
    "(app)/_layout": AppLayoutModule as unknown as Mod,
    "(app)/home": HomeWithScroll,
    ...Object.fromEntries(SECTIONS.filter((section) => section.id !== "home").map((section) => [`(app)/${section.id}`, marker(section.id)])),
    "(app)/application": marker("application"),
    "(app)/preparations/_layout": PreparationsLayout,
    "(app)/preparations/[applicationId]": marker("preparations"),
    "(app)/preparations/recovery": marker("recovery"),
  };
}
const mount = () => {
  mockSession.state = signedIn;
  return renderRouter(files() as never, { initialUrl: "/home", wrapper: Wrapper });
};

type Json = { type: string; props: Record<string, unknown>; children: (Json | string)[] | null };
const rootOf = (): Json[] => {
  const json = screen.toJSON() as unknown as Json | Json[] | null;
  return json === null ? [] : Array.isArray(json) ? json : [json];
};
/** Путь из индексов детей до узла с этим testID (по порядку в дереве): путь короче или раньше = выше и раньше в потоке. */
function pathTo(testID: string): number[] | null {
  const walk = (nodes: readonly (Json | string)[], trail: number[]): number[] | null => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (typeof node === "string") continue;
      const here = [...trail, index];
      if (node.props?.testID === testID) return here;
      const inner = walk(node.children ?? [], here);
      if (inner) return inner;
    }
    return null;
  };
  return walk(rootOf(), []);
}
function nodeAt(path: readonly number[]): Json {
  let nodes: readonly (Json | string)[] = rootOf();
  let node: Json | undefined;
  for (const index of path) {
    node = nodes[index] as Json;
    nodes = node.children ?? [];
  }
  return node as Json;
}
const commonPrefix = (a: readonly number[], b: readonly number[]) => {
  const out: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i += 1) out.push(a[i]!);
  return out;
};
/** `a` раньше `b` в потоке одной колонки: после общего предка их ветки - братья, и ветка `a` стоит раньше. */
function precedes(a: readonly number[], b: readonly number[]): boolean {
  const common = commonPrefix(a, b).length;
  return common < a.length && common < b.length && a[common]! < b[common]!;
}

beforeEach(() => {
  mockPoll.failed = false;
  onTopControl.mockClear();
  reportUpdatePromptVisible(false);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("карточка сбоя опроса в раскладке кабинета (QA#2, D4)", () => {
  it("сбой опроса: верхняя полоса, затем карточка, затем вкладки; карточка не вложена в экран и стоит в той же колонке", async () => {
    mockPoll.failed = true;
    await mount();
    const bar = pathTo("topbar-row");
    const card = pathTo("poll-failure-anchor");
    const screenContent = pathTo("top-control");
    expect(bar && card && screenContent).toBeTruthy();
    expect(precedes(bar!, card!)).toBe(true);
    expect(precedes(card!, screenContent!)).toBe(true);
    // карточка и ветка с экранами - братья в одной колонке (общий предок, а не «карточка внутри экрана»)
    const column = commonPrefix(card!, screenContent!);
    expect(card!.length).toBe(column.length + 1);
    const columnStyle = StyleSheet.flatten(nodeAt(column).props.style as never) as { flexDirection?: string; flex?: number } | undefined;
    expect(columnStyle?.flexDirection ?? "column").toBe("column");
    expect(columnStyle?.flex).toBe(1);
    const cardStyle = StyleSheet.flatten(screen.getByTestId("poll-failure-anchor").props.style) as { position?: string };
    expect(cardStyle.position).not.toBe("absolute");
  });

  it("управляющий элемент наверху прокрутки лежит ниже карточки и остаётся нажимаемым", async () => {
    mockPoll.failed = true;
    await mount();
    const card = pathTo("poll-failure-anchor")!;
    const control = pathTo("top-control")!;
    expect(precedes(card, control)).toBe(true);
    await fireEvent.press(screen.getByTestId("top-control"));
    expect(onTopControl).toHaveBeenCalledTimes(1);
  });

  it("карточка обновления приложения на виду: карточки сбоя нет, верх экрана сразу под полосой; убрали («Позже») - карточка сбоя снова в потоке", async () => {
    mockPoll.failed = true;
    await mount();
    expect(screen.queryByTestId("poll-failure")).not.toBeNull();
    await act(async () => reportUpdatePromptVisible(true));
    expect(screen.queryByTestId("poll-failure")).toBeNull();
    expect(precedes(pathTo("topbar-row")!, pathTo("top-control")!)).toBe(true);
    await act(async () => reportUpdatePromptVisible(false));
    expect(precedes(pathTo("topbar-row")!, pathTo("poll-failure-anchor")!)).toBe(true);
    expect(precedes(pathTo("poll-failure-anchor")!, pathTo("top-control")!)).toBe(true);
  });

  it("опрос в порядке: карточки нет, экран сразу под верхней полосой", async () => {
    await mount();
    expect(screen.queryByTestId("poll-failure-anchor")).toBeNull();
    expect(precedes(pathTo("topbar-row")!, pathTo("top-control")!)).toBe(true);
  });
});
