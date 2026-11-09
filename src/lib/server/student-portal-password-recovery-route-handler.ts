import "server-only";

import { readBoundedJsonBody } from "./bounded-json-body.ts";
import {
  normalizeStudentRecoveryEmail,
  type StudentRecoveryRequestState,
} from "../student-password-recovery-contract.ts";

/**
 * POST /api/portal/password-recovery (anonymous, native clients; closes the
 * app path of issue #1287). A thin adapter over `answerStudentRecoveryRequest`,
 * the same core the web form action behind /auth/forgot-password calls: the
 * per-IP and per-address limits, the staff lookup (migration 314), the fixed
 * Student origin callback and the fixed answer time all live there.
 *
 * Native clients send no Origin header, so none is required; the route reads
 * no cookies and accepts no credential of any kind. Body: exactly `{email}`.
 */

const MAX_BODY_BYTES = 2048;
const BODY_READ_DEADLINE_MS = 5000;

type RecoveryStatus = StudentRecoveryRequestState["status"];
type Answer = (
  input: Readonly<{ email: string; forwardedFor: string | null; startedAt: number }>,
) => Promise<RecoveryStatus>;

export type StudentPortalPasswordRecoveryDependencies = Readonly<{
  answer: Answer;
  now: () => number;
}>;

const defaultAnswer: Answer = async (input) => {
  const { answerStudentRecoveryRequest } = await import("./student-password-recovery.ts");
  return answerStudentRecoveryRequest(input);
};

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function createStudentPortalPasswordRecoveryHandler(
  dependencies?: Partial<StudentPortalPasswordRecoveryDependencies>,
): (request: Request) => Promise<Response> {
  const answer = dependencies?.answer ?? defaultAnswer;
  const now = dependencies?.now ?? Date.now;
  return async (request) => {
    const startedAt = now();
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return json(400, { error: "invalid_request" });
    }
    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_READ_DEADLINE_MS });
    } catch {
      return json(400, { error: "invalid_request" });
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).join(",") !== "email"
    ) {
      return json(400, { error: "invalid_request" });
    }
    const email = normalizeStudentRecoveryEmail((body as Record<string, unknown>).email);
    if (!email) return json(400, { error: "invalid_request" });
    const status = await answer({
      email,
      forwardedFor: request.headers.get("x-forwarded-for"),
      startedAt,
    });
    if (status === "rate_limited") return json(429, { error: "rate_limited" });
    if (status === "unavailable") return json(503, { error: "unavailable" });
    return json(200, { ok: true });
  };
}
