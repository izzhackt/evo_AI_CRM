import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  isConnectedPlatformApi,
  isConnectedPlatformPrivateApi,
  isConnectedPlatformPage,
  isConnectedPlatformSettingsRequest,
  isDirectPlatformStaffAssistantApi,
  isRetiredPlatformRoute,
} from "@/lib/platform-route-contract";
import { requestId } from "@/lib/request-id";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { readVerifiedPlatformAuthority } from "@/lib/supabase/platform-authority";

type SessionState = "authenticated" | "invalid" | "missing" | "unavailable";

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
    return {
      state:
        authority.status === "authenticated"
          ? "authenticated"
          : authority.status === "unavailable"
            ? "unavailable"
            : "invalid",
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

  if (
    path === "/settings" &&
    !isConnectedPlatformSettingsRequest(path, request.nextUrl.searchParams)
  ) {
    return blockedPlatformRoute(request, id);
  }
  if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path)) {
    return blockedPlatformRoute(request, id);
  }

  const session = await liveSessionState(request, requestHeaders);
  if (path === "/login") {
    if (session.state !== "authenticated") {
      return setResponseHeaders(session.response, id);
    }
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return copyResponseCookies(
      session.response,
      setResponseHeaders(NextResponse.redirect(target), id),
    );
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
  return setResponseHeaders(session.response, id);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
