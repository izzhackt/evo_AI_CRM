/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import type { SessionState } from "@/session/access";
import { SessionProvider, useSession } from "@/session/SessionProvider";

jest.mock("expo-crypto", () => ({ randomUUID: () => require("node:crypto").randomUUID() }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "http://portal.example.test" }) }));
jest.mock("@/features/documents/download-cache", () => ({ clearDownloadCache: async () => undefined }));
jest.mock("@/features/registration/draft-store", () => ({ clearInviteToken: async () => undefined }));
jest.mock("@/session/local-data", () => ({ clearAllLocalData: async () => undefined }));

const mockOrder: string[] = [];
type Reply = { data: unknown; error: { code: string } | null; status: number };
const mockRpc = jest.fn(async (name: string, _args?: Record<string, unknown>): Promise<Reply> => {
  mockOrder.push(`rpc:${name}`);
  return { data: null, error: null, status: 200 };
});
const mockSession = { access_token: "t", user: { app_metadata: { evo_temporary_password: true } } };
const mockAuth = {
  onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
    setTimeout(() => cb("INITIAL_SESSION", mockSession), 0);
    return { data: { subscription: { unsubscribe: () => undefined } } };
  },
  getSession: async () => ({ data: { session: mockSession } }),
  refreshSession: async () => {
    mockOrder.push("refresh");
    return { data: {}, error: null };
  },
  signOut: async () => ({ error: null }),
};
jest.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ auth: mockAuth }),
  platformTransport: () => (name: string, args?: Record<string, unknown>) => mockRpc(name, args),
}));
jest.mock("@/api/portal-auth", () => ({
  createPortalAuthApi: () => ({
    setOwnPassword: async () => {
      mockOrder.push("password");
      return { ok: true };
    },
  }),
}));
let mockResolved: SessionState = { kind: "signedOut", accountDeleted: false };
jest.mock("@/session/deps", () => ({ createAccessDeps: () => ({}) }));
jest.mock("@/session/access", () => ({
  ...jest.requireActual("@/session/access"),
  resolveAccess: async () => {
    mockOrder.push("resolve");
    return mockResolved;
  },
}));

const portalSession = { authority: {}, portalCase: {}, tier: "approved" } as never;
// Контекст сессии выставляется наружу объектом-ячейкой (правило react-hooks/globals запрещает присваивать переменную в рендере).
const probe: { current: ReturnType<typeof useSession> | null } = { current: null };
function Probe() {
  const value = useSession();
  useEffect(() => {
    probe.current = value;
  });
  return <Text testID="state">{value.state.kind}</Text>;
}

beforeEach(() => {
  mockOrder.length = 0;
  mockRpc.mockClear();
  mockResolved = { kind: "needsConsent", session: portalSession };
});

describe("SessionProvider: согласия", () => {
  it("после смены пароля с галочками: пароль -> новая сессия -> запись согласий -> маршрут -> needsConsent/active", async () => {
    mockRpc.mockImplementation(async (name) => {
      mockOrder.push(`rpc:${name}`);
      return {
        data: { policyVersionCurrent: "2026-11-07", policyAcceptedVersion: "2026-11-07", aiStatus: "granted", aiPolicyVersion: "2026-10-25", aiPolicyVersionCurrent: "2026-10-25", needsDecision: false },
        error: null,
        status: 200,
      };
    });
    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probe.current?.ready).toBe(true));
    mockResolved = { kind: "active", session: portalSession };
    let outcome: string | undefined;
    await act(async () => {
      outcome = await probe.current?.setOwnPassword("synthetic-password-1", true);
    });
    expect(outcome).toBe("ok");
    expect(mockOrder).toEqual(["password", "refresh", "rpc:portal_consents_accept_v1", "resolve"]);
    expect(screen.getByTestId("state").props.children).toBe("active");
  });

  it("без галочек запись согласий не вызывается; сбой записи не мешает входу", async () => {
    mockRpc.mockImplementation(async (name) => {
      mockOrder.push(`rpc:${name}`);
      return { data: null, error: { code: "XX000" }, status: 500 };
    });
    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probe.current?.ready).toBe(true));
    await act(async () => {
      await probe.current?.setOwnPassword("synthetic-password-1");
    });
    expect(mockOrder).not.toContain("rpc:portal_consents_accept_v1");
    expect(screen.getByTestId("state").props.children).toBe("needsConsent");
    mockOrder.length = 0;
    await act(async () => {
      expect(await probe.current?.setOwnPassword("synthetic-password-1", true)).toBe("ok");
    });
    expect(mockOrder).toContain("rpc:portal_consents_accept_v1");
    expect(screen.getByTestId("state").props.children).toBe("needsConsent");
  });

  it("completeConsent открывает кабинет только из needsConsent", async () => {
    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probe.current?.ready).toBe(true));
    await act(async () => {
      await probe.current?.retry();
    });
    expect(screen.getByTestId("state").props.children).toBe("needsConsent");
    await act(async () => probe.current?.completeConsent());
    expect(screen.getByTestId("state").props.children).toBe("active");
  });
});
