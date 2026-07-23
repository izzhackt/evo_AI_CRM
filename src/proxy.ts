import { NextResponse, type NextRequest } from "next/server";
import { requestId } from "@/lib/request-id";

export function proxy(request: NextRequest) {
  const id = requestId(request.headers.get("x-request-id"));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", id);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-request-id", id);

  console.info(JSON.stringify({
    event: "http_request",
    request_id: id,
    method: request.method,
    path: request.nextUrl.pathname,
    service: "evo-crm",
  }));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
