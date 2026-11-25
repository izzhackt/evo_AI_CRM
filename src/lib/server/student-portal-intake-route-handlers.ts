import "server-only";

import { SIGNUP_CONFIRMATION_FLOW_HEADER, type NativeSignupPending, type NativeSignupResendResult, type SignupFailure } from "../student-signup-confirmation-state.ts";
import { isStudentSignupConfirmationEnvelope } from "../student-signup-confirmation-contract.ts";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createRecoveryRateLimiter, recoveryClientIpKey, type RecoveryRateLimit, type RecoveryRateLimiter } from "../student-password-recovery-rate-limit.ts";
import { readBoundedJsonBody as readJsonBodyWithLimits } from "./bounded-json-body.ts";
import type { RegistrationLinkCheck } from "./student-registration-link.ts";

import { STUDENT_APPLICATION_CONSENT_VERSION, validateStudentApplicationDraft, type StudentApplicationDraft } from "../student-application-contract.ts";
import {
  normalizeStudentInviteIdentity,
  resolveStudentInviteReceiptIdentity,
} from "./student-invite-session.ts";
import type { StudentPortalInviteStoreWithIdentity } from "./student-portal-invite-store.ts";
import { studentPortalDocumentRouteTransport } from "./platform-document-storage-route-handlers.ts";

/**
 * PORT-9a (ADR 0030 «Решение» п. 3): the two narrow intake route handlers of
 * the iPhone анкета path. Both are thin adapters over the exact server
 * functions the web wizard uses — no business rule lives here:
 *
 * - POST /api/portal/registration (anonymous) wraps
 *   `beginStudentSignup` — the single анкета step a client key
 *   cannot reproduce (`auth.admin.createUser` + the service-role signup
 *   rate-limit RPC). The web form's Origin/CSRF gate protects the COOKIE
 *   duality of `registerStudentAction` (its signed-in branch); this endpoint
 *   reads no cookies and has no signed-in branch, so its boundary is the
 *   exact-JSON contract plus the SAME database abuse posture
 *   (`reserve_student_signup_attempt_v1`, migration 177:8-48).
 * - POST /api/portal/invite-acceptance (bearer) wraps the service-role
 *   receipt acceptance the web callback performs
 *   (`resolveStudentInviteReceiptIdentity(..., markAccepted = true)` over the
 *   m126/186/193 RPC seam). Token consumption itself stays a native
 *   Supabase Auth call on the phone (`verifyOtp`, the same operation the web
 *   callback runtime issues).
 *
 * Signed-in submit/status/resubmit deliberately have NO handlers here:
 * `platform.own_student_application_v1` and
 * `platform.submit_student_application_v1` are `GRANT EXECUTE TO
 * authenticated` (177:506-512, 180:353-361) and the iPhone calls them через
 * PostgREST directly, как все волны 4–8 (docs/PLAN_CHANGES.md PORT-9a).
 */

// The web action bounds the questionnaire JSON string at 12 000 characters
// (student-signup-actions.ts:32); email ≤ 254 and password ≤ 72 bytes leave
// 16 KiB as a generous whole-body ceiling for the JSON envelope.
const MAX_REGISTRATION_BODY_BYTES = 16384;
const MAX_QUESTIONNAIRE_JSON_CHARS = 12000;
const REGISTRATION_KEYS = "aiConsent,email,invite,password,questionnaire";
const BODY_READ_DEADLINE_MS = 5000;
// v1 (`email-confirmation-v1`, anonymous, no invite) is RETIRED (SEC-1): it answers 426 and creates nothing.
// v2 requires the personal link and the current consents; the resend route speaks v2 as well.
const NATIVE_SIGNUP_FLOW_V2 = "email-confirmation-v2";

type RegistrationStatus = SignupFailure["status"];
type CreateAccount = (email: string, password: string, draft: StudentApplicationDraft, invite: string, aiConsent: true) => Promise<NativeSignupPending | SignupFailure>;
const defaultCreateAccount: CreateAccount = async (email, password, draft, invite, aiConsent) => {
  const { beginStudentSignup } = await import("./student-signup-confirmation-runtime.ts");
  return beginStudentSignup(email, password, draft, invite, aiConsent);
};
// `invite` (341, the personal registration link) is required, as in the web action: an empty one answers 403 `invite`.
const REGISTRATION_HTTP_STATUS: Readonly<Record<RegistrationStatus, number>> = {
  invalid: 400, password: 400, password_too_long: 400, conflict: 409,
  rate_limit: 429, unavailable: 503, create_unknown: 503, invite: 403,
};
function pendingResponse(pending: NativeSignupPending): Response {
  // Explicit projection: never expose internal identity, session or creation receipt fields.
  return Response.json({ status: pending.status, maskedEmail: pending.maskedEmail,
    expiresAt: pending.expiresAt, retryAfterSeconds: pending.retryAfterSeconds,
    dispatch: pending.dispatch, resendCapability: pending.resendCapability },
  { status: 202, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function statusResponse(httpStatus: number, status: string): Response {
  return Response.json(
    { status },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/** Bounded, deadline-guarded body read (website-lead-intake.ts pattern). */
async function readBoundedJsonBody(request: Request, capOnly = false): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_REGISTRATION_BODY_BYTES)
  ) {
    throw new Error("size");
  }
  if (!request.body) throw new Error("json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + BODY_READ_DEADLINE_MS;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("timeout")),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_REGISTRATION_BODY_BYTES) {
        await reader.cancel();
        throw new Error("size");
      }
      chunks.push(part.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    // This endpoint accepts one canonical ASCII bearer field: reject duplicate/escaped keys
    // before JSON.parse could discard them. No general JSON parser is introduced.
    if (capOnly && !/^\s*\{\s*"cap"\s*:\s*"[A-Za-z0-9_.-]+"\s*\}\s*$/u.test(text)) throw new Error("json");
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export type StudentPortalRegistrationDependencies = Readonly<{
  /** Defaults to the shared confirmation-aware registration runtime. */
  createAccount: CreateAccount;
}>;

export function createStudentPortalRegistrationHandler(
  dependencies?: Partial<StudentPortalRegistrationDependencies>,
): (request: Request) => Promise<Response> {
  const createAccount = dependencies?.createAccount ?? defaultCreateAccount;
  return async (request: Request): Promise<Response> => {
    if (request.headers.get(SIGNUP_CONFIRMATION_FLOW_HEADER) !== NATIVE_SIGNUP_FLOW_V2) {
      return statusResponse(426, "upgrade_required");
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      return statusResponse(415, "invalid");
    }
    let body: unknown;
    try {
      body = await readBoundedJsonBody(request);
    } catch {
      return statusResponse(400, "invalid");
    }
    // Exact-key contract, the exactActionStringFields discipline of the web
    // action: unknown or missing keys reject before any credential touches
    // the service path.
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== REGISTRATION_KEYS
    ) {
      return statusResponse(400, "invalid");
    }
    const { questionnaire, email, password, invite, aiConsent } = body as Record<string, unknown>;
    if (
      typeof email !== "string" ||
      typeof invite !== "string" ||
      invite.length > 256 ||
      aiConsent !== true ||
      typeof password !== "string" ||
      typeof questionnaire !== "object" ||
      questionnaire === null ||
      JSON.stringify(questionnaire).length > MAX_QUESTIONNAIRE_JSON_CHARS
    ) {
      return statusResponse(400, "invalid");
    }
    // The same normalization the web action applies before the shared
    // account-creation function; every further rule (draft revalidation,
    // email/password bounds, signup rate limit, duplicate rejection) runs
    // INSIDE the shared registration runtime.
    const draft = validateStudentApplicationDraft(questionnaire);
    const normalizedEmail = email.trim().toLowerCase();
    // Same checks as registerStudentAction (345): the current consent version
    // (policy folded in) and the separate AI consent are both required.
    if (
      !draft ||
      draft.consentVersion !== STUDENT_APPLICATION_CONSENT_VERSION ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      normalizedEmail.length > 254
    ) {
      return statusResponse(400, "invalid");
    }
    // 341: a new account only by personal link; without one there is no registration.
    if (invite.length === 0) return statusResponse(403, "invite");
    const created = await createAccount(normalizedEmail, password, draft, invite, true);
    return created.status === "pending_confirmation" ? pendingResponse(created)
      : statusResponse(REGISTRATION_HTTP_STATUS[created.status], created.status);
  };
}

export type StudentPortalRegistrationResendDependencies = Readonly<{
  resend: (cap: string) => Promise<NativeSignupResendResult>;
}>;
export function createStudentPortalRegistrationResendHandler(
  dependencies?: Partial<StudentPortalRegistrationResendDependencies>,
): (request: Request) => Promise<Response> {
  const resend = dependencies?.resend ?? (async (cap: string) => {
    const { resendStudentSignup } = await import("./student-signup-confirmation-runtime.ts");
    return resendStudentSignup(cap);
  });
  return async (request) => {
    if (request.headers.get(SIGNUP_CONFIRMATION_FLOW_HEADER) !== NATIVE_SIGNUP_FLOW_V2) return statusResponse(426, "upgrade_required");
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return statusResponse(415, "invalid");
    let body: unknown;
    try { body = await readBoundedJsonBody(request, true); }
    catch { return statusResponse(400, "invalid"); }
    if (typeof body !== "object" || body === null || Array.isArray(body)
      || Object.keys(body).join(",") !== "cap" || !isStudentSignupConfirmationEnvelope((body as Record<string, unknown>).cap)) return statusResponse(400, "invalid");
    let result: NativeSignupResendResult;
    try { result = await resend((body as { cap: string }).cap); }
    catch { return statusResponse(503, "unavailable"); }
    if (result.status === "pending_confirmation") return pendingResponse(result);
    const codes = { confirmed: 200, expired: 410, rate_limit: 429, account_conflict: 409, unavailable: 503 } as const;
    return statusResponse(codes[result.status], result.status);
  };
}

// --- Проверка личной ссылки регистрации (приложение, G11 аудита паритета 25.11.2026) -----------------------------------
// Веб проверяет ссылку на сервере при открытии /apply?invite= и показывает отдельные экраны «уже использована», «срок
// истёк», «не удалось проверить» (src/app/apply/page.tsx, RegistrationInviteRequired.tsx). Приложению нужен тот же ответ до
// анкеты, чтобы не заставлять человека заполнять семь шагов ради отказа на последнем. Обработчик - тонкая обёртка над той
// же `checkRegistrationLink`; он отвечает только статусом ссылки и, для действующей, именем приглашённого для предзаполнения
// (веб делает то же на странице): ничего больше. Токен лежит в теле, не в адресе, чтобы он не попал в журналы доступа.
const LINK_CHECK_API_KEYS = "invite";
const MAX_LINK_CHECK_BODY_BYTES = 512;
const MAX_LINK_CHECK_INVITE_CHARS = 256;
// Проверка - бесплатный «да или нет» по токену; токен в 192 бита не подобрать, но маршрут не должен быть и бесплатным
// генератором нагрузки на базу. Один процесс приложения: счётчик в памяти (как у восстановления пароля). Приложение при
// отказе 429 пропускает проверку и работает как раньше, поэтому предел может быть щедрым для общих адресов операторов.
const LINK_CHECK_RATE: RecoveryRateLimit = Object.freeze({ limit: 60, windowMs: 10 * 60_000 });
const defaultLinkCheckLimiter = createRecoveryRateLimiter();

/**
 * Имя приглашённого -> поля анкеты, как `invitedNamePrefill` страницы /apply веба: первое слово - имя, остальные - фамилия,
 * каждое до 60 знаков. Нет имени - `null`.
 */
export function invitedNamePrefill(displayName: string | null | undefined): Readonly<{ firstName: string; lastName: string }> | null {
  const [first = "", ...rest] = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (first.length === 0) return null;
  return { firstName: first.slice(0, 60), lastName: rest.join(" ").slice(0, 60) };
}

export type StudentPortalRegistrationLinkCheckDependencies = Readonly<{
  /** По умолчанию `checkRegistrationLink` (service-role RPC `check_student_registration_link_v1`). */
  check: (token: string) => Promise<RegistrationLinkCheck>;
  limiter: RecoveryRateLimiter;
  rule: RecoveryRateLimit;
}>;

export function createStudentPortalRegistrationLinkCheckHandler(
  dependencies?: Partial<StudentPortalRegistrationLinkCheckDependencies>,
): (request: Request) => Promise<Response> {
  const check = dependencies?.check ?? (async (token: string) => {
    const { checkRegistrationLink } = await import("./student-registration-link.ts");
    return checkRegistrationLink(token);
  });
  const limiter = dependencies?.limiter ?? defaultLinkCheckLimiter;
  const rule = dependencies?.rule ?? LINK_CHECK_RATE;
  return async (request: Request): Promise<Response> => {
    // Частота считается до разбора тела: мусорные запросы тоже расходуют лимит адреса.
    const key = `registration-link-check:${recoveryClientIpKey(request.headers.get("x-forwarded-for"))}`;
    if (!limiter.consume(key, rule)) return statusResponse(429, "rate_limit");
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return statusResponse(415, "invalid");
    let body: unknown;
    try {
      body = await readJsonBodyWithLimits(request, { maxBytes: MAX_LINK_CHECK_BODY_BYTES, deadlineMs: BODY_READ_DEADLINE_MS });
    } catch {
      return statusResponse(400, "invalid");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).join(",") !== LINK_CHECK_API_KEYS) {
      return statusResponse(400, "invalid");
    }
    const invite = (body as Record<string, unknown>).invite;
    if (typeof invite !== "string" || invite.length > MAX_LINK_CHECK_INVITE_CHARS) return statusResponse(400, "invalid");
    let result: RegistrationLinkCheck;
    try {
      result = await check(invite);
    } catch {
      result = { status: "unavailable" };
    }
    // Явная проекция: в ответ не попадает ничего, кроме статуса и (у действующей ссылки) имени для предзаполнения.
    if (result.status === "valid") {
      const name = invitedNamePrefill(result.displayName);
      return Response.json(
        { status: "valid", firstName: name?.firstName ?? null, lastName: name?.lastName ?? null },
        { status: 200, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
      );
    }
    return statusResponse(200, result.status);
  };
}

export type StudentPortalInviteAcceptanceDependencies = Readonly<{
  /** Defaults to the PORT-8a bearer Supabase server client. */
  createClient: (accessToken: string) => Promise<SupabaseClient> | SupabaseClient;
  /** Defaults to the service-role receipt store of the web callback. */
  createReceiptStore: () =>
    | Promise<StudentPortalInviteStoreWithIdentity>
    | StudentPortalInviteStoreWithIdentity;
}>;

async function defaultInviteBearerClient(
  accessToken: string,
): Promise<SupabaseClient> {
  const { createSupabaseBearerServerClient } = await import(
    "../supabase/server.ts"
  );
  return createSupabaseBearerServerClient(accessToken);
}

async function defaultInviteReceiptStore(): Promise<StudentPortalInviteStoreWithIdentity> {
  const { createTrustedStudentInviteReceiptStore } = await import(
    "./student-invite-session-runtime.ts"
  );
  return createTrustedStudentInviteReceiptStore();
}

export function createStudentPortalInviteAcceptanceHandler(
  dependencies?: Partial<StudentPortalInviteAcceptanceDependencies>,
): (request: Request) => Promise<Response> {
  const createClient = dependencies?.createClient ?? defaultInviteBearerClient;
  const createReceiptStore =
    dependencies?.createReceiptStore ?? defaultInviteReceiptStore;
  return async (request: Request): Promise<Response> => {
    // Bearer-only endpoint: a missing header is the same rejected credential
    // as a malformed one; cookies are never consulted (PORT-8a precedence).
    const transport = studentPortalDocumentRouteTransport(request);
    if (transport.transport !== "bearer") {
      return statusResponse(401, "authentication_required");
    }
    let client: SupabaseClient;
    try {
      client = await createClient(transport.accessToken);
    } catch {
      return statusResponse(503, "unavailable");
    }
    let identity;
    try {
      const { data, error } = await client.auth.getClaims(transport.accessToken);
      if (error || !data?.claims) {
        return statusResponse(401, "authentication_required");
      }
      identity = normalizeStudentInviteIdentity(data.claims);
    } catch {
      // A malformed token can throw before Supabase classifies it; it stays
      // a rejected bearer credential (student-portal-auth.ts:131-139).
      return statusResponse(401, "authentication_required");
    }
    if (!identity) return statusResponse(401, "authentication_required");
    let receiptStore: StudentPortalInviteStoreWithIdentity;
    try {
      receiptStore = await createReceiptStore();
    } catch {
      return statusResponse(503, "unavailable");
    }
    // The exact web-callback acceptance semantics: resolveIdentity with
    // markAccepted=true (idempotent — accept_e1 fires only while the receipt
    // is not yet accepted, m126:2876-2884), then the receipt must read as an
    // accepted match (student-invite-session.ts:70-93).
    const session = await resolveStudentInviteReceiptIdentity(
      identity,
      receiptStore,
      true,
    );
    if (session.status === "authenticated") {
      return Response.json(
        {
          status: "accepted",
          intakeFlow: session.receipt.intakeFlow,
          accountPending: session.receipt.accountPending,
          displayName: session.receipt.displayName,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (session.status === "invalid") return statusResponse(409, "mismatch");
    return statusResponse(503, "unavailable");
  };
}
