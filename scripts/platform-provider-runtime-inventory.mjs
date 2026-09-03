#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMPTZ =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/u;
const HISTORICAL_ROOTS = Object.freeze([
  "agent-lead2-inbox/",
  "deploy/",
  "docs/",
  "drizzle/",
  "evo-lead-agent/",
  "output/",
  "supabase/",
]);
const HISTORICAL_FILES = new Set([
  "AGENTS.md",
  "CONTEXT.md",
  "CONTRIBUTING.md",
  "README.md",
  "docker-compose.prod.yml",
  "docker-compose.staging.yml",
]);
const GUARD_ROOTS = Object.freeze(["tests/"]);
const SCAN_IGNORED_DIRECTORIES = new Set([".git", ".next", "node_modules", "output"]);
const SECRET_LIKE_KEY = /(?:secret|token|api[_-]?key|cookie|password|session(?:_|-)?data|credential|raw(?:_|-)?payload|transcript|chat(?:_|-)?id|recipient|provider(?:_|-)?message(?:_|-)?id|source(?:_|-)?message(?:_|-)?id|phone|email)/iu;
const SECRET_LIKE_VALUE = [
  /Bearer\s+[A-Za-z0-9._-]{12,}/u,
  /(?:^|[^A-Za-z0-9])[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}(?:$|[^A-Za-z0-9])/u,
  /\+?\d{9,15}/u,
  /@c\.us\b/iu,
  /[A-Za-z0-9_-]{24,}/u,
];
const ALLOWED_LONG_STRING = /^(?:[a-z0-9_-]+|[a-f0-9]{40}|[a-f0-9]{64}|platform-provider-runtime-[a-z-]+)$/u;

export const DEFAULT_SCAN_RULES = Object.freeze([
  Object.freeze({
    id: "forbidden_waha_fallback_alias",
    pattern: "evo-inbox",
    description:
      "Active runtime must not select or fall back to the historical evo-inbox WAHA session.",
  }),
]);

function fail(message, code = "invalid_provider_runtime_inventory") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} keys drifted`);
  }
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMPTZ.test(value)) {
    fail(`${label} must be an ISO timestamp`);
  }
}

function assertSha40(value, label) {
  if (typeof value !== "string" || !SHA40.test(value)) fail(`${label} must be a git SHA`);
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(repoRoot, path) {
  const repoReal = realpathSync(repoRoot);
  const pathReal = realpathSync(path);
  if (pathReal !== repoReal && !pathReal.startsWith(`${repoReal}${sep}`)) {
    fail(`${basename(path)} must stay within the repo root`);
  }
  return relative(repoReal, pathReal).replaceAll("\\", "/");
}

function readJsonFile(path, label) {
  const body = readFileSync(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  return { body, parsed };
}

function assertSafeString(value, label) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (SAFE_PATH.test(value)) return;
  fail(`${label} contains unsafe characters`);
}

function assertNoSecretLikeData(value, label = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeData(item, `${label}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_LIKE_KEY.test(key)) fail(`${label}.${key} looks secret-like`);
      assertNoSecretLikeData(nested, `${label}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (TIMESTAMPTZ.test(value) || SHA40.test(value) || SHA256.test(value)) return;
  for (const pattern of SECRET_LIKE_VALUE) {
    if (pattern.test(value) && !ALLOWED_LONG_STRING.test(value)) {
      fail(`${label} contains sensitive-looking data`);
    }
  }
}

function assertReadOnlySection(value, label, options = {}) {
  const { configuredType = "boolean" } = options;
  exactKeys(value, ["configured", "observedReadOnly", "mutationAttempted"], label);
  if (
    (configuredType === "boolean" && typeof value.configured !== "boolean") ||
    (configuredType === "string" &&
      value.configured !== "configured" &&
      value.configured !== "blocked")
  ) {
    fail(`${label}.configured drifted`);
  }
  if (value.observedReadOnly !== true) fail(`${label}.observedReadOnly must be true`);
  if (value.mutationAttempted !== false) fail(`${label}.mutationAttempted must be false`);
}

export function validateRemoteEvidence(value, expectedSha) {
  exactKeys(
    value,
    ["schemaVersion", "kind", "gitSha", "observedAt", "waha", "amocrm", "gemini"],
    "remote evidence",
  );
  if (value.schemaVersion !== 1) fail("remote evidence schemaVersion drifted");
  if (value.kind !== "platform-provider-runtime-remote-readiness") {
    fail("remote evidence kind drifted");
  }
  assertSha40(value.gitSha, "remote evidence gitSha");
  if (value.gitSha !== expectedSha) fail("remote evidence gitSha mismatch");
  assertTimestamp(value.observedAt, "remote evidence observedAt");
  assertNoSecretLikeData(value, "remote evidence");

  exactKeys(
    value.waha,
    [
      "selectedSession",
      "status",
      "observedReadOnly",
      "fallbackObserved",
      "wrongSessionObserved",
      "mutationAttempted",
    ],
    "remote evidence waha",
  );
  if (value.waha.selectedSession !== "crm_primary") fail("remote evidence selected the wrong WAHA session");
  if (value.waha.status !== "WORKING") fail("remote evidence WAHA status must be WORKING");
  if (value.waha.observedReadOnly !== true) fail("remote evidence WAHA must be read-only");
  if (value.waha.fallbackObserved !== false) fail("remote evidence fallbackObserved must be false");
  if (value.waha.wrongSessionObserved !== false) fail("remote evidence wrongSessionObserved must be false");
  if (value.waha.mutationAttempted !== false) fail("remote evidence mutationAttempted must be false");

  assertReadOnlySection(value.amocrm, "remote evidence amocrm");
  assertReadOnlySection(value.gemini, "remote evidence gemini");

  return Object.freeze(value);
}

export function validateBrowserEvidence(value, expectedSha) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "kind",
      "status",
      "gitSha",
      "completedAt",
      "routes",
      "boundaries",
    ],
    "browser evidence",
  );
  if (value.schemaVersion !== 1) fail("browser evidence schemaVersion drifted");
  if (value.kind !== "evo-v2-provider-browser-readonly") {
    fail("browser evidence kind drifted");
  }
  if (value.status !== "passed") fail("browser evidence status drifted");
  assertSha40(value.gitSha, "browser evidence gitSha");
  if (value.gitSha !== expectedSha) fail("browser evidence gitSha mismatch");
  assertTimestamp(value.completedAt, "browser evidence completedAt");
  assertNoSecretLikeData(value, "browser evidence");

  exactKeys(
    value.routes,
    ["salesWhatsApp", "adminSales", "adminAdmissions"],
    "browser evidence routes",
  );

  const assertPageProof = (page, expected) => {
    exactKeys(page, ["route", "authorityRole", "checks", "statuses"], expected.label);
    if (page.route !== expected.route) fail(`${expected.label}.route drifted`);
    if (page.authorityRole !== expected.role) fail(`${expected.label}.authorityRole drifted`);
    exactKeys(page.checks, expected.checkKeys, `${expected.label}.checks`);
    for (const required of expected.requiredChecks) {
      if (page.checks[required] !== true) fail(`${expected.label}.${required} must be true`);
    }
    for (const [key, nestedValue] of Object.entries(page.checks)) {
      if (typeof nestedValue !== "boolean") fail(`${expected.label}.${key} must be boolean`);
    }
    exactKeys(page.statuses, expected.statusKeys, `${expected.label}.statuses`);
  };

  assertPageProof(value.routes.salesWhatsApp, {
    label: "browser evidence sales WhatsApp",
    route: "/whatsapp/:conversationId",
    role: "sales",
    checkKeys: [
      "pageVisible",
      "threadVisible",
      "controlsVisible",
      "sendVisible",
      "reconcileRendered",
    ],
    requiredChecks: ["pageVisible", "threadVisible", "controlsVisible", "sendVisible"],
    statusKeys: ["sendDisabled"],
  });
  if (value.routes.salesWhatsApp.statuses.sendDisabled !== "true") {
    fail("browser evidence WhatsApp send must fail closed");
  }

  for (const [key, route, scope] of [
    ["adminSales", "/sales/:leadId", "sales"],
    ["adminAdmissions", "/clients/:studentCaseId", "admissions"],
  ]) {
    const page = value.routes[key];
    assertPageProof(page, {
      label: `browser evidence ${key}`,
      route,
      role: "admin",
      checkKeys: ["workspaceVisible", "panelVisible", "formVisible", "syncVisible"],
      requiredChecks: ["workspaceVisible", "panelVisible", "formVisible", "syncVisible"],
      statusKeys: ["panelScope", "providerAvailability", "syncDisabled"],
    });
    if (page.statuses.panelScope !== scope) fail(`browser evidence ${key} scope drifted`);
    if (page.statuses.providerAvailability !== "blocked") {
      fail(`browser evidence ${key} provider must be blocked`);
    }
    if (page.statuses.syncDisabled !== "true") {
      fail(`browser evidence ${key} sync must fail closed`);
    }
  }

  exactKeys(
    value.boundaries,
    [
      "liveGeminiCall",
      "liveWhatsAppSend",
      "liveAmoCrmWrite",
      "clickedProviderMutationControl",
      "v1RuntimeUsed",
    ],
    "browser evidence boundaries",
  );
  for (const [key, nestedValue] of Object.entries(value.boundaries)) {
    if (nestedValue !== false) fail(`browser evidence ${key} must be false`);
  }

  return Object.freeze(value);
}

export function validateDatabaseEvidence(value, expectedSha) {
  exactKeys(
    value,
    [
      "schemaVersion",
      "kind",
      "status",
      "gitSha",
      "completedAt",
      "authority",
      "syntheticTargetsVerified",
      "countsBefore",
      "countsAfter",
      "exactEquality",
      "boundaries",
    ],
    "database evidence",
  );
  if (value.schemaVersion !== 1) fail("database evidence schemaVersion drifted");
  if (value.kind !== "evo-v2-provider-database-readonly") {
    fail("database evidence kind drifted");
  }
  if (value.status !== "passed") fail("database evidence status drifted");
  assertSha40(value.gitSha, "database evidence gitSha");
  if (value.gitSha !== expectedSha) fail("database evidence gitSha mismatch");
  assertTimestamp(value.completedAt, "database evidence completedAt");
  if (value.authority !== "local_supabase_postgresql") {
    fail("database evidence authority drifted");
  }
  if (value.syntheticTargetsVerified !== true) {
    fail("database evidence synthetic targets were not verified");
  }
  if (value.exactEquality !== true) fail("database evidence exact equality failed");
  assertNoSecretLikeData(value, "database evidence");

  const countKeys = [
    "aiDraftEventCount",
    "auditEventCount",
    "amoCrmAttemptCount",
    "amoCrmContactBindingCount",
    "amoCrmDiscoveryCount",
    "amoCrmLeadBindingCount",
    "amoCrmReceiptCount",
    "communicationMessageCount",
    "durableWorkAttemptCount",
    "durableWorkEventCount",
    "durableWorkItemCount",
    "geminiProposalReceiptCount",
    "geminiProposalRequestCount",
    "geminiProposalResultCount",
    "geminiReviewCount",
    "manualSendAuthorizationCount",
    "manualSendProviderBindingCount",
    "manualSendRuntimeBindingCount",
    "manualWhatsAppReconciliationRequestCount",
    "manualWhatsAppReconciliationResultCount",
    "providerReconciliationEventCount",
    "providerWebhookEventCount",
    "sessionHealthCount",
    "wahaMessageBindingCount",
    "wahaObservationCount",
    "workReviewEventCount",
  ];
  for (const [label, counts] of [
    ["database evidence countsBefore", value.countsBefore],
    ["database evidence countsAfter", value.countsAfter],
  ]) {
    exactKeys(counts, countKeys, label);
    for (const [key, nestedValue] of Object.entries(counts)) {
      assertNonNegativeInteger(nestedValue, `${label}.${key}`);
    }
  }
  if (JSON.stringify(value.countsBefore) !== JSON.stringify(value.countsAfter)) {
    fail("database evidence counts changed");
  }

  exactKeys(
    value.boundaries,
    [
      "liveGeminiCall",
      "liveWhatsAppSend",
      "liveAmoCrmWrite",
      "selectedInboundReplay",
    ],
    "database evidence boundaries",
  );
  for (const [key, nestedValue] of Object.entries(value.boundaries)) {
    if (nestedValue !== false) fail(`database evidence ${key} must be false`);
  }

  return Object.freeze(value);
}

function defaultRun(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function classifyReference(repoPath) {
  if (HISTORICAL_FILES.has(repoPath)) return "historical";
  if (HISTORICAL_ROOTS.some((prefix) => repoPath === prefix.slice(0, -1) || repoPath.startsWith(prefix))) {
    return "historical";
  }
  if (
    GUARD_ROOTS.some(
      (prefix) => repoPath === prefix.slice(0, -1) || repoPath.startsWith(prefix),
    ) ||
    /^scripts\/(?:test-|verify-|p8)/u.test(repoPath) ||
    repoPath === "scripts/platform-provider-runtime-inventory.mjs"
  ) {
    return "guard";
  }
  if (
    /^scripts\/(?:backup-|u11-recovery-evidence\.mjs|backup-sqlite\.mjs)/u.test(
      repoPath,
    )
  ) {
    return "historical";
  }
  return "active";
}

function scanRuleWithNode(repoReal, rule) {
  let pattern;
  try {
    const smartCaseFlags = /[A-Z]/u.test(rule.pattern) ? "u" : "iu";
    pattern = new RegExp(rule.pattern, smartCaseFlags);
  } catch (error) {
    fail(`invalid scan pattern for ${rule.id}: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const matches = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch (error) {
      fail(
        `node scan could not read ${relativePath(repoReal, directory)}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    for (const entry of entries) {
      if (SCAN_IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      let bytes;
      try {
        bytes = readFileSync(absolutePath);
      } catch (error) {
        fail(
          `node scan could not read ${relativePath(repoReal, absolutePath)}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
      if (bytes.includes(0)) continue;

      const lines = bytes.toString("utf8").split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        if (!pattern.test(lines[index])) continue;
        const repoPath = relativePath(repoReal, absolutePath);
        matches.push(
          Object.freeze({
            ruleId: rule.id,
            description: rule.description ?? "",
            path: repoPath,
            line: index + 1,
            text: lines[index],
            classification: classifyReference(repoPath),
          }),
        );
      }
    }
  };

  visit(repoReal);
  return matches;
}

export function scanRuntimeReferences(
  repoRoot,
  rules = DEFAULT_SCAN_RULES,
  run = defaultRun,
) {
  const repoReal = realpathSync(repoRoot);
  const matches = [];
  for (const rule of rules) {
    if (!rule || typeof rule.id !== "string" || typeof rule.pattern !== "string") {
      fail("scan rule drifted");
    }
    const result = run(
      "rg",
      [
        "--json",
        "-n",
        "-S",
        "--hidden",
        "--glob",
        "!.git",
        "--glob",
        "!node_modules",
        "--glob",
        "!.next",
        "--glob",
        "!output",
        rule.pattern,
        repoReal,
      ],
      repoReal,
    );
    if (result?.error?.code === "ENOENT") {
      matches.push(...scanRuleWithNode(repoReal, rule));
      continue;
    }
    if (result.status !== 0 && result.status !== 1) {
      const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : "";
      const message = result?.error instanceof Error ? result.error.message : stderr;
      fail(`rg failed for ${rule.id}: ${message || "unknown error"}`);
    }
    if (typeof result.stdout !== "string") fail(`rg output missing for ${rule.id}`);
    const lines = result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.type !== "match") continue;
      const absolutePath = event.data.path.text;
      const lineNumber = event.data.line_number;
      const lineText = event.data.lines.text.replace(/\r?\n$/u, "");
      const repoPath = relativePath(repoReal, absolutePath);
      const classification = classifyReference(repoPath);
      matches.push(
        Object.freeze({
          ruleId: rule.id,
          description: rule.description ?? "",
          path: repoPath,
          line: lineNumber,
          text: lineText,
          classification,
        }),
      );
    }
  }

  const historicalReferences = matches.filter((item) => item.classification === "historical");
  const guardReferences = matches.filter((item) => item.classification === "guard");
  const activeViolations = matches.filter((item) => item.classification === "active");
  return Object.freeze({
    rules: rules.map((rule) =>
      Object.freeze({
        id: rule.id,
        pattern: rule.pattern,
        description: rule.description ?? "",
      }),
    ),
    historicalReferences,
    guardReferences,
    activeViolations,
  });
}

function ensurePrivateParent(path) {
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("output parent must be a real directory");
  chmodSync(parent, 0o700);
}

function writePrivateJson(path, value) {
  ensurePrivateParent(path);
  const temporary = `${path}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (existsSync(path) || existsSync(temporary)) fail(`artifact collision: ${basename(path)}`);
  writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function createPlatformProviderRuntimeInventory(input) {
  exactKeys(
    input,
    [
      "repoRoot",
      "expectedSha",
      "remoteEvidencePath",
      "browserEvidencePath",
      "databaseEvidencePath",
      "outputPath",
    ],
    "provider runtime inventory input",
  );
  assertSha40(input.expectedSha, "provider runtime inventory expectedSha");
  for (const key of [
    "remoteEvidencePath",
    "browserEvidencePath",
    "databaseEvidencePath",
    "outputPath",
  ]) {
    assertSafeString(input[key], `provider runtime inventory ${key}`);
  }

  const repoRoot = realpathSync(input.repoRoot);
  const remotePath = join(repoRoot, input.remoteEvidencePath);
  const browserPath = join(repoRoot, input.browserEvidencePath);
  const databasePath = join(repoRoot, input.databaseEvidencePath);
  const outputPath = join(repoRoot, input.outputPath);

  const remoteFile = readJsonFile(remotePath, "remote evidence");
  const browserFile = readJsonFile(browserPath, "browser evidence");
  const databaseFile = readJsonFile(databasePath, "database evidence");
  const remoteEvidence = validateRemoteEvidence(remoteFile.parsed, input.expectedSha);
  const browserEvidence = validateBrowserEvidence(browserFile.parsed, input.expectedSha);
  const databaseEvidence = validateDatabaseEvidence(databaseFile.parsed, input.expectedSha);
  const runtimeScan = scanRuntimeReferences(repoRoot);
  if (runtimeScan.activeViolations.length > 0) {
    const paths = [...new Set(runtimeScan.activeViolations.map((item) => item.path))]
      .sort()
      .join(", ");
    fail(`active WAHA fallback references remain: ${paths}`);
  }

  const report = Object.freeze({
    schemaVersion: 1,
    kind: "platform-provider-runtime-inventory",
    gitSha: input.expectedSha,
    createdAt: new Date().toISOString(),
    status: "passed",
    evidence: Object.freeze({
      remote: Object.freeze({
        path: relativePath(repoRoot, remotePath),
        sha256: sha256(Buffer.from(remoteFile.body, "utf8")),
      }),
      browser: Object.freeze({
        path: relativePath(repoRoot, browserPath),
        sha256: sha256(Buffer.from(browserFile.body, "utf8")),
      }),
      database: Object.freeze({
        path: relativePath(repoRoot, databasePath),
        sha256: sha256(Buffer.from(databaseFile.body, "utf8")),
      }),
    }),
    checks: Object.freeze({
      remoteReadOnly: true,
      browserReadOnly: true,
      databaseReadOnly: true,
      liveGeminiExercised: browserEvidence.boundaries.liveGeminiCall,
      liveWhatsAppSendExercised: browserEvidence.boundaries.liveWhatsAppSend,
      liveAmoCrmWriteExercised: browserEvidence.boundaries.liveAmoCrmWrite,
      selectedInboundReplayExercised:
        databaseEvidence.boundaries.selectedInboundReplay,
      activeFallbackViolations: runtimeScan.activeViolations.length,
      guardReferenceCount: runtimeScan.guardReferences.length,
      historicalReferenceCount: runtimeScan.historicalReferences.length,
    }),
    runtimeScan,
    sourceSchemas: Object.freeze({
      remoteKind: remoteEvidence.kind,
      browserKind: browserEvidence.kind,
      databaseKind: databaseEvidence.kind,
    }),
  });

  writePrivateJson(outputPath, report);
  return report;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function isDirectExecution() {
  return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url));
}

if (isDirectExecution()) {
  const args = parseArgs(process.argv);
  const report = createPlatformProviderRuntimeInventory({
    repoRoot: args["repo-root"] ?? process.cwd(),
    expectedSha: args["expected-sha"],
    remoteEvidencePath: args["remote-evidence"],
    browserEvidencePath: args["browser-evidence"],
    databaseEvidencePath: args["database-evidence"],
    outputPath: args.output,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
