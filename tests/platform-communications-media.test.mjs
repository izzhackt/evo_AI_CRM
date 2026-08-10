import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlatformConversationMessage } from "../src/lib/platform-communications.ts";

const MESSAGE_ID = "7be22cc5-0316-4bbc-9d91-e3d1d5775ddb";
const CONVERSATION_ID = "A120B6DB-2E3E-4A84-8873-073F4D2D33C3";
const MEDIA_ID = "11111111-2222-4333-8444-555555555555";

function validMessageRow(overrides = {}) {
  return {
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    direction: "inbound",
    body_text: "Здравствуйте",
    language: "ru",
    student_visible: true,
    waha_session_name: " evo-inbox ",
    waha_message_id: "message-42",
    kommo_account_id: "9223372036854775807",
    kommo_conversation_id: null,
    kommo_message_id: "kommo-message-42",
    amocrm_account_id: 1234,
    amocrm_lead_id: "5678",
    amocrm_contact_id: 9012,
    created_at: "2026-07-30T03:15:30Z",
    media: [],
    ...overrides,
  };
}

function validMedia(overrides = {}) {
  return {
    id: MEDIA_ID,
    ordinal: 0,
    media_kind: "image",
    mime_type: "image/jpeg",
    file_name: "welcome.jpg",
    file_size_bytes: 1024,
    archival_status: "archived",
    created_at: "2026-08-10T08:00:00Z",
    archived_at: "2026-08-10T08:01:00Z",
    ...overrides,
  };
}

test("normalizes bounded safe message media descriptors only", () => {
  const message = normalizePlatformConversationMessage(
    validMessageRow({
      media: [
        validMedia(),
        validMedia({
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          ordinal: 1,
          media_kind: "pdf",
          mime_type: "application/pdf",
          file_name: "contract.pdf",
        }),
      ],
    }),
  );

  assert.equal(message.media.length, 2);
  assert.deepEqual(message.media[0], {
    id: MEDIA_ID.toLowerCase(),
    ordinal: 0,
    mediaKind: "image",
    mimeType: "image/jpeg",
    fileName: "welcome.jpg",
    fileSizeBytes: 1024,
    archivalStatus: "archived",
    createdAt: "2026-08-10T08:00:00Z",
    archivedAt: "2026-08-10T08:01:00Z",
  });
});

test("rejects media descriptors with duplicate ordinals or unsafe archive state", () => {
  assert.throws(() =>
    normalizePlatformConversationMessage(
      validMessageRow({
        media: [
          validMedia(),
          validMedia({
            id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            ordinal: 0,
          }),
        ],
      }),
    ),
  );

  assert.throws(() =>
    normalizePlatformConversationMessage(
      validMessageRow({
        media: [
          validMedia({
            archival_status: "processing",
            archived_at: "2026-08-10T08:01:00Z",
          }),
        ],
      }),
    ),
  );
});

test("accepts at most the database-bounded sixteen media descriptors", () => {
  const sixteenMedia = Array.from({ length: 16 }, (_, ordinal) =>
    validMedia({
      id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(ordinal + 1).padStart(12, "0")}`,
      ordinal,
    }),
  );

  assert.equal(
    normalizePlatformConversationMessage(
      validMessageRow({ media: sixteenMedia }),
    ).media.length,
    16,
  );
  assert.throws(() =>
    normalizePlatformConversationMessage(
      validMessageRow({
        media: [
          ...sixteenMedia,
          validMedia({
            id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
            ordinal: 16,
          }),
        ],
      }),
    ),
  );
});
