import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STUDENT_CASE_ID = "00000000-0000-4000-8000-000000000002";
const TASK_ID = "00000000-0000-4000-8000-000000000003";
const UPDATE_ID = "00000000-0000-4000-8000-000000000004";
const AUDIT_ID = "00000000-0000-4000-8000-000000000005";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000006";
const DOCUMENT_VERSION_ID = "00000000-0000-4000-8000-000000000007";
const DOCUMENT_SLOT_ID = "00000000-0000-4000-8000-000000000008";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/platform-admissions-case-workspace.ts")) {
      if (specifier === "./supabase/server.ts") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const createSupabaseServerClient = async () => ({ schema: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }) });",
          ),
        };
      }
      if (specifier === "./platform-guards.ts") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const requirePlatformClientsActor = async () => ({ organizationId: '00000000-0000-4000-8000-000000000001', platformRole: 'curator' });",
          ),
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  getPlatformAdmissionsCaseWorkspaceForActor,
  normalizePlatformAdmissionsCaseActivityPayload,
  normalizePlatformAdmissionsCaseWorkspacePayload,
  PlatformAdmissionsCaseWorkspaceRepositoryError,
} = await import("../src/lib/platform-admissions-case-workspace.ts");

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function workspacePayload(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    tasks: [{
      organization_id: ORGANIZATION_ID,
      student_case_id: STUDENT_CASE_ID,
      case_task_id: TASK_ID,
      task_type: "u6.document_request_plan",
      title: "Collect first passport scan",
      assignee_membership_id: ASSIGNEE_ID,
      assignee_display_name: "Curator Owner",
      priority: "high",
      due_at: "2026-08-27",
      status: "open",
      student_visible: false,
    }],
    assignees: [{
      organization_id: ORGANIZATION_ID,
      membership_id: ASSIGNEE_ID,
      display_name: "Curator Owner",
      role: "curator",
    }],
    ...overrides,
  };
}

function activityPayload(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: STUDENT_CASE_ID,
    updates: [{
      organization_id: ORGANIZATION_ID,
      student_case_id: STUDENT_CASE_ID,
      student_case_update_id: UPDATE_ID,
      body: "Student uploaded corrected passport copy",
      source: "operator_note",
      occurred_at: "2026-08-26T10:11:12+06:00",
      author_display_name: "Curator Owner",
      student_visible: false,
    }],
    audit: [{
      organization_id: ORGANIZATION_ID,
      student_case_id: STUDENT_CASE_ID,
      audit_event_id: AUDIT_ID,
      action: "document.version.review",
      resource_kind: "document_version",
      actor_display_name: "Curator Owner",
      event_at: "2026-08-26T10:12:13+06:00",
      reason: "Current document version reviewed",
      change_summary: "Rejected with correction request",
    }],
    ...overrides,
  };
}

test("U7 workspace payload normalization accepts exact bounded shape", () => {
  const workspace = normalizePlatformAdmissionsCaseWorkspacePayload(
    workspacePayload(),
    ORGANIZATION_ID,
    STUDENT_CASE_ID,
  );
  assert.equal(workspace.organizationId, ORGANIZATION_ID);
  assert.equal(workspace.studentCaseId, STUDENT_CASE_ID);
  assert.equal(workspace.tasks[0].caseTaskId, TASK_ID);
  assert.equal(workspace.taskAssignees[0].membershipId, ASSIGNEE_ID);
  assert.equal(Object.isFrozen(workspace), true);
  assert.equal(Object.isFrozen(workspace.tasks), true);
});

test("U7 workspace payload normalization fails closed on wrong key set and duplicates", () => {
  assert.throws(
    () =>
      normalizePlatformAdmissionsCaseWorkspacePayload(
        workspacePayload({
          assignees: workspacePayload().assignees.concat(workspacePayload().assignees),
        }),
        ORGANIZATION_ID,
        STUDENT_CASE_ID,
      ),
    PlatformAdmissionsCaseWorkspaceRepositoryError,
  );
  assert.throws(
    () =>
      normalizePlatformAdmissionsCaseWorkspacePayload(
        {
          organization_id: ORGANIZATION_ID,
          student_case_id: STUDENT_CASE_ID,
          tasks: [],
          assignee_options: [],
        },
        ORGANIZATION_ID,
        STUDENT_CASE_ID,
      ),
    PlatformAdmissionsCaseWorkspaceRepositoryError,
  );
});

test("U7 activity payload normalization fails closed on cross-case leakage", () => {
  assert.throws(
    () =>
      normalizePlatformAdmissionsCaseActivityPayload(
        activityPayload({
          audit: [{
            ...activityPayload().audit[0],
            student_case_id: "00000000-0000-4000-8000-000000000099",
          }],
        }),
        ORGANIZATION_ID,
        STUDENT_CASE_ID,
      ),
    PlatformAdmissionsCaseWorkspaceRepositoryError,
  );
});

test("U7 loader calls only task-workspace and activity RPCs with bounded args", async () => {
  const calls = [];
  const client = {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        rpc(functionName, args, options) {
          calls.push({ functionName, args, options });
          if (functionName === "staff_student_case_task_workspace") {
            return Promise.resolve({ data: workspacePayload(), error: null });
          }
          if (functionName === "staff_student_case_activity") {
            return Promise.resolve({ data: activityPayload(), error: null });
          }
          throw new Error(`Unexpected RPC ${functionName}`);
        },
      };
    },
  };
  const actor = {
    organizationId: ORGANIZATION_ID,
    platformRole: "curator",
  };

  const workspace = await getPlatformAdmissionsCaseWorkspaceForActor(
    actor,
    { studentCaseId: STUDENT_CASE_ID, limit: 25 },
    { client },
  );

  assert.equal(workspace.studentCaseId, STUDENT_CASE_ID);
  assert.deepEqual(calls, [
    {
      functionName: "staff_student_case_task_workspace",
      args: { p_student_case_id: STUDENT_CASE_ID },
      options: { get: true },
    },
    {
      functionName: "staff_student_case_activity",
      args: { p_student_case_id: STUDENT_CASE_ID, p_limit: 25 },
      options: { get: true },
    },
  ]);
});

globalThis.__platformAdmissionsCaseWorkspaceActionTest = {
  actor: {
    organizationId: ORGANIZATION_ID,
    platformRole: "curator",
    membershipId: ASSIGNEE_ID,
  },
  redirects: [],
  revalidated: [],
  rpcCalls: [],
  documents: [{
    documentVersionId: DOCUMENT_VERSION_ID,
    documentSlotId: DOCUMENT_SLOT_ID,
    slotStatus: "submitted",
    currentVersionNo: 1,
  }],
  async requireActor() {
    return this.actor;
  },
  redirect(target) {
    this.redirects.push(target);
    throw new Error(`redirect:${target}`);
  },
  revalidatePath(path) {
    this.revalidated.push(path);
  },
  async listDocuments() {
    return this.documents;
  },
  isCurrentSubmitted(document, documentVersionId) {
    return document.documentVersionId === documentVersionId && document.slotStatus === "submitted";
  },
  async rpc(functionName, args) {
    this.rpcCalls.push({ functionName, args });
    switch (functionName) {
      case "create_case_task":
        return {
          data: {
            organization_id: ORGANIZATION_ID,
            case_task_id: TASK_ID,
            student_case_id: STUDENT_CASE_ID,
            task_type: args.p_task_type,
            title: args.p_title,
            assignee_membership_id: args.p_assignee_membership_id,
            priority: args.p_priority,
            due_at: args.p_due_at,
            status: args.p_status,
            student_visible: args.p_student_visible,
          },
          error: null,
        };
      case "change_case_task":
        return {
          data: {
            organization_id: ORGANIZATION_ID,
            case_task_id: TASK_ID,
            student_case_id: STUDENT_CASE_ID,
            assignee_membership_id: args.p_new_assignee_membership_id,
            priority: args.p_priority,
            due_at: args.p_due_at,
            status: args.p_new_status,
            student_visible: args.p_student_visible,
          },
          error: null,
        };
      case "append_student_case_update":
        return {
          data: {
            organization_id: ORGANIZATION_ID,
            student_case_update_id: UPDATE_ID,
            student_case_id: STUDENT_CASE_ID,
            author_membership_id: ASSIGNEE_ID,
            body: args.p_body,
            source: args.p_source,
            student_visible: args.p_student_visible,
            occurred_at: args.p_occurred_at,
          },
          error: null,
        };
      case "review_document_version":
        return {
          data: {
            organization_id: ORGANIZATION_ID,
            document_version_id: DOCUMENT_VERSION_ID,
            document_slot_id: DOCUMENT_SLOT_ID,
            student_case_id: STUDENT_CASE_ID,
            decision: args.p_decision,
            reason: args.p_reason,
            slot_status: args.p_decision,
          },
          error: null,
        };
      default:
        throw new Error(`Unexpected RPC ${functionName}`);
    }
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/platform-admissions-case-workspace-actions.ts")) {
      if (specifier === "next/cache") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const revalidatePath = (path) => globalThis.__platformAdmissionsCaseWorkspaceActionTest.revalidatePath(path);",
          ),
        };
      }
      if (specifier === "next/navigation") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const redirect = (target) => globalThis.__platformAdmissionsCaseWorkspaceActionTest.redirect(target);",
          ),
        };
      }
      if (specifier === "./platform-guards.ts") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const requirePlatformClientsActor = () => globalThis.__platformAdmissionsCaseWorkspaceActionTest.requireActor();",
          ),
        };
      }
      if (specifier === "./platform-student-profile.ts") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const listPlatformStudentCaseDocuments = (...args) => globalThis.__platformAdmissionsCaseWorkspaceActionTest.listDocuments(...args);",
          ),
        };
      }
      if (specifier === "./platform-document-review.ts") {
        return {
          shortCircuit: true,
          url: dataModule(
            "export const isCurrentSubmittedPlatformDocumentVersion = (...args) => globalThis.__platformAdmissionsCaseWorkspaceActionTest.isCurrentSubmitted(...args);",
          ),
        };
      }
      if (specifier === "./supabase/server.ts") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export const createSupabaseServerClient = async () => ({
              schema: () => ({
                rpc: (functionName, args) => globalThis.__platformAdmissionsCaseWorkspaceActionTest.rpc(functionName, args),
              }),
            });
          `),
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const actions = await import(
  "../src/lib/platform-admissions-case-workspace-actions.ts?action-test"
);

function formData(entries) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

test("U7 actions select canonical RPCs and revalidate only internal case paths", async () => {
  const reset = () => {
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.redirects.length = 0;
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.revalidated.length = 0;
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.rpcCalls.length = 0;
  };

  reset();
  await assert.rejects(
    actions.createPlatformCaseTaskAction(
      formData({
        student_case_id: STUDENT_CASE_ID,
        task_type: "u6.document_request_plan",
        title: "Collect first passport scan",
        assignee_membership_id: ASSIGNEE_ID,
        priority: "high",
        due_at: "2026-08-27",
        status: "open",
        student_visible: "false",
        request_id: "00000000-0000-4000-8000-000000000010",
      }),
    ),
    /redirect:\/clients\//,
  );
  assert.equal(
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.rpcCalls[0].functionName,
    "create_case_task",
  );
  assert.deepEqual(
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.revalidated,
    ["/clients", `/clients/${STUDENT_CASE_ID}`],
  );

  reset();
  await assert.rejects(
    actions.reviewPlatformCaseDocumentVersionAction(
      formData({
        student_case_id: STUDENT_CASE_ID,
        document_version_id: DOCUMENT_VERSION_ID,
        decision: "correction_required",
        reason: "Need clearer passport scan",
        request_id: "00000000-0000-4000-8000-000000000011",
      }),
    ),
    /redirect:\/clients\//,
  );
  assert.equal(
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.rpcCalls[0].functionName,
    "review_document_version",
  );
  assert.deepEqual(
    globalThis.__platformAdmissionsCaseWorkspaceActionTest.revalidated,
    ["/clients", `/clients/${STUDENT_CASE_ID}`],
  );
});

test("U7 source invariants exclude Portal wrapper and legacy SQLite paths", () => {
  const repositorySource = read("src/lib/platform-admissions-case-workspace.ts");
  const actionSource = read("src/lib/platform-admissions-case-workspace-actions.ts");

  assert.match(repositorySource, /rpc\(\s*"staff_student_case_task_workspace"/);
  assert.match(repositorySource, /rpc\(\s*"staff_student_case_activity"/);
  assert.match(actionSource, /rpc\(\s*"create_case_task"/);
  assert.match(actionSource, /rpc\(\s*"change_case_task"/);
  assert.match(actionSource, /rpc\(\s*"append_student_case_update"/);
  assert.match(actionSource, /rpc\(\s*"review_document_version"/);
  assert.doesNotMatch(
    actionSource,
    /review_document_version_with_portal_notification_v1|isPlatformP6BPortalNotificationsEnabled|src\/lib\/actions\.ts|\/portal\/notifications/,
  );
});
