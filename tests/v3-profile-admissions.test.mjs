import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

// Unified workflow S1: the combined queue+decision StudentApplications/
// StudentApplicationsNav components are retired (the queue moved to
// /v3/requests under Продажи, and the case directory dropped its now
// cross-role «Заявки» tab). StudentApplicationAnswers and the simplified,
// direction/curator-free ApplicationDecision are the two pieces that
// survive — reused by both /v3/requests and the lead-card «Доступ к
// платформе» block — so this SSR probe now renders exactly those two.
test("the public Student анкета answers and the access-only decision form render without direction/curator fields", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const compiled = await build({
    stdin: { contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { StudentApplicationAnswers, ApplicationDecision } from "./src/components/v3/admissions/StudentApplications";
      const application = {
        id: "11111111-1111-4111-8111-111111111111", revision: 3, status: "pending", email: "student@example.test",
        submittedAt: "2026-09-18T09:00:00Z", decidedAt: null, decisionReason: null, studentCaseId: null,
        admissionsDirection: null, canonicalLeadId: null,
        questionnaire: { firstName: "Тест", lastName: "Заявки", phone: "+996555000000", destinationCountries: ["CN", "MY"],
          intakeSeason: "autumn", intakeYear: 2027, educationLevel: "high_school", averageGrade: 4.5, gradeScale: "5",
          studyFields: ["Инженерия", "Дизайн"], studyLevels: ["bachelor", "foundation"], nationality: "KG",
          english: { mode: "self", level: "intermediate" }, tuitionBudget: "5000_10000", fundingSource: "family" }
      };
      process.stdout.write(JSON.stringify({
        answers: renderToStaticMarkup(createElement(StudentApplicationAnswers, { application })),
        decision: renderToStaticMarkup(createElement(ApplicationDecision, {
          application, requestId: "33333333-3333-4333-8333-333333333333",
        })),
      }));
    `, resolveDir: root, sourcefile: "student-applications-ssr.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", target: "node22",
    packages: "external", jsx: "automatic", logLevel: "silent",
    plugins: [{ name: "server-action-boundary", setup(builder) {
      builder.onResolve({ filter: /student-application-actions$/ }, () => ({ path: "decision-action", namespace: "test" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ contents: path === "navigation"
        ? "export function useRouter() { return { refresh() { throw new Error('SSR must not navigate'); } }; }"
        : "export async function decideStudentApplicationAction() { throw new Error('SSR must not decide'); }" }));
    } }],
  });
  const childEnv = { ...process.env, NODE_OPTIONS: "" };
  delete childEnv.NODE_TEST_CONTEXT;
  const rendered = spawnSync(process.execPath, ["--input-type=commonjs"], { cwd: root, input: compiled.outputFiles[0].text, encoding: "utf8", env: childEnv, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.ifError(rendered.error);
  assert.equal(rendered.status, 0, rendered.stderr);
  const output = JSON.parse(rendered.stdout);
  assert.match(output.answers, /Заполнено студентом/);
  assert.match(output.answers, /Сведения требуют проверки/);
  for (const answer of ["Китай, Малайзия", "Инженерия, Дизайн", "4.5 из 5", "самооценка", "student@example.test"]) assert.ok(output.answers.includes(answer), answer);
  assert.match(output.decision, /name="expected_revision" value="3"/);
  assert.match(output.decision, /name="request_id" value="33333333-3333-4333-8333-333333333333"/);
  assert.match(output.decision, /name="reason" value=""/);
  assert.match(output.decision, /Одобрить и открыть кабинет/);
  // The direction/curator pickers are gone entirely (plan §4: access alone,
  // never an Admissions assignment) — no leftover select, option or label.
  // (The approved-status "Открыть дело" link now lives on the caller —
  // tabs.tsx's PlatformAccessCard and the /v3/requests row — not on this
  // form, which no longer branches on application.status at all.)
  assert.doesNotMatch(output.decision, /Направление|Куратор|admissions_direction|curator_membership_id/);
  assert.doesNotMatch(output.decision, /<select/);
});

test("application catalogue selector renders actual React with deliberate choice and no extra submitted fields", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const compiled = await build({
    stdin: { contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ApplicationUniversitySelector } from "./src/components/v3/profile/ApplicationUniversitySelector";
      process.stdout.write(renderToStaticMarkup(createElement(ApplicationUniversitySelector)));
    `, resolveDir: root, sourcefile: "application-selector-ssr.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", target: "node22",
    packages: "external", jsx: "automatic", logLevel: "silent",
    plugins: [{ name: "read-action-boundary", setup(builder) {
      builder.onResolve({ filter: /platform-admissions-actions$/ }, () => ({ path: "search-action", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents:
        "export async function searchApplicationUniversitiesAction() { throw new Error('SSR must not read'); }" }));
    } }],
  });
  const childEnv = { ...process.env, NODE_OPTIONS: "" };
  delete childEnv.NODE_TEST_CONTEXT;
  const rendered = spawnSync(process.execPath, ["--input-type=commonjs"], {
    cwd: root, input: compiled.outputFiles[0].text, encoding: "utf8", env: childEnv,
    timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(rendered.error);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /data-testid="v3-application-university-selector" aria-busy="false"/u);
  assert.match(rendered.stdout, /Поиск университета/u);
  assert.match(rendered.stdout, /<button type="button"[^>]*>Найти<\/button>/u);
  assert.match(rendered.stdout, /<select name="catalog_institution_id" required=""/u);
  assert.match(rendered.stdout, /<option value="" selected="">Выберите университет<\/option>/u);
  assert.deepEqual([...rendered.stdout.matchAll(/ name="([^"]+)"/gu)].map((match) => match[1]).sort(),
    ["catalog_institution_id", "institution_name"]);
});

test("application selector owns stale reads and search Enter without changing application retry or programme", () => {
  const selector = source("src/components/v3/profile/ApplicationUniversitySelector.tsx");
  const workspace = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");
  assert.match(selector, /const request = \+\+epoch\.current/u);
  assert.match(selector, /if \(request !== epoch\.current\) return;/u);
  assert.match(selector, /useEffect\(\(\) => \(\) => \{ epoch\.current \+= 1;/u);
  assert.match(selector, /onChange=\{\(event\) => \{ invalidate\(\); setQuery/u);
  assert.match(selector, /event\.preventDefault\(\);/u);
  assert.match(selector, /!event\.nativeEvent\.isComposing && !loading/u);
  assert.match(selector, /search\(result\.nextOffset\)/u);
  assert.match(selector, /search\(offset\)/u);
  assert.doesNotMatch(selector, /setSelectedId\(.*items\[/u);
  assert.doesNotMatch(selector, /name="(?:query|offset|manual)"/u);
  assert.match(selector, /const countryLabel = country\(item\.country\);/u);
  assert.match(selector, /\{countryLabel \? ` · \$\{countryLabel\}` : ""\}/u);
  assert.doesNotMatch(selector, /country\(item\.country\)\s*\?\?\s*item\.country/u);
  assert.match(workspace, /<ApplicationUniversitySelector key=\{workspace\.studentCaseId\} \/>/u);
  assert.match(workspace, /name="program_name" required maxLength=\{300\}/u);
  assert.match(workspace, /name="request_id" value=\{state\.requestId\}/u);
  assert.match(workspace, /name="expected_version" value="0"/u);
});

test("V3 profile keeps lead and Admissions case route identities separate", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const types = source("src/components/v3/profile/types.ts");
  const adapter = source("src/lib/v3/profile-source.ts");
  const sections = source("src/lib/v3/case-access-contract.ts");
  const workspace = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");

  assert.match(page, /requireV3PageActor\("\/v3\/profile"\)/u);
  assert.match(page, /ProfileSearchParams/u);
  assert.match(page, /loadV3ProfileRoute\(routeMode/u);
  assert.match(
    page,
    /readTarget: \(target\) => readProfileTarget\(actor, target, noteCursor,/u,
  );
  assert.doesNotMatch(page, /readProfilePicks/u);
  assert.match(page, /actor=\{actor\}/u);
  assert.match(types, /query\.set\("id", target\.leadId\)/u);
  assert.match(types, /query\.set\("case", target\.studentCaseId\)/u);
  assert.match(types, /student && access.documents/u);
  assert.match(page, /view\?\.details\.access/u);
  assert.doesNotMatch(types, /query\.set\("case_id"/u);
  assert.match(adapter, /rpc\("staff_case_access_snapshot"/u);
  assert.match(adapter, /if \(sectionResponse\.error\) throw/u);
  assert.match(adapter, /staffPresentationCan\(actor, "admissions.read"\) && studentCase/u);
  assert.match(adapter, /readCaseProfileSections\(access,/u);
  assert.match(adapter, /documents: \(\) => getPlatformCaseDocumentWorkspace\(actor, studentCaseId\)/u);
  assert.match(adapter, /finance: \(\) => getPlatformCaseFinanceControl\(actor, studentCaseId\)/u);
  assert.match(sections, /access\.documents \? readers\.documents\(\) : null/u);
  assert.match(sections, /access\.finance \? readers\.finance\(\) : null/u);
  assert.match(adapter, /links\.find\(\(item\) => item\.studentCaseId === canonicalCaseId\)/u);
  assert.match(adapter, /if \(leadProfile\) return leadProfile/u);
  assert.match(adapter, /leadId: link\?\.leadId \?\? null/u);
  assert.doesNotMatch(adapter, /if \(!link[^\n]*\) return null/u);
  assert.match(workspace, /<Card eyebrow id="applications" title="Заявки">/u);
  // Unified workflow S4 (plan §11): the visa-case CRUD Card is retired —
  // no separate visa case, mandatory statuses or CRM-side visa workflow.
  // Visa rows/files stay in the database untouched; nothing renders them
  // as a Card here any more (see tests/platform-case-operations.test.mjs
  // for the still-live, unrelated READ path this does not touch).
  assert.doesNotMatch(workspace, /id="visa"/u);
  assert.doesNotMatch(workspace, /title="Виза"/u);
  assert.doesNotMatch(adapter, /actor\.authorityRole === "admin" && studentCase/u);
  assert.match(adapter, /listPlatformStudentCases/u);
  assert.match(adapter, /getPlatformStudentCaseView/u);
  assert.match(adapter, /listPlatformStudentCaseLeadLinks/u);
  assert.match(adapter, /view\.access !== "full"/u);
  assert.match(adapter, /sales: null/u);
});

test("V3 profile actions use canonical versioned server commands and honest outcomes", () => {
  const controls = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");

  for (const action of [
    "createPlatformUniversityApplicationAction",
    "updatePlatformUniversityApplicationDetailsAction",
    "createPlatformFinanceStopFactorAction",
    "resolvePlatformFinanceStopFactorAction",
  ]) {
    assert.match(controls, new RegExp(`${action}`));
  }
  // Unified workflow S4 (plan §11): submission-status editing
  // (changePlatformUniversityApplicationAction, ApplicationStatusForm) and
  // visa-case CRUD (upsertPlatformCaseVisaAction) are retired from this tab.
  assert.doesNotMatch(controls, /changePlatformUniversityApplicationAction/u);
  assert.doesNotMatch(controls, /upsertPlatformCaseVisaAction/u);
  assert.doesNotMatch(controls, /function ApplicationStatusForm/u);
  assert.doesNotMatch(controls, /function VisaForm/u);
  assert.doesNotMatch(controls, /Изменить статус|Сохранить статус|Создать визовое дело|Обновить визу/u);
  for (const field of [
    "student_case_id",
    "request_id",
    "expected_version",
    "application_id",
    "payment_obligation_id",
    "stop_factor_id",
    "is_primary",
    "university_deadline_on",
    "country",
    "degree",
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`));
  }
  // visa_case_id and the status picker's own name="status" (a <select>) are
  // gone with the forms that submitted them; the create form's hidden,
  // never-edited default is checked separately below.
  assert.doesNotMatch(controls, /name="visa_case_id"/u);
  assert.doesNotMatch(controls, /<select name="status"/u);
  for (const outcome of [
    "saved",
    "invalid",
    "forbidden",
    "stale",
    "request_conflict",
    "unavailable",
  ]) {
    assert.match(controls, new RegExp(`${outcome}:`));
  }

  assert.match(controls, /status === "saved" \|\| status === "stale"/u);
  assert.match(controls, /Основной вариант/u);
  assert.match(controls, /Дедлайн от университета/u);
  assert.match(controls, /application\.universityDeadlineOn/u);
  assert.match(controls, /type="checkbox"[\s\S]*name="is_primary"/u);
  assert.doesNotMatch(controls, /<select[^>]*name="is_primary"/u);
  assert.match(controls, /data-primary=\{application\.isPrimary \? "true" : "false"\}/u);
  assert.match(controls, /details-\$\{application\.universityApplicationId\}-\$\{application\.version\}/u);
  assert.match(controls, /router\.refresh\(\)/u);
  // Status still displays read-only, as secondary metadata (task's own
  // allowance) — the DB column and PLATFORM_APPLICATION_STATUSES-backed
  // label function stay; only the editable <select> is gone.
  assert.match(controls, /Pill tone=\{statusTone\(application\.status\)\}/u);
  assert.match(controls, /applicationStatus\(application\.status\)/u);
  assert.doesNotMatch(controls, /PLATFORM_APPLICATION_STATUSES/u);
  assert.doesNotMatch(controls, /PLATFORM_VISA_STATUSES/u);
  assert.doesNotMatch(controls, /createSupabase|supabase\.from|localStorage|sessionStorage/u);
  assert.equal(
    existsSync(new URL("../src/components/v3/profile/ProfileAdmissionsActions.ts", import.meta.url)),
    false,
  );

  // «Партнёр и решение» is editable since unified workflow S7 (plan §8/§11):
  // platform.update_application_partner_details_v1 (migration 184) needs no
  // admissions_playbook_version_id, unlike the retired 137 write path.
  assert.match(controls, /function ApplicationPartnerFacts/u);
  assert.match(controls, /Партнёр и решение/u);
  const partnerFacts = controls.slice(
    controls.indexOf("function ApplicationPartnerFacts"),
    controls.indexOf("function FinanceStopCreateForm"),
  );
  assert.match(partnerFacts, /<form action=\{action\}/u);
  assert.match(partnerFacts, /useActionState\(\s*updateApplicationPartnerDetailsAction/u);
  assert.match(partnerFacts, /name="partner_contact"/u);
  assert.match(partnerFacts, /name="external_link"/u);
  assert.match(partnerFacts, /name="decision_reference"/u);
  assert.match(partnerFacts, /name="decision_note"/u);
  assert.match(partnerFacts, /name="student_case_id" value=\{workspace\.studentCaseId\}/u);
  // Read-only fallback (no `application.manage`) stays a plain fact list.
  assert.match(partnerFacts, /if \(!canWrite\) \{/u);
  assert.doesNotMatch(partnerFacts, /packageReference|offerConditions/u);
  assert.match(controls, /partnerDetails\?: readonly ApplicationPartnerDetails\[\]/u);
  assert.match(controls, /<ApplicationPartnerFacts/u);
  assert.match(controls, /canWrite=\{canWriteApplications\}/u);

  const detailsForm = controls.slice(
    controls.indexOf("function ApplicationDetailsForm"),
    controls.indexOf("function ApplicationPartnerFacts"),
  );
  assert.match(detailsForm, /name="application_id"/u);
  assert.doesNotMatch(detailsForm, /name="student_case_id"/u);
  assert.match(detailsForm, /<ApplicationCountryField defaultValue=\{application\.country \?\? ""\} \/>/u);
  assert.match(detailsForm, /<ApplicationDegreeField defaultValue=\{application\.degree \?\? ""\} \/>/u);

  const createForm = controls.slice(
    controls.indexOf("function ApplicationCreateForm"),
    controls.indexOf("function ApplicationDetailsForm"),
  );
  assert.match(createForm, /<ApplicationCountryField \/>/u);
  assert.match(createForm, /<ApplicationDegreeField \/>/u);
  assert.match(createForm, /name="status" value="preparation"/u);
  assert.match(controls, /<select name="country"/u);
  assert.match(controls, /<select name="degree"/u);
  assert.match(controls, /platformApplicationCountryEditOptions\(defaultValue \|\| null\)/u);
  assert.match(controls, /platformApplicationDegreeEditOptions\(defaultValue \|\| null\)/u);
  assert.match(controls, /applicationCountry\(countryCode\)/u);
  assert.match(controls, /applicationDegree\(degreeKey\)/u);
  assert.match(controls, /Сохранено ранее \(оставить без изменений\)/u);
  assert.doesNotMatch(controls, /Сохранено ранее[^<\n]*\$\{/u);
  assert.doesNotMatch(controls, />\s*(?:CN|MY|AE|TR|IT|CZ|foundation|language|bachelor|master|phd)\s*</u);

  const tabs = source("src/components/v3/profile/tabs.tsx");
  assert.match(tabs, /find\(\(candidate\) => candidate\.isPrimary\)/u);
  assert.doesNotMatch(tabs, /profile\.applications\[0\]/u);
  assert.match(tabs, /Основной вариант ещё не выбран/u);
});

test("V3 profile adapter carries application priority and all-day deadline without inference", () => {
  const adapter = source("src/lib/v3/profile-source.ts");
  const types = source("src/components/v3/profile/types.ts");

  assert.match(types, /isPrimary: boolean/u);
  assert.match(types, /universityDeadlineOn: string \| null/u);
  assert.match(types, /applicationDetails: Readonly<Record<string, string>>/u);
  assert.match(adapter, /isPrimary: application\.isPrimary/u);
  assert.match(adapter, /universityDeadlineOn: application\.universityDeadlineOn/u);
  assert.match(adapter, /applicationDetails: Object\.fromEntries/u);
  assert.doesNotMatch(adapter, /universityDeadlineOn:[^\n]*(?:intake|createdAt|updatedAt)/u);
});

test("finance stop controls submit canonical keys and never render them raw", () => {
  const controls = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");
  const wording = source("src/lib/v3/wording.ts");

  assert.match(controls, /<select[\s\S]*name="blocked_action"/u);
  assert.match(controls, /financeBlockedActionOptions\.map/u);
  assert.match(controls, /financeBlockedAction\(stop\.blockedAction\)/u);
  for (const key of [
    "application_submission",
    "document_processing",
    "visa_submission",
    "case_progression",
  ]) {
    assert.match(wording, new RegExp(`${key}:`));
    assert.doesNotMatch(controls, new RegExp(`>${key}<`));
  }
});
