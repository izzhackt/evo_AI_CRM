#!/usr/bin/env node

/**
 * Read-only deployment verification.
 *
 * Answers one question in a single run: does what is deployed match what was
 * intended. It inspects container identity, health and restart count on the
 * host, and confirms the public HTTP surfaces still answer. It changes
 * nothing.
 *
 * Deliberate boundaries:
 *   - no container, session, configuration, migration or DNS is modified;
 *   - no secret file is read and no secret value is printed;
 *   - no private filesystem path enters the output;
 *   - a mismatch exits non-zero so the check cannot be mistaken for a pass.
 *
 * The comparison logic is pure and exported, so it is tested without a host.
 *
 *   node scripts/verify-deployment.mjs --revision <40-hex> [--host hermes-vps]
 */

import { execFileSync } from "node:child_process";

export const EXPECTED_SERVICES = Object.freeze([
  "evo-crm-app-1",
  "evo-crm-waha-1",
  "evo-crm-lead-agent-1",
  "evo-inbox-app-1",
  "evo-inbox-waha",
]);

export const PUBLIC_HEALTH_URLS = Object.freeze([
  "https://evo-crm.72.62.119.112.sslip.io/login",
  "https://evo-inbox.72.62.119.112.sslip.io/login",
]);

const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const REVISION_LABEL = "org.opencontainers.image.revision";

/** Services whose image is a preserved third-party digest, not an EVO build. */
const PRESERVED_IMAGE_SERVICES = Object.freeze(["evo-crm-waha-1", "evo-inbox-waha"]);

export function parseRevision(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return REVISION_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Compares one observed container against what a healthy deployment requires.
 * Returns a list of findings; an empty list means the container is as expected.
 */
export function checkContainer(observed, expectedRevision) {
  const findings = [];
  if (!observed || typeof observed !== "object") {
    return ["container was not observed"];
  }
  if (observed.state !== "running") {
    findings.push(`state is ${observed.state ?? "unknown"}, expected running`);
  }
  // A container without a health check reports no status. That is not a
  // failure by itself, but "unhealthy" always is.
  if (observed.health === "unhealthy") findings.push("health is unhealthy");
  if (observed.restarts !== 0) {
    findings.push(`restart count is ${observed.restarts}, expected 0`);
  }
  if (PRESERVED_IMAGE_SERVICES.includes(observed.name)) {
    // WAHA images are a preservation boundary: they intentionally do not carry
    // an EVO revision, so requiring one would report a false mismatch.
    return findings;
  }
  if (observed.revision !== expectedRevision) {
    findings.push(
      `revision is ${observed.revision ?? "absent"}, expected ${expectedRevision}`,
    );
  }
  return findings;
}

export function summarize(observedByName, expectedRevision) {
  const services = EXPECTED_SERVICES.map((name) => ({
    name,
    findings: checkContainer(observedByName[name], expectedRevision),
  }));
  const failing = services.filter((service) => service.findings.length > 0);
  return Object.freeze({
    services,
    failing,
    ok: failing.length === 0,
  });
}

function readContainers(host) {
  // One remote command, output parsed here rather than shaped remotely, so the
  // remote side stays a plain read.
  const format = [
    "{{.Name}}",
    "{{.State.Status}}",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    "{{.RestartCount}}",
    `{{index .Config.Labels "${REVISION_LABEL}"}}`,
  ].join("|");
  const raw = execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      host,
      "docker",
      "inspect",
      "--format",
      format,
      ...EXPECTED_SERVICES,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  const byName = {};
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const [name, state, health, restarts, revision] = line.split("|");
    byName[name?.replace(/^\//u, "") ?? ""] = {
      name: name?.replace(/^\//u, "") ?? "",
      state,
      health,
      restarts: Number.parseInt(restarts ?? "", 10),
      revision: revision && revision !== "<no value>" ? revision : null,
    };
  }
  return byName;
}

function readPublicStatus(url) {
  try {
    const raw = execFileSync(
      "curl",
      ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "15", url],
      { encoding: "utf8", timeout: 30_000 },
    );
    return Number.parseInt(raw.trim(), 10);
  } catch {
    return null;
  }
}

function parseArguments(argv) {
  const parsed = { host: "hermes-vps", revision: null };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--revision") parsed.revision = value;
    else if (key === "--host") parsed.host = value;
    else return { error: `unknown argument: ${key}` };
  }
  if (!parsed.revision) return { error: "--revision is required" };
  const revision = parseRevision(parsed.revision);
  if (!revision) return { error: "--revision must be a 40-character commit SHA" };
  return { host: parsed.host, revision };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.error) {
    console.error(`verify-deployment: ${args.error}`);
    process.exit(2);
  }

  let observed;
  try {
    observed = readContainers(args.host);
  } catch {
    // The host could not be read. That is reported as an inconclusive run
    // rather than a pass or a failure of the deployment itself.
    console.error("verify-deployment: the host could not be inspected");
    process.exit(3);
  }

  const result = summarize(observed, args.revision);
  console.log(`expected revision: ${args.revision}`);
  for (const service of result.services) {
    if (service.findings.length === 0) {
      console.log(`  ok       ${service.name}`);
    } else {
      console.log(`  MISMATCH ${service.name}`);
      for (const finding of service.findings) console.log(`             ${finding}`);
    }
  }

  let publicOk = true;
  for (const url of PUBLIC_HEALTH_URLS) {
    const status = readPublicStatus(url);
    if (status === 200) {
      console.log(`  ok       ${url}`);
    } else {
      publicOk = false;
      console.log(`  MISMATCH ${url} returned ${status ?? "no response"}`);
    }
  }

  if (!result.ok || !publicOk) {
    console.error("verify-deployment: deployment does not match the intent");
    process.exit(1);
  }
  console.log("verify-deployment: deployed state matches the intent");
}

if (process.argv[1] && process.argv[1].endsWith("verify-deployment.mjs")) main();
