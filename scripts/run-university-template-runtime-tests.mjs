import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = fileURLToPath(new URL("..", import.meta.url));
function command(file, args, capture = false) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Template runtime check failed: ${file}`);
  return result.stdout?.trim();
}
function preflight() {
  if (!["arm64", "x64"].includes(process.arch)) throw new Error("Native arm64/x64 host required");
  if (process.arch === "arm64" && process.platform !== "darwin") throw new Error("arm64 proofs require native OrbStack on macOS");
  if (process.platform === "darwin" && process.arch !== "arm64") throw new Error("Native arm64 OrbStack required; no emulation");
  const expected = process.arch === "x64" ? "amd64" : "arm64";
  if (process.env.DOCKER_DEFAULT_PLATFORM && process.env.DOCKER_DEFAULT_PLATFORM !== `linux/${expected}`) throw new Error("Foreign/emulated Docker platform is forbidden");
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("Local Docker socket required");
  if (process.platform === "darwin" && command("orb", ["status"], true) !== "Running") throw new Error("OrbStack Running required");
  const context = command("docker", ["context", "show"], true);
  if (process.platform === "darwin" && context !== "orbstack") throw new Error("OrbStack context required");
  const endpoint = command("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"], true);
  if (!endpoint.startsWith("unix://") || (process.env.DOCKER_HOST && process.env.DOCKER_HOST !== endpoint)) throw new Error("Exact local context socket required");
  const architecture = command("docker", ["info", "--format", "{{.OSType}} {{.Architecture}}"], true);
  if (architecture !== `linux ${expected}` && architecture !== `linux ${expected === "arm64" ? "aarch64" : "x86_64"}`) throw new Error("Native Docker engine architecture required; no emulation");
}
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--compatibility-only")) throw new Error("Usage: runner [--compatibility-only]");
const compatibilityOnly = process.argv[2] === "--compatibility-only";
const suffix = randomUUID().replaceAll("-", ""), image = `evo-university-template-runtime:proof-${suffix}`;
const container = `evo-university-template-proof-${suffix}`;
const artifacts = mkdtempSync(join(tmpdir(), "evo-university-template-png-"));
// Only synthetic outputs; UID1001 in the test harness needs this dedicated bind.
// The sealed child cannot access it: Landlock still allows only runtime assets.
chmodSync(artifacts, 0o1777);
preflight();
command("docker", ["build", "--target", "university-template-runtime-test", "-t", image, "."]);
preflight();
const imageId = command("docker", ["image", "inspect", image, "--format", "{{.Id}}"], true);
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Invalid immutable image ID");
preflight();
if (command("docker", ["image", "inspect", imageId, "--format", "{{.Architecture}}"], true) !== (process.arch === "x64" ? "amd64" : "arm64")) throw new Error("Foreign image architecture forbidden");
process.stdout.write(`Native template image: ${imageId}\n`);
try {
  preflight();
  command("docker", ["run", "--name", container, "--init", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "3g",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777",
    "--mount", `type=bind,source=${artifacts},target=/proof-output`, imageId,
    "node", "--test", ...(compatibilityOnly ? ["--test-name-pattern=actual post-seal canvas compatibility"] : []),
    "/opt/evo-university-template-runtime/test-harness.mjs"]);
} finally {
  preflight();
  const remaining = command("docker", ["ps", "-aq", "--filter", `name=^/${container}$`], true);
  if (remaining) { preflight(); command("docker", ["rm", "-f", container]); }
  preflight();
  if (command("docker", ["ps", "-aq", "--filter", `name=^/${container}$`], true)) throw new Error("Owned container cleanup failed");
  process.stdout.write(`Owned container cleanup verified: ${container}\n`);
  process.stdout.write(`Synthetic PNG artifacts: ${artifacts}\n`);
}
