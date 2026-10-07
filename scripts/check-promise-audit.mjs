import { existsSync, readdirSync, readFileSync, statSync } from "fs";
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

// The CRM no longer drafts replies with Gemini: the U9 proposal path and the
// staff-assistant were removed in AI-agent P1 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md
// §5.6). Drafting, its rules and its leak guard live in the private evo-ai-agent
// service, so there is no CRM prompt left to check here.
for (const retired of [
  "src/lib/server/platform-gemini-provider.ts",
  "src/app/api/platform-ai/staff-assistant/route.ts",
]) {
  assert(!existsSync(path.join(repoRoot, retired)), `retired AI drafting path is back: ${retired}`);
}

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
