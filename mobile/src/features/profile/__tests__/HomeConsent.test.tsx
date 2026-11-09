import { screen, waitFor } from "@testing-library/react-native";

import { HomeScreen } from "@/features/home/HomeScreen";
import { OVERVIEW_ROW, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

const consent = { status: null, policyVersion: null, decidedAt: null, currentPolicyVersion: "2026-10-25" };
const handlers = {
  student_portal_overview_v2: [OVERVIEW_ROW],
  student_portal_finance_v2: [PAYMENT_ROW],
  student_portal_notifications_v2: [],
  student_country_choice_v1: { country: "MY", source: "saved", savedAt: "2026-11-01T08:00:00+00:00" },
  student_university_favorites_v1: [],
  portal_ai_consent_get_v1: consent,
};

describe("Главная: согласие на ИИ-помощников", () => {
  it("assisted без решения: карточка под шапкой, раньше остальных блоков", async () => {
    const { transport } = fakeTransport(handlers);
    await renderPortal(<HomeScreen />, testApi(transport));
    await screen.findByTestId("ai-consent-card");
    const screenNode = screen.getByTestId("home-screen");
    const flat = JSON.stringify(screenNode.children.map((c) => (typeof c === "object" && "props" in c ? c.props.testID ?? "" : "")));
    expect(flat.indexOf("ai-consent-card")).toBeLessThan(flat.indexOf("slot-case"));
  });

  it("approved: карточки нет и согласие не читается", async () => {
    const { transport, calls } = fakeTransport(handlers);
    await renderPortal(<HomeScreen />, testApi(transport, { tier: "approved" }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("ai-consent-card")).toBeNull();
    expect(calls.some((c) => c.name === "portal_ai_consent_get_v1")).toBe(false);
  });
});
