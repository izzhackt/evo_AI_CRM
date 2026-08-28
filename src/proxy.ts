import { NextResponse, type NextRequest } from "next/server";

import {
  DEVELOPMENT_SESSION_COOKIE,
  readDevelopmentGateConfig,
  verifyDevelopmentSessionToken,
} from "@/lib/development-gate-core";
import {
  isConnectedPlatformApi,
  isConnectedPlatformPrivateApi,
  isConnectedPlatformPage,
  isConnectedPlatformSettingsRequest,
  isDirectPlatformStaffAssistantApi,
} from "@/lib/platform-route-contract";
import { requestId } from "@/lib/request-id";

function nextResponse(requestHeaders: Headers) {
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function setResponseHeaders(response: NextResponse, id: string) {
  response.headers.set("x-request-id", id);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
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
  id: string,
  reason: "gate_unavailable" | "session_invalid" | null,
) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return setResponseHeaders(
      NextResponse.json(
        { error: reason === "gate_unavailable" ? reason : "authentication_required" },
        { status: reason === "gate_unavailable" ? 503 : 401 },
      ),
      id,
    );
  }

  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  if (reason) target.searchParams.set("error", reason);
  const response = setResponseHeaders(NextResponse.redirect(target), id);
  if (reason === "session_invalid") {
    response.cookies.delete(DEVELOPMENT_SESSION_COOKIE);
  }
  return response;
}

function sessionState(request: NextRequest):
  | "authenticated"
  | "invalid"
  | "missing"
  | "unavailable" {
  const token = request.cookies.get(DEVELOPMENT_SESSION_COOKIE)?.value;
  if (!token) return "missing";
  try {
    return verifyDevelopmentSessionToken(readDevelopmentGateConfig(), token)
      ? "authenticated"
      : "invalid";
  } catch {
    return "unavailable";
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
    console.info(JSON.stringify({
      event: "http_request",
      request_id: id,
      method: request.method,
      path,
      service: "evo-crm",
    }));
  }

  if (
    path === "/register" ||
    path.startsWith("/register/") ||
    path === "/auth/platform-session" ||
    path.startsWith("/auth/platform-session/")
  ) {
    return hiddenNotFound(id);
  }

  if (path === "/api/readiness" || path === "/metrics") {
    const response = nextResponse(requestHeaders);
    response.headers.set("x-request-id", id);
    return response;
  }
  if (observabilityPathCandidate) return hiddenNotFound(id);

  if (path === "/api/database/status") {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  if (path.startsWith("/api/database/status")) return hiddenNotFound(id);

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

  const state = sessionState(request);
  if (path === "/login") {
    if (state !== "authenticated") {
      const response = setResponseHeaders(nextResponse(requestHeaders), id);
      if (state === "invalid") response.cookies.delete(DEVELOPMENT_SESSION_COOKIE);
      return response;
    }
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return setResponseHeaders(NextResponse.redirect(target), id);
  }

  if (state === "missing") return accessDeniedResponse(request, id, null);
  if (state === "invalid") {
    return accessDeniedResponse(request, id, "session_invalid");
  }
  if (state === "unavailable") {
    return accessDeniedResponse(request, id, "gate_unavailable");
  }
  return setResponseHeaders(nextResponse(requestHeaders), id);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
