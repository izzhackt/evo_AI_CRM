"use strict";

const configuredBaseUrl = process.env.EVO_TEST_WAHA_REWRITE_BASE_URL;
if (configuredBaseUrl) {
  const target = new URL(configuredBaseUrl);
  if (
    target.protocol !== "http:" ||
    (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error("EVO_TEST_WAHA_REWRITE_BASE_URL must be a loopback HTTP origin");
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = function platformLocalWahaFetch(input, init) {
    if (typeof input === "string" || input instanceof URL) {
      const requested = new URL(input);
      if (requested.origin === "http://evo-crm-waha:3000") {
        requested.protocol = target.protocol;
        requested.hostname = target.hostname;
        requested.port = target.port;
        return originalFetch(requested, init);
      }
    }
    return originalFetch(input, init);
  };
}
