import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  isConnectedPlatformApi,
  isConnectedPlatformPrivateApi,
  isConnectedPlatformPage,
  isConnectedStudentAuthPage,
  isConnectedStudentPortalApi,
  isConnectedStudentPortalPage,
  isDirectPlatformStaffAssistantApi,
  isRetiredPlatformRoute,
} from "@/lib/platform-route-contract";
import { requestId } from "@/lib/request-id";
import {
  STUDENT_INVITE_CSRF_COOKIE,
  isStudentInviteCsrfToken,
} from "@/lib/student-invite-callback-contract";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { readVerifiedPlatformAuthority } from "@/lib/supabase/platform-authority";
import { readVerifiedStudentPortalAuthority } from "@/lib/supabase/student-portal-authority";

type SessionState =
  | "staff"
  | "student"
  | "authenticated_without_product"
  | "invalid"
  | "missing"
  | "unavailable";

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

async function liveSessionState(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<Readonly<{ state: SessionState; response: NextResponse }>> {
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
      };
    }

    const authority = await readVerifiedPlatformAuthority(client, data.claims);
    if (authority.status === "authenticated") {
      return { state: "staff", response };
    }
    if (authority.status === "unavailable") {
      return { state: "unavailable", response };
    }

    const studentAuthority = await readVerifiedStudentPortalAuthority(
      client,
      data.claims,
    );
    return {
      state:
        studentAuthority.status === "authenticated"
          ? "student"
          : studentAuthority.status === "unavailable"
            ? "unavailable"
            : "authenticated_without_product",
      response,
    };
  } catch {
    return { state: "unavailable", response };
  }
}

export async function proxy(request: NextRequest) {
  const id = requestId(request.headers.get("x-request-id"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", id);
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
  if (isDirectPlatformStaffAssistantApi(path)) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  if (isConnectedPlatformPrivateApi(path)) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
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

  if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path)) {
    if (!studentPortalApi) return blockedPlatformRoute(request, id);
  }

  const session = await liveSessionState(request, requestHeaders);
  if (path === "/login") {
    if (
      session.state === "missing" ||
      session.state === "invalid" ||
      session.state === "unavailable"
    ) {
      return setResponseHeaders(session.response, id);
    }
    if (
      session.state === "authenticated_without_product" &&
      (request.nextUrl.searchParams.get("error") === "session_invalid" ||
        request.nextUrl.searchParams.get("error") === "auth_unavailable")
    ) {
      return setResponseHeaders(session.response, id);
    }
    return redirectWithRefreshedCookies(request, session.response, id, "/");
  }

  if (session.state === "missing") {
    return accessDeniedResponse(request, session.response, id, null);
  }
  if (session.state === "invalid") {
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
