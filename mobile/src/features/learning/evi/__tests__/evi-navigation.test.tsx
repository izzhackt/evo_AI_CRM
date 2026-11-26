// Два экрана Эви в стеке друг под другом: доказательство на настоящем стеке expo-router 58 (JS-часть навигации, без симулятора).
// Сначала то, что делали входы раньше (`router.navigate`): «К каталогу» клал второй каталог поверх Эви, и вход в Эви оставлял старую
// Эви под новой. Потом то, что делают входы теперь: Эви в стеке не бывает дважды, а вернувшийся к Эви находит прежний экран.
import { Stack, router } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Pressable, Text } from "react-native";

import { leaveEviForCatalog, useOpenEvi } from "@/features/learning/evi/navigation";

function Catalog() {
  const openEvi = useOpenEvi();
  return (
    <>
      <Text>catalog</Text>
      <Pressable testID="open-evi" onPress={openEvi} />
      <Pressable testID="open-evi-old" onPress={() => router.navigate("/professions/evi")} />
    </>
  );
}
function Evi() {
  return (
    <>
      <Text>evi</Text>
      <Pressable testID="to-catalog" onPress={leaveEviForCatalog} />
      <Pressable testID="to-catalog-old" onPress={() => router.navigate("/professions")} />
      <Pressable testID="to-card" onPress={() => router.navigate({ pathname: "/professions/[cardId]", params: { cardId: "c1" } })} />
    </>
  );
}
const ROUTES = {
  "professions/_layout": { default: () => <Stack screenOptions={{ headerShown: false }} />, unstable_settings: { anchor: "index" } },
  "professions/index": Catalog,
  "professions/evi": Evi,
  "professions/[cardId]": () => <Text>card</Text>,
};

type RouteState = { routes: { name: string; state?: RouteState }[] };
function find(state: RouteState | undefined, name: string): RouteState | undefined {
  for (const route of state?.routes ?? []) {
    if (route.name === name) return route.state;
    const inner = find(route.state, name);
    if (inner) return inner;
  }
  return undefined;
}
/** Имена экранов в стеке «Профессий», снизу вверх. */
function stack(view: Awaited<ReturnType<typeof renderRouter>>): string[] {
  return (find(view.getRouterState() as RouteState | undefined, "professions")?.routes ?? []).map((route) => route.name);
}
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

describe("входы в «Подбор с Эви» и «Открыть каталог»", () => {
  it("раньше (router.navigate): «К каталогу» клал второй каталог поверх Эви, а вход в Эви - вторую Эви поверх второго каталога", async () => {
    const view = await renderRouter(ROUTES, { initialUrl: "/professions" });
    expect(stack(view)).toEqual(["index"]);
    await press("open-evi-old");
    expect(stack(view)).toEqual(["index", "evi"]);
    await press("to-catalog-old");
    expect(stack(view)).toEqual(["index", "evi", "index"]);
    await press("open-evi-old");
    expect(stack(view)).toEqual(["index", "evi", "index", "evi"]);
  });

  it("теперь: каталог -> Эви -> «Открыть каталог» -> Эви: в стеке всегда ровно одна Эви", async () => {
    const view = await renderRouter(ROUTES, { initialUrl: "/professions" });
    await press("open-evi");
    expect(stack(view)).toEqual(["index", "evi"]);
    await press("to-catalog");
    expect(stack(view)).toEqual(["index"]);
    expect(screen.getByText("catalog")).toBeTruthy();
    await press("open-evi");
    expect(stack(view)).toEqual(["index", "evi"]);
    expect(screen.getByText("evi")).toBeTruthy();
    expect(stack(view).filter((name) => name === "evi")).toHaveLength(1);
  });

  it("каталог оказался поверх Эви (например, из меню ☰ «Профессии»): вход в Эви возвращает к прежней Эви, а не кладёт вторую", async () => {
    const view = await renderRouter(ROUTES, { initialUrl: "/professions" });
    await press("open-evi");
    // Меню ☰ ведёт на раздел обычным `navigate`: каталог поверх Эви.
    await act(async () => router.navigate("/professions"));
    expect(stack(view)).toEqual(["index", "evi", "index"]);
    await press("open-evi");
    expect(stack(view)).toEqual(["index", "evi"]);
    expect(screen.getByText("evi")).toBeTruthy();
  });

  it("итог Эви -> карточка профессии -> назад: Эви на месте; вход в Эви из каталога под карточкой не плодит экраны", async () => {
    const view = await renderRouter(ROUTES, { initialUrl: "/professions" });
    await press("open-evi");
    await press("to-card");
    expect(stack(view)).toEqual(["index", "evi", "[cardId]"]);
    await act(async () => router.back());
    expect(stack(view)).toEqual(["index", "evi"]);
  });

  it("открыли ссылкой на Эви: под ней каталог (якорь раздела), и «Открыть каталог» ведёт к нему, а не заменяет Эви вторым каталогом", async () => {
    const view = await renderRouter(ROUTES, { initialUrl: "/professions/evi" });
    expect(stack(view)).toEqual(["index", "evi"]);
    await press("to-catalog");
    expect(stack(view)).toEqual(["index"]);
  });

  it("Эви единственный экран стека (якоря нет): «Открыть каталог» заменяет её каталогом, а не оставляет пустой стек", async () => {
    const view = await renderRouter({ ...ROUTES, "professions/_layout": () => <Stack screenOptions={{ headerShown: false }} /> }, { initialUrl: "/professions/evi" });
    expect(stack(view)).toEqual(["evi"]);
    await press("to-catalog");
    expect(stack(view)).toEqual(["index"]);
  });
});
