#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export const FAST_RELEASE_REQUIRED_CHECKS = Object.freeze([
  "Main CRM",
  "EVO Inbox",
  "EVO Lead Agent",
]);

export function validateFastReleaseChecks(payload) {
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  const missing = FAST_RELEASE_REQUIRED_CHECKS.filter((name) => {
    const matches = runs.filter((run) => run?.name === name);
    return matches.length === 0 || !matches.every((run) =>
      run?.status === "completed" &&
      run?.conclusion === "success" &&
      run?.app?.slug === "github-actions");
  });
  if (missing.length > 0) throw new Error("required exact-SHA CI is not green");
  return { ok: true, requiredChecks: FAST_RELEASE_REQUIRED_CHECKS };
}

export async function verifyFastReleaseCi({ repository, revision, token, fetchImpl = fetch }) {
  if (!REPOSITORY.test(repository) || !SHA40.test(revision) || typeof token !== "string" || token.length < 1) {
    throw new Error("invalid CI gate configuration");
  }
  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/commits/${revision}/check-runs?filter=latest&per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("GitHub CI lookup failed");
  return validateFastReleaseChecks(await response.json());
}

async function main() {
  const result = await verifyFastReleaseCi({
    repository: process.env.GITHUB_REPOSITORY ?? "",
    revision: process.env.EVO_RELEASE_REVISION ?? "",
    token: process.env.GITHUB_TOKEN ?? "",
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("exact-SHA CI gate failed\n");
    process.exitCode = 2;
  });
}
