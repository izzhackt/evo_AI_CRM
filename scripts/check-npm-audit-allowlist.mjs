import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const policyPath = resolve(repositoryRoot, "config/npm-audit-allowlist.json");
const lockfilePath = resolve(process.cwd(), "package-lock.json");

function fail(message) {
  console.error(`npm development audit rejected: ${message}`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is missing or invalid JSON at ${path}: ${error.message}`);
  }
}

function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1) {
    fail("allowlist schemaVersion must be exactly 1");
  }
  if (typeof policy.owner !== "string" || policy.owner.trim() === "") {
    fail("allowlist owner must be a non-empty string");
  }
  if (typeof policy.reason !== "string" || policy.reason.trim() === "") {
    fail("allowlist reason must be a non-empty string");
  }
  if (!Array.isArray(policy.allowedAdvisories)) {
    fail("allowedAdvisories must be an array");
  }

  // An empty allowlist is the healthy state, not a broken one: no exception is
  // being claimed, so there is nothing for a reviewer to revisit and no
  // deadline to expire. The audit below must then come back completely clean.
  //
  // Requiring both a future reviewBy and a non-empty list made that state
  // unexpressible, so once the advisory was actually fixed the only way to
  // keep CI green was to keep claiming an exception nobody needed -- and when
  // the date passed, every pull request and every push to main went red for a
  // vulnerability that no longer exists.
  if (policy.allowedAdvisories.length === 0) {
    // Same shape as the populated path, so a finding that turns up anyway is
    // reported as "not covered by the allowlist" rather than crashing on a
    // missing map.
    return { ...policy, advisoriesByUrl: new Map() };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.reviewBy ?? "")) {
    fail("allowlist reviewBy must use YYYY-MM-DD");
  }

  const reviewDeadline = new Date(`${policy.reviewBy}T23:59:59.999Z`);
  if (
    Number.isNaN(reviewDeadline.getTime()) ||
    reviewDeadline.toISOString().slice(0, 10) !== policy.reviewBy
  ) {
    fail("allowlist reviewBy is not a real calendar date");
  }
  if (Date.now() > reviewDeadline.getTime()) {
    fail(`allowlist expired on ${policy.reviewBy}`);
  }

  const advisoriesByUrl = new Map();
  for (const advisory of policy.allowedAdvisories) {
    if (
      typeof advisory?.url !== "string" ||
      typeof advisory.package !== "string" ||
      typeof advisory.severity !== "string" ||
      typeof advisory.range !== "string" ||
      !Array.isArray(advisory.allowedAffectedPackages) ||
      advisory.allowedAffectedPackages.length === 0 ||
      !advisory.allowedGraph ||
      typeof advisory.allowedGraph !== "object"
    ) {
      fail(
        "each allowed advisory must define url, package, severity, range, " +
          "allowedAffectedPackages, and allowedGraph",
      );
    }
    if (advisoriesByUrl.has(advisory.url)) {
      fail(`duplicate advisory URL in allowlist: ${advisory.url}`);
    }

    const affectedPackages = new Set(advisory.allowedAffectedPackages);
    if (affectedPackages.size !== advisory.allowedAffectedPackages.length) {
      fail(`duplicate affected package in allowlist for ${advisory.url}`);
    }
    if (!affectedPackages.has(advisory.package)) {
      fail(`direct package ${advisory.package} is absent from its affected-package list`);
    }

    const graphPackages = new Set(Object.keys(advisory.allowedGraph));
    if (
      graphPackages.size !== affectedPackages.size ||
      [...affectedPackages].some((name) => !graphPackages.has(name))
    ) {
      fail(`allowedGraph keys do not match allowedAffectedPackages for ${advisory.url}`);
    }
    for (const [name, edges] of Object.entries(advisory.allowedGraph)) {
      if (!Array.isArray(edges?.viaPackages) || !Array.isArray(edges?.allowedEffects)) {
        fail(`allowedGraph entry ${name} must define viaPackages and allowedEffects arrays`);
      }
      if (
        new Set(edges.viaPackages).size !== edges.viaPackages.length ||
        new Set(edges.allowedEffects).size !== edges.allowedEffects.length
      ) {
        fail(`allowedGraph entry ${name} contains duplicate edges`);
      }
      for (const edge of [...edges.viaPackages, ...edges.allowedEffects]) {
        if (!affectedPackages.has(edge)) {
          fail(`allowedGraph entry ${name} references unknown package ${edge}`);
        }
      }
    }

    advisoriesByUrl.set(advisory.url, {
      ...advisory,
      affectedPackages,
    });
  }

  return {
    ...policy,
    advisoriesByUrl,
  };
}

function runAudit() {
  const npmBin = process.env.EVO_NPM_BIN?.trim() || "npm";
  const result = spawnSync(
    npmBin,
    ["audit", "--package-lock-only", "--include=dev", "--json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.error) {
    fail(`npm audit could not start: ${result.error.message}`);
  }
  if (typeof result.stdout !== "string" || result.stdout.trim() === "") {
    fail(`npm audit returned no JSON${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    fail(`npm audit returned malformed JSON: ${error.message}`);
  }

  if (report?.error) {
    fail(`npm audit reported an execution error: ${JSON.stringify(report.error)}`);
  }
  if (report?.auditReportVersion !== 2) {
    fail(`unsupported npm audit report version ${String(report?.auditReportVersion)}`);
  }
  if (!report?.vulnerabilities || typeof report.vulnerabilities !== "object") {
    fail("npm audit report has no vulnerabilities object");
  }
  if (!report?.metadata?.vulnerabilities) {
    fail("npm audit report has no vulnerability metadata");
  }

  const vulnerabilityNames = Object.keys(report.vulnerabilities);
  const reportedTotal = report.metadata.vulnerabilities.total;
  if (!Number.isInteger(reportedTotal) || reportedTotal !== vulnerabilityNames.length) {
    fail(
      `npm audit metadata total ${String(reportedTotal)} does not match ` +
        `${vulnerabilityNames.length} vulnerability entries`,
    );
  }
  if (vulnerabilityNames.length === 0) {
    if (result.status !== 0) {
      fail(`npm audit exited ${String(result.status)} despite an empty report`);
    }
    return report;
  }
  if (result.status !== 1) {
    fail(`npm audit exited ${String(result.status)} while reporting vulnerabilities`);
  }

  return report;
}

function collectLeafAdvisories(name, vulnerabilities, stack = new Set()) {
  if (stack.has(name)) {
    fail(`cyclic vulnerability chain detected at ${name}`);
  }

  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    fail(`vulnerability ${name} has no resolvable via chain`);
  }

  const nextStack = new Set(stack);
  nextStack.add(name);
  const leaves = [];

  for (const source of vulnerability.via) {
    if (typeof source === "string") {
      if (!vulnerabilities[source]) {
        fail(`vulnerability ${name} references missing dependency ${source}`);
      }
      leaves.push(...collectLeafAdvisories(source, vulnerabilities, nextStack));
      continue;
    }
    if (!source || typeof source !== "object" || typeof source.url !== "string") {
      fail(`vulnerability ${name} contains an invalid advisory source`);
    }
    leaves.push(source);
  }

  return leaves;
}

function verifyDevOnlyNodes(name, vulnerability, lockfile) {
  if (!Array.isArray(vulnerability.nodes) || vulnerability.nodes.length === 0) {
    fail(`vulnerability ${name} has no package-lock nodes`);
  }

  for (const nodePath of vulnerability.nodes) {
    const lockedPackage = lockfile?.packages?.[nodePath];
    if (!lockedPackage) {
      fail(`vulnerability ${name} references unknown lockfile node ${nodePath}`);
    }
    if (lockedPackage.dev !== true) {
      fail(`vulnerability ${name} reaches non-development node ${nodePath}`);
    }
  }
}

function assertSameSet(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expected.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some((value) => !expectedSet.has(value))
  ) {
    fail(
      `${label} changed: expected [${[...expectedSet].join(", ")}], ` +
        `received [${[...actualSet].join(", ")}]`,
    );
  }
}

function assertSubset(actual, allowed, label) {
  const actualSet = new Set(actual);
  const allowedSet = new Set(allowed);
  if (
    actualSet.size !== actual.length ||
    actualSet.size > allowedSet.size ||
    [...actualSet].some((value) => !allowedSet.has(value))
  ) {
    fail(
      `${label} changed: allowed [${[...allowedSet].join(", ")}], ` +
        `received [${[...actualSet].join(", ")}]`,
    );
  }
}

function verifyAllowedGraph(name, vulnerability, allowed) {
  const expected = allowed.allowedGraph[name];
  if (!expected) {
    fail(`advisory ${allowed.url} has no graph contract for ${name}`);
  }

  const viaPackages = vulnerability.via.filter((source) => typeof source === "string");
  const directAdvisories = vulnerability.via.filter(
    (source) => source && typeof source === "object",
  );
  assertSameSet(viaPackages, expected.viaPackages, `${name} via-package edges`);
  assertSubset(
    vulnerability.effects ?? [],
    expected.allowedEffects,
    `${name} effect edges`,
  );

  if (name === allowed.package) {
    if (directAdvisories.length !== 1 || viaPackages.length !== 0) {
      fail(`${name} must contain exactly one direct advisory and no via-package edge`);
    }
    if (directAdvisories[0].url !== allowed.url) {
      fail(`${name} direct advisory URL changed to ${String(directAdvisories[0].url)}`);
    }
  } else if (directAdvisories.length !== 0) {
    fail(`meta-vulnerability ${name} unexpectedly contains a direct advisory`);
  }
}

const policy = validatePolicy(readJson(policyPath, "allowlist"));
const lockfile = readJson(lockfilePath, "package lock");
if (!lockfile?.packages || typeof lockfile.packages !== "object") {
  fail("package lock has no packages map");
}

const report = runAudit();
const vulnerabilityNames = Object.keys(report.vulnerabilities);
if (vulnerabilityNames.length === 0) {
  console.log(`npm development audit passed with zero vulnerabilities in ${process.cwd()}`);
  process.exit(0);
}

const acceptedAdvisories = new Set();
for (const name of vulnerabilityNames) {
  const vulnerability = report.vulnerabilities[name];
  verifyDevOnlyNodes(name, vulnerability, lockfile);

  const leafAdvisories = collectLeafAdvisories(name, report.vulnerabilities);
  if (leafAdvisories.length === 0) {
    fail(`vulnerability ${name} has no direct advisory leaf`);
  }

  for (const leaf of leafAdvisories) {
    const allowed = policy.advisoriesByUrl.get(leaf.url);
    if (!allowed) {
      fail(`unapproved advisory ${leaf.url} reaches ${name}`);
    }
    if (leaf.name !== allowed.package || leaf.dependency !== allowed.package) {
      fail(`advisory ${leaf.url} has unexpected package identity for ${name}`);
    }
    if (leaf.severity !== allowed.severity) {
      fail(`advisory ${leaf.url} changed severity from ${allowed.severity} to ${leaf.severity}`);
    }
    if (leaf.range !== allowed.range) {
      fail(`advisory ${leaf.url} changed range from ${allowed.range} to ${String(leaf.range)}`);
    }
    if (!allowed.affectedPackages.has(name)) {
      fail(`advisory ${leaf.url} reaches unapproved package ${name}`);
    }
    verifyAllowedGraph(name, vulnerability, allowed);
    acceptedAdvisories.add(leaf.url);
  }
}

console.warn(
  [
    `npm development audit accepted ${vulnerabilityNames.length} known package findings`,
    `in ${process.cwd()}.`,
    `Allowed advisory: ${[...acceptedAdvisories].join(", ")}.`,
    `Owner: ${policy.owner}. Review by: ${policy.reviewBy}.`,
  ].join(" "),
);
