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
import { registerLocalDataCleaner } from "@/session/local-data";
import { onSignOut } from "@/session/sign-out-signal";
import { sessionHistory, sessionProbe } from "@/test-fixtures/session-probe";

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
  sessionHistory.length = 0;
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
      outcome = await sessionProbe.current?.setOwnPassword(syntheticPassword("test.temporary.next"));
    });
    expect(outcome).toBe("ok");
    await onScreen("(app)");
    expect(screen.queryByTestId("screen:set-password")).toBeNull();
    expect(probeText()).toBe("active|free|ready");
  });

  it("перезапуск с сохранённой временной сессией открывает тот же экран (этот путь не проходит через «Входим…» и работал всегда)", async () => {
    // сессию кладёт сама библиотека, без `signIn` из приложения: так на кодах до исправления путь тот же, и тест не зависит от исправления
    await getSupabase().auth.setSession(backend.tokensFor("test.temporary"));
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

  const rounds = (name: string) => backend.calls.filter((call) => call === `POST /rest/v1/rpc/${name}`).length;

  it("SIGNED_IN от библиотеки для токена, который вход уже маршрутизировал, второго опроса доступа не запускает", async () => {
    await startApp();
    await signInAs("approved");
    await onScreen("(app)");
    // `signInAs` дождался отложенного обработчика SIGNED_IN: к этому месту он уже отработал и пропущен
    expect(rounds("current_actor_authority")).toBe(1);
    expect(rounds("student_portal_cases")).toBe(1);
    expect(rounds("portal_consent_status_v1")).toBe(1);
  });

  it("настоящее обновление токена (новый токен) после входа не пропускается: опрос доступа идёт ещё раз", async () => {
    await startApp();
    await signInAs("approved");
    await onScreen("(app)");
    expect(rounds("current_actor_authority")).toBe(1);

    await act(async () => {
      await getSupabase().auth.refreshSession();
    });
    await waitFor(() => expect(rounds("current_actor_authority")).toBe(2));
    await waitFor(() => expect(probeText()).toBe("active|free|ready"));
  });

  it("обновление токена в открытом кабинете идёт тихо: «Проверяем доступ…» поверх кабинета не мелькает, даже когда сеть медленная", async () => {
    await startApp();
    await signInAs("approved");
    await onScreen("(app)");
    expect(sessionHistory.at(-1)).toBe("active"); // кабинет открыт, дальше смотрим только то, что нарисуется при обновлении токена

    sessionHistory.length = 0;
    backend.flags.rpcDelayMs = 25; // без задержки промежуточное состояние не успело бы нарисоваться
    // без `act`: пока опрос доступа ждёт сеть, приложение рисует то, что поставило; `waitFor` отдаёт отрисовке время
    const refreshing = getSupabase().auth.refreshSession();
    await waitFor(() => expect(rounds("portal_consent_status_v1")).toBe(2));
    await refreshing;
    await letEventsLand();
    expect(probeText()).toBe("active|free|ready");
    expect(sessionHistory).not.toContain("resolvingAccess");
  });
});

describe("выход, который ждёт ответа сервера, не трогает вход, начатый за это время", () => {
  // Счётчик стираний: `clearAllLocalData` зовут событие SIGNED_OUT (сразу) и хвост выхода (после ответа сервера).
  let cleaned: jest.Mock;
  let unregister: () => void;
  beforeEach(() => {
    cleaned = jest.fn(async () => undefined);
    unregister = registerLocalDataCleaner(cleaned);
  });
  afterEach(() => unregister());

  /** Выход начат и локальную сессию уже снял (экран входа показан), а сервер ещё не ответил об отзыве токена. */
  async function startSignOutThatWaitsForServer() {
    let release!: () => void;
    backend.flags.logoutGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished!: Promise<void>;
    await act(async () => {
      finished = sessionProbe.current!.signOut();
      await new Promise((resolve) => setTimeout(resolve, 0)); // отложенный SIGNED_OUT показывает экран входа
    });
    await onScreen("(auth)");
    return {
      /** Сервер ответил: хвост выхода получает слово. */
      async answer() {
        release();
        await act(async () => {
          await finished;
        });
        await letEventsLand();
      },
    };
  }

  it("обычный студент вошёл, пока выход ждал сервер: после ответа сервера он остаётся в кабинете", async () => {
    await startApp();
    await signInAs("assisted");
    await onScreen("(app)");
    const signingOut = await startSignOutThatWaitsForServer();

    expect(await signInAs("approved")).toEqual({ ok: true });
    await onScreen("(app)");
    await signingOut.answer();

    expect(screen.getByTestId("screen:(app)")).toBeTruthy();
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(probeText()).toBe("active|free|ready");
    // данные прежнего студента стёрло событие выхода; хвост выхода не стёр то, что уже копит новый
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it.each(["temporary", "portalonly"] as const)("%s: вошёл с временным паролем, пока выход ждал сервер: экран пароля остаётся, пометка не теряется", async (who) => {
    await startApp();
    await signInAs("assisted");
    await onScreen("(app)");
    const signingOut = await startSignOutThatWaitsForServer();

    expect(await signInAs(who)).toEqual({ ok: true });
    await onScreen("set-password");
    await signingOut.answer();

    expect(screen.getByTestId("screen:set-password")).toBeTruthy();
    expect(screen.queryByTestId("screen:(auth)")).toBeNull();
    expect(probeText()).toBe("resolvingAccess|must|ready");
  });

  it("если никто не входил, хвост выхода работает как раньше: экран входа, кабинет закрыт", async () => {
    await startApp();
    await signInAs("assisted");
    await onScreen("(app)");
    const signingOut = await startSignOutThatWaitsForServer();
    await signingOut.answer();

    expect(screen.getByTestId("screen:(auth)")).toBeTruthy();
    expect(probeText()).toBe("signedOut|free|ready");
    expect(cleaned).toHaveBeenCalledTimes(2); // событие выхода и хвост
  });

  it("новый вход начат, пока хвост выхода стирал локальные данные: состояние нового входа не сбрасывается", async () => {
    await startApp();
    await signInAs("assisted");
    await onScreen("(app)");
    // стирание зовут и хвост выхода, и событие SIGNED_OUT: держим обоих, отпускаем вместе
    const held: (() => void)[] = [];
    const unblock = () => held.forEach((release) => release());
    cleaned.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          held.push(resolve);
        }),
    );
    let finished!: Promise<void>;
    await act(async () => {
      finished = sessionProbe.current!.signOut();
      await new Promise((resolve) => setTimeout(resolve, 0)); // событие выхода показывает экран входа; стирание ждёт
    });
    await onScreen("(auth)");

    expect(await signInAs("approved")).toEqual({ ok: true });
    await onScreen("(app)");
    unblock();
    await act(async () => {
      await finished;
    });
    await letEventsLand();

    expect(screen.getByTestId("screen:(app)")).toBeTruthy();
    expect(probeText()).toBe("active|free|ready");
  });

  // Сессии записи открытых экранов (тест, тест на время, урок) подписаны на выход так же, как `useAbandonOnSignOut`: здесь вместо
  // экрана подписка с пометкой в журнале сервера, чтобы видеть порядок («бросил» раньше «отзыв токена») и кто кого бросил.
  describe("сессии записи открытых экранов (QA 23)", () => {
    let offs: (() => void)[] = [];
    afterEach(() => {
      offs.forEach((off) => off());
      offs = [];
    });
    function openScreenSession(label: string) {
      const abandon = jest.fn(() => void backend.calls.push(`abandon:${label}`));
      offs.push(onSignOut(abandon));
      return abandon;
    }

    it("кнопка «Выйти»: сессия открытого экрана брошена раньше запроса на отзыв токена (иначе закрытие экрана писало бы без токена)", async () => {
      await startApp();
      await signInAs("assisted");
      await onScreen("(app)");
      const old = openScreenSession("старый");
      const signingOut = await startSignOutThatWaitsForServer();

      expect(old).toHaveBeenCalled();
      const abandoned = backend.calls.indexOf("abandon:старый");
      const revoked = backend.calls.indexOf("POST /auth/v1/logout");
      expect(abandoned).toBeGreaterThanOrEqual(0);
      expect(revoked).toBeGreaterThan(abandoned);
      await signingOut.answer();
    });

    it("вход другого студента, пока выход ждал сервер: его сессии записи свежие, хвост выхода их не бросает, а его собственный выход бросает", async () => {
      await startApp();
      await signInAs("assisted");
      await onScreen("(app)");
      const old = openScreenSession("старый");
      const signingOut = await startSignOutThatWaitsForServer();

      expect(await signInAs("approved")).toEqual({ ok: true });
      await onScreen("(app)");
      const fresh = openScreenSession("новый"); // экран нового входа открывает свою сессию записи
      await signingOut.answer(); // хвост прежнего выхода пропущен (начат другой вход)

      expect(old).toHaveBeenCalled();
      expect(fresh).not.toHaveBeenCalled(); // сигнал событие, а не состояние: ни хвост, ни прежний выход новому входу не передаются
      expect(probeText()).toBe("active|free|ready");

      await signOutNow(); // новый студент выходит сам: сигнал по-прежнему живой
      expect(fresh).toHaveBeenCalled();
    });

    it("если никто не входил: после следующего входа сессии свежие, прежний выход на них не сказывается", async () => {
      await startApp();
      await signInAs("assisted");
      await onScreen("(app)");
      const old = openScreenSession("старый");
      const signingOut = await startSignOutThatWaitsForServer();
      await signingOut.answer();
      expect(old).toHaveBeenCalled();

      expect(await signInAs("approved")).toEqual({ ok: true });
      await onScreen("(app)");
      const fresh = openScreenSession("новый");
      await letEventsLand();
      expect(fresh).not.toHaveBeenCalled();
      expect(probeText()).toBe("active|free|ready");
    });
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

  it("установка сессии отказала: причина «сервис входа недоступен», экран входа свободен", async () => {
    await startApp();
    const refusal = new AuthApiError("refused", 400, "bad_jwt");
    jest.spyOn(getSupabase().auth, "setSession").mockResolvedValueOnce({ data: { user: null, session: null }, error: refusal });
    expect(await signInAs("approved")).toEqual({ ok: false, reason: "unavailable" });
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
  });

  it("библиотека не вернула ни сессии, ни ошибки: тоже «сервис входа недоступен», а не вечное «Входим…»; пометка «смените пароль» от этого входа не остаётся", async () => {
    await startApp();
    jest.spyOn(getSupabase().auth, "setSession").mockResolvedValueOnce({ data: { user: null, session: null }, error: null });
    // временный пароль: портал сказал «смените пароль», но сессии нет, и пометка не должна пережить неудавшийся вход
    expect(await signInAs("temporary")).toEqual({ ok: false, reason: "unavailable" });
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
  });

  it("`setSession` бросил исключение (запись сессии в хранилище не удалась): причина «недоступно», экран входа свободен, повторный вход работает", async () => {
    await startApp();
    jest.spyOn(getSupabase().auth, "setSession").mockRejectedValueOnce(new Error("хранилище недоступно"));
    expect(await signInAs("approved")).toEqual({ ok: false, reason: "unavailable" });
    await waitFor(() => expect(probeText()).toBe("signedOut|free|ready"));
    expect(screen.getByTestId("screen:(auth)")).toBeTruthy();

    // исключение было одноразовым: следующий вход идёт по-настоящему
    expect(await signInAs("approved")).toEqual({ ok: true });
    await onScreen("(app)");
    expect(probeText()).toBe("active|free|ready");
  });
});
