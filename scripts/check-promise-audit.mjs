import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractPreparedResponses(source) {
  return [...source.matchAll(/response:\s*"([^"]*)"/g)].map((match) => match[1]);
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
const ai = read("src/lib/ai.ts");
const i18n = read("src/lib/i18n.ts");
const preparedAi = read("src/lib/prepared-ai.ts");
const publicCopyChangeset = read("docs/PUBLIC_PROMISE_COPY_CHANGESET.md");

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
  "Не обещай поступление",
  "Не используй формулировки вроде",
  "Не заявляй, что WhatsApp, телефония, amoCRM или Anthropic успешно подключены",
]) {
  assert(ai.includes(guardrail), `live AI system prompt is missing guardrail: ${guardrail}`);
}

assert(
  preparedAi.includes("without inventing terms or overpromising") &&
    preparedAi.includes("Do not promise admission probability."),
  "prepared AI prompt library is missing explicit overpromise/admission-probability guardrails",
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
].filter((file) => file !== "src/lib/ai.ts");

for (const file of controlledSurfaceFiles) {
  const content = read(file);
  for (const pattern of forbiddenPreparedAnswerPatterns) {
    assert(!pattern.test(content), `${file} contains unsupported guarantee wording`);
  }
}

for (const response of extractPreparedResponses(preparedAi)) {
  for (const pattern of forbiddenPreparedAnswerPatterns) {
    assert(!pattern.test(response), `prepared AI response contains unsupported guarantee wording: ${response}`);
  }
}

console.log("Promise audit verification passed.");
