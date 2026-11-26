// Экран статуса анкеты, режим «только чтение» (вкладка кабинета): полоса «потянули вниз» горит только у перечитывания, которое начал студент
// (ревью, мелочь 29). Раньше в полосу шло `isRefetching`: любое фоновое перечитывание анкеты зажигало полосу само.
// Чтение идёт по настоящему пути на поддельном транспорте. У экрана свой кэш: его подменяет клиент без таймеров сборки (`gcTime: Infinity`),
// чтобы тест можно было сбросить и упавшая проверка не оставляла процесс Jest висеть на таймере, и чтобы им управлять из теста.
import { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react-native";

import { ApplicationStatusScreen } from "@/features/registration/ApplicationStatus";
import { holdRpc } from "@/test-fixtures/hold-rpc";
import { validDraft } from "@/test-fixtures/registration";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const mockDeps: { current: { supabase: unknown; transport: unknown; clearMetadata: () => Promise<void> } | null } = { current: null };
const mockOwnClient: { current: QueryClient | null } = { current: null };
jest.mock("@/features/registration/SignedInApplication", () => ({
  ...jest.requireActual("@/features/registration/SignedInApplication"),
  useSubmitDeps: () => mockDeps.current,
}));
jest.mock("@/session/SessionProvider", () => ({
  ...jest.requireActual("@/session/SessionProvider"),
  useSession: () => ({ refreshAccess: async () => undefined, signOut: async () => undefined }),
}));
jest.mock("@/api/PortalApi", () => {
  const { QueryClient: Client } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...jest.requireActual("@/api/PortalApi"),
    createPortalQueryClient: () => {
      mockOwnClient.current = new Client({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity } } });
      return mockOwnClient.current;
    },
  };
});
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));

const row = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "pending",
  revision: 2,
  email: "me@example.test",
  questionnaire: validDraft(),
  submitted_at: "2026-11-10T04:00:00+00:00",
  decided_at: null,
  decision_reason: null,
};

let held: ReturnType<typeof holdRpc> | null = null;
afterEach(() => {
  // Придержанное чтение отпускается всегда: упавшая проверка не должна оставлять запрос «в полёте».
  held?.release();
  held = null;
  mockOwnClient.current?.clear();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const pull = () => screen.getByTestId("screen-scroll").props.refreshControl.props as { refreshing: boolean; onRefresh: () => void };

describe("статус анкеты (только чтение): полоса «потянули вниз»", () => {
  it("фоновое перечитывание анкеты молчит, потянули вниз - полоса горит до ответа и гаснет", async () => {
    const t = fakeTransport({ own_student_application_v1: row });
    const gate = holdRpc(t.transport, "own_student_application_v1");
    held = gate;
    mockDeps.current = { supabase: {}, transport: gate.transport, clearMetadata: async () => undefined };
    await renderPortal(<ApplicationStatusScreen application={{ status: "pending" }} readOnly />, testApi(gate.transport));
    expect(await screen.findByTestId("application-email")).toBeTruthy();
    expect(pull().refreshing).toBe(false);
    expect(gate.started()).toBe(1);

    // перечитывание без участия студента (например, анкета устарела и экран вернулся в фокус)
    gate.hold();
    await act(async () => {
      void mockOwnClient.current!.invalidateQueries({ queryKey: ["own-student-application", "pending"] });
    });
    await waitFor(() => expect(gate.started()).toBe(2));
    await settle();
    expect(mockOwnClient.current!.getQueryState(["own-student-application", "pending"])?.fetchStatus).toBe("fetching");
    expect(pull().refreshing).toBe(false);
    await act(async () => gate.release());
    await settle();
    expect(pull().refreshing).toBe(false);

    // студент потянул вниз
    gate.hold();
    await act(async () => {
      pull().onRefresh();
    });
    await waitFor(() => expect(gate.started()).toBe(3));
    expect(pull().refreshing).toBe(true);
    await act(async () => gate.release());
    await waitFor(() => expect(pull().refreshing).toBe(false));
  });
});
