/**
 * Universal links (iOS) and App Links (Android) for the student app
 * «EVO admissions». Spec and verification: docs/mobile/APP_LINKS.md.
 * Everything here is PUBLIC (Team ID, bundle id, certificate fingerprints).
 */

export const APP_LINKS_BUNDLE_ID = "com.evoadmissions.app";
/** Apple Team ID (also in mobile/app.config.ts). */
export const APP_LINKS_APPLE_TEAM_ID = "4D8W292RKQ";

/**
 * SHA-256 fingerprints of the certificates that sign the Android app. One
 * line per certificate; to add the Google Play App signing key later, append
 * its fingerprint (Play Console, Setup, App signing) as one more string.
 */
export const ANDROID_CERT_SHA256_FINGERPRINTS: readonly string[] = [
  // EAS production keystore (upload key), from build ade0f767-567b-4f16-80aa-b85ad747811c.
  "C3:13:F1:59:AC:73:7B:92:66:66:C5:1C:3A:0B:CC:29:C8:77:8F:0C:6C:0B:1C:DA:F8:4D:E8:D2:B8:52:6E:E3",
  // Google Play App signing key: add here once the Play Console app exists.
];

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [`${APP_LINKS_APPLE_TEAM_ID}.${APP_LINKS_BUNDLE_ID}`],
        components: [
          { "/": "/apply", "?": { invite: "?*" }, comment: "Личная ссылка регистрации" },
        ],
      },
    ],
  },
} as const;

export const ANDROID_ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: APP_LINKS_BUNDLE_ID,
      sha256_cert_fingerprints: ANDROID_CERT_SHA256_FINGERPRINTS,
    },
  },
] as const;

/** One day at the edge/CDN and in the browser; Apple and Google cache on their side anyway. */
export const APP_LINKS_CACHE_CONTROL = "public, max-age=3600";

export function appLinksJsonResponse(body: unknown, method: "GET" | "HEAD" = "GET"): Response {
  return new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": APP_LINKS_CACHE_CONTROL,
    },
  });
}
