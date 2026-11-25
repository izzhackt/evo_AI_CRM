// «Подбор с Эви»: смещение клавиатуры на iPhone равно отступу безопасной зоны плюс высота верхней полосы кабинета. Высота берётся
// из общей меры `shell/top-bar-metrics`, а не своим числом (разбор ревью #1565): тест подменяет меру и видит, что экран идёт за ней.
import { screen } from "@testing-library/react-native";
import { Platform } from "react-native";

import type { EviApi } from "@/features/learning/evi/api";
import { EviScreen } from "@/features/learning/evi/EviScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), dismissTo: jest.fn(), canGoBack: () => false, back: jest.fn() },
  useRouter: () => ({ canGoBack: () => false, back: jest.fn(), navigate: jest.fn() }),
}));
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => true }));
jest.mock("@/features/learning/evi/EviRobot", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ...jest.requireActual("@/features/learning/evi/EviRobot"),
    EviRobot: (props: { testID?: string }) => React.createElement(View, { testID: props.testID ?? "evi-robot", accessibilityElementsHidden: true }),
  };
});
// Настоящий `KeyboardAvoidingView` в дереве испытаний - не виден (только его вложенный `View`), поэтому заменён: он отдаёт смещение
// наружу обычным свойством.
jest.mock("react-native/Libraries/Components/Keyboard/KeyboardAvoidingView", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: ({ keyboardVerticalOffset, children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement(View, { ...rest, keyboardVerticalOffset }, children),
  };
});
let mockBarHeight = 52;
jest.mock("@/shell/top-bar-metrics", () => ({
  get TOP_BAR_HEIGHT() {
    return mockBarHeight;
  },
}));

const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };
const api: EviApi = { ask: async () => ({ ok: false, code: "unavailable" }) as never, available: async () => true };

describe("Эви: смещение клавиатуры", () => {
  it("iPhone: отступ безопасной зоны (47) + общая мера высоты верхней полосы, а не число в экране", async () => {
    mockBarHeight = 64;
    const { transport } = fakeTransport({ portal_ai_consent_get_v1: GRANTED });
    await renderPortal(<EviScreen api={api} />, testApi(transport));
    expect(Platform.OS).toBe("ios");
    expect((await screen.findByTestId("evi-screen")).props.keyboardVerticalOffset).toBe(47 + 64);
  });
});
