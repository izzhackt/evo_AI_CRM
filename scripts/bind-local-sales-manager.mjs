import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parse } from "smol-toml";

// Migration 208 intentionally requires explicit provisioning of a manager role.
// This setup operation is restricted to a newly created disposable CLI project.
// It never creates identities, grants permissions, or inserts business records.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fail(code) { throw new Error(`local_sales_binding_${code}`); }

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
  const [organizationId, roleId] = process.argv.slice(3);
  if (!uuid.test(organizationId) || !uuid.test(roleId)) fail("ids_invalid");
  if (basename(workdir) !== "local-supabase"
      || !/^evo-database-foundation\.[A-Za-z0-9]+$/u.test(basename(dirname(workdir)))) {
    fail("workdir_invalid");
  }
  const config = parse(readFileSync(resolve(workdir, "supabase/config.toml"), "utf8"));
  const projectId = config.project_id;
  if (!/^evo-local-[a-f0-9]{16}$/u.test(projectId)) fail("project_invalid");
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
  const container = `supabase_db_${projectId}`;
  const format = ['{{json .Id}}', '{{json .State.Running}}',
    '{{json (index .Config.Labels "com.supabase.cli.project")}}',
    '{{json (index .Config.Labels "com.supabase.cli.workdir")}}'].join("\t");
  const [id, running, ownerProject, ownerWorkdir] = run("docker", ["inspect", container, "--format", format]).split("\t").map(JSON.parse);
  if (!/^[a-f0-9]{64}$/u.test(id) || running !== true || ownerProject !== projectId || ownerWorkdir !== workdir) fail("ownership_mismatch");

  // Strict UUID validation above is the only interpolation into SQL. The role
  // and its bundle must already have been created by ordinary Admin commands.
  const output = run("docker", ["exec", "-i", id, "psql", "-X", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-qAt"], `BEGIN;
SET LOCAL lock_timeout = '5s';
DO $binding$
DECLARE changed integer;
BEGIN
  PERFORM 1 FROM platform.organizations WHERE id='${organizationId}'::uuid AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'local_organization_missing'; END IF;
  UPDATE platform.staff_role_definitions r SET workflow_key='sales_manager'
  WHERE r.organization_id='${organizationId}'::uuid AND r.id='${roleId}'::uuid
    AND r.status='active' AND r.workflow_key IS NULL
    AND EXISTS (SELECT 1 FROM platform.role_bundle_versions b
      JOIN platform.role_bundle_permissions p ON p.bundle_id=b.id
      WHERE b.id=r.current_bundle_id AND b.status='published'
        AND p.permission_key='sales.register.manage');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'local_role_binding_not_exactly_one'; END IF;
END $binding$;
COMMIT;
SELECT 'LOCAL_SALES_MANAGER_BOUND';
`);
  if (output !== "LOCAL_SALES_MANAGER_BOUND") fail("receipt_invalid");
  console.log(JSON.stringify({ code: "local_sales_manager_bound", projectId, changedRows: 1, scope: "disposable_local_only" }));
}

try { main(); } catch (error) {
  console.error(/^local_sales_binding_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "local_sales_binding_failed");
  process.exitCode = 1;
}
