// Оболочка кабинета (`(app)/_layout.tsx`) держит память разговора с Эви и уносит её с собой при выходе (веб #1530: разговор
// живёт, пока открыт кабинет). Здесь настоящая оболочка; всё, что к памяти не относится (вкладки, опрос, меню, транспорт),
// заменено пустышками.
import { render } from "@testing-library/react-native";
import * as MockReact from "react";
import { useEffect } from "react";

import AppLayout from "@/app/(app)/_layout";
import { useEviMemory } from "@/features/learning/evi/EviMemory";
import type { EviMemory, EviSnapshot } from "@web/lib/portal/evi-memory";

const mockSink: { memory: EviMemory | null } = { memory: null };
let mockOwner = "student-a";
/** Экран кабинета: берёт память так же, как «Подбор с Эви» (`useEviMemory(userKey)`). */
function MockScreen() {
  const memory = useEviMemory(mockOwner);
  useEffect(() => {
    mockSink.memory = memory;
    return () => {
      mockSink.memory = null;
    };
  }, [memory]);
  return null;
}

const mockSession: { state: unknown; signOut: jest.Mock } = { state: null, signOut: jest.fn() };
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => {
  const Tabs = Object.assign(() => MockReact.createElement(MockScreen), { Screen: () => null, Protected: ({ children }: { children: unknown }) => children });
  return { router: { navigate: jest.fn() }, usePathname: () => "/professions/evi", Tabs };
});
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "https://portal.example.test" }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({}), platformTransport: () => ({}) }));
jest.mock("@/api/PortalPoll", () => ({ PortalPoll: ({ children }: { children: unknown }) => children }));
jest.mock("@/features/universities/IndexWarmup", () => ({ UniversityIndexWarmup: () => null }));
jest.mock("@/features/learning/csca/useCscaAccess", () => ({ useCscaAccess: () => ({ available: false }) }));
jest.mock("@/shell/ChatFab", () => ({ ChatFab: () => null }));
jest.mock("@/shell/MenuSheet", () => ({ MenuSheet: () => null }));
jest.mock("@/shell/PollFailureNotice", () => ({ PollFailureNotice: () => null }));
jest.mock("@/shell/TabBar", () => ({ TabBar: () => null }));
jest.mock("@/shell/TopBar", () => ({ TopBar: () => null }));

const active = (authUserId: string) => ({
  kind: "active",
  session: {
    authority: { authUserId, profileId: "p", membershipId: "m", organizationId: "o", displayName: "Тест Студентов", platformRole: "student", platformAccessVersion: 1 },
    portalCase: { id: "case-1", studentDisplayName: "Тест Студентов", targetCountry: null, caseState: "active", portalActivatedAt: "2026-11-01T00:00:00Z" },
    tier: "assisted",
  },
});
const signedOut = { kind: "signedOut", accountDeleted: false };

const talk: EviSnapshot = {
  messages: [{ role: "assistant", text: "Привет! Я Эви" }, { role: "user", text: "Рисую" }],
  options: { options: [], multi: false },
  failure: null,
};

describe("оболочка кабинета и память разговора с Эви", () => {
  beforeEach(() => {
    mockSink.memory = null;
    mockOwner = "student-a";
    mockSession.state = active("student-a");
  });

  it("экран кабинета получает память: она отдаёт записанное, пока оболочка открыта", async () => {
    const view = await render(<AppLayout />);
    expect(mockSink.memory).not.toBeNull();
    mockSink.memory!.save(talk);
    // Перерисовка оболочки (обновился токен, новая сессия того же студента) память не стирает.
    mockSession.state = active("student-a");
    await view.rerender(<AppLayout />);
    expect(mockSink.memory!.load()).toBe(talk);
  });

  it("выход уносит разговор: после нового входа (тот же или другой студент) память пуста", async () => {
    const view = await render(<AppLayout />);
    mockSink.memory!.save(talk);

    mockSession.state = signedOut;
    await view.rerender(<AppLayout />);
    expect(mockSink.memory).toBeNull();

    mockSession.state = active("student-a");
    await view.rerender(<AppLayout />);
    expect(mockSink.memory!.load()).toBeNull();

    mockSink.memory!.save(talk);
    mockSession.state = signedOut;
    await view.rerender(<AppLayout />);
    mockOwner = "student-b";
    mockSession.state = active("student-b");
    await view.rerender(<AppLayout />);
    expect(mockSink.memory!.load()).toBeNull();
  });

  it("кабинет не открыт (согласие, шлюз, «Проверяем доступ»): памяти нет вовсе", async () => {
    mockSession.state = { kind: "resolvingAccess" };
    await render(<AppLayout />);
    expect(mockSink.memory).toBeNull();
  });
});
