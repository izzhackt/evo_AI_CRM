import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORM_AUDIT_CSV_COLUMNS,
  serializePlatformAuditCsv,
} from "../src/lib/platform-audit-csv.ts";

const SAFE_ROW = {
  auditEventId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-13T04:05:06.789Z",
  action: "student_case.assigned",
  resourceType: "student_case",
  resourceId: "22222222-2222-4222-8222-222222222222",
  actorKind: "staff",
  actorDisplayLabel: "EVO Admin",
  requestId: "33333333-3333-4333-8333-333333333333",
  reasonCode: "restricted",
  changedFieldCodes: ["assigned_curator", "status"],
};

test("audit CSV uses one fixed safe column order and deterministic UTF-8 text", () => {
  assert.deepEqual(PLATFORM_AUDIT_CSV_COLUMNS, [
    "audit_event_id",
    "created_at",
    "action",
    "resource_type",
    "resource_id",
    "actor_kind",
    "actor_display_label",
    "request_id",
    "reason_code",
    "changed_field_codes",
  ]);

  const expected = [
    '"audit_event_id","created_at","action","resource_type","resource_id","actor_kind","actor_display_label","request_id","reason_code","changed_field_codes"',
    '"11111111-1111-4111-8111-111111111111","2026-08-13T04:05:06.789Z","student_case.assigned","student_case","22222222-2222-4222-8222-222222222222","staff","EVO Admin","33333333-3333-4333-8333-333333333333","restricted","assigned_curator|status"',
    "",
  ].join("\r\n");

  assert.equal(serializePlatformAuditCsv([SAFE_ROW]), expected);
  assert.equal(
    Buffer.from(serializePlatformAuditCsv([SAFE_ROW]), "utf8").toString("utf8"),
    expected,
  );
});

test("audit CSV neutralizes formulas after leading whitespace and removes embedded CR/LF", () => {
  const csv = serializePlatformAuditCsv([
    {
      ...SAFE_ROW,
      actorDisplayLabel: ' \t=HYPERLINK("https://invalid.example")\r\n+cmd',
    },
  ]);

  const dataLine = csv.split("\r\n")[1];
  assert.match(
    dataLine,
    /,"' \t=HYPERLINK\(""https:\/\/invalid\.example""\) \+cmd",/,
  );
  assert.doesNotMatch(dataLine, /(?:^|,)"?[\t ]*[=+\-@]/);
  assert.equal(csv.split("\r\n").length, 3);
});

test("audit CSV emits an exact header and final CRLF for an empty result", () => {
  assert.equal(
    serializePlatformAuditCsv([]),
    '"audit_event_id","created_at","action","resource_type","resource_id","actor_kind","actor_display_label","request_id","reason_code","changed_field_codes"\r\n',
  );
});
