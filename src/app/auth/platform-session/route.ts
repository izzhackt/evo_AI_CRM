import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  resolvePlatformActor,
  type PlatformActorInvalidReason,
} from "@/lib/platform-auth";
import {
  platformHomeRoute,
  platformSameOriginRedirectLocation,
} from "@/lib/platform-route-contract";
import {
  hasSupabaseAuthCookie,
  isProjectSupabaseAuthCookieName,
  supabaseAuthCookieBaseName,
} from "@/lib/supabase/auth-cookies";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClientFromCookies } from "@/lib/supabase/server";

type CookieWrite = Readonly<{
  name: string;
  value: string;
  options: CookieOptions;
}>;

const PLATFORM_UNAVAILABLE_ERROR = "platform_unavailable";
type PlatformSessionError =
  | PlatformActorInvalidReason
  | typeof PLATFORM_UNAVAILABLE_ERROR;

function sameOriginRedirect(
  pathname: string,
  error?: PlatformSessionError,
): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: platformSameOriginRedirectLocation(pathname, error),
    },
  });
}

function applyPendingResponseState(
  response: NextResponse,
  cookieWrites: ReadonlyMap<string, CookieWrite>,
  providerHeaders: ReadonlyMap<string, string>,
): NextResponse {
  for (const [name, value] of providerHeaders) {
    response.headers.set(name, value);
  }
  for (const { name, value, options } of cookieWrites.values()) {
    response.cookies.set(name, value, options);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function expireProjectAuthCookies(
  request: NextRequest,
  supabaseUrl: string,
  cookieWrites: Map<string, CookieWrite>,
): void {
  const names = new Set<string>([supabaseAuthCookieBaseName(supabaseUrl)]);

  for (const { name } of request.cookies.getAll()) {
    if (isProjectSupabaseAuthCookieName(name, supabaseUrl)) names.add(name);
  }
  for (const name of cookieWrites.keys()) {
    if (isProjectSupabaseAuthCookieName(name, supabaseUrl)) {
      names.add(name);
    } else {
      // Supabase local sign-out also removes its PKCE verifier and user-cache
      // storage keys. The recovery contract is intentionally narrower: only
      // the configured project's auth token and numeric chunks may be expired.
      cookieWrites.delete(name);
    }
  }

  const secure = new URL(supabaseUrl).protocol === "https:";
  for (const name of names) {
    cookieWrites.set(name, {
      name,
      value: "",
      options: {
        expires: new Date(0),
        httpOnly: true,
        maxAge: 0,
        path: "/",
        sameSite: "lax",
        secure,
      },
    });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cookieWrites = new Map<string, CookieWrite>();
  const providerHeaders = new Map<string, string>();

  let supabaseUrl: string;
  try {
    supabaseUrl = getSupabasePublicConfig().url;
  } catch {
    return applyPendingResponseState(
      sameOriginRedirect("/login", PLATFORM_UNAVAILABLE_ERROR),
      cookieWrites,
      providerHeaders,
    );
  }

  const incomingCookies = request.cookies.getAll();
  const client = createSupabaseServerClientFromCookies({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet, headers) {
      for (const { name, value, options } of cookiesToSet) {
        request.cookies.set(name, value);
        cookieWrites.set(name, { name, value, options });
      }
      for (const [name, value] of Object.entries(headers)) {
        providerHeaders.set(name, value);
      }
    },
  });

  try {
    const result = await resolvePlatformActor(
      client,
      hasSupabaseAuthCookie(incomingCookies, supabaseUrl),
    );

    if (result.status === "authenticated") {
      return applyPendingResponseState(
        sameOriginRedirect(platformHomeRoute(result.actor.platformRole)),
        cookieWrites,
        providerHeaders,
      );
    }

    if (result.status === "anonymous") {
      return applyPendingResponseState(
        sameOriginRedirect("/login"),
        cookieWrites,
        providerHeaders,
      );
    }

    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // Clearing the exact project cookies below is the fail-closed fallback.
    } finally {
      expireProjectAuthCookies(request, supabaseUrl, cookieWrites);
    }

    return applyPendingResponseState(
      sameOriginRedirect("/login", result.reason),
      cookieWrites,
      providerHeaders,
    );
  } catch {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // Clearing the exact project cookies below is the fail-closed fallback.
    } finally {
      expireProjectAuthCookies(request, supabaseUrl, cookieWrites);
    }

    return applyPendingResponseState(
      sameOriginRedirect("/login", PLATFORM_UNAVAILABLE_ERROR),
      cookieWrites,
      providerHeaders,
    );
  }
}
