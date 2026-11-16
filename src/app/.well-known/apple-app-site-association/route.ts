import { APPLE_APP_SITE_ASSOCIATION, appLinksJsonResponse } from "@/lib/app-links";

export const dynamic = "force-static";

export function GET() {
  return appLinksJsonResponse(APPLE_APP_SITE_ASSOCIATION);
}

export function HEAD() {
  return appLinksJsonResponse(APPLE_APP_SITE_ASSOCIATION, "HEAD");
}
