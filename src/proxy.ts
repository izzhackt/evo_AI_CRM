import { NextResponse, type NextRequest } from "next/server";
import { requestId } from "@/lib/request-id";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import {
  isConnectedPlatformApi,
  isConnectedPlatformAuditExportApi,
  isConnectedPlatformAuditSettingsRequest,
  isConnectedPlatformPage,
  isDirectPlatformStaffAssistantApi,
} from "@/lib/platform-route-contract";
import { isPlatformP7AAuditEnabled } from "@/lib/platform-audit-config";
import {
  SupabaseConfigurationError,
} from "@/lib/supabase/config";
import { createSupabaseServerClientFromCookies } from "@/lib/supabase/server";

// All other routes belong to the separate legacy CRM or to later Platform
// blocks. In Platform runtime they stay unreachable until a reviewed adapter
// replaces them; the retained legacy deployment continues on its own revision.

const PLATFORM_WAHA_INGRESS_PATH =
  "/api/internal/platform-messaging/waha/events";
const PLATFORM_WAHA_WORKER_PATH =
  "/api/internal/platform-messaging/waha/work";
const PLATFORM_WAHA_HISTORY_PATH =
  "/api/internal/platform-messaging/waha/history";
const PLATFORM_WAHA_MEDIA_PATH =
  "/api/internal/platform-messaging/waha/media";
const PLATFORM_WAHA_AUTONOMOUS_REPLY_PATH =
  "/api/internal/platform-messaging/waha/autonomous-reply";
const PLATFORM_PORTAL_OVERDUE_PATH =
  "/api/internal/platform-operations/portal-overdue";

function nextResponse(requestHeaders: Headers) {
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function setResponseHeaders(response: NextResponse, id: string) {
  response.headers.set("x-request-id", id);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function blockedPlatformRoute(
  request: NextRequest,
  id: string,
) {
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
  const response = NextResponse.redirect(target);
  response.headers.set("x-request-id", id);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function refreshPlatformAuth(
  request: NextRequest,
  requestHeaders: Headers,
  id: string,
) {
  let response = nextResponse(requestHeaders);
  const client = createSupabaseServerClientFromCookies({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = nextResponse(requestHeaders);
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  });

  // Optimistic refresh only. Pages and actions independently call getClaims()
  // and the live authority RPC before authorizing access or mutation.
  await client.auth.getClaims();
  return setResponseHeaders(response, id);
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

  if (path === "/auth/platform-session") {
    // The Route Handler owns response-writable session recovery. It repeats
    // getClaims() plus live authority and must not be blocked or pre-refreshed
    // by the connected-page proxy contract.
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }

  if (path === "/api/readiness" || path === "/metrics") {
    // These exact private endpoints own their feature flag, request signature,
    // method, query, body and response decisions. Bypass only staff-cookie
    // refresh; near paths continue through the disconnected-route boundary.
    const response = nextResponse(requestHeaders);
    response.headers.set("x-request-id", id);
    return response;
  }
  if (path.startsWith("/api/readiness") || path.startsWith("/metrics")) {
    // Do not let lookalike observability paths inherit the generic Platform
    // redirect/403 behavior. They are deliberately hidden as empty 404s.
    const response = new NextResponse(null, { status: 404 });
    response.headers.set("x-request-id", id);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (isUiContractFixtureMode()) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }

  if (path === "/api/health") {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  if (isDirectPlatformStaffAssistantApi(path)) {
    // This exact route repeats the enabling-config, same-origin, actor, role,
    // organization, rate-limit, retrieval, provider and audit checks. Passing
    // it through here avoids the generic disconnected-route response and the
    // separate optimistic cookie refresh; it does not authorize or draft.
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  if (
    path === PLATFORM_WAHA_INGRESS_PATH ||
    path === PLATFORM_WAHA_WORKER_PATH ||
    path === PLATFORM_WAHA_HISTORY_PATH ||
    path === PLATFORM_WAHA_MEDIA_PATH ||
    path === PLATFORM_WAHA_AUTONOMOUS_REPLY_PATH ||
    path === PLATFORM_PORTAL_OVERDUE_PATH
  ) {
    // These exact private service-to-service endpoints own their own HMAC or
    // bearer-secret checks. They must not be redirected into the staff-cookie
    // flow, while every other legacy/internal API route remains disconnected.
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  const auditEnabled = isPlatformP7AAuditEnabled();
  if (
    path === "/settings" &&
    (
      !auditEnabled ||
      !isConnectedPlatformAuditSettingsRequest(path, request.nextUrl.searchParams)
    )
  ) {
    return blockedPlatformRoute(request, id);
  }
  if (
    isConnectedPlatformAuditExportApi(path) &&
    !auditEnabled
  ) {
    return blockedPlatformRoute(request, id);
  }
  if (!isConnectedPlatformPage(path) && !isConnectedPlatformApi(path)) {
    return blockedPlatformRoute(request, id);
  }

  try {
    return await refreshPlatformAuth(request, requestHeaders, id);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "platform_auth_refresh_unavailable",
      request_id: id,
      code:
        error instanceof SupabaseConfigurationError
          ? error.code
          : "provider_unavailable",
      service: "evo-crm",
    }));

    if (path === "/login" || path === "/register") {
      return setResponseHeaders(nextResponse(requestHeaders), id);
    }

    const target = request.nextUrl.clone();
    target.pathname = "/login";
    target.search = "";
    target.searchParams.set("error", "platform_unavailable");
    const response = NextResponse.redirect(target);
    response.headers.set("x-request-id", id);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
