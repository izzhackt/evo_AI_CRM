// «Запись на консультацию» на странице вуза (G14, решение владельца D1): студенту без сопровождения (approved) карточка запроса,
// клиенту с сопровождением (assisted) вместо неё «Написать EVO» (веб: `consultation` и `writeEvo` в `[id]/page.tsx`).
// Сервер не вызывается: транспорт поддельный.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { PortalShell, renderPortal, testApi, testClient } from "@/test-fixtures/render";
import { fakeTransport, STUDENT_CASE_ID, universityContent, uuidN } from "@/test-fixtures/universities";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));

const openRequest = {
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "requested",
  institutionId: uuidN(1),
  institutionName: "Университет Один",
  note: null,
  requestedAt: "2026-11-09T08:00:00+00:00",
  handledAt: null,
};

/** Карточка вуза `n`; `openConsultation` - открытый запрос, который страница уже знает (тогда история не читается). */
const detail = (n: number, openConsultation: unknown = null) => ({
  university: { id: uuidN(n), version: 1, publishedAt: "2026-10-01T00:00:00+00:00", content: universityContent(`Университет ${n}`) },
  country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия" } },
  city: null,
  favored: false,
  openConsultation,
  preparations: { studentCaseId: STUDENT_CASE_ID, items: [] },
  costs: null,
});

function server(open: unknown = null) {
  return fakeTransport({
    student_university_detail_v1: (args: Record<string, unknown> | undefined) => (args?.p_institution_id === uuidN(2) ? detail(2) : detail(1, open)),
    student_university_favorites_v1: [],
  });
}

beforeEach(() => {
  mockParams.current = { id: uuidN(1) };
});

describe("запрос консультации на странице вуза", () => {
  it("approved: карточка запроса; кнопки «Написать EVO» нет", async () => {
    const t = server();
    await renderPortal(<UniversityScreen />, testApi(t.transport, { tier: "approved" }));
    expect(await screen.findByTestId("consult-card")).toBeTruthy();
    expect(screen.getByTestId("consult-cta")).toBeTruthy();
    expect(screen.queryByTestId("university-write-evo")).toBeNull();
    // без заголовка и истории: это вариант страницы вуза, а не «Профиля»
    expect(screen.queryByText("Консультация")).toBeNull();
    expect(screen.queryByTestId("consult-history")).toBeNull();
  });

  it("assisted: «Написать EVO» вместо запроса консультации", async () => {
    const t = server();
    await renderPortal(<UniversityScreen />, testApi(t.transport, { tier: "assisted" }));
    expect(await screen.findByTestId("university-write-evo")).toBeTruthy();
    expect(screen.queryByTestId("consult-card")).toBeNull();
    expect(screen.queryByTestId("consult-cta")).toBeNull();
  });

  it("открытый запрос из карточки вуза показывается сразу, историю карточка не читает", async () => {
    const t = server(openRequest);
    await renderPortal(<UniversityScreen />, testApi(t.transport, { tier: "approved" }));
    expect(await screen.findByTestId("consult-sent")).toBeTruthy();
    expect(screen.queryByTestId("consult-cta")).toBeNull();
    expect(t.calls.some((call) => call.name === "own_portal_consultation_requests_v1")).toBe(false);
  });

  it("форма принадлежит вузу: набранное не переходит на страницу другого вуза", async () => {
    const t = server();
    const client = testClient();
    const api = testApi(t.transport, { tier: "approved" });
    const shell = () => (
      <PortalShell api={api} client={client}>
        <UniversityScreen />
      </PortalShell>
    );
    // вуз 2 открывается первым и остаётся в кэше: потом страница переключается на него на месте, без загрузки
    mockParams.current = { id: uuidN(2) };
    const view = await render(shell());
    await screen.findByText("Университет 2");
    mockParams.current = { id: uuidN(1) };
    await view.rerender(shell());
    await screen.findByText("Университет 1");
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.changeText(screen.getByTestId("consult-note"), "Хочу узнать о стипендии");
    expect(screen.getByTestId("consult-note").props.value).toBe("Хочу узнать о стипендии");
    mockParams.current = { id: uuidN(2) };
    await view.rerender(shell());
    await screen.findByText("Университет 2");
    expect(screen.queryByTestId("consult-note")).toBeNull();
    expect(screen.getByTestId("consult-cta")).toBeTruthy();
  });
});
