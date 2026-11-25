/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// Вход стирает всё, что осталось от регистрации на этом устройстве: личную ссылку и ожидание подтверждения почты (рецензия #1563, L2).
// Настоящие хранилища (поддельный SecureStore в памяти), настоящий SessionProvider; сеть и Supabase заменены.
import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import { savePendingSignup } from "@/features/registration/pending-store";
import { saveInviteToken } from "@/features/registration/draft-store";
import type { SignInResult } from "@/api/portal-auth";
import { SessionProvider, useSession } from "@/session/SessionProvider";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => require("node:crypto").randomUUID() }));
jest.mock("@/config", () => ({ getConfig: () => ({ portalBaseUrl: "http://portal.example.test" }) }));
jest.mock("@/features/documents/download-cache", () => ({ clearDownloadCache: async () => undefined }));
jest.mock("@/session/local-data", () => ({ clearAllLocalData: async () => undefined }));

let mockSignIn: () => Promise<SignInResult> = async () => ({ ok: false, reason: "invalid_credentials" });
jest.mock("@/api/portal-auth", () => ({ createPortalAuthApi: () => ({ signIn: () => mockSignIn() }) }));
let mockSetSessionError: { message: string } | null = null;
const mockAuth = {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  setSession: async () => ({ error: mockSetSessionError }),
  getSession: async () => ({ data: { session: null } }),
  refreshSession: async () => ({ data: {}, error: null }),
  signOut: async () => ({ error: null }),
};
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: mockAuth }), platformTransport: () => async () => ({ data: null, error: null, status: 200 }) }));
jest.mock("@/session/deps", () => ({ createAccessDeps: () => ({}) }));
jest.mock("@/session/access", () => ({ ...jest.requireActual("@/session/access"), resolveAccess: async () => ({ kind: "signedOut", accountDeleted: false }) }));

const INVITE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 0, expiresIn: 0, tokenType: "bearer", mustSetPassword: false };
const probe: { current: ReturnType<typeof useSession> | null } = { current: null };
function Probe() {
  const value = useSession();
  useEffect(() => {
    probe.current = value;
  });
  return <Text>{value.state.kind}</Text>;
}

async function seed() {
  await saveInviteToken(INVITE);
  await savePendingSignup({ maskedEmail: "t***@example.test", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), retryAfterSeconds: 30, dispatch: "accepted", resendCapability: "cap.synthetic_1" });
  expect([...mockSecure.keys()].sort()).toEqual(["evo.registration-invite.v1", "evo.registration-pending.v1"]);
}

beforeEach(() => {
  mockSecure.clear();
  mockSetSessionError = null;
  mockSignIn = async () => ({ ok: false, reason: "invalid_credentials" });
});

describe("SessionProvider.signIn и остатки регистрации", () => {
  it("успешный вход стирает личную ссылку и ожидание подтверждения почты", async () => {
    await seed();
    mockSignIn = async () => ({ ok: true, session: tokens });
    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probe.current).not.toBeNull());
    let outcome: unknown;
    await act(async () => {
      outcome = await probe.current?.signIn("test.student", "synthetic-password");
    });
    expect(outcome).toEqual({ ok: true });
    await waitFor(() => expect(mockSecure.size).toBe(0));
  });

  it("неудачный вход ничего не стирает: человек ещё может вернуться к «Подтвердите почту»", async () => {
    await seed();
    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probe.current).not.toBeNull());
    let outcome: unknown;
    await act(async () => {
      outcome = await probe.current?.signIn("test.student", "wrong");
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid_credentials" });
    expect([...mockSecure.keys()].sort()).toEqual(["evo.registration-invite.v1", "evo.registration-pending.v1"]);
  });

  it("вход не удался на установке сессии: остатки на месте", async () => {
    await seed();
    mockSignIn = async () => ({ ok: true, session: tokens });
    mockSetSessionError = { message: "refused" };
    await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probe.current).not.toBeNull());
    await act(async () => {
      await probe.current?.signIn("test.student", "synthetic-password");
    });
    expect(mockSecure.size).toBe(2);
  });
});
