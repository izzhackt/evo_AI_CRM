import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export default {};") };
    }
    return nextResolve(specifier, context);
  },
});

const {
  readV3InboxMediaAttachmentContext,
  toV3InboxMessageMedia,
  V3_INBOX_MEDIA_ATTACH_MAX_BYTES,
} = await import("../src/lib/v3/inbox-media.ts");

const IDS = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  conversation: "22222222-2222-4222-8222-222222222222",
  media: "33333333-3333-4333-8333-333333333333",
  studentCase: "44444444-4444-4444-8444-444444444444",
  slot: "55555555-5555-4555-8555-555555555555",
  approvedSlot: "66666666-6666-4666-8666-666666666666",
  removedSlot: "77777777-7777-4777-8777-777777777777",
  request: "88888888-8888-4888-8888-888888888888",
});

function actor(overrides = {}) {
  return Object.freeze({
    authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    organizationId: IDS.organization,
    displayName: "Admissions User",
    email: "admissions@example.test",
    platformRole: "admissions",
    authorityRole: "admissions",
    presentationRole: "admissions",
    platformAccessVersion: 1,
    platformBundleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    platformBundleVersion: 1,
    ...overrides,
  });
}

function canonicalMedia(overrides = {}) {
  return Object.freeze({
    id: IDS.media,
    ordinal: 0,
    mediaKind: "pdf",
    mimeType: "application/pdf",
    fileName: "passport.pdf",
    fileSizeBytes: 1_572_864,
    archivalStatus: "archived",
    createdAt: "2026-09-07T10:00:00+00:00",
    archivedAt: "2026-09-07T10:01:00+00:00",
    ...overrides,
  });
}

function workspace(overrides = {}) {
  return Object.freeze({
    organizationId: IDS.organization,
    studentCaseId: IDS.studentCase,
    caseState: "active",
    slots: Object.freeze([
      Object.freeze({
        documentSlotId: IDS.slot,
        groupLabel: "Личные документы",
        requirementLabel: "Паспорт",
        version: 7,
        status: "required",
      }),
      Object.freeze({
        documentSlotId: IDS.approvedSlot,
        groupLabel: "Образование",
        requirementLabel: "Аттестат",
        version: 3,
        status: "approved",
      }),
    ]),
    removedSlots: Object.freeze([
      Object.freeze({
        documentSlotId: IDS.removedSlot,
        groupLabel: "История",
        requirementLabel: "Удалённый слот",
        version: 1,
        status: "required",
      }),
    ]),
    ...overrides,
  });
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("archived media exposes only the exact private route and safe display facts", () => {
  const view = toV3InboxMessageMedia(canonicalMedia());
  assert.deepEqual(view, {
    mediaId: IDS.media,
    kindLabel: "PDF",
    fileName: "passport.pdf",
    mimeType: "application/pdf",
    fileSizeLabel: "1.5 МБ",
    state: "available",
    stateLabel: "Вложение готово.",
    previewHref: `/api/v3/communication-media/${IDS.media}`,
    downloadHref: `/api/v3/communication-media/${IDS.media}?download=1`,
    attachable: true,
  });
  assert.doesNotMatch(
    JSON.stringify(view),
    /bucket|object_name|provider|service[_-]?key|signed[_-]?url/iu,
  );
});

test("unsafe metadata and invalid opaque ids fail closed without raw values or links", () => {
  const unsafe = [
    canonicalMedia({ fileName: "../private/passport.pdf" }),
    canonicalMedia({ mimeType: "text/html<script>" }),
    canonicalMedia({ fileSizeBytes: -1 }),
    canonicalMedia({ id: "not-a-uuid" }),
  ];
  for (const media of unsafe) {
    const view = toV3InboxMessageMedia(media);
    assert.equal(view.state, "unavailable");
    assert.equal(view.mediaId, null);
    assert.equal(view.fileName, null);
    assert.equal(view.mimeType, null);
    assert.equal(view.fileSizeLabel, null);
    assert.equal(view.previewHref, null);
    assert.equal(view.downloadHref, null);
    assert.equal(view.attachable, false);
  }
});

test("processing, retryable and terminal media are visible but never linkable", () => {
  const cases = [
    ["pending", "processing"],
    ["processing", "processing"],
    ["retryable_error", "unavailable"],
    ["terminal_error", "unavailable"],
  ];
  for (const [archivalStatus, state] of cases) {
    const view = toV3InboxMessageMedia(canonicalMedia({
      archivalStatus,
      archivedAt: null,
    }));
    assert.equal(view.state, state);
    assert.equal(view.previewHref, null);
    assert.equal(view.downloadHref, null);
    assert.equal(view.attachable, false);
  }
});

test("only canonical PDF, JPEG and PNG within 25 MiB are attachable", () => {
  for (const mimeType of ["application/pdf", "image/jpeg", "image/png"]) {
    assert.equal(
      toV3InboxMessageMedia(canonicalMedia({ mimeType })).attachable,
      true,
    );
  }
  assert.equal(
    toV3InboxMessageMedia(canonicalMedia({ mimeType: "text/plain" })).attachable,
    false,
  );
  assert.equal(
    toV3InboxMessageMedia(canonicalMedia({ fileSizeBytes: 0 })).attachable,
    false,
  );
  assert.equal(
    toV3InboxMessageMedia(canonicalMedia({
      fileSizeBytes: V3_INBOX_MEDIA_ATTACH_MAX_BYTES + 1,
    })).attachable,
    false,
  );
});

test("Sales, Admin preview as Sales and a missing exact case never load slots", async () => {
  let reads = 0;
  const dependencies = {
    async readWorkspace() {
      reads += 1;
      return workspace();
    },
    requestId: () => IDS.request,
  };
  const media = [toV3InboxMessageMedia(canonicalMedia())];
  const sales = actor({
    platformRole: "sales",
    authorityRole: "sales",
    presentationRole: "sales",
  });
  const adminPreviewSales = actor({
    platformRole: "admin",
    authorityRole: "admin",
    presentationRole: "sales",
  });

  assert.equal(await readV3InboxMediaAttachmentContext(sales, {
    conversationId: IDS.conversation,
    studentCaseId: IDS.studentCase,
    media,
  }, dependencies), null);
  assert.equal(await readV3InboxMediaAttachmentContext(adminPreviewSales, {
    conversationId: IDS.conversation,
    studentCaseId: IDS.studentCase,
    media,
  }, dependencies), null);
  assert.equal(await readV3InboxMediaAttachmentContext(actor(), {
    conversationId: IDS.conversation,
    studentCaseId: null,
    media,
  }, dependencies), null);
  assert.equal(reads, 0);
});

test("exact active case exposes only non-approved, non-removed slots", async () => {
  let reads = 0;
  const media = [toV3InboxMessageMedia(canonicalMedia())];
  const context = await readV3InboxMediaAttachmentContext(actor(), {
    conversationId: IDS.conversation,
    studentCaseId: IDS.studentCase,
    media,
  }, {
    async readWorkspace(_actor, studentCaseId) {
      reads += 1;
      assert.equal(studentCaseId, IDS.studentCase);
      return workspace();
    },
    requestId: () => IDS.request,
  });

  assert.equal(reads, 1);
  assert.deepEqual(context, {
    conversationId: IDS.conversation,
    studentCaseId: IDS.studentCase,
    slots: [{
      documentSlotId: IDS.slot,
      label: "Личные документы · Паспорт",
      expectedVersion: "7",
    }],
    requestIdsByMediaId: { [IDS.media]: IDS.request },
  });
});

test("closed, mismatched and nonwritable workspaces fail closed", async () => {
  const media = [toV3InboxMessageMedia(canonicalMedia())];
  const run = (resolvedWorkspace) => readV3InboxMediaAttachmentContext(actor(), {
    conversationId: IDS.conversation,
    studentCaseId: IDS.studentCase,
    media,
  }, {
    readWorkspace: async () => resolvedWorkspace,
    requestId: () => IDS.request,
  });

  assert.equal(await run(workspace({ caseState: "closed" })), null);
  assert.equal(await run(workspace({
    studentCaseId: "99999999-9999-4999-8999-999999999999",
  })), null);
  assert.equal(await run(workspace({
    slots: workspace().slots.filter((slot) => slot.status === "approved"),
  })), null);
  assert.equal(await run(workspace({ slots: [], removedSlots: workspace().removedSlots })), null);
});

test("Inbox integrates media for both directions without provider calls or byte transport", () => {
  const inbox = source("src/components/v3/Inbox.tsx");
  const component = source("src/components/v3/inbox/InboxMessageMedia.tsx");
  const adapter = source("src/lib/v3/inbox-source.ts");
  const page = source("src/app/(v3)/v3/inbox/page.tsx");

  assert.match(adapter, /message\.media\.map\(toV3InboxMessageMedia\)/u);
  assert.match(
    adapter,
    /context\.studentCaseId !== thread\.conversation\.studentCaseId/u,
  );
  assert.match(
    adapter,
    /studentCaseId: thread\.conversation\.studentCaseId/u,
  );
  assert.match(inbox, /items=\{message\.media\}/u);
  assert.match(inbox, /inbound=\{message\.inbound\}/u);
  assert.match(page, /readV3InboxMediaAttachmentContext\(actor,/u);
  assert.match(component, /data-testid="v3-inbox-message-media"/u);
  assert.match(component, /aria-label="Вложения к сообщению"/u);
  assert.match(component, /Открыть вложение/u);
  assert.match(component, /Скачать вложение/u);
  assert.match(component, /Документ в деле студента/u);
  assert.match(component, /В дело студента/u);
  assert.match(component, /useActionState\(/u);
  assert.match(component, /state\.status === "attached" \|\| state\.status === "stale"/u);
  assert.match(component, /router\.refresh\(\)/u);
  assert.doesNotMatch(component, /data-media-id|bucket_id|object_name|service[_-]?key/iu);
  assert.doesNotMatch(component, /fetch\(|FormData\([^)]*file|provider|sendCanonical|WAHA/iu);
});
