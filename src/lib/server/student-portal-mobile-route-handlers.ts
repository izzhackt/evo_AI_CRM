import "server-only";

import { createHash } from "node:crypto";

import type { JwtPayload, SupabaseClient } from "@supabase/supabase-js";

import { hasTemporaryPassword, TEMPORARY_PASSWORD_FLAG } from "../student-account-contract.ts";
import { normalizeStudentLogin } from "../student-login.ts";
import { checkStudentNewPassword } from "../student-password-recovery-contract.ts";
import {
  createRecoveryRateLimiter,
  recoveryClientIpKey,
  type RecoveryRateLimit,
  type RecoveryRateLimiter,
} from "../student-password-recovery-rate-limit.ts";
import { readBoundedJsonBody } from "./bounded-json-body.ts";
import { studentPortalDocumentRouteTransport } from "./platform-document-storage-route-handlers.ts";
import type { StudentLoginEmail } from "./student-login.ts";
import { readStaffMembership } from "./student-recovery-request.ts";

/**
 * Мобильное приложение студента (Expo): два серверных шага, которые нельзя сделать публичным ключом.
 *
 * - POST /api/portal/mobile/session (аноним): вход по почте или логину «имя.фамилия» на сервере, ответ — токены сессии
 *   Supabase. Логин ищется той же функцией, что и веб-вход (`resolveStudentLoginEmail`, 340); сотрудникам вход отказан.
 * - POST /api/portal/mobile/password (Bearer): свой пароль после временного (342) и смена пароля из «Профиля».
 *
 * Куки не ставятся и не читаются, проверка Origin не нужна (нативный клиент). Пароли не пишутся в журнал и не
 * возвращаются. Счётчики попыток — в памяти процесса (production — один контейнер), как у восстановления пароля.
 */

const MAX_BODY_BYTES = 8192;
const MAX_LOGIN_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;

/** Неверный пароль и неизвестный логин отвечают одинаково и не раньше этого срока (без перебора логинов по времени). */
export const MOBILE_SESSION_MIN_FAILURE_MS = 1_000;
const BODY_READ_DEADLINE_MS = 5000;
const IP_RULE: RecoveryRateLimit = Object.freeze({ limit: 30, windowMs: 15 * 60_000 });
/** Только НЕУДАЧНЫЕ проверки пароля: с одного адреса на один логин. */
const LOGIN_IP_RULE: RecoveryRateLimit = Object.freeze({ limit: 10, windowMs: 15 * 60_000 });
/** Потолок неудач на логин со всех адресов: больше, чем у одного адреса, чтобы несколько чужих адресов не заперли студента. */
const LOGIN_ANY_RULE: RecoveryRateLimit = Object.freeze({ limit: 50, windowMs: 15 * 60_000 });
const PASSWORD_RULE: RecoveryRateLimit = Object.freeze({ limit: 5, windowMs: 15 * 60_000 });

const sessionLimiter = createRecoveryRateLimiter();
const passwordLimiter = createRecoveryRateLimiter();

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { error });
}

/** Тело — один JSON-объект до 8 КиБ за 5 с (потоковое чтение: предел держится и без Content-Length); иначе null. */
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\s*(;|$)/iu.test(request.headers.get("content-type") ?? "")) return null;
  try {
    const value = await readBoundedJsonBody(request, { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_READ_DEADLINE_MS });
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function authErrorFields(error: unknown): Readonly<{ code: string | null; status: number | null }> {
  const value = error as { code?: unknown; status?: unknown } | null;
  return {
    code: typeof value?.code === "string" ? value.code : null,
    status: typeof value?.status === "number" ? value.status : null,
  };
}

/** Свежий клиент без хранения сессии: вход здесь не оставляет следов в процессе. */
async function isolatedClient(): Promise<SupabaseClient> {
  const [{ createClient }, { getSupabasePublicConfig }] = await Promise.all([
    import("@supabase/supabase-js"),
    import("../supabase/config.ts"),
  ]);
  const config = getSupabasePublicConfig();
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function serviceClient(): Promise<SupabaseClient> {
  const [{ getPlatformSupabaseBackendConfig }, { createPlatformSupabaseServiceClient }] = await Promise.all([
    import("./platform-supabase-backend-config.ts"),
    import("./platform-supabase-service-client.ts"),
  ]);
  return createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
}

/** Что известно о владельце токена: сотрудник ли он (тот же вопрос, что задаёт веб-вход) и что в его claims. */
type AccountKind =
  | Readonly<{ status: "ok"; staff: boolean; claims: JwtPayload }>
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{ status: "unavailable" }>;

async function defaultClassifyAccount(accessToken: string): Promise<AccountKind> {
  try {
    const [{ createSupabaseBearerServerClient }, { readVerifiedPlatformAuthority }] = await Promise.all([
      import("../supabase/server.ts"),
      import("../supabase/platform-authority.ts"),
    ]);
    const client = createSupabaseBearerServerClient(accessToken);
    const { data, error } = await client.auth.getClaims(accessToken);
    if (error || !data?.claims) return { status: "unauthorized" };
    const authority = await readVerifiedPlatformAuthority(client, data.claims);
    if (authority.status === "unavailable") return { status: "unavailable" };
    if (authority.status === "authenticated") return { status: "ok", staff: true, claims: data.claims };
    // Любая строка членства сотрудника в любом статусе (314), а не только действующий доступ: заблокированный или
    // приглашённый сотрудник тоже не студент.
    const sub = data.claims.sub;
    if (typeof sub !== "string" || sub.length === 0) return { status: "unauthorized" };
    const member = await readStaffMembership(await serviceClient(), sub);
    if (member === null) return { status: "unavailable" };
    return { status: "ok", staff: member, claims: data.claims };
  } catch {
    return { status: "unavailable" };
  }
}

async function defaultRevokeSession(accessToken: string, scope: "local" | "others"): Promise<boolean> {
  try {
    const { error } = await (await serviceClient()).auth.admin.signOut(accessToken, scope);
    return !error;
  } catch {
    return false;
  }
}

// --- POST /api/portal/mobile/session ---

export type MobileSessionTokens = Readonly<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: "bearer";
}>;

export type MobileSignInResult =
  | Readonly<{ status: "ok"; session: MobileSessionTokens }>
  | Readonly<{ status: "invalid_credentials" }>
  | Readonly<{ status: "rate_limited" }>
  | Readonly<{ status: "unavailable" }>;

export type StudentPortalMobileSessionDependencies = Readonly<{
  resolveLoginEmail: (login: string) => Promise<StudentLoginEmail>;
  signIn: (email: string, password: string) => Promise<MobileSignInResult>;
  classifyAccount: (accessToken: string) => Promise<AccountKind>;
  revokeSession: (accessToken: string) => Promise<boolean>;
  limiter: RecoveryRateLimiter;
  minFailureMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}>;

async function defaultResolveLoginEmail(login: string): Promise<StudentLoginEmail> {
  const { resolveStudentLoginEmail } = await import("./student-login.ts");
  return resolveStudentLoginEmail(login);
}

async function defaultSignIn(email: string, password: string): Promise<MobileSignInResult> {
  try {
    const client = await isolatedClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      const { code, status } = authErrorFields(error);
      if (status === 429 || code === "over_request_rate_limit") return { status: "rate_limited" };
      if (status !== null && status >= 500) return { status: "unavailable" };
      return error ? { status: "invalid_credentials" } : { status: "unavailable" };
    }
    const session = data.session;
    return {
      status: "ok",
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
        expires_in: session.expires_in,
        token_type: "bearer",
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

function hashKey(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

/** Один и тот же человек под любой записью: почта в нижнем регистре или логин в той же нормализации, что у веб-входа. */
function identityKeys(identity: string, ipKey: string): string[] {
  return [hashKey("mobile-login-ip", `${identity}|${ipKey}`), hashKey("mobile-login", identity)];
}

export function createStudentPortalMobileSessionHandler(
  overrides?: Partial<StudentPortalMobileSessionDependencies>,
): (request: Request) => Promise<Response> {
  const deps: StudentPortalMobileSessionDependencies = {
    resolveLoginEmail: defaultResolveLoginEmail,
    signIn: defaultSignIn,
    classifyAccount: defaultClassifyAccount,
    revokeSession: (accessToken) => defaultRevokeSession(accessToken, "local"),
    limiter: sessionLimiter,
    minFailureMs: MOBILE_SESSION_MIN_FAILURE_MS,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    ...overrides,
  };
  return async (request) => {
    const started = deps.now();
    const body = await readJsonObject(request);
    if (!body || !hasOnlyKeys(body, ["login", "password"])
      || typeof body.login !== "string" || typeof body.password !== "string") {
      return errorResponse(400, "invalid_request");
    }
    const login = body.login.trim();
    const password = body.password;
    if (login.length === 0 || login.length > MAX_LOGIN_LENGTH
      || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      return errorResponse(400, "invalid_request");
    }

    const ipKey = recoveryClientIpKey(request.headers.get("x-forwarded-for"));
    // Адрес исчерпан — отказ сразу, счётчики логина не трогаем (чужой поток не запирает студента).
    if (!deps.limiter.consume(`mobile-ip:${ipKey}`, IP_RULE)) return errorResponse(429, "rate_limited");

    // Один человек — одни счётчики: почта в нижнем регистре, логин в нормализации веб-входа, а найденная по логину
    // почта делит счётчики с формой «почта».
    const isEmail = login.includes("@");
    const identity = isEmail ? login.toLowerCase() : (normalizeStudentLogin(login) ?? login.toLowerCase());
    const keys = new Set(identityKeys(identity, ipKey));
    const blocked = () => [...keys].some((key, index) => !deps.limiter.wouldAllow(key, index % 2 === 0 ? LOGIN_IP_RULE : LOGIN_ANY_RULE));
    // В счётчики идут только НЕУДАЧНЫЕ проверки; успешный вход ничего не тратит и ничего не сбрасывает.
    const recordFailure = () => {
      for (const [index, key] of [...keys].entries()) deps.limiter.consume(key, index % 2 === 0 ? LOGIN_IP_RULE : LOGIN_ANY_RULE);
    };
    if (blocked()) return errorResponse(429, "rate_limited");

    const refuseCredentials = async (): Promise<Response> => {
      recordFailure();
      const wait = deps.minFailureMs - (deps.now() - started);
      if (wait > 0) await deps.sleep(wait);
      return errorResponse(401, "invalid_credentials");
    };

    // Как веб-вход: «@» — почта как есть, иначе логин «имя.фамилия» (340) превращается в почту на сервере.
    let email = login;
    if (!isEmail) {
      const resolved = await deps.resolveLoginEmail(identity);
      if (resolved.status === "unavailable") return errorResponse(503, "unavailable");
      if (resolved.status !== "found") return refuseCredentials();
      email = resolved.email;
      for (const key of identityKeys(email.trim().toLowerCase(), ipKey)) keys.add(key);
      if (blocked()) return errorResponse(429, "rate_limited");
    }

    const signedIn = await deps.signIn(email, password);
    if (signedIn.status === "invalid_credentials") return refuseCredentials();
    if (signedIn.status === "rate_limited") return errorResponse(429, "rate_limited");
    if (signedIn.status !== "ok") return errorResponse(503, "unavailable");

    const { session } = signedIn;
    const account = await deps.classifyAccount(session.access_token);
    if (account.status !== "ok") {
      await deps.revokeSession(session.access_token);
      return account.status === "unauthorized" ? refuseCredentials() : errorResponse(503, "unavailable");
    }
    if (account.staff) {
      // Сотрудник входит в CRM, не в приложение студента: открытая сессия закрывается, а ответ неотличим от
      // неверного пароля (тот же 401, тело и срок), чтобы приложение не подтверждало, что почта принадлежит сотруднику.
      await deps.revokeSession(session.access_token);
      return refuseCredentials();
    }
    const mustSetPassword = hasTemporaryPassword(account.claims.app_metadata);
    return jsonResponse(200, mustSetPassword ? { ...session, must_set_password: true } : session);
  };
}

// --- POST /api/portal/mobile/password ---

type PasswordAccount =
  | Readonly<{ status: "ok"; userId: string; email: string; staff: boolean }>
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{ status: "unavailable" }>;

type TemporaryFlag =
  | Readonly<{ status: "ok"; temporary: boolean; appMetadata: Record<string, unknown> }>
  | Readonly<{ status: "unavailable" }>;

export type StudentPortalMobilePasswordDependencies = Readonly<{
  authorize: (accessToken: string) => Promise<PasswordAccount>;
  readTemporaryFlag: (userId: string) => Promise<TemporaryFlag>;
  verifyCurrentPassword: (
    userId: string, email: string, password: string,
  ) => Promise<"ok" | "wrong" | "rate_limited" | "unavailable">;
  setPassword: (
    userId: string, password: string, appMetadata: Record<string, unknown> | null,
  ) => Promise<"ok" | "rejected" | "unavailable">;
  revokeOtherSessions: (accessToken: string) => Promise<boolean>;
  limiter: RecoveryRateLimiter;
}>;

async function defaultAuthorize(accessToken: string): Promise<PasswordAccount> {
  const account = await defaultClassifyAccount(accessToken);
  if (account.status !== "ok") return account;
  const { sub, email } = account.claims;
  if (typeof sub !== "string" || sub.length === 0 || typeof email !== "string" || email.length === 0) {
    return { status: "unauthorized" };
  }
  return { status: "ok", userId: sub, email, staff: account.staff };
}

async function defaultReadTemporaryFlag(userId: string): Promise<TemporaryFlag> {
  try {
    // Признак читается у Auth, а не из токена: токен другой сессии мог остаться со старым значением.
    const { data, error } = await (await serviceClient()).auth.admin.getUserById(userId);
    if (error || !data.user) return { status: "unavailable" };
    const appMetadata = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    return { status: "ok", temporary: hasTemporaryPassword(appMetadata), appMetadata };
  } catch {
    return { status: "unavailable" };
  }
}

async function defaultVerifyCurrentPassword(
  userId: string, email: string, password: string,
): Promise<"ok" | "wrong" | "rate_limited" | "unavailable"> {
  try {
    const client = await isolatedClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      const { code, status } = authErrorFields(error);
      if (status === 429 || code === "over_request_rate_limit") return "rate_limited";
      if (error && (code === "invalid_credentials" || (status !== null && status >= 400 && status < 500))) return "wrong";
      return "unavailable";
    }
    // Проверочная сессия нужна только для проверки: закрываем её сразу.
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    return data.user?.id === userId ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function defaultSetPassword(
  userId: string, password: string, appMetadata: Record<string, unknown> | null,
): Promise<"ok" | "rejected" | "unavailable"> {
  try {
    const updated = await (await serviceClient()).auth.admin.updateUserById(userId, {
      password,
      ...(appMetadata ? { app_metadata: { ...appMetadata, [TEMPORARY_PASSWORD_FLAG]: false } } : {}),
    });
    if (!updated.error) return "ok";
    const status = typeof updated.error.status === "number" ? updated.error.status : 500;
    return status >= 400 && status < 500 ? "rejected" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function createStudentPortalMobilePasswordHandler(
  overrides?: Partial<StudentPortalMobilePasswordDependencies>,
): (request: Request) => Promise<Response> {
  const deps: StudentPortalMobilePasswordDependencies = {
    authorize: defaultAuthorize,
    readTemporaryFlag: defaultReadTemporaryFlag,
    verifyCurrentPassword: defaultVerifyCurrentPassword,
    setPassword: defaultSetPassword,
    revokeOtherSessions: (accessToken) => defaultRevokeSession(accessToken, "others"),
    limiter: passwordLimiter,
    ...overrides,
  };
  return async (request) => {
    // Только Bearer: заголовок обязателен, куки не читаются.
    const transport = studentPortalDocumentRouteTransport(request);
    if (transport.transport !== "bearer") return errorResponse(401, "unauthorized");
    const { accessToken } = transport;
    const account = await deps.authorize(accessToken);
    if (account.status === "unauthorized") return errorResponse(401, "unauthorized");
    if (account.status === "unavailable") return errorResponse(503, "unavailable");
    if (account.staff) return errorResponse(403, "staff_account");

    const body = await readJsonObject(request);
    if (!body || !hasOnlyKeys(body, ["password", "current_password"])
      || typeof body.password !== "string"
      || (body.current_password !== undefined && typeof body.current_password !== "string")) {
      return errorResponse(400, "invalid_request");
    }
    // Те же правила пароля, что и в вебе (checkStudentNewPassword); подтверждение в приложении — на экране.
    if (checkStudentNewPassword(body.password, body.password) !== "ok") return errorResponse(400, "weak_password");

    const flag = await deps.readTemporaryFlag(account.userId);
    if (flag.status !== "ok") return errorResponse(503, "unavailable");
    if (!flag.temporary) {
      const current = body.current_password;
      if (typeof current !== "string" || current.length === 0 || current.length > MAX_PASSWORD_LENGTH) {
        return errorResponse(400, "invalid_request");
      }
      if (!deps.limiter.consume(`mobile-password:${account.userId}`, PASSWORD_RULE)) {
        return errorResponse(429, "rate_limited");
      }
      const verified = await deps.verifyCurrentPassword(account.userId, account.email, current);
      if (verified === "rate_limited") return errorResponse(429, "rate_limited");
      if (verified === "wrong") return errorResponse(403, "invalid_current_password");
      if (verified !== "ok") return errorResponse(503, "unavailable");
    }

    const updated = await deps.setPassword(account.userId, body.password, flag.temporary ? flag.appMetadata : null);
    if (updated === "rejected") return errorResponse(400, "weak_password");
    if (updated !== "ok") return errorResponse(503, "unavailable");

    // F-1: остальные сессии студента закрываются, вызвавшая остаётся. Не вышло — пароль уже сменён, поэтому 503;
    // ответ говорит клиенту, что пароль сменён; повтор идёт как обычная смена (current_password = новый пароль) и закрытие повторится.
    if (!(await deps.revokeOtherSessions(accessToken))) {
      return jsonResponse(503, { error: "revoke_failed", password_changed: true });
    }
    return jsonResponse(200, { ok: true });
  };
}
