import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { createPortalAuthApi, type PortalAuthApi, type SignInFailure } from "@/api/portal-auth";
import { clearPerUserUiState } from "@/features/admission/useOpenSteps";
import { clearDownloadCache } from "@/features/documents/download-cache";
import { getConfig } from "@/config";
import { getSupabase, platformTransport } from "@/lib/supabase";
import { resolveAccess, type SessionState } from "@/session/access";
import { clearUniversityCaches } from "@/features/universities/cache";
import { createAccessDeps } from "@/session/deps";

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
  /** TODO(M7) заменит «обновить статус анкеты»: refreshSession + повторный маршрут. */
  refreshAccess: () => Promise<void>;
  portalAuth: PortalAuthApi;
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

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      // Не вызываем Supabase внутри колбэка (документация Supabase): уходим из него.
      setTimeout(() => {
        switch (event) {
          case "INITIAL_SESSION":
          case "SIGNED_IN":
          case "TOKEN_REFRESHED":
            if (!session) {
              runId.current += 1;
              setState({ kind: "signedOut", accountDeleted: accountDeletedRef.current });
              setReady(true);
              return;
            }
            const must = forcedMustSetRef.current || hasTemporaryPassword(session);
            setMustSetPassword(must);
            if (must) {
              // Пока пароль временный, кабинет не открываем.
              setReady(true);
              return;
            }
            void resolve(event === "TOKEN_REFRESHED" && stateRef.current.kind === "active");
            return;
          case "SIGNED_OUT":
            void clearPerUserUiState();
            void clearDownloadCache();
            void clearUniversityCaches();
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
  }, [supabase, resolve]);

  const signIn = useCallback<SessionContextValue["signIn"]>(
    async (login, password) => {
      accountDeletedRef.current = false;
      setState({ kind: "authenticating" });
      const result = await portalAuth.signIn(login.trim(), password);
      if (!result.ok) {
        setState({ kind: "signedOut", accountDeleted: false });
        return result;
      }
      const { error } = await supabase.auth.setSession({
        access_token: result.session.accessToken,
        refresh_token: result.session.refreshToken,
      });
      if (error) {
        setState({ kind: "signedOut", accountDeleted: false });
        return { ok: false, reason: "unavailable" };
      }
      if (result.session.mustSetPassword) {
        forcedMustSetRef.current = true;
        setMustSetPassword(true);
      }
      // Дальше маршрут ведёт onAuthStateChange (SIGNED_IN).
      return { ok: true };
    },
    [portalAuth, supabase],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" });
    await clearPerUserUiState();
    await clearDownloadCache();
    await clearUniversityCaches(); // копия каталога на диске не переживает выход
    runId.current += 1;
    forcedMustSetRef.current = false;
    setMustSetPassword(false);
    setState({ kind: "signedOut", accountDeleted: false });
  }, [supabase]);

  const retry = useCallback(() => resolve(false), [resolve]);

  const refreshAccess = useCallback(async () => {
    if (await deps.authUserIsDeleted()) {
      accountDeletedRef.current = true;
      await supabase.auth.signOut({ scope: "local" });
      return;
    }
    await supabase.auth.refreshSession().catch(() => undefined);
    await resolve(false);
  }, [deps, resolve, supabase]);

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
      setMustSetPassword(false);
      await resolve(false);
      return "ok";
    },
    [portalAuth, resolve, supabase],
  );

  const value = useMemo<SessionContextValue>(
    () => ({ state, mustSetPassword, ready, signIn, signOut, retry, refreshAccess, portalAuth, setOwnPassword }),
    [state, mustSetPassword, ready, signIn, signOut, retry, refreshAccess, portalAuth, setOwnPassword],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession вне SessionProvider");
  return value;
}
