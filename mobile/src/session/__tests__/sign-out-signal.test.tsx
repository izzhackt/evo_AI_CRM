/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
// Сигнал выхода из кабинета (QA 23): сессии записи (тест, тест на время, урок) отказываются от неотправленного, как только выход
// начался. Раньше закрытие экрана после ответа на запрос отзыва токена досылало запись уже без токена, и сервер отвечал 401
// (`save_learning_test_v1` сразу после `/auth/v1/logout`). Здесь: сам сигнал и то, что настоящий SessionProvider даёт его ПЕРВЫМ
// делом на каждом пути выхода (кнопка, событие SIGNED_OUT, пропавшая сессия, удалённый аккаунт) и что выход, который не удался
// (хранилище отказало стереть сессию), не оставляет студента на мёртвых экранах; Supabase и сеть заменены.
import { act, render, renderHook, waitFor } from "@testing-library/react-native";
import { useEffect, type ReactElement } from "react";
import { Alert, Text } from "react-native";

import { LangProvider } from "@/i18n/LangProvider";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { announceSignOut, onSignOut, useAbandonOnSignOut } from "@/session/sign-out-signal";

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

/** Порядок событий: что случилось раньше, чем что (сигнал выхода, отзыв токена, очистка телефона). */
const mockOrder: string[] = [];
jest.mock("@/session/local-data", () => ({ clearAllLocalData: async () => void mockOrder.push("clearAllLocalData") }));

type AuthCallback = (event: string, session: unknown) => void;
let mockAuthCallback: AuthCallback | null = null;
let mockAccountDeleted = false;
/** Выход, который не удался: хранилище отказало стереть сессию, `signOut` библиотеки отклоняется и SIGNED_OUT не приходит. */
let mockSignOutFailure: Error | null = null;
/** Отклонение (или ответ) выхода придерживается, пока тест не отпустит: за это время можно начать другой вход. */
let mockSignOutGate: Promise<void> | null = null;
/** Что маршрутизатор доступа отвечает на «открой кабинет» и сколько раз его спрашивали. */
let mockResolved: unknown = { kind: "signedOut", accountDeleted: false };
let mockResolveCalls = 0;
/** Ответ маршрутизатора придерживается, пока тест не отпустит: промежуточное «Проверяем доступ…» успевает отрисоваться, как на устройстве. */
let mockResolveGate: Promise<void> | null = null;
const mockAuth = {
  onAuthStateChange: (callback: AuthCallback) => {
    mockAuthCallback = callback;
    return { data: { subscription: { unsubscribe: () => undefined } } };
  },
  setSession: async () => ({ error: null }),
  getSession: async () => ({ data: { session: null } }),
  refreshSession: async () => ({ data: {}, error: null }),
  signOut: async () => {
    mockOrder.push("auth.signOut");
    if (mockSignOutGate) await mockSignOutGate;
    if (mockSignOutFailure) throw mockSignOutFailure;
    return { error: null };
  },
};
jest.mock("@/api/portal-auth", () => ({ createPortalAuthApi: () => ({ signIn: async () => ({ ok: false, reason: "invalid_credentials" }) }) }));
jest.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: mockAuth }), platformTransport: () => async () => ({ data: null, error: null, status: 200 }) }));
jest.mock("@/session/deps", () => ({ createAccessDeps: () => ({ authUserIsDeleted: async () => mockAccountDeleted }) }));
jest.mock("@/session/access", () => ({
  ...jest.requireActual("@/session/access"),
  resolveAccess: async () => {
    mockResolveCalls += 1;
    if (mockResolveGate) await mockResolveGate;
    return mockResolved;
  },
}));

const probe: { current: ReturnType<typeof useSession> | null } = { current: null };
/** Какие состояния сессии были нарисованы по порядку (подряд одинаковые склеены): видно, снимался ли кабинет. */
const history: string[] = [];
function Probe() {
  const value = useSession();
  useEffect(() => {
    probe.current = value;
    if (history.at(-1) !== value.state.kind) history.push(value.state.kind);
  });
  return <Text>{value.state.kind}</Text>;
}

async function mountProvider(wrap: (children: ReactElement) => ReactElement = (children) => children) {
  await render(
    wrap(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    ),
  );
  await waitFor(() => expect(probe.current).not.toBeNull());
  await waitFor(() => expect(mockAuthCallback).not.toBeNull());
}
/** Событие Supabase доходит до провайдера через `setTimeout(0)`: ждём его внутри `act`, чтобы обновления состояния были учтены. */
async function emit(event: string, session: unknown) {
  await act(async () => {
    mockAuthCallback?.(event, session);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

let unsubscribe: (() => void) | null = null;
beforeEach(() => {
  mockOrder.length = 0;
  mockAuthCallback = null;
  mockAccountDeleted = false;
  mockSignOutFailure = null;
  mockSignOutGate = null;
  mockResolved = { kind: "signedOut", accountDeleted: false };
  mockResolveCalls = 0;
  mockResolveGate = null;
  history.length = 0;
  probe.current = null;
  unsubscribe = onSignOut(() => void mockOrder.push("signal"));
});
afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

describe("сигнал выхода: подписка и рассылка", () => {
  it("каждый подписчик получает сигнал один раз, по порядку подписки; отписавшийся больше не получает", () => {
    const seen: string[] = [];
    const off1 = onSignOut(() => void seen.push("first"));
    const off2 = onSignOut(() => void seen.push("second"));
    announceSignOut();
    expect(seen).toEqual(["first", "second"]);
    off1();
    announceSignOut();
    expect(seen).toEqual(["first", "second", "second"]);
    off2();
    announceSignOut();
    expect(seen).toHaveLength(3);
  });

  it("сбой одного подписчика не оставляет других писать", () => {
    const seen: string[] = [];
    const offBad = onSignOut(() => {
      throw new Error("boom");
    });
    const offGood = onSignOut(() => void seen.push("good"));
    expect(() => announceSignOut()).not.toThrow();
    expect(seen).toEqual(["good"]);
    offBad();
    offGood();
  });

  it("подписка, сделанная прямо во время рассылки, начинает действовать со следующей (иначе подписчик, подписывающий подписчиков, зациклил бы рассылку)", () => {
    const seen: string[] = [];
    const late: { off: (() => void) | null } = { off: null };
    const offFirst = onSignOut(() => {
      seen.push("first");
      late.off ??= onSignOut(() => void seen.push("late"));
    });
    announceSignOut();
    expect(seen).toEqual(["first"]);
    announceSignOut();
    expect(seen).toEqual(["first", "first", "late"]);
    offFirst();
    late.off?.();
  });
});

describe("сигнал выхода это событие, а не состояние (сессии следующего студента свежие)", () => {
  it("подписчик, подписавшийся после сигнала, его задним числом не получает; следующий сигнал получает", () => {
    const earlier = jest.fn();
    const offEarlier = onSignOut(earlier);
    announceSignOut();
    const later = jest.fn();
    const offLater = onSignOut(later);
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    announceSignOut();
    expect(later).toHaveBeenCalledTimes(1);
    offEarlier();
    offLater();
  });
});

describe("useAbandonOnSignOut: сессия бросает неотправленное", () => {
  it("сигнал зовёт `abandon`; после размонтирования и при смене сессии старая не зовётся", async () => {
    const first = { abandon: jest.fn() };
    const second = { abandon: jest.fn() };
    const hook = await renderHook<void, { target: { abandon(): void } }>(({ target }) => useAbandonOnSignOut(target), { initialProps: { target: first } });
    announceSignOut();
    expect(first.abandon).toHaveBeenCalledTimes(1);
    await hook.rerender({ target: second });
    announceSignOut();
    expect(first.abandon).toHaveBeenCalledTimes(1);
    expect(second.abandon).toHaveBeenCalledTimes(1);
    await hook.unmount();
    announceSignOut();
    expect(second.abandon).toHaveBeenCalledTimes(1);
  });
});

describe("SessionProvider даёт сигнал выхода первым делом на каждом пути выхода", () => {
  it("кнопка «Выйти»: сигнал раньше запроса на отзыв токена и очистки телефона (иначе закрытие экрана писало бы с отозванным токеном)", async () => {
    await mountProvider();
    await act(async () => {
      await probe.current?.signOut();
    });
    expect(mockOrder).toEqual(["signal", "auth.signOut", "clearAllLocalData"]);
  });

  it("событие SIGNED_OUT от Supabase (выход с другого пути): сигнал раньше очистки телефона", async () => {
    await mountProvider();
    await emit("SIGNED_OUT", null);
    expect(mockOrder).toEqual(["signal", "clearAllLocalData"]);
  });

  it("сессия пропала (INITIAL_SESSION без сессии, истёк токен обновления): сигнал есть", async () => {
    await mountProvider();
    await emit("INITIAL_SESSION", null);
    expect(mockOrder).toEqual(["signal"]);
  });

  it("обычное обновление токена при живой сессии сигнала не даёт: тест не бросается без причины", async () => {
    await mountProvider();
    await emit("TOKEN_REFRESHED", { user: { app_metadata: {} } });
    await waitFor(() => expect(probe.current?.ready).toBe(true));
    expect(mockOrder).toEqual([]);
  });

  it("аккаунт удалён (проверка при «Обновить статус»): сигнал раньше отзыва токена", async () => {
    mockAccountDeleted = true;
    await mountProvider();
    await act(async () => {
      await probe.current?.refreshAccess();
    });
    expect(mockOrder).toEqual(["signal", "auth.signOut"]);
  });
});

describe("выход не удался: хранилище отказало стереть сессию (ревью #1594, низкий)", () => {
  const ACTIVE = { kind: "active", session: {} };
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());

  /** Студент в кабинете: маршрутизатор доступа отвечает «открыт». */
  async function signedInStudent(wrap?: (children: ReactElement) => ReactElement) {
    mockResolved = ACTIVE;
    await mountProvider(wrap);
    await emit("SIGNED_IN", { access_token: "token-1", user: { app_metadata: {} } });
    await waitFor(() => expect(probe.current?.state.kind).toBe("active"));
  }

  it("вызов не отклоняется; студенту сказано; кабинет открыт заново, чтобы экраны и сессии записи были новыми; выход не считается состоявшимся", async () => {
    await signedInStudent();
    mockSignOutFailure = new Error("storage: removeItem rejected");
    let openCabinet!: () => void;
    mockResolveGate = new Promise<void>((resolve) => {
      openCabinet = resolve;
    });
    history.length = 0;
    const resolvesBefore = mockResolveCalls;

    let finished!: Promise<void>;
    await act(async () => {
      finished = probe.current!.signOut();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Пока кабинет открывается заново, он снят: экраны размонтированы, а с ними и брошенные сессии записи.
    expect(probe.current?.state.kind).toBe("resolvingAccess");
    await act(async () => {
      openCabinet();
      await finished; // раньше отклонялось, и вызывающие (`void signOut()`) теряли отказ молча
    });

    expect(mockOrder).toEqual(["signal", "auth.signOut"]); // сессии брошены сразу; хвост выхода (очистка телефона) не шёл
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("Не удалось выполнить действие. Повторите.");
    expect(mockResolveCalls).toBe(resolvesBefore + 1);
    expect(history).toEqual(["resolvingAccess", "active"]); // кабинет снимался и открылся заново
    expect(probe.current?.state.kind).toBe("active"); // студент по-прежнему внутри и может выйти ещё раз
  });

  it("слова на языке студента: кыргызский", async () => {
    await signedInStudent((children) => <LangProvider initial="ky">{children}</LangProvider>);
    mockSignOutFailure = new Error("storage: removeItem rejected");
    await act(async () => {
      await probe.current?.signOut();
    });
    expect(alert).toHaveBeenCalledWith("Аракет аткарылган жок. Кайталаңыз.");
  });

  it("за ожиданием хранилища начат другой вход: сбой выхода чужой, ничего не говорим и состояние нового входа не трогаем", async () => {
    await signedInStudent();
    let reject!: () => void;
    mockSignOutGate = new Promise<void>((resolve) => {
      reject = resolve;
    });
    mockSignOutFailure = new Error("storage: removeItem rejected");
    let finished!: Promise<void>;
    await act(async () => {
      finished = probe.current!.signOut();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await probe.current?.signIn("test.student", "wrong"); // начат другой вход (неверный пароль: экран входа свободен)
    });
    const resolvesBefore = mockResolveCalls;
    history.length = 0;

    reject();
    await act(async () => {
      await finished;
    });

    expect(alert).not.toHaveBeenCalled();
    expect(mockResolveCalls).toBe(resolvesBefore);
    expect(history).toEqual([]);
    expect(probe.current?.state.kind).toBe("signedOut");
  });
});
