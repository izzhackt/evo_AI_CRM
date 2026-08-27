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
          export function createBrowserClient(url, publishableKey) {
            const client = Object.freeze({
              url,
              publishableKey,
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
});

test("realtime client components use injected runtime config and never read browser environment variables", () => {
  const messagingRealtime = readFileSync(
    new URL(
      "../src/components/platform/communications/PlatformMessagingRealtime.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const portalRealtime = readFileSync(
    new URL(
      "../src/components/platform/portal/PortalNotificationsRealtime.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  for (const source of [messagingRealtime, portalRealtime]) {
    assert.match(source, /supabaseConfig:\s*SupabasePublicConfig/);
    assert.match(
      source,
      /createSupabaseBrowserClient\(\{\s*url:\s*supabaseUrl,\s*publishableKey:\s*supabasePublishableKey,?\s*\}\)/,
    );
    assert.match(source, /supabasePublishableKey/);
    assert.match(source, /supabaseUrl/);
    assert.doesNotMatch(
      source,
      /getSupabasePublicConfig|process\.env|NEXT_PUBLIC_SUPABASE_/,
    );
  }

  assert.match(
    messagingRealtime,
    /\[organizationId,\s*router,\s*supabasePublishableKey,\s*supabaseUrl\]/,
  );
  assert.match(
    portalRealtime,
    /\[membershipId,\s*organizationId,\s*router,\s*supabasePublishableKey,\s*supabaseUrl\]/,
  );
});

test("server entry points resolve public Supabase config at request runtime and pass only that public object", () => {
  const listPage = readFileSync(
    new URL("../src/app/(staff)/whatsapp/page.tsx", import.meta.url),
    "utf8",
  );
  const threadPage = readFileSync(
    new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const portalLayout = readFileSync(
    new URL("../src/app/portal/layout.tsx", import.meta.url),
    "utf8",
  );

  for (const source of [listPage, threadPage, portalLayout]) {
    assert.match(
      source,
      /import\s*\{\s*getSupabasePublicConfig\s*\}\s*from\s*"@\/lib\/supabase\/config"/,
    );
    assert.doesNotMatch(
      source,
      /SUPABASE_SERVICE_ROLE|serviceRole|service_role|SUPABASE_SECRET/,
    );
  }

  for (const source of [listPage, threadPage]) {
    const fixtureGuard = source.indexOf("if (isUiContractFixtureMode())");
    const runtimeRead = source.indexOf(
      "const supabaseConfig = getSupabasePublicConfig();",
    );
    assert.ok(fixtureGuard >= 0);
    assert.ok(runtimeRead > fixtureGuard);
    assert.match(
      source,
      /<PlatformMessagingRealtime[\s\S]*?organizationId=\{actor\.organizationId\}[\s\S]*?supabaseConfig=\{supabaseConfig\}[\s\S]*?\/>/,
    );
  }

  assert.match(
    portalLayout,
    /const supabaseConfig = notificationsRealtimeScope\s*\?\s*getSupabasePublicConfig\(\)\s*:\s*null;/,
  );
  assert.match(
    portalLayout,
    /notificationsRealtimeScope\s*&&\s*supabaseConfig\s*&&\s*\(/,
  );
  assert.match(
    portalLayout,
    /<PortalNotificationsRealtime[\s\S]*?organizationId=\{notificationsRealtimeScope\.organizationId\}[\s\S]*?membershipId=\{notificationsRealtimeScope\.membershipId\}[\s\S]*?supabaseConfig=\{supabaseConfig\}[\s\S]*?\/>/,
  );
});
