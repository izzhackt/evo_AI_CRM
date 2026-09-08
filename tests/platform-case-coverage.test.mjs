import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseCoverageCommand,
  parseCoverageTaskSnapshot,
} from "../src/lib/platform-case-coverage-command.ts";
import {
  parseCoverageDate,
  parseCoverageVersion,
  parseCoverageWorkspace,
} from "../src/lib/platform-case-coverage-contract.ts";

// Protocol-only constants: these tests do not create users, cases or tasks.
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const snapshot = JSON.stringify([{ id: ids[4], version: "9007199254740993" }]);
function fields(operation = "start") {
  return new Map(Object.entries({
    operation, student_case_id: ids[0], expected_owner: ids[1], expected_scope_version: "8",
    substitute_membership_id: operation === "start" ? ids[2] : "",
    planned_end_on: operation === "start" ? "2026-09-30" : "",
    coverage_id: operation === "return" ? ids[5] : "",
    expected_coverage_version: operation === "return" ? "1" : "0",
    task_snapshot: snapshot, reason: "Operational coverage", request_id: ids[3], [`task_${ids[4]}`]: "true",
  }));
}
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/133_platform_curator_workload_coverage.sql");
const action = read("src/lib/platform-case-coverage-actions.ts");

test("coverage command preserves exact bigint versions and explicit transfer choice", () => {
  const start = parseCoverageCommand(fields());
  assert.ok(start);
  assert.equal(start.coverageVersion, "0");
  assert.deepEqual(start.tasks, [{ id: ids[4], version: "9007199254740993", selected: true }]);
  const returned = parseCoverageCommand(fields("return"));
  assert.ok(returned);
  assert.equal(returned.substituteId, null);
  assert.equal(returned.coverageId, ids[5]);
});

test("coverage snapshots reject duplicate, malformed, oversized and imprecise inputs", () => {
  assert.equal(parseCoverageTaskSnapshot("{"), null);
  assert.equal(parseCoverageTaskSnapshot(JSON.stringify([{ id: ids[4], version: 1 }])), null);
  assert.equal(parseCoverageTaskSnapshot(JSON.stringify([{ id: ids[4], version: "1" }, { id: ids[4], version: "2" }])), null);
  assert.equal(parseCoverageTaskSnapshot(JSON.stringify([{ id: ids[4], version: "1", selected: true }])), null);
  assert.equal(parseCoverageTaskSnapshot(JSON.stringify(Array(1001).fill({ id: ids[4], version: "1" }))), null);
  assert.equal(parseCoverageTaskSnapshot(JSON.stringify([{ id: ids[4], version: "9223372036854775808" }])), null);
});

test("commands fail closed on missing choice, foreign fields and mixed operations", () => {
  for (const mutate of [
    (row) => row.delete(`task_${ids[4]}`),
    (row) => row.set(`task_${ids[4]}`, "on"),
    (row) => row.set("unexpected", "true"),
    (row) => row.set("coverage_id", ids[5]),
    (row) => row.set("substitute_membership_id", ids[1]),
    (row) => row.set("reason", " "),
    (row) => row.set("planned_end_on", "2026-02-30"),
  ]) {
    const value = fields(); mutate(value); assert.equal(parseCoverageCommand(value), null);
  }
  const returned = fields("return"); returned.set("planned_end_on", "2026-09-30");
  assert.equal(parseCoverageCommand(returned), null);
});

test("deadline and version parsers reject rollover and unsafe number coercion", () => {
  assert.equal(parseCoverageDate("2026-02-30"), null);
  assert.equal(parseCoverageDate("2028-02-29"), "2028-02-29");
  assert.equal(parseCoverageVersion(12), null);
  assert.equal(parseCoverageVersion("9223372036854775807"), "9223372036854775807");
  assert.equal(parseCoverageVersion("0"), null);
});

test("empty real workspace is allowed but malformed authority projection is not", () => {
  const empty = { organization_id: ids[0], curators: [], cases: [], next_case_id: null, preview: null };
  assert.equal(parseCoverageWorkspace(empty, ids[0]).preview, null);
  assert.throws(() => parseCoverageWorkspace(empty, ids[1]));
  assert.throws(() => parseCoverageWorkspace({ ...empty, preview: {} }, ids[0]));
  assert.throws(() => parseCoverageWorkspace({ ...empty, injected: true }, ids[0]));
});

test("canonical task bodies move once and take domain lock before request and row locks", () => {
  assert.match(sql, /RENAME TO coverage_create_task_body/);
  assert.match(sql, /RENAME TO coverage_change_task_body/);
  for (const name of ["create", "change"]) {
    const wrapper = sql.split(`CREATE FUNCTION private.${name}_case_task(`)[1].split("END $$;")[0];
    assert.ok(wrapper.indexOf("lock_student_case_note_assignment_domain") < wrapper.indexOf(`coverage_${name}_task_body`));
    assert.ok(wrapper.indexOf("lock_student_case_note_assignment_domain") < wrapper.indexOf("coverage_require_current_task_assignee"));
    assert.doesNotMatch(wrapper, /require_domain_actor/); // It locks rows: body only.
  }
  assert.equal([...sql.matchAll(/UPDATE platform\.case_tasks/g)].length, 0);
  assert.match(sql, /platform\.change_case_task\(p_organization_id,task.id/);
  assert.match(sql, /platform\.assign_student_case_curator\(p_organization_id,p_student_case_id,next_owner/);
});

test("post-coverage guard is narrow: current Curator only for open covered work", () => {
  const guard = sql.split("CREATE FUNCTION platform_private.coverage_require_current_task_assignee(")[1].split("END $$;")[0];
  assert.match(guard, /p_status IN \('open','in_progress','blocked'\)/);
  assert.match(guard, /FROM platform_private.case_curator_coverages/);
  assert.match(guard, /member\."current_role"='curator'/);
  assert.match(guard, /sc.current_curator_membership_id IS DISTINCT FROM member.id/);
  assert.doesNotMatch(guard, /returned_at IS NULL|status='active'/);
});

test("exact snapshot covers all open work, protects manual changes and never transfers completed tasks", () => {
  assert.match(sql, /IF actual <> expected THEN/);
  assert.match(sql, /status IN \('open','in_progress','blocked'\)/);
  assert.match(sql, /All outgoing Curator open tasks must be selected/);
  assert.match(sql, /Coverage task was manually reassigned/);
  assert.match(sql, /event\.before_state->>'assignee_membership_id' IS DISTINCT FROM event\.after_state->>'assignee_membership_id'/);
  assert.match(sql, /restore_assignee := binding.original_assignee_membership_id/);
  assert.match(sql, /Outgoing Curator still owns open work/);
  assert.match(sql, /coverage.started_scope_version <> p_expected_scope_version/);
});

test("coverage replay binds actor and full command; inner operations get independent request IDs", () => {
  assert.match(sql, /'tasks',p_tasks,'actor',actor.actor_membership_id/);
  assert.match(sql, /'request_fingerprint',fingerprint/);
  assert.match(sql, /'coverage:assignment'/);
  assert.match(sql, /'coverage:task:'\|\|task.id/);
  assert.match(sql, /action_key := 'case.coverage.' \|\| p_operation/);
  assert.match(sql, /action_key,'student_case',p_student_case_id/);
});

test("coverage surfaces are Admin guarded and never grant provider or service access", () => {
  assert.match(sql, /PERFORM platform_private.require_admin_actor\(p_organization_id,'case.curator.assign'\)/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION private.read_curator_coverage_workspace[\s\S]*?TO authenticated/);
  assert.doesNotMatch(sql, /GRANT[^;]*TO (?:service_role|anon|PUBLIC)/);
  assert.match(action, /actor.authorityRole !== "admin"/);
  assert.match(action, /exactActionStringFields/);
  assert.match(action, /rpc\("manage_case_coverage"/);
  assert.doesNotMatch(action, /service.?role|createClient\(|revalidatePath\(/i);
});

test("UI preserves drafts on stale reads and navigates only after a confirmed receipt", () => {
  const form = read("src/components/v3/profile/CuratorCoverageForm.tsx");
  const panel = read("src/components/v3/profile/CuratorCoveragePanel.tsx");
  assert.match(form, /\[reason, setReason\] = useState\(""\)/);
  assert.match(form, /name="reason" value=\{reason\}/);
  assert.match(form, /if \(status === "saved"\)/);
  assert.match(form, /coverage_curator: destination, coverage_case: reviewed.id/);
  assert.match(form, /aria-busy=\{pending\}/);
  assert.doesNotMatch(form, /if \(status === "stale"\)[\s\S]{0,100}router.refresh/);
  assert.doesNotMatch(panel, /key=\{[^}]*version/);
  assert.match(panel, /Открыть актуальное назначение/);
  assert.match(form, /!readUnavailable/);
  assert.match(action, /status === "request_conflict" \|\| status === "saved" \? randomUUID/);
});

test("Admin exact case reread preserves tenant/active guard and exposes stale assignment explicitly", () => {
  const exactRead = sql.split("IF p_student_case_id IS NOT NULL THEN")[1].split("SELECT * INTO coverage")[0];
  assert.match(exactRead, /organization_id=p_organization_id/);
  assert.match(exactRead, /id=p_student_case_id AND state='active'/);
  assert.doesNotMatch(exactRead, /AND current_curator_membership_id=p_curator_membership_id/);
  assert.match(exactRead, /current_curator_membership_id IS DISTINCT FROM p_curator_membership_id/);
  assert.match(exactRead, /array_append\(conflicts,'assignment_changed'\)/);
});
