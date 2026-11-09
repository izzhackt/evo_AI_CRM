// Серверные маршруты регистрации (src/lib/server/student-portal-intake-route-handlers.ts):
//   POST /api/portal/registration         (аноним, заголовок потока v2)
//   POST /api/portal/registration/resend  (аноним, предъявляется resendCapability)
//   POST /api/portal/invite-acceptance    (Bearer; имя для предзаполнения)
// Тела ответов и тексты ошибок сервера наружу не отдаются: только классы исходов.

import type { FetchLike } from "@/api/portal-auth";

export const REGISTRATION_FLOW_HEADER = "X-EVO-Registration-Flow";
export const REGISTRATION_FLOW_VERSION = "email-confirmation-v2";

export type SignupDispatch = "accepted" | "failed" | "unknown";

export type PendingConfirmation = Readonly<{
  maskedEmail: string;
  expiresAt: string;
  retryAfterSeconds: number | null;
  dispatch: SignupDispatch;
  /** Предъявляется при повторной отправке письма; в журнал и на экран не выводится. */
  resendCapability: string;
}>;

export type RegisterFailure =
  | "invalid"
  | "password"
  | "password_too_long"
  | "conflict"
  | "rate_limit"
  | "invite"
  | "unavailable"
  | "create_unknown"
  | "upgrade_required"
  | "network";

export type RegisterResult = { ok: true; pending: PendingConfirmation } | { ok: false; reason: RegisterFailure };

export type ResendFailure = "confirmed" | "expired" | "rate_limit" | "account_conflict" | "unavailable" | "upgrade_required" | "invalid" | "network";
export type ResendResult = { ok: true; pending: PendingConfirmation } | { ok: false; reason: ResendFailure };

export type InviteAcceptance = Readonly<{ intakeFlow: string | null; accountPending: boolean; displayName: string | null }>;
export type InviteAcceptanceResult = { ok: true; acceptance: InviteAcceptance } | { ok: false };

export type RegistrationRequest = Readonly<{
  email: string;
  password: string;
  questionnaire: unknown;
  invite: string;
}>;

export type RegistrationApi = Readonly<{
  register(request: RegistrationRequest): Promise<RegisterResult>;
  resend(capability: string): Promise<ResendResult>;
  acceptInvite(accessToken: string): Promise<InviteAcceptanceResult>;
}>;

const TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 202: явная проекция (сервер не отдаёт ничего лишнего, приложение не принимает лишнего). */
export function parsePending(json: unknown): PendingConfirmation | null {
  if (!isRecord(json) || json.status !== "pending_confirmation") return null;
  const { maskedEmail, expiresAt, retryAfterSeconds, dispatch, resendCapability } = json;
  if (typeof maskedEmail !== "string" || maskedEmail === "") return null;
  if (typeof expiresAt !== "string" || typeof resendCapability !== "string" || resendCapability === "") return null;
  if (dispatch !== "accepted" && dispatch !== "failed" && dispatch !== "unknown") return null;
  if (retryAfterSeconds !== null && !(typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0)) return null;
  return { maskedEmail, expiresAt, retryAfterSeconds: retryAfterSeconds ?? null, dispatch, resendCapability };
}

function bodyStatus(json: unknown): string | null {
  return isRecord(json) && typeof json.status === "string" ? json.status : null;
}

/** HTTP-ответ регистрации -> исход (REGISTRATION_HTTP_STATUS на сервере). */
export function mapRegisterResponse(status: number, json: unknown): RegisterResult {
  if (status === 202) {
    const pending = parsePending(json);
    return pending ? { ok: true, pending } : { ok: false, reason: "unavailable" };
  }
  const code = bodyStatus(json);
  switch (status) {
    case 400:
      if (code === "password") return { ok: false, reason: "password" };
      if (code === "password_too_long") return { ok: false, reason: "password_too_long" };
      return { ok: false, reason: "invalid" };
    case 403:
      return { ok: false, reason: "invite" };
    case 409:
      return { ok: false, reason: "conflict" };
    case 415:
      return { ok: false, reason: "invalid" };
    case 426:
      return { ok: false, reason: "upgrade_required" };
    case 429:
      return { ok: false, reason: "rate_limit" };
    case 503:
      return { ok: false, reason: code === "create_unknown" ? "create_unknown" : "unavailable" };
    default:
      return { ok: false, reason: "unavailable" };
  }
}

export function mapResendResponse(status: number, json: unknown): ResendResult {
  if (status === 202) {
    const pending = parsePending(json);
    return pending ? { ok: true, pending } : { ok: false, reason: "unavailable" };
  }
  switch (status) {
    case 200:
      return { ok: false, reason: "confirmed" };
    case 400:
    case 415:
      return { ok: false, reason: "invalid" };
    case 409:
      return { ok: false, reason: "account_conflict" };
    case 410:
      return { ok: false, reason: "expired" };
    case 426:
      return { ok: false, reason: "upgrade_required" };
    case 429:
      return { ok: false, reason: "rate_limit" };
    default:
      return { ok: false, reason: "unavailable" };
  }
}

export function createRegistrationApi(options: { baseUrl: string; fetch?: FetchLike }): RegistrationApi {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  type Raw = { status: number; json: unknown } | { network: true };

  async function post(path: string, body: unknown, extraHeaders: Record<string, string>): Promise<Raw> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...extraHeaders },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { status: response.status, json };
    } catch {
      return { network: true };
    } finally {
      clearTimeout(timer);
    }
  }

  const flow = { [REGISTRATION_FLOW_HEADER]: REGISTRATION_FLOW_VERSION };

  return {
    async register({ email, password, questionnaire, invite }) {
      // Ровно пять ключей: сервер отклоняет любой набор, кроме aiConsent,email,invite,password,questionnaire.
      const raw = await post("/api/portal/registration", { email, password, questionnaire, invite, aiConsent: true }, flow);
      if ("network" in raw) return { ok: false, reason: "network" };
      return mapRegisterResponse(raw.status, raw.json);
    },

    async resend(capability) {
      const raw = await post("/api/portal/registration/resend", { cap: capability }, flow);
      if ("network" in raw) return { ok: false, reason: "network" };
      return mapResendResponse(raw.status, raw.json);
    },

    async acceptInvite(accessToken) {
      const raw = await post("/api/portal/invite-acceptance", {}, { Authorization: `Bearer ${accessToken}` });
      if ("network" in raw || raw.status !== 200 || !isRecord(raw.json) || raw.json.status !== "accepted") return { ok: false };
      const { intakeFlow, accountPending, displayName } = raw.json;
      return {
        ok: true,
        acceptance: {
          intakeFlow: typeof intakeFlow === "string" ? intakeFlow : null,
          accountPending: accountPending === true,
          displayName: typeof displayName === "string" && displayName.trim() !== "" ? displayName.trim() : null,
        },
      };
    },
  };
}
