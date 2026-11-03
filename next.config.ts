import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // Не сообщать наружу, что это Next.js (A4 аудита 10.10.2026).
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/v3/student-cases/*/document-exports": ["./assets/templates/student-profile.docx"],
  },
  skipTrailingSlashRedirect: true,
  // Staff pages used to live under `/v3` (issue #1328). Bookmarks, emails, notifications and stored links keep
  // working: every old `/v3/...` address (with its query string) answers 308 and lands on the same path without
  // the prefix. Redirects run before the proxy, so the new address goes through the normal sign-in checks.
  // `/api/v3/...` is a different prefix and is not touched.
  async redirects() {
    return [
      // `/v3/:path*` with an empty path would produce an empty Location, so the bare entry is its own rule.
      { source: "/v3", destination: "/", permanent: true },
      { source: "/v3/:path*", destination: "/:path*", permanent: true },
    ];
  },
  // Invitation/recovery links carry one-use credentials, including in local dev.
  logging: {
    incomingRequests: { ignore: [/^\/auth\/(?:staff|callback|signup-confirmation)(?:[/?]|$)/] },
  },
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    proxyClientMaxBodySize: "105mb",
  },
};

export default nextConfig;
