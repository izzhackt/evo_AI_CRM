import { screen } from "@testing-library/react-native";

import ApplicationRoute from "@/app/(app)/application";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { validDraft as mockValidDraft } from "@/test-fixtures/registration";

jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "http://portal.example.test", supabaseUrl: "http://s.test", supabasePublishableKey: "k" }) }));
const mockSignOut = jest.fn();
jest.mock("@/session/SessionProvider", () => ({ useSession: () => ({ refreshAccess: jest.fn(), signOut: mockSignOut }) }));
const mockCalls: string[] = [];
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: {} }),
  platformTransport: () => async (name: string) => {
    mockCalls.push(name);
    return {
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        status: "approved",
        revision: 2,
        email: "me@example.test",
        questionnaire: mockValidDraft(),
        submitted_at: "2026-11-08T10:00:00Z",
        decided_at: "2026-11-09T10:00:00Z",
        decision_reason: null,
      },
      error: null,
      status: 200,
    };
  },
}));

describe("«Открыть анкету» у approved: экран анкеты только для чтения", () => {
  it("статус и ответы показаны, а «Открыть кабинет», «Выйти» и исправления нет", async () => {
    await renderPortal(<ApplicationRoute />, testApi(async () => ({ data: null, error: null, status: 200 }), { tier: "approved" }));
    expect(await screen.findByText("Тест Студентов")).toBeTruthy();
    expect(screen.getByTestId("application-status-pill")).toBeTruthy();
    expect(mockCalls).toContain("own_student_application_v1");
    expect(screen.queryByTestId("gate-refresh")).toBeNull();
    expect(screen.queryByTestId("application-fix")).toBeNull();
    expect(screen.queryByText("Выйти")).toBeNull();
  });
});
