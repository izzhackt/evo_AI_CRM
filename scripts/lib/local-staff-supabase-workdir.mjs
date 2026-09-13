import { randomBytes } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";

const portPaths = [["api", "port"], ["db", "port"], ["db", "shadow_port"], ["db", "pooler", "port"],
  ["studio", "port"], ["local_smtp", "port"], ["local_smtp", "smtp_port"], ["local_smtp", "pop3_port"],
  ["analytics", "port"], ["edge_runtime", "inspector_port"]];

export function staffLoopbackOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.port) {
    throw new Error("local_staff_origin_invalid");
  }
  return url.origin;
}

export function localStaffConfig(source, appOrigin, projectId, ports) {
  const config = parse(source);
  const origin = staffLoopbackOrigin(appOrigin);
  if (!/^evo-local-[a-f0-9]{16}$/u.test(projectId) || !Array.isArray(ports) || ports.length !== portPaths.length
    || new Set(ports).size !== ports.length || ports.includes(Number(new URL(origin).port))
    || ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) {
    throw new Error("local_staff_project_invalid");
  }
  if (config.local_smtp?.enabled !== true || config.auth?.email?.smtp?.enabled === true
    || config.auth?.sms?.enabled === true || config.db?.seed?.enabled !== false) {
    throw new Error("local_staff_mail_or_seed_not_isolated");
  }
  for (const provider of Object.values(config.auth?.external ?? {})) {
    if (provider?.enabled === true) throw new Error("local_staff_external_auth_enabled");
  }
  config.project_id = projectId;
  config.auth.site_url = origin;
  config.auth.additional_redirect_urls = [`${origin}/auth/staff`, `${origin}/auth/callback`];
  portPaths.forEach((path, index) => {
    const parent = path.slice(0, -1).reduce((entry, key) => entry?.[key], config);
    if (!parent || !Number.isInteger(parent[path.at(-1)])) throw new Error("local_staff_port_config_changed");
    parent[path.at(-1)] = ports[index];
  });
  return config;
}

async function allocatePorts(appPort) {
  const servers = [];
  try {
    const ports = [];
    // Keep the selected app port reserved while choosing service ports.
    const reservedApp = createServer(); servers.push(reservedApp);
    await new Promise((ready, reject) => { reservedApp.once("error", reject); reservedApp.listen(appPort, "127.0.0.1", ready); });
    for (let index = 0; index < portPaths.length; index += 1) {
      const server = createServer(); servers.push(server);
      await new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePort); });
      ports.push(server.address().port);
    }
    return ports;
  } finally { await Promise.all(servers.map((server) => new Promise((done) => server.close(done)))); }
}

function assertPlainTree(path) {
  if (lstatSync(path).isSymbolicLink()) throw new Error("local_staff_source_symlink");
  if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) assertPlainTree(resolve(path, entry));
}

// CLI global --workdir is documented at https://supabase.com/docs/reference/cli/getting-started.
// Copy only versioned schema/templates; never local .env, credentials, or CLI .temp state.
export async function createLocalStaffWorkdir(repoRoot, destination, appOrigin) {
  const sourceRoot = resolve(realpathSync(repoRoot), "supabase");
  const target = resolve(destination);
  if (existsSync(target) || basename(target) !== "local-supabase"
    || !/^evo-(?:database-foundation|platform-provider-acceptance)\.[A-Za-z0-9]+$/u.test(basename(realpathSync(dirname(target))))) {
    throw new Error("local_staff_destination_invalid");
  }
  const projectId = `evo-local-${randomBytes(8).toString("hex")}`;
  const origin = staffLoopbackOrigin(appOrigin);
  assertPlainTree(resolve(sourceRoot, "config.toml"));
  const config = localStaffConfig(readFileSync(resolve(sourceRoot, "config.toml"), "utf8"), origin, projectId, await allocatePorts(Number(new URL(origin).port)));
  mkdirSync(resolve(target, "supabase"), { recursive: true, mode: 0o700 });
  for (const name of ["migrations", "templates"]) {
    const source = resolve(sourceRoot, name); assertPlainTree(source);
    cpSync(source, resolve(target, "supabase", name), { recursive: true, errorOnExist: true, force: false });
  }
  writeFileSync(resolve(target, "supabase/config.toml"), stringify(config), { mode: 0o600, flag: "wx" });
  return { workdir: realpathSync(target), projectId, mailpitOrigin: `http://127.0.0.1:${config.local_smtp.port}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error("local_staff_workdir_arguments");
    const result = await createLocalStaffWorkdir(process.argv[2], process.argv[3], process.argv[4]);
    process.stdout.write(`${result.mailpitOrigin}\n`);
  } catch { process.stderr.write("LOCAL_STAFF_WORKDIR_FAILED\n"); process.exitCode = 1; }
}
