/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// Вход после выхода в том же запуске приложения (QA#2, D1) и всё, что должно держаться вокруг: обычный студент, смена временного
// пароля, перезапуск с сохранённой сессией, неудачный вход. НАСТОЯЩИЕ: корневой макет с охранниками маршрутов, `SessionProvider`,
// клиент Supabase со своими событиями, маршрутизатор доступа и вызовы портала. Заменена только сеть и родные хранилища. Корень D1
// проверен в `sign-in-temporary-fresh.test.tsx` (чистый запуск): выход ни при чём, колесо «Войти» держало состояние `authenticating`.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthApiError } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react-native";

import RootLayout from "@/app/_layout";
import { getSupabase } from "@/lib/supabase";
import { fakeAccount, installFakeBackend, syntheticPassword, type FakeAccount, type FakeBackend } from "@/test-fixtures/auth-backend";
import { sessionProbe } from "@/test-fixtures/session-probe";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock("@/polyfills", () => ({}));
jest.mock("expo-font", () => ({ useFonts: () => [true] }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: async () => true, hideAsync: async () => true }));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: ({ children }: { children: unknown }) => children }));
jest.mock("@/features/app/UpdatePrompt", () => ({ UpdatePrompt: () => null }));
jest.mock("@/config", () => {
  const { PORTAL_URL, SUPABASE_URL } = require("@/test-fixtures/auth-backend");
  return { ConfigError: class extends Error {}, getConfig: () => ({ supabaseUrl: SUPABASE_URL, supabasePublishableKey: "sb_publishable_synthetic", portalBaseUrl: PORTAL_URL }) };
});
jest.mock("expo-router", () => require("@/test-fixtures/expo-router-guards"));

type Who = "assisted" | "approved" | "temporary" | "portalonly";
const makeAccounts = (): FakeAccount[] => [
  fakeAccount({ login: "test.assisted", id: "00000000-0000-4000-8000-000000000001", temporary: false, caseState: "active" }),
  fakeAccount({ login: "test.approved", id: "00000000-0000-4000-8000-000000000002", temporary: false }),
  fakeAccount({ login: "test.temporary", id: "00000000-0000-4000-8000-000000000003", temporary: true }),
  fakeAccount({ login: "test.portalonly", id: "00000000-0000-4000-8000-000000000004", temporary: true, markerInToken: false }),
];

let backend: FakeBackend;

beforeEach(async () => {
  backend = installFakeBackend(makeAccounts());
  // клиент один на запуск и держит сессию прошлого теста: каждый тест начинается с чистого устройства
  await getSupabase().auth.signOut({ scope: "local" });
  mockSecure.clear();
  await AsyncStorage.clear();
  backend.calls.length = 0;
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await getSupabase().auth.stopAutoRefresh();
});

const onScreen = (name: string) => waitFor(() => expect(screen.getByTestId(`screen:${name}`)).toBeTruthy());
const probeText = () => screen.getByTestId("session-probe").props.children;

/**
 * Даёт отложенным обработчикам событий библиотеки (приложение уходит из колбэка через `setTimeout(0)`) отработать до следующего шага.
 * На устройстве между выходом и следующим входом проходят сеть и хранилище, и обработчик давно позади; здесь сеть мгновенная, и без этого
 * шага отложенный SIGNED_OUT мог бы выстрелить уже после нового входа. Таймер этого шага ставится позже обработчиков и идёт после них.
 */
const letEventsLand = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function signInAs(who: Who) {
  let outcome: unknown;
  await act(async () => {
    outcome = await sessionProbe.current?.signIn(`test.${who}`, syntheticPassword(`test.${who}`));
  });
  await letEventsLand();
  return outcome;
}
async function signOutNow() {
  await act(async () => {
    await sessionProbe.current?.signOut();
  });
  await letEventsLand();
}
async function startApp() {
  const view = await render(<RootLayout />);
  await onScreen("(auth)");
  return view;
}

describe("вход после выхода в том же запуске", () => {
  it("QA#2 D1: вошёл сопровождаемый, вышел, вошёл временным паролем - «Придумайте свой пароль», а не вечное «Войти»", async () => {
    await startApp();
    expect(await signInAs("assisted")).toEqual({ ok: true });
    await onScreen("(app)");

    await signOutNow();
    await onScreen("(auth)");
    expect(probeText()).toBe("signedOut|free|ready");

    expect(await signInAs("temporary")).toEqual({ ok: true });
    await onScreen("set-password");
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(probeText()).toBe("resolvingAccess|must|ready");
  });

  it("портал сказал «смените пароль», а пометки о временном пароле в токене нет: экран пароля всё равно открывается (ответ S3 важнее токена)", async () => {
    await startApp();
    expect(await signInAs("portalonly")).toEqual({ ok: true });
    await onScreen("set-password");
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(probeText()).toBe("resolvingAccess|must|ready");
    // кабинет не опрашивается: пока пароль не сменён, база не спрашивается
    expect(backend.calls.some((call) => call.includes("/rest/v1/rpc/"))).toBe(false);
  });

  it("обычный студент после выхода входит и открывает кабинет (как и до исправления)", async () => {
    await startApp();
    await signInAs("assisted");
    await onScreen("(app)");
    await signOutNow();
    await onScreen("(auth)");

    expect(await signInAs("approved")).toEqual({ ok: true });
    await onScreen("(app)");
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(screen.queryByTestId("screen:set-password")).toBeNull();
    expect(probeText()).toBe("active|free|ready");
  });

  it("временный пароль, смена пароля и кабинет: после «Придумайте свой пароль» открывается кабинет", async () => {
    await startApp();
    await signInAs("temporary");
    await onScreen("set-password");

    let outcome: unknown;
    await act(async () => {
      outcome = await sessionProbe.current?.setOwnPassword("new-password-12345");
    });
    expect(outcome).toBe("ok");
    await onScreen("(app)");
    expect(screen.queryByTestId("screen:set-password")).toBeNull();
    expect(probeText()).toBe("active|free|ready");
  });

  it("перезапуск с сохранённой временной сессией открывает тот же экран (этот путь не проходит через «Входим…» и работал всегда)", async () => {
    const first = await startApp();
    await signInAs("temporary");
    await onScreen("set-password");
    await first.unmount();
    backend.calls.length = 0;

    await render(<RootLayout />);
    await onScreen("set-password");
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(probeText()).toBe("resolvingAccess|must|ready");
    expect(backend.calls).toEqual([]);
  });
});

describe("маршрут после входа ведёт сам вход", () => {
  /** Библиотека не доставляет SIGNED_IN: слушатель, поставленный приложением, его не получает. */
  function swallowSignedIn() {
    const auth = getSupabase().auth;
    const original = auth.onAuthStateChange.bind(auth);
    jest.spyOn(auth, "onAuthStateChange").mockImplementation(((callback: Parameters<typeof original>[0]) =>
      original((event, session) => {
        if (event === "SIGNED_IN") return undefined;
        return callback(event, session);
      })) as typeof auth.onAuthStateChange);
  }

  it("без SIGNED_IN временный пароль всё равно ведёт на экран пароля, а не оставляет «Входим…»", async () => {
    swallowSignedIn();
    await startApp();
    await signInAs("temporary");
    await onScreen("set-password");
    expect(probeText()).toBe("resolvingAccess|must|ready");
  });

  it("без SIGNED_IN обычный студент всё равно попадает в кабинет", async () => {
    swallowSignedIn();
    await startApp();
    await signInAs("approved");
    await onScreen("(app)");
    expect(probeText()).toBe("active|free|ready");
  });

  it("часы телефона ушли вперёд, токен портала «просрочен»: клиент обновляет сессию сам (TOKEN_REFRESHED, SIGNED_IN нет), маршрут один и верный", async () => {
    backend.flags.portalTokensExpired = true;
    await startApp();
    await signInAs("temporary");
    await onScreen("set-password");
    await signOutNow();
    await onScreen("(auth)");
    backend.calls.length = 0;

    await signInAs("approved");
    await onScreen("(app)");
    expect(backend.calls).toContain("POST /auth/v1/token"); // сессию обновил клиент, а не портал
    expect(backend.calls.filter((call) => call === "POST /rest/v1/rpc/current_actor_authority")).toHaveLength(1);
    expect(probeText()).toBe("active|free|ready");
  });

  it("SIGNED_IN от библиотеки для токена, который вход уже маршрутизировал, второго опроса доступа не запускает", async () => {
    await startApp();
    await signInAs("approved");
    await onScreen("(app)");
    // `signInAs` дождался отложенного обработчика SIGNED_IN: к этому месту он уже отработал и пропущен
    const rounds = (name: string) => backend.calls.filter((call) => call === `POST /rest/v1/rpc/${name}`).length;
    expect(rounds("current_actor_authority")).toBe(1);
    expect(rounds("student_portal_cases")).toBe(1);
    expect(rounds("portal_consent_status_v1")).toBe(1);
  });
});

describe("вход, который не удался, не оставляет «Входим…»", () => {
  it("неверный пароль: причина возвращается, экран входа свободен", async () => {
    await startApp();
    let outcome: unknown;
    await act(async () => {
      outcome = await sessionProbe.current?.signIn("test.temporary", "wrong-password");
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid_credentials" });
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
    expect(screen.getByTestId("screen:(auth)")).toBeTruthy();
  });

  it("установка сессии отказала: «Не удалось», экран входа свободен", async () => {
    await startApp();
    const refusal = new AuthApiError("refused", 400, "bad_jwt");
    jest.spyOn(getSupabase().auth, "setSession").mockResolvedValueOnce({ data: { user: null, session: null }, error: refusal });
    expect(await signInAs("approved")).toEqual({ ok: false, reason: "unavailable" });
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
  });

  it("библиотека не вернула ни сессии, ни ошибки: тоже «Не удалось», а не вечное «Входим…»", async () => {
    await startApp();
    jest.spyOn(getSupabase().auth, "setSession").mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
    expect(await signInAs("approved")).toEqual({ ok: false, reason: "unavailable" });
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
  });
});
