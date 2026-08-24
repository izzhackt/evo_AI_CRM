import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isPlatformP6BPortalNotificationsEnabled,
} from "../src/lib/server/platform-p6b-portal-notifications.ts";
import {
  listPlatformStudentPortalNotifications,
  normalizePlatformStudentPortalNotificationAck,
  PlatformPortalRepositoryError,
} from "../src/lib/platform-portal.ts";
import {
  isCurrentSubmittedPlatformDocumentVersion,
} from "../src/lib/platform-document-review.ts";

const AUTH_USER_ID = "10000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "10000000-0000-4000-8000-000000000003";
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000004";
const NOTIFICATION_ID = "10000000-0000-4000-8000-000000000005";
const CREATED_AT = "2026-08-12T10:15:00Z";

function studentActor(overrides = {}) {
  return {
    authUserId: AUTH_USER_ID,
    profileId: PROFILE_ID,
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    displayName: "Aida Student",
    platformRole: "student",
    platformAccessVersion: 1,
    role: "client",
    ...overrides,
  };
}

function notificationRpcClient(rows) {
  return {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(functionName, args, options) {
          assert.equal(functionName, "student_portal_notifications_v1");
          assert.equal(args, undefined);
          assert.deepEqual(options, { get: true });
          return { data: rows, error: null };
        },
      };
    },
  };
}

test("P6B portal notifications stay disabled unless the exact runtime flag is 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", " 1 "]) {
    assert.equal(
      isPlatformP6BPortalNotificationsEnabled({
        EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED: value,
      }),
      false,
    );
  }

  assert.equal(
    isPlatformP6BPortalNotificationsEnabled({
      EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED: "1",
    }),
    true,
  );

  const exampleEnvironment = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  assert.match(
    exampleEnvironment,
    /^EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED=0$/m,
  );
  const helper = readFileSync(
    new URL(
      "../src/lib/server/platform-p6b-portal-notifications.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(helper, /^import "server-only";/m);
});

test("student reads only the safe durable document-review notification projection", async () => {
  const notifications = await listPlatformStudentPortalNotifications(
    studentActor(),
    {
      client: notificationRpcClient([
        {
          notification_id: NOTIFICATION_ID,
          category: "document.review",
          review_decision: "correction_required",
          requirement_key: "passport_copy",
          requirement_label: "Копия паспорта",
          reason: "Загрузите читаемую копию без бликов.",
          created_at: CREATED_AT,
          read_at: null,
          // Even a compromised RPC cannot make private source/provider values
          // cross the repository projection into the accepted portal DTO.
          raw_waha_chat_id: "996555111222@c.us",
          document_version_id: "10000000-0000-4000-8000-000000000099",
          source_record_id: "10000000-0000-4000-8000-000000000098",
        },
      ]),
    },
  );

  assert.deepEqual(notifications, [
    {
      id: NOTIFICATION_ID,
      category: "document.review",
      decision: "correction_required",
      requirementKey: "passport_copy",
      requirementLabel: "Копия паспорта",
      reason: "Загрузите читаемую копию без бликов.",
      createdAt: CREATED_AT,
      readAt: null,
      isRead: false,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(notifications), /waha|@c\.us|version|source/i);
});

test("notification repository fails closed for wrong roles, duplicates, and malformed rows", async () => {
  await assert.rejects(
    () => listPlatformStudentPortalNotifications(
      studentActor({ platformRole: "sales", role: "sales" }),
      { client: notificationRpcClient([]) },
    ),
    PlatformPortalRepositoryError,
  );

  const validRow = {
    notification_id: NOTIFICATION_ID,
    category: "document.review",
    review_decision: "rejected",
    requirement_key: "passport_copy",
    requirement_label: "Копия паспорта",
    reason: "Файл не относится к требованию.",
    created_at: CREATED_AT,
    read_at: CREATED_AT,
  };
  await assert.rejects(
    () => listPlatformStudentPortalNotifications(studentActor(), {
      client: notificationRpcClient([validRow, validRow]),
    }),
    PlatformPortalRepositoryError,
  );
  await assert.rejects(
    () => listPlatformStudentPortalNotifications(studentActor(), {
      client: notificationRpcClient([
        { ...validRow, category: "individual_whatsapp" },
      ]),
    }),
    PlatformPortalRepositoryError,
  );
  await assert.rejects(
    () => listPlatformStudentPortalNotifications(studentActor(), {
      client: notificationRpcClient([
        { ...validRow, reason: "First line\nSecond line" },
      ]),
    }),
    PlatformPortalRepositoryError,
  );
});

test("notification acknowledgement accepts only the exact actor-scoped receipt", () => {
  assert.deepEqual(
    normalizePlatformStudentPortalNotificationAck(
      {
        notification_id: NOTIFICATION_ID,
        is_read: true,
        read_at: CREATED_AT,
      },
      NOTIFICATION_ID,
    ),
    { notificationId: NOTIFICATION_ID, isRead: true, readAt: CREATED_AT },
  );

  for (const result of [
    null,
    { notification_id: NOTIFICATION_ID, is_read: false, read_at: CREATED_AT },
    { notification_id: ORGANIZATION_ID, is_read: true, read_at: CREATED_AT },
    {
      notification_id: NOTIFICATION_ID,
      is_read: true,
      read_at: CREATED_AT,
      provider_id: "must-not-cross",
    },
  ]) {
    assert.throws(
      () => normalizePlatformStudentPortalNotificationAck(result, NOTIFICATION_ID),
      PlatformPortalRepositoryError,
    );
  }
});

test("ack server action uses only the actor-derived two-argument RPC", () => {
  const source = readFileSync(
    new URL(
      "../src/lib/platform-portal-notification-actions.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /^['"]use server['"];?/m);
  assert.match(source, /isPlatformP6BPortalNotificationsEnabled\(\)/);
  assert.match(source, /requirePlatformStudentPortalActor\(\)/);
  assert.match(source, /rpc\("mark_own_student_portal_notification_read_v1",\s*\{/);
  assert.match(source, /p_notification_id:\s*notificationId/);
  assert.match(source, /p_request_id:\s*requestId/);
  assert.match(source, /requestIdInput/);
  assert.match(source, /parseUuid\(requestIdInput\)/);
  assert.doesNotMatch(source, /randomUUID/);
  assert.doesNotMatch(source, /form\.get\(["']notification_id["']\)/);
  assert.doesNotMatch(source, /p_organization_id|service[_-]?role|better-sqlite3|edu_session/i);
});

test("portal realtime is private, membership-scoped, and invalidate-only", () => {
  const source = readFileSync(
    new URL(
      "../src/components/platform/portal/PortalNotificationsRealtime.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /`platform-portal-notifications:\$\{organizationId\}:\$\{membershipId\}`/,
  );
  assert.match(source, /config:\s*\{\s*private:\s*true\s*\}/);
  assert.match(source, /\.on\("broadcast",\s*\{\s*event:\s*"invalidate"\s*\}/);
  assert.match(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /payload\.|notification_id|document_version|waha/i);
  assert.doesNotMatch(source, /data-(?:organization|membership|topic)/i);

  const layout = readFileSync(
    new URL("../src/app/portal/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /notificationsRealtimeScope\s*&&/);
  assert.match(layout, /<PortalNotificationsRealtime/);
});

test("accepted portal renders the durable feed above no fake IDs and badges only unread durable rows", () => {
  const page = readFileSync(
    new URL("../src/app/portal/notifications/page.tsx", import.meta.url),
    "utf8",
  );
  const list = readFileSync(
    new URL(
      "../src/components/platform/portal/PortalNotificationList.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const shell = readFileSync(
    new URL(
      "../src/components/platform/portal/PortalShell.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const copy = readFileSync(
    new URL(
      "../src/components/platform/portal/portal-copy.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(page, /isPlatformP6BPortalNotificationsEnabled\(\)/);
  assert.match(page, /<PortalNotificationList/);
  assert.ok(
    page.indexOf("portal-attention-read-only") <
      page.indexOf("<PortalNotificationList"),
    "P6A attention remains above the durable feed",
  );
  assert.match(list, /import\s*\{\s*randomUUID\s*\}\s*from\s*"node:crypto"/);
  assert.match(list, /const requestId = randomUUID\(\)/);
  assert.match(
    list,
    /\.bind\(\s*null,\s*notification\.id,\s*requestId\s*,?\s*\)/,
  );
  assert.match(list, /data-testid="portal-notification-row"/);
  assert.match(list, /data-testid="portal-notification-mark-read"/);
  assert.doesNotMatch(
    list,
    /type="hidden"|data-notification-id|value=\{notification\.id\}/i,
  );
  assert.match(shell, /unreadNotificationCount/);
  assert.match(shell, /data-testid="portal-notifications-unread-badge"/);
  const layout = readFileSync(
    new URL("../src/app/portal/layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(layout, /snapshot\?\.notifications/);
  assert.doesNotMatch(layout, /snapshot=\{snapshot\}/);
  for (const key of [
    "documentCorrectionRequired",
    "documentRejected",
    "markNotificationRead",
    "notificationMarkedRead",
    "notificationLiveTitle",
    "notificationLiveBody",
  ]) {
    assert.equal(copy.match(new RegExp(`\\b${key}:`, "g"))?.length, 3, key);
  }
});

test("the bounded document-review action remains safe while U2 canonical client detail stays read-only", () => {
  const action = readFileSync(
    new URL(
      "../src/lib/platform-document-review-actions.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const adapter = readFileSync(
    new URL(
      "../src/app/(staff)/clients/[id]/ConnectedCanonicalClientDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const renderer = readFileSync(
    new URL(
      "../src/components/platform/core/CanonicalClientDetail.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(action, /^['"]use server['"];?/m);
  assert.match(action, /isPlatformP6BPortalNotificationsEnabled\(\)/);
  assert.match(action, /requirePlatformClientsActor\(\)/);
  assert.match(action, /\["correction_required",\s*"rejected"\]/);
  assert.match(
    action,
    /rpc\("review_document_version_with_portal_notification_v1",\s*\{/,
  );
  for (const argument of [
    "p_organization_id: actor.organizationId",
    "p_document_version_id: documentVersionId",
    "p_decision: decision",
    "p_reason: reason",
    "p_request_id: requestId",
  ]) {
    assert.match(action, new RegExp(argument.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(action, /better-sqlite3|edu_session|individual_whatsapp|waha/i);

  assert.match(adapter, /getPlatformCanonicalClient\(actor, id\)/);
  assert.match(adapter, /<CanonicalClientDetail/);
  assert.doesNotMatch(adapter, /reviewPlatformDocumentVersionAction|canReview/);
  assert.doesNotMatch(
    renderer,
    /platform-document-review-form|document_version_id|platform-document-review-submit/,
  );
  assert.ok(
    action.indexOf("listPlatformStudentCaseDocuments") <
      action.indexOf(
        'rpc("review_document_version_with_portal_notification_v1"',
      ),
    "case/version preflight must happen before the review mutation",
  );
});

test("document review preflight rejects a version borrowed from another case", () => {
  const CASE_A = "20000000-0000-4000-8000-000000000001";
  const CASE_B = "20000000-0000-4000-8000-000000000002";
  const VERSION_A = "20000000-0000-4000-8000-000000000003";
  const base = {
    studentCaseId: CASE_A,
    documentSlotId: "20000000-0000-4000-8000-000000000004",
    documentRequirementId: "20000000-0000-4000-8000-000000000005",
    requirementKey: "passport_copy",
    requirementLabel: "Passport copy",
    instructions: null,
    checklistVersion: 1,
    slotStatus: "submitted",
    deadline: null,
    nextAction: null,
    documentVersionId: VERSION_A,
    versionNumber: 1,
    originalFilename: "passport.pdf",
    declaredMimeType: "application/pdf",
    byteSize: 1200,
    submittedAt: CREATED_AT,
    reviewDecision: null,
    reworkReason: null,
    reviewedAt: null,
  };

  assert.equal(
    isCurrentSubmittedPlatformDocumentVersion([base], CASE_A, VERSION_A),
    true,
  );
  assert.equal(
    isCurrentSubmittedPlatformDocumentVersion(
      [{ ...base, studentCaseId: CASE_B }],
      CASE_A,
      VERSION_A,
    ),
    false,
  );
  assert.equal(
    isCurrentSubmittedPlatformDocumentVersion([base], CASE_A, ORGANIZATION_ID),
    false,
  );
  assert.equal(
    isCurrentSubmittedPlatformDocumentVersion(
      [{ ...base, slotStatus: "approved" }],
      CASE_A,
      VERSION_A,
    ),
    false,
  );
  assert.equal(
    isCurrentSubmittedPlatformDocumentVersion([base, base], CASE_A, VERSION_A),
    false,
  );
});
