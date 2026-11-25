// Оболочка кабинета (`(app)/_layout.tsx`) показывает карточку «Не удалось обновить уведомления», пока последний опрос не удался
// (веб: PortalNotificationUpdates). Здесь настоящая оболочка и настоящая карточка; вкладки, меню, транспорт заменены пустышками.
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as MockReact from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AppLayout from "@/app/(app)/_layout";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

const mockPoll = { failed: false, retry: jest.fn() };
const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => {
  const Tabs = Object.assign(() => MockReact.createElement(MockReact.Fragment), { Screen: () => null, Protected: ({ children }: { children: unknown }) => children });
  return { router: { navigate: jest.fn() }, usePathname: () => "/home", Tabs };
});
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "https://portal.example.test" }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => ({}) }));
jest.mock("@/api/PortalPoll", () => ({
  PortalPoll: ({ children }: { children: unknown }) => children,
  usePortalPollFailure: () => mockPoll,
}));
jest.mock("@/features/universities/IndexWarmup", () => ({ UniversityIndexWarmup: () => null }));
jest.mock("@/features/learning/csca/useCscaAccess", () => ({ useCscaAccess: () => ({ available: false }) }));
jest.mock("@/shell/ChatFab", () => ({ ChatFab: () => null }));
jest.mock("@/shell/MenuSheet", () => ({ MenuSheet: () => null }));
jest.mock("@/shell/TabBar", () => ({ TabBar: () => null }));
jest.mock("@/shell/TopBar", () => ({ TopBar: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const active = {
  kind: "active",
  session: {
    authority: { authUserId: "student-a", profileId: "p", membershipId: "m", organizationId: "o", displayName: "Тест Студентов", platformRole: "student", platformAccessVersion: 1 },
    portalCase: { id: "case-1", studentDisplayName: "Тест Студентов", targetCountry: null, caseState: "active", portalActivatedAt: "2026-11-01T00:00:00Z" },
    tier: "assisted",
  },
};
const renderLayout = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">
          <AppLayout />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

describe("оболочка кабинета: сбой опроса", () => {
  beforeEach(() => {
    mockPoll.failed = false;
    mockPoll.retry.mockClear();
    mockSession.state = active;
  });

  it("опрос в порядке: карточки нет", async () => {
    await renderLayout();
    expect(screen.queryByTestId("poll-failure")).toBeNull();
  });

  it("опрос не удался: карточка стоит в оболочке, «Повторить» зовёт опрос", async () => {
    mockPoll.failed = true;
    await renderLayout();
    expect(screen.getByText("Не удалось обновить уведомления.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("poll-failure-retry"));
    expect(mockPoll.retry).toHaveBeenCalledTimes(1);
  });
});
