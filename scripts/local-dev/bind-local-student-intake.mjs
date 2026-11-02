import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parse } from "smol-toml";

// Bootstrap only: the organization and department must already exist through
// the normal local Admin bootstrap/commands. This never creates a Student,
// bypasses application approval, or rewires an existing intake configuration.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function fail(code) { throw new Error(`local_student_intake_${code}`); }

function run(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024,
    input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail("command_failed");
  return result.stdout.trim();
}

function main() {
  if (process.argv.length !== 5) fail("arguments_required");
  const workdir = realpathSync(resolve(process.argv[2]));
  const [organizationId, departmentId] = process.argv.slice(3);
  if (!uuid.test(organizationId) || !uuid.test(departmentId)) fail("ids_invalid");
  if (basename(workdir) !== "local-supabase"
      || !/^evo-database-foundation\.[A-Za-z0-9]+$/u.test(basename(dirname(workdir)))) {
    fail("workdir_invalid");
  }
  const config = parse(readFileSync(resolve(workdir, "supabase/config.toml"), "utf8"));
  const projectId = config.project_id;
  if (typeof projectId !== "string" || !/^evo-local-[a-f0-9]{16}$/u.test(projectId)) fail("project_invalid");
  const site = new URL(config.auth.site_url);
  if (site.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(site.hostname)
      || !site.port || site.username || site.password) fail("origin_invalid");
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) fail("remote_docker_forbidden");
  const context = run("docker", ["context", "show"]);
  const endpoint = run("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
  if (!endpoint.startsWith("unix://")) fail("remote_docker_forbidden");
  if (process.platform === "darwin" && (context !== "orbstack" || run("orb", ["status"]) !== "Running")) {
    fail("orbstack_required");
  }
  const format = ['{{json .Id}}', '{{json .State.Running}}',
    '{{json (index .Config.Labels "com.supabase.cli.project")}}',
    '{{json (index .Config.Labels "com.supabase.cli.workdir")}}'].join("\t");
  const [id, running, ownerProject, ownerWorkdir] = run("docker", ["inspect", `supabase_db_${projectId}`, "--format", format])
    .split("\t").map(JSON.parse);
  if (!/^[a-f0-9]{64}$/u.test(id) || running !== true || ownerProject !== projectId || ownerWorkdir !== workdir) fail("ownership_mismatch");

  // UUIDs are the only interpolated SQL. The singleton is inserted exactly once
  // into this owned disposable database; existing configuration fails closed.
  const output = run("docker", ["exec", "-i", id, "psql", "-X", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-qAt"], `BEGIN;
SET LOCAL lock_timeout = '5s';
DO $binding$
DECLARE changed integer;
BEGIN
  PERFORM 1 FROM platform.organizations WHERE id='${organizationId}'::uuid AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'local_organization_missing'; END IF;
  PERFORM 1 FROM platform.staff_departments
    WHERE organization_id='${organizationId}'::uuid AND id='${departmentId}'::uuid AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'local_review_department_missing'; END IF;
  LOCK TABLE platform_private.student_application_configuration IN EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM platform_private.student_application_configuration) THEN
    RAISE EXCEPTION 'local_student_intake_already_configured';
  END IF;
  INSERT INTO platform_private.student_application_configuration
    (singleton,organization_id,review_department_id,enabled,intake_owner_membership_id)
    VALUES(TRUE,'${organizationId}'::uuid,'${departmentId}'::uuid,TRUE,NULL);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'local_student_intake_not_exactly_one'; END IF;
END $binding$;
COMMIT;
SELECT 'LOCAL_STUDENT_INTAKE_BOUND';
`);
  if (output !== "LOCAL_STUDENT_INTAKE_BOUND") fail("receipt_invalid");
  console.log(JSON.stringify({ code: "local_student_intake_bound", projectId, changedRows: 1, scope: "disposable_local_only" }));
}

try { main(); } catch (error) {
  console.error(/^local_student_intake_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "local_student_intake_failed");
  process.exitCode = 1;
}
