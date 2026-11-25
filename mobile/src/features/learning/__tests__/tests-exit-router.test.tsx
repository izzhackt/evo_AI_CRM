// Куда ведёт уход с теста, на настоящем стеке expo-router 58 (JS-часть навигации, без симулятора): вкладки кабинета и свой стек у
// «Тестов» и «Профессий», как в `app/(app)`; сам экран теста настоящий (`AssessmentRoute`). До правки (ревью QA 22) тест, открытый
// из другого раздела, был в своём стеке единственным: `router.back()` уходил во вкладку «Главная», а сам тест оставался жить в памяти.
import { Stack, Tabs, router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { Alert, BackHandler, Pressable, Text } from "react-native";

import AssessmentRoute from "@/app/(app)/tests/[key]";
import { ATTEMPT_ID, attemptFixture, catalogFixture, completedFixture } from "@/test-fixtures/assessment";
import { PortalShell, testApi, testClient } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const SAVE = "save_student_assessment_answers_v1";
const stackLayout = { default: () => <Stack screenOptions={{ headerShown: false }} />, unstable_settings: { anchor: "index" } };
const ROUTES = {
  "(app)/_layout": () => (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="professions" />
      <Tabs.Screen name="english" />
      <Tabs.Screen name="tests" />
    </Tabs>
  ),
  "(app)/home": () => <Text testID="home">home</Text>,
  "(app)/professions/_layout": stackLayout,
  "(app)/professions/index": () => (
    <>
      <Text testID="professions">professions</Text>
      <Pressable testID="start-interests" onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "orvis92", from: "professions" } })} />
    </>
  ),
  "(app)/english": () => <Pressable testID="start-english" onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "english36" } })} />,
  "(app)/tests/_layout": stackLayout,
  "(app)/tests/index": () => (
    <>
      <Text testID="tests-catalogue">catalogue</Text>
      <Pressable testID="open-interests" onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "orvis92" } })} />
    </>
  ),
  "(app)/tests/[key]": AssessmentRoute,
};

type RouteState = { name: string; state?: { routes: RouteState[] } };
function find(routes: RouteState[] | undefined, name: string): RouteState | undefined {
  for (const route of routes ?? []) {
    if (route.name === name) return route;
    const inner = find(route.state?.routes, name);
    if (inner) return inner;
  }
  return undefined;
}
type View = Awaited<ReturnType<typeof renderRouter>>;
/** Экраны стека раздела, снизу вверх. */
const stack = (view: View, section: string) => (find((view.getRouterState() as { routes: RouteState[] }).routes, section)?.state?.routes ?? []).map((route) => route.name);
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

function setup(handlers: Record<string, unknown> = {}) {
  const fake = fakeTransport({
    student_assessments_v1: catalogFixture("orvis92"),
    start_student_assessment_v1: attemptFixture("orvis92"),
    [SAVE]: attemptFixture("orvis92", { revision: 2 }),
    ...handlers,
  });
  const api = testApi(fake.transport);
  const client = testClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PortalShell api={api} client={client}>
      {children}
    </PortalShell>
  );
  return { ...fake, wrapper };
}
async function mount(initialUrl: string, handlers: Record<string, unknown> = {}) {
  const env = setup(handlers);
  const view = await renderRouter(ROUTES, { initialUrl, wrapper: env.wrapper });
  return { ...env, view };
}
/** «Начать» и один выбранный ответ: на экране несохранённое, как в пути студента из QA. */
async function startAndAnswer() {
  await press((await screen.findByTestId("assessment-begin")).props.testID);
  await screen.findByTestId("assessment-heading");
  await press("assessment-option-o1-3");
}
const settle = () => act(async () => jest.advanceTimersByTime(1500));

describe("выход из теста: «Профессии» - тест - «Сохранить и выйти»", () => {
  it("тест открыт с карточки «Профессий»: «Сохранить и выйти» возвращает на «Профессии», в стеке «Тестов» теста не остаётся", async () => {
    const { view, calls } = await mount("/home");
    await act(async () => router.navigate("/professions"));
    await press("start-interests");
    await waitFor(() => expect(view.getPathname()).toBe("/tests/orvis92"));
    expect(stack(view, "tests")).toEqual(["[key]"]); // единственный в стеке: «назад» ушла бы во вкладку «Главная»
    await startAndAnswer();
    await press("assessment-exit");
    await settle();
    await waitFor(() => expect(view.getPathname()).toBe("/professions"));
    expect(calls.filter((c) => c.name === SAVE)).toHaveLength(1); // ответ сохранён до ухода
    expect(stack(view, "tests")).toEqual(["index"]);
    await act(async () => router.navigate("/tests")); // вкладка «Тесты» открывается каталогом, а не забытым тестом
    expect(screen.getByTestId("tests-catalogue")).toBeTruthy();
    expect(screen.queryByTestId("assessment-screen")).toBeNull();
  });

  it("стрелка в шапке теста ведёт туда же, что «Сохранить и выйти»", async () => {
    const { view } = await mount("/home");
    await act(async () => router.navigate("/professions"));
    await press("start-interests");
    await startAndAnswer();
    await press("assessment-title-back");
    await settle();
    await waitFor(() => expect(view.getPathname()).toBe("/professions"));
    expect(stack(view, "tests")).toEqual(["index"]);
  });

  it("до начала (экран «Перед началом») стрелка тоже возвращает на «Профессии»", async () => {
    const { view } = await mount("/home");
    await act(async () => router.navigate("/professions"));
    await press("start-interests");
    await screen.findByTestId("assessment-begin");
    await press("assessment-title-back");
    await waitFor(() => expect(view.getPathname()).toBe("/professions"));
    expect(stack(view, "tests")).toEqual(["index"]);
  });
});

describe("выход из теста: результат", () => {
  it("«К тестам» на результате, открытом из другого раздела, ведёт в каталог, а не кладёт его поверх теста (иначе «назад» возвращала бы на результат)", async () => {
    const { view } = await mount("/home", { student_assessments_v1: catalogFixture("english36"), student_assessment_attempt_v1: completedFixture("english36") });
    await act(async () => router.navigate("/english"));
    await act(async () => router.navigate({ pathname: "/tests/[key]", params: { key: "english36", attempt: ATTEMPT_ID } }));
    await press((await screen.findByTestId("assessment-back-to-tests")).props.testID);
    await waitFor(() => expect(view.getPathname()).toBe("/tests"));
    expect(stack(view, "tests")).toEqual(["index"]);
  });
});

describe("выход из теста: остальные входы ведут в «Все тесты»", () => {
  it("тест открыт из каталога «Тестов»: выход возвращает в каталог", async () => {
    const { view } = await mount("/home");
    await act(async () => router.navigate("/tests"));
    await press("open-interests");
    await waitFor(() => expect(view.getPathname()).toBe("/tests/orvis92"));
    expect(stack(view, "tests")).toEqual(["index", "[key]"]);
    await startAndAnswer();
    await press("assessment-exit");
    await settle();
    await waitFor(() => expect(view.getPathname()).toBe("/tests"));
    expect(stack(view, "tests")).toEqual(["index"]);
  });

  it("тест открыт из «Английского» (другая вкладка, без `from`): выход в «Все тесты», а не на «Главную»", async () => {
    const { view } = await mount("/home", { student_assessments_v1: catalogFixture("english36"), start_student_assessment_v1: attemptFixture("english36") });
    await act(async () => router.navigate("/english"));
    await press("start-english");
    await waitFor(() => expect(view.getPathname()).toBe("/tests/english36"));
    await press((await screen.findByTestId("assessment-begin")).props.testID);
    await screen.findByTestId("assessment-heading");
    await press("assessment-title-back");
    await waitFor(() => expect(view.getPathname()).toBe("/tests"));
    expect(stack(view, "tests")).toEqual(["index"]);
  });

  it("ссылка снаружи прямо на тест: выход в «Все тесты»", async () => {
    const { view } = await mount("/tests/orvis92");
    await screen.findByTestId("assessment-begin");
    await press("assessment-title-back");
    await waitFor(() => expect(view.getPathname()).toBe("/tests"));
    expect(stack(view, "tests")).toEqual(["index"]);
  });

  it("чужое или повторённое значение `from` ничего не значит: выход в «Все тесты»", async () => {
    const { view } = await mount("/home");
    await act(async () => router.navigate("/professions"));
    await act(async () => router.navigate({ pathname: "/tests/[key]", params: { key: "orvis92", from: "home" } }));
    await screen.findByTestId("assessment-begin");
    await press("assessment-title-back");
    await waitFor(() => expect(view.getPathname()).toBe("/tests"));
  });
});

describe("выход из теста: несохранённый ответ и системная «назад»", () => {
  it("без связи «Сохранить и выйти» остаётся на тесте; «Выйти без сохранения» после трёх неудач ведёт туда же, куда обычный выход", async () => {
    const { view, calls } = await mount("/home", { [SAVE]: failure(null, 0) });
    await act(async () => router.navigate("/professions"));
    await press("start-interests");
    await startAndAnswer();
    await press("assessment-exit");
    await settle();
    await waitFor(() => expect(screen.getByTestId("assessment-retry-save")).toBeTruthy());
    expect(view.getPathname()).toBe("/tests/orvis92");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await press("assessment-retry-save");
      await settle();
    }
    expect(calls.filter((c) => c.name === SAVE).length).toBeGreaterThan(3);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await press("assessment-leave-anyway");
    const buttons = alert.mock.calls[0][2] as { onPress?: () => void }[];
    await act(async () => buttons[1].onPress?.());
    await waitFor(() => expect(view.getPathname()).toBe("/professions"));
    expect(stack(view, "tests")).toEqual(["index"]);
    alert.mockRestore();
  });

  it("Android: тест единственный в стеке «Тестов» - системная «назад» уходит так же, как кнопка, а не во вкладку «Главная»", async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_event: string, handler: () => boolean) => {
      handlers.push(handler);
      return { remove: () => void handlers.splice(handlers.indexOf(handler), 1) };
    }) as never);
    const { view } = await mount("/home");
    await act(async () => router.navigate("/professions"));
    await press("start-interests");
    await startAndAnswer();
    let consumed = false;
    await act(async () => {
      consumed = handlers[handlers.length - 1]();
    });
    expect(consumed).toBe(true);
    await settle();
    await waitFor(() => expect(view.getPathname()).toBe("/professions"));
    expect(stack(view, "tests")).toEqual(["index"]);
    spy.mockRestore();
  });
});
