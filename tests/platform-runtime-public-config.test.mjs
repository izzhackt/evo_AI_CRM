import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

globalThis.__evoSupabaseBrowserClientCalls = [];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@supabase/ssr") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export function createBrowserClient(url, publishableKey, options) {
            const client = Object.freeze({
              url,
              publishableKey,
              options,
              sequence: globalThis.__evoSupabaseBrowserClientCalls.length,
            });
            globalThis.__evoSupabaseBrowserClientCalls.push(client);
            return client;
          }
        `)}`,
      };
    }
    if (
      specifier === "./config" &&
      context.parentURL?.endsWith("/src/lib/supabase/browser.ts")
    ) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export function getSupabasePublicConfig() {
            return Object.freeze({
              url: "https://legacy.supabase.co",
              publishableKey: "sb_publishable_legacy",
            });
          }
        `)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { createSupabaseBrowserClient } = await import(
  "../src/lib/supabase/browser.ts"
);

test("browser clients are reused only for the exact runtime public configuration", () => {
  const staging = Object.freeze({
    url: "https://staging.supabase.co",
    publishableKey: "sb_publishable_staging",
  });
  const production = Object.freeze({
    url: "https://production.supabase.co",
    publishableKey: "sb_publishable_production",
  });
  const rotatedStagingKey = Object.freeze({
    url: staging.url,
    publishableKey: "sb_publishable_staging_rotated",
  });

  const firstStagingClient = createSupabaseBrowserClient(staging);
  const sameStagingClient = createSupabaseBrowserClient({ ...staging });
  const productionClient = createSupabaseBrowserClient(production);
  const rotatedStagingClient = createSupabaseBrowserClient(rotatedStagingKey);
  const returnedStagingClient = createSupabaseBrowserClient(staging);

  assert.equal(sameStagingClient, firstStagingClient);
  assert.equal(returnedStagingClient, firstStagingClient);
  assert.notEqual(productionClient, firstStagingClient);
  assert.notEqual(rotatedStagingClient, firstStagingClient);
  assert.notEqual(rotatedStagingClient, productionClient);
  assert.deepEqual(
    globalThis.__evoSupabaseBrowserClientCalls.map(({ url, publishableKey }) => ({
      url,
      publishableKey,
    })),
    [staging, production, rotatedStagingKey],
  );
  for (const client of globalThis.__evoSupabaseBrowserClientCalls) {
    assert.equal(
      client.options,
      undefined,
      "the official SSR browser helper must retain authority over session cookies",
    );
  }
});

test("successor env templates expose only publishable Supabase values to the browser", () => {
  for (const path of ["deploy/env.production.example", "deploy/env.staging.example"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /^NEXT_PUBLIC_SUPABASE_URL=/mu, path);
    assert.match(source, /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/mu, path);
    assert.match(source, /^EVO_PLATFORM_SUPABASE_SECRET_KEY=/mu, path);
    assert.match(source, /^EVO_PLATFORM_ORGANIZATION_ID=/mu, path);
    assert.doesNotMatch(
      source,
      /^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE)/mu,
      `${path} exposes a server-only Supabase credential`,
    );
    assert.doesNotMatch(
      source,
      /AUTH_SECRET|EVO_SECRET_ENCRYPTION_KEY|EVO_DB_PATH|EVO_BACKUP_DIR|EVO_AGENT_WAHA_SESSION|EVO_PLATFORM_(?:MANUAL_SEND|LEAD_AGENT)|EVO_LEAD_AGENT_|crm_primary|evo-inbox/u,
      `${path} retains a superseded authority or static WAHA session selection`,
    );
  }
});
