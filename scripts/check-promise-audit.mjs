import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walkFiles(relativeDir, extensions) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    const absolutePath = path.join(repoRoot, relativePath);
    if (entry.isDirectory()) return walkFiles(relativePath, extensions);
    if (!entry.isFile()) return [];
    if (!extensions.includes(path.extname(entry.name))) return [];
    if (statSync(absolutePath).size === 0) return [];
    return [relativePath];
  });
}

const audit = read("docs/PROMISE_AUDIT.md");
const aiOrchestrator = read("src/lib/server/platform-provider-orchestrator.ts");
const aiProvider = read("src/lib/server/platform-gemini-provider.ts");
const i18n = `${read("src/lib/i18n.ts")}\n${read("src/lib/i18n-data.ts")}`;
const publicCopyChangeset = read("docs/PUBLIC_PROMISE_COPY_CHANGESET.md");
const publicLiveAudit = read("docs/PUBLIC_PROMISE_LIVE_AUDIT.md");

for (const label of ["proven", "partly proven", "misleading", "unsupported", "outdated", "missing evidence"]) {
  assert(audit.includes(`\`${label}\``) || audit.includes(`| ${label} |`), `missing promise-audit label: ${label}`);
}

for (const required of [
  "## Promise Register",
  "## Fixes Completed",
  "## Controlled Product Policy",
  "## Remaining High-Risk Items",
  "## Decisions Needed",
  "docs/PUBLIC_PROMISE_COPY_CHANGESET.md",
  "docs/PUBLIC_PROMISE_LIVE_AUDIT.md",
  "Public “almost 100%”",
  "Live WhatsApp send, live PBX provider, live amoCRM sync, live Anthropic AI",
  "Missing `tel_provider` or `tel_api_key`",
  "Changed controlled in-app telephony copy",
  "Added live AI system guardrails",
  "must not repeat public outcome-guarantee claims",
  "This integration is `not_configured`",
]) {
  assert(audit.includes(required), `missing promise-audit section or decision: ${required}`);
}

for (const required of [
  "# Public Promise Live Audit",
  "## Acceptable Clear Conditions",
  "## Findings",
  "## Completion Gate",
  "PUBLIC-OUTCOME-100",
  "PUBLIC-4000-METRIC",
  "npm run public-promise-audit",
]) {
  assert(publicLiveAudit.includes(required), `missing live public-promise audit evidence: ${required}`);
}

assert(!audit.includes("In-app telephony “Demo mode” copy."), "telephony demo-mode copy should not remain an open decision");

for (const required of [
  "## Required Changes",
  "## Acceptance Checks",
  "Повышаем управляемость процесса поступления",
  "не является гарантией",
  "No public page contains `почти до 100%`",
  "Numeric claims such as `4 000+`, `60+`, `200`, `1 700 000+`, and `5 000+`",
]) {
  assert(publicCopyChangeset.includes(required), `missing public-copy handoff requirement: ${required}`);
}

assert(
  i18n.includes("Телефония not_configured") &&
    i18n.includes("Телефония not_configured: АТСтен") &&
    i18n.includes("Telephony not_configured"),
  "telephony copy must use explicit not_configured wording in ru/ky/en",
);

assert(
  !i18n.includes("Demo mode: connect your PBX") &&
    !i18n.includes("Демо-режим: подключите вашу АТС") &&
    !i18n.includes("Демо-режим: АТСти"),
  "telephony copy still contains demo-mode wording",
);

for (const guardrail of [
  "You prepare one advisory draft for an EVO staff member.",
  "You never send a message, change CRM state, call tools, or make a decision for staff.",
  "You never promise admission, visas, scholarships, deadlines, discounts, payments, or outcomes.",
]) {
  assert(
    aiOrchestrator.includes(guardrail),
    `platform Gemini prompt is missing guardrail: ${guardrail}`,
  );
}
assert(
  aiProvider.includes("UNSAFE_OUTCOME_PATTERNS") &&
    aiProvider.includes('"unsafe_semantics"'),
  "platform Gemini provider is missing application-side promise guardrails",
);

const forbiddenPreparedAnswerPatterns = [
  /100%\s*(admission|grant|chance|success|поступ|грант)/i,
  /(guarantee|guaranteed)\s+(admission|grant|success)/i,
  /(гарантируем|гарантия|гарантированн).{0,40}(поступ|грант|успех)/i,
  /почти\s+до\s+100%/i,
  /ни\s+один\s+студент\s+не\s+остается\s+без\s+приглашения/i,
];

const controlledSurfaceFiles = [
  ...walkFiles("src/app", [".ts", ".tsx"]),
  ...walkFiles("src/components", [".ts", ".tsx"]),
  ...walkFiles("src/lib", [".ts", ".tsx"]),
];

for (const file of controlledSurfaceFiles) {
  const content = read(file);
  for (const pattern of forbiddenPreparedAnswerPatterns) {
    assert(!pattern.test(content), `${file} contains unsupported guarantee wording`);
  }
}

console.log("Promise audit verification passed.");
