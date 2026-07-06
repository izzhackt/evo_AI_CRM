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

## 2026-06-24 - Add Internal Promise Audit Register

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: internal documentation and completion evidence.
Affected plan section: launch acceptance, promise audit evidence, and open approval decisions.
Reason: the promise-audit goal requires a durable list of customer-facing promises from public marketing, repo documentation, demos, and AI surfaces, with evidence labels and remaining decisions. Public/production copy changes still require explicit approval.
Decision: add an internal `docs/PROMISE_AUDIT.md` register. Do not narrow public EVO marketing or in-app product copy in this step.
Validation impact: run a documentation consistency check and keep the prior static/build/scenario evidence as the behavioral proof.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add Promise Audit Verification Script

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: validation coverage.
Affected plan section: promise audit evidence and AI answer truthfulness.
Reason: the promise audit should be rerunnable enough to catch missing audit labels, unresolved high-risk decisions, and high-risk guarantee wording in prepared AI answers.
Decision: add a local script that validates `docs/PROMISE_AUDIT.md` structure and scans prepared AI response text for unsupported guarantee-style claims. Do not change public marketing, production UI copy, or live AI prompts in this step.
Validation impact: run the new script plus focused lint/type checks for changed files.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Professionalize Controlled Promise Surfaces

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: product copy, AI answer guardrails, and promise-audit validation.
Affected plan section: promise audit evidence, integration truthfulness, and AI answer truthfulness.
Reason: the user approved doing the remaining controlled surfaces at production/professional level. The repo can safely narrow in-app telephony copy and live AI system instructions without changing external public website copy.
Decision: change in-app telephony copy in Russian, Kyrgyz, and English from demo-mode language to explicit `not_configured`; add live AI guardrails that forbid admission, scholarship, visa, deadline, price, and provider-success guarantees without CRM/provider evidence; extend the promise-audit verifier to enforce those controlled surfaces.
Validation impact: run `npm run promise-audit`, focused lint/type checks, production build, and affected scenarios.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Add External Public Copy Handoff

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: external website handoff and promise-audit evidence.
Affected plan section: public marketing promise remediation.
Reason: the remaining unsupported high-risk claims live on the external `evoadmissions.com` website, whose source/CMS is not present in this repo. The CRM repo can still provide exact replacement copy and acceptance checks for whoever owns that site.
Decision: add `docs/PUBLIC_PROMISE_COPY_CHANGESET.md` with page-by-page replacement copy, evidence requirements for numeric claims, and acceptance checks. Link the promise audit to that handoff instead of pretending this CRM repo changed the external website.
Validation impact: run `npm run promise-audit` and documentation consistency checks.
Reviewer notes: pending independent code-reviewer review.

## 2026-06-24 - Tighten Telephony Provider Configuration Gate

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: reviewer-requested correctness fix.
Affected plan section: promise audit / telephony integration truthfulness.
Reason: independent review found that telephony was still treated as configured when `tel_api_key` existed but `tel_provider` was empty. That could hide the `not_configured` state and let the webhook proceed without a provider configuration.
Decision: require both `tel_provider` and `tel_api_key` for telephony to count as configured. The webhook must return `not_configured` with exact missing fields before insertion, and the calls page must keep the `not_configured` warning for partial provider/key setup.
Validation impact: extend S29 to cover missing-key and missing-provider states with no call insertion, then rerun promise audit, lint, typegen, TypeScript, production build, scenarios, and npm audit.
Reviewer notes: addresses independent review finding from reviewer agent `019ef941-17d6-7631-b50d-52779e2c62a4`.

## 2026-06-24 - Add Live Public Promise Audit Gate

Date: 2026-06-24, workspace timezone.
Author: Codex.
Change type: external marketing verification.
Affected plan section: promise audit completion gate.
Reason: the remaining high-risk unsupported promises live on the external `evoadmissions.com` website, whose source/CMS is not in this repo. A handoff document alone is easy to stale; the team needs a repeatable live check that proves whether those public claims still block completion.
Decision: add `npm run public-promise-audit`, backed by `scripts/audit-public-promises.mjs`, to fetch the public pages, write `docs/PUBLIC_PROMISE_LIVE_AUDIT.md`, and exit nonzero while tracked high-risk public claims remain. Add `npm run public-promise-audit:self-test` so the accepted future pass paths are tested without needing the external site to change during local validation. Keep the normal local CRM `npm run promise-audit` as a repo-owned surface verifier.
Validation impact: run `npm run public-promise-audit` and expect it to fail until the external website/CMS is changed or evidence-backed copy is supplied; run `npm run public-promise-audit:self-test` and rerun local lint/type/build/scenario gates for repo-owned changes.
Reviewer notes: pending independent code-reviewer review.

## 2026-07-03 - Lead Agent Owns WAHA Webhook

Date: 2026-07-03, workspace timezone.
Author: Codex.
Change type: architecture, merge order, file ownership, and validation scope.
Affected plan section: add `/goal-lead-agent-webhook-ownership` implementation
block after `/goal-qa-launch`.
Reason: user approved the source-of-truth recommendation: the lead-agent should
receive WAHA webhooks first, resolve amoCRM identity, then update EVO CRM as the
operator UI. This avoids local-first CRM leads competing with amoCRM.
Decision: move WAHA webhook ownership to the private `evo-lead-agent` FastAPI
service. Add a signed internal CRM sync endpoint so the lead-agent can update
local EVO CRM lead/conversation/message shadow state after amoCRM resolution and
AI decision. Persist `amo_lead_id`, `amo_contact_id`, and lead-agent state in
the CRM database while keeping amoCRM as source of truth. Keep autoreply and
outbound disabled by default until real WAHA, amoCRM, CRM sync, and Anthropic
configuration are verified.
Validation impact: run focused Python tests in `evo-lead-agent`; run parent
lint/type/build gates with the repo's Node 22 runtime after excluding the nested
lead-agent repo from parent lint scope; run deterministic internal sync route
checks locally. Live WhatsApp/amoCRM validation remains blocked until real
credentials and server configuration are supplied.
Reviewer notes: pending independent launch-control review.

## 2026-07-06 - EVO Inbox Issues 13 And 14 Validation Evidence

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: validation evidence, live-service blocker record, and release
guardrails.
Affected plan section: `/goal-evo-inbox-companion` issue #13/#14 validation
gate.
Reason: implementation completed for the WAHA session configuration/authenticated
webhook boundary and amoCRM identity resolver, so the branch needs reproducible
local validation and explicit provider-readiness evidence before PR.
Decision: no deployment was attempted and `/opt/evo-crm` was not used as a
command target. Live WAHA validation is blocked because no WAHA base URL/API
key, Supabase URL/service-role key, or `ENCRYPTION_KEY` is present in the
environment or `.env.local`. Live amoCRM validation is blocked because no
amoCRM domain/access token, Supabase URL/service-role key, or `ENCRYPTION_KEY`
is present in the environment or `.env.local`, and no clearly intended real
test phone is available. No live WAHA or amoCRM success is claimed.
Validation impact:
- `npm ci --include=dev`: passed; 680 packages audited, 0 vulnerabilities.
- `npm test`: passed; 68 test files, 643 tests.
- `npm run lint`: passed with 10 pre-existing warnings in unrelated inbox,
  pipeline, contact, legacy webhook, and image components.
- `npm run typecheck`: passed.
- `npm run build`: passed with existing Next.js workspace-root and
  middleware/proxy warnings.
- Targeted checks: the requested `rg` commands were run; the two commands that
  included a non-existent `app` path were rerun as `src docs .env.local.example`
  from `agent-lead2-crmwhatsapp/`. Broad Meta results remain in intentionally
  disabled first-launch surfaces (templates, broadcasts, automations, flows, and
  the legacy Meta webhook). A focused active-path scan of WAHA config/send/status
  code found no Meta endpoint or credential references.
- Presence-only live-readiness check: `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, WAHA credential variables, and
  amoCRM credential variables are missing from the shell environment, and
  `.env.local` is absent.
Reviewer notes: pending independent launch-control review.

## 2026-07-03 - Lead Agent Review Fixes And Dirty Baseline Boundary

Date: 2026-07-03, workspace timezone.
Author: Codex.
Change type: reviewer-requested contract fix and scope clarification.
Affected plan section: `/goal-lead-agent-webhook-ownership` write set and
acceptance criteria.
Reason: independent review found two correctness gaps: lead-agent-to-CRM sync
must use the parent CRM's camelCase payload contract, and WAHA `session.status`
events must still update CRM session/account state after WAHA ownership moves
from the CRM webhook to the lead-agent webhook. The same review also noted that
the parent worktree already contained unrelated dirty files from earlier lanes,
so this block needs a sharper boundary for launch-control review.
Decision: add regression coverage for the lead-agent camelCase sync payload,
forward WAHA session status events from lead-agent to the signed internal CRM
endpoint, and make the parent internal endpoint accept both
`whatsapp.message` and `whatsapp.session_status`. Expand the named write set to
include the CRM read model, WhatsApp operator page, bootstrap schema, Docker
ignore, and TypeScript exclusion files touched by this implementation. Treat
pre-existing dirty files outside this write set as out-of-scope unless a later
lane adopts them explicitly.
Validation impact: rerun lead-agent Python tests and ruff; rerun parent lint,
Next typegen, TypeScript, production build, and deterministic signed internal
route checks for both message and session-status sync. Local Compose config is
blocked until the real env files required by `docker-compose.prod.yml` exist:
`.env.production`, `.env.waha`, and `.env.lead-agent`. Live provider validation
remains blocked until real WAHA, amoCRM, CRM sync, and Anthropic credentials are
configured on the server.
Reviewer notes: addresses launch-control reviewer findings from agent
`019f29ba-61b5-74b3-9287-2ca2705a469c`.

## 2026-07-05 - Add Gemini Receive-Only Rollout Plan

Date: 2026-07-05, workspace timezone.
Author: Codex.
Change type: scope, architecture, acceptance criteria, validation, and merge order.
Affected plan section: add `/goal-gemini-receive-only-rollout` after
`/goal-lead-agent-webhook-ownership`.
Reason: user approved the first live rollout definition as a receive-only proof
on the production VPS, using a dedicated EVO test WhatsApp number, real marked
amoCRM test contact/lead, signed CRM sync, and Gemini 3.5 Flash draft review
instead of Anthropic.
Decision: add `docs/GEMINI_RECEIVE_ONLY_ROLLOUT_PRD.md`,
`docs/adr/0001-use-gemini-for-lead-agent-draft-review.md`,
`docs/LONG_RUN_CODEX_LAUNCH_HANDOFF.md`, and `CONTEXT.md` as the planning and
handoff artifacts for launch-control execution. Gemini provider replacement is
a separate implementation prerequisite before live rollout. WhatsApp outbound
must remain disabled for the first live proof.
Validation impact: planning-only change requires documentation review and issue
publication. Implementation blocks must run lead-agent Python tests and ruff,
parent CRM lint/type/build/scenarios where touched, and live production
preflight/proof only with real WAHA, amoCRM, CRM sync, Gemini, and server
credentials.
Reviewer notes: pending long-run launch-control execution.

## 2026-07-05 - Parent CRM Draft Review Evidence

Date: 2026-07-05, workspace timezone.
Author: Codex.
Change type: schema, file ownership, and validation scope.
Affected plan section: `/goal-gemini-receive-only-rollout` issue #3 parent CRM
slice.
Reason: receive-only draft review evidence must be stored separately from
WhatsApp outbound message copies so staff can verify the Gemini draft without
the Operator UI treating it as sent WhatsApp.
Decision: add explicit lead/conversation draft-review shadow fields for text,
status, provider, and model. Signed lead-agent sync may persist those fields
with inbound message state, amoCRM identity, and lead-agent state. `wa_messages`
remains the history table for inbound and actual outbound message copies; draft
review text is not inserted as a sent outbound row unless a future signed sync
payload provides explicit outbound delivery evidence.
Validation impact: rerun parent CRM `npm run lint`, `npx next typegen`,
`npx tsc --noEmit`, `npm run build`, and `npm run scenarios`. Scenario coverage
must include bad-signature rejection, signed sync persistence, Operator UI draft
review labeling, and zero outbound rows for receive-only draft evidence.
Reviewer notes: pending independent launch-control review for issue #3.

## 2026-07-05 - Issue 4 Receive-Only Production Preflight

Date: 2026-07-05, workspace timezone.
Author: Codex.
Change type: active slice, file ownership, readiness contract, validation.
Affected plan section: `/goal-gemini-receive-only-rollout` issue #4 block.
Reason: issue #4 is unblocked after the Gemini provider prerequisite and needs
the production preflight path to prove WAHA, amoCRM, CRM sync, Gemini, admin,
and server env settings before issue #5 live message proof.
Decision: set the active slice to
`/goal-gemini-receive-only-production-preflight`; update parent deployment docs
and Compose env ownership; update the nested lead-agent readiness/preflight/CLI
path so `receive_only_rollout` is distinct from `live_whatsapp_outbound`, exact
missing input names are reported, and local smoke remains no-outbound.
Validation impact: run `uv run pytest` and `uv run ruff check .` in
`evo-lead-agent`; run parent CRM validation because `deploy/README.md`,
`deploy/env.lead-agent.example`, and `docker-compose.prod.yml` are touched.
No production proof, outbound WhatsApp, or live provider success claim is part
of this block.
Reviewer notes: pending independent launch-control review.

## 2026-07-05 - Issue 4 Review Fixes

Date: 2026-07-05, workspace timezone.
Author: Codex.
Change type: reviewer-requested deployment-doc and contract correction.
Affected plan section: `/goal-gemini-receive-only-rollout` issue #4 block.
Reason: independent launch-control review found the VPS preflight docs used
host-side `uv run` with container-only `/app/data` and Docker DNS names, and an
older launch-plan acceptance bullet still referenced Anthropic/autoreply-disabled
semantics.
Decision: document production preflight as `docker compose exec lead-agent`
using the installed `evo-lead-agent-*` console scripts inside the container, and
replace the stale Anthropic/autoreply-disabled bullet with Gemini receive-only
semantics: autoreply may be enabled only for draft review, outbound remains
disabled.
Validation impact: rerun parent lint/build checks through the pre-push hook and
request independent re-review. No production proof or outbound WhatsApp change.
Reviewer notes: addresses reviewer agent `019f32d0-96c3-7051-9149-eec6cb5ef73c`.

## 2026-07-06 - Parent Repo Owns EVO Lead-Agent Source

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: source-of-truth, file ownership, deployment workflow.
Affected plan section: `/goal-lead-agent-webhook-ownership`,
`/goal-gemini-receive-only-rollout`, deployment source layout.
Reason: user clarified that `nik1t7n/kanttsp-lead-agent` is a different
project that only shares the broad idea. EVO production must not use that
external repo as the source of truth.
Decision: make `izzhackt/evo_AI_CRM` own the EVO-specific lead-agent source as
tracked files under `evo-lead-agent/`. Remove the parent ignore rule for that
directory and stop documenting the lead-agent as a private nested repo clone.
Do not vendor the unrelated research snapshot clones under
`evo-lead-agent/research/repos`; keep only the product runtime, tests, examples,
and lead-agent project docs needed to build and validate the service. The
production lead-agent image must install from the committed `uv.lock` rather
than resolving floating `pyproject.toml` dependency ranges during Docker build.
Validation impact: run `uv run pytest` and `uv run ruff check .` in
`evo-lead-agent`; run parent lint/type/build checks because parent ignore rules
and deployment docs change. No production proof or outbound WhatsApp change is
part of this ownership migration.
Reviewer notes: reviewer agent `019f3423-0354-7ea2-9cc7-4919a553e536` found
floating Docker dependency resolution; addressed by using locked `uv sync` in
`evo-lead-agent/Dockerfile`.

## 2026-07-06 - Parent Repo Lead-Agent Review Fixes

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: reviewer-requested webhook correctness and source-of-truth docs.
Affected plan section: `/goal-lead-agent-webhook-ownership`,
`/goal-gemini-receive-only-rollout`, deployment source layout.
Reason: independent launch-control review found WAHA `session.status` CRM sync
exceptions returned HTTP 200 with `accepted=false`, which could drop the only
session/account-state update after webhook ownership moved. The same review
found stale nested lead-agent docs still described `research/repos/*` snapshots
as owned source references.
Decision: make configured CRM sync failures for WAHA `session.status` raise a
retryable FastAPI HTTP 503 instead of acknowledging the webhook. Keep missing
CRM sync configuration as explicit not-configured behavior. Correct lead-agent
docs so `research/repos/*` is reference-only and the parent-tracked
`evo-lead-agent/` runtime is the canonical EVO product source.
Validation impact: rerun lead-agent tests and ruff, then parent lint/type/build
and Docker lead-agent image build. No production proof or outbound WhatsApp
change is part of this review fix.
Reviewer notes: addresses reviewer agent `019f342e-7ed9-7ab3-b02c-3a3e7e9670f6`.

## 2026-07-06 - EVO Inbox Companion App PRD

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: new product lane, implementation contract, deployment strategy.
Affected plan section: `/goal-evo-inbox-companion`.
Reason: user chose to stop grilling and turn the WACRM-to-EVO Inbox plan into
implementation docs. The companion app is now a separate product lane rather
than an extension of the existing lead-agent rollout.
Decision: add `docs/EVO_INBOX_COMPANION_PRD.md` and register
`/goal-evo-inbox-companion` in `docs/EVO_LAUNCH_PLAN.md`. The lane will create
`agent-lead2-crmwhatsapp/` from WACRM under MIT license, fully redesign retained
surfaces as EVO Inbox, replace Meta Cloud API with WAHA session `evo-inbox`, use
managed Supabase Cloud, keep amoCRM as identity source of truth, keep WACRM's
own AI assistant in draft-only mode, host at `inbox.evoadmissions.com` on
`hermes-vps`, and disable broadcasts, broad automations, flow-driven sending,
and AI auto-reply for first launch.
Validation impact: planning-only change. Future implementation blocks must run
their local install/lint/type/build/test gates, Supabase migration checks, and
live production checks only with real Supabase, WAHA, amoCRM, AI provider, DNS,
Caddy, and `hermes-vps` credentials.
Reviewer notes: pending implementation issue split and independent
launch-control review during future PRs.

## 2026-07-06 - EVO Inbox Issue Split And Remote Runbook

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: issue breakdown and remote execution planning.
Affected plan section: `/goal-evo-inbox-companion`.
Reason: user wants the PRD split into agent-ready implementation issues and
plans to run long Codex sessions from `hermes-vps` while keeping GitHub as the
source of truth.
Decision: add `docs/EVO_INBOX_IMPLEMENTATION_ISSUES.md` with 11 dependency
ordered implementation issues and ready-to-publish GitHub issue bodies. Add
`docs/EVO_INBOX_REMOTE_LONG_RUNS.md` with server workspace setup and three long
run prompts covering source/product pruning, core Supabase/WAHA/amoCRM paths,
and AI/redesign/deployment/proof. Because current planning context lives on
`izzhacktcodex/waha-integration` ahead of `main`, remote runs should start from
that pushed branch or an EVO Inbox branch based on it until the branch is merged.
Validation impact: planning-only change. GitHub issue publication is pending
user approval of granularity per the issue-splitting workflow.
Reviewer notes: no implementation yet.

## 2026-07-05 - EVO Inbox Issues 1 And 2 Source/Product Shell

Date: 2026-07-05, workspace timezone.
Author: Codex.
Change type: active slice, source provenance, file ownership, and validation.
Affected plan section: `/goal-evo-inbox-companion` phase 1 source setup and
phase 2 product pruning.
Reason: durable goal mode started the first EVO Inbox companion implementation
slice for issues 1 and 2: vendor the WACRM base into
`agent-lead2-crmwhatsapp/` and remove first-launch Meta/bulk-automation product
surfaces.
Decision: use the upstream MIT-licensed WACRM repository at
`https://github.com/ArnasDon/wacrm`, default branch `main`, commit
`274db1c7ce42540f989ab3f3f069d1ce7166855a`, as the source base. The write set
for this slice is `agent-lead2-crmwhatsapp/**` plus this change-log entry and
minimal repo docs/config only if needed to keep the companion app installable,
lintable, typecheckable, testable, and buildable in isolation. First-launch UI
and runtime paths for Meta Cloud API setup, Meta templates, broadcasts, broad
automations, flow-driven sending, and auto-reply must be absent or fail closed
with explicit disabled responses. WAHA, Supabase, amoCRM, AI, DNS, Caddy, Meta
live integration, and VPS deployment remain out of scope except for inert
stubs/docs needed to keep the copied app buildable.
Validation impact: run the companion app install command and the companion
lint/typecheck/test/build commands that exist after setup. Run parent repo
checks only if files outside docs/config and `agent-lead2-crmwhatsapp/**` are
touched. Do not touch `/opt/evo-crm`, do not deploy, and do not claim live
provider success.
Reviewer notes: pending independent launch-control review.

## 2026-07-06 - EVO Inbox Issue 11 Supabase Store

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: active slice, data model, documentation, validation assumptions.
Affected plan section: `/goal-evo-inbox-companion` phase 4 Supabase foundation
and GitHub issue #11.
Reason: issue #11 prepares `agent-lead2-crmwhatsapp/` for managed Supabase
Cloud as the companion app data store before WAHA or amoCRM adapter work starts.
The existing WACRM migrations already cover Supabase Auth profiles, accounts,
account members, conversations, messages, AI settings, knowledge documents, and
knowledge chunks, but they do not yet have EVO-specific amoCRM shadow identity
fields or a provider-neutral secure settings boundary for future WAHA/amoCRM
configuration.
Decision: keep this slice scoped to Supabase schema/docs/tests only. Add an
additive companion migration for nullable `amo_contact_id` / `amo_lead_id`
shadow fields and account-scoped integration settings/secrets tables. Store only
companion app data, operator UI cache/state, encrypted provider secrets, and
shadow amoCRM identifiers in Supabase; amoCRM remains canonical for lead/contact
identity and sales state. Do not implement WAHA send/webhook adapters, amoCRM
lookup/create, deployment, or `/opt/evo-crm` changes.
Validation impact: run `npm ci --include=dev`, `npm test`, `npm run lint`,
`npm run typecheck`, and `npm run build` in `agent-lead2-crmwhatsapp/`. Check
the Supabase CLI with `supabase --version`. Current official Supabase docs
consulted on 2026-07-06: CLI docs for `supabase link`, `supabase migration
list`, `supabase db push --dry-run`, `supabase db reset`, and `supabase gen
types`; RLS docs requiring RLS on exposed schema tables; API key docs that
secret/service keys bypass RLS and must never be public. If no linked Supabase
project, access token, local Docker stack, or usable CLI is present, record the
exact blocker instead of claiming migration/typegen success.
Reviewer notes: pending independent launch-control review.

## 2026-07-06 - EVO Inbox Issue 11 Validation Evidence

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: validation evidence and external-service blocker.
Affected plan section: `/goal-evo-inbox-companion` issue #11 validation gate.
Reason: issue #11 requires real companion validation and explicit Supabase
migration/typegen blocker recording when live/local Supabase is unavailable.
Decision: companion app validation was run from `agent-lead2-crmwhatsapp/`:
`npm ci --include=dev`, `npm test`, `npm run lint`, `npm run typecheck`, and
`npm run build`. Supabase validation attempts were `supabase --version`,
`docker info`, and `test -n "$SUPABASE_ACCESS_TOKEN"`.
Validation impact: npm install passed with zero vulnerabilities; tests passed
with 63 files and 625 tests; lint passed with 11 pre-existing warnings;
typecheck passed; build passed with existing Next.js workspace-root and
middleware/proxy warnings. `supabase --version` failed because `supabase` is not
installed. Docker is available, but `SUPABASE_ACCESS_TOKEN` is unset and the
Supabase CLI is missing, so linked cloud validation, local stack reset,
`supabase db push --dry-run`, and `supabase gen types` could not be run. No live
Supabase success is claimed.
Reviewer notes: pending independent launch-control review.

## 2026-07-06 - EVO Inbox Issues 13 And 14 WAHA/amoCRM Boundaries

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: active slice, architecture, file ownership, validation, and external-service assumption.
Affected plan section: `/goal-evo-inbox-companion` phases 3 and 5, GitHub issues #13 and #14.
Reason: durable goal mode started the EVO Inbox companion implementation slice
for WAHA session configuration/authenticated webhook boundary and amoCRM
identity resolution after issue #11 created the managed Supabase
settings/secrets tables.
Decision: use `integration_settings.public_config` for non-secret WAHA and
amoCRM fields and `integration_secrets.encrypted_value` for WAHA API key, WAHA
webhook HMAC secret, and amoCRM OAuth/token material through the existing
`ENCRYPTION_KEY` AES-256-GCM helper. WAHA is the active first-launch WhatsApp
transport with default session `evo-inbox`; manual text sending uses the
documented `POST /api/sendText` body `{ session, chatId, text }` and
`X-Api-Key` when configured. WAHA session status is read from
`GET /api/sessions/{session}` and accepted from authenticated webhook events,
then updates `integration_settings.status`, `last_checked_at`, and `last_error`
idempotently. The inbound message delivery path for issue #15 remains out of
scope; this slice only authenticates WAHA webhooks and handles
`session.status` events.

For amoCRM, implement a narrow server-only client over the configured account
base URL/domain with `Authorization: Bearer` API requests. OAuth/token material
and long-lived tokens are stored only as encrypted integration secrets.
Phone identity resolution searches amoCRM contacts first, creates missing
contacts/leads through `/api/v4/contacts` and `/api/v4/leads` API contracts
when configured, and persists only `amo_contact_id` / `amo_lead_id` shadow
fields in Supabase. Identity-dependent contact/conversation writes must fail
clearly when amoCRM is not configured or provider calls fail; they must not
create local-only real leads.

Current official docs consulted on 2026-07-06:
- WAHA Sessions: `https://waha.devlike.pro/docs/how-to/sessions/`
  (`GET/POST /api/sessions`, `GET /api/sessions/{name}`, status values,
  session config webhooks, HMAC key config).
- WAHA Send messages: `https://waha.devlike.pro/docs/how-to/send-messages/`
  (`POST /api/sendText`, direct chat IDs as phone digits plus `@c.us`).
- WAHA Events: `https://waha.devlike.pro/docs/how-to/events/` (webhook headers
  `X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm: sha512`, HMAC over raw body).
- WAHA Security: `https://waha.devlike.pro/docs/how-to/security/`
  (`X-Api-Key`, do not expose WAHA API publicly).
- WAHA OpenAPI: `https://waha.devlike.pro/swagger/openapi.json` (session
  create/update examples include `message` and `session.status` webhooks with
  HMAC).
- amoCRM API Reference:
  `https://www.amocrm.ru/developers/content/crm_platform/api-reference`.
- amoCRM OAuth: `https://www.amocrm.ru/developers/content/oauth/step-by-step`
  (`POST /oauth2/access_token`, `Authorization: Bearer`, refresh-token
  rotation, long-lived token option).
- amoCRM Contacts API:
  `https://www.amocrm.ru/developers/content/crm_platform/contacts-api`
  (`GET/POST /api/v4/contacts`, `custom_fields_values`, `with=leads`).
- amoCRM Leads API:
  `https://www.amocrm.ru/developers/content/crm_platform/leads-api`
  (`GET/POST /api/v4/leads`, `_embedded.contacts`).
- amoCRM Filters API:
  `https://www.amocrm.ru/developers/content/crm_platform/filters-api`
  (`query`, `filter[custom_fields_values]`, and other list filters).
Validation impact: run `npm ci --include=dev`, `npm test`, `npm run lint`,
`npm run typecheck`, and `npm run build` from `agent-lead2-crmwhatsapp/`; run
targeted `rg` checks for Meta/WAHA/amoCRM terms. Perform only read-only live
WAHA status validation if WAHA base URL and API key are present in environment
or existing config, and only safe amoCRM lookup validation if credentials and a
clearly intended test phone are present. Do not deploy and do not touch
`/opt/evo-crm`.
Reviewer notes: pending independent launch-control review.
