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

  const notices = [
    "e2e_notification",
    "notification",
    "notification_template",
    "broadcast_notification",
    "gp2",
    "protocol",
    "revoked",
  ];
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

test("POST still rejects a malformed direct sender with 400", async () => {
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

// ---------------------------------------------------------------------------
// Engine shapes. Synthetic payloads built from the upstream SOURCE (PR #1137
// description lists the files and lines), not from a live stream:
//   WEBJS (whatsapp-web.js fork-main-2026-06-26, WAHA toWAMessage): a customer
//     message is from = customer, to = own; one sent from the phone is
//     from = own, to = customer; `_data` is the WhatsApp Web message model.
//   GOWS (WAHA getFromToParticipant over whatsmeow events.Message): for a direct
//     chat `from` = the CHAT (the customer) in BOTH directions, `to` = null,
//     `participant` = null, `id` = `<fromMe>_<chat>_<ID>`; `_data` is the
//     whatsmeow event: Info{Chat, Sender, IsFromMe, SenderAlt, RecipientAlt,
//     PushName, ...} and Message (waE2E.Message JSON, lowerCamel keys).
// ---------------------------------------------------------------------------
const OWN_PHONE = "79990000000@c.us";
const OWN_LID = "900000000000001@lid";
const OWN_ME = {
  id: OWN_PHONE,
  lid: OWN_LID,
  jid: "79990000000:12@s.whatsapp.net",
  pushName: "EVO Sales",
};
// WAHA 2026.9.2 (GOWS getSourceDeviceByMsg) labels a message `api` exactly when
// the device in `_data.Info.Sender` is the session's own linked device (the
// device of me.jid, 12 here) and `app` for any other own device. A message the
// sales team sent from the phone therefore comes from the primary phone, device
// 0 (a whatsmeow JID writes device 0 without a suffix), never from device 12.
const OWN_PHONE_DEVICE_JID = "79990000000@s.whatsapp.net";
const OWN_OTHER_LINKED_DEVICE_JID = "79990000000:5@s.whatsapp.net";

function rawJid(chat) {
  return chat.replace(/@c\.us$/, "@s.whatsapp.net");
}

function thumbnail(bytes) {
  return Buffer.alloc(bytes, 7).toString("base64");
}

// `me: null` omits the envelope's `me` (an unknown own account).
function withoutSource(payload) {
  const copy = { ...payload };
  delete copy.source;
  return copy;
}

function gowsEnvelope(messageId, payload, { me = OWN_ME, event = "message.any" } = {}) {
  return {
    id: `evt_${messageId}`,
    timestamp: 1_727_745_026_123,
    session: "crm_primary",
    metadata: {},
    engine: "GOWS",
    environment: { version: "2026.9.2", engine: "GOWS", tier: "CORE" },
    ...(me === null ? {} : { me }),
    event,
    payload,
  };
}

// A direct GOWS message. `fromMe` false: the customer wrote; true: sent from
// the phone ("app") or by the CRM's own session ("api").
function gowsDirectPayload({
  chat,
  fromMe = false,
  id,
  body,
  source,
  message,
  info = {},
  hasMedia = false,
  media = null,
}) {
  const origin = source ?? "app";
  // The sender follows the origin, as in WAHA: the session's own device sent an
  // `api` message, the phone an `app` one.
  const ownSender = fromMe
    ? origin === "api"
      ? OWN_ME.jid
      : OWN_PHONE_DEVICE_JID
    : rawJid(chat);
  const content = message ?? (body ? { conversation: body } : {});
  return {
    id: `${fromMe}_${chat}_${id}`,
    timestamp: 1_727_745_026,
    from: chat,
    fromMe,
    source: origin,
    ...(body === undefined ? {} : { body }),
    to: null,
    participant: null,
    hasMedia,
    media,
    ack: 2,
    ackName: "DEVICE",
    replyTo: null,
    _data: {
      Info: {
        Chat: rawJid(chat),
        Sender: ownSender,
        IsFromMe: fromMe,
        IsGroup: false,
        AddressingMode: chat.endsWith("@lid") ? "lid" : "pn",
        SenderAlt: "",
        RecipientAlt: "",
        BroadcastListOwner: "",
        BroadcastRecipients: null,
        ID: id,
        ServerID: 0,
        Type: hasMedia ? "media" : "text",
        PushName: "",
        Timestamp: "2026-10-03T10:00:00Z",
        MediaType: "",
        Edit: "",
        ...info,
      },
      Message: content,
      IsEphemeral: false,
      IsViewOnce: false,
      RawMessage: content,
      Status: fromMe ? "SERVER_ACK" : "DELIVERY_ACK",
    },
  };
}

// A direct WEBJS message: `from` / `to` are the two accounts of the chat.
function webjsDirectPayload({ chat, fromMe = false, id, body, source, extra = {} }) {
  return {
    id: `${fromMe}_${chat}_${id}`,
    timestamp: 1_727_745_026,
    from: fromMe ? OWN_PHONE : chat,
    fromMe,
    source: source ?? "app",
    body: body ?? "",
    to: fromMe ? chat : OWN_PHONE,
    participant: null,
    hasMedia: false,
    media: null,
    _data: {
      id: { fromMe, remote: chat, id, _serialized: `${fromMe}_${chat}_${id}` },
      type: "chat",
      from: fromMe ? OWN_PHONE : chat,
      to: fromMe ? chat : OWN_PHONE,
      notifyName: "Customer",
    },
    ...extra,
  };
}

function webjsEnvelope(messageId, payload, event = "message.any") {
  return {
    id: `evt_${messageId}`,
    timestamp: 1_727_745_026_123,
    session: "crm_primary",
    engine: "WEBJS",
    me: { id: OWN_PHONE, lid: OWN_LID, pushName: "EVO Sales" },
    event,
    payload,
  };
}

const PROJECTED_CALLS = [
  "persist_provider_webhook_event",
  "enqueue_verified_webhook_work",
  "claim_waha_webhook_work_item",
  "project_claimed_waha_event",
  "finish_waha_webhook_work",
];

async function deliver(event) {
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(recordingRpc(calls)),
  });
  const response = await handler(signedRequest(event));
  return { response, body: await response.json(), calls };
}

test("POST resolves a GOWS direct chat in both directions: from is the chat, to is null, and a phone-sent message is enqueued from _data.Info.Chat", async () => {
  configureEnvironment();
  const customer = "79990000011@c.us";
  const lid = "423456789012345@lid";
  const table = [
    // Customer messages: from = chat.
    ["GOWS inbound text (c.us)", gowsDirectPayload({ chat: customer, id: "G1", body: "Здравствуйте" }), "projected"],
    ["GOWS inbound text (LID, no alt)", gowsDirectPayload({ chat: lid, id: "G2", body: "Hello" }), "projected"],
    [
      "GOWS inbound text (LID with SenderAlt)",
      gowsDirectPayload({ chat: lid, id: "G3", body: "Hello", info: { SenderAlt: "79990000012:7@s.whatsapp.net", PushName: "Anna" } }),
      "projected",
    ],
    // Sent from the phone (device differs from the session's): to = null.
    ["GOWS phone-sent text (c.us)", gowsDirectPayload({ chat: customer, fromMe: true, id: "G4", body: "Ответ", source: "app" }), "projected"],
    ["GOWS phone-sent text (LID)", gowsDirectPayload({ chat: lid, fromMe: true, id: "G5", body: "Ответ", source: "app" }), "projected"],
    [
      "GOWS phone-sent text (LID with RecipientAlt)",
      gowsDirectPayload({ chat: lid, fromMe: true, id: "G6", body: "Ответ", source: "app", info: { RecipientAlt: "79990000012@s.whatsapp.net" } }),
      "projected",
    ],
    [
      "GOWS phone-sent media with a caption",
      gowsDirectPayload({
        chat: customer,
        fromMe: true,
        id: "G7",
        body: "Оффер",
        source: "app",
        hasMedia: true,
        media: { url: null, mimetype: "application/pdf", filename: "offer.pdf" },
        message: { documentMessage: { mimetype: "application/pdf", fileName: "offer.pdf", caption: "Оффер", JPEGThumbnail: thumbnail(3_000) } },
      }),
      "projected",
    ],
    // The CRM's own API send echoing back (sent by the session's own linked device,
    // Info.Sender = me.jid, device 12), and an unverified origin: evidence only.
    ["GOWS CRM API send echo", gowsDirectPayload({ chat: customer, fromMe: true, id: "G8", body: "From the CRM", source: "api" }), "observed"],
    ["GOWS phone-sent without a source", withoutSource(gowsDirectPayload({ chat: customer, fromMe: true, id: "G9", body: "x" })), "observed"],
    ["GOWS phone-sent with nothing to store", gowsDirectPayload({ chat: customer, fromMe: true, id: "G10", body: "", source: "app" }), "observed"],
  ];
  for (const [label, payload, status] of table) {
    const { response, body, calls } = await deliver(gowsEnvelope(payload.id, payload));
    assert.equal(response.status, status === "projected" ? 200 : 202, label);
    assert.equal(body.status, status, label);
    assert.deepEqual(
      calls.map((call) => call.name),
      status === "projected" ? PROJECTED_CALLS : ["persist_provider_webhook_event"],
      label,
    );
    // The signed envelope is stored exactly as received, `me` included.
    assert.deepEqual(calls[0].args.p_raw_payload, gowsEnvelope(payload.id, payload), label);
  }
});

test("POST falls back to from for a phone-sent message with neither to nor _data.Info.Chat only when the own number is known and is not the sender", async () => {
  configureEnvironment();
  const customer = "79990000013@c.us";
  const bare = (extra = {}) => ({
    id: `true_${customer}_FB1`,
    timestamp: 1_727_745_026,
    from: customer,
    fromMe: true,
    source: "app",
    body: "Ответ",
    to: null,
    ...extra,
  });
  const table = [
    // The envelope names the own account and `from` is someone else: the chat.
    ["from, own number known", gowsEnvelope("FB1", bare()), "projected"],
    // No `me` and nothing else names the own account: not provable, not enqueued.
    ["from, own number unknown", gowsEnvelope("FB2", bare(), { me: null }), "observed"],
    // `from` is the own number (a WEBJS-like note to self): never a customer.
    ["from is the own number", gowsEnvelope("FB3", bare({ from: OWN_PHONE })), "observed"],
    ["from is the own LID", gowsEnvelope("FB4", bare({ from: OWN_LID })), "observed"],
  ];
  for (const [label, event, status] of table) {
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, status === "projected" ? 200 : 202, label);
    assert.equal(body.status, status, label);
    assert.equal(calls.length, status === "projected" ? PROJECTED_CALLS.length : 1, label);
  }
});

test("POST never treats the own number as a customer: self-chat messages stay evidence and an own sender is ignored", async () => {
  configureEnvironment();
  const table = [
    // GOWS note to self: Info.Chat is the own account (phone, LID, or phone with a device).
    ["GOWS to self (phone)", gowsEnvelope("S1", gowsDirectPayload({ chat: OWN_PHONE, fromMe: true, id: "S1", body: "note", source: "app" })), 202],
    ["GOWS to self (LID)", gowsEnvelope("S2", gowsDirectPayload({ chat: OWN_LID, fromMe: true, id: "S2", body: "note", source: "app" })), 202],
    [
      "GOWS to self, own account only known from the message itself (no me)",
      gowsEnvelope("S3", gowsDirectPayload({ chat: OWN_PHONE, fromMe: true, id: "S3", body: "note", source: "app" }), { me: null }),
      202,
    ],
    // WEBJS note to self: to = own.
    ["WEBJS to self", webjsEnvelope("S4", webjsDirectPayload({ chat: OWN_PHONE, fromMe: true, id: "S4", body: "note" })), 202],
    // A customer message whose sender is the own number is a safeguard case: ignored, nothing written.
    ["GOWS inbound from the own number", gowsEnvelope("S5", gowsDirectPayload({ chat: OWN_PHONE, id: "S5", body: "echo" })), 200],
    ["WEBJS inbound from the own LID", webjsEnvelope("S6", webjsDirectPayload({ chat: OWN_LID, id: "S6", body: "echo" })), 200],
  ];
  for (const [label, event, status] of table) {
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, status, label);
    if (status === 200) {
      assert.deepEqual(body, { ok: true, status: "ignored", reason: "own_chat" }, label);
      assert.deepEqual(calls, [], label);
    } else {
      assert.equal(body.status, "observed", label);
      assert.deepEqual(calls.map((call) => call.name), ["persist_provider_webhook_event"], label);
    }
  }
});

test("POST keeps the WEBJS shapes exactly as before: from = customer / to = own inbound, from = own / to = customer phone-sent", async () => {
  configureEnvironment();
  const customer = "79990000014@c.us";
  const table = [
    ["WEBJS inbound", webjsEnvelope("W1", webjsDirectPayload({ chat: customer, id: "W1", body: "Здравствуйте" })), "projected"],
    ["WEBJS inbound LID", webjsEnvelope("W2", webjsDirectPayload({ chat: "523456789012345@lid", id: "W2", body: "Hello" })), "projected"],
    ["WEBJS phone-sent", webjsEnvelope("W3", webjsDirectPayload({ chat: customer, fromMe: true, id: "W3", body: "Ответ" })), "projected"],
    ["WEBJS phone-sent to a LID", webjsEnvelope("W4", webjsDirectPayload({ chat: "523456789012345@lid", fromMe: true, id: "W4", body: "Ответ" })), "projected"],
    ["WEBJS CRM API send", webjsEnvelope("W5", webjsDirectPayload({ chat: customer, fromMe: true, id: "W5", body: "From the CRM", source: "api" })), "observed"],
    // No envelope `me` at all (the existing fixtures): the resolution is unchanged.
    [
      "WEBJS phone-sent without me",
      { ...webjsEnvelope("W6", webjsDirectPayload({ chat: customer, fromMe: true, id: "W6", body: "Ответ" })), me: undefined },
      "projected",
    ],
  ];
  for (const [label, event, status] of table) {
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, status === "projected" ? 200 : 202, label);
    assert.equal(body.status, status, label);
    assert.deepEqual(
      calls.map((call) => call.name),
      status === "projected" ? PROJECTED_CALLS : ["persist_provider_webhook_event"],
      label,
    );
  }
});

test("POST answers 200 ignored for a GOWS group, Status and broadcast event that carries _data.Info.Chat", async () => {
  configureEnvironment();
  for (const chat of ["120363000000000001@g.us", "status@broadcast", "120363000000000002@newsletter"]) {
    const payload = gowsDirectPayload({ chat: "79990000015@c.us", id: "GRP1", body: "hello" });
    // Only the raw chat names the group: the WAHA-level fields look direct.
    payload._data.Info.Chat = chat;
    payload._data.Info.IsGroup = chat.endsWith("@g.us");
    const { response, body, calls } = await deliver(gowsEnvelope("GRP1", payload));
    assert.equal(response.status, 200, chat);
    assert.deepEqual(body, { ok: true, status: "ignored", reason: "non_direct_chat" }, chat);
    assert.deepEqual(calls, [], chat);
  }
});

test("POST ignores GOWS protocol, revoke, edit, reaction and poll-vote messages and keeps every other text-less direct message for staff review", async () => {
  configureEnvironment();
  const customer = "79990000016@c.us";
  const send = (id, message, extra = {}) =>
    gowsEnvelope(id, gowsDirectPayload({ chat: customer, id, message, ...extra }));
  const notices = [
    ["revoke", { protocolMessage: { key: { remoteJID: rawJid(customer), fromMe: false, ID: "OLD1" }, type: 0 } }],
    ["ephemeral setting", { protocolMessage: { type: 3, ephemeralExpiration: 604800 }, messageContextInfo: { deviceListMetadata: {} } }],
    ["edit", { protocolMessage: { key: { ID: "OLD2" }, type: 14, editedMessage: { conversation: "fixed" } } }],
    ["reaction", { reactionMessage: { key: { ID: "OLD3" }, text: "👍" } }],
    ["encrypted reaction", { encReactionMessage: { targetMessageKey: { ID: "OLD4" } } }],
    ["poll vote", { pollUpdateMessage: { pollCreationMessageKey: { ID: "OLD5" } } }],
    ["event response", { encEventResponseMessage: { eventCreationMessageKey: { ID: "OLD6" } } }],
    ["keep in chat", { keepInChatMessage: { key: { ID: "OLD7" }, keepType: 1 } }],
    ["notice with companion keys", { senderKeyDistributionMessage: { groupID: "x" }, messageContextInfo: {}, protocolMessage: { type: 0 } }],
    // WAHA drops a message that is only a sender-key distribution (gows
    // shouldProcessIncomingMessage); the webhook does too if one arrives.
    ["sender key distribution only", { senderKeyDistributionMessage: { groupID: "x" }, messageContextInfo: {} }],
    ["fast ratchet key distribution only", { fastRatchetKeySenderKeyDistributionMessage: { groupID: "x" } }],
  ];
  for (const [label, message] of notices) {
    const { response, body, calls } = await deliver(send(`N-${label}`, message));
    assert.equal(response.status, 200, label);
    assert.deepEqual(body, { ok: true, status: "ignored", reason: "system_notice" }, label);
    assert.deepEqual(calls, [], label);
  }

  const kept = [
    ["empty message", {}],
    ["only a message context", { messageContextInfo: {} }],
    ["location pin", { locationMessage: { degreesLatitude: 42.87, degreesLongitude: 74.59 } }],
    ["contact card", { contactMessage: { displayName: "Anna", vcard: "BEGIN:VCARD" } }],
    ["poll", { pollCreationMessage: { name: "Q", options: [{ optionName: "A" }] } }],
    ["call log", { callLogMesssage: { callOutcome: 1 } }],
    ["placeholder for an unavailable message", { placeholderMessage: { type: 0 } }],
    // A protocol key next to real content is not a notice.
    ["protocol key next to a location", { protocolMessage: { type: 0 }, locationMessage: { degreesLatitude: 1 } }],
    // Key material next to real content is not a notice either.
    ["key distribution next to a location", { senderKeyDistributionMessage: { groupID: "x" }, locationMessage: { degreesLatitude: 1 } }],
  ];
  for (const [label, message] of kept) {
    const event = send(`K-${label}`, message);
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, 200, label);
    assert.equal(body.status, "projected", label);
    assert.deepEqual(calls[0].args.p_raw_payload, event, label);
    assert.equal(calls.some((call) => call.name === "project_claimed_waha_event"), true, label);
  }

  // Text or media always wins over the key list.
  const withText = send("T1", { protocolMessage: { type: 0 } }, { body: "written text" });
  assert.equal((await deliver(withText)).body.status, "projected");
  const withMedia = send("T2", { reactionMessage: { text: "x" } }, { hasMedia: true, media: { url: null, mimetype: "image/jpeg", filename: null } });
  assert.equal((await deliver(withMedia)).body.status, "projected");
});

test("POST accepts a GOWS media event with downloadMedia off ({url: null, mimetype, fileName}) with and without a caption, thumbnail included, and stores it as received", async () => {
  configureEnvironment();
  const customer = "79990000017@c.us";
  const image = (caption) => ({
    imageMessage: {
      URL: "https://mmg.whatsapp.net/v/t62.7118-24/synthetic.enc",
      mimetype: "image/jpeg",
      ...(caption ? { caption } : {}),
      fileLength: 48_211,
      mediaKey: thumbnail(32),
      JPEGThumbnail: thumbnail(6_000),
      thumbnailDirectPath: "/v/t62.7118-24/synthetic-thumb",
    },
  });
  const events = [
    gowsDirectPayload({
      chat: customer,
      id: "M1",
      body: "Мой диплом",
      message: image("Мой диплом"),
      hasMedia: true,
      media: { url: null, mimetype: "image/jpeg", filename: null },
    }),
    // No caption: WAHA leaves `body` out of the payload (`mediaContent?.caption` is undefined).
    gowsDirectPayload({
      chat: customer,
      id: "M2",
      message: image(null),
      hasMedia: true,
      media: { url: null, mimetype: "image/jpeg", filename: null },
    }),
    gowsDirectPayload({
      chat: "423456789012345@lid",
      id: "M3",
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", PTT: true, waveform: thumbnail(64) } },
      hasMedia: true,
      media: { url: null, mimetype: "audio/ogg; codecs=opus", filename: null },
    }),
  ];
  for (const payload of events) {
    const event = gowsEnvelope(payload._data.Info.ID, payload);
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, 200, payload.id);
    assert.equal(body.status, "projected", payload.id);
    assert.deepEqual(calls[0].args.p_raw_payload, event, payload.id);
  }
});

test("POST accepts a realistic GOWS media event up to 256 KiB and answers 413 above it", async () => {
  configureEnvironment();
  const customer = "79990000018@c.us";
  // The message sits in Message and RawMessage and a quoted media message a
  // third time (replyTo._data): three copies of a link-preview-sized thumbnail
  // plus the quoted message's own.
  const preview = { documentMessage: { mimetype: "application/pdf", fileName: "a.pdf", JPEGThumbnail: thumbnail(36_000) } };
  const payload = gowsDirectPayload({
    chat: customer,
    id: "BIG1",
    body: "см. вложение",
    message: preview,
    hasMedia: true,
    media: { url: null, mimetype: "application/pdf", filename: "a.pdf" },
  });
  payload.replyTo = { id: "OLD", body: "quoted", hasMedia: true, media: null, _data: preview };
  const event = gowsEnvelope("BIG1", payload);
  const size = Buffer.byteLength(JSON.stringify(event));
  assert.ok(size > 64 * 1024 && size < 256 * 1024, `fixture is ${size} bytes`);
  const accepted = await deliver(event);
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.status, "projected");

  const huge = gowsEnvelope("BIG2", {
    ...payload,
    id: `true_${customer}_BIG2`,
    body: "x".repeat(10),
    replyTo: { ...payload.replyTo, _data: { documentMessage: { JPEGThumbnail: thumbnail(300_000) } } },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) > 256 * 1024);
  const rejected = await deliver(huge);
  assert.equal(rejected.response.status, 413);
  assert.deepEqual(rejected.body, { ok: false, error: "payload_too_large" });
  assert.deepEqual(rejected.calls, []);
});

function recordingAckRpc(calls) {
  return async (name, args) => {
    calls.push({ name, args });
    switch (name) {
      case "persist_provider_webhook_event":
        return { data: { provider_webhook_event_id: PROVIDER_EVENT_ID, deduplicated: false }, error: null };
      case "enqueue_verified_webhook_work":
        return { data: { work_item_id: WORK_ITEM_ID }, error: null };
      case "claim_waha_webhook_work_item":
        return {
          data: {
            claimed: true, completed: false, requested_work_item_id: WORK_ITEM_ID, organization_id: ORGANIZATION_ID,
            work_item_id: WORK_ITEM_ID, attempt_id: ATTEMPT_ID, source_webhook_event_id: PROVIDER_EVENT_ID,
            kind: "provider_webhook_process", event_type: "message.ack", queue: "platform_work_v1",
            queue_message_id: 92, attempt_number: 1, max_attempts: 8, lease_expires_at: "2026-09-02T10:00:00Z",
          },
          error: null,
        };
      case "project_claimed_waha_observation":
        return {
          data: {
            organization_id: ORGANIZATION_ID, work_item_id: WORK_ITEM_ID, attempt_id: ATTEMPT_ID,
            disposition: "succeeded", evidence_ref: `waha-ack-projected:${PROVIDER_EVENT_ID}`, error_code: null,
          },
          error: null,
        };
      case "finish_waha_event_projection":
        return {
          data: { organization_id: ORGANIZATION_ID, work_item_id: WORK_ITEM_ID, attempt_id: ATTEMPT_ID, outcome: "succeeded", state: "succeeded" },
          error: null,
        };
      default:
        throw new Error(`Unexpected RPC: ${name}`);
    }
  };
}

test("POST projects the observation of a GOWS acknowledgement (from = chat, to = null, fromMe reversed by WAHA)", async () => {
  configureEnvironment();
  const customer = "79990000019@c.us";
  const calls = [];
  const rpc = recordingAckRpc(calls);
  const handler = createPlatformWahaWebhookHandler({ createServiceClient: () => platformClient(rpc) });
  const ack = {
    id: `true_${customer}_ACK1`,
    from: customer,
    to: null,
    participant: null,
    fromMe: true,
    ack: 3,
    ackName: "READ",
    _data: { Chat: rawJid(customer), Sender: rawJid(customer), IsFromMe: false, IsGroup: false, MessageIDs: ["ACK1"], Type: "read" },
  };
  const response = await handler(signedRequest(gowsEnvelope("ACK1", ack, { event: "message.ack" })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "projected", eventType: "message.ack", deduplicated: false });
  assert.equal(calls[0].args.p_provider_event_variant_ref, "read");
  assert.equal(calls[0].args.p_payload_id, ack.id);

  // A group receipt names the group in _data.Chat only: ignored, nothing written.
  const groupCalls = [];
  const groupHandler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(async (name, args) => { groupCalls.push({ name, args }); throw new Error("must not be called"); }),
  });
  const groupAck = { ...ack, _data: { ...ack._data, Chat: "120363000000000001@g.us", IsGroup: true } };
  const ignored = await groupHandler(signedRequest(gowsEnvelope("ACK2", groupAck, { event: "message.ack" })));
  assert.equal(ignored.status, 200);
  assert.deepEqual(await ignored.json(), { ok: true, status: "ignored", reason: "non_direct_chat" });
  assert.deepEqual(groupCalls, []);
});

// ---------------------------------------------------------------------------
// Review round 3: the public route is bounded while the body is read, the
// signature is checked over the raw bytes before anything is parsed, an ACK of
// the own chat is ignored, GOWS wrappers are peeled like WAHA does, and a
// phone-sent GOWS message comes from a phone device, not from the session's.
// ---------------------------------------------------------------------------
const MAX_BODY = 256 * 1024;
const INBOUND_URL = "http://localhost/api/v2/whatsapp/inbound";

function sign(raw) {
  return createHmac("sha512", WEBHOOK_SECRET).update(raw).digest("hex");
}

// A request whose body is a stream the test controls. `nextChunk()` returns a
// Uint8Array, or null to end the body. `state` shows how much was really pulled.
function streamedRequest(nextChunk, headers = {}) {
  const state = { pulls: 0, bytes: 0, cancelled: false };
  const stream = new ReadableStream(
    {
      pull(controller) {
        state.pulls += 1;
        const chunk = nextChunk();
        if (chunk === null) {
          controller.close();
          return;
        }
        state.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(INBOUND_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream,
    duplex: "half",
  });
  return { request, state };
}

// Raw bytes delivered as a stream in fixed-size chunks (no Content-Length).
function chunkedRequest(raw, headers = {}, chunkSize = 16 * 1024) {
  const bytes = Buffer.from(raw);
  let offset = 0;
  return streamedRequest(() => {
    if (offset >= bytes.byteLength) return null;
    const chunk = bytes.subarray(offset, offset + chunkSize);
    offset += chunk.byteLength;
    return new Uint8Array(chunk);
  }, headers);
}

// A valid message event whose serialized size is exactly `bytes`.
function eventOfExactSize(bytes) {
  const event = {
    id: "evt-exact-size",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    metadata: { pad: "" },
    payload: {
      id: "false_79990000022@c.us_EXACT1",
      from: "79990000022@c.us",
      fromMe: false,
      body: "Hello EVO",
    },
  };
  const base = Buffer.byteLength(JSON.stringify(event));
  event.metadata.pad = "x".repeat(bytes - base);
  const raw = JSON.stringify(event);
  assert.equal(Buffer.byteLength(raw), bytes);
  return raw;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function forbiddenClient() {
  return {
    createServiceClient: () => {
      throw new Error("Supabase must not be called");
    },
  };
}

test("POST answers 413 for a Content-Length above the cap before reading a byte of the body", async () => {
  configureEnvironment();
  const handler = createPlatformWahaWebhookHandler(forbiddenClient());
  for (const declared of [String(MAX_BODY + 1), ` ${MAX_BODY + 1} `, "99999999999999999999"]) {
    const { request, state } = streamedRequest(
      () => {
        throw new Error("the body must not be read");
      },
      { "content-length": declared },
    );
    const response = await handler(request);
    assert.equal(response.status, 413, declared);
    assert.deepEqual(await response.json(), { ok: false, error: "payload_too_large" });
    assert.equal(state.pulls, 0, "not a single pull");
    assert.equal(request.bodyUsed, false, "the body is not even locked");
  }
});

test("POST bounds a body with no Content-Length or a false one while it is read: the upload is cancelled at the cap", async () => {
  configureEnvironment();
  const handler = createPlatformWahaWebhookHandler(forbiddenClient());
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  for (const headers of [
    {}, // chunked: no Content-Length at all
    { "content-length": "10" }, // lies low
    { "content-length": "not-a-number" }, // malformed: not trusted either way
    { "x-webhook-hmac": "0".repeat(128), "x-webhook-hmac-algorithm": "sha512" }, // even a well-formed signature header
  ]) {
    // An endless body: only a bounded read can answer it.
    const { request, state } = streamedRequest(() => chunk, headers);
    const response = await handler(request);
    await settle();
    assert.equal(response.status, 413, JSON.stringify(headers));
    assert.deepEqual(await response.json(), { ok: false, error: "payload_too_large" });
    assert.equal(state.cancelled, true, "the upload is cancelled");
    // 256 KiB is 4 chunks of 64 KiB; the 5th passes the cap and stops the read.
    assert.ok(state.pulls <= 5, `pulled ${state.pulls} chunks of an endless body`);
    assert.ok(state.bytes <= MAX_BODY + 64 * 1024, `read ${state.bytes} bytes`);
  }
});

test("POST accepts a streamed body of exactly 256 KiB and refuses one byte more", async () => {
  configureEnvironment();
  const calls = [];
  const handler = createPlatformWahaWebhookHandler({
    createServiceClient: () => platformClient(recordingRpc(calls)),
  });
  const signedHeaders = (raw) => ({
    "x-webhook-hmac": sign(raw),
    "x-webhook-hmac-algorithm": "sha512",
  });

  const exact = eventOfExactSize(MAX_BODY);
  const accepted = await handler(chunkedRequest(exact, signedHeaders(exact)).request);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, "projected");
  // The same bytes with an honest Content-Length at the cap pass too.
  const honest = await handler(
    chunkedRequest(exact, { ...signedHeaders(exact), "content-length": String(MAX_BODY) }).request,
  );
  assert.equal(honest.status, 200);

  const calls413 = calls.length;
  const over = eventOfExactSize(MAX_BODY + 1);
  const rejected = await handler(chunkedRequest(over, signedHeaders(over)).request);
  assert.equal(rejected.status, 413);
  assert.deepEqual(await rejected.json(), { ok: false, error: "payload_too_large" });
  assert.equal(calls.length, calls413, "an oversized body writes nothing");
});

test("POST verifies the HMAC over the raw bytes before JSON.parse: an unsigned or wrongly signed body is never parsed", async () => {
  configureEnvironment();
  const handler = createPlatformWahaWebhookHandler(forbiddenClient());
  const marker = "PARSE-MARKER-7f3a";
  const parsed = [];
  const originalParse = JSON.parse;
  JSON.parse = function parse(text, ...rest) {
    parsed.push(String(text));
    return originalParse.call(this, text, ...rest);
  };
  let results;
  try {
    const headers = (raw, signature = sign(raw)) => ({
      "x-webhook-hmac": signature,
      "x-webhook-hmac-algorithm": "sha512",
    });
    const send = async (raw, extraHeaders) => {
      const response = await handler(
        new Request(INBOUND_URL, { method: "POST", headers: extraHeaders, body: raw }),
      );
      return response.status;
    };
    const validJson = JSON.stringify({ event: "message.any", session: "crm_primary", note: marker, payload: {} });
    const notJson = `not json ${marker}`;
    results = {
      // Malformed JSON with a wrong signature is a 401, never the 400 a parse would give.
      notJsonWrongSignature: await send(notJson, headers(notJson, "0".repeat(128))),
      notJsonUnsigned: await send(notJson, {}),
      // Valid JSON with a signature of other bytes.
      validJsonWrongSignature: await send(validJson, headers(validJson, sign(`${validJson} `))),
      validJsonUnsigned: await send(validJson, {}),
      // A signature over a different algorithm label.
      validJsonWrongAlgorithm: await send(validJson, { "x-webhook-hmac": sign(validJson), "x-webhook-hmac-algorithm": "sha256" }),
    };
  } finally {
    JSON.parse = originalParse;
  }
  assert.deepEqual(results, {
    notJsonWrongSignature: 401,
    notJsonUnsigned: 401,
    validJsonWrongSignature: 401,
    validJsonUnsigned: 401,
    validJsonWrongAlgorithm: 401,
  });
  assert.deepEqual(
    parsed.filter((text) => text.includes(marker)),
    [],
    "no unauthenticated body reached JSON.parse",
  );

  // Once the raw bytes are authenticated, malformed JSON is a 400 as before.
  const notJson = `not json ${marker}`;
  const signedGarbage = await handler(
    new Request(INBOUND_URL, {
      method: "POST",
      headers: { "x-webhook-hmac": sign(notJson), "x-webhook-hmac-algorithm": "sha512" },
      body: notJson,
    }),
  );
  assert.equal(signedGarbage.status, 400);
  assert.deepEqual(await signedGarbage.json(), { ok: false, error: "invalid_json" });
  // An empty body keeps its 400.
  const empty = await handler(new Request(INBOUND_URL, { method: "POST", body: "" }));
  assert.equal(empty.status, 400);
});

test("POST ignores an ACK of the own chat (200 ignored own_chat, nothing written) and still projects an ACK of a customer chat", async () => {
  configureEnvironment();
  const customer = "79990000023@c.us";
  const gowsAck = (chat, id, extra = {}) => ({
    id: `true_${chat}_${id}`,
    from: chat,
    to: null,
    participant: null,
    fromMe: true,
    ack: 3,
    ackName: "READ",
    _data: { Chat: rawJid(chat), Sender: rawJid(chat), IsFromMe: false, IsGroup: false, MessageIDs: [id], Type: "read" },
    ...extra,
  });
  // WEBJS: from is the own number whatever the chat, to is the chat.
  const webjsAck = (chat, id) => ({
    id: `true_${chat}_${id}`,
    from: OWN_PHONE,
    to: chat,
    participant: null,
    fromMe: true,
    ack: 2,
    ackName: "DEVICE",
  });
  const idOnlyAck = (chat, id) => ({ id: `true_${chat}_${id}`, fromMe: true, ack: 1, ackName: "SERVER" });

  const ignored = [
    ["GOWS receipt, own phone chat", gowsEnvelope("OA1", gowsAck(OWN_PHONE, "OA1"), { event: "message.ack" })],
    ["GOWS receipt, own LID chat", gowsEnvelope("OA2", gowsAck(OWN_LID, "OA2"), { event: "message.ack" })],
    ["WEBJS ack, to = own phone", webjsEnvelope("OA3", webjsAck(OWN_PHONE, "OA3"), "message.ack")],
    ["WEBJS ack, to = own LID", webjsEnvelope("OA4", webjsAck(OWN_LID, "OA4"), "message.ack")],
    ["id-only ack, own chat in the message id", gowsEnvelope("OA5", idOnlyAck(OWN_PHONE, "OA5"), { event: "message.ack" })],
    [
      "GOWS ack with the own chat only in _data.Info.Chat",
      gowsEnvelope("OA6", { ...idOnlyAck("79990000024@c.us", "OA6"), _data: { Info: { Chat: rawJid(OWN_PHONE) } } }, { event: "message.ack" }),
    ],
  ];
  for (const [label, event] of ignored) {
    const calls = [];
    const handler = createPlatformWahaWebhookHandler({
      createServiceClient: () => platformClient(recordingAckRpc(calls)),
    });
    const response = await handler(signedRequest(event));
    assert.equal(response.status, 200, label);
    assert.deepEqual(await response.json(), { ok: true, status: "ignored", reason: "own_chat" }, label);
    assert.deepEqual(calls, [], label);
  }

  const projected = [
    ["GOWS receipt, customer chat", gowsEnvelope("CA1", gowsAck(customer, "CA1"), { event: "message.ack" })],
    // from is the own number in EVERY WEBJS ack: it must not make the chat the own one.
    ["WEBJS ack, from = own, to = customer", webjsEnvelope("CA2", webjsAck(customer, "CA2"), "message.ack")],
    ["id-only ack, customer chat", gowsEnvelope("CA3", idOnlyAck(customer, "CA3"), { event: "message.ack" })],
    // The own account is not known (no me): nothing proves the chat is the own one.
    ["id-only ack, own-looking chat but no me", gowsEnvelope("CA4", idOnlyAck(OWN_PHONE, "CA4"), { event: "message.ack", me: null })],
  ];
  for (const [label, event] of projected) {
    const calls = [];
    const handler = createPlatformWahaWebhookHandler({
      createServiceClient: () => platformClient(recordingAckRpc(calls)),
    });
    const response = await handler(signedRequest(event));
    assert.equal(response.status, 200, label);
    assert.equal((await response.json()).status, "projected", label);
    assert.equal(calls[0].name, "persist_provider_webhook_event", label);
    assert.equal(calls[1].name, "enqueue_verified_webhook_work", label);
  }
});

test("POST peels GOWS ephemeral, view-once and document-with-caption wrappers before classifying, like WAHA's own filter", async () => {
  configureEnvironment();
  const customer = "79990000025@c.us";
  const send = (id, message) =>
    gowsEnvelope(id, gowsDirectPayload({ chat: customer, id, message }));
  const nest = (depth, inner, wrapper = "ephemeralMessage") => {
    let message = inner;
    for (let level = 0; level < depth; level += 1) message = { [wrapper]: { message } };
    return message;
  };
  const revoke = { protocolMessage: { key: { ID: "OLD1" }, type: 0 } };
  const reaction = { reactionMessage: { key: { ID: "OLD2" }, text: "👍" } };

  const notices = [
    ["ephemeral revoke", { ephemeralMessage: { message: revoke } }],
    ["ephemeral reaction next to a message context", { messageContextInfo: {}, ephemeralMessage: { message: reaction } }],
    ["viewOnceMessage protocol", { viewOnceMessage: { message: revoke } }],
    ["viewOnceMessageV2 reaction", { viewOnceMessageV2: { message: reaction } }],
    ["viewOnceMessageV2Extension poll vote", { viewOnceMessageV2Extension: { message: { pollUpdateMessage: { pollCreationMessageKey: { ID: "OLD3" } } } } }],
    ["documentWithCaptionMessage protocol", { documentWithCaptionMessage: { message: revoke } }],
    ["editedMessage edit", { editedMessage: { message: { protocolMessage: { key: { ID: "OLD4" }, type: 14, editedMessage: { conversation: "fixed" } } } } }],
    ["ephemeral around key distribution only", { ephemeralMessage: { message: { senderKeyDistributionMessage: { groupID: "x" }, messageContextInfo: {} } } }],
    ["two levels: ephemeral > edited > protocol", { ephemeralMessage: { message: { editedMessage: { message: revoke } } } }],
    ["five levels (the same cap as Baileys)", nest(5, revoke)],
  ];
  for (const [label, message] of notices) {
    const { response, body, calls } = await deliver(send(`W-${label}`, message));
    assert.equal(response.status, 200, label);
    assert.deepEqual(body, { ok: true, status: "ignored", reason: "system_notice" }, label);
    assert.deepEqual(calls, [], label);
  }

  const kept = [
    ["ephemeral location", { ephemeralMessage: { message: { locationMessage: { degreesLatitude: 42.87 } } } }],
    ["viewOnceMessageV2 image", { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } }],
    ["documentWithCaptionMessage document", { documentWithCaptionMessage: { message: { documentMessage: { fileName: "a.pdf", caption: "см." } } } }],
    ["ephemeral text", { ephemeralMessage: { message: { conversation: "text in a disappearing chat" } } }],
    // A protocol key next to real content inside the wrapper is not a notice.
    ["protocol next to a location inside a wrapper", { ephemeralMessage: { message: { protocolMessage: { type: 0 }, locationMessage: { degreesLatitude: 1 } } } }],
    // A wrapper next to other content is not a pure wrapper.
    ["wrapper next to a location", { ephemeralMessage: { message: revoke }, locationMessage: { degreesLatitude: 1 } }],
    // An empty or malformed wrapper hides nothing a customer wrote.
    ["wrapper without a message", { ephemeralMessage: {} }],
    ["wrapper with a null message", { ephemeralMessage: { message: null } }],
    ["wrapper with a string message", { ephemeralMessage: { message: "x" } }],
    ["wrapper that is not an object", { viewOnceMessage: "x" }],
    ["empty message inside a wrapper", { ephemeralMessage: { message: {} } }],
    // Past the cap the wrapper stays a wrapper, as in Baileys: customer content.
    ["six levels", nest(6, revoke)],
    // An unknown wrapper is unknown content.
    ["unknown wrapper", { futureProofMessage: { message: revoke } }],
  ];
  for (const [label, message] of kept) {
    const event = send(`WK-${label}`, message);
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, 200, label);
    assert.equal(body.status, "projected", label);
    assert.deepEqual(calls[0].args.p_raw_payload, event, label);
  }
});

test("POST tells the phone from the session's own linked device: only a phone device's source app is phone-sent, the session's own api send is a CRM echo", async () => {
  configureEnvironment();
  const customer = "79990000026@c.us";
  const phone = gowsDirectPayload({ chat: customer, fromMe: true, id: "D1", body: "Ответ с телефона", source: "app" });
  const web = gowsDirectPayload({
    chat: customer,
    fromMe: true,
    id: "D2",
    body: "Ответ из WhatsApp Web",
    source: "app",
    info: { Sender: OWN_OTHER_LINKED_DEVICE_JID },
  });
  const crm = gowsDirectPayload({ chat: customer, fromMe: true, id: "D3", body: "From the CRM", source: "api" });
  // The fixtures follow WAHA's own labelling rule: device 12 (me.jid) is api.
  assert.equal(phone._data.Info.Sender, OWN_PHONE_DEVICE_JID);
  assert.equal(web._data.Info.Sender, OWN_OTHER_LINKED_DEVICE_JID);
  assert.equal(crm._data.Info.Sender, OWN_ME.jid);
  const deviceOf = (jid) => /:(\d+)@/.exec(jid)?.[1] ?? null;
  assert.equal(deviceOf(phone._data.Info.Sender), null);
  assert.notEqual(deviceOf(web._data.Info.Sender), deviceOf(OWN_ME.jid));
  assert.equal(deviceOf(crm._data.Info.Sender), deviceOf(OWN_ME.jid));

  for (const [label, payload, status] of [
    ["phone (device 0), source app", phone, "projected"],
    ["another linked device, source app", web, "projected"],
    ["the session's own linked device, source api: a CRM echo", crm, "observed"],
  ]) {
    const { response, body, calls } = await deliver(gowsEnvelope(payload.id, payload));
    assert.equal(response.status, status === "projected" ? 200 : 202, label);
    assert.equal(body.status, status, label);
    assert.deepEqual(
      calls.map((call) => call.name),
      status === "projected" ? PROJECTED_CALLS : ["persist_provider_webhook_event"],
      label,
    );
  }
});

test("POST stores a long text in full instead of refusing it: customer and phone-sent, WEBJS and GOWS, while a GOWS event above the 256 KiB cap is still 413", async () => {
  configureEnvironment();
  const customer = "79990000013@c.us";
  // Synthetic texts. Up to 4,000 characters were accepted before; a longer one
  // was answered 400, which WAHA retries unchanged and then drops.
  const sized = (unit, length) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  const justOver = sized("Long customer question. ", 4_001);
  const latinMax = sized("Lorem ipsum dolor sit amet, consectetur. ", 65_536);
  const cyrillic = sized("Здравствуйте, у меня вопрос о поступлении и документах.\n", 40_000);
  const phoneReply = sized("Ответ менеджера с телефона: список документов и сроки.\n", 30_000);
  const webjs = {
    id: "evt-long-webjs",
    event: "message.any",
    session: "crm_primary",
    timestamp: 1_727_745_026,
    payload: { id: `false_${customer}_LONG1`, from: customer, fromMe: false, body: justOver },
  };
  const gows = (id, text, extra = {}) => {
    const payload = gowsDirectPayload({ chat: customer, id, body: text, ...extra });
    return gowsEnvelope(payload.id, payload);
  };
  for (const [label, event, text] of [
    ["WEBJS customer text just over the former 4,000 limit", webjs, justOver],
    // GOWS carries the text three times: body, _data.Message, _data.RawMessage.
    ["GOWS customer text of 65,536 Latin characters", gows("LONG2", latinMax), latinMax],
    ["GOWS customer text of 40,000 Cyrillic characters", gows("LONG3", cyrillic), cyrillic],
    [
      "GOWS phone-sent text of 30,000 Cyrillic characters",
      gows("LONG4", phoneReply, { fromMe: true, source: "app" }),
      phoneReply,
    ],
  ]) {
    assert.ok(Buffer.byteLength(JSON.stringify(event)) < MAX_BODY, label);
    const { response, body, calls } = await deliver(event);
    assert.equal(response.status, 200, label);
    assert.equal(body.status, "projected", label);
    assert.deepEqual(calls.map((call) => call.name), PROJECTED_CALLS, label);
    // The evidence the projection reads keeps the whole text, not a cut.
    assert.equal(calls[0].args.p_raw_payload.payload.body, text, label);
    assert.equal(calls[0].args.p_raw_payload.payload.body.length, text.length, label);
  }

  // The one bound left: a GOWS event whose three copies pass 256 KiB.
  const tooLarge = JSON.stringify(gows("LONG5", sized("Очень длинный текст. ", 65_536)));
  assert.ok(Buffer.byteLength(tooLarge) > MAX_BODY);
  const handler = createPlatformWahaWebhookHandler(forbiddenClient());
  const signature = createHmac("sha512", WEBHOOK_SECRET).update(tooLarge).digest("hex");
  const response = await handler(
    new Request("http://localhost/api/v2/whatsapp/inbound", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(tooLarge)),
        "x-webhook-hmac": signature,
        "x-webhook-hmac-algorithm": "sha512",
      },
      body: tooLarge,
    }),
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: "payload_too_large" });
});
