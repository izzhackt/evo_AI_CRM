import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { createPlatformWahaWebhookHandler } from "../src/lib/server/platform-waha-webhook.ts";

const ORGANIZATION_ID = "77100000-0000-4000-8000-000000000001";
const WEBHOOK_SECRET = "waha-webhook-secret-material-123456";
const PROVIDER_EVENT_ID = "77100000-0000-4000-8000-000000000101";
const WORK_ITEM_ID = "77100000-0000-4000-8000-000000000201";
const ATTEMPT_ID = "77100000-0000-4000-8000-000000000301";
const SALES_MEMBERSHIP_ID = "77100000-0000-4000-8000-000000000401";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function configureEnvironment() {
  process.env.EVO_PLATFORM_WAHA_INGRESS_ENABLED = "1";
  process.env.EVO_PLATFORM_ORGANIZATION_ID = ORGANIZATION_ID;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY =
    "sb_secret_platform_webhook_test_key";
  process.env.EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET = WEBHOOK_SECRET;
  process.env.EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID =
    SALES_MEMBERSHIP_ID;
}

function platformClient(rpc) {
  return {
    schema(name) {
      assert.equal(name, "platform");
      return { rpc };
    },
  };
}

function signedRequest(body, headers = {}) {
  const rawBody = JSON.stringify(body);
  const signature = createHmac("sha512", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return new Request("http://localhost/api/v2/whatsapp/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-hmac": signature,
      "x-webhook-hmac-algorithm": "sha512",
      ...headers,
    },
    body: rawBody,
  });
}

test("POST persists and enqueues one signed inbound crm_primary message", async () => {
  configureEnvironment();
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "persist_provider_webhook_event") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          provider_webhook_event_id: PROVIDER_EVENT_ID,
          event_type: "message.any",
          deduplicated: false,
          persisted_before_processing: true,
        },
        error: null,
      };
    }
    if (name === "enqueue_verified_webhook_work") {
      return {
        data: {
          work_item_id: WORK_ITEM_ID,
          state: "pending",
          deduplicated: false,
        },
        error: null,
      };
    }
    if (name === "claim_waha_webhook_work_item") {
      return {
        data: {
          claimed: true,
          completed: false,
          requested_work_item_id: WORK_ITEM_ID,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          source_webhook_event_id: PROVIDER_EVENT_ID,
          kind: "provider_webhook_process",
          event_type: "message.any",
          queue: "platform_work_v1",
          queue_message_id: 91,
          attempt_number: 1,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    if (name === "project_claimed_waha_event") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          disposition: "succeeded",
          evidence_ref: `waha-inbound-projected:${PROVIDER_EVENT_ID}`,
          error_code: null,
        },
        error: null,
      };
    }
    if (name === "finish_waha_webhook_work") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          outcome: "succeeded",
          state: "succeeded",
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(rpc),
  });
  const body = {
    id: "evt-message-1",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: "false_996999111222@c.us_ABC123",
      from: "996999111222@c.us",
      fromMe: false,
      body: "Hello EVO",
    },
  };

  const response = await handler(signedRequest(body));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "projected",
    eventType: "message.any",
    deduplicated: false,
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].name, "persist_provider_webhook_event");
  assert.deepEqual(
    {
      organization: calls[0].args.p_organization_id,
      provider: calls[0].args.p_provider,
      account: calls[0].args.p_provider_account_ref,
      conversation: calls[0].args.p_provider_conversation_ref,
      variant: calls[0].args.p_provider_event_variant_ref,
      providerRequest: calls[0].args.p_provider_request_id,
      session: calls[0].args.p_waha_session_name,
      payloadId: calls[0].args.p_payload_id,
      eventType: calls[0].args.p_event_type,
      occurredAt: calls[0].args.p_provider_occurred_at,
      verification: calls[0].args.p_verification_status,
      rawPayload: calls[0].args.p_raw_payload,
      headers: calls[0].args.p_verification_headers,
    },
    {
      organization: ORGANIZATION_ID,
      provider: "waha",
      account: "waha:crm_primary",
      conversation: null,
      variant: null,
      providerRequest: "evt-message-1",
      session: "crm_primary",
      payloadId: "false_996999111222@c.us_ABC123",
      eventType: "message.any",
      occurredAt: "2024-10-01T01:10:26.000Z",
      verification: "verified",
      rawPayload: body,
      headers: {
        hmac_algorithm: "sha512",
        hmac_verified: true,
        request_id_present: true,
        timestamp_freshness_verified: false,
      },
    },
  );
  assert.match(calls[0].args.p_payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    calls[0].args.p_verification_evidence_ref,
    `waha-raw-sha256:${calls[0].args.p_payload_sha256}`,
  );
  assert.match(calls[0].args.p_request_id, UUID_PATTERN);
  assert.equal(calls[1].name, "enqueue_verified_webhook_work");
  assert.equal(calls[1].args.p_source_webhook_event_id, PROVIDER_EVENT_ID);
  assert.match(calls[1].args.p_business_key_sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls[1].args.p_max_attempts, 8);
  assert.match(calls[1].args.p_request_id, UUID_PATTERN);
  assert.deepEqual(
    calls.slice(2).map((call) => call.name),
    [
      "claim_waha_webhook_work_item",
      "project_claimed_waha_event",
      "finish_waha_webhook_work",
    ],
  );
  assert.equal(calls[2].args.p_work_item_id, WORK_ITEM_ID);
  assert.equal(calls[3].args.p_intake_sales_membership_id, SALES_MEMBERSHIP_ID);
});

test("POST persists and enqueues one signed outbound acknowledgement", async () => {
  configureEnvironment();
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "persist_provider_webhook_event") {
      return {
        data: {
          provider_webhook_event_id: PROVIDER_EVENT_ID,
          deduplicated: false,
        },
        error: null,
      };
    }
    if (name === "enqueue_verified_webhook_work") {
      return {
        data: {
          work_item_id: WORK_ITEM_ID,
        },
        error: null,
      };
    }
    if (name === "claim_waha_webhook_work_item") {
      return {
        data: {
          claimed: true,
          completed: false,
          requested_work_item_id: WORK_ITEM_ID,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          source_webhook_event_id: PROVIDER_EVENT_ID,
          kind: "provider_webhook_process",
          event_type: "message.ack",
          queue: "platform_work_v1",
          queue_message_id: 92,
          attempt_number: 1,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    if (name === "project_claimed_waha_observation") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          disposition: "succeeded",
          evidence_ref: `waha-ack-projected:${PROVIDER_EVENT_ID}`,
          error_code: null,
        },
        error: null,
      };
    }
    if (name === "finish_waha_event_projection") {
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          outcome: "succeeded",
          state: "succeeded",
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(rpc),
  });
  const body = {
    id: "evt-ack-1",
    event: "message.ack",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: "true_996999111222@c.us_ABC123",
      fromMe: true,
      ack: 3,
      ackName: "READ",
    },
  };

  const response = await handler(signedRequest(body));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "projected",
    eventType: "message.ack",
    deduplicated: false,
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].args.p_provider_event_variant_ref, "read");
  assert.equal(calls[0].args.p_payload_id, body.payload.id);
  assert.equal(calls[0].args.p_provider_occurred_at, "2024-10-01T01:10:26.000Z");
  assert.equal(calls[1].name, "enqueue_verified_webhook_work");
  assert.deepEqual(
    calls.slice(2).map((call) => call.name),
    [
      "claim_waha_webhook_work_item",
      "project_claimed_waha_observation",
      "finish_waha_event_projection",
    ],
  );
});

test("POST persists and synchronizes one signed crm_primary session status", async () => {
  configureEnvironment();
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "persist_provider_webhook_event") {
      return {
        data: {
          provider_webhook_event_id: PROVIDER_EVENT_ID,
          deduplicated: true,
        },
        error: null,
      };
    }
    if (name === "sync_lead_agent_session_status") {
      return {
        data: {
          waha_session_name: "crm_primary",
          status: "WORKING",
          deduplicated: true,
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(rpc),
  });
  const body = {
    id: "evt-status-1",
    event: "session.status",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: { name: "crm_primary", status: "WORKING" },
  };

  const response = await handler(signedRequest(body));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "synchronized",
    eventType: "session.status",
    deduplicated: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.p_payload_id, "evt-status-1");
  assert.equal(calls[0].args.p_provider_event_variant_ref, null);
  assert.equal(calls[1].name, "sync_lead_agent_session_status");
  assert.deepEqual(
    {
      organization: calls[1].args.p_organization_id,
      source: calls[1].args.p_provider_webhook_event_id,
    },
    { organization: ORGANIZATION_ID, source: PROVIDER_EVENT_ID },
  );
  assert.match(calls[1].args.p_request_id, UUID_PATTERN);
});

test("POST rejects unsigned, wrong-session, and legacy-secret requests before Supabase mutation", async () => {
  configureEnvironment();
  let clientCreations = 0;
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => {
      clientCreations += 1;
      return platformClient(async () => {
          throw new Error("Supabase must not be called");
      });
    },
  });
  const validBody = {
    id: "evt-message-denied",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: "false_996999111222@c.us_DENIED",
      from: "996999111222@c.us",
      fromMe: false,
      body: "private applicant text",
    },
  };
  const unsignedRaw = JSON.stringify(validBody);
  const unsigned = await handler(
    new Request("http://localhost/api/v2/whatsapp/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: unsignedRaw,
    }),
  );
  assert.equal(unsigned.status, 401);
  assert.deepEqual(await unsigned.json(), {
    ok: false,
    error: "invalid_signature",
  });

  const wrongSession = await handler(
    signedRequest({ ...validBody, session: "default" }),
  );
  assert.equal(wrongSession.status, 403);
  assert.deepEqual(await wrongSession.json(), {
    ok: false,
    error: "invalid_session",
  });

  delete process.env.EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET;
  process.env.EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET = WEBHOOK_SECRET;
  const legacyOnly = await handler(signedRequest(validBody));
  const serialized = await legacyOnly.text();
  assert.equal(legacyOnly.status, 503);
  assert.deepEqual(JSON.parse(serialized), {
    ok: false,
    error: "waha_webhook_unavailable",
  });
  assert.equal(serialized.includes(WEBHOOK_SECRET), false);
  assert.equal(serialized.includes("private applicant text"), false);
  assert.equal(clientCreations, 0);
  delete process.env.EVO_V2_WHATSAPP_INBOUND_HMAC_SECRET;
});

test("POST replays the same signed provider event onto one durable work identity", async () => {
  configureEnvironment();
  const persistArgs = [];
  const enqueueArgs = [];
  const claimRequestIds = [];
  let persistCount = 0;
  let claimCount = 0;
  let projectCount = 0;
  let finishCount = 0;
  const rpc = async (name, args) => {
    if (name === "persist_provider_webhook_event") {
      persistArgs.push(args);
      persistCount += 1;
      return {
        data: {
          provider_webhook_event_id: PROVIDER_EVENT_ID,
          deduplicated: persistCount > 1,
        },
        error: null,
      };
    }
    if (name === "enqueue_verified_webhook_work") {
      enqueueArgs.push(args);
      return {
        data: {
          work_item_id: WORK_ITEM_ID,
          deduplicated: enqueueArgs.length > 1,
        },
        error: null,
      };
    }
    if (name === "claim_waha_webhook_work_item") {
      claimRequestIds.push(args.p_request_id);
      claimCount += 1;
      if (claimCount > 1) {
        return {
          data: {
            claimed: false,
            completed: true,
            requested_work_item_id: WORK_ITEM_ID,
            organization_id: ORGANIZATION_ID,
            work_item_id: WORK_ITEM_ID,
            kind: "provider_webhook_process",
            event_type: "message.any",
            queue: "platform_work_v1",
            state: "succeeded",
          },
          error: null,
        };
      }
      return {
        data: {
          claimed: true,
          completed: false,
          requested_work_item_id: WORK_ITEM_ID,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          source_webhook_event_id: PROVIDER_EVENT_ID,
          kind: "provider_webhook_process",
          event_type: "message.any",
          queue: "platform_work_v1",
          queue_message_id: 93,
          attempt_number: 1,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    if (name === "project_claimed_waha_event") {
      projectCount += 1;
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          disposition: "succeeded",
          evidence_ref: `waha-inbound-projected:${PROVIDER_EVENT_ID}`,
          error_code: null,
        },
        error: null,
      };
    }
    if (name === "finish_waha_webhook_work") {
      finishCount += 1;
      return {
        data: {
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          outcome: "succeeded",
          state: "succeeded",
        },
        error: null,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  };
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(rpc),
  });
  const body = {
    id: "evt-replay-1",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: "false_996999111222@c.us_REPLAY",
      from: "996999111222@s.whatsapp.net",
      fromMe: false,
      body: "  keep intentional whitespace  ",
    },
  };

  const first = await handler(signedRequest(body));
  const second = await handler(signedRequest(body));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).deduplicated, false);
  assert.equal((await second.json()).deduplicated, true);
  assert.equal(persistArgs.length, 2);
  assert.equal(enqueueArgs.length, 2);
  assert.equal(claimCount, 2);
  // A later delivery must observe the current terminal state rather than
  // replaying an older retry_wait attempt; scheduler retries own stable IDs.
  assert.notEqual(claimRequestIds[0], claimRequestIds[1]);
  assert.equal(projectCount, 1);
  assert.equal(finishCount, 1);
  assert.equal(
    persistArgs[0].p_provider_request_id,
    persistArgs[1].p_provider_request_id,
  );
  assert.equal(
    enqueueArgs[0].p_business_key_sha256,
    enqueueArgs[1].p_business_key_sha256,
  );
  assert.equal(
    enqueueArgs[0].p_source_webhook_event_id,
    enqueueArgs[1].p_source_webhook_event_id,
  );
});

test("POST fails clearly when the exact durable item cannot be projected", async () => {
  configureEnvironment();
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "persist_provider_webhook_event") {
      return {
        data: {
          provider_webhook_event_id: PROVIDER_EVENT_ID,
          deduplicated: false,
        },
        error: null,
      };
    }
    if (name === "enqueue_verified_webhook_work") {
      return { data: { work_item_id: WORK_ITEM_ID }, error: null };
    }
    if (name === "claim_waha_webhook_work_item") {
      return {
        data: {
          claimed: true,
          completed: false,
          requested_work_item_id: WORK_ITEM_ID,
          organization_id: ORGANIZATION_ID,
          work_item_id: WORK_ITEM_ID,
          attempt_id: ATTEMPT_ID,
          source_webhook_event_id: PROVIDER_EVENT_ID,
          kind: "provider_webhook_process",
          event_type: "message.any",
          queue: "platform_work_v1",
          queue_message_id: 94,
          attempt_number: 1,
          max_attempts: 8,
          lease_expires_at: "2026-09-02T10:00:00Z",
        },
        error: null,
      };
    }
    assert.equal(name, "project_claimed_waha_event");
    return { data: null, error: { message: "projection unavailable" } };
  };
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(rpc),
  });

  const response = await handler(
    signedRequest({
      id: "evt-projection-failure",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "false_996999111222@c.us_PROJECT_FAIL",
        from: "996999111222@c.us",
        fromMe: false,
        body: "Persist me before failing visibly",
      },
    }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "provider_projection_unavailable",
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "persist_provider_webhook_event",
      "enqueue_verified_webhook_work",
      "claim_waha_webhook_work_item",
      "project_claimed_waha_event",
    ],
  );
});

test("POST fails closed without leaking provider evidence when Supabase persistence fails", async () => {
  configureEnvironment();
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(async (name, args) => {
        calls.push({ name, args });
        return {
          data: null,
          error: {
            message: `${WEBHOOK_SECRET}: private applicant text`,
          },
        };
      }),
  });
  const response = await handler(
    signedRequest({
      id: "evt-provider-failure",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "false_996999111222@c.us_FAILURE",
        from: "996999111222@c.us",
        fromMe: false,
        body: "private applicant text",
      },
    }),
  );
  const serialized = await response.text();

  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(serialized), {
    ok: false,
    error: "provider_evidence_unavailable",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "persist_provider_webhook_event");
  assert.equal(serialized.includes(WEBHOOK_SECRET), false);
  assert.equal(serialized.includes("private applicant text"), false);
});

test("POST persists an own message observation without re-enqueuing it as inbound", async () => {
  configureEnvironment();
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(async (name, args) => {
        calls.push({ name, args });
        if (name !== "persist_provider_webhook_event") {
          throw new Error(`Unexpected RPC: ${name}`);
        }
        return {
          data: {
            provider_webhook_event_id: PROVIDER_EVENT_ID,
            deduplicated: false,
          },
          error: null,
        };
      }),
  });
  const response = await handler(
    signedRequest({
      id: "evt-own-message",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "true_996999111222@c.us_OUTBOUND",
        fromMe: true,
        source: "api",
        body: "Reviewed staff reply",
      },
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "observed",
    eventType: "message.any",
    deduplicated: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "persist_provider_webhook_event");
});

test("POST maps a thrown Supabase transport failure to the same safe unavailable result", async () => {
  configureEnvironment();
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(async () => {
        throw new Error(`${WEBHOOK_SECRET}: private provider body`);
      }),
  });
  const response = await handler(
    signedRequest({
      id: "evt-provider-throw",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "false_996999111222@c.us_THROW",
        from: "996999111222@c.us",
        fromMe: false,
        body: "private provider body",
      },
    }),
  );
  const serialized = await response.text();

  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(serialized), {
    ok: false,
    error: "provider_evidence_unavailable",
  });
  assert.equal(serialized.includes(WEBHOOK_SECRET), false);
  assert.equal(serialized.includes("private provider body"), false);
});

function recordingRpc(calls) {
  return async (name, args) => {
    calls.push({ name, args });
    switch (name) {
      case "persist_provider_webhook_event":
        return {
          data: {
            provider_webhook_event_id: PROVIDER_EVENT_ID,
            deduplicated: false,
          },
          error: null,
        };
      case "enqueue_verified_webhook_work":
        return { data: { work_item_id: WORK_ITEM_ID }, error: null };
      case "claim_waha_webhook_work_item":
        return {
          data: {
            claimed: true,
            completed: false,
            requested_work_item_id: WORK_ITEM_ID,
            organization_id: ORGANIZATION_ID,
            work_item_id: WORK_ITEM_ID,
            attempt_id: ATTEMPT_ID,
            source_webhook_event_id: PROVIDER_EVENT_ID,
            kind: "provider_webhook_process",
            event_type: "message.any",
            queue: "platform_work_v1",
            attempt_number: 1,
            max_attempts: 8,
            lease_expires_at: "2026-09-02T10:00:00Z",
          },
          error: null,
        };
      case "project_claimed_waha_event":
        return {
          data: {
            organization_id: ORGANIZATION_ID,
            work_item_id: WORK_ITEM_ID,
            attempt_id: ATTEMPT_ID,
            disposition: "succeeded",
            evidence_ref: `waha-inbound-projected:${PROVIDER_EVENT_ID}`,
            error_code: null,
          },
          error: null,
        };
      case "finish_waha_webhook_work":
        return {
          data: {
            organization_id: ORGANIZATION_ID,
            work_item_id: WORK_ITEM_ID,
            attempt_id: ATTEMPT_ID,
            outcome: "succeeded",
            state: "succeeded",
          },
          error: null,
        };
      default:
        throw new Error(`Unexpected RPC: ${name}`);
    }
  };
}

test("POST answers 200 ignored, writes nothing and never 4xx for group, status, broadcast and channel events", async () => {
  configureEnvironment();
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(recordingRpc(calls)),
  });
  const message = (id, payload) => ({
    id: `evt-${id}`,
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: { id: `${id}-message`, ...payload },
  });
  const events = [
    message("group-in", {
      from: "120363000000000001@g.us",
      participant: "79990000000@c.us",
      fromMe: false,
      body: "group text",
    }),
    message("group-out", {
      from: "79990000001@c.us",
      to: "120363000000000001@g.us",
      fromMe: true,
      body: "sent from the phone to a group",
    }),
    message("status", {
      from: "status@broadcast",
      participant: "79990000000@c.us",
      fromMe: false,
      hasMedia: true,
      body: "",
    }),
    message("broadcast-list", {
      from: "1727745026@broadcast",
      fromMe: false,
      body: "list text",
    }),
    message("channel", {
      from: "120363000000000002@newsletter",
      fromMe: false,
      body: "channel post",
    }),
    // Engine-specific nesting is checked too; the top-level `from` is absent.
    message("data-remote", {
      fromMe: false,
      body: "group text",
      _data: { id: { remote: "120363000000000003@g.us" } },
    }),
    {
      id: "evt-group-ack",
      event: "message.ack",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "true_120363000000000001@g.us_ACK",
        to: "120363000000000001@g.us",
        fromMe: true,
        ack: 2,
        ackName: "DEVICE",
      },
    },
    {
      id: "evt-status-ack",
      event: "message.ack",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "true_status@broadcast_ACK",
        to: "status@broadcast",
        fromMe: true,
        ack: 1,
        ackName: "SERVER",
      },
    },
  ];

  for (const event of events) {
    const response = await handler(signedRequest(event));
    const serialized = await response.text();
    assert.equal(response.status, 200, event.id);
    assert.deepEqual(JSON.parse(serialized), {
      ok: true,
      status: "ignored",
      reason: "non_direct_chat",
    });
    assert.equal(serialized.includes("group text"), false);
  }
  assert.deepEqual(calls, [], "ignored events must not touch Supabase");
});

test("POST keeps rejecting an unsigned group event with 401 and a wrong-session group event with 403", async () => {
  configureEnvironment();
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => {
      throw new Error("Supabase must not be called");
    },
  });
  const group = {
    id: "evt-group-denied",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: "group-denied-message",
      from: "120363000000000001@g.us",
      fromMe: false,
      body: "group text",
    },
  };
  const unsigned = await handler(
    new Request("http://localhost/api/v2/whatsapp/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(group),
    }),
  );
  assert.equal(unsigned.status, 401);
  const wrongSession = await handler(
    signedRequest({ ...group, session: "default" }),
  );
  assert.equal(wrongSession.status, 403);
});

test("POST stores a media-only message through the projection without downloading media and without a 400", async () => {
  configureEnvironment();
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(recordingRpc(calls)),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("The webhook must not fetch media");
  };
  try {
    const mediaOnly = {
      id: "evt-photo",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "false_79990000000@c.us_PHOTO",
        from: "79990000000@c.us",
        fromMe: false,
        body: "",
        hasMedia: true,
        media: {
          url: "http://waha.invalid/api/files/PHOTO.jpg",
          mimetype: "image/jpeg",
          filename: null,
        },
      },
    };
    const photo = await handler(signedRequest(mediaOnly));
    assert.equal(photo.status, 200);
    assert.deepEqual(await photo.json(), {
      ok: true,
      status: "projected",
      eventType: "message.any",
      deduplicated: false,
    });
    assert.deepEqual(
      calls.map((call) => call.name),
      [
        "persist_provider_webhook_event",
        "enqueue_verified_webhook_work",
        "claim_waha_webhook_work_item",
        "project_claimed_waha_event",
        "finish_waha_webhook_work",
      ],
    );
    // The stored provider evidence is the original event, unmodified.
    assert.deepEqual(calls[0].args.p_raw_payload, mediaOnly);

    // A document without `body` at all, and a captioned photo, take the same route.
    for (const payload of [
      {
        id: "false_79990000000@c.us_DOC",
        from: "79990000000@c.us",
        fromMe: false,
        hasMedia: true,
        media: { mimetype: "application/pdf", filename: "passport-scan.pdf" },
      },
      {
        id: "false_79990000000@c.us_CAPTION",
        from: "79990000000@c.us",
        fromMe: false,
        hasMedia: true,
        body: "Вот мой диплом",
        media: { mimetype: "image/jpeg", filename: null },
      },
    ]) {
      calls.length = 0;
      const response = await handler(
        signedRequest({
          id: `evt-${payload.id}`,
          event: "message.any",
          session: "crm_primary",
          timestamp: 1_727_745_026,
          payload,
        }),
      );
      assert.equal(response.status, 200, payload.id);
      assert.equal(calls[0].name, "persist_provider_webhook_event");
      assert.equal(calls.at(-1).name, "finish_waha_webhook_work");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST projects a direct event with neither text nor media for staff review and ignores only WhatsApp's own notices", async () => {
  configureEnvironment();
  const reviewed = [
    { body: "" },
    { body: "   " },
    { body: null },
    {},
    { hasMedia: false, body: "" },
    // A location pin, a contact card and a poll are customer messages.
    { body: "", location: { latitude: 42.87, longitude: 74.59 } },
    { body: "", vCards: ["BEGIN:VCARD"], _data: { type: "vcard" } },
    { body: "", _data: { type: "poll_creation" } },
    { body: "", _data: { type: "ciphertext" } },
  ];
  for (const payload of reviewed) {
    const calls = [];
    const handler = createPlatformWahaWebhookHandler({
      createServiceClient: () => platformClient(recordingRpc(calls)),
    });
    const event = {
      id: "evt-no-text",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "false_79990000000@c.us_NOTEXT",
        from: "79990000000@c.us",
        fromMe: false,
        ...payload,
      },
    };
    const response = await handler(signedRequest(event));
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal((await response.json()).status, "projected", JSON.stringify(payload));
    // The event is kept as received and reaches the projection.
    assert.deepEqual(calls[0].args.p_raw_payload, event);
    assert.equal(
      calls.some((call) => call.name === "project_claimed_waha_event"),
      true,
    );
  }

  const notices = ["e2e_notification", "notification_template", "gp2", "protocol", "revoked"];
  for (const type of notices) {
    const calls = [];
    const handler = createPlatformWahaWebhookHandler({
      createServiceClient: () => platformClient(recordingRpc(calls)),
    });
    const response = await handler(
      signedRequest({
        id: `evt-${type}`,
        event: "message.any",
        session: "crm_primary",
        timestamp: 1_727_745_026,
        payload: {
          id: `false_79990000000@c.us_${type}`,
          from: "79990000000@c.us",
          fromMe: false,
          body: "",
          _data: { type },
        },
      }),
    );
    assert.equal(response.status, 200, type);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: "ignored",
      reason: "system_notice",
    });
    assert.deepEqual(calls, [], type);
  }
});

test("POST is inert unless EVO_PLATFORM_WAHA_INGRESS_ENABLED is exactly 1, even with a valid signature and a present secret", async () => {
  configureEnvironment();
  const body = {
    id: "evt-gated",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: "false_79990000000@c.us_GATED",
      from: "79990000000@c.us",
      fromMe: false,
      body: "private applicant text",
    },
  };
  for (const value of [undefined, "", "0", "true", " 1", "1 ", "01", "yes"]) {
    if (value === undefined) delete process.env.EVO_PLATFORM_WAHA_INGRESS_ENABLED;
    else process.env.EVO_PLATFORM_WAHA_INGRESS_ENABLED = value;
    let clientCreations = 0;
    const handler = createPlatformWahaWebhookHandler({
      createServiceClient: () => {
        clientCreations += 1;
        throw new Error("Supabase must not be called");
      },
    });
    // A signed event, an unsigned one and garbage get the same answer and no side effect.
    for (const request of [
      signedRequest(body),
      new Request("http://localhost/api/v2/whatsapp/inbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      new Request("http://localhost/api/v2/whatsapp/inbound", {
        method: "POST",
        body: "not json",
      }),
    ]) {
      const response = await handler(request);
      const serialized = await response.text();
      assert.equal(response.status, 503, String(value));
      assert.deepEqual(JSON.parse(serialized), {
        ok: false,
        error: "waha_webhook_unavailable",
      });
      assert.equal(serialized.includes("private applicant text"), false);
      assert.equal(request.bodyUsed, false, "the body is not even read");
    }
    assert.equal(clientCreations, 0, String(value));
  }

  // Exactly "1" opens it again.
  process.env.EVO_PLATFORM_WAHA_INGRESS_ENABLED = "1";
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(recordingRpc(calls)),
  });
  assert.equal((await handler(signedRequest(body))).status, 200);
});

test("POST still rejects an oversized text and a malformed direct sender with 400", async () => {
  configureEnvironment();
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => {
      throw new Error("Supabase must not be called");
    },
  });
  const request = (payload) =>
    signedRequest({
      id: "evt-bad",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: { id: "false_79990000000@c.us_BAD", fromMe: false, ...payload },
    });
  const oversized = await handler(
    request({ from: "79990000000@c.us", body: "x".repeat(4_001) }),
  );
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json()).error, "invalid_message_body");
  const malformed = await handler(
    request({ from: "not-a-chat", body: "text" }),
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "invalid_message_sender");
});

test("POST accepts a customer reported by a LID, with and without a phone alternative, and stores the event as received", async () => {
  configureEnvironment();
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(recordingRpc(calls)),
  });
  const lidEvents = [
    {
      id: "evt-lid-plain",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_026,
      payload: {
        id: "false_123456789012345@lid_PLAIN",
        from: "123456789012345@lid",
        fromMe: false,
        source: "app",
        body: "Hello from a LID",
      },
    },
    {
      id: "evt-lid-phone",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_027,
      payload: {
        id: "false_223456789012345@lid_PHONE",
        from: "223456789012345@lid",
        fromMe: false,
        source: "app",
        body: "Hello with a phone",
        _data: {
          Info: { SenderAlt: "79990000000@s.whatsapp.net", PushName: "Anna" },
        },
      },
    },
    {
      id: "evt-lid-media",
      event: "message.any",
      session: "crm_primary",
      timestamp: 1_727_745_028,
      payload: {
        id: "false_323456789012345@lid_MEDIA",
        from: "323456789012345@lid",
        fromMe: false,
        source: "app",
        body: "",
        hasMedia: true,
        media: { mimetype: "audio/ogg; codecs=opus", filename: null },
      },
    },
  ];

  for (const event of lidEvents) {
    calls.length = 0;
    const response = await handler(signedRequest(event));
    assert.equal(response.status, 200, event.id);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: "projected",
      eventType: "message.any",
      deduplicated: false,
    });
    assert.equal(calls[0].name, "persist_provider_webhook_event");
    assert.deepEqual(calls[0].args.p_raw_payload, event);
    assert.equal(calls[0].args.p_payload_id, event.payload.id);
    assert.equal(calls.at(-1).name, "finish_waha_webhook_work");
  }

  // Not a direct customer id at all: still a 400.
  const malformed = await handler(
    signedRequest({
      ...lidEvents[0],
      payload: { ...lidEvents[0].payload, from: "12@lid" },
    }),
  );
  assert.equal(malformed.status, 400);
});

test("POST enqueues only a message the sales team sent from the phone or app; the CRM's own sends and unverified origins stay evidence", async () => {
  configureEnvironment();
  const sent = (id, extra) => ({
    id: `evt-${id}`,
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: {
      id: `true_79990000000@c.us_${id}`,
      from: "79990000001@c.us",
      to: "79990000000@c.us",
      fromMe: true,
      body: "Ответ с телефона",
      ...extra,
    },
  });

  for (const [label, event, status] of [
    ["phone/app text", sent("APP1", { source: "app" }), "projected"],
    ["phone/app to a LID chat", sent("APP2", { source: "app", to: "123456789012345@lid" }), "projected"],
    ["phone/app to an @s.whatsapp.net chat", sent("APP3", { source: "app", to: "79990000000@s.whatsapp.net" }), "projected"],
    ["phone/app media", sent("APP4", { source: "app", body: "", hasMedia: true, media: { mimetype: "image/jpeg" } }), "projected"],
    ["the CRM's own API send", sent("API1", { source: "api" }), "observed"],
    ["no source", sent("NOSRC1", {}), "observed"],
    ["phone/app with nothing to store", sent("EMPTY1", { source: "app", body: "" }), "observed"],
    ["phone/app without a target", sent("NOTO1", { source: "app", to: undefined }), "observed"],
  ]) {
    const calls = [];
    const handler = createPlatformWahaWebhookHandler({
      createServiceClient: () => platformClient(recordingRpc(calls)),
    });
    const response = await handler(signedRequest(event));
    assert.equal(response.status, status === "projected" ? 200 : 202, label);
    assert.equal((await response.json()).status, status, label);
    assert.deepEqual(
      calls.map((call) => call.name),
      status === "projected"
        ? [
            "persist_provider_webhook_event",
            "enqueue_verified_webhook_work",
            "claim_waha_webhook_work_item",
            "project_claimed_waha_event",
            "finish_waha_webhook_work",
          ]
        : ["persist_provider_webhook_event"],
      label,
    );
  }
});
