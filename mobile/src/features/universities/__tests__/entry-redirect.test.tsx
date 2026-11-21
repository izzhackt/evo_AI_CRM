// Вход в каталог на стране: повторное «Университеты» не копит экраны страны. Роутер замещён:
// настоящий стек в Jest недоступен (expo-router/testing-library не грузится под Node 22),
// поэтому проверен выбор между `replace` и `dismissTo` по состоянию стека каталога.
import { render } from "@testing-library/react-native";
import { router } from "expo-router";

import { useEntryRedirect } from "@/features/universities/useEntryRedirect";

const stack: { routes: { name: string; params?: { code: string } }[] } = { routes: [] };
jest.mock("expo-router", () => ({
  useNavigation: () => ({ getState: () => stack }),
  router: { replace: jest.fn(), dismissTo: jest.fn() },
}));

function Probe({ country }: { country: string | null }) {
  useEntryRedirect(country);
  return null;
}

beforeEach(() => {
  (router.replace as jest.Mock).mockClear();
  (router.dismissTo as jest.Mock).mockClear();
});

it("первый вход: только экран входа в стеке - replace", async () => {
  stack.routes = [{ name: "index" }];
  await render(<Probe country="MY" />);
  expect(router.replace).toHaveBeenCalledWith("/universities/country/my");
  expect(router.dismissTo).not.toHaveBeenCalled();
});

it("повторный вход: экран этой страны уже в стеке - dismissTo, второго не кладёт", async () => {
  stack.routes = [{ name: "country/[code]/index", params: { code: "my" } }, { name: "index" }];
  await render(<Probe country="MY" />);
  expect(router.dismissTo).toHaveBeenCalledWith("/universities/country/my");
  expect(router.replace).not.toHaveBeenCalled();
});

it("другая страна в стеке не считается: replace; без страны ничего", async () => {
  stack.routes = [{ name: "country/[code]/index", params: { code: "cn" } }, { name: "index" }];
  await render(<Probe country="MY" />);
  expect(router.replace).toHaveBeenCalledTimes(1);
  await render(<Probe country={null} />);
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(router.dismissTo).not.toHaveBeenCalled();
});
