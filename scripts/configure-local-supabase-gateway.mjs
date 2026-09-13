import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "smol-toml";

// Disposable CLI foundation only. This does not configure managed Supabase.
// Preserve CLI2.116.0's email-template server when reloading Kong2.8.1.
const template = "/home/kong/custom_nginx.template";
const prefix = "/usr/local/kong";
const safeProject = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

function fail(code) {
  throw new Error(code);
}

export function verifyLocalGatewayImageReference(image) {
  // CLI2.116.0's source image and its two official registry candidates.
  if (![
    "public.ecr.aws/supabase/kong:2.8.1",
    "ghcr.io/supabase/kong:2.8.1",
    "library/kong:2.8.1",
  ].includes(image)) fail("local_gateway_image_reference_unknown");
}

export function verifyLocalGatewayRuntimeIdentity(imageId, version) {
  if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) {
    fail("local_gateway_image_identity_invalid");
  }
  if (version !== "2.8.1") fail("local_gateway_version_not_verified");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Docker/Kong diagnostics can contain config or credentials. Never echo them.
  if (result.error || result.status !== 0) fail("local_gateway_command_failed");
  return result.stdout.trim();
}

function inspect(name, projectId, workdir) {
  const format = [
    "{{json .Id}}", "{{json .Name}}", "{{json .Config.Image}}", "{{json .Image}}",
    "{{json .State.Running}}", "{{json .RestartCount}}",
    '{{json (index .Config.Labels "com.supabase.cli.project")}}',
    '{{json (index .Config.Labels "com.supabase.cli.workdir")}}',
    "{{json .NetworkSettings.Networks}}",
  ].join("\t");
  const fields = run("docker", ["inspect", name, "--format", format]).split("\t").map(JSON.parse);
  const [id, actualName, image, imageId, running, restarts, project, owner, networks] = fields;
  if (fields.length !== 9 || !sha256.test(id) || actualName !== `/${name}` ||
      running !== true || project !== projectId || owner !== workdir) {
    fail("local_gateway_container_not_owned");
  }
  const endpoints = Object.values(networks ?? {});
  if (endpoints.length !== 1 || !sha256.test(endpoints[0]?.NetworkID ?? "")) {
    fail("local_gateway_network_ambiguous");
  }
  return { id, image, imageId, restarts, networkId: endpoints[0].NetworkID };
}

function fingerprint(containerId) {
  const output = run("docker", ["exec", containerId, "sha256sum", template, "/home/kong/kong.yml"]);
  const lines = output.split("\n");
  if (lines.length !== 2 || lines.some((line) => !sha256.test(line.split(/\s+/u)[0]))) {
    fail("local_gateway_config_fingerprint_invalid");
  }
  return output;
}

function main() {
  if (process.argv.length !== 3) fail("local_gateway_workdir_required");
  const workdir = realpathSync(resolve(process.argv[2]));
  const projectId = parse(readFileSync(resolve(workdir, "supabase/config.toml"), "utf8")).project_id;
  if (typeof projectId !== "string" || !safeProject.test(projectId)) fail("local_gateway_project_invalid");

  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) {
    fail("local_gateway_remote_docker_forbidden");
  }
  const context = run("docker", ["context", "show"]);
  const endpoint = run("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
  if (!endpoint.startsWith("unix://")) fail("local_gateway_remote_docker_forbidden");
  if (process.platform === "darwin" && (context !== "orbstack" || run("orb", ["status"]) !== "Running")) {
    fail("local_gateway_orbstack_required");
  }

  const name = `supabase_kong_${projectId}`;
  const before = inspect(name, projectId, workdir);
  const database = inspect(`supabase_db_${projectId}`, projectId, workdir);
  if (before.networkId !== database.networkId) fail("local_gateway_project_network_mismatch");
  verifyLocalGatewayImageReference(before.image);
  const kongVersion = run("docker", ["exec", before.id, "kong", "version"]);
  verifyLocalGatewayRuntimeIdentity(before.imageId, kongVersion);
  const configuredPrefix = run("docker", ["exec", before.id, "sh", "-c", 'printf "%s" "${KONG_PREFIX:-/usr/local/kong}"']);
  if (configuredPrefix.replace(/\/$/u, "") !== prefix) fail("local_gateway_prefix_not_verified");
  const configBefore = fingerprint(before.id);

  run("docker", ["exec", "--env", "KONG_UPSTREAM_KEEPALIVE_POOL_SIZE=0", before.id,
    "kong", "reload", "--prefix", prefix, "--nginx-conf", template]);
  const effective = run("docker", ["exec", before.id, "awk",
    '/^upstream_keepalive_pool_size[[:space:]]*=/ {gsub(/[[:space:]]/, ""); print}',
    `${prefix}/.kong_env`]);
  if (effective !== "upstream_keepalive_pool_size=0") fail("local_gateway_effective_config_mismatch");
  run("docker", ["exec", before.id, "kong", "health", "--prefix", prefix]);
  if (fingerprint(before.id) !== configBefore) fail("local_gateway_routing_config_changed");
  const after = inspect(name, projectId, workdir);
  if (JSON.stringify(after) !== JSON.stringify(before)) fail("local_gateway_identity_changed");
  console.log(JSON.stringify({
    ok: true, code: "local_gateway_transport_configured", projectId,
    image: before.image, imageId: before.imageId, kongVersion,
    upstreamKeepalivePoolSize: 0, routingPreserved: true, health: "passed",
    scope: "disposable_local_only",
  }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(/^local_gateway_[a-z_]+$/u.test(message) ? message : "local_gateway_configuration_failed");
    process.exitCode = 1;
  }
}
