import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlatformCommunicationMediaDownloadHandler,
} from "../src/lib/server/platform-communication-media-route-handlers.ts";

const IDS = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  media: "22222222-2222-4222-8222-222222222222",
  grant: "33333333-3333-4333-8333-333333333333",
  requestOne: "44444444-4444-4444-8444-444444444444",
  requestTwo: "55555555-5555-4555-8555-555555555555",
});
const ORIGIN = "https://project-ref.supabase.co";
const BUCKET = "platform-whatsapp-media";
const OBJECT_NAME = `ab/${"c".repeat(62)}`;
const SIGNED_QUERY_VALUE = "header.payload_signature-token";
const SIGNED_PATH = `/storage/v1/object/sign/${BUCKET}/${OBJECT_NAME}`;
const ACTOR = Object.freeze({
  authUserId: "66666666-6666-4666-8666-666666666666",
  profileId: "77777777-7777-4777-8777-777777777777",
  membershipId: "88888888-8888-4888-8888-888888888888",
  organizationId: IDS.organization,
  displayName: "Media Reader",
  email: "reader@example.test",
  platformRole: "sales",
  authorityRole: "sales",
  presentationRole: "sales",
  platformAccessVersion: 1,
  platformBundleId: "99999999-9999-4999-8999-999999999999",
  platformBundleVersion: 1,
});

function grant(overrides = {}) {
  return {
    media_download_grant_id: IDS.grant,
    expires_at: "2026-09-07T12:05:00.000Z",
    signed_url: null,
    storage_api_service_sign_required: true,
    ...overrides,
  };
}

function consumption(overrides = {}) {
  return {
    organization_id: IDS.organization,
    media_download_grant_id: IDS.grant,
    media_id: IDS.media,
    bucket_id: BUCKET,
    object_name: OBJECT_NAME,
    max_signed_url_expires_in_seconds: 60,
    mime_type: "application/pdf",
    file_name: "offer.pdf",
    signed_url: null,
    ...overrides,
  };
}

function createHarness({
  authorization = { status: "authorized", actor: ACTOR },
  grantData = grant(),
  grantError = null,
  consumptionData = consumption(),
  consumptionError = null,
  signedUrl,
  signingError = null,
  supabaseOrigin = ORIGIN,
} = {}) {
  const calls = [];
  const requestIds = [IDS.requestOne, IDS.requestTwo];
  const userClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          return { data: grantData, error: grantError };
        },
      };
    },
  };
  const serviceClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["service-rpc", name, args]);
          return { data: consumptionData, error: consumptionError };
        },
      };
    },
    storage: {
      from(bucket) {
        calls.push(["storage-from", bucket]);
        return {
          async createSignedUrl(objectName, expiresIn, options) {
            calls.push(["sign", objectName, expiresIn, options]);
            const suffix = options?.download === true ? "&download=" : "";
            return {
              data: {
                signedUrl: signedUrl
                  ?? `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}${suffix}`,
              },
              error: signingError,
            };
          },
        };
      },
    },
  };
  const dependencies = {
    async authorize(capability) {
      calls.push(["authorize", capability]);
      return authorization;
    },
    async createUserClient() {
      calls.push(["user-client"]);
      return userClient;
    },
    createServiceClient() {
      calls.push(["service-client"]);
      return serviceClient;
    },
    requestId() {
      const value = requestIds.shift();
      assert.ok(value, "route requested more than two request ids");
      return value;
    },
    supabaseOrigin() {
      return supabaseOrigin;
    },
  };
  return { calls, dependencies };
}

async function run(harness, { query = "", mediaId = IDS.media } = {}) {
  return createPlatformCommunicationMediaDownloadHandler(harness.dependencies)(
    new Request(`https://app.example.test/api/v3/communication-media/${mediaId}${query}`),
    { params: Promise.resolve({ mediaId }) },
  );
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

test("media preview authorizes, grants, consumes once and redirects to an exact private signed URL", async () => {
  const harness = createHarness();
  const response = await run(harness);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}`);
  assertSecurityHeaders(response);
  assert.deepEqual(harness.calls, [
    ["authorize", "messaging.read"],
    ["user-client"],
    ["user-rpc", "grant_communication_media_download", {
      p_organization_id: IDS.organization,
      p_media_id: IDS.media,
      p_request_id: IDS.requestOne,
    }],
    ["service-client"],
    ["service-rpc", "consume_communication_media_download_grant", {
      p_media_download_grant_id: IDS.grant,
      p_request_id: IDS.requestTwo,
    }],
    ["storage-from", BUCKET],
    ["sign", OBJECT_NAME, 60, undefined],
  ]);
});

test("only exact download=1 requests attachment disposition", async () => {
  const harness = createHarness();
  const response = await run(harness, { query: "?download=1" });

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}&download=`,
  );
  assertSecurityHeaders(response);
  assert.deepEqual(harness.calls.at(-1), ["sign", OBJECT_NAME, 60, { download: true }]);

  for (const query of ["?download=0", "?download=1&download=1", "?download=1&x=1", "?x=1"]) {
    const invalid = createHarness();
    const invalidResponse = await run(invalid, { query });
    assert.equal(invalidResponse.status, 400, query);
    assertSecurityHeaders(invalidResponse);
    assert.equal(invalid.calls.some(([kind]) => kind === "user-client"), false);
  }
});

test("authorization and malformed identifiers fail before a user or service client exists", async () => {
  for (const [authorization, status] of [
    [{ status: "anonymous", actor: null }, 401],
    [{ status: "forbidden", actor: null }, 403],
    [{ status: "unavailable", actor: null }, 503],
  ]) {
    const harness = createHarness({ authorization });
    const response = await run(harness);
    assert.equal(response.status, status);
    assertSecurityHeaders(response);
    assert.deepEqual(harness.calls, [["authorize", "messaging.read"]]);
  }

  const malformed = createHarness();
  const response = await run(malformed, { mediaId: "not-a-uuid" });
  assert.equal(response.status, 400);
  assertSecurityHeaders(response);
  assert.deepEqual(malformed.calls, [["authorize", "messaging.read"]]);
});

test("the route validates exact organization, media, grant, private bucket, opaque object and TTL", async (t) => {
  const cases = [
    ["organization", { organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["media", { media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    ["grant", { media_download_grant_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
    ["bucket", { bucket_id: "public-media" }],
    ["object", { object_name: "customer-name/passport.pdf" }],
    ["zero ttl", { max_signed_url_expires_in_seconds: 0 }],
    ["long ttl", { max_signed_url_expires_in_seconds: 61 }],
    ["string ttl", { max_signed_url_expires_in_seconds: "60" }],
    ["pre-signed coordinate", { signed_url: `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}` }],
    ["extra response coordinate", { private_url: SIGNED_PATH }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const harness = createHarness({ consumptionData: consumption(overrides) });
      const response = await run(harness);
      assert.equal(response.status, 503);
      assertSecurityHeaders(response);
      assert.equal(harness.calls.some(([kind]) => kind === "sign"), false);
      const body = await response.text();
      assert.doesNotMatch(body, /platform-whatsapp-media|storage\/v1|[a-f0-9]{2}\/[a-f0-9]{62}/i);
    });
  }
});

test("grant and consume failures stop before signing without leaking private coordinates", async () => {
  for (const options of [
    { grantError: { code: "42501", message: `hidden ${OBJECT_NAME}` } },
    { grantData: grant({ signed_url: `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}` }) },
    { consumptionError: { code: "42501", message: `hidden ${BUCKET}` } },
  ]) {
    const harness = createHarness(options);
    const response = await run(harness);
    assert.ok(response.status === 403 || response.status === 503);
    assertSecurityHeaders(response);
    assert.equal(harness.calls.some(([kind]) => kind === "sign"), false);
    assert.equal(response.headers.get("location"), null);
    const body = await response.text();
    assert.doesNotMatch(body, /platform-whatsapp-media|storage\/v1|[a-f0-9]{2}\/[a-f0-9]{62}/i);
  }
});

test("signed URL validation rejects foreign origin, path, token, query, fragment and unsafe configured origin", async (t) => {
  const cases = [
    ["foreign origin", { signedUrl: `https://evil.example${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}` }],
    ["wrong path", { signedUrl: `${ORIGIN}/storage/v1/object/sign/${BUCKET}/ff/${"d".repeat(62)}?token=${SIGNED_QUERY_VALUE}` }],
    ["missing token", { signedUrl: `${ORIGIN}${SIGNED_PATH}` }],
    ["duplicate token", { signedUrl: `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}&token=other` }],
    ["unsafe token", { signedUrl: `${ORIGIN}${SIGNED_PATH}?token=token%20value` }],
    ["extra query", { signedUrl: `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}&transform=width:100` }],
    ["fragment", { signedUrl: `${ORIGIN}${SIGNED_PATH}?token=${SIGNED_QUERY_VALUE}#private` }],
    ["configured path", { supabaseOrigin: `${ORIGIN}/rest/v1` }],
    ["configured http", { supabaseOrigin: "http://project-ref.supabase.co" }],
  ];
  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const harness = createHarness(options);
      const response = await run(harness);
      assert.equal(response.status, 503);
      assertSecurityHeaders(response);
      assert.equal(response.headers.get("location"), null);
      assert.deepEqual(await response.json(), { error: "media_unavailable" });
    });
  }
});

test("the canonical media API route exposes only the Node download handler", () => {
  const route = readFileSync(
    new URL(
      "../src/app/api/v3/communication-media/[mediaId]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /GET = createPlatformCommunicationMediaDownloadHandler\(\)/);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.doesNotMatch(route, /service[_-]?key|bucket_id|object_name|publicUrl/i);
});
