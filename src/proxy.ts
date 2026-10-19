import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  isLightPollApi,
  isConnectedPlatformApi,
  isPublicStudentApplicationPage,
  isConnectedPlatformPrivateApi,
  isConnectedPlatformPage,
  isConnectedStudentAuthPage,
  isConnectedStudentPortalApi,
  isConnectedStudentPortalPage,
  isPublicStudentRegistrationApi,
  isRetiredPlatformRoute,
} from "@/lib/platform-route-contract";
import { requestId } from "@/lib/request-id";
import { markProxied } from "@/lib/request-timing";
import { ACCOUNT_DELETED_PATH, isDeletedAuthUserError } from "@/lib/account-deletion-contract";
import {
  canonicalPlatformPageOrigin,
  platformAudienceForHost,
  shouldRenderPlatformLogin,
  type PlatformLoginSessionState as SessionState,
} from "@/lib/platform-public-origin";
import {
  STUDENT_INVITE_CSRF_COOKIE,
  isStudentInviteCsrfToken,
} from "@/lib/student-invite-callback-contract";
import { STUDENT_SIGNUP_CONFIRMATION_PATH, STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE } from "@/lib/student-signup-confirmation-contract";
import { STUDENT_PASSWORD_FORGOT_PATH, STUDENT_PASSWORD_RESET_PATH } from "@/lib/student-password-recovery-contract";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import {
  ACCESS_HANDOFF_HEADER,
  createAccessHandoff,
  type AccessHandoffRows,
} from "@/lib/supabase/access-handoff";
import { readPlatformAuthoritySnapshot } from "@/lib/supabase/platform-authority";
import {
  isStudentAuthorityRow,
  readStudentPortalAuthorityRows,
} from "@/lib/supabase/student-portal-authority";

function nextResponse(requestHeaders: Headers) {
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function setResponseHeaders(response: NextResponse, id: string) {
  response.headers.set("x-request-id", id);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function copyResponseCookies(source: NextResponse, target: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

function hiddenNotFound(id: string) {
  const response = new NextResponse(null, { status: 404 });
  response.headers.set("x-request-id", id);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function redirectWithRefreshedCookies(
  request: NextRequest,
  refreshedResponse: NextResponse,
  id: string,
  pathname: string,
) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  return copyResponseCookies(
    refreshedResponse,
    setResponseHeaders(NextResponse.redirect(target), id),
  );
}

function callbackInterstitialResponse(
  request: NextRequest,
  requestHeaders: Headers,
  id: string,
) {
  let csrfToken = request.cookies.get(STUDENT_INVITE_CSRF_COOKIE)?.value;
  if (!isStudentInviteCsrfToken(csrfToken)) csrfToken = crypto.randomUUID();

  request.cookies.set(STUDENT_INVITE_CSRF_COOKIE, csrfToken);
  requestHeaders.set("cookie", request.cookies.toString());
  const response = setResponseHeaders(nextResponse(requestHeaders), id);
  response.cookies.set(STUDENT_INVITE_CSRF_COOKIE, csrfToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/auth/callback",
    maxAge: 10 * 60,
  });
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function blockedPlatformRoute(request: NextRequest, id: string) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") || !["GET", "HEAD"].includes(request.method)) {
    return setResponseHeaders(
      NextResponse.json(
        { error: "platform_route_not_connected", request_id: id },
        { status: 403 },
      ),
      id,
    );
  }

  const target = request.nextUrl.clone();
  target.pathname = "/platform-pending";
  target.search = "";
  target.searchParams.set("from", path);
  return setResponseHeaders(NextResponse.redirect(target), id);
}

function accessDeniedResponse(
  request: NextRequest,
  refreshedResponse: NextResponse,
  id: string,
  reason: "auth_unavailable" | "session_invalid" | null,
) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return copyResponseCookies(
      refreshedResponse,
      setResponseHeaders(
        NextResponse.json(
          {
            error:
              reason === "auth_unavailable"
                ? reason
                : "authentication_required",
          },
          { status: reason === "auth_unavailable" ? 503 : 401 },
        ),
        id,
      ),
    );
  }

  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  if (reason) target.searchParams.set("error", reason);
  return copyResponseCookies(
    refreshedResponse,
    setResponseHeaders(NextResponse.redirect(target), id),
  );
}

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      ({ name }) => name.startsWith("sb-") && name.includes("-auth-token"),
    );
}

type AuthorityState = Readonly<{ state: SessionState; rows: AccessHandoffRows }>;
type SessionClient = ReturnType<typeof createServerClient>;
type SessionClaims = NonNullable<Awaited<ReturnType<SessionClient["auth"]["getClaims"]>>["data"]>["claims"];

/**
 * The live database decides staff vs Student. Student routes ask the Student
 * question first (both reads together) and the staff snapshot only for a
 * non-Student row; every other route keeps staff first. The outcome is the
 * same either way: a staff membership is never `current_role = 'student'`
 * (migration 155, `staff_membership_identity`).
 */
async function readAuthorityState(
  client: SessionClient,
  claims: SessionClaims,
  studentFirst: boolean,
): Promise<AuthorityState> {
  if (studentFirst) {
    const student = await readStudentPortalAuthorityRows(client, claims, { parallel: true });
    if (student.result.status === "authenticated") return { state: "student", rows: student.rows };
    if (student.result.status === "unavailable") return { state: "unavailable", rows: {} };
    if (isStudentAuthorityRow(student.rows.actor)) {
      return { state: "authenticated_without_product", rows: student.rows };
    }
    const staff = await readPlatformAuthoritySnapshot(client, claims);
    if (staff.result.status === "authenticated") return { state: "staff", rows: staff.rows };
    if (staff.result.status === "unavailable") return { state: "unavailable", rows: {} };
    return { state: "authenticated_without_product", rows: { ...student.rows, ...staff.rows } };
  }

  const staff = await readPlatformAuthoritySnapshot(client, claims);
  if (staff.result.status === "authenticated") return { state: "staff", rows: staff.rows };
  if (staff.result.status === "unavailable") return { state: "unavailable", rows: {} };

  const student = await readStudentPortalAuthorityRows(client, claims, { parallel: true });
  if (student.result.status === "authenticated") return { state: "student", rows: { ...staff.rows, ...student.rows } };
  if (student.result.status === "unavailable") return { state: "unavailable", rows: {} };
  return { state: "authenticated_without_product", rows: { ...staff.rows, ...student.rows } };
}

async function liveSessionState(
  request: NextRequest,
  requestHeaders: Headers,
  refreshOnly = false,
): Promise<Readonly<{ state: SessionState; response: NextResponse; accountDeleted?: boolean }>> {
  let response = nextResponse(requestHeaders);

  try {
    const config = getSupabasePublicConfig();
    const client = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>,
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          requestHeaders.set("cookie", request.cookies.toString());
          response = nextResponse(requestHeaders);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims) {
      return {
        state: hasSupabaseSessionCookie(request) ? "invalid" : "missing",
        response,
        // 280 (ревью п. 4): Auth ответил, что пользователя из токена нет.
        accountDeleted: isDeletedAuthUserError(error),
      };
    }

    if (refreshOnly) return { state: "authenticated_without_product", response };

    const claims = data.claims;
    const path = request.nextUrl.pathname;
    // Student routes ask the Student question first; the result is the same.
    const studentFirst = isConnectedStudentPortalPage(path)
      || isConnectedStudentPortalApi(path, request.method);
    const authority = await readAuthorityState(client, claims, studentFirst);
    // GET/HEAD only: the render of this same request reuses the live result
    // (access-handoff.ts). Server Actions and POST APIs keep their own check.
    const handoffRequestId = request.method === "GET" || request.method === "HEAD"
      ? requestHeaders.get("x-request-id")
      : null;
    if (handoffRequestId && authority.state !== "unavailable") {
      const handoff = await createAccessHandoff(handoffRequestId, claims, authority.rows);
      if (handoff) {
        requestHeaders.set(ACCESS_HANDOFF_HEADER, handoff);
        const withHandoff = nextResponse(requestHeaders);
        copyResponseCookies(response, withHandoff);
        response = withHandoff;
      }
    }
    return { state: authority.state, response };
  } catch {
    return { state: "unavailable", response };
  }
}

export async function proxy(request: NextRequest) {
  const id = requestId(request.headers.get("x-request-id"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", id);
  // Only this proxy mints the access handoff, never the client.
  requestHeaders.delete(ACCESS_HANDOFF_HEADER);
  const path = request.nextUrl.pathname;
  const studentPortalApi = isConnectedStudentPortalApi(path, request.method);
  const observabilityPathCandidate =
    path.startsWith("/api/readiness") || path.startsWith("/metrics");

  if (!observabilityPathCandidate) {
    console.info(
      JSON.stringify({
        event: "http_request",
        request_id: id,
        method: request.method,
        path,
        service: "evo-crm",
      }),
    );
  }

  if (
    path === "/register" ||
    path.startsWith("/register/") ||
    path === "/auth/platform-session" ||
    path.startsWith("/auth/platform-session/") ||
    isRetiredPlatformRoute(path)
  ) {
    return hiddenNotFound(id);
  }

  if (path === "/api/readiness" || path === "/metrics") {
    const response = nextResponse(requestHeaders);
    response.headers.set("x-request-id", id);
    return response;
  }
  if (observabilityPathCandidate) return hiddenNotFound(id);

  if (path === "/api/health" || path === "/api/version") {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  // Замер A0: с этого места запрос — рабочий, и его строка `evo_timing` нужна.
  // Проверка живости (раз в 30 с), готовности и метрики в журнал замера не идут.
  markProxied();
  if (isConnectedPlatformPrivateApi(path)) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  // PORT-9a: the anonymous анкета registration intake. The handler owns its
  // whole boundary (exact-JSON contract + the migration-177 signup rate
  // limit); no session state is consulted, cookies are never refreshed here.
  if (isPublicStudentRegistrationApi(path, request.method)) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }

  const canonicalOrigin = canonicalPlatformPageOrigin(request.headers.get("host"), path);
  if (canonicalOrigin) {
    // A callback/action body must never be forwarded to a different origin.
    if (request.method !== "GET" && request.method !== "HEAD") return hiddenNotFound(id);
    const target = new URL(canonicalOrigin);
    target.pathname = path;
    target.search = request.nextUrl.search;
    const response = setResponseHeaders(NextResponse.redirect(target), id);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }


  // The exact staff acceptance page owns provider-token verification and
  // password updates. It must also open before the first staff session exists.
  if (path === "/auth/staff") {
    if (["GET", "HEAD", "POST"].includes(request.method)) {
      const response = setResponseHeaders(nextResponse(requestHeaders), id);
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    return setResponseHeaders(NextResponse.json(
      { error: "method_not_allowed", request_id: id },
      { status: 405, headers: { Allow: "GET, HEAD, POST" } },
    ), id);
  }

  // Удаление аккаунта (280, ревью п. 4): старая сессия удалённого аккаунта.
  // The handler asks Auth itself and signs out only a user that no longer
  // exists, so no session gate runs before it (a deleted user has no live one).
  if (path === ACCOUNT_DELETED_PATH) {
    if (request.method === "GET" || request.method === "HEAD") {
      const response = setResponseHeaders(nextResponse(requestHeaders), id);
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    return setResponseHeaders(NextResponse.json(
      { error: "method_not_allowed", request_id: id },
      { status: 405, headers: { Allow: "GET, HEAD" } },
    ), id);
  }

  // No liveSessionState here: an expired foreign session must not refresh before confirmation.
  if (path === STUDENT_SIGNUP_CONFIRMATION_PATH) {
    if (!["GET", "HEAD", "POST"].includes(request.method)) return hiddenNotFound(id);
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const csp = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
      "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
    // Next reads this request header to nonce framework and hydration scripts.
    requestHeaders.set("Content-Security-Policy", csp);
    requestHeaders.set("x-nonce", nonce);
    let csrf = request.cookies.get(STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE)?.value;
    if (request.method === "GET") {
      if (!isStudentInviteCsrfToken(csrf)) csrf = crypto.randomUUID();
      request.cookies.set(STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE, csrf);
      requestHeaders.set("cookie", request.cookies.toString());
    }
    const response = setResponseHeaders(nextResponse(requestHeaders), id);
    if (request.method === "GET" && csrf) response.cookies.set(STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE, csrf, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: STUDENT_SIGNUP_CONFIRMATION_PATH, maxAge: 10 * 60,
    });
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  // Student password recovery. The request form is public; the new-password
  // page carries only its own path-scoped recovery session. Neither reads or
  // refreshes the product session, so a recovery never becomes product access.
  if (path === STUDENT_PASSWORD_FORGOT_PATH || path === STUDENT_PASSWORD_RESET_PATH) {
    if (!["GET", "HEAD", "POST"].includes(request.method)) {
      return setResponseHeaders(NextResponse.json(
        { error: "method_not_allowed", request_id: id },
        { status: 405, headers: { Allow: "GET, HEAD, POST" } },
      ), id);
    }
    const response = setResponseHeaders(nextResponse(requestHeaders), id);
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (path === "/auth/callback") {
    if (request.method === "GET") {
      return callbackInterstitialResponse(request, requestHeaders, id);
    }
    if (request.method === "HEAD" || request.method === "POST") {
      return setResponseHeaders(nextResponse(requestHeaders), id);
    }
    return setResponseHeaders(
      NextResponse.json(
        { error: "method_not_allowed", request_id: id },
        { status: 405, headers: { Allow: "GET, HEAD, POST" } },
      ),
      id,
    );
  }

  if (isPublicStudentApplicationPage(path)) {
    if (!["GET", "HEAD", "POST"].includes(request.method)) return hiddenNotFound(id);
    if (hasSupabaseSessionCookie(request)) {
      const session = await liveSessionState(request, requestHeaders, true);
      if (session.accountDeleted && (request.method === "GET" || request.method === "HEAD")) {
        return redirectWithRefreshedCookies(request, session.response, id, ACCOUNT_DELETED_PATH);
      }
      return setResponseHeaders(session.response, id);
    }
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }


  // Лёгкий опрос (A4): бюджет — один RPC на опрос, и тратит его сам обработчик.
  // Здесь только проверка и обновление сессии (`getClaims`), без RPC доступа;
  // роль и права проверяет RPC обработчика. Без сессии — 401 JSON.
  if (isLightPollApi(path, request.method)) {
    const poll = await liveSessionState(request, requestHeaders, true);
    if (poll.state === "authenticated_without_product") return setResponseHeaders(poll.response, id);
    return accessDeniedResponse(
      request,
      poll.response,
      id,
      poll.state === "unavailable" ? "auth_unavailable" : poll.state === "invalid" ? "session_invalid" : null,
    );
  }

  if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path)) {
    if (!studentPortalApi) return blockedPlatformRoute(request, id);
  }

  // PORT-8a (ADR 0030 «Решение» п. 2): the two student document APIs accept
  // the native bearer transport. A PRESENT Authorization header selects it —
  // the handler verifies the token with Supabase Auth and repeats the full
  // Student authority chain fail-closed (401/403), and the cookie session is
  // then never consulted, so no cookie refresh runs here. Requests without
  // the header keep the cookie gate below unchanged (the exact route owns
  // its boundary).
  if (studentPortalApi && request.headers.has("authorization")) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }

  // A stale session must not redirect a new sign-in or refresh old cookies over
  // its result. The action still verifies credentials, live authority and Origin.
  if (path === "/login" && request.method === "POST") {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }

  const session = await liveSessionState(request, requestHeaders);
  if (path === "/login") {
    if (shouldRenderPlatformLogin(
      request.method,
      request.headers.get("host"),
      session.state,
      request.nextUrl.searchParams.get("error"),
    )) {
      return setResponseHeaders(session.response, id);
    }
    return redirectWithRefreshedCookies(request, session.response, id, "/");
  }

  if (session.state === "missing") {
    if (path === "/" && platformAudienceForHost(request.headers.get("host")) === "student") {
      return redirectWithRefreshedCookies(request, session.response, id, "/apply");
    }
    return accessDeniedResponse(request, session.response, id, null);
  }
  if (session.state === "invalid") {
    if (session.accountDeleted && !path.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")) {
      return redirectWithRefreshedCookies(request, session.response, id, ACCOUNT_DELETED_PATH);
    }
    return accessDeniedResponse(
      request,
      session.response,
      id,
      "session_invalid",
    );
  }
  if (session.state === "unavailable") {
    return accessDeniedResponse(
      request,
      session.response,
      id,
      "auth_unavailable",
    );
  }

  if (path === "/") return setResponseHeaders(session.response, id);

  if (isConnectedStudentAuthPage(path)) {
    return session.state === "staff"
      ? redirectWithRefreshedCookies(request, session.response, id, "/")
      : setResponseHeaders(session.response, id);
  }

  if (isConnectedStudentPortalPage(path)) {
    if (session.state === "student") {
      return setResponseHeaders(session.response, id);
    }
    return redirectWithRefreshedCookies(
      request,
      session.response,
      id,
      session.state === "staff" ? "/" : "/auth/account-pending",
    );
  }

  if (studentPortalApi) {
    if (session.state === "student") {
      return setResponseHeaders(session.response, id);
    }
    return copyResponseCookies(
      session.response,
      setResponseHeaders(
        NextResponse.json({ error: "forbidden" }, { status: 403 }),
        id,
      ),
    );
  }

  if (session.state !== "staff") {
    if (path.startsWith("/api/")) {
      return accessDeniedResponse(request, session.response, id, null);
    }
    return redirectWithRefreshedCookies(request, session.response, id, "/");
  }
  return setResponseHeaders(session.response, id);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
