// Поддельный сервер для проверки входа на настоящей библиотеке supabase-js (а не на её пересказе): портал приложения
// (`/api/portal/mobile/session`, `/password`), GoTrue (`/auth/v1/user`, `/logout`, `/token`) и PostgREST (`/rest/v1/rpc/*`).
// Подменяется только сеть (`globalThis.fetch`) и родные хранилища; клиент Supabase, его события, `SessionProvider`, маршрутизатор
// доступа и вызовы портала настоящие. Журнал `calls` хранит «МЕТОД путь» по порядку: по нему видно, что приложение спрашивало.
import { CONSENT_GATE_AI_POLICY_VERSION, PRIVACY_POLICY_VERSION } from "@/features/consent/consent-contract";

export const SUPABASE_URL = "http://supabase.example.test";
export const PORTAL_URL = "http://portal.example.test";

export type FakeAccount = {
  readonly login: string;
  readonly password: string;
  readonly id: string;
  /** Пароль временный: портал отвечает `must_set_password`, а в пользователе стоит `app_metadata.evo_temporary_password`. */
  temporary: boolean;
  /** `false`: пометки `evo_temporary_password` в пользователе нет, о временном пароле говорит только ответ портала (S3). */
  readonly markerInToken?: boolean;
  readonly caseState: "pending" | "active";
};

/** Пароль учебной записи выводится из логина: в тестах не лежат строки, похожие на настоящие пароли. */
export const syntheticPassword = (login: string) => `synthetic-${login}-1`;

/** Учебная запись; пароль - `syntheticPassword(login)`. */
export function fakeAccount(account: Omit<FakeAccount, "password" | "caseState"> & { caseState?: FakeAccount["caseState"] }): FakeAccount {
  return { caseState: "pending", ...account, password: syntheticPassword(account.login) };
}

const base64url = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

/** Три части, как у настоящего JWT: библиотека разбирает заголовок и тело и читает `exp`; подпись ей не нужна. */
export function fakeJwt(claims: Record<string, unknown>): string {
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(claims)}.${base64url("signature")}`;
}

const reply = (status: number, body: unknown = null) =>
  new Response(body === null || status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function createFakeBackend(accounts: readonly FakeAccount[]) {
  const calls: string[] = [];
  const byAccess = new Map<string, FakeAccount>();
  const byRefresh = new Map<string, FakeAccount>();
  let issued = 0;

  /** Переключатели сервера для тестов. */
  const flags = { portalTokensExpired: false };

  const issue = (account: FakeAccount, expired = false) => {
    issued += 1;
    // Просроченный токен портала: часы телефона ушли вперёд, и клиент Supabase обновляет сессию сам (событие TOKEN_REFRESHED вместо SIGNED_IN).
    const expiresAt = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
    const access = fakeJwt({ sub: account.id, role: "authenticated", aud: "authenticated", exp: expiresAt, iat: expiresAt - 3600, n: issued });
    const refresh = `refresh-${account.id}-${issued}`;
    byAccess.set(access, account);
    byRefresh.set(refresh, account);
    return { access, refresh, expiresAt };
  };
  const userOf = (account: FakeAccount) => ({
    id: account.id,
    aud: "authenticated",
    role: "authenticated",
    email: `${account.login}@students.example.test`,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", ...(account.temporary && account.markerInToken !== false ? { evo_temporary_password: true } : {}) },
    user_metadata: {},
    identities: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  const bearer = (init: RequestInit | undefined) => new Headers(init?.headers).get("authorization")?.replace(/^Bearer /i, "") ?? null;
  const accountOf = (init: RequestInit | undefined) => {
    const token = bearer(init);
    return token ? (byAccess.get(token) ?? null) : null;
  };

  const handler = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : String((input as { url: string }).url));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    const body = typeof init?.body === "string" && init.body !== "" ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (url.origin === PORTAL_URL) {
      if (url.pathname === "/api/portal/mobile/session") {
        const account = accounts.find((a) => a.login === body.login && a.password === body.password);
        if (!account) return reply(401, { error: "invalid_credentials" });
        const { access, refresh, expiresAt } = issue(account, flags.portalTokensExpired);
        return reply(200, { access_token: access, refresh_token: refresh, expires_at: expiresAt, expires_in: 3600, token_type: "bearer", must_set_password: account.temporary });
      }
      if (url.pathname === "/api/portal/mobile/password") {
        const account = accountOf(init);
        if (!account) return reply(401, { error: "unauthorized" });
        account.temporary = false;
        return reply(200, { ok: true });
      }
    }
    if (url.origin === SUPABASE_URL) {
      if (url.pathname === "/auth/v1/user") {
        const account = accountOf(init);
        return account ? reply(200, userOf(account)) : reply(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      }
      if (url.pathname === "/auth/v1/logout") return reply(204);
      if (url.pathname === "/auth/v1/token") {
        const account = byRefresh.get(String(body.refresh_token));
        if (!account) return reply(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        const { access, refresh, expiresAt } = issue(account);
        return reply(200, { access_token: access, refresh_token: refresh, expires_at: expiresAt, expires_in: 3600, token_type: "bearer", user: userOf(account) });
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const account = accountOf(init);
        if (!account) return reply(401, { code: "PGRST301", message: "JWT expired" });
        switch (url.pathname.slice("/rest/v1/rpc/".length)) {
          case "current_actor_authority":
            return reply(200, [{ auth_user_id: account.id, profile_id: `profile-${account.id}`, membership_id: `membership-${account.id}`, organization_id: "org-1", display_name: account.login, platform_role: "student", platform_access_version: 1 }]);
          case "student_portal_cases":
            return reply(200, [{ case_id: `case-${account.id}`, student_display_name: account.login, target_country: "CN", case_state: account.caseState, portal_activated_at: "2026-01-01T00:00:00Z" }]);
          case "portal_consent_status_v1":
            return reply(200, { policyVersionCurrent: PRIVACY_POLICY_VERSION, policyAcceptedVersion: PRIVACY_POLICY_VERSION, aiStatus: "granted", aiPolicyVersion: CONSENT_GATE_AI_POLICY_VERSION, aiPolicyVersionCurrent: CONSENT_GATE_AI_POLICY_VERSION, needsDecision: false });
          default:
            return reply(200, []);
        }
      }
    }
    return reply(404, { error: "not_found_in_fake_backend", path: url.pathname });
  };

  return { handler, calls, flags };
}

export type FakeBackend = ReturnType<typeof createFakeBackend>;

let current: FakeBackend | null = null;

/**
 * Ставит поддельный сервер на `globalThis.fetch` одним постоянным обработчиком. Клиент Supabase запоминает `fetch` при создании
 * (один на запуск), а сервер между тестами нужен свежий, поэтому обработчик отдаёт запрос тому серверу, что поставлен последним.
 */
export function installFakeBackend(accounts: readonly FakeAccount[]): FakeBackend {
  current = createFakeBackend(accounts);
  (globalThis as { fetch: unknown }).fetch = (input: unknown, init?: RequestInit) => {
    if (!current) throw new Error("поддельный сервер не поставлен");
    return current.handler(input, init);
  };
  return current;
}
