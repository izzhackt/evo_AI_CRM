import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
function command(file, args, capture = false) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Source runtime check failed: ${file}`);
  return result.stdout?.trim();
}
if (process.platform === "darwin") {
  if (command("orb", ["status"], true) !== "Running" || command("docker", ["context", "show"], true) !== "orbstack") {
    throw new Error("OrbStack Running/orbstack is required; no alternative engine is permitted");
  }
}
const image = "evo-document-source-runtime:isolated-proof";
command("docker", ["build", "--target", "document-source-runtime-test", "-t", image, "."]);
command("docker", ["run", "--rm", "--init", "--network", "none", "--read-only", "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "3g",
  "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m,mode=1777", image]);
