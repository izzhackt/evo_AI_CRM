import { ANDROID_ASSET_LINKS, appLinksJsonResponse } from "@/lib/app-links";

export const dynamic = "force-static";

export function GET() {
  return appLinksJsonResponse(ANDROID_ASSET_LINKS);
}

export function HEAD() {
  return appLinksJsonResponse(ANDROID_ASSET_LINKS, "HEAD");
}
