import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const digest = `sha256:${"a".repeat(64)}`;
const env = {
  ...process.env,
  EVO_RELEASE_REVISION: revision,
  EVO_RELEASE_VERSION: "validation",
  EVO_WAHA_IMAGE_DIGEST: digest,
  EVO_CADDY_IMAGE_DIGEST: digest,
  NEXT_PUBLIC_SUPABASE_URL: "https://validation.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "validation-public-key",
  NEXT_PUBLIC_SITE_URL: "https://inbox.evoadmissions.com",
  EVO_CRM_APP_ENV_FILE: "/dev/null",
  EVO_CRM_WAHA_ENV_FILE: "/dev/null",
  EVO_CRM_LEAD_AGENT_ENV_FILE: "/dev/null",
  EVO_INBOX_APP_ENV_FILE: "/dev/null",
  EVO_INBOX_WAHA_ENV_FILE: "/dev/null",
};

const files = [
  "docker-compose.prod.yml",
  "agent-lead2-inbox/deploy/docker-compose.inbox.prod.yml",
  "agent-lead2-inbox/deploy/docker-compose.edge.yml",
];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /image:\s*["']?[^@\n"']+:latest/i);
  for (const key of ["mem_limit:", "cpus:", "pids_limit:", "logging:"]) {
    assert.match(source, new RegExp(key), `${file} is missing ${key}`);
  }
}

if (process.argv.includes("--compose")) {
  for (const file of files) {
    execFileSync("docker", ["compose", "-f", file, "config", "--quiet"], {
      env,
      stdio: "inherit",
    });
  }
}

console.log(JSON.stringify({ ok: true, checked: files }));
