import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlatformMessagingMediaHandler,
} from "../src/app/api/platform-messaging/media/[mediaId]/route.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "33333333-3333-4333-8333-333333333333";
const OBJECT_NAME = `ab/${"c".repeat(62)}`;

function request(url = `http://localhost/api/platform-messaging/media/${MEDIA_ID}`) {
  return {
    nextUrl: new URL(url),
  };
}

function authenticatedActor(role = "sales") {
  return {
    status: "authenticated",
    actor: {
      organizationId: ORGANIZATION_ID,
      platformRole: role,
    },
  };
}

test("media route returns 404 for anonymous callers and invalid ids", async () => {
  const handler = createPlatformMessagingMediaHandler(async () => ({
    async loadActor() {
      return { status: "anonymous", actor: null };
    },
    async grantDownload() {
      throw new Error("should not run");
    },
    async consumeGrant() {
      throw new Error("should not run");
    },
    async createSignedUrl() {
      throw new Error("should not run");
    },
    createRequestId() {
      return "44444444-4444-4444-8444-444444444444";
    },
  }));

  const anonymous = await handler(request(), {
    params: Promise.resolve({ mediaId: MEDIA_ID }),
  });
  assert.equal(anonymous.status, 404);

  const invalid = await handler(request("http://localhost/api/platform-messaging/media/not-a-uuid"), {
    params: Promise.resolve({ mediaId: "not-a-uuid" }),
  });
  assert.equal(invalid.status, 404);
});

test("media route returns 403 for authenticated but unauthorized roles", async () => {
  const handler = createPlatformMessagingMediaHandler(async () => ({
    async loadActor() {
      return authenticatedActor("student");
    },
    async grantDownload() {
      throw new Error("should not run");
    },
    async consumeGrant() {
      throw new Error("should not run");
    },
    async createSignedUrl() {
      throw new Error("should not run");
    },
    createRequestId() {
      return "44444444-4444-4444-8444-444444444444";
    },
  }));

  const response = await handler(request(), {
    params: Promise.resolve({ mediaId: MEDIA_ID }),
  });
  assert.equal(response.status, 403);
});

test("media route consumes one audited grant and redirects with status 307", async () => {
  const calls = [];
  const handler = createPlatformMessagingMediaHandler(async () => ({
    async loadActor() {
      return authenticatedActor("admissions");
    },
    async grantDownload(input) {
      calls.push(["grant", input]);
      return {
        mediaDownloadGrantId: GRANT_ID,
        expiresAt: "2026-08-10T08:10:00Z",
        storageApiServiceSignRequired: true,
      };
    },
    async consumeGrant(input) {
      calls.push(["consume", input]);
      return {
        organizationId: ORGANIZATION_ID,
        mediaId: MEDIA_ID,
        mediaDownloadGrantId: GRANT_ID,
        bucketId: "platform-whatsapp-media",
        objectName: OBJECT_NAME,
        maxSignedUrlExpiresInSeconds: 60,
        mimeType: "application/pdf",
        fileName: "offer.pdf",
      };
    },
    async createSignedUrl(input) {
      calls.push(["sign", input]);
      return "https://storage.example.test/signed";
    },
    createRequestId() {
      return "44444444-4444-4444-8444-444444444444";
    },
  }));

  const response = await handler(
    request(`http://localhost/api/platform-messaging/media/${MEDIA_ID}?download=1`),
    {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    },
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("location"),
    "https://storage.example.test/signed",
  );
  assert.deepEqual(calls, [
    [
      "grant",
      {
        organizationId: ORGANIZATION_ID,
        mediaId: MEDIA_ID,
        requestId: "44444444-4444-4444-8444-444444444444",
      },
    ],
    [
      "consume",
      {
        mediaDownloadGrantId: GRANT_ID,
        requestId: "44444444-4444-4444-8444-444444444444",
      },
    ],
    [
      "sign",
      {
        bucketId: "platform-whatsapp-media",
        objectName: OBJECT_NAME,
        expiresInSeconds: 60,
        downloadFileName: "offer.pdf",
      },
    ],
  ]);
});

test("media route fails closed on malformed RPC payloads or signing failures", async () => {
  const malformed = createPlatformMessagingMediaHandler(async () => ({
    async loadActor() {
      return authenticatedActor("admin");
    },
    async grantDownload() {
      return null;
    },
    async consumeGrant() {
      throw new Error("should not run");
    },
    async createSignedUrl() {
      throw new Error("should not run");
    },
    createRequestId() {
      return "44444444-4444-4444-8444-444444444444";
    },
  }));
  assert.equal(
    (
      await malformed(request(), {
        params: Promise.resolve({ mediaId: MEDIA_ID }),
      })
    ).status,
    404,
  );

  const unsigned = createPlatformMessagingMediaHandler(async () => ({
    async loadActor() {
      return authenticatedActor("admin");
    },
    async grantDownload() {
      return {
        mediaDownloadGrantId: GRANT_ID,
        expiresAt: "2026-08-10T08:10:00Z",
        storageApiServiceSignRequired: true,
      };
    },
    async consumeGrant() {
      return {
        organizationId: ORGANIZATION_ID,
        mediaId: MEDIA_ID,
        mediaDownloadGrantId: GRANT_ID,
        bucketId: "platform-whatsapp-media",
        objectName: OBJECT_NAME,
        maxSignedUrlExpiresInSeconds: 60,
        mimeType: "image/jpeg",
        fileName: "welcome.jpg",
      };
    },
    async createSignedUrl() {
      return null;
    },
    createRequestId() {
      return "44444444-4444-4444-8444-444444444444";
    },
  }));
  assert.equal(
    (
      await unsigned(request(), {
        params: Promise.resolve({ mediaId: MEDIA_ID }),
      })
    ).status,
    503,
  );
});

test("media route never signs a mismatched or non-opaque consumed target", async () => {
  const mismatches = [
    { organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { mediaId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { mediaDownloadGrantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    { bucketId: "platform-documents" },
    { objectName: "organization/raw-chat/message.png" },
  ];

  for (const mismatch of mismatches) {
    let signCalls = 0;
    const handler = createPlatformMessagingMediaHandler(async () => ({
      async loadActor() {
        return authenticatedActor("sales");
      },
      async grantDownload() {
        return {
          mediaDownloadGrantId: GRANT_ID,
          expiresAt: "2026-08-10T08:10:00Z",
          storageApiServiceSignRequired: true,
        };
      },
      async consumeGrant() {
        return {
          organizationId: ORGANIZATION_ID,
          mediaId: MEDIA_ID,
          mediaDownloadGrantId: GRANT_ID,
          bucketId: "platform-whatsapp-media",
          objectName: OBJECT_NAME,
          maxSignedUrlExpiresInSeconds: 60,
          mimeType: "image/png",
          fileName: "proof.png",
          ...mismatch,
        };
      },
      async createSignedUrl() {
        signCalls += 1;
        return "https://storage.example.test/must-not-be-used";
      },
      createRequestId() {
        return "44444444-4444-4444-8444-444444444444";
      },
    }));

    const response = await handler(request(), {
      params: Promise.resolve({ mediaId: MEDIA_ID }),
    });
    assert.equal(response.status, 404);
    assert.equal(signCalls, 0);
  }
});
