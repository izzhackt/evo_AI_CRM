import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import PizZip from "pizzip";
import { createStudentProfileExportHandler, studentProfileExportMethodNotAllowed } from "../src/lib/server/student-profile-export-route-handler.ts";
import { renderStudentProfileTemplate, STUDENT_PROFILE_TEMPLATE_SHA256, STUDENT_PROFILE_DRAFT_WARNING } from "../src/lib/server/student-profile-template.ts";
import { PROFILE_FIELDS } from "../src/lib/student-profile-fields.ts";

const ORG = "60160000-0000-4000-8000-000000000001";
const CASE = "60160000-0000-4000-8000-000000000002";
const PROFILE = "60160000-0000-4000-8000-000000000003";
const USER = "60160000-0000-4000-8000-000000000004";
const MEMBER = "60160000-0000-4000-8000-000000000005";
const REQUEST = "60160000-0000-4000-8000-000000000006";
const ATTEMPT = "60160000-0000-4000-8000-000000000007";
const ORIGIN = "http://127.0.0.1:3000";
const template = readFileSync(new URL("../assets/templates/student-profile.docx", import.meta.url));
const actor = { authUserId: USER, membershipId: MEMBER, organizationId: ORG,
  systemRole: "staff", permissionKeys: ["profile.read.full", "document.download"], presentationRole: null };
const requiredValues = {
  student_first_name: "SyntheticFirst", student_last_name: "SyntheticLast", date_of_birth: "2005-01-02",
  nationality: "Fictional country", passport_number: "TEST12345", permanent_address: "Synthetic street 1",
  mobile_phone: "+996700123456", student_email: "synthetic@example.invalid", field_major: "Engineering",
};
function snapshot() {
  return { studentCaseId: CASE, profile: { id: PROFILE, revision: 7 }, canInitialize: false, canReview: false, canExport: true,
    fields: PROFILE_FIELDS.map(({ key, required }) => ({ key, value: required ? requiredValues[key] : null,
      state: required ? "confirmed" : "needs_review", reviewedAt: required ? "2026-09-13T00:00:00Z" : null,
      sourceDocumentVersionId: null, sourcePage: null, proposals: [] })) };
}
function request(mode = "draft", overrides = {}) {
  return new Request(`${ORIGIN}/api/v3/student-cases/${CASE}/profile-exports`, {
    method: "POST", headers: { origin: ORIGIN, host: "127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify({ mode, expected_revision: 7, request_id: REQUEST, ...overrides }),
  });
}
const context = { params: Promise.resolve({ studentCaseId: CASE }) };

// Real registry and OOXML renderer, fake external Auth/RPC boundaries only.
// No provider, database, applicant file or browser is contacted by these tests.
function fixture(options = {}) {
  const calls = [];
  let actorReads = 0;
  const data = options.snapshot ?? snapshot();
  const handler = createStudentProfileExportHandler({
    async loadActor() {
      calls.push("actor");
      actorReads++;
      return options.actorResult ?? (actorReads > 1 && options.refreshedActorResult
        ? options.refreshedActorResult : { status: "authenticated", actor });
    },
    async readSnapshot(receivedActor, caseId) {
      assert.equal(receivedActor, actor); assert.equal(caseId, CASE);
      calls.push("user_snapshot");
      return data;
    },
    createServiceClient() {
      return { schema(schema) {
        assert.equal(schema, "platform");
        return { async rpc(name, args) {
          calls.push({ name, args });
          if (name === "begin_student_profile_export") {
            assert.equal(args.p_actor_auth_user_id, USER);
            assert.equal(args.p_actor_membership_id, MEMBER);
            assert.equal(args.p_organization_id, ORG);
            assert.equal(args.p_template_sha256, STUDENT_PROFILE_TEMPLATE_SHA256);
            if (options.beginError) return { data: null, error: { code: options.beginError } };
            return { error: null, data: {
              attempt_id: ATTEMPT, organization_id: ORG, student_case_id: CASE, student_profile_id: PROFILE,
              profile_revision: 7, mode: args.p_mode, template_sha256: STUDENT_PROFILE_TEMPLATE_SHA256,
              created: !options.replayStatus, status: options.replayStatus ?? "pending",
              failure_code: options.replayStatus === "failed" ? "render_failed" : null,
              ...options.receipt,
            } };
          }
          assert.equal(name, "complete_student_profile_export");
          assert.equal(args.p_attempt_id, ATTEMPT);
          if (options.completionUnknown) throw new Error("Synthetic backend failure, never forward details");
          if (options.completionFailure) return { error: null,
            data: { attempt_id: ATTEMPT, status: "failed", failure_code: options.completionFailure } };
          return { error: null, data: { attempt_id: ATTEMPT, status: args.p_outcome, failure_code: args.p_failure_code } };
        } };
      } };
    },
    async readTemplate() {
      calls.push("template");
      if (options.templateMissing) throw new Error("Synthetic file path must not appear in response");
      return template;
    },
    render(...args) { calls.push("render"); return renderStudentProfileTemplate(...args); },
  });
  return { handler, calls, data };
}
const rpcCalls = (f) => f.calls.filter(item => typeof item === "object");

test("confirmed user snapshot produces a draft, then service audits hash/size before returning bytes", async () => {
  const f = fixture();
  const unreviewed = f.data.fields.find(field => field.key === "desired_university");
  unreviewed.value = "SyntheticUnreviewedUniversity";
  const empty = f.data.fields.find(field => field.key === "mother_employer");
  empty.state = "confirmed"; empty.reviewedAt = "2026-09-13T00:00:00Z";
  const response = await f.handler(request(), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="student-profile-draft.docx"');
  const bytes = Buffer.from(await response.arrayBuffer());
  const xml = new PizZip(bytes).file("word/document.xml").asText();
  assert.ok(xml.includes("SyntheticFirst"));
  assert.ok(xml.includes(STUDENT_PROFILE_DRAFT_WARNING));
  assert.ok(!xml.includes("SyntheticUnreviewedUniversity"));
  const operations = rpcCalls(f);
  assert.deepEqual(operations.map(({ name }) => name), ["begin_student_profile_export", "complete_student_profile_export"]);
  assert.deepEqual(operations[1].args, { p_attempt_id: ATTEMPT, p_outcome: "generated",
    p_output_sha256: createHash("sha256").update(bytes).digest("hex"), p_output_bytes: bytes.length, p_failure_code: null });
  assert.equal(JSON.stringify(operations).includes("SyntheticFirst"), false);
  assert.ok(f.calls.indexOf("user_snapshot") < f.calls.indexOf("render"));
  assert.ok(f.calls.lastIndexOf("actor") > f.calls.indexOf("render"));
});

test("final export uses real readiness and renderer without a draft marker", async () => {
  const f = fixture();
  const response = await f.handler(request("final"), context);
  assert.equal(response.status, 200);
  const xml = new PizZip(Buffer.from(await response.arrayBuffer())).file("word/document.xml").asText();
  assert.ok(xml.includes("SyntheticFirst"));
  assert.equal(xml.includes(STUDENT_PROFILE_DRAFT_WARNING), false);
});

test("readiness failures record failed, return only field keys/kinds and never render", async () => {
  const f = fixture();
  f.data.fields.find(field => field.key === "student_first_name").state = "needs_review";
  const response = await f.handler(request("final"), context);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "profile_not_ready", issues: [{ key: "student_first_name", kind: "unconfirmed" }] });
  assert.equal(f.calls.includes("render"), false);
  assert.equal(rpcCalls(f).at(-1).args.p_outcome, "failed");
});

test("a confirmed country beyond the template limit is an explicit draft blocker", async () => {
  const f = fixture();
  f.data.fields.find(field => field.key === "nationality").value = "A".repeat(61);
  const response = await f.handler(request(), context);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "profile_not_ready", issues: [{ key: "nationality", kind: "invalid" }] });
  assert.equal(f.calls.includes("render"), false);
});

for (const [status, expectedStatus, error] of [
  ["pending", 409, "export_request_pending"], ["generated", 409, "export_request_completed"], ["failed", 503, "render_failed"],
]) test(`explicit ${status} request replay does not read newer values, render or append a completion`, async () => {
  const f = fixture({ replayStatus: status });
  const response = await f.handler(request(), context);
  assert.equal(response.status, expectedStatus);
  assert.deepEqual(await response.json(), { error });
  assert.equal(f.calls.includes("user_snapshot"), false);
  assert.equal(f.calls.includes("render"), false);
  assert.equal(rpcCalls(f).length, 1);
});

for (const [failure, status] of [["profile_changed", 409], ["access_changed", 403]]) {
  test(`completion commits ${failure} as a failure and withholds already rendered bytes`, async () => {
    const f = fixture({ completionFailure: failure });
    const response = await f.handler(request(), context);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: failure });
    assert.ok(f.calls.includes("render"));
    assert.equal(rpcCalls(f).at(-1).args.p_outcome, "generated");
    assert.equal(rpcCalls(f).length, 2);
  });
}

test("unknown completion outcome returns no bytes and never retries or overwrites the outcome", async () => {
  const f = fixture({ completionUnknown: true });
  const response = await f.handler(request(), context);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "export_unavailable" });
  assert.equal(rpcCalls(f).filter(call => call.name === "complete_student_profile_export").length, 1);
});

test("a revision change before user snapshot rendering is recorded without loading the template", async () => {
  const f = fixture(); f.data.profile.revision = 8;
  const response = await f.handler(request(), context);
  assert.equal(response.status, 409);
  assert.equal(f.calls.includes("template"), false);
  assert.equal(rpcCalls(f).at(-1).args.p_failure_code, "profile_changed");
});

test("missing template and changed session have fixed failed outcomes", async () => {
  for (const options of [{ templateMissing: true }, { refreshedActorResult: { status: "anonymous", actor: null } }]) {
    const f = fixture(options);
    const response = await f.handler(request(), context);
    const expected = options.templateMissing ? "template_unavailable" : "access_changed";
    assert.deepEqual(await response.json(), { error: expected });
    assert.equal(rpcCalls(f).at(-1).args.p_failure_code, expected);
    assert.equal(rpcCalls(f).at(-1).args.p_output_sha256, null);
  }
});

test("unauthenticated and Admin preview surfaces do not create generation attempts", async () => {
  for (const [actorResult, expected] of [
    [{ status: "anonymous", actor: null }, 401],
    [{ status: "authenticated", actor: { ...actor, systemRole: "admin", presentationRole: "sales" } }, 403],
  ]) {
    const f = fixture({ actorResult });
    const response = await f.handler(request(), context);
    assert.equal(response.status, expected);
    assert.equal(rpcCalls(f).length, 0);
  }
});

test("small exact command validation and non-POST response preserve the route contract", async () => {
  const f = fixture();
  const invalid = await f.handler(request("draft", { expected_revision: 0 }), context);
  assert.equal(invalid.status, 400);
  assert.equal(rpcCalls(f).length, 0);
  assert.deepEqual(await invalid.json(), { error: "invalid_request" });
  const method = studentProfileExportMethodNotAllowed();
  assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "POST");
});

test("trusted proxy protocol follows the existing Host/Origin export convention", async () => {
  const f = fixture();
  const proxied = new Request("http://evo-crm-app:3000/api/v3/student-cases/unused/profile-exports", {
    method: "POST", headers: { origin: "https://crm.example.invalid", host: "crm.example.invalid",
      "x-forwarded-proto": "https", "content-type": "application/json" },
    body: JSON.stringify({ mode: "draft", expected_revision: 7, request_id: REQUEST }),
  });
  assert.equal((await f.handler(proxied, context)).status, 200);
});

test("migration161 keeps success behind service-only RPCs and has no profile-value projection", () => {
  const sql = readFileSync(new URL("../supabase/migrations/161_platform_student_profile_exports.sql", import.meta.url), "utf8");
  assert.equal((sql.match(/auth\.jwt\(\) ->> 'role'/g) ?? []).length, 2);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin/);
  assert.match(sql, /platform\.complete_student_profile_export\(UUID, TEXT, TEXT, INTEGER, TEXT\) TO service_role/);
  assert.match(sql, /SELECT profile\.id, profile\.revision INTO target_profile/);
  assert.doesNotMatch(sql, /SELECT profile\.\*|student_profile_fields\b|student_profile_field_proposals\b/);
  assert.match(sql, /effective_outcome := 'failed'; effective_failure := 'access_changed'/);
  assert.match(sql, /effective_outcome := 'failed'; effective_failure := 'profile_changed'/);
  assert.match(sql, /RETURN jsonb_build_object\('attempt_id', attempt\.id, 'status', attempt\.status, 'failure_code', attempt\.failure_code\);/);
});

test("migration161 serializes organization before request, membership and profile locks", () => {
  const sql = readFileSync(new URL("../supabase/migrations/161_platform_student_profile_exports.sql", import.meta.url), "utf8");
  for (const name of ["begin", "complete"]) {
    const body = sql.split(`CREATE FUNCTION platform.${name}_student_profile_export(`)[1]?.split("\n$$;")[0];
    assert.ok(body, `${name}: function body exists`);
    const organizationId = name === "begin" ? "p_organization_id" : "attempt.organization_id";
    const organizationLock = `PERFORM 1 FROM platform.organizations WHERE id = ${organizationId} FOR UPDATE;`;
    const lockPositions = [
      organizationLock,
      "PERFORM platform_private.lock_bw3_request(",
      "PERFORM platform_private.staff_lock_memberships(",
      "PERFORM 1 FROM platform.student_cases AS student_case",
      "SELECT profile.id, profile.revision INTO target_profile",
    ].map((statement) => {
      const position = body.indexOf(statement);
      assert.notEqual(position, -1, `${name}: required lock statement ${statement}`);
      return position;
    });
    assert.deepEqual(lockPositions, [...lockPositions].sort((a, b) => a - b), `${name}: canonical lock order`);
    assert.equal(body.indexOf("FOR UPDATE"), body.indexOf(organizationLock) + organizationLock.indexOf("FOR UPDATE"),
      `${name}: organization is the first row lock`);
    if (name === "complete") {
      const contextRead = "SELECT * INTO attempt FROM platform_private.student_profile_export_attempts WHERE id = p_attempt_id;";
      const lockedReread = "SELECT * INTO attempt FROM platform_private.student_profile_export_attempts WHERE id = p_attempt_id FOR UPDATE;";
      assert.ok(body.indexOf(contextRead) >= 0 && body.indexOf(contextRead) < lockPositions[0],
        "complete: immutable context is read without locking before organization lock");
      assert.ok(body.indexOf(lockedReread) > lockPositions[4], "complete: attempt is reread under lock after profile lock");
      assert.ok(body.indexOf("IF attempt.status <> 'pending' THEN") > body.indexOf(lockedReread),
        "complete: outcome is checked against the locked reread");
    }
  }
});
