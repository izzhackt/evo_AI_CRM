import { NextResponse, type NextRequest } from "next/server";
import { requestId } from "@/lib/request-id";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import { isConnectedPlatformPage } from "@/lib/platform-route-contract";
import {
  SupabaseConfigurationError,
} from "@/lib/supabase/config";
import { createSupabaseServerClientFromCookies } from "@/lib/supabase/server";

// All other routes belong to the separate legacy CRM or to later Platform
// blocks. In Platform runtime they stay unreachable until a reviewed adapter
// replaces them; the retained legacy deployment continues on its own revision.

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

  console.info(JSON.stringify({
    event: "http_request",
    request_id: id,
    method: request.method,
    path: request.nextUrl.pathname,
    service: "evo-crm",
  }));

  if (isUiContractFixtureMode()) {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }

  const path = request.nextUrl.pathname;
  if (path === "/api/health") {
    return setResponseHeaders(nextResponse(requestHeaders), id);
  }
  if (!isConnectedPlatformPage(path)) {
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
