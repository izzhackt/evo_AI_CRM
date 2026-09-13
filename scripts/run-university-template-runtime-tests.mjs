import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
function command(file, args, capture = false) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Template runtime check failed: ${file}`);
  return result.stdout?.trim();
}
function preflight() {
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("Local Docker socket required");
  if (process.platform === "darwin" && command("orb", ["status"], true) !== "Running") throw new Error("OrbStack Running required");
  const context = command("docker", ["context", "show"], true);
  if (process.platform === "darwin" && context !== "orbstack") throw new Error("OrbStack context required");
  if (!command("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"], true).startsWith("unix://")) throw new Error("Local Docker socket required");
}
const suffix = randomUUID().replaceAll("-", ""), image = `evo-university-template-runtime:proof-${suffix}`;
const container = `evo-university-template-proof-${suffix}`;
preflight();
command("docker", ["build", "--target", "university-template-runtime-test", "-t", image, "."]);
preflight();
const imageId = command("docker", ["image", "inspect", image, "--format", "{{.Id}}"], true);
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Invalid immutable image ID");
process.stdout.write(`Native template image: ${imageId}\n`);
try {
  preflight();
  command("docker", ["run", "--rm", "--name", container, "--init", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "3g",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777", imageId]);
} finally {
  preflight();
  const remaining = command("docker", ["ps", "-aq", "--filter", `name=^/${container}$`], true);
  if (remaining) { preflight(); command("docker", ["rm", "-f", container]); }
  preflight();
  if (command("docker", ["ps", "-aq", "--filter", `name=^/${container}$`], true)) throw new Error("Owned container cleanup failed");
  process.stdout.write(`Owned container cleanup verified: ${container}\n`);
}
