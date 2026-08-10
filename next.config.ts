import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const platformAuthDevRunKey = process.env.EVO_PLATFORM_AUTH_DEV_RUN_KEY;
const platformAuthBrowserPartition =
  process.env.EVO_PLATFORM_AUTH_BROWSER_PARTITION;
const platformAuthTsconfigPath =
  process.env.EVO_PLATFORM_AUTH_TSCONFIG_PATH;
const platformAuthRunKeyPattern = /^[A-Za-z0-9_-]{1,96}$/;
const platformAuthPartitions = new Set([
  "provider",
  "p5b",
  "p5c",
  "p5d",
  "p5e",
  "remaining",
]);
const platformAuthConfigValues = [
  platformAuthDevRunKey,
  platformAuthBrowserPartition,
  platformAuthTsconfigPath,
];
const configuredPlatformAuthValues = platformAuthConfigValues.filter(
  (value) => value !== undefined,
).length;

if (configuredPlatformAuthValues !== 0 && configuredPlatformAuthValues !== 3) {
  throw new Error(
    "EVO Platform Auth dev run key, browser partition and tsconfig must be configured together",
  );
}
if (
  platformAuthDevRunKey !== undefined &&
  !platformAuthRunKeyPattern.test(platformAuthDevRunKey)
) {
  throw new Error("EVO_PLATFORM_AUTH_DEV_RUN_KEY is invalid");
}
if (
  platformAuthBrowserPartition !== undefined &&
  !platformAuthPartitions.has(platformAuthBrowserPartition)
) {
  throw new Error("EVO_PLATFORM_AUTH_BROWSER_PARTITION is invalid");
}
if (
  platformAuthTsconfigPath !== undefined &&
  (path.isAbsolute(platformAuthTsconfigPath) ||
    path.dirname(platformAuthTsconfigPath) !==
      `.next/platform-auth/${platformAuthDevRunKey}` ||
    path.basename(platformAuthTsconfigPath) !==
      "tsconfig-platform-auth-" + platformAuthBrowserPartition + ".json")
) {
  throw new Error("EVO_PLATFORM_AUTH_TSCONFIG_PATH is invalid");
}

const platformAuthDistDir =
  platformAuthDevRunKey && platformAuthBrowserPartition
    ? `.next/platform-auth/${platformAuthDevRunKey}/${platformAuthBrowserPartition}`
    : undefined;

const nextConfig: NextConfig = {
  ...(platformAuthDistDir ? { distDir: platformAuthDistDir } : {}),
  ...(platformAuthTsconfigPath
    ? { typescript: { tsconfigPath: platformAuthTsconfigPath } }
    : {}),
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    proxyClientMaxBodySize: "105mb",
  },
};

export default nextConfig;
