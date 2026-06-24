# Plan Changes

This file is append-only. Do not rewrite or delete earlier entries.

Before coding, add an entry here when any of these change:

- Scope.
- Architecture.
- Acceptance criteria.
- File ownership.
- Merge order.
- Validation requirements.
- External credentials, services, or deployment assumptions.

## Entry Template

```text
Date:
Author:
Change type:
Affected plan section:
Reason:
Decision:
Validation impact:
Reviewer notes:
```

## 2026-06-24 - Initial Launch Contract

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: baseline.
Affected plan section: all sections of `docs/EVO_LAUNCH_PLAN.md`.
Reason: user requested `/goal-plan-contract` as the first launch-control slice,
blocking implementation lanes.
Decision: create the launch plan contract, append-only change log, research
summary, acceptance criteria, file ownership, and merge order before coding.
Validation impact: docs-only slice still requires real repo validation through
`npm run lint`, `npx next typegen && npx tsc --noEmit`, and `npm run build`, or
an exact blocker report.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Record Existing Validation Blockers

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: validation constraint.
Affected plan section: research summary, plan-slice acceptance criteria,
required validation commands.
Reason: real validation found an existing dependency security advisory and a
Next.js workspace-root warning after the launch contract was drafted.
Decision: document `npm audit --audit-level=moderate` as a required gate and
record that the current audit failure must be resolved in a future dependency or
security lane because the forced npm suggestion would install an incompatible
Next.js downgrade. Also record the Turbopack root warning as a future config
cleanup item.
Validation impact: lint, route/type validation, and build can pass; npm audit
currently exits non-zero due the existing Next/PostCSS advisory.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add Brand Research Lane

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope and merge order.
Affected plan section: goal slice, merge order, file ownership, launch acceptance.
Reason: user requested `/goal-brand-research` after the initial launch contract:
use public evoadmissions.com, amoCRM docs, and public study-abroad CRM patterns
to produce product copy, data model terms, realistic countries/program flows,
and source-backed UX requirements.
Decision: set the current contract slice to `/goal-brand-research` and insert a
docs-only `brand-research` lane immediately after `plan-contract` and before
implementation lanes. The lane owns `docs/EVO_BRAND_RESEARCH.md`; it may update
this change log only for discovered scope or validation constraints and must not
modify runtime app code.
Validation impact: run real repo validation after the docs change:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, and
`npm audit --audit-level=moderate` with any blocker reported exactly.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add Architecture Contract Lane

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope, architecture, acceptance criteria, file ownership, and merge order.
Affected plan section: goal slice, research summary, acceptance criteria, file
ownership, merge order, required validation commands.
Reason: user requested `/goal-architecture`: redesign app architecture around
roles, routes, domain entities, amoCRM adapter contract, student portal
contract, and prepared AI contract.
Decision: add an `architecture-contract` lane after docs/research planning and
before runtime behavior hardening. This lane owns schema/interface decisions and
adds compile-checked TypeScript contract modules without claiming live amoCRM,
student portal, or Anthropic integration success.
Validation impact: run the real repo validation gates after implementation:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, and
`npm audit --audit-level=moderate`; report any exact blocker rather than
substituting mocks or fake integration success.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add Prepared AI Prompts Lane

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope, architecture, acceptance criteria, file ownership, and merge order.
Affected plan section: goal slice, execution rules, file ownership, merge order,
presentation-readiness.
Reason: user requested `/goal-ai-prompts`: build a prepared-response AI layer
for the first presentation, including a prompt library, response scenarios, an
AI drawer, a WhatsApp/reply generator, and a deterministic streaming UI.
Decision: set the current contract slice to `/goal-ai-prompts` and add a narrow
implementation lane before broader runtime integration work because the user
explicitly requested prepared responses for the first presentation. The lane may
create or edit `src/lib/prepared-ai.ts`,
`src/components/PreparedAiDrawer.tsx`, `src/components/WaReplyBox.tsx`,
`src/app/(staff)/whatsapp/[id]/page.tsx`, and `src/lib/whatsapp.ts` only for the
minimal truthfulness guard that prevents missing WhatsApp credentials from being
reported as demo send success. It must use real conversation/lead data from the
current repo, must stay deterministic, must be gated by the prepared-AI contract
to first-presentation mode, and must not route prepared responses through the
live Anthropic endpoints or imply live WhatsApp delivery success.
Validation impact: run the real repo gates after implementation:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, and
`npm audit --audit-level=moderate`; report exact blockers for any non-zero gate.
Reviewer notes: first independent code-reviewer review requested changes for
plan freshness, append-only ordering, WhatsApp demo-send truthfulness, and the
dirty baseline commit boundary.

## 2026-06-24 - Approve Separate Baseline Commit For Prepared AI

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: merge order and validation constraint.
Affected plan section: merge order, acceptance criteria, validation.
Reason: the prepared-AI slice depends on CRM runtime baseline files that were
not previously tracked, and a single baseline-plus-prepared-AI commit would make
slice review too broad and non-buildable from a clean checkout.
Decision: create a separate baseline commit first with only the pre-existing CRM
runtime files required to make the app build from a clean checkout, then commit
the prepared-AI response workflow separately. Do not include prepared-AI files
or behavior in the baseline commit except inseparable runtime baseline.
Validation impact: run real lint, type/route validation, and production build
after the baseline commit; rerun the real validation gates after the prepared-AI
commit and report the existing audit blocker exactly.
Reviewer notes: user explicitly approved this commit order before the baseline
commit was created.

## 2026-06-24 - Add Admissions CRM Core Slice

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope, architecture, acceptance criteria, file ownership, and merge order.
Affected plan section: goal slice, merge order, file ownership, validation.
Reason: user requested `/goal-admissions-crm`: build the core staff CRM for
Command Center, Admissions Pipeline, Student 360, tasks, documents,
applications, and finance overview.
Decision: set the current contract slice to `/goal-admissions-crm` and add a
focused `admissions-crm-core` lane after the prepared-AI lane. The lane may edit
`docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
`src/app/(staff)/dashboard/page.tsx`, `src/app/(staff)/sales/page.tsx`,
`src/app/(staff)/clients/page.tsx`, `src/app/(staff)/clients/[id]/page.tsx`,
`src/app/(staff)/tasks/page.tsx`, `src/app/(staff)/finance/page.tsx`,
`src/app/(staff)/layout.tsx`, `src/app/(staff)/applications/page.tsx`,
`src/app/(staff)/documents/page.tsx`, `src/lib/queries.ts`,
`src/lib/domain.ts`, `src/lib/i18n.ts`, and shared UI only if needed for these
surfaces. It must use the existing Next.js App Router, SQLite data, query
functions, and Server Actions; no hidden mocks, demo-only success paths, fake
integration claims, or data migration are part of this slice.
Validation impact: run the real repo gates after implementation:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, and
`npm audit --audit-level=moderate`; report exact blockers for any non-zero gate.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Include Shared CRM Server Action Hardening

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: file ownership and acceptance criteria.
Affected plan section: `/goal-admissions-crm` file ownership and validation.
Reason: the new global applications and documents queues submit through the
existing shared status Server Actions, so the slice needs those actions to
validate status input and revalidate the new queue routes.
Decision: add `src/lib/actions.ts` to the `/goal-admissions-crm` write set for
the narrow purpose of application/document status validation and route
revalidation. Do not add new mutation paths or fake persistence.
Validation impact: unchanged real repo gates:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, and
`npm audit --audit-level=moderate`.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Clarify Admissions CRM Acceptance Criteria

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: acceptance criteria.
Affected plan section: `/goal-admissions-crm` acceptance criteria.
Reason: the launch plan current slice and deliverables already name
`/goal-admissions-crm`, but the detailed slice acceptance section still carried
the prior prepared-AI slice checklist.
Decision: replace the stale prepared-AI slice checklist in
`docs/EVO_LAUNCH_PLAN.md` with admissions CRM acceptance criteria for Command
Center, Admissions Pipeline, Student 360, global applications and documents
queues, tasks, finance, navigation, status actions, and real validation. This
does not add student-portal implementation; the student portal remains after the
CRM contracts stabilize.
Validation impact: unchanged real repo gates:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, and
`npm audit --audit-level=moderate`.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Expose Finance Overview Read-Only To Staff

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: acceptance criteria and role access.
Affected plan section: `/goal-admissions-crm` staff finance overview surface.
Reason: independent reviewer found that Command Center links exposed
`/finance` to all staff while the finance page redirected non-admin/non-finance
roles back to `/dashboard`, creating a broken route loop for the required CRM
finance overview.
Decision: make the finance overview route and navigation visible to staff as a
read-only CRM operating surface, while keeping payment mutation controls and
Server Actions restricted to admin and finance roles. This is not a broad role
model redesign and does not add student-portal or external integration work.
Validation impact: rerun real gates after the access correction:
`npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`, built
app authenticated smoke, and `npm audit --audit-level=moderate` with the
existing advisory reported exactly.
Reviewer notes: addresses first independent code-reviewer `changes_requested`.

## 2026-06-24 - Include Admissions Metadata Copy

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: file ownership and i18n copy.
Affected plan section: `/goal-admissions-crm` visible admissions copy.
Reason: built-app smoke showed the staff pages still rendered root browser
metadata as `EduAdmin` and generic client CRM copy, even after the staff shell
and dictionaries were updated toward EVO Admissions/student language.
Decision: add `src/app/layout.tsx` to the `/goal-admissions-crm` write set for
the narrow purpose of replacing root metadata title and description with EVO
Admissions/student copy. No route, auth, portal, external integration, or schema
behavior changes are included.
Validation impact: rerun real lint, route type generation, TypeScript, build,
built-app authenticated smoke, and `npm audit --audit-level=moderate`; report
the existing Next/PostCSS advisory exactly if it remains non-zero.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add CRM Flow Scenario Evaluation

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: validation scope and file ownership.
Affected plan section: `crm-core-flow-verification`, `validation-baseline`, and
`/goal-admissions-crm` acceptance evidence.
Reason: the active goal requires 30 realistic scenarios covering major CRM
capabilities, clear success criteria, consistent pass/fail evaluation, evidence
for every outcome, fixes for failures, and a complete rerun after stabilization.
Decision: add `scripts/evaluate-scenarios.mjs`, a package script for the same
runner, `docs/SCENARIO_EVALUATION.md` as the generated evidence artifact, and a
narrow `EVO_DB_PATH` runtime override in `src/lib/db.ts` so scenarios run against
an isolated copy of the real SQLite data through the built Next.js server. The
runner may exercise missing external credentials only as explicit
`not_configured` or failed integration states; it must not claim live WhatsApp,
telephony, amoCRM, or Anthropic success.
Validation impact: run the scenario runner plus the real gates:
`node node_modules/eslint/bin/eslint.js .`,
`node node_modules/next/dist/bin/next typegen`,
`node node_modules/typescript/bin/tsc --noEmit`,
`node node_modules/next/dist/bin/next build`, and
`npm audit --audit-level=moderate` with the known Next/PostCSS advisory reported
if still present.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add Student Portal Slice

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope, acceptance criteria, file ownership, and validation.
Affected plan section: goal slice, acceptance criteria, file ownership,
validation commands, and merge order.
Reason: user requested `/goal-student-portal` after the admissions CRM contracts
were committed and merged into `main`, so the portal can now read stable
student, application, document, payment, task, and update contracts.
Decision: set the current contract slice to `/goal-student-portal`. The lane may
edit `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
`src/app/portal/page.tsx`, `src/lib/contracts/student-portal.ts`,
`src/lib/queries.ts`, `src/lib/i18n.ts`, and `scripts/scenarios/*` for focused
portal scenario coverage. The portal must stay authenticated and client-only,
read real SQLite CRM data, show stage/progress, next action, target study
context, applications, documents, visa, payments, latest updates, manager and
curator contact context, and open tasks/work where relevant. This slice must
not redo admissions CRM or implement live amoCRM, WhatsApp, telephony, or
Anthropic integrations.
Validation impact: run real repo gates after implementation:
`node node_modules/eslint/bin/eslint.js .`,
`node node_modules/next/dist/bin/next typegen`,
`node node_modules/typescript/bin/tsc --noEmit`,
`node node_modules/next/dist/bin/next build`, `npm run scenarios`, built-app
browser smoke for `/portal` as a client and at least one staff route, and
`npm audit --audit-level=moderate` with the known Next/PostCSS advisory reported
exactly if it remains non-zero.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Repair Student Portal Contract Alignment

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: validation repair.
Affected plan section: `/goal-student-portal` acceptance evidence and
validation.
Reason: post-merge TypeScript validation showed the portal page still consumed
the old row-shaped snapshot while `src/lib/queries.ts` now returns the
camelCase `StudentPortalSnapshot` contract shape.
Decision: update only `src/app/portal/page.tsx` and the narrow query return
types needed for `tsc --noEmit`; no product scope, route, auth, integration,
schema, or data migration change.
Validation impact: rerun `node node_modules/typescript/bin/tsc --noEmit` and,
if feasible, the relevant static gates.
Reviewer notes: post-merge validation repair before continuing
`/goal-amocrm-integration`.

## 2026-06-24 - Add amoCRM Integration Foundation Slice

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope, architecture, acceptance criteria, file ownership, validation requirements, and external-service assumption.
Affected plan section: goal slice, acceptance criteria, file ownership, merge order, and required validation commands.
Reason: orchestrator delegated `/goal-amocrm-integration` after the admissions CRM and student portal lanes were merged. This changes the active slice from student portal work to a runtime amoCRM integration foundation over the existing contract.
Decision: set the current contract slice to `/goal-amocrm-integration`. The lane may edit `docs/EVO_LAUNCH_PLAN.md`, this change log, `src/lib/contracts/amo-crm.ts` only for narrow contract corrections, `src/lib/amocrm.ts`, `src/lib/actions.ts`, `src/app/(staff)/settings/page.tsx`, `src/lib/i18n.ts`, and scenario evidence files. It will store amoCRM configuration in existing SQLite `settings` rows, validate and sanitize admin-submitted amoCRM account domains, mask secret values in the UI, expose truthful `configured` / `not_configured` / `blocked` status, and call real amoCRM OAuth/API endpoints only when required credentials are present. It will not implement WhatsApp, telephony, Anthropic, staff CRM, or student portal changes, and it will not add an unauthenticated amoCRM webhook receiver.
Validation impact: run real repo gates after implementation: `node node_modules/eslint/bin/eslint.js .`, `node node_modules/next/dist/bin/next typegen`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next build`, `npm run scenarios`, and `npm audit --audit-level=moderate`; additionally smoke `/settings` as admin and non-admin through the scenario runner so missing amoCRM credentials are explicit and settings cannot be saved by non-admin staff. Report the known Next/PostCSS advisory exactly if audit remains non-zero.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add QA Launch Readiness Slice

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: scope, acceptance criteria, file ownership, merge order, validation requirements, and external-service assumption.
Affected plan section: goal slice, acceptance criteria, file ownership, merge order, required validation commands, and launch acceptance evidence.
Reason: orchestrator delegated `/goal-qa-launch` after admissions CRM, student portal, and amoCRM integration were merged into `main`. This changes the active work from feature implementation to release and first-presentation QA readiness.
Decision: set the current contract slice to `/goal-qa-launch`. This lane may edit `docs/EVO_LAUNCH_PLAN.md`, this change log, and a new `docs/QA_LAUNCH_REPORT.md` evidence artifact; it may edit runtime, scenario, or copy files only for launch-blocking fixes, validation coverage, or small UI/copy clarity issues discovered by the QA pass. The lane must use a fresh browser context, desktop and mobile viewports, one scored checklist, local screenshots stored outside tracked docs unless the repo already has an artifact pattern, and must name missing WhatsApp, telephony, amoCRM, or Anthropic credentials as `not_configured` or blockers instead of claiming integration success. Prepared AI output may be presented only as prepared content and must not count as live Anthropic success.
Validation impact: run the real QA browser pass before and after any changes, then run `node node_modules/eslint/bin/eslint.js .`, `node node_modules/next/dist/bin/next typegen`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next build`, `npm run scenarios`, and `npm audit --audit-level=moderate`. Report the known Next/PostCSS advisory exactly if audit remains non-zero.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Include QA Scenario Evidence Refresh

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: file ownership and validation evidence.
Affected plan section: `/goal-qa-launch` named write set and validation evidence.
Reason: the required `npm run scenarios` gate regenerates `docs/SCENARIO_EVALUATION.md` as the canonical scenario evidence artifact.
Decision: include the regenerated `docs/SCENARIO_EVALUATION.md` in the `/goal-qa-launch` write set only as validation evidence. The refreshed report must still show real scenario execution and no fake integration success.
Validation impact: unchanged required gates; scenario evidence remains generated by `npm run scenarios`.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Patch Next Nested PostCSS Advisory

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: dependency security hardening and validation requirements.
Affected plan section: launch acceptance security and validation/build readiness.
Reason: the final production readiness run still fails `npm audit --audit-level=moderate` because `next@16.2.9` depends on nested `postcss@8.4.31`, which is affected by `GHSA-qx2v-qp2m-jg93`. The latest published `next` and `eslint-config-next` versions are still `16.2.9`, and npm's suggested forced fix would install `next@9.3.3`, a breaking downgrade.
Decision: add an npm `overrides` entry that forces Next's nested PostCSS dependency to the already-resolved patched `postcss@8.5.15`, and update the QA launch report so the resolved audit state is no longer documented as an open blocker. Do not downgrade Next or change application architecture. Accept the override only if audit, lint, typegen, TypeScript, production build, scenarios, and a browser smoke pass prove the app still works.
Validation impact: rerun `npm audit --audit-level=moderate`, `node node_modules/eslint/bin/eslint.js .`, `node node_modules/next/dist/bin/next typegen`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/next/dist/bin/next build`, `npm run scenarios`, and at least a production browser smoke for login/dashboard/portal/settings after the override.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Promise Audit Telephony Truthfulness Fix

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: promise audit, integration truthfulness, and validation coverage.
Affected plan section: launch acceptance security, integration truthfulness, and scenario evidence.
Reason: the customer-facing launch contract says missing WhatsApp, telephony, amoCRM, or Anthropic credentials must be named as `not_configured` or blockers, but the telephony webhook path currently accepts call inserts when no `tel_api_key` is configured. That can make an unconfigured telephony integration look operational.
Decision: update only the telephony webhook behavior and the affected scenario coverage so missing telephony credentials reject with an explicit `not_configured` error and do not insert calls. Do not edit public marketing copy or production/public copy without approval.
Validation impact: rerun the affected scenario runner path, then the required static/build gates that cover the changed route.
Reviewer notes: pending independent code-reviewer review.
