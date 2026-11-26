// Полоса «потянули вниз» экранов «Тесты», CSCA и «Профессии» (ревью, мелочь 29): горит только у перечитывания, которое начал студент.
// Раньше в полосу шло `isRefetching` запроса, и она зажигалась при любом фоновом перечитывании (возврат на экран, возврат в приложение,
// сброс запроса после записи); на iPhone это ещё и сдвигало содержимое вниз. Чтения идут по настоящему пути на поддельном транспорте.
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, screen, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";

import { CscaHomeScreen } from "@/features/learning/csca/CscaHomeScreen";
import { ProfessionsScreen } from "@/features/learning/professions/ProfessionsScreen";
import { TestsScreen } from "@/features/learning/tests/TestsScreen";
import { holdRpc } from "@/test-fixtures/hold-rpc";
import { catalogFixture } from "@/test-fixtures/assessment";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, uuidN } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), setParams: jest.fn(), push: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() }),
}));
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => true }));
jest.mock("@/features/learning/evi/EviRobot", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  return { ...jest.requireActual("@/features/learning/evi/EviRobot"), EviRobot: () => React.createElement(View, { testID: "evi-robot" }) };
});
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    create() {}
    delete() {}
  }
  class File {
    exists = false;
    async text() {
      return "";
    }
    create() {}
    write() {}
    delete() {}
  }
  return { Directory, File, Paths: { cache: "cache" } };
});

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = jest.fn(async () => new Response(JSON.stringify({ available: true }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  globalThis.fetch = realFetch;
});

/** Дать оповещениям TanStack Query (они идут через `setTimeout`) дойти до экрана: иначе проверка «полосы нет» ничего не проверяет. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const pull = () => screen.getByTestId("screen-scroll").props.refreshControl.props as { refreshing: boolean; onRefresh: () => void };

/** Сценарий для любого экрана: фоновое перечитывание полосу не зажигает, потянули вниз - зажигает до ответа и гасит. */
async function scenario(client: QueryClient, held: ReturnType<typeof holdRpc>, queryKey: readonly unknown[]) {
  const fetching = () => client.getQueryState(queryKey)?.fetchStatus === "fetching";
  await waitFor(() => expect(client.getQueryState(queryKey)?.status).toBe("success"));
  await settle();
  expect(pull().refreshing).toBe(false);

  // перечитывание без участия студента (так сбрасывается запрос после записи, так перечитывается он при возврате)
  held.hold();
  const before = held.started();
  await act(async () => {
    void client.invalidateQueries({ queryKey });
  });
  await waitFor(() => expect(held.started()).toBe(before + 1));
  await settle();
  expect(fetching()).toBe(true);
  expect(pull().refreshing).toBe(false);
  await act(async () => held.release());
  await settle();
  expect(pull().refreshing).toBe(false);

  // студент потянул вниз
  held.hold();
  await act(async () => {
    pull().onRefresh();
  });
  await waitFor(() => expect(held.started()).toBe(before + 2));
  expect(pull().refreshing).toBe(true);
  await act(async () => held.release());
  await waitFor(() => expect(pull().refreshing).toBe(false));
}

describe("полоса «потянули вниз»: только у запроса студента", () => {
  it("«Тесты»", async () => {
    const t = fakeTransport({ student_assessments_v1: catalogFixture("english36") });
    const held = holdRpc(t.transport, "student_assessments_v1");
    const { client } = await renderPortal(<TestsScreen />, testApi(held.transport));
    await scenario(client, held, ["portal", "user-test", "assessments"]);
  });

  it("CSCA", async () => {
    const home = JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca/csca_home_after.json"), "utf8"));
    const t = fakeTransport({ learning_track_home_v1: home });
    const held = holdRpc(t.transport, "learning_track_home_v1");
    const { client } = await renderPortal(<CscaHomeScreen />, testApi(held.transport));
    await scenario(client, held, ["portal", "user-test", "csca-home"]);
  });

  it("«Профессии»", async () => {
    const card = { cardId: uuidN(1, "dddddddd"), cardKey: "analyst", version: "1.1.0", titleRu: "Аналитик данных", titleKy: "Аналитик данных (ky)", orvisScales: ["analysis"], summaryRu: null, summaryKy: null };
    const t = fakeTransport({ profession_cards_v1: { cards: [card] }, student_university_favorites_v1: [], student_assessments_v1: catalogFixture("orvis92") });
    const held = holdRpc(t.transport, "profession_cards_v1");
    const { client } = await renderPortal(<ProfessionsScreen />, testApi(held.transport));
    await scenario(client, held, ["portal", "user-test", "profession-cards"]);
  });
});
