import { readFileSync } from "fs";
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

const audit = read("docs/PROMISE_AUDIT.md");
const preparedAi = read("src/lib/prepared-ai.ts");

for (const label of ["proven", "partly proven", "misleading", "unsupported", "outdated", "missing evidence"]) {
  assert(audit.includes(`\`${label}\``) || audit.includes(`| ${label} |`), `missing promise-audit label: ${label}`);
}

for (const required of [
  "## Promise Register",
  "## Fixes Completed",
  "## Remaining High-Risk Items",
  "## Decisions Needed",
  "Public “almost 100%”",
  "Live WhatsApp send, live PBX provider, live amoCRM sync, live Anthropic AI",
  "In-app telephony “Demo mode” copy",
]) {
  assert(audit.includes(required), `missing promise-audit section or decision: ${required}`);
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

for (const response of extractPreparedResponses(preparedAi)) {
  for (const pattern of forbiddenPreparedAnswerPatterns) {
    assert(!pattern.test(response), `prepared AI response contains unsupported guarantee wording: ${response}`);
  }
}

console.log("Promise audit verification passed.");
