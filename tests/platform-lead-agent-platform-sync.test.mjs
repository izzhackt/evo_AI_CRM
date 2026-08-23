import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  loadPlatformLeadAgentSyncConfig,
  PlatformLeadAgentSyncConfigurationError,
} from "../src/lib/server/platform-lead-agent-sync-config.ts";
import {
  syncPlatformLeadAgentSessionStatus,
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
const UNIFIED_MIGRATION_URL = new URL(
  "../supabase/migrations/079_platform_unified_lead_agent_sync.sql",
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
    session: "evo-inbox",
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

function sessionStatusInput(overrides = {}) {
  return {
    session: "evo-inbox",
    status: "WORKING",
    phone: "996555123456",
    providerOccurredAt: "2026-08-18T02:30:00.000Z",
    payloadSha256: "b".repeat(64),
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

test("disabled Platform configuration fails closed before persistence", async () => {
  let calls = 0;
  const repository = {
    async persistVerifiedEvent() {
      calls += 1;
      throw new Error("must not run");
    },
    async projectVerifiedEvent() {
      calls += 1;
      throw new Error("must not run");
    },
  };

  await assert.rejects(
    syncPlatformLeadAgentWhatsApp(input(), {
      config: { enabled: false },
      repository,
    }),
    PlatformLeadAgentSyncError,
  );
  await assert.rejects(
    syncPlatformLeadAgentSessionStatus(sessionStatusInput(), {
      config: { enabled: false },
      repository,
    }),
    PlatformLeadAgentSyncError,
  );
  assert.equal(calls, 0);
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
  assert.equal(calls[0][1].sessionName, "evo-inbox");
  assert.equal(calls[0][1].providerAccountRef, "waha:evo-inbox");
  assert.equal(calls[0][1].eventType, "message.any");
  assert.equal(calls[1][1].providerWebhookEventId, EVENT_ID);
  assert.equal(calls[1][1].amoAccountId, 101);
  assert.equal(calls[1][1].amoLeadId, 202);
  assert.equal(calls[1][1].amoContactId, 303);
});

test("signed Lead-Agent session health uses verified evidence and canonical projection", async () => {
  const calls = [];
  const repository = {
    async persistVerifiedEvent(value) {
      calls.push(["persist", value]);
      return { providerWebhookEventId: EVENT_ID, deduplicated: false };
    },
    async projectSessionStatusEvent(value) {
      calls.push(["project-session", value]);
      return {
        wahaSessionName: "evo-inbox",
        status: "WORKING",
        observedAt: "2026-08-18T02:30:00.000Z",
        currentStateUpdated: true,
        deduplicated: false,
      };
    },
  };

  const result = await syncPlatformLeadAgentSessionStatus(sessionStatusInput(), {
    config: loadPlatformLeadAgentSyncConfig(environment()),
    repository,
    requestIds: () => [
      "88888888-8888-4888-8888-888888888888",
      "99999999-9999-4999-8999-999999999999",
    ],
  });

  assert.deepEqual(result, {
    wahaSessionName: "evo-inbox",
    status: "WORKING",
    observedAt: "2026-08-18T02:30:00.000Z",
    currentStateUpdated: true,
    deduplicated: false,
  });
  assert.deepEqual(calls.map(([name]) => name), ["persist", "project-session"]);
  assert.equal(calls[0][1].providerAccountRef, "waha:evo-inbox");
  assert.equal(calls[0][1].eventType, "session.status");
  assert.equal(calls[0][1].rawPayload.payload.name, "evo-inbox");
  assert.equal(calls[0][1].rawPayload.payload.status, "WORKING");
  assert.equal(calls[1][1].providerWebhookEventId, EVENT_ID);
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
    input({ session: "crm_primary" }),
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

test("historical migration 077 binds its original crm_primary evidence", async () => {
  const migration = await readFile(MIGRATION_URL, "utf8");
  assert.match(migration, /CREATE OR REPLACE FUNCTION platform\.sync_lead_agent_whatsapp\(/);
  assert.match(migration, /provider_account_ref <> 'waha:crm_primary'/);
  assert.match(migration, /waha_session_name <> 'crm_primary'/);
  assert.match(migration, /sales_authority_source[\s\S]*'provider_linked'/);
  assert.match(migration, /amocrm_account_id[\s\S]*p_amocrm_account_id/);
  assert.match(migration, /communication\.leadagent\.sync/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.sync_lead_agent_whatsapp/);
});

test("historical migration 079 preserves its original crm_primary projection", async () => {
  const migration = await readFile(UNIFIED_MIGRATION_URL, "utf8");
  assert.match(
    migration,
    /ADD CONSTRAINT waha_session_health_session_name_check[\s\S]*IN \('evo-inbox', 'crm_primary'\)/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT waha_session_observations_session_name_check[\s\S]*IN \('evo-inbox', 'crm_primary'\)/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION platform\.sync_lead_agent_session_status\(/,
  );
  assert.match(migration, /provider_account_ref <> 'waha:crm_primary'/);
  assert.match(migration, /INSERT INTO platform_private\.waha_session_observations/);
  assert.match(migration, /INSERT INTO platform\.waha_session_health/);
  assert.match(migration, /communication\.leadagent\.sessionstatus/);
  assert.match(
    migration,
    /DROP FUNCTION platform\.staff_waha_session_health\(UUID\)/,
  );
  assert.match(
    migration,
    /CREATE FUNCTION platform\.staff_waha_session_health\([\s\S]*p_waha_session_name TEXT/,
  );
  assert.match(
    migration,
    /health\.waha_session_name = p_waha_session_name/,
  );
  assert.doesNotMatch(
    migration,
    /CREATE (?:OR REPLACE )?FUNCTION platform\.staff_waha_session_health\(\s*p_organization_id UUID\s*\)/,
  );
  assert.doesNotMatch(
    migration,
    /CREATE TABLE (?:IF NOT EXISTS )?(?:platform|platform_private)\.[a-z_]*session_health/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION platform\.sync_lead_agent_session_status/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.staff_waha_session_health\(UUID, TEXT\)[\s\S]*TO authenticated/,
  );
});

test("the sole signed Lead-Agent route is Supabase-native with no legacy dual-write", async () => {
  const route = await readFile(ROUTE_URL, "utf8");
  const leadPayload = await readFile(LEAD_PAYLOAD_URL, "utf8");
  assert.doesNotMatch(route, /@\/lib\/db/);
  assert.doesNotMatch(route, /@\/lib\/whatsapp/);
  assert.doesNotMatch(route, /\bsyncLeadAgentWhatsApp\b/);
  assert.doesNotMatch(route, /\bupdateWahaAccountStatus\b/);
  assert.match(route, /syncPlatformLeadAgentWhatsApp\(/);
  assert.match(route, /syncPlatformLeadAgentSessionStatus\(/);
  assert.match(route, /const chatId = boundedString\(body\.chatId[\s\S]*\n\s+chatId,/);
  assert.match(route, /const amoAccountId = positiveInteger\(body\.amoAccountId\)/);
  assert.match(route, /const providerOccurredAt = optionalString\(body\.providerOccurredAt/);
  assert.match(leadPayload, /"amoAccountId": payload\.amo_account_id/);
  assert.match(leadPayload, /"providerOccurredAt": payload\.provider_occurred_at/);
});
