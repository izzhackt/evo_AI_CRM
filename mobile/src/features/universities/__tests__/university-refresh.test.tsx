// Страница вуза: полоса «потянули вниз» горит только у запроса студента (ревью #1583). Карточку вуза перечитывают и без него: сердечко и
// «Добавить в мои программы» сбрасывают `university-detail`, при возврате в приложение она тоже перечитывается; раньше в полосу шло
// `isRefetching`, и она зажигалась сама (на iPhone ещё и сдвигала содержимое вниз).
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { UniversityScreen } from "@/features/universities/UniversityScreen";
import type { RpcTransport } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport, STUDENT_CASE_ID, universityContent, uuidN } from "@/test-fixtures/universities";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));

beforeEach(() => {
  mockParams.current = { id: uuidN(1) };
});

const detail = {
  university: { id: uuidN(1), version: 1, publishedAt: "2026-10-01T00:00:00+00:00", content: universityContent("Университет 1") },
  country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } },
  city: null,
  favored: false,
  openConsultation: null,
  preparations: { studentCaseId: STUDENT_CASE_ID, items: [] },
  costs: null,
};

/** Транспорт, у которого чтение карточки вуза можно придержать: запрос остаётся «в полёте», и экран это видит. */
function holdable(inner: RpcTransport) {
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let started = 0;
  const transport: RpcTransport = async (name, args, options) => {
    if (name === "student_university_detail_v1") started += 1;
    if (name === "student_university_detail_v1" && gate) await gate;
    return inner(name, args, options);
  };
  return {
    transport,
    started: () => started,
    hold() {
      gate = new Promise<void>((resolve) => {
        open = () => {
          gate = null;
          resolve();
        };
      });
    },
    release: () => open?.(),
  };
}

/** Дать оповещениям TanStack Query (они идут через `setTimeout`) дойти до экрана: иначе проверка «полосы нет» ничего не проверяет. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const pull = () => screen.getByTestId("screen-scroll").props.refreshControl.props as { refreshing: boolean; onRefresh: () => void };

describe("страница вуза: полоса «потянули вниз»", () => {
  it("сердечко перечитывает карточку молча: полоса не горит; студент потянул вниз - горит до ответа и гаснет", async () => {
    const t = fakeTransport({
      student_university_detail_v1: detail,
      student_university_favorites_v1: [],
      set_university_favorite_v1: { institutionId: uuidN(1), favored: true, favoritesCount: 1 },
    });
    const held = holdable(t.transport);
    const { client } = await renderPortal(<UniversityScreen />, testApi(held.transport, { tier: "approved" }));
    const fetching = () => client.getQueryState(["portal", "user-test", "university-detail", uuidN(1)])?.fetchStatus === "fetching";
    await screen.findByText("Университет 1");
    expect(pull().refreshing).toBe(false);

    // тап по сердечку: запись, затем перечитывание карточки; оно идёт без участия студента
    held.hold();
    await fireEvent.press(await screen.findByTestId("heart-Университет 1"));
    await waitFor(() => expect(held.started()).toBe(2));
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
    await waitFor(() => expect(held.started()).toBe(3));
    expect(pull().refreshing).toBe(true);
    await act(async () => held.release());
    await waitFor(() => expect(pull().refreshing).toBe(false));
  });

  it("перечитывание карточки сбросом запроса (как после «Добавить в мои программы») полосу не зажигает", async () => {
    const t = fakeTransport({ student_university_detail_v1: detail, student_university_favorites_v1: [] });
    const held = holdable(t.transport);
    const { client } = await renderPortal(<UniversityScreen />, testApi(held.transport, { tier: "approved" }));
    await screen.findByText("Университет 1");
    held.hold();
    await act(async () => {
      void client.invalidateQueries({ queryKey: ["portal", "user-test", "university-detail", uuidN(1)] });
    });
    await waitFor(() => expect(held.started()).toBe(2));
    await settle();
    expect(pull().refreshing).toBe(false);
    await act(async () => held.release());
  });
});
