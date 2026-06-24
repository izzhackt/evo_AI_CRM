import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const reportPath = path.join(repoRoot, "docs/PUBLIC_PROMISE_LIVE_AUDIT.md");

const pages = [
  { id: "home", label: "Home", url: "https://evoadmissions.com/" },
  { id: "services", label: "Services", url: "https://evoadmissions.com/uslugi.htm" },
  { id: "about", label: "About", url: "https://evoadmissions.com/o-nas.htm" },
  { id: "contacts", label: "Contacts", url: "https://evoadmissions.com/contacts.htm" },
];

const outcomeEvidencePatterns = [
  /аудирован.{0,80}(исход|результат|поступлен).{0,120}(на\s+дат[уы]|от)\s+(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i,
  /по\s+проверенн.{0,80}(баз|данн).{0,120}(исход|результат|поступлен).{0,120}(на\s+дат[уы]|от)\s+(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i,
];

const sourceDateEvidencePatterns = [
  /по\s+внутренн.{0,80}(баз|реестр|данн|кейсов).{0,140}(на\s+дат[уы]|от)\s+(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i,
  /по\s+утвержденн.{0,80}(баз|реестр|данн|списк).{0,140}(на\s+дат[уы]|от)\s+(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i,
  /источник:.{0,160}(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i,
  /данн.{0,80}(на\s+дат[уы]|от)\s+(\d{4}-\d{2}-\d{2}|\d{2}[.-]\d{2}[.-]\d{4})/i,
];

const nonGuaranteeBoundaryPatterns = [
  /не\s+является\s+гарантией.{0,160}(поступлен|грант|стипенди|виз)/i,
  /(поступлен|грант|стипенди|виз).{0,160}не\s+является\s+гарантией/i,
];

const rules = [
  {
    id: "PUBLIC-OUTCOME-100",
    risk: "high",
    pages: ["home"],
    promise: "Admissions chances are raised almost to 100%.",
    action: "Replace with process-control language from docs/PUBLIC_PROMISE_COPY_CHANGESET.md or provide audited outcome evidence.",
    patterns: [/почти\s+до\s+100%/i],
    allowPagePatterns: outcomeEvidencePatterns,
  },
  {
    id: "PUBLIC-NO-STUDENT-WITHOUT-INVITATION",
    risk: "high",
    pages: ["home"],
    promise: "No student remains without an invitation.",
    action: "Remove the guarantee-style sentence or provide audited outcome evidence.",
    patterns: [/ни\s+один\s+студент\s+не\s+остается\s+без\s+приглашения/i],
    allowPagePatterns: outcomeEvidencePatterns,
  },
  {
    id: "PUBLIC-100-GRANT",
    risk: "high",
    pages: ["home"],
    promise: "The marathon covers everything needed for a 100% grant.",
    action: "Rewrite as grant and financial-aid preparation with a clear non-guarantee boundary.",
    patterns: [/100%\s+грант/i],
    allowPagePatterns: nonGuaranteeBoundaryPatterns,
  },
  {
    id: "PUBLIC-4000-METRIC",
    risk: "high",
    pages: ["services", "about"],
    promise: "EVO has helped 4,000+ applicants or successful enrollments.",
    action: "Attach an approved source/date or remove the metric from customer-facing copy.",
    patterns: [/4\s*000\+.{0,120}зачислен/i, /зачислен.{0,180}4\s*000\+/i, /4\s+тысяч\S*\s+абитуриент/i],
    allowPagePatterns: sourceDateEvidencePatterns,
  },
  {
    id: "PUBLIC-60-COUNTRIES",
    risk: "high",
    pages: ["home", "services", "about"],
    promise: "EVO organizes admissions in 60+ countries.",
    action: "Attach an approved country-coverage dataset/date or remove the metric.",
    patterns: [/60\+\s*стран/i, /поступлен\S*\s+в\s+60\+\s+стран/i],
    allowPagePatterns: sourceDateEvidencePatterns,
  },
  {
    id: "PUBLIC-200-PARTNERS",
    risk: "high",
    pages: ["about"],
    promise: "EVO has 200 partner institutions.",
    action: "Attach an approved partner registry/date or remove the metric.",
    patterns: [/партнерск.{0,220}200/i, /200.{0,120}партнер/i],
    allowPagePatterns: sourceDateEvidencePatterns,
  },
  {
    id: "PUBLIC-MAX-CHANCES",
    risk: "high",
    pages: ["services"],
    promise: "Language course support provides maximum admission chances.",
    action: "Rewrite as a route selected against program requirements and current student profile.",
    patterns: [/максимальн.{0,30}шанс.{0,30}на\s+поступлен/i],
    allowPagePatterns: [/требован.{0,80}программ.{0,120}профил/i, /профил.{0,120}требован.{0,80}программ/i],
  },
  {
    id: "PUBLIC-1700000-READERS",
    risk: "medium",
    pages: ["about"],
    promise: "EVO has 1,700,000+ monthly readers.",
    action: "Attach analytics evidence/date or remove the metric.",
    patterns: [/1\s*700\s*000\+/i],
    allowPagePatterns: sourceDateEvidencePatterns,
  },
  {
    id: "PUBLIC-5000-PUBLICATIONS",
    risk: "medium",
    pages: ["about"],
    promise: "EVO has 5,000+ publications.",
    action: "Attach publication inventory evidence/date or remove the metric.",
    patterns: [/5\s*000\+/i],
    allowPagePatterns: sourceDateEvidencePatterns,
  },
  {
    id: "PUBLIC-CONSULTATION-NO-GUARANTEE",
    risk: "high",
    pages: ["home", "services", "about", "contacts"],
    promise: "Consultation assesses chances without an admission/grant/visa guarantee boundary.",
    action: "Add the non-guarantee wording from docs/PUBLIC_PROMISE_COPY_CHANGESET.md.",
    trigger: /оценим\s+ваши\s+шансы|оценим\s+ваши\s+шансы\s+поступить/i,
    boundary: /не\s+является\s+гарантией/i,
  },
];

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-");
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function excerpt(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

function hasAllowedEvidence(rule, page) {
  return rule.allowPagePatterns?.some((pattern) => pattern.test(page.text)) ?? false;
}

async function fetchPage(page) {
  const response = await fetch(page.url, { headers: { "user-agent": "EVO-CRM-public-promise-audit/1.0" } });
  if (!response.ok) throw new Error(`${page.url} returned HTTP ${response.status}`);
  return { ...page, text: htmlToText(await response.text()) };
}

function pageFindings(page) {
  return rules.flatMap((rule) => {
    if (!rule.pages.includes(page.id)) return [];
    if (rule.patterns) {
      const match = rule.patterns.map((pattern) => page.text.match(pattern)).find(Boolean);
      if (!match) return [];
      if (hasAllowedEvidence(rule, page)) return [];
      return [{ ...rule, page, evidence: excerpt(match[0]) }];
    }
    if (rule.trigger?.test(page.text) && !rule.boundary?.test(page.text)) {
      const match = page.text.match(rule.trigger);
      return [{ ...rule, page, evidence: excerpt(match?.[0] ?? "consultation chance assessment without boundary") }];
    }
    return [];
  });
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`self-test failed: ${message}`);
}

function runSelfTest() {
  const grantBlocked = pageFindings({
    id: "home",
    label: "Self Test",
    url: "self-test://grant-blocked",
    text: "Марафон для поступления на 100% грант.",
  });
  assertSelfTest(
    grantBlocked.some((finding) => finding.id === "PUBLIC-100-GRANT"),
    "100% grant wording without a boundary must fail",
  );

  const grantAllowed = pageFindings({
    id: "home",
    label: "Self Test",
    url: "self-test://grant-allowed",
    text: "Марафон для поступления на 100% грант. Это не является гарантией поступления, гранта, стипендии или визы.",
  });
  assertSelfTest(
    !grantAllowed.some((finding) => finding.id === "PUBLIC-100-GRANT"),
    "100% grant wording with a non-guarantee boundary should clear",
  );

  const metricBlocked = pageFindings({
    id: "about",
    label: "Self Test",
    url: "self-test://metric-blocked",
    text: "4 000+ успешных зачислений. 60+ стран. Партнерских заведений по всему миру 200.",
  });
  for (const id of ["PUBLIC-4000-METRIC", "PUBLIC-60-COUNTRIES", "PUBLIC-200-PARTNERS"]) {
    assertSelfTest(metricBlocked.some((finding) => finding.id === id), `${id} without source/date evidence must fail`);
  }

  const metricAllowed = pageFindings({
    id: "about",
    label: "Self Test",
    url: "self-test://metric-allowed",
    text: "4 000+ успешных зачислений. 60+ стран. Партнерских заведений по всему миру 200. По внутренней базе кейсов EVO Admissions на дату 2026-06-24.",
  });
  for (const id of ["PUBLIC-4000-METRIC", "PUBLIC-60-COUNTRIES", "PUBLIC-200-PARTNERS"]) {
    assertSelfTest(!metricAllowed.some((finding) => finding.id === id), `${id} with source/date evidence should clear`);
  }
}

function renderReport(findings, generatedAt) {
  const highCount = findings.filter((finding) => finding.risk === "high").length;
  const status = highCount === 0 ? "clear" : "blocked";
  const lines = [
    "# Public Promise Live Audit",
    "",
    `Status: ${status}.`,
    `Generated: ${generatedAt}.`,
    "",
    "This is a live network audit of the external `evoadmissions.com` public website.",
    "The CRM repo cannot change those pages directly; use this report to verify the website/CMS copy handoff.",
    "",
    "## Pages Checked",
    "",
    ...pages.map((page) => `- ${page.url}`),
    "",
    "## Acceptable Clear Conditions",
    "",
    "- Outcome guarantee-style claims clear only after removal or audited outcome evidence with a real date.",
    "- Grant wording clears only when paired with a clear non-guarantee boundary for admission, grants, scholarships, or visas.",
    "- Numeric claims clear only after removal or source/date evidence such as an approved internal case base, registry, analytics source, or dataset date.",
    "- Consultation chance-assessment copy clears only when the page includes `не является гарантией` language.",
    "",
    "## Findings",
    "",
  ];

  if (findings.length === 0) {
    lines.push("No tracked high-risk or medium-risk public promise patterns were found.");
  } else {
    lines.push("| Risk | Rule | Page | Evidence | Required action |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const finding of findings) {
      lines.push(
        `| ${finding.risk} | ${finding.id} | ${finding.page.label} | ${finding.evidence} | ${finding.action} |`,
      );
    }
  }

  lines.push(
    "",
    "## Completion Gate",
    "",
    highCount === 0
      ? "Public promise gate is clear for the tracked high-risk patterns."
      : "`npm run public-promise-audit` must pass before the promise-audit goal can be marked complete.",
    "",
    "Medium-risk metric claims still require source/date evidence before being presented as proven.",
    "",
  );

  return lines.join("\n");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  console.log("Public promise audit self-test passed.");
  process.exit(0);
}

const shouldWrite = process.argv.includes("--write");
const generatedAt = new Date().toISOString();
const fetchedPages = await Promise.all(pages.map(fetchPage));
const findings = fetchedPages.flatMap(pageFindings);
const report = renderReport(findings, generatedAt);

if (shouldWrite) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, "utf8");
}

console.log(report);

if (findings.some((finding) => finding.risk === "high")) {
  process.exitCode = 1;
}
