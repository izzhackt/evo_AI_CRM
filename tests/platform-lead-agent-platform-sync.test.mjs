import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadPlatformLeadAgentSyncConfig,
  PlatformLeadAgentSyncConfigurationError,
} from "../src/lib/server/platform-lead-agent-sync-config.ts";
import {
  syncPlatformLeadAgentWhatsApp,
  PlatformLeadAgentSyncError,
} from "../src/lib/server/platform-lead-agent-sync.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const MIGRATION_URL = new URL(
  "../supabase/migrations/077_platform_manual_whatsapp_send_worker.sql",
  import.meta.url,
);
const ROUTE_URL = new URL(
  "../src/app/api/internal/lead-agent/whatsapp/route.ts",
  import.meta.url,
);
const LEAD_PAYLOAD_URL = new URL(
  "../evo-lead-agent/src/evo_lead_agent/evo_crm.py",
  import.meta.url,
);

function environment(overrides = {}) {
  return {
    EVO_PLATFORM_LEAD_AGENT_SYNC_ENABLED: "1",
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION_ID,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
    EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: MEMBERSHIP_ID,
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    session: "crm_primary",
    providerMessageId: "waha-message-1",
    chatId: "996555123456@c.us",
    bodyText: "Safe synthetic inbound",
    pushName: "Synthetic Client",
    providerOccurredAt: "2026-08-18T02:30:00.000Z",
    amoAccountId: 101,
    amoLeadId: 202,
    amoContactId: 303,
    payloadSha256: "a".repeat(64),
    ...overrides,
  };
}

test("Platform Lead-Agent sync is disabled by default and exact when enabled", () => {
  assert.deepEqual(loadPlatformLeadAgentSyncConfig({}), { enabled: false });
  const config = loadPlatformLeadAgentSyncConfig(environment());
  assert.equal(config.enabled, true);
  assert.equal(config.organizationId, ORGANIZATION_ID);
  assert.equal(config.intakeSalesMembershipId, MEMBERSHIP_ID);

  for (const invalid of [
    environment({ EVO_PLATFORM_ORGANIZATION_ID: "bad" }),
    environment({ EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: "bad" }),
    environment({ EVO_PLATFORM_SUPABASE_SECRET_KEY: "public" }),
  ]) {
    assert.throws(
      () => loadPlatformLeadAgentSyncConfig(invalid),
      PlatformLeadAgentSyncConfigurationError,
    );
  }
});

test("signed Lead-Agent sync persists verified evidence before idempotent projection", async () => {
  const calls = [];
  const repository = {
    async persistVerifiedEvent(value) {
      calls.push(["persist", value]);
      return { providerWebhookEventId: EVENT_ID, deduplicated: false };
    },
    async projectVerifiedEvent(value) {
      calls.push(["project", value]);
      return {
        conversationId: CONVERSATION_ID,
        communicationMessageId: MESSAGE_ID,
        deduplicated: false,
      };
    },
  };

  const result = await syncPlatformLeadAgentWhatsApp(input(), {
    config: loadPlatformLeadAgentSyncConfig(environment()),
    repository,
    requestIds: () => [
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ],
  });

  assert.deepEqual(result, { enabled: true, deduplicated: false });
  assert.deepEqual(calls.map(([name]) => name), ["persist", "project"]);
  assert.equal(calls[0][1].sessionName, "crm_primary");
  assert.equal(calls[0][1].providerAccountRef, "waha:crm_primary");
  assert.equal(calls[0][1].eventType, "message.any");
  assert.equal(calls[1][1].providerWebhookEventId, EVENT_ID);
  assert.equal(calls[1][1].amoAccountId, 101);
  assert.equal(calls[1][1].amoLeadId, 202);
  assert.equal(calls[1][1].amoContactId, 303);
});

test("invalid canonical identity blocks before any database write", async () => {
  const calls = [];
  const repository = {
    async persistVerifiedEvent(value) {
      calls.push(value);
      throw new Error("must not run");
    },
    async projectVerifiedEvent() {
      throw new Error("must not run");
    },
  };
  for (const invalid of [
    input({ session: "evo-inbox" }),
    input({ chatId: "group@g.us" }),
    input({ amoAccountId: null }),
    input({ amoContactId: 0 }),
    input({ payloadSha256: "bad" }),
  ]) {
    await assert.rejects(
      syncPlatformLeadAgentWhatsApp(invalid, {
        config: loadPlatformLeadAgentSyncConfig(environment()),
        repository,
      }),
      PlatformLeadAgentSyncError,
    );
  }
  assert.equal(calls.length, 0);
});

test("migration binds crm_primary source evidence, amoCRM identity and audit", async () => {
  const migration = await readFile(MIGRATION_URL, "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.sync_lead_agent_whatsapp\(/);
  assert.match(migration, /provider_account_ref <> 'waha:crm_primary'/);
  assert.match(migration, /waha_session_name <> 'crm_primary'/);
  assert.match(migration, /sales_authority_source[\s\S]*'provider_linked'/);
  assert.match(migration, /amocrm_account_id[\s\S]*p_amocrm_account_id/);
  assert.match(migration, /communication\.leadagent\.sync/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.sync_lead_agent_whatsapp/);
});

test("the sole signed Lead-Agent route forwards account, chat and provider time", async () => {
  const route = await readFile(ROUTE_URL, "utf8");
  const leadPayload = await readFile(LEAD_PAYLOAD_URL, "utf8");
  assert.match(route, /syncLeadAgentWhatsApp\([\s\S]*syncPlatformLeadAgentWhatsApp\(/);
  assert.match(route, /chatId: chatId/);
  assert.match(route, /amoAccountId: positiveInteger\(body\.amoAccountId\)/);
  assert.match(route, /providerOccurredAt: optionalString\(body\.providerOccurredAt/);
  assert.match(leadPayload, /"amoAccountId": payload\.amo_account_id/);
  assert.match(leadPayload, /"providerOccurredAt": payload\.provider_occurred_at/);
});
