import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionSource = readFileSync(
  new URL(
    "../src/lib/platform-document-checklist-actions.ts",
    import.meta.url,
  ),
  "utf8",
);

test("document checklist actions expose one stable useActionState contract", () => {
  assert.match(
    actionSource,
    /export type PlatformDocumentChecklistActionState = Readonly<\{[\s\S]*status: PlatformAdmissionsActionStatus;[\s\S]*requestId: string;[\s\S]*documentSlotId: string \| null;[\s\S]*version: string \| null;/,
  );
  for (const actionName of [
    "createPlatformCustomDocumentSlotAction",
    "changePlatformDocumentSlotMetadataAction",
    "removePlatformDocumentSlotAction",
  ]) {
    assert.match(
      actionSource,
      new RegExp(`export async function ${actionName}\\(`),
    );
  }
  assert.equal(
    actionSource.match(/_previous: PlatformDocumentChecklistActionState/g)?.length,
    3,
  );
});

test("document checklist actions reject unknown fields and invalid bounded input", () => {
  for (const field of [
    "student_case_id",
    "document_slot_id",
    "label",
    "group_label",
    "expected_version",
    "reason",
    "request_id",
  ]) {
    assert.match(actionSource, new RegExp(`"${field}"`));
  }
  assert.match(
    actionSource,
    /exactActionStringFields\(form, CREATE_SLOT_FIELDS\)/,
  );
  assert.match(
    actionSource,
    /exactActionStringFields\(form, CHANGE_SLOT_FIELDS\)/,
  );
  assert.match(
    actionSource,
    /exactActionStringFields\(form, REMOVE_SLOT_FIELDS\)/,
  );
  assert.match(actionSource, /parsePlatformAdmissionsUuid\(value\)/);
  assert.match(actionSource, /CONTROL_CHARACTER_PATTERN\.test\(normalized\)/);
  assert.match(actionSource, /boundedText\(field\(fields, "label"\), 500\)/);
  assert.match(actionSource, /boundedText\(field\(fields, "group_label"\), 200\)/);
  assert.equal(
    actionSource.match(/boundedText\(field\(fields, "reason"\), 1_000\)/g)
      ?.length,
    2,
  );
  assert.match(actionSource, /POSTGRES_BIGINT_MAX = "9223372036854775807"/);
  assert.match(actionSource, /normalized === "0"/);
  assert.match(actionSource, /normalized > POSTGRES_BIGINT_MAX/);
});

test("all mutations are staff-bound and fixed-role authorization fails closed", () => {
  assert.equal(
    actionSource.match(/const actor = await requirePlatformStaffActor\(\);/g)
      ?.length,
    3,
  );
  assert.equal(
    actionSource.match(
      /if \(!fixedRoleCan\(actor\.authorityRole, "documents\.write"\)\) \{\s*return failureState\(form, "forbidden"\);\s*\}/g,
    )?.length,
    3,
  );
  assert.doesNotMatch(
    actionSource,
    /service[_-]?role|DATABASE_URL|adminClient|bypass|fallback/i,
  );
});

test("actions call only the three reviewed platform RPCs with exact arguments", () => {
  assert.match(
    actionSource,
    /\.rpc\(\s*"create_custom_document_slot",\s*\{\s*p_organization_id: actor\.organizationId,\s*p_student_case_id: studentCaseId,\s*p_label: label,\s*p_group_label: groupLabel,\s*p_request_id: requestId,\s*\}/,
  );
  assert.match(
    actionSource,
    /\.rpc\(\s*"change_document_slot_metadata",\s*\{\s*p_organization_id: actor\.organizationId,\s*p_student_case_id: studentCaseId,\s*p_document_slot_id: documentSlotId,\s*p_label: label,\s*p_group_label: groupLabel,\s*p_expected_version: expectedVersion,\s*p_reason: reason,\s*p_request_id: requestId,\s*\}/,
  );
  assert.match(
    actionSource,
    /\.rpc\(\s*"remove_document_slot",\s*\{\s*p_organization_id: actor\.organizationId,\s*p_student_case_id: studentCaseId,\s*p_document_slot_id: documentSlotId,\s*p_expected_version: expectedVersion,\s*p_reason: reason,\s*p_request_id: requestId,\s*\}/,
  );
  assert.equal(actionSource.match(/\.schema\("platform"\)\.rpc\(/g)?.length, 3);
});

test("database errors map to safe UI statuses without leaking provider details", () => {
  assert.match(actionSource, /if \(code === "42501"\) return "forbidden"/);
  assert.match(
    actionSource,
    /code === "PT409" && message === "document_slot_version_conflict"[\s\S]*return "stale"/,
  );
  assert.match(
    actionSource,
    /\(code === "22023" \|\| code === "23505"\) && \/request_id\/i\.test\(message\)[\s\S]*return "request_conflict"/,
  );
  assert.match(actionSource, /if \(code === "22023"\) return "invalid"/);
  assert.match(actionSource, /return "unavailable"/);
  assert.match(
    actionSource,
    /status === "stale" \|\| status === "request_conflict"\s*\? randomUUID\(\)/,
  );
  assert.equal(actionSource.match(/\} catch \{\s*return failureState\(/g)?.length, 3);
  assert.doesNotMatch(
    actionSource,
    /console\.|JSON\.stringify\(error\)|error\.(?:details|hint)/,
  );
});

test("create validates the exact canonical receipt before reporting version one", () => {
  assert.match(
    actionSource,
    /hasExactKeys\(data, \[\s*"organization_id", "student_case_id", "document_slot_id",\s*"document_requirement_id", "requirement_label", "group_label",\s*"intent_kind", "slot_status", "version", "request_id",\s*\]\)/,
  );
  for (const check of [
    "data.organization_id !== actor.organizationId",
    "data.student_case_id !== studentCaseId",
    "data.document_slot_id !== documentSlotId",
    "data.document_requirement_id !== null",
    "data.requirement_label !== label",
    "data.group_label !== groupLabel",
    'data.intent_kind !== "custom"',
    'data.slot_status !== "required"',
    'data.version !== "1"',
    "data.request_id !== requestId",
  ]) {
    assert.ok(actionSource.includes(check), `missing receipt check: ${check}`);
  }
});

test("change and remove validate identity, expected version, increment and audit fields", () => {
  assert.equal(
    actionSource.match(/data\.organization_id !== actor\.organizationId/g)
      ?.length,
    3,
  );
  assert.equal(
    actionSource.match(/data\.student_case_id !== studentCaseId/g)?.length,
    3,
  );
  assert.equal(
    actionSource.match(/data\.document_slot_id !== documentSlotId/g)?.length,
    3,
  );
  assert.equal(
    actionSource.match(/data\.expected_version !== expectedVersion/g)?.length,
    2,
  );
  assert.equal(
    actionSource.match(
      /BigInt\(nextVersion\) !== BigInt\(expectedVersion\) \+ BigInt\(1\)/g,
    )?.length,
    2,
  );
  assert.match(actionSource, /!isTimestamp\(data\.changed_at\)/);
  assert.match(actionSource, /!isTimestamp\(data\.removed_at\)/);
  assert.match(actionSource, /data\.removal_reason !== reason/);
  assert.equal(actionSource.match(/data\.request_id !== requestId/g)?.length, 3);
  assert.equal(
    actionSource.match(/return failureState\(form, "unavailable", documentSlotId, requestId\)/g)
      ?.length,
    5,
  );
});

test("only verified successes invalidate the four checklist views", () => {
  assert.match(actionSource, /revalidatePath\("\/documents"\)/);
  assert.match(
    actionSource,
    /revalidatePath\(`\/clients\/\$\{studentCaseId\}`\)/,
  );
  assert.match(actionSource, /revalidatePath\("\/v3\/profile"\)/);
  assert.match(actionSource, /revalidatePath\("\/v3\/knowledge"\)/);
  assert.equal(actionSource.match(/revalidateChecklist\(studentCaseId\);/g)?.length, 3);
  assert.equal(
    actionSource.match(/status: "saved" as const,[\s\S]*?requestId: randomUUID\(\)/g)
      ?.length,
    3,
  );
});
