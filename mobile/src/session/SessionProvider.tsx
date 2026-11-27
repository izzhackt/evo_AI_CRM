import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";

import { createPortalAuthApi, type PortalAuthApi, type SignInFailure } from "@/api/portal-auth";
import { clearDownloadCache } from "@/features/documents/download-cache";
import { getConfig } from "@/config";
import { DEFAULT_LANG, mobileString } from "@/i18n";
import { useOptionalLang } from "@/i18n/LangProvider";
import { getSupabase, platformTransport } from "@/lib/supabase";
import { resolveAccess, type SessionState } from "@/session/access";
import { clearInviteToken } from "@/features/registration/draft-store";
import { clearPendingSignup } from "@/features/registration/pending-store";
import { createAccessDeps } from "@/session/deps";
import { clearAllLocalData } from "@/session/local-data";
import { announceSignOut, flushBeforeSignOut } from "@/session/sign-out-signal";

export type SignInOutcome = { ok: true } | { ok: false; reason: SignInFailure };

type SessionContextValue = Readonly<{
  state: SessionState;
  /** Вошли с временным паролем: нужен экран «Задайте свой пароль». */
  mustSetPassword: boolean;
  /** Есть сохранённая сессия (до первого ответа маршрутизатора false). */
  ready: boolean;
  signIn: (login: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
  /** «Обновить статус»: refreshSession + повторный маршрут (после отправки анкеты, одобрения, исправления). */
  refreshAccess: () => Promise<void>;
  /** Принятие на экране «Конфиденциальность» подтверждено базой: дальше кабинет. */
  completeConsent: () => void;
  portalAuth: PortalAuthApi;
  /** `recordConsents`: галочки «Конфиденциальность» на экране пароля, запись после смены пароля (веб 4b682db96). */
  setOwnPassword: (password: string) => Promise<"ok" | "weak_password" | "unauthorized" | "staff_account" | "rate_limited" | "unavailable" | "network">;
}>;

const SessionContext = createContext<SessionContextValue | null>(null);

function hasTemporaryPassword(session: Session | null): boolean {
  return session?.user?.app_metadata?.evo_temporary_password === true;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabase(), []);
  const portalAuth = useMemo(() => createPortalAuthApi({ baseUrl: getConfig().portalBaseUrl }), []);
  const deps = useMemo(() => createAccessDeps(supabase, platformTransport(supabase)), [supabase]);

  const [state, setState] = useState<SessionState>({ kind: "resolvingAccess" });
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  // Язык нужен только для слов «выйти не удалось»; провайдер языка есть в приложении всегда, а в проверках его может не быть.
  const lang = useOptionalLang()?.lang ?? DEFAULT_LANG;
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  // Запуск приложения: файлы документов прошлой сессии в кэше не нужны.
  useEffect(() => {
    void clearDownloadCache();
  }, []);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const accountDeletedRef = useRef(false);
  // Ответ S3 `must_set_password` действует, даже если пометки нет в токене.
  const forcedMustSetRef = useRef(false);
  // Устаревшие ответы маршрутизатора отбрасываются.
  const runId = useRef(0);
  // Токен сессии, для которой маршрут уже провёл сам вход (`signIn`).
  const routedTokenRef = useRef<string | null>(null);
  // Сколько входов начато. Выход ждёт ответа сервера об отзыве токена (до 20 с), а хвост выхода стирает состояние: вход, начатый за это
  // время, он не должен трогать (сессию уже сняло событие SIGNED_OUT).
  const signInEpochRef = useRef(0);
  // Идущий выход по кнопке (досылка до 3 с, затем ответ сервера): второе нажатие получает ту же цепочку. Цепочка помнит эпоху входа:
  // вход, начатый за это время, свой выход получает отдельно.
  const signOutRunRef = useRef<{ epoch: number; run: Promise<void> } | null>(null);

  const resolve = useCallback(
    async (quiet: boolean) => {
      const id = ++runId.current;
      if (!quiet) setState({ kind: "resolvingAccess" });
      const next = await resolveAccess(deps);
      if (id !== runId.current) return;
      if (next.kind === "signedOut") accountDeletedRef.current = next.accountDeleted;
      setState(next);
      setReady(true);
    },
    [deps],
  );

  /**
   * Единственное место, где сессия превращается в состояние экрана. Его зовут и события библиотеки (запуск, обновление токена),
   * и сам вход (`signIn`): «Входим…» (`authenticating`) заканчивает тот, кто его поставил, а не событие, которое должно прийти.
   */
  const routeSession = useCallback(
    (event: AuthChangeEvent, session: Session) => {
      const must = forcedMustSetRef.current || hasTemporaryPassword(session);
      setMustSetPassword(must);
      if (must) {
        // Пока пароль временный, кабинет не открываем: нужен экран «Придумайте свой пароль». Состояние при этом не может остаться
        // `authenticating`: охранники маршрутов читают его как «вход идёт» и держат экран входа с колесом (QA#2, D1: колесо вечно, хотя
        // сессия уже сохранена). Из него уходим в `resolvingAccess` - то же состояние, с которым приложение стартует при сохранённой
        // сессии; по нему и открывается экран пароля. Так же поступает и обычная ветка: `resolve(false)` ставит его из любого состояния.
        setState((current) => (current.kind === "resolvingAccess" ? current : { kind: "resolvingAccess" }));
        setReady(true);
        return;
      }
      // Тихо (без «Проверяем доступ…») только когда кабинет или экран согласия уже открыт: отметки на экране не теряются.
      void resolve(event === "TOKEN_REFRESHED" && (stateRef.current.kind === "active" || stateRef.current.kind === "needsConsent"));
    },
    [resolve],
  );

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      // Не вызываем Supabase внутри колбэка (документация Supabase): уходим из него.
      setTimeout(() => {
        switch (event) {
          case "INITIAL_SESSION":
          case "SIGNED_IN":
          case "TOKEN_REFRESHED":
            if (!session) {
              announceSignOut();
              runId.current += 1;
              setState({ kind: "signedOut", accountDeleted: accountDeletedRef.current });
              setReady(true);
              return;
            }
            // Вход уже провёл маршрут для этого токена сам: событие библиотеки о нём (SIGNED_IN, а при просроченном токене портала
            // TOKEN_REFRESHED) второй раз маршрут не ведёт. Запуск приложения токена ещё не знает (`null`), поэтому маршрут ведёт.
            if (routedTokenRef.current === session.access_token) return;
            routeSession(event, session);
            return;
          case "SIGNED_OUT":
            announceSignOut();
            void clearAllLocalData();
            runId.current += 1;
            forcedMustSetRef.current = false;
            setMustSetPassword(false);
            setState({ kind: "signedOut", accountDeleted: accountDeletedRef.current });
            setReady(true);
            return;
          default:
            return;
        }
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, routeSession]);

  const signIn = useCallback<SessionContextValue["signIn"]>(
    async (login, password) => {
      signInEpochRef.current += 1;
      accountDeletedRef.current = false;
      setState({ kind: "authenticating" });
      try {
        const result = await portalAuth.signIn(login.trim(), password);
        if (!result.ok) {
          setState({ kind: "signedOut", accountDeleted: false });
          return result;
        }
        const { data, error } = await supabase.auth.setSession({
          access_token: result.session.accessToken,
          refresh_token: result.session.refreshToken,
        });
        const session = data.session;
        if (error || !session) {
          setState({ kind: "signedOut", accountDeleted: false });
          return { ok: false, reason: "unavailable" };
        }
        if (result.session.mustSetPassword) {
          forcedMustSetRef.current = true;
          setMustSetPassword(true);
        }
        // Личная ссылка регистрации после входа не нужна (и не должна достаться следующему человеку); ожидание подтверждения почты тоже.
        void clearInviteToken();
        void clearPendingSignup();
        // Состояние «Входим…» ставил этот вызов, и заканчивает его тоже он: маршрут по установленной сессии ведём здесь, а не ждём
        // SIGNED_IN от библиотеки (оно придёт следом и для этого токена будет пропущено).
        routedTokenRef.current = session.access_token;
        routeSession("SIGNED_IN", session);
        return { ok: true };
      } catch {
        // `setSession` пробрасывает то, что не ошибка авторизации (например, запись сессии в хранилище не удалась): без этого вызов
        // отклонился бы, состояние осталось `authenticating`, а экран входа - занятым. Так `authenticating` не переживает вызов ни при
        // успехе, ни при отказе, ни при исключении, а длится не дольше портала и `setSession` (по 20 секунд; на пути просроченного токена
        // у auth-js ещё повторы обновления с затуханием в пределах 30 секунд), и не зависит от того, как и когда дошло событие.
        setState({ kind: "signedOut", accountDeleted: false });
        return { ok: false, reason: "unavailable" };
      }
    },
    [portalAuth, routeSession, supabase],
  );

  const runSignOut = useCallback(async (epoch: number) => {
    // Кнопка «Выйти»: пока токен ещё действует, тест и тест на время досылают неотправленное (все разом, не дольше 3 с в сумме,
    // сбои молчат). Остальные пути выхода (SIGNED_OUT, пропавшая сессия, удалённый аккаунт) токена уже не имеют и не досылают.
    await flushBeforeSignOut();
    if (epoch !== signInEpochRef.current) return; // за досылкой (до 3 с) начат другой вход: этот выход чужой и не должен бросить и отозвать новую сессию
    // Затем, до запроса на отзыв токена: сессии записи (тест, урок) бросают неотправленное, иначе закрытие экрана слало бы его с отозванным токеном.
    announceSignOut();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Хранилище не дало стереть сессию: SIGNED_OUT не пришло, студент остался внутри, а экраны записи уже брошены и ничего не сохраняют
      // (тест молча не пишет, урок не принимает ответ, тест на время замер). Вернуть им запись нельзя (таймеры сняты), поэтому говорим
      // о сбое и открываем кабинет заново: экраны, а с ними и сессии записи, новые. Обрыв сети сюда не попадает: библиотека убирает
      // локальную сессию и шлёт SIGNED_OUT раньше запроса, а ответ её ошибки выход не читает.
      if (epoch === signInEpochRef.current) {
        Alert.alert(mobileString(langRef.current, "error.generic"));
        await resolve(false);
      }
      return;
    }
    if (epoch !== signInEpochRef.current) return; // за ожиданием сервера начат другой вход: хвост выхода чужой
    await clearAllLocalData();
    if (epoch !== signInEpochRef.current) return;
    runId.current += 1;
    forcedMustSetRef.current = false;
    setMustSetPassword(false);
    setState({ kind: "signedOut", accountDeleted: false });
  }, [resolve, supabase]);

  const signOut = useCallback((): Promise<void> => {
    const epoch = signInEpochRef.current;
    const running = signOutRunRef.current;
    if (running && running.epoch === epoch) return running.run; // второе нажатие: та же цепочка, не вторая досылка и не второй выход
    const run = runSignOut(epoch);
    signOutRunRef.current = { epoch, run };
    const done = () => {
      if (signOutRunRef.current?.run === run) signOutRunRef.current = null;
    };
    void run.then(done, done);
    return run;
  }, [runSignOut]);

  const retry = useCallback(() => resolve(false), [resolve]);

  const refreshAccess = useCallback(async () => {
    if (await deps.authUserIsDeleted()) {
      accountDeletedRef.current = true;
      announceSignOut();
      await supabase.auth.signOut({ scope: "local" });
      return;
    }
    await supabase.auth.refreshSession().catch(() => undefined);
    await resolve(false);
  }, [deps, resolve, supabase]);

  const completeConsent = useCallback(() => {
    setState((current) => (current.kind === "needsConsent" ? { kind: "active", session: current.session } : current));
  }, []);

  const setOwnPassword = useCallback<SessionContextValue["setOwnPassword"]>(
    async (password) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return "unauthorized";
      const result = await portalAuth.setOwnPassword(token, password);
      if (!result.ok) return result.reason;
      // Новый токен без пометки временного пароля, затем обычный маршрут.
      forcedMustSetRef.current = false;
      await supabase.auth.refreshSession().catch(() => undefined);
      // Согласия здесь не пишутся: без решения маршрутизатор ведёт на экран «Конфиденциальность» (один раз, как на вебе).
      setMustSetPassword(false);
      await resolve(false);
      return "ok";
    },
    [portalAuth, resolve, supabase],
  );

  const value = useMemo<SessionContextValue>(
    () => ({ state, mustSetPassword, ready, signIn, signOut, retry, refreshAccess, completeConsent, portalAuth, setOwnPassword }),
    [state, mustSetPassword, ready, signIn, signOut, retry, refreshAccess, completeConsent, portalAuth, setOwnPassword],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession вне SessionProvider");
  return value;
}
