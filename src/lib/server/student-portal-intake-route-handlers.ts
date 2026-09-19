import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validateStudentApplicationDraft, type StudentApplicationDraft } from "../student-application-contract.ts";
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
 *   `createPublicStudentAccount` — the single анкета step a client key
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
const REGISTRATION_KEYS = "email,password,questionnaire";
const BODY_READ_DEADLINE_MS = 5000;

type RegistrationStatus =
  | "created"
  | "invalid"
  | "password"
  | "password_too_long"
  | "rate_limit"
  | "conflict"
  | "unavailable";

type CreateAccount = (
  email: string,
  password: string,
  draft: StudentApplicationDraft,
) => Promise<{ status: RegistrationStatus }>;

// The dynamic import mirrors the PORT-8a default-dependency pattern: the
// shared registration chain loads only when the default is actually used, so
// route units exercise the adapter with injected dependencies.
const defaultCreateAccount: CreateAccount = async (email, password, draft) => {
  const { createPublicStudentAccount } = await import(
    "./student-public-registration.ts"
  );
  return createPublicStudentAccount(email, password, draft);
};

const REGISTRATION_HTTP_STATUS: Readonly<Record<RegistrationStatus, number>> = {
  created: 201,
  invalid: 400,
  password: 400,
  password_too_long: 400,
  conflict: 409,
  rate_limit: 429,
  unavailable: 503,
};

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
async function readBoundedJsonBody(request: Request): Promise<unknown> {
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
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export type StudentPortalRegistrationDependencies = Readonly<{
  /** Defaults to the exact web-wizard account creation function. */
  createAccount: CreateAccount;
}>;

export function createStudentPortalRegistrationHandler(
  dependencies?: Partial<StudentPortalRegistrationDependencies>,
): (request: Request) => Promise<Response> {
  const createAccount = dependencies?.createAccount ?? defaultCreateAccount;
  return async (request: Request): Promise<Response> => {
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
    const { questionnaire, email, password } = body as Record<string, unknown>;
    if (
      typeof email !== "string" ||
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
    // INSIDE createPublicStudentAccount unchanged.
    const draft = validateStudentApplicationDraft(questionnaire);
    if (!draft) return statusResponse(400, "invalid");
    const created = await createAccount(
      email.trim().toLowerCase(),
      password,
      draft,
    );
    return statusResponse(REGISTRATION_HTTP_STATUS[created.status], created.status);
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
