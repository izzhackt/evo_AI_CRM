import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  skipTrailingSlashRedirect: true,
  // Invitation/recovery links carry one-use credentials, including in local dev.
  logging: {
    incomingRequests: { ignore: [/^\/auth\/(?:staff|callback)(?:[/?]|$)/] },
  },
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    proxyClientMaxBodySize: "105mb",
  },
};

export default nextConfig;
