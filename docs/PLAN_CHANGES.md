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

## 2026-07-08 - EVO Inbox amoCRM Production Seed Path

Date: 2026-07-08, workspace timezone.
Author: Codex.
Change type: production setup tooling, proof-readiness, and secret-handling
scope.
Affected plan section: long-run EVO Inbox amoCRM connection and production
proof.
Reason: the live amoCRM external integration creation reached the account
security-confirmation step, so the production token cannot be finished until the
owner supplies the email code. Once the token exists, setup still needs a
repeatable GitHub-owned command equivalent to the WAHA/Gemini seeds instead of
manual Supabase edits or unreviewed secret handling.
Decision: add `npm run seed:prod-amocrm` plus an ignored `.env.amocrm` flow. The
command validates the provided long-lived token with the real amoCRM
`GET /api/v4/account` endpoint, upserts encrypted account-level
`integration_settings(provider='amocrm')`/`integration_secrets(access_token)`,
stores only non-secret public routing ids, and resets `not_configured`/`blocked`
CRM sync rows to `pending` so the internal retry endpoint can complete identity
sync after configuration repair. It prints only provider/account metadata and
secret names, never decrypted token material.
Validation impact: run from `agent-lead2-crmwhatsapp/`: targeted
`scripts/seed-prod-amocrm-config.test.ts`, script syntax check, lint,
typecheck, build as needed for the PR. Live amoCRM success may only be claimed
after the email confirmation code is supplied, the long-lived token is generated
and seeded, and the real account/token API call succeeds.
Reviewer notes: pending independent launch-control review.

## 2026-07-08 - EVO Inbox Reliable amoCRM Sync Buffer

Date: 2026-07-08, workspace timezone.
Author: Codex.
Change type: reliability architecture, Supabase schema, inbound webhook
behavior, retry operations, UI state, validation scope, and production proof
scope.
Affected plan section: `/goal-evo-inbox-companion` WAHA inbound and amoCRM
identity resolution.
Reason: the current WAHA inbound path resolves amoCRM identity before inserting
local Supabase inbox records. If amoCRM is not configured or the amoCRM API is
temporarily unavailable, WAHA receives an error and the inbound message can be
blocked from the operator inbox. That protects the old "amoCRM first" identity
contract but is weaker for production uptime and risks losing the operator view
of real WhatsApp messages.
Decision: keep amoCRM as the canonical identity and lead source of truth, but
make Supabase the durable intake buffer for EVO Inbox messages. The WAHA
webhook must create or find the local contact/conversation and insert the
message first, then attempt a best-effort amoCRM sync. Conversations and
messages get `crm_sync_status` with `pending`, `synced`, `not_configured`, and
`blocked`. Missing amoCRM configuration records `not_configured`; temporary
provider errors keep retryable `pending`; authentication/permission errors and
non-retryable provider errors record `blocked`. WAHA receives HTTP 200 after
the local save succeeds, including the CRM sync state, so WAHA does not retry a
message that is already safely visible in EVO Inbox.

Add a small CRM sync layer that can run from the webhook path and from an
internal retry endpoint. The retry endpoint processes only local pending
conversations/messages, attempts the existing amoCRM contact/lead resolution,
stores `amo_contact_id` and `amo_lead_id` shadow ids on success, and advances
`crm_sync_status` to `synced`. It does not make Supabase canonical for lead
identity; UI labels must present unsynced rows as local inbox messages awaiting
CRM sync, not as fully resolved amoCRM leads.

Current official docs consulted on 2026-07-08:

- Next.js 16.2.9 App Router route handler docs state that route handlers export
  HTTP method functions such as `POST(request)`, can parse request JSON with
  `request.json()`, and POST handlers are not cached by default.
- Supabase JavaScript docs show the current server-side pattern of checking
  `{ data, error }`, using `.maybeSingle()` for optional lookup, `.single()`
  after insert/select when exactly one row is expected, and throwing/returning
  on the `error` object.
- Kommo/amoCRM long-lived-token docs state private integrations use Bearer
  tokens, tokens should be saved securely, and access can be revoked.
- Kommo contact docs state contacts can be found by phone with the `query`
  parameter, and lead docs state `POST /api/v4/leads` creates one or more
  leads.
- Kommo limits docs state normal API activity is limited to 7 requests per
  second and entity list/add/update operations should be kept within documented
  limits, so the retry endpoint must process a bounded batch.

Validation impact: run from `agent-lead2-crmwhatsapp/`: targeted WAHA/amoCRM
sync tests, API route tests, schema/migration tests, `npm test`,
`npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, and a
PR diff secret scan. Production proof may only claim live WhatsApp, Supabase,
amoCRM, and Gemini behavior after the merged branch is deployed only to
`/opt/evo-inbox`, migration 036 is applied, real amoCRM settings are present,
and the real services are exercised. Do not touch `/opt/evo-crm`.
Reviewer notes: pending independent launch-control review.

## 2026-07-08 - EVO Inbox Russian Interface Toggle

Date: 2026-07-08, workspace timezone.
Author: Codex.
Change type: active slice, operator UI localization, accessibility, and
launch-readiness alignment.
Affected plan section: `/goal-evo-inbox-companion` UI launch invariant for
Russian/Kyrgyz/English locale switching.
Reason: operators need the EVO Inbox companion UI to support Russian-speaking
staff while preserving the existing English interface and the first-launch
manual-operator workflow.
Decision: add an English/Russian client-side locale provider with a persisted
EN/RU toggle in the app shell and auth/join surfaces. Keep user-entered data,
provider error payloads, API scope ids, CSV column names, template names, and
stored business values unchanged. Translate fixed product copy across the
dashboard, inbox, contacts, pipelines, settings, AI setup, API keys, member
invites, CSV import, first-launch disabled surfaces, and key accessibility
labels. The bootstrap script applies `data-locale` and `html.lang` before
hydration, matching the existing theme/mode boot pattern.
Validation impact: run from `agent-lead2-crmwhatsapp/`: `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build`, and browser smoke checks for the
language toggle on `/login` and `/dashboard` when real local auth/runtime paths
are available. Do not claim production deployment or live Gemini/Supabase proof
from this localization slice alone.
Reviewer notes: pending independent launch-control review.

## 2026-07-08 - EVO Inbox Russian Operator UI Toggle

Date: 2026-07-08, workspace timezone.
Author: Codex.
Change type: active slice, localization infrastructure and first-launch UI
translation.
Affected plan section: `/goal-evo-inbox-companion` first-launch operator
experience.
Reason: Operators need a Russian version of the EVO Inbox companion with a
visible language toggle, while customer conversations remain multilingual and
AI drafts remain constrained to Kyrgyz, Russian, or English.
Decision: add a client-side `en`/`ru` language preference for the companion app
using a typed dictionary and a visible toggle in the authenticated shell and
auth pages. Do not add locale path segments in this slice; the app is an
authenticated dashboard and a persisted local preference is sufficient without
changing routing, middleware, Supabase auth redirects, or invite URLs.

Scope boundary: translate the active first-launch operator surface: auth pages,
dashboard shell/navigation/header, AI Drafts, dashboard widgets, inbox
operator controls, contacts/pipelines surfaces, settings sections, and the
first-launch disabled page. Broadcasts, automations, and flows remain blocked
by middleware for first launch and are not accepted as translated product
surfaces in this slice. User/customer data, uploaded knowledge content,
WhatsApp message text, provider/API errors, and integration payloads must stay
as source data rather than being machine-translated by the UI.

Validation impact: run `npm run typecheck`, `npm run lint`, relevant tests, a
production build if feasible, and browser checks that English/Russian toggles
change the visible active UI without logging the user out or changing the
current route.
Reviewer notes: pending independent launch-control review.

## 2026-07-07 - EVO Inbox Gemini AI Provider

Date: 2026-07-07, workspace timezone.
Author: Codex.
Change type: companion AI provider expansion and production setup workflow.
Affected plan section: `/goal-evo-inbox-companion` draft-only AI assistant.
Reason: the live EVO Inbox companion app currently supports OpenAI and
Anthropic BYO keys only, while the requested production proof should use
Gemini 3.5 Flash for operator-reviewed AI drafts.
Decision: add Gemini as a third account-level `ai_configs.provider` value,
defaulting to model `gemini-3.5-flash`. Store the Gemini API key in the same
AES-256-GCM encrypted `ai_configs.api_key` column as existing providers, never
in client-side code or committed env files. Validate Gemini keys through
Google's server-side Gemini API before save. Add `deploy/env.gemini.example`
and `npm run seed:prod-ai` so the VPS operator can paste the real key into an
ignored `.env.gemini` file and seed the dashboard configuration repeatably.
Keep the first-launch AI behavior draft-only; do not enable automatic WhatsApp
replies.
Current provider research: Google's current Gemini API docs list
`gemini-3.5-flash` as the stable Gemini 3.5 Flash model. Google recommends the
Interactions API for access to latest models, but server-side REST is acceptable
and avoids adding a dependency:
https://ai.google.dev/gemini-api/docs/models and
https://ai.google.dev/gemini-api/docs/text-generation.
Validation impact: update unit tests for provider dispatch and Gemini response
parsing; add route-level coverage for `/api/ai/test` and `/api/ai/config`; run
companion lint, typecheck, tests, build, and a real settings save against
production only after the user provides a real Gemini API key in an ignored VPS
env/runtime file. Do not claim live AI draft success until a real Gemini
provider call succeeds with that key.
Reviewer notes: independent review found that Gemini must use the native
`system_instruction` channel, model-output parsing must ignore non-output
steps, and production preflight must require `EVO_INBOX_GEMINI_API_KEY` rather
than legacy OpenAI/Anthropic globals. Those fixes were applied before commit.

## 2026-07-08 - EVO Inbox Gemini GenerateContent Runtime

Date: 2026-07-08, workspace timezone.
Author: Codex.
Change type: companion AI provider runtime correction.
Affected plan section: `/goal-evo-inbox-companion` Gemini draft provider and
production seed workflow.
Reason: real production validation with the user-provided Gemini key showed
that the Interactions API request with `store:false` returned HTTP 200 but no
inline output steps/text. A follow-up live Google call to `models/{model}:generateContent`
with `store:false`, `systemInstruction`, and a realistic output budget returned
the expected `OK` text for `gemini-3.5-flash`.
Decision: use the Gemini GenerateContent REST endpoint for EVO Inbox Gemini
drafts and `npm run seed:prod-ai` validation. Keep the same encrypted
account-level key storage, keep `store:false`, pass business policy through
`systemInstruction`, pass the WhatsApp transcript through `contents`, set
Gemini thinking to `MINIMAL` only for Gemini 3 model ids, and parse only
candidate text parts.
Validation impact: update Gemini provider tests, run companion lint,
typecheck, tests, and build, redeploy `/opt/evo-inbox`, rerun the real seed
with the production `.env.gemini`, and verify dashboard AI setup against the
real production app. Do not claim live AI draft generation until a real app
draft/playground request succeeds with the seeded key.
Reviewer notes: independent review found unconditional `thinkingLevel` would
break older Gemini model ids and the empty-output regression needed explicit
coverage. Both were fixed before deployment.

## 2026-07-07 - EVO Inbox Neutral Edge Proxy Cutover

Date: 2026-07-07, workspace timezone.
Author: Codex.
Change type: deployment topology, public edge proxy, server ownership boundary.
Affected plan section: EVO Inbox hermes-vps deployment and production proof.
Reason: `acadis-caddy-1` owned host ports `80/443`, but Acadis is a separate
project and must not remain the public edge dependency for EVO Inbox.
Decision: add an EVO-owned edge proxy Compose unit named `evo-edge-caddy` on
the neutral Docker network `evo_public_web`. EVO Inbox remains deployed from
`/opt/evo-inbox` and proxies publicly as `inbox.evoadmissions.com` to
`evo-inbox-app:3000`. The separate private WAHA service remains
`evo-inbox-waha` on `evo_inbox_private`, with no public port mappings. The
legacy root EVO CRM Compose default network is changed from
`acadis_acadis_web` to `evo_public_web` so future EVO deploys do not recreate
the Acadis dependency.

Operational rule: preserve `/opt/acadis` and its Docker volumes when archiving
Acadis, but stop the Acadis stack before starting `evo-edge-caddy` if Acadis
owns `80/443`. Public EVO routes should be served from
`agent-lead2-crmwhatsapp/deploy/Caddyfile.evo-edge`. Do not claim production
proof until real DNS, WAHA QR/session, amoCRM, AI provider, and test WhatsApp
checks pass through the live path.

Current official docs consulted on 2026-07-07:

- Docker Compose networking:
  `https://docs.docker.com/compose/how-tos/networking/` documents service
  discovery on shared Compose networks.
- Docker Compose networks reference:
  `https://docs.docker.com/reference/compose-file/networks/` documents external
  reusable networks and explicit service network attachment.
- Caddy reverse proxy quick-start:
  `https://caddyserver.com/docs/quick-starts/reverse-proxy` documents using
  Caddy as a production reverse proxy.
- Caddy `reverse_proxy` directive:
  `https://caddyserver.com/docs/caddyfile/directives/reverse_proxy` documents
  upstream proxying from a Caddyfile.

Validation impact: run deployment config tests, Compose config rendering for
both inbox and edge Compose files, full test/lint/typecheck/build where changed
runtime behavior is touched, then perform real VPS container, port, and HTTP
checks. No live WhatsApp/amoCRM/AI success can be claimed until real credentials
and messages are exercised.

## 2026-07-06 - EVO Inbox Issues 17-19 Production-Ready Preflight

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: active slice, AI safety, product redesign, deployment support,
proof-prep runbook, validation, and external-service assumption.
Affected plan section: `/goal-evo-inbox-companion` phases 6, 7, 8 and GitHub
issues #17, #18, #19, with #20 prepared only as a credential/proof checklist.
Reason: durable goal mode started the final pre-production companion app
implementation run after inbound WAHA delivery and manual WAHA replies landed.
Decision: keep WACRM's retained AI assistant as the EVO Companion AI Assistant
in draft-only mode. OpenAI/Anthropic keys remain bring-your-own and encrypted;
knowledge retrieval must feed draft generation when configured; missing AI
config, decrypt failures, and provider failures must surface as explicit
errors. AI auto-reply remains unavailable for first launch and must not retain
an active runtime send path.

Redesign retained first-launch surfaces as EVO Inbox for admissions operators:
inbox, contact/lead profile, AI/knowledge, WAHA settings, amoCRM settings, and
production readiness. Disabled modules such as broadcasts, broad automations,
templates, flows, and auto-reply stay absent from active navigation or fail
closed through existing disabled-module gates.

Add reviewable `hermes-vps` deployment support for a separate
`inbox.evoadmissions.com` service without touching `/opt/evo-crm` or claiming a
live deployment. The companion Next.js app should use official standalone
output semantics: `output: "standalone"`, run the generated standalone
`server.js`, and include copied `public` plus `.next/static` assets. WAHA stays
private on the Docker network; Caddy routes only the companion app hostname to
the companion app service.

Prepare #20 only as a real proof checklist/runbook naming the required
Supabase, ENCRYPTION_KEY, WAHA, amoCRM, AI provider, test WhatsApp number, DNS,
and Caddy inputs and the exact proof sequence. Do not mark #20 done and do not
perform a production proof in this run.
Validation impact: run from `agent-lead2-crmwhatsapp/`: `npm ci --include=dev`,
`npm test`, targeted AI/knowledge/WAHA/deployment/preflight tests,
`npm run lint`, `npm run typecheck`, `npm run build`, browser/UI checks when a
local server can run, `git diff --check`, and a PR diff secret scan. Build or
preflight may only report live Supabase, WAHA, amoCRM, AI, DNS, Caddy, or
production success if real credentials/services are present and explicitly
exercised. Do not deploy and do not touch `/opt/evo-crm`.
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

## 2026-07-06 - EVO Inbox Issue 15 Inbound WAHA Delivery

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: active slice, webhook delivery, data model, file ownership, validation, and external-service assumption.
Affected plan section: `/goal-evo-inbox-companion` phases 3, 4, and 5, GitHub issue #15.
Reason: issue #15 is the next implementation stage after the WAHA authenticated
webhook boundary and amoCRM identity resolver landed in issues #13 and #14. The
companion app now needs signed WAHA `message` events to become staff-visible
EVO Inbox conversations/messages only after amoCRM identity is resolved.
Decision: keep this slice scoped to inbound WAHA delivery only. Parse signed
WAHA `message` webhook envelopes, ignore outbound/from-me messages, preserve
existing `session.status` handling, and keep unsupported signed events as
ignored. Resolve amoCRM contact/lead identity through the configured amoCRM
client before creating any new local inbox conversation or message, then persist
nullable shadow identifiers on Supabase contacts/conversations. Use the existing
staff inbox `contacts`, `conversations`, and `messages` tables and read path;
do not create a separate inbox model. Add WAHA-specific message shadow columns
and a partial unique index so duplicate WAHA message ids are idempotent without
changing legacy Meta Cloud `message_id` semantics. Missing Supabase, WAHA, or
amoCRM configuration and amoCRM/Supabase provider failures must return explicit
not-configured/blocked errors and must not be reported as live provider success.
Manual operator replies, AI/autoreply, redesign, deployment, Caddy/DNS, and
production proof remain out of scope.

Current official docs consulted on 2026-07-06:

- WAHA Events: `https://waha.devlike.pro/docs/how-to/events/` documents
  per-session webhooks, HMAC config, `X-Webhook-Hmac`, and
  `X-Webhook-Hmac-Algorithm: sha512`.
- WAHA Receive messages:
  `https://waha.devlike.pro/docs/how-to/receive-messages/` documents `message`
  webhook payloads with `event`, `session`, `payload.id`, `timestamp`, `from`,
  `fromMe`, `to`, `body`, and WhatsApp chat id forms such as phone digits plus
  `@c.us`.
- amoCRM Contacts API:
  `https://www.amocrm.ru/developers/content/crm_platform/contacts-api`
  documents `GET /api/v4/contacts`, `POST /api/v4/contacts`, `query`, and
  `with=leads`.
- amoCRM Leads API:
  `https://www.amocrm.ru/developers/content/crm_platform/leads-api` documents
  `GET /api/v4/leads`, `POST /api/v4/leads`, and lead-contact embedding through
  `_embedded.contacts`.
  Validation impact: run from `agent-lead2-crmwhatsapp/`: `npm ci --include=dev`,
  `npm test`, targeted inbound/WAHA tests, `npm run lint`, `npm run typecheck`,
  `npm run build`, `git diff --check`, and a staged secret scan. No production
  deployment, no `/opt/evo-crm` access, and no live WAHA/amoCRM/Supabase success
  claims unless real credentials and real services are exercised.
  Reviewer notes: pending independent launch-control review.

## 2026-07-06 - EVO Inbox Issue 16 Manual WAHA Reply

Date: 2026-07-06, workspace timezone.
Author: Codex.
Change type: active slice, manual outbound transport, data model, file ownership,
validation, and external-service assumption.
Affected plan section: `/goal-evo-inbox-companion` phase 3 manual outbound
send, GitHub issue #16.
Reason: issue #16 enables an operator-approved text reply from an existing EVO
Inbox conversation through the WAHA companion session after issue #15 made
inbound conversations visible.
Decision: keep this slice scoped to first-launch manual text sends only. The
operator UI posts only text replies to the WAHA manual-send path; media,
templates, broadcasts, automations, flow-driven sends, and AI auto-replies
remain disabled or untouched. The send path loads WAHA base URL, session
`evo-inbox`, and API key from encrypted integration settings, sends
`POST /api/sendText` with direct user `chatId` in `@c.us` form, and persists a
local outbound staff message only after WAHA accepts the send. Add a nullable
provider-status shadow column for WAHA outbound results so an accepted send
without a provider id can be represented truthfully without inventing an id.
Reply targets must belong to the same conversation and, when available, map to
the target WAHA message id as WAHA `reply_to`.

Because WAHA send acceptance and Supabase persistence cannot be made one
transaction, a DB failure after WAHA acceptance may leave a real external
message without a local message row. Surface that case explicitly as
`db_error`, do not fake a persisted sent message, and keep conversation preview
updates after successful message persistence only.

Current official docs consulted on 2026-07-06:

- WAHA Send messages: `https://waha.devlike.pro/docs/how-to/send-messages/`
  documents `POST /api/sendText`, common `session` and `chatId` fields,
  direct-user chat IDs as international digits plus `@c.us`, converting
  internal `@s.whatsapp.net` ids to `@c.us` before sending, `X-Api-Key`, and
  optional `reply_to`.

Validation impact: run from `agent-lead2-crmwhatsapp/`: `npm ci --include=dev`,
`npm test`, targeted WAHA/manual-send tests, `npm run lint`,
`npm run typecheck`, `npm run build`, `git diff --check`, and a secret scan over
the PR diff. No production deployment, no `/opt/evo-crm` access, and no live
WAHA/Supabase success claims unless real credentials and real services are
exercised.
Reviewer notes: pending independent launch-control review.

## 2026-07-07 - EVO Inbox Live WAHA Settings Seed

Date: 2026-07-07, workspace timezone.
Author: Codex.
Change type: production setup evidence, deployment tooling, and validation
scope.
Affected plan section: `/goal-evo-inbox-companion` issue #20 production proof
preparation and WAHA runtime configuration.
Reason: the live `evo-inbox` WAHA session connected successfully on
`hermes-vps`, but the companion app initially rejected WAHA webhooks with
`503 waha_not_configured` because the Supabase account-level WAHA runtime
settings had not been seeded.
Decision: seed `integration_settings(provider='waha')` for the live EVO account
with `public_config.baseUrl=http://evo-inbox-waha:3000` and
`public_config.sessionName=evo-inbox`, then store only encrypted
`integration_secrets` rows for `api_key` and `webhook_hmac_secret`. Add
`scripts/seed-prod-waha-config.mjs` and `npm run seed:prod-waha` so this
production setup step is repeatable from GitHub-owned code and never requires
hardcoding or committing secrets.
Validation impact: live Supabase seeding was performed with the real
service-role key and `ENCRYPTION_KEY`; the command output showed a configured
WAHA setting and secret names only. A real WAHA `evo-inbox` session restart then
emitted real `session.status` webhooks to
`http://evo-inbox-app:3000/api/waha/webhook`, and WAHA logged HTTP 200
responses. WAHA returned to `WORKING` for WhatsApp id `971561322050@c.us`.
This proves WAHA session status webhooks are now accepted, but does not prove
inbound message delivery, amoCRM identity resolution, AI draft generation, or
manual outbound send.
Reviewer notes: pending independent launch-control review.

## 2026-07-07 - EVO Inbox Issue 27 Gemini Embeddings And Supabase Scale

Date: 2026-07-07, workspace timezone.
Author: Codex.
Change type: active slice, AI retrieval architecture, Supabase schema/indexing,
storage planning, validation, and external-service assumption.
Affected plan section: `/goal-evo-inbox-companion` phase 6 AI draft/knowledge
and managed Supabase foundation, GitHub issue #27.
Reason: EVO Inbox first launch needs multilingual Russian/Kyrgyz knowledge
retrieval with the owner's existing Gemini rollout key, while preserving
operator-reviewed manual drafts and making Supabase storage/index growth
explicit before production traffic.
Decision: add an account-level `ai_configs.embeddings_provider` selection with
`keyword`, `gemini`, and `openai`. `keyword` remains the no-provider default
and uses only the existing language-neutral FTS path. `gemini` uses Gemini
embeddings with the same encrypted Gemini key when the account's draft provider
is Gemini; otherwise it uses the optional encrypted embeddings override key.
`openai` uses OpenAI `text-embedding-3-small` with the same encrypted OpenAI key
when the draft provider is OpenAI or the optional embeddings override key when
the draft provider differs. Knowledge ingestion and draft/playground retrieval
must use the selected provider and fall back to keyword retrieval on missing
semantic configuration or provider failure. Auto-reply stays unavailable and
forced off.

Keep the existing `vector(1536)` Supabase column. Google's official Gemini
embedding docs checked on 2026-07-07 state that `gemini-embedding-2` supports
flexible output dimensions with recommended sizes including 1536, and that
embedding spaces are incompatible across Gemini embedding model families, so
future model-family changes require re-embedding knowledge chunks. The Google
Embeddings API docs checked on 2026-07-07 document `models.embedContent` as the
server endpoint that returns a text embedding vector. Supabase vector-index docs
checked on 2026-07-07 state that large vector tables should be indexed, pgvector
supports HNSW and IVFFlat, Supabase generally recommends HNSW, and indexed
vector columns support up to 2000 dimensions on pgvector 0.7.0+, so the current
1536-dimensional HNSW cosine index remains valid.

Supabase storage/readiness decision: retain HNSW for `ai_knowledge_chunks`
because account knowledge bases grow incrementally and need good recall from
small row counts. Add composite hot-path indexes for inbox ordering and message
timeline reads where missing. Document storage growth for conversations,
messages, and vector chunks using Supabase's current plan guidance checked on
2026-07-07: Free projects have a 500 MB database-size quota/read-only risk,
while Pro includes materially larger database/storage headroom. Free is enough
only for initial proof/small pilot traffic; move to Pro before sustained
production WhatsApp traffic, large imported histories, or thousands of
knowledge chunks.

Validation impact: run from `agent-lead2-crmwhatsapp/`: `npm ci --include=dev`,
`npm test`, targeted AI/knowledge/embeddings/schema/preflight tests,
`npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, and a
PR diff secret scan. Live Gemini/Supabase smoke may only be claimed if provider
and Supabase credentials are present in the current allowed workspace
environment and actually exercised; otherwise report the exact missing env or
service blocker. No deployment, no rsync, no `/opt/evo-crm` access, and no
unattended WhatsApp auto-reply.
Reviewer notes: pending independent launch-control review.

## 2026-07-12 - EVO Platform Source Of Truth And Company Documents

Date: 2026-07-12, workspace timezone.
Author: Codex.
Change type: active slice, information architecture, governance, source-document
classification, presentation, and validation scope.
Affected plan section: goal slice, repository entrypoints, documentation
ownership, source-document handling, and validation.
Reason: the user approved the read-only repository audit and asked to turn the
workspace into a team source of truth, add proper subfolders, and preserve four
supplied real EVO documents. The audit proved that the default README is generic,
the current platform spans three runtimes, changing work status is duplicated in
Markdown, and the supplied charter contains personal identity and address data.
Decision: keep one EVO Admissions Platform repository and improve its
documentation structure before moving runtime paths. Track the public brand
book. Keep the bank requisites, registration certificate, and charter in a
local Git-ignored private source-document folder with restrictive permissions;
track only a sanitized manifest and checksums. Create team onboarding, platform
and data-ownership maps, a safe company profile, and a branded overview deck.
GitHub `main` remains the intended shared canonical branch, amoCRM remains the
identity/sales-state authority, Supabase remains the Inbox data store, and the
VPS remains runtime rather than code source of truth.
Validation impact: render and inspect all supplied PDFs; verify page counts and
checksums; render and inspect every presentation slide; run presentation
overflow checks, `git diff --check`, a staged-diff secret/PII scan, root
lint/typecheck/build, and independent launch-control review. No production
deployment, DNS change, live integration claim, or outbound WhatsApp action is
authorized by this slice.
Reviewer notes: pending independent launch-control review.

## 2026-07-13 - EVO Country Knowledge Upload Pack And Business Context

Date: 2026-07-13, workspace timezone.
Author: Codex.
Change type: active slice, business knowledge ownership, content normalization,
retrieval preparation, documentation architecture, and validation scope.
Affected plan section: `/goal-evo-knowledge-business-context`, GitHub issue #36.
Reason: the user approved two supplied China and Malaysia knowledge drafts as
trusted content and asked for upload-ready versions with editorial debris
removed, missing bot guidance added, and a complete business context assembled
from prior company documents and the implemented codebase.
Decision: preserve both supplied Downloads files unchanged and create two
reviewed, normalized Markdown documents under
`docs/business/knowledge-base/ready-to-upload/`. Treat the supplied substantive
country content as owner-approved business input for this slice; do not perform
external fact-checking or silently replace its claims. Remove only drafting
metadata, unresolved transcription notes, open questions, duplicate FAQ copies,
and presentation noise. Add retrieval-friendly headings, separate cost
categories, lead-qualification fields, privacy-safe document handling, and
human-handoff rules. Store upload instructions and review metadata in a nearby
registry rather than mixing operational maintenance notes into customer-facing
answers.

Create `docs/business/evo-business-context.md` as the narrative business map and
extend root `CONTEXT.md` only with canonical glossary terms. The business
context must distinguish legal company scope, owner-approved offer knowledge,
implemented operating entities, external-system authority, current AI
boundaries, and governance gaps. It must not copy restricted bank values,
registration numbers, personal addresses, signatures, credentials, customer
records, or other private source-document content.

Current product constraint: EVO Inbox accepts knowledge through separate title
and text fields. Saving the text creates retrieval chunks and embeddings. This
slice documents that workflow and produces paste-ready text; it does not add a
binary `.md` upload control or change the embedding implementation.

Validation impact: verify source and output checksums, scan for draft markers,
open questions, placeholders, secrets, and personal data; preview the exact
1,200-character chunking boundary; validate internal links; run
`git diff --check`, the repository's required code gates, and an independent
launch-control review. No external provider request, production database write,
deployment, DNS change, or WhatsApp send is authorized by this slice.
Reviewer notes: independent plan review approved the bounded write set,
acceptance criteria, trusted-content boundary, privacy controls, and readiness
to begin implementation on 2026-07-13.

## 2026-07-13 - EVO Knowledge And Business Context Implementation Review

Date: 2026-07-13, workspace timezone.
Author: Codex.
Change type: implementation evidence, source preservation, retrieval quality,
validation, and independent review.
Affected plan section: `/goal-evo-knowledge-business-context`, GitHub issue #36.
Reason: the planned country upload pack and business context are complete and
must pass launch-control acceptance before merge.
Decision: keep the final deliverable scoped to two separate country documents,
one registry/upload guide, one comprehensive business context with a concise
copy-ready EVO Inbox instruction block, the business/documentation indexes, and
the root domain glossary. Preserve the unrelated untracked presentation ZIP and
exclude the generated scenario report from the diff.

Validation evidence: source SHA-256 values remained unchanged. The real EVO
Inbox chunker produced 14 China chunks with maximum length 1,197 and 13 Malaysia
chunks with maximum length 1,185; no oversized chunk, orphan heading, or handoff
lead-in split remained. Relative links, draft/editorial marker scans,
secret/credential scans, and `git diff --check` passed. Under Node 22.23.1,
root lint, Next route generation, TypeScript, production build, all 39 scenarios,
and `npm audit --audit-level=moderate` passed. Focused Inbox chunk and retrieval
tests passed 16 of 16.

Reviewer notes: three independent final reviews approved the cleaned China
content, cleaned Malaysia content, business model, data ownership, upload and
embedding mechanics, source-conflict disclosure, privacy boundaries, glossary,
and named write set. The first content reviews requested specific wording and
semantic chunk-boundary fixes; those changes were applied and the reviewers
then returned `APPROVED`.

## 2026-07-13 - EVO Knowledge And Business Context Closeout

Date: 2026-07-13, workspace timezone.
Author: Codex.
Change type: post-merge closeout and final audit.
Affected plan section: `/goal-evo-knowledge-business-context`, GitHub issue #36,
implementation PR #38.
Reason: implementation PR #38 merged into the integration source-of-truth
branch and the execution contract must record the actual terminal state.
Decision: mark the slice complete at merge commit `2484cae5`. Keep the two
country files as paste-ready text rather than claiming a binary Markdown upload
feature. Keep the owner-approved Malaysia guarantee wording and its documented
governance conflict. Leave the unrelated presentation ZIP untracked.

Final audit: the merged branch contains all nine named files and no unexpected
tracked change. Source SHA-256 values still match. The real chunker still
returns 14 China chunks with maximum 1,197 and 13 Malaysia chunks with maximum
1,185, with zero oversized or semantic-boundary issues. PR #38 is confirmed
merged into `izzhacktcodex/waha-integration` at commit `2484cae5`.
Reviewer notes: independent closeout review approved the PR and commit facts,
append-only history, terminal plan status, validation evidence, and two-file
scope. No new runtime, business-content, deployment, provider, or data change is
introduced.

## 2026-07-13 - Rename EVO Inbox Workspace Folder

Date: 2026-07-13, workspace timezone.
Author: Codex.
Change type: repository layout, documentation, deployment path references.
Affected plan section: EVO Inbox companion app workspace and production runbooks.
Reason: the historical folder name `agent-lead2-crmwhatsapp/` no longer matches
the product boundary. The application is the EVO Inbox companion app, not a
generic CRM WhatsApp folder.
Decision: rename `agent-lead2-crmwhatsapp/` to `agent-lead2-inbox/` and update
repository, deployment, and runbook references to the new path. Keep service
names, Docker Compose project names, public hostnames, WAHA session names,
Supabase behavior, and runtime secrets unchanged. Do not remove
`evo-lead-agent/`; it remains the production CRM lead-agent backend used by the
`evo-crm` Compose project.

Validation impact: verify no tracked references to the old folder name remain,
run the renamed EVO Inbox test/build gates from `agent-lead2-inbox/`, run root
lint/type/build checks affected by path exclusions, and inspect the resulting
Compose files without printing runtime secrets.

## 2026-07-23 - Plan Main Promotion And Real Production Proof

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: launch contract, security gate, CI, release/deployment, DNS, and
real-provider acceptance criteria.
Affected plan section: `/goal-evo-main-production-consolidation`.

Reason: the owner authorized completing the remaining consolidation and real
production-proof work. Live review found a linear integration candidate 41
commits ahead of `main`, but it also found release blockers that the prior
completed goal did not cover:

- newly published high-severity advisories affect the installed Next.js and
  Sharp runtime dependency chain in both web applications;
- EVO Inbox carries the shadcn code-generation CLI as a production dependency,
  pulling unrelated CLI/MCP packages into the runtime audit;
- GitHub sees no effective Actions workflow because the only workflow is nested
  below the repository root;
- the complete `main..integration` range has three whitespace failures;
- both production checkouts differ from the remote integration head, with an
  active uncommitted Caddy change on the Inbox checkout and a retained Git backup
  directory under the CRM checkout;
- the main CRM containers still join an `acadis_*` network;
- canonical EVO DNS records do not exist;
- the `evo-inbox` WAHA session is working, while `crm_primary` requires QR
  relinking and the Lead Agent readiness check lacks amoCRM OAuth configuration.

Decision: execute five sequential reviewed blocks: security/repository gates,
frozen integration promotion, production reconciliation, canonical DNS, and a
controlled real-provider proof. Treat dependency audit, root CI, full-range
whitespace/secret checks, immutable release identity, backups, rollback
artifacts, provider readiness, and independent review as release gates. Do not
deploy from dirty checkouts or overwrite active Caddy routes. Keep EVO Inbox and
the legacy Lead Agent as separate WAHA/credential boundaries.

The production proof must use a dedicated EVO-controlled test sender and one
operator-approved manual reply. Auto-reply remains disabled. A missing DNS
provider login, authenticated Inbox operator, exact test number, or real
Supabase/amoCRM/Gemini setting is a named blocker, not permission to substitute
mock data or claim partial success.

Current official sources consulted:

- Next.js upgrade guidance documents patch upgrades through
  `@next/codemod upgrade patch`:
  `https://nextjs.org/docs/app/guides/upgrading/codemods`.
- shadcn project guidance invokes the CLI through the package runner as
  `npx shadcn@latest`, so it does not need to ship as an application runtime
  dependency: `https://ui.shadcn.com/docs/cli`.
- GitHub discovers workflow files from repository-root `.github/workflows/`:
  `https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows`.
- GitHub CLI supports guarding a PR merge with the reviewed head through
  `gh pr merge --match-head-commit`:
  `https://cli.github.com/manual/gh_pr_merge`.
- WAHA session status is read through the session-list API:
  `https://waha.devlike.pro/docs/how-to/sessions/`.

Validation impact: this plan-only block changes no runtime, dependency, DNS,
server, database, provider, or WhatsApp state. Validate Markdown whitespace,
links, the recorded Git ancestry, and the current public/server facts. Require
independent launch-control approval before implementation.

## 2026-07-23 - Localize Shadcn Runtime Styles In Security Block

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: implementation-boundary clarification and dependency hardening.
Affected plan section: `/goal-evo-main-production-consolidation`, security and
repository gates.

Reason: implementation inspection found that EVO Inbox imports
`shadcn/tailwind.css` from the code-generation CLI package during its production
build. Removing `shadcn` from the application dependencies without replacing
that import makes the real Next.js build fail, even though the imported file is
only a small static Tailwind extension.

Decision: expand the security-block write boundary only to
`agent-lead2-inbox/src/app/globals.css` and a tracked local
`agent-lead2-inbox/src/app/shadcn-tailwind.css`. Preserve the exact required
custom variants, accordion keyframes, animation utilities, and no-scrollbar
utility with the upstream MIT attribution. Continue to remove the shadcn CLI
from installed application dependencies and use the documented ephemeral
`npx shadcn@latest` command for future component generation.

Implementation evidence:

- main CRM and EVO Inbox now use Next.js `16.2.11`,
  `eslint-config-next` `16.2.11`, and Sharp `0.35.0`;
- both lockfiles resolve with `npm ci` and report zero findings from
  `npm audit --audit-level=moderate`;
- the shadcn CLI and its CLI/MCP dependency tree are absent from the EVO Inbox
  lockfile;
- issue #42 tracks the deliberately separate repository-wide EVO Inbox
  formatter baseline;
- the repository-root workflow covers locked install, lint, typecheck, build,
  audit, and tests across the main CRM, EVO Inbox, and EVO Lead Agent;
- local validation has passed the main CRM lint, generated-route typecheck,
  production build, and all 39 real local-database scenarios; EVO Inbox lint
  with zero errors and six existing warnings, typecheck, all 724 tests,
  production build, and dependency audit; and EVO Lead Agent Ruff plus all 108
  tests.

Official implementation references:

- npm documents root `overrides` for replacing vulnerable transitive versions:
  `https://docs.npmjs.com/files/package.json/#overrides`.
- Next.js documents installing Sharp for production image optimization:
  `https://nextjs.org/docs/messages/install-sharp`.
- shadcn documents the package-runner CLI form:
  `https://ui.shadcn.com/docs/cli`.
- GitHub documents repository-root workflow discovery:
  `https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows`.
- Astral documents `astral-sh/setup-uv` for GitHub Actions:
  `https://docs.astral.sh/uv/guides/integration/github/`.

Validation impact: rerun both locked Node installs, dependency audits, lint,
typechecks, tests, and production builds after the local stylesheet is in place;
run EVO Lead Agent locked sync, Ruff, and pytest; validate the workflow YAML;
check the complete `main..candidate` diff for whitespace; run a redacted secret
scan over the same range; and require an independent launch-control review
before merge. No deployment, DNS, provider, customer data, or WhatsApp state is
changed by this block.

## 2026-07-23 - Close Release-Gate Review Gaps

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: independent-review correction.
Affected plan section: `/goal-evo-main-production-consolidation`, security and
repository gates.

Reason: independent review of PR #43 found that the first root workflow version
did not automate `npm run scenarios` and compared whitespace only with the PR
base. Because PR #43 targets the integration branch, that comparison did not
enforce the launch contract's complete `main..candidate` release range.

Decision: add the 39-case CRM scenario runner to the CRM CI job. Fetch the
current `origin/main` release baseline explicitly and run
`git diff --check origin/main..HEAD_SHA` for every pull request, regardless of
whether its immediate base is integration or `main`.

Validation impact: rerun the workflow on the unchanged dependency/runtime
implementation plus this correction; require all four GitHub jobs to pass and
obtain a fresh independent review of the new exact head before merge.

## 2026-07-23 - Initialize The Ignored Scenario Database In CI

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: CI environment correction after real workflow execution.
Affected plan section: `/goal-evo-main-production-consolidation`, security and
repository gates.

Reason: the corrected CRM job ran `npm run scenarios` on GitHub and failed
before the first scenario because `data/edu-admin.db` is intentionally ignored.
The local runner copies that database, but a clean GitHub checkout correctly
contains no database or customer records.

Decision: do not commit, upload, or synthesize a separate database fixture.
Inside the isolated GitHub runner, compile and execute the checked-in CRM
`src/lib/db.ts` plus `src/lib/lead-stages.ts` initialization path against an
ephemeral ignored SQLite file. This uses the application's real schema,
migrations, and built-in demo seed code. Run the unchanged 39-scenario harness
against the resulting database and discard it with the runner.

This database is regression-test input only. It is not a mock provider and does
not establish live WhatsApp, amoCRM, Gemini, Supabase, telephony, DNS, or
deployment readiness.

Validation impact: reproduce the initializer and all 39 scenarios in a clean
checkout with no pre-existing `data/` directory, then require the complete
GitHub CRM job and a fresh independent review to pass on the new exact head.

## 2026-07-23 - Correct Lead Agent Cache Invalidation Path

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: post-merge CI correction before candidate freeze.
Affected plan section: `/goal-evo-main-production-consolidation`, security and
repository gates.

Reason: the post-merge integration workflow passed its Lead Agent checks but
emitted an annotation that no file matched
`evo-lead-agent/evo-lead-agent/uv.lock`. The setup action resolves a relative
`cache-dependency-glob` from its configured `working-directory`, so the current
input duplicates the subdirectory and never invalidates the cache from the real
lockfile.

Decision: keep `working-directory: evo-lead-agent` and change only
`cache-dependency-glob` to `uv.lock`. Current setup-uv documentation states that
relative cache globs are interpreted from the working directory:
`https://github.com/astral-sh/setup-uv/blob/main/docs/caching.md`.

Validation impact: require the Lead Agent GitHub job to pass without the
no-file-matched annotation, verify all other platform jobs remain green, and
obtain independent review before freezing the promotion candidate. This changes
no dependencies, runtime behavior, provider state, data, deployment, or DNS.

## 2026-07-23 - Reconcile The Production Release Boundary

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: production architecture, release provenance, rollback, and
deployment runbook.
Affected plan section: `/goal-evo-main-production-consolidation`, production
release reconciliation.

Reason: promotion PR #45 was independently approved and merged with preserved
history. GitHub `main` now points at
`0303fae691f45a52028708d85b8fc36b7a39ee93`. A fresh read-only audit of
`hermes-vps` confirmed that the fallback CRM and Inbox sites are healthy and the
EVO edge proxy owns public ingress, but the running CRM app, WAHA, and Lead
Agent still depend on `acadis_acadis_web`. The running images use mutable tags
without OCI source/revision/version labels. The live edge Caddyfile also
contains two intentional routes that are not yet represented in Git:
`invite-bishkek.72.62.119.112.sslip.io` and
`inbox.72.62.119.112.sslip.io`. The production CRM checkout contains a retained
untracked Git backup directory and the Inbox checkout contains the live Caddy
edit, so neither checkout is a safe deployment source. Canonical EVO DNS remains
absent and is not part of this code block.

Decision:

- Commit both active non-EVO `sslip.io` proxy routes to the canonical EVO edge
  Caddyfile. Preserve their current upstreams exactly; removal requires a
  separate owner-approved change.
- Give the CRM Compose project an EVO-owned private network. Keep only the CRM
  app on both that private network and `evo_public_web`; keep CRM WAHA and the
  Lead Agent on the private network only. Do not make the private network
  Docker-internal because those services require controlled outbound provider
  access.
- Tag the three EVO-built images with the exact merged release revision and add
  OCI source, revision, and version labels at build time. Require immutable
  digest references for WAHA and Caddy so a release cannot silently pull a
  different third-party image behind a mutable tag.
- Allow service `env_file` paths to be supplied as release variables. Production
  will continue reading the existing mode-`0600` secret files from
  `/opt/evo-crm` and the current Inbox checkout; no secret value is copied into
  Git or the clean release source.
- Deploy from a detached clean release worktree under
  `/opt/evo-releases/<full-main-sha>/repo`, not from either dirty live checkout.
  Keep `/opt/evo-crm/evo-lead-agent.git-backup-*` and both original checkouts
  untouched.
- Before a container is recreated, save its inspect data and image identity,
  validate the resolved Compose/Caddy configuration, create an application
  SQLite backup, and snapshot every stateful EVO volume into a timestamped
  release evidence directory. Retain the prior image IDs and exact config files
  as the rollback contract.
- Build all EVO images before changing runtime state. Pre-connect the existing
  CRM containers to `evo_crm_private`, then reconcile CRM WAHA, Lead Agent, and
  app one boundary at a time with a health check after each. Reconcile Inbox
  WAHA and app separately, then validate and gracefully reload the edge proxy.
  Do not remove the old Acadis network; another project owns it.

Validation impact: validate both production Compose files with explicit
release variables and external secret-file paths, validate the edge Compose
file and Caddyfile, build all three EVO images, inspect their OCI labels and
release tags, rerun the scoped application test/build gates, check the complete
diff for secrets and whitespace, and obtain independent review before merge.
After merge, fetch the exact new `main` SHA on the VPS, repeat all preflight
checks and backups, deploy one boundary at a time, verify health and public
fallback routing, and prove that no running EVO CRM container remains attached
to an `acadis_*` network. DNS and real-provider proof remain later blocks and
must report external blockers honestly.

## 2026-07-23 - Pre-Provision The CRM Private Network Explicitly

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: independent-review correction.
Affected plan section: `/goal-evo-main-production-consolidation`, production
release reconciliation.

Reason: independent review of PR #46 reproduced a deployment failure in the
first runbook version. The runbook created `evo_crm_private` with
`docker network create` so live containers could be preconnected before
boundary-by-boundary replacement, while Compose declared the same name as a
Compose-managed network. Compose rejects a pre-existing network without its
expected project labels, so the first CRM service recreation would stop even
after all preflight checks passed.

Decision: declare `evo_crm_private` as an external Compose network and keep its
explicit creation in the reviewed runbook before preconnecting the three live
CRM containers. Here, `external` changes only which tool manages the network
lifecycle; it does not publish a port or make the bridge publicly reachable.
The network remains EVO-owned and contains only the CRM app, CRM WAHA, and Lead
Agent. Continue to keep only the CRM app on the separate external
`evo_public_web` network.

Validation impact: reproduce the original failure with a disposable
Compose-managed named network, then validate that the corrected external
network accepts a pre-created Docker bridge and allows service startup. Re-run
the CRM resolved-model topology assertions, all GitHub checks, and independent
review on the new exact PR head before merge.

## 2026-07-23 - Add A Durable Audit Boundary Before Real WhatsApp Proof

Date: 2026-07-23, workspace timezone.
Author: Codex.
Change type: provider-proof safety and auditability.
Affected plan section: `/goal-evo-main-production-consolidation`, real
production proof.

Reason: the exact merged production release is healthy, the `evo-inbox` WAHA
session is genuinely `WORKING`, and unattended Inbox auto-reply is disabled.
However, the current draft route returns generated text without a durable audit
record, the manual-send route drops the authenticated operator identifier, and
WAHA is called before the message row is inserted. A successful provider send
followed by a database failure can therefore become invisible. Repeating an
ambiguous request can duplicate a customer message.

WAHA's current official documentation describes `POST /api/sendText`, provider
message identifiers, `message.ack` delivery events, webhook HMAC/retries, and
message lookup by provider identifier. It does not document a caller-supplied
idempotency key or metadata field:

- https://waha.devlike.pro/docs/how-to/send-messages/
- https://waha.devlike.pro/docs/how-to/events/
- https://waha.devlike.pro/docs/how-to/chats/

Supabase/Postgres remains the authorization and durability boundary. The
authenticated client stays subject to Row Level Security, while uniqueness and
atomic database operations provide concurrency control. Service-role writes
are limited to server-controlled paths after app-level authorization: the
draft audit, durable manual outbox, signed provider webhook, automations and
flows, and secret-protected reconciliation.

Decision:

- Add an immutable account-scoped AI draft audit table. Store the requesting
  operator, conversation, provider/model, retrieved knowledge evidence,
  generated text, and creation time. Do not return a generated draft when its
  audit insert fails.
- Return the audit identifier to the editable composer and include it only when
  the operator manually sends that draft or an edited version of it.
- Add a required client request UUID to manual sends. Use the existing
  `messages` row as a durable outbox: insert `status = sending`, `sender_id`,
  request UUID, optional draft reference, payload, and provider-attempt fields
  before the WAHA call. A unique request index is the concurrency gate.
- On a duplicate UUID, return the already confirmed result or the existing
  uncertain/in-progress state without calling WAHA again. Reject UUID reuse
  with different content, conversation, operator, reply target, or draft.
- Record explicit provider phases. A confirmed HTTP success advances the same
  row to `sent`; a confirmed provider rejection advances it to `failed`; a
  transport interruption or persistence failure after the call remains
  visible and is never automatically retried.
- Subscribe the signed Inbox WAHA webhook to `message.ack`, keep idempotent ack
  evidence, and update message state monotonically. Add bounded reconciliation
  for messages that have a stable WAHA identifier only. Rows without a
  provider identifier require operator review; text/timestamp matching is not
  accepted as proof.
- Keep automatic reply structurally disabled. Do not run a real outbound
  message during this implementation block.

Validation impact: add migration/schema-contract coverage; unit-test draft audit
success/failure, operator attribution, concurrent/duplicate request behavior,
pre-provider persistence failure, confirmed provider rejection, ambiguous
transport failure, post-provider update failure, ack duplication/out-of-order
handling, and bounded reconciliation. Run the complete EVO Inbox lint,
typecheck, tests, production build, dependency audit, diff/secret checks, and
independent review. Before deployment, apply and verify the reviewed migration
against the intended Supabase project, update the WAHA session webhook
subscription, and re-run authenticated readiness. Real inbound/draft/manual
outbound proof remains blocked until amoCRM and a dedicated test number are
configured and an operator explicitly approves the single test reply.

## 2026-07-24 - Make Message Delivery Evidence Server-Write-Only

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: authorization correction discovered by independent review.
Affected plan section: `/goal-evo-main-production-consolidation`, durable
outbound audit boundary.

Reason: migration 017 gives authenticated account agents a broad
`messages_modify FOR ALL` policy. Row-level membership prevents cross-account
access, but it does not prevent an in-account browser client from inserting,
updating, or deleting message rows and provider-delivery fields. Leaving that
policy in place would let a caller forge operator attribution, accepted or read
status, WAHA identifiers and acknowledgements, or delete the durable outbox
evidence entirely.

Decision:

- Keep authenticated account members' existing `messages_select` access.
- Remove authenticated and anonymous insert, update, and delete access to
  `messages`; all current application message writes already use a
  server-controlled service-role client.
- Keep the service role as the only direct message writer. Signed provider
  webhooks, secret-protected reconciliation, automations, flows, and the manual
  outbox continue through that server boundary.
- Add a schema-contract assertion and real PostgreSQL role checks proving an
  authenticated account agent can select its messages but cannot insert,
  alter, or delete delivery evidence.

Validation impact: re-run the migration twice against a disposable PostgreSQL
schema containing migrations 032 and 033 prerequisites; exercise
authenticated-role SELECT/INSERT/UPDATE/DELETE behavior, append-only draft and
ack evidence, cross-conversation foreign keys, duplicate/out-of-order
acknowledgements, the complete Inbox test/typecheck/lint/build/audit gates, and
independent review.

## 2026-07-24 - Preserve Terminal ACK And Missing-ID Review Semantics

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: delivery-state correctness discovered by independent review.
Affected plan section: `/goal-evo-main-production-consolidation`, provider
acknowledgement and operator evidence.

Reason: WAHA acknowledgement numbers are not a simple numeric progression:
`ERROR=-1` is terminal while `PENDING=0` is not. A numeric `new > old` rule
would retain a prior pending state when a later error arrives. Separately,
WAHA can return HTTP success without a stable message identifier. That confirms
request acceptance but cannot support later message lookup or delivery proof;
rendering a normal sent checkmark hides the required operator review.

Decision:

- Permit `PENDING -> ERROR`, make ERROR terminal, and do not let a late ERROR
  regress a message that already has positive server/device/read evidence.
- Let an accepted send move to `rejected` if a valid terminal ERROR
  acknowledgement follows before positive delivery evidence.
- Continue storing HTTP success without an id as
  `waha_message_status='accepted_without_id'`, but show an explicit amber
  review warning rather than a normal sent checkmark.
- Preserve the provider status and optional provider id in the immediate
  optimistic UI update so the warning does not depend on realtime timing.
- Add regression coverage for pending-to-error transition and success without
  a provider identifier.

Validation impact: exercise the SQL transition sequence `PENDING -> ERROR` and
prove later positive or stale events cannot incorrectly overwrite a terminal
or delivered state; run focused UI-state tests, then repeat every full release
gate and independent review on the corrected diff.

## 2026-07-24 - Validate The Outbound Audit Release And Hold Deployment

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: implementation closeout and operational hold.
Affected plan section: `/goal-evo-main-production-consolidation`, provider-proof
release gate.

Implementation result:

- AI draft text is returned only after an immutable operator/provider/model/
  knowledge-evidence record is stored.
- Manual text sends use one client UUID as the durable `messages` primary key,
  persist before WAHA, claim `queued -> dispatching` atomically, and never make
  a second provider call for an accepted, rejected, dispatching, or unknown
  operation.
- Authenticated browser roles retain message SELECT access but cannot insert,
  update, delete, truncate, or invoke the acknowledgement RPC.
- Signed `message.ack` evidence is append-only and duplicate-safe. Materialized
  state handles terminal ERROR explicitly and never regresses positive
  delivery evidence because of a stale event.
- Accepted responses without a provider id remain non-retryable acceptance
  evidence and display an amber operator-review warning.
- Reconciliation performs bounded provider GET lookups only and contains no
  send path. Automatic reply remains disabled.

Validation evidence:

- Node `22.23.1`: all 84 Vitest files and 764 tests passed.
- TypeScript passed; repository ESLint reported zero errors and six existing
  warnings.
- Next.js `16.2.11` production build passed; `npm audit --audit-level=moderate`
  reported zero vulnerabilities.
- Migration 037 applied twice after migrations 032 and 033 in a disposable
  PostgreSQL 17 database. Real role checks proved authenticated SELECT and
  denied INSERT/UPDATE/DELETE/TRUNCATE/RPC writes; service-role writes passed.
- PostgreSQL checks also passed for append-only drafts and ACK evidence,
  cross-account/cross-conversation foreign keys, duplicate ACKs,
  `PENDING -> ERROR`, terminal ERROR, and stale ERROR after positive delivery
  evidence.
- Final independent review approved with no remaining blocking, high, or
  medium finding.
- Diff whitespace and scoped secret-pattern checks passed; only explicit dummy
  test secrets were matched.

Operational hold: the intended managed Supabase project is not linked locally
and neither the workstation nor `hermes-vps` has a database-admin connection,
Supabase access token, database password, or authenticated management session.
The existing server-only service-role key is not a safe DDL credential.
Therefore migration 037 was not applied to production, the new application
image was not deployed, the live WAHA session was not changed, and no WhatsApp
message was sent. Keep production on merged release
`1f0d1a810014e2ecee496cb9c3a7217a70c86486` until the database-first gate can
be completed. Canonical Web-X DNS, amoCRM readiness, and a dedicated test
number remain separate external prerequisites.

## 2026-07-24 - Reconcile Inbox Audit And Start Pre-Platform Hardening

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: plan reconciliation, security scope, merge order, real acceptance,
and stop conditions.
Affected plan section: `/goal-evo-preplatform-hardening`.

Reason: PR #47 and its migration compatibility fix in PR #48 are merged,
migration 037 is applied, and EVO Inbox revision `14ed2e34` is deployed as
release `2026-07-23.2`. The prior plan status still described production
reconciliation as active and the preceding entry recorded the earlier
pre-deployment hold. The owner authorized a separate hardening goal before any
unified EVO Platform implementation.

Decision:

- Limit implementation to the current CRM, Inbox, Lead Agent, and production
  boundaries. Keep amoCRM authoritative for sales identity/state, AI
  draft-only, and automatic WhatsApp replies disabled.
- Credit PR #47/#48 for durable drafts, outbound attempts/messages,
  acknowledgement evidence, server-only delivery audit writes, and
  non-retryable unknown outcomes. Do not duplicate or weaken those controls.
- Order work as authorization containment; main CRM sensitive surfaces; privacy
  and truthful media support; conditional minimal Lead Agent containment;
  runtime/deployment hardening; isolated disaster-recovery rehearsals; and final
  acceptance audit.
- Merge shared migrations, deployment files, and plan files sequentially.
  Refresh every block from GitHub `main` and require separate launch-control
  approval before merge.
- Make public registration versus invite-only behavior an explicit owner
  decision and stop before changing it.
- Require real PostgreSQL role-policy tests with ordinary, privileged, and
  service roles. SQL text matching or table-owner queries do not prove RLS.
- Treat managed Supabase database restore and Storage object recovery as
  separate procedures because database backups exclude Storage objects.
- Run restore rehearsals only in isolated disposable destinations. Never
  overwrite production during validation.
- Keep DNS, credentials, dedicated WhatsApp test identities, externally visible
  replies, and destructive actions behind explicit owner authority.

Official implementation references checked during planning:

- `https://supabase.com/docs/guides/api/securing-your-api`
- `https://supabase.com/docs/guides/storage/security/access-control`
- `https://supabase.com/docs/guides/storage/serving/downloads`
- `https://supabase.com/docs/guides/platform/backups`
- `https://www.postgresql.org/docs/17/ddl-rowsecurity.html`
- `https://www.postgresql.org/docs/17/app-pgrestore.html`
- `https://nextjs.org/docs/app/guides/authentication`
- `https://docs.docker.com/reference/compose-file/services/`
- `https://caddyserver.com/docs/caddyfile/directives/request_body`

Validation impact: the plan-only PR changes only
`docs/EVO_LAUNCH_PLAN.md` and `docs/PLAN_CHANGES.md`; run
`git diff --check`, link/secret-pattern review, and independent plan-freshness
review. No runtime code, schema, provider, DNS, production, or customer data
change is authorized by this entry.

## 2026-07-24 - Freeze Retained Lead Agent After Ownership Proof

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: runtime ownership correction and Block D acceptance decision.
Affected plan section: `/goal-evo-preplatform-hardening`, Block D.

Reason: read-only production evidence established that the retained Lead Agent
is not the active inbound webhook owner. The `crm_primary` WAHA session is in
`SCAN_QR_CODE` and its configured webhook targets
`evo-crm-app/api/webhooks/waha`, not the Lead Agent. The Lead Agent is live as a
container but reports `amo_configured=false`, `outbound_enabled=false`, and
`worker_enabled=true`; therefore missing amoCRM prerequisites block real
processing while the enabled worker can be mistaken for production readiness.

Decision:

- Complete Block D through the plan's unused/blocked branch: freeze the retained
  Lead Agent disabled instead of implementing replay protection, crash leases,
  amoCRM idempotency, or identity-selection redesign for an inactive path.
- Add an explicit fail-closed freeze setting that defaults to enabled and gates
  worker startup, inbound WAHA processing, and every WAHA send path. Keep
  automatic replies and outbound disabled in production defaults.
- Keep `/health` as a non-sensitive liveness response and report frozen/readiness
  state separately. Missing prerequisites may be named, but configured URLs,
  paths, tokens, keys, session data, and customer data must not be returned.
- Unfreezing is not authorized by this block. It requires a later ownership
  decision, a WAHA session routed to the Lead Agent, a connected session,
  complete amoCRM/CRM/Gemini/HMAC prerequisites, and separate real acceptance.
- Do not change production, WAHA registration, provider data, customer data,
  Inbox, main CRM runtime, Caddy, or DNS in this block.

Official references checked:

- `https://waha.devlike.pro/docs/how-to/sessions/` (session webhook ownership)
- `https://waha.devlike.pro/docs/how-to/events/` (session webhook delivery)
- `https://docs.docker.com/reference/compose-file/services/` (healthcheck
  semantics)

Validation impact: run the complete Lead Agent pytest and Ruff gates, inspect
the rendered production Compose configuration with safe placeholder values,
run affected root configuration checks, and require an independent read-only
launch-control review. No provider success may be claimed because the WAHA
session requires QR and amoCRM is not configured.

## 2026-07-24 - Block F Recovery Evidence And Owner Approval Gate

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: implementation detail and discovered production constraint.
Affected plan section: `/goal-evo-preplatform-hardening`, Block F.

- Keep RPO/RTO as proposed technical targets pending explicit business-owner
  approval; measured rehearsal time is evidence, not an approved objective.
- Use SQLite's Online Backup API for live WAL-mode stores and require checksum,
  integrity, foreign-key, schema/version, and application-table verification.
- Treat a live WAHA volume archive as protected material/inventory evidence,
  not proof of a transactionally consistent restorable session. The documented
  private QR relink flow remains the authoritative recovery fallback.
- Production inventory found no authorized PostgreSQL password, Supabase
  Management API token, isolated database/project, or Storage S3 credentials.
  Real Supabase database and Storage restore rehearsals remain blocked until
  those inputs exist; a local schema-only simulation is explicitly rejected.
- Production inventory also found legacy state/config roots with broader than
  required permissions. New backup destinations and artifacts fail closed to
  `0700`/`0600`; changing live permissions requires a separate authorized
  production configuration action and is not part of this no-deploy block.

## 2026-07-24 - Block G Final Audit Remains Externally Blocked

Date: 2026-07-24, workspace timezone.
Author: Codex.
Change type: completion status and refreshed production evidence.
Affected plan section: `/goal-evo-preplatform-hardening`, Block G.

- Record the durable requirement matrix and exact PR/runtime/recovery
  provenance in `docs/BLOCK_G_FINAL_AUDIT.md`.
- Keep the overall goal open with verdict `blocked_external`. Blocks A-F are
  merged and independently approved, but migration 039 and the Block C Inbox
  runtime are absent from production; real Supabase restore and authorized
  WhatsApp/amoCRM acceptance evidence are also missing.
- Do not preserve the earlier claim that migration 038 is definitely absent.
  Its formerly public RPC now returns `404`, consistent with the migration's
  private-schema move, but complete production application remains unproven
  without authorized database migration-history/admin access.
- Keep public registration, DNS, CSP enforcement, retention scheduling,
  monitoring ownership/on-call, provider credentials, dedicated WhatsApp test
  identities, visible reply approval, and WAHA QR/relink as owner/external
  gates.
- Keep RPO/RTO as proposed technical targets pending explicit owner approval.
  This status entry changes no runtime, policy, schema, provider, DNS,
  production, or customer data.

## 2026-07-24 - Owner Accepts Temporary Supabase Pre-Migration Backup Risk

Date: 2026-07-24, Asia/Bishkek.
Author: EVO owner decision, recorded by Codex.
Change type: immediate stop-condition exception and deferred acceptance work.
Affected plan section: `/goal-evo-preplatform-hardening`, production migration
and Inbox deployment gate, Block F backup/restore, and Block G final acceptance.
Reason: the owner explicitly decided not to upgrade the Supabase plan now and
to proceed with the already-reviewed production migrations and deployment
without a pre-migration Supabase backup. The owner accepts the resulting
increased rollback and data-loss risk so the pre-platform release is not held
for the provider-plan and isolated-restore prerequisites.
Decision:

- Absence of a full pre-migration Supabase database and Storage backup is no
  longer an immediate stop condition for production migrations 038/039 and the
  Inbox deployment. Those actions may proceed only after transaction-level
  validation, migration-specific rollback SQL and durable rollback evidence,
  and every other existing release gate pass.
- For only those named actions, this later owner decision explicitly supersedes
  the generic `docs/EVO_LAUNCH_PLAN.md` instruction to "Stop deployment if
  backups, restore evidence, or rollback evidence are missing." The generic
  stop condition remains binding for every other release action, and missing
  rollback evidence still stops migrations 038/039 and the Inbox deployment.
- This is a narrow, time-bounded risk acceptance. It does not authorize a
  destructive migration, destructive DDL, data rewrite, backfill that replaces
  existing values, production restore, provider-plan change, deployment, DNS
  change, customer-data access, or any other external action.
- Migration execution must remain additive/non-destructive and fail closed.
  If transaction-level validation or the reviewed rollback path exposes a
  destructive operation, irreversible effect, ambiguous data rewrite, or
  rollback gap, stop and obtain a new owner decision.
- Schedule owner review for 2026-08-03, after about ten days of platform use.
  That follow-up must cover the Supabase plan upgrade decision, a real logical
  database backup, a separate real Storage-object export with inventory and
  checksums, and an isolated restore rehearsal into disposable destinations.
- Provider database backups alone do not satisfy the deferred requirement:
  Supabase documents that database backups contain Storage metadata but not the
  stored objects. Database and Storage evidence must therefore be captured and
  restored separately.
- A local-only, schema-only, mocked, simulated, or production-in-place restore
  is not acceptance evidence. The eventual rehearsal must exercise the real
  Supabase database and Storage paths against isolated destinations and record
  integrity, object-count/checksum, application-read, authorization, and
  cleanup evidence without exposing secrets or customer data.
- The eventual Block F/Block G backup-and-restore acceptance requirement
  remains open. This decision changes only whether migrations 038/039 and the
  Inbox deployment must wait for it; it does not mark Block F or Block G
  complete.
- RPO/RTO values remain unapproved proposals. This risk acceptance does not
  approve, revise, or imply an RPO, RTO, retention policy, backup owner, or
  recovery owner.

Validation impact:

- Before production migration or deployment, retain the reviewed
  transaction-level validation output, exact rollback SQL, rollback rehearsal
  or dry-run evidence appropriate to each non-destructive migration, and all
  other required release-gate evidence.
- On 2026-08-03, re-open this deferred gate for explicit owner review; do not
  infer approval to purchase a plan, create provider resources, access
  production data, or perform the restore rehearsal.
- This plan-only amendment changes no code, migration, runtime, deployment,
  provider, DNS, secret, or customer data.

Official references rechecked:

- `https://supabase.com/docs/guides/platform/backups`
- `https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore`
- `https://supabase.com/docs/guides/storage/management/download-objects`

Reviewer notes: require an independent read-only launch-control review of the
decision boundary and this documentation-only diff before merge.

## 2026-07-24 - Correct Inbox Readiness Probe and Reconcile VPS Source

Date: 2026-07-24, Asia/Bishkek.
Author: Codex.
Change type: production readiness correction and source-of-truth reconciliation.
Affected plan section: `/goal-evo-preplatform-hardening`, Blocks E and G.
Reason: WAHA's private unauthenticated readiness surface is `/ping`, while
`/health` requires API authentication. The prior Inbox dependency probe called
`/health` without that credential and could report WAHA unavailable even when
the private service was healthy. Production also contained checkout drift that
prevented the VPS source tree from proving exact correspondence to GitHub.
Decision:

- Probe the private WAHA service at unauthenticated `/ping`, with the existing
  timeout and without exposing WAHA or placing its API key in the Inbox app.
- Keep `/api/health` as liveness and `/api/readiness` as dependency readiness.
  Continue returning `404` for readiness and internal routes at the public edge.
- Reconcile `/opt/evo-inbox` to the exact reviewed GitHub `main` revision before
  deployment. Preserve prior drift in a read-only archive rather than deleting
  it or treating it as a release input.
- Leave the existing Caddy bind-mount source unchanged when byte comparison
  proves it is identical to the reviewed source.
- Require exact OCI revision/release labels, private Supabase and WAHA readiness
  before and after application restart, clean VPS source, public-route denial,
  and security-header checks as production evidence.
- This correction does not authorize a WAHA restart, QR relink, public port,
  WhatsApp send, amoCRM mutation, DNS change, CSP enforcement, backup-plan
  purchase, or final launch-complete claim.

Validation impact:

- PR #58 merged as `a09a72fc55d869c861df520f76d62413a2315fc1`
  after all four CI checks passed and an independent Codex launch-control review
  returned `approved`. GitHub's review API contains no submitted review record,
  so the approval remains task evidence rather than a GitHub approval.
- Production Inbox release `2026-07-24.2` matched that exact revision. Private
  readiness reported both Supabase and WAHA ready before and after application
  restart; WAHA remained private and unchanged.
- Record the refreshed production and blocker matrix in
  `docs/BLOCK_G_FINAL_AUDIT.md`. Block G remains externally blocked.

## 2026-07-24 - Close Remaining Internal CI and Production-State Gaps

Date: 2026-07-24, Asia/Bishkek.
Author: Codex.
Change type: plan freshness and non-disruptive production reconciliation.
Affected plan section: `/goal-evo-preplatform-hardening`, Blocks A, E, and G.
Reason: The refreshed Block G audit proves the reviewed authorization harness
exists and the authorized Inbox/Supabase release is deployed, but it does not
prove that GitHub Actions is required to run the real PostgreSQL role-policy
harness. A separate live audit also found that `/opt/evo-crm` is an old/dirty
operational checkout and that the running WAHA container does not have the
reviewed Compose resource limits applied. These are internal evidence gaps, not
reasons to weaken Block G or to infer owner approval for disruptive provider
work.
Decision:

- Add a dedicated, sequential CI-hardening block that requires
  `agent-lead2-inbox/scripts/test-postgres-authorization.sh` through the root
  `npm run test:security` command in GitHub Actions. It must use only
  ephemeral/disposable PostgreSQL, exercise real database roles and negative
  writes, and require no production connection or secret.
- Add a separate production-reconciliation block for `/opt/evo-crm`. Before
  changing its checkout, preserve all dirty and untracked state in a
  recoverable access-restricted archive. Reconcile the checkout to the exact
  reviewed source matching the deployed CRM/Lead Agent revision, then prove Git
  cleanliness and image provenance without restarting, recreating, rebuilding,
  or reconfiguring services.
- Audit legacy environment and configuration file permissions without exposing
  values. Tighten a file only when its identity, required runtime readers, and
  non-disruptive mode are proven; otherwise leave it unchanged and record the
  blocker.
- Record that the live WAHA container has unset `Memory`, `NanoCpus`, and
  `PidsLimit` even though the reviewed Compose definition declares limits. Do
  not recreate, restart, relink, or mutate WAHA merely to apply them. The older
  CRM WAHA session awaits QR/relink continuity planning, and any provider
  interruption is user-visible; owner approval is required first.
- Keep canonical DNS, registration policy, monitoring destination and owner,
  retention schedule and owner, CSP enforcement, RPO/RTO, real provider
  acceptance, and backup/restore as explicit owner/external gates. The
  owner-approved Supabase backup deferral remains narrow and does not satisfy
  the eventual database-plus-Storage restore requirement.
- Block G remains open. Completion requires the internal lanes above to be
  merged and verified and every remaining owner/external gate to be either
  satisfied with real evidence or reported as an exact blocker.

Validation impact:

- This plan-only PR changes no application, migration, workflow, VPS runtime,
  DNS, provider, or customer-visible state.
- Implement the CI lane before the operational checkout lane so repository
  gates are current before production evidence is reconciled.
- Treat the WAHA limit drift as documented and blocked until the owner-approved
  continuity procedure exists; planning does not authorize a runtime change.

## 2026-07-24 - Record Internal Hardening Closure Evidence

Date: 2026-07-24, Asia/Bishkek.
Author: Codex.
Change type: evidence-only closure record.
Affected plan section: `/goal-evo-preplatform-hardening`, remaining internal
closure lanes and Block G.
Reason: the sequential CI and production-checkout reconciliation lanes approved
in PR #60 are now merged and independently audited. The durable audit must
separate those closed internal lanes from the still-owner-controlled WAHA
runtime-limit change and the unchanged external acceptance gates.
Decision:

- Record PR #60 merged at
  `819c7f31bdd2cf899baf205151457b5fc1db32ac` and PR #61 merged at
  `e7d8be9dd0de464ae0440872a1f47ec33f17095e`.
- Record that all four PR #60 checks and all four PR #61 checks passed. The
  separate post-merge `main` run `30062821017` passed its three executed jobs
  at exact commit `e7d8be9dd0de464ae0440872a1f47ec33f17095e`;
  the PR-only `Changed range` job was skipped by design.
- Treat the root `npm run test:security` evidence as the required aggregate
  gate: `22/22` Node tests passed and the real disposable PostgreSQL role/RLS
  suite returned `PASS`. The PostgreSQL path uses bounded TCP readiness,
  guaranteed cleanup, and positive/negative cases for ordinary staff,
  privileged staff, `anon`, and server-only `service_role`.
- Record `/opt/evo-crm` as a clean detached checkout at exact deployed revision
  `564332b420a1fb1bd6232dda945d044bb922d3f0`, with
  `origin/main=e7d8be9dd0de464ae0440872a1f47ec33f17095e`.
- Preserve the prior `caa280ee536f6b93516987a674553bf1eb3c73a0`
  checkout and the untracked Lead Agent Git backup in
  `/opt/evo-archives/crm-source-reconcile-20260724T025648Z`. Manifest hashes,
  the complete Git bundle, the tar archive, and retained
  `stash@{0}=pre-reconcile-20260724T025648Z` were verified.
- Record `/opt/evo-crm` as `root:root`; the three real runtime environment files
  were already `root:root` mode `0600`. Secret values were not inspected.
- Record that the checkout reconciliation did not rebuild, recreate, restart,
  reconfigure, or otherwise change a production container.
- Record the final internal-gap audit verdict:
  independent Codex read-only review task `/root/audit_internal_gap_closure`
  returned `approved`. This was orchestration evidence, not a submitted GitHub
  PR review; GitHub review arrays may remain empty.
- Record that the original-checkout Malaysia knowledge-base modification and
  untracked presentation archive remain untouched.
- Keep both live WAHA containers' unset `Memory`, `NanoCpus`, and `PidsLimit`
  as an explicit `OWNER_BLOCKED` Block E/G runtime gap. Do not claim the
  reviewed Compose limits are active and do not recreate, restart, relink, or
  mutate either session until a restart/session-continuity and QR/relink plan
  is ready and the owner explicitly approves the provider risk.
- Keep every owner/external gate unchanged: canonical DNS, public-registration
  policy, monitoring destination and responsible owner, retention schedule and
  owner, CSP enforcement, RPO/RTO, the deferred real Supabase database-plus-
  Storage backup and isolated restore rehearsal, authenticated Inbox browser
  acceptance, real WhatsApp/amoCRM inputs and explicit send approval, older CRM
  WAHA QR/relink approval, and any legacy volume-permission correction.
- Keep the overall goal and Block G open. Internal closure evidence does not
  satisfy or waive any owner/external gate.

Validation impact:

- This evidence-only entry changes no application, migration, workflow,
  production runtime, provider, DNS, secret, or customer-visible state.
- The source evidence is GitHub merge/CI state, the actual aggregate test log,
  read-only production Git/file-metadata/container inspection, archive
  verification, and the independent audit verdict.
- A later final acceptance audit must still prove or explicitly retain every
  owner/external blocker; this entry must not be used to infer approval.

## 2026-07-24 - Plan The Unified EVO Platform Frontend

Source: owner request to review and complete the Claude Design handoff, then
begin the next implementation step.

Affected plan section: new planned `/goal-evo-platform-frontend` slice.

Reason:

- The Claude Design archive now provides a coherent high-fidelity direction for
  staff and student experiences, but it is a design reference rather than
  production Next.js code.
- Real browser review found material gaps that must be corrected during
  implementation: staff tablet/mobile overflow, phone-shaped desktop Student
  Portal, incomplete connected system states, external CDN dependencies,
  inaccessible click targets and unmanaged overlay focus.
- The repository already has one appropriate canonical frontend host: the root
  Next.js CRM with existing authentication, role checks and admissions read
  models. Starting a third frontend or treating EVO Inbox as the platform shell
  would duplicate those foundations.

Change:

- Add a planned frontend slice after a planning/evidence PR is independently
  reviewed and merged.
- Build the unified staff workspace and Student Portal in the root Next.js
  application.
- Treat EVO Inbox as the current WhatsApp runtime/data adapter and UX donor,
  not the canonical shell.
- Keep the first redesigned root `/whatsapp` view on its existing CRM `wa_*`
  shadow-data and guarded-action path. Label it truthfully; a Supabase Inbox
  read bridge is a later backend slice.
- Map prototype personas onto the existing five staff roles plus `client`.
  Do not create `leadership` or `inbox` roles, widen route access or reproduce
  the prototype switcher as real authorization.
- Preserve amoCRM as the source of truth for lead/contact identity and sales
  stage; keep operational student stages separate.
- Preserve draft-only AI and manual outbound sending.
- Exclude database consolidation, Supabase migration, Lead Agent deletion,
  backend ownership changes, production deployment and real outbound/provider
  mutations from this frontend slice.
- Require responsive browser evidence at 1440x1024, 834x1194 and 390x844 plus
  keyboard/focus checks before completion.

Validation impact:

- The planning PR contains documentation, the unmodified design handoff,
  browser/static audit evidence and one narrow ESLint ignore for that immutable
  reference directory. The ignore does not cover application source.
- Implementation begins in later PRs from refreshed `main`.
- Each implementation PR must run the root lint/build/affected tests and real
  browser checks for its owned routes.
- No prototype interaction or local success toast may be reported as real
  amoCRM, WAHA, Supabase, AI, telephony or persistence proof.

## 2026-07-24 - Finalize The Unified Frontend Handoff And Quality Gates

Source: owner request to finish the full frontend and make the linked local
repository plus one master prompt ready before another Claude Design pass.

Affected plan section: `/goal-evo-platform-frontend`, final validation and
handoff.

Reason:

- The route slices are now merged, but a final cross-product audit found a few
  gaps that individual route reviews could not close: mobile access to every
  Student Portal destination, durable labels and focus behavior, honest
  communication-state vocabulary, and automated accessibility coverage.
- The original IT-authored brief is useful product context but mixes business
  needs with unapproved technical assumptions. Claude Design needs one
  repository-local interpretation rather than an external document whose
  authority is unclear.
- The original completion checklist was intentionally blank and must become an
  evidence ledger that distinguishes implemented frontend behavior from
  backend/provider work.

Change:

- Complete the remaining responsive, keyboard, focus, live-region and
  communication-state presentation gaps without widening permissions or
  inventing provider data.
- Add an automated axe/Playwright WCAG A/AA regression pass for representative
  staff and Student Portal routes. Treat it as an automated safety net, not as
  a substitute for keyboard, visual or screen-reader review.
- Store an interpreted copy of the IT brief and one autonomous Claude Design
  master prompt under `docs/design/evo-platform/`.
- Update the completion checklist and final audit only from verified code,
  tests and current browser evidence.
- Keep all backend integration, database consolidation, Lead Agent retirement,
  provider configuration, deployment and real-message actions outside this
  finalization slice.

Validation impact:

- Run Node 22 lint, TypeScript/build, scenarios, security checks and the full
  Playwright suite.
- Exercise required desktop, tablet and mobile states in the in-app browser,
  inspect current screenshots and perform explicit keyboard/overlay checks.
- Record automated accessibility results separately from any manual
  assistive-technology limitations.
- Require independent read-only code, product-truth and accessibility review
  before merge.

## 2026-07-25 - Restore A Fail-Closed Dependency Gate Before Frontend Merge

Date: 2026-07-25, workspace timezone.
Author: Codex.
Change type: scope, security policy, validation, and merge order.
Affected plan section: `/goal-evo-dependency-hardening`.

Reason:

- Fresh registry audits now fail on both `origin/main` and PR #72 because
  PostCSS and `brace-expansion` advisories were published after the last green
  main build.
- The PostCSS advisory is present in the deployed dependency graph of both
  Next.js applications, so updating only Inbox would leave the root CRM
  production audit red.
- The remaining `brace-expansion` path is development-only and owned by
  `minimatch` 3 dependencies inside the current ESLint 9 and Next lint-plugin
  graph. The patched `brace-expansion` major is not a supported drop-in
  replacement for that callable API, while `npm audit fix --force` proposes
  breaking dependency changes.

Decision:

- Expand the user-requested PostCSS patch to both root CRM and EVO Inbox.
- Keep production dependency audits blocking with no exception.
- Replace the all-or-nothing full-audit step with a second fail-closed
  repository verifier. It may accept only
  `GHSA-mh99-v99m-4gvg`, only through the enumerated ESLint/minimatch chain,
  and only until the recorded review deadline. Zero advisories also passes.
- Any new advisory, affected package, malformed audit response, or expired
  exception fails CI. The known dev advisory remains visible in logs rather
  than being hidden by `continue-on-error`.
- Keep this as a separate hardening PR. Rebase and merge design-polish PR #72
  only after the hardening PR is independently approved and merged.

Validation impact:

- Use Node 22 and committed lockfiles.
- Run real root and Inbox production audits plus the constrained full-audit
  verifier.
- Run root security/unit/lint/type/build/scenario gates and Inbox
  lint/type/test/build gates.
- Require the normal GitHub workflow and an independent launch-control review
  before merge.

Reviewer notes: pending independent launch-control review.

## 2026-07-25 - Apply The Independent EVO Frontend Design Review

Source: owner-provided Claude Design review handoff, independently grounded in
the merged repository, final-audit screenshots, EVO logobook, audit and
completion checklist.

Affected plan section: `/goal-evo-platform-design-polish`.

Reason:

- The unified frontend is complete and coherent, but the independent review
  found four P1 usability issues and nine P2 consistency/density issues.
- The findings are implementation-ready and include exact responsive,
  accessibility, Russian-copy and acceptance requirements, so another
  discovery or prototype pass would add delay without resolving uncertainty.
- The requested work is safely bounded to frontend presentation and tests;
  it does not require a backend contract or provider mutation.

Change:

- Implement the review in four waves: P1 WhatsApp/visa/empty-state, P1 tablet
  navigation, P2 dashboard/Inbox and P2 Student 360/settings/portal polish.
- Use existing browser-visible routes and accessible DOM as the test seams.
  Add focused regression coverage before or with each behavior change and
  avoid implementation-detail assertions.
- Preserve amoCRM canonical ownership, AI draft-only behavior, current roles,
  truthful provider states and every existing server-side access check.
- Keep database schemas, provider integrations, Lead Agent retirement,
  Supabase consolidation, deployment and production state outside this slice.

Validation impact:

- Run the complete Node 22 lint, type-check, build, scenarios, security,
  Playwright and accessibility suites.
- Verify affected views at 1440x1024, 834x1194 and 390x844; capture fresh
  visual evidence for changed surfaces and previously source-only PASS routes.
- Require an independent final diff review against the 13 findings before
  commit/push/PR handoff.

## 2026-07-25 - Close Newly Published Frontend Dependency Advisories

Affected plan section: `/goal-evo-platform-design-polish`.

Reason:

- The mandatory final `npm audit` gate found two newly published high-severity
  advisories in the installed frontend toolchain:
  `GHSA-mh99-v99m-4gvg` for `brace-expansion` and
  `GHSA-r28c-9q8g-f849` for `postcss`.
- The vulnerable `brace-expansion` instances are owned by ESLint and by the
  current `eslint-config-next` plugin bundle through `minimatch` 3. A global
  package override would be unsafe because the patched `brace-expansion` 5
  CommonJS export is not API-compatible with the old callable export expected
  by `minimatch` 3.
- A trial ESLint 10 lockfile reduced but did not clear the finding:
  the latest `eslint-plugin-import`, `eslint-plugin-react` and
  `eslint-plugin-jsx-a11y` releases bundled by Next still declare ESLint 9 peer
  ranges and still require `minimatch` 3. This is an upstream development-tool
  blocker, not a production dependency path.

Change:

- Raise the existing `postcss` override to the first patched release.
- Keep the supported ESLint 9 line until the Next plugin bundle publishes a
  compatible patched graph. Do not use `npm audit fix --force`, a breaking
  global override, or hide the residual full-audit result.
- Expand the named write set only to `package.json` and `package-lock.json`.
  No application behavior, provider contract, database schema or deployment
  scope changes.

Validation impact:

- Reinstall from the lockfile under Node 22.23.1 and require a zero-vulnerability
  production audit (`npm audit --omit=dev`). Record the remaining dev-only
  upstream advisory separately from application security-test results.
- Re-run lint, TypeScript, production build, scenarios, security checks and the
  complete Playwright suite after the dependency change.

## 2026-07-25 - Make Design-Polish E2E Coverage Order-Independent

Affected plan section: `/goal-evo-platform-design-polish`.

Reason:

- The complete Playwright run intentionally shares one disposable database so
  earlier workflow tests can change demo records. New polish assertions that
  expected the untouched seed were valid in isolation but failed after those
  real mutations.
- Database-level WhatsApp setup also needs the exact same resolved path as the
  Playwright web server; recomputing a fallback path inside a worker can open an
  empty SQLite file instead.

Change:

- Extend the named write set to `playwright.config.ts`.
- Publish the already-resolved disposable database path to Playwright workers.
- Assert ordering, semantic categories and live record-derived content instead
  of fixed seed names or counts.
- Keep every direct database mutation locally reversible with `try/finally`.

Validation impact:

- Re-run affected specs in isolation and then the full two-project Playwright
  suite from a fresh disposable database.

## 2026-07-25 - Reconcile Design Polish With Merged Dependency Hardening

Affected plan sections: `/goal-evo-dependency-hardening` and
`/goal-evo-platform-design-polish`.

Reason:

- Dependency hardening merged first as PR #73 at
  `df9d908a93555ff78d72c6435f7b5737f9b8431a`.
- The design branch's earlier PostCSS 8.5.18 experiment and lockfile churn are
  superseded by the independently reviewed PostCSS 8.5.23 hardening.

Change:

- Retain the root manifest and lockfile from merged dependency hardening,
  including PostCSS 8.5.23.
- Retain the merged production audit, narrow development allowlist and
  fail-closed verifier without modification.
- Preserve all design source, tests, screenshots and closure evidence.
- Do not change product behavior, provider contracts, database schemas or
  deployment state while resolving the rebase.

Validation impact:

- Re-run clean install, production and development audit gates, the root CI
  suite and full Playwright suite from the rebased commit.
- Require a fresh independent review before PR #72 is merged.

## 2026-07-25 - Close Independent Design Review Evidence Gaps

Affected plan section: `/goal-evo-platform-design-polish`.

Reason:

- Independent review of the rebased commit found that the dashboard all-clear
  state was asserted through imported component helpers rather than through
  the public browser-visible route required by the plan.
- The 834px navigation implementation deliberately keeps a 220px labelled
  sidebar visible instead of using the originally proposed icon-only rail with
  hover/focus tooltips. Persistent labels reduce discovery and keyboard
  ambiguity, but this accepted design change was not recorded in the append-only
  decision log.
- The closure evidence had no committed dark-theme WhatsApp capture and no
  fresh captures of the changed dashboard, Student 360 and role-matrix states.
- The role matrix also exposed a prohibited ARIA name and a keyboard-inaccessible
  horizontal scroll region once the roles tab was added to automated Axe
  coverage.

Change:

- Accept the persistent labelled 220px tablet navigation as the F3 outcome.
  Keep distinct icons, visible labels, focus indication, active state and
  overflow protection as the behavior contract; no tooltip is required while
  labels remain permanently visible.
- Replace private-helper-only dashboard assertions with a browser test that
  drives a reversible all-clear database state and verifies the rendered
  operator copy.
- Give role indicators a valid named semantic role, make the scroll region
  keyboard focusable, and include `/settings?tab=roles` in the Axe suite.
- Add stable committed screenshots for the dark WhatsApp state and the changed
  dashboard, Student 360 and role-matrix states. Continue restoring all other
  test-regenerated screenshot noise after validation.

Validation impact:

- Run lint and focused desktop/mobile Playwright checks for navigation,
  dashboard, Student 360, roles, WhatsApp and Axe.
- Re-run the complete root validation and GitHub CI on the new commit.
- Require the same independent reviewer to confirm the remediations before
  merge.

## 2026-07-25 - Make The Final EVO Platform TZ The Backend Contract

Affected plan section: `/goal-evo-platform-final-tz`.

Reason:

- The unified frontend and its independent design-polish review are complete,
  while the real backend still spans the main CRM, EVO Inbox, Lead Agent,
  separate persistence models and more than one WAHA session.
- Starting backend work before data ownership, role authority, synchronization,
  retry, audit and retirement gates are written would recreate the duplication
  the platform is intended to remove.
- The owner-provided OZO document contains useful first-iteration process
  context, but the owner explicitly warned that its technical interpretation
  may be incomplete or incorrect.

Change:

- Create a full Russian-language technical specification as the single
  implementation contract before any unified-platform backend change.
- Adopt one Supabase project per environment and one shared platform schema
  within each environment. Supabase owns EVO operational data; amoCRM remains
  canonical for lead/contact identity, responsible manager and sales stage.
- Specify one WhatsApp/WAHA integration and absorb useful Lead Agent behavior
  into the unified backend. Keep Lead Agent available as a rollback path until
  a real controlled end-to-end test and reconciliation prove replacement.
- Keep customer-facing AI draft-only and require an employee to review and send
  each outbound reply. Any future auto-send mode requires a separate owner
  decision, risk review and acceptance plan.
- Treat the merged frontend, its access rules and committed screenshots as the
  approved interaction baseline. Do not reopen a design-from-zero phase inside
  the specification.

Validation impact:

- Trace every material requirement to repository evidence, the OZO brief, an
  ADR, the business process documents or an explicit owner decision.
- Render and inspect every DOCX page, audit accessibility and independently
  review the finished specification before merge.
- Keep backend code, migrations, production providers and real customer data
  outside this slice.

## 2026-07-26 - Make TZ Provenance And DOCX Verification Reproducible

Affected plan section: `/goal-evo-platform-final-tz`.

Reason:

- Independent launch-control review found that the main requirement tables
  named a future verification method but did not expose item-level provenance.
- The committed DOCX builder depended on an already-prepared Codex runtime and
  did not give another contributor a pinned dependency manifest or one command
  that performs a real render and accessibility/traceability audit.
- The builder duplicated a document-card summary outside the canonical
  Markdown source.

Change:

- Add a source catalog and individually enumerate every `FR`, `INT`, `DATA`,
  `SEC`, `NFR`, `ACC` and `DEC` ID in a provenance matrix.
- Add a pinned `python-docx` manifest and a repo-owned verifier that builds the
  document, uses real LibreOffice and Poppler rendering, checks the DOCX
  package, requirement coverage, provenance, alt text, table headers, heading
  hierarchy and hyperlinks, and writes JSON evidence.
- Keep all substantive content in `docs/specs/EVO_PLATFORM_TZ.md`. The
  generator may add only the branded cover, footer and Word TOC mechanics.
- Record the exact hashes, page count, accessibility result and human
  page-by-page inspection in a committed validation ledger.

Validation impact:

- Prove the workflow from a fresh isolated Python environment created from the
  committed dependency manifest.
- Require zero unresolved accessibility findings at every severity.
- Repeat independent review after these changes; merge remains blocked until
  the reviewer returns `approved`.

## 2026-07-28 - Activate Unified EVO Platform Long-Run Contract

Affected plan section: `/goal-evo-platform-long-run`, P0–P10.

Change type: active goal, target architecture, business authority, schema and
provider boundaries, merge order, acceptance criteria, validation and
production authorization.

Reason:

- The accepted frontend and the 2026-07-26 specification provide a strong UI
  and traceability baseline, but they do not prove a unified backend or live
  provider path.
- The specification still treated `visa` as a separate first-release role,
  left already decided business policies open, described one Supabase project
  per environment too rigidly, and used a proposed 14-day Lead Agent retirement
  window instead of the fixed minimum 72-hour evidence gate.
- Current production remains split across root SQLite/custom auth, EVO Inbox
  Supabase/WAHA, and a frozen EVO Lead Agent. Target documents must not pretend
  cutover has already happened.

Decision:

- Make `docs/EVO_PLATFORM_LONG_RUN_PLAN.md` the detailed current execution
  contract and retain `docs/EVO_LAUNCH_PLAN.md` as the root launch-control
  index and historical record.
- Use roles `admin`, `sales`, `curator`, `finance` and `client/student`; preserve
  the `/visa` module without a separate Visa role. Only Admin invites/blocks
  staff and assigns/reassigns Curator. A reason, before/after values and audit
  are mandatory for reassignment.
- Keep one Curator responsible for the complete student case. Sales owns the
  queue/conversation before confirmed contract; Curator owns it after handoff.
  The history remains unified and Sales receives only an authorized
  non-sensitive summary after handoff.
- Treat the signed-contract signal only through discovered, versioned,
  account-specific amoCRM mapping. It creates a pending case; Portal activates
  only after Admin Curator assignment.
- Make EVO Platform the temporary manual operational finance source. Only
  Finance/Admin confirm payments/refunds with evidence and audit. Defer
  Excel/1C integration instead of creating a fake connector.
- Limit v1 notifications to durable in-app plus individual WhatsApp delivery.
  Limit private documents to PDF/JPG/PNG at 25 MB, with versions,
  integrity/malware policy, review/rework history and audited access. Do not
  auto-delete until Legal/Data Owner fixes retention.
- Restrict AI to approved versioned knowledge and RU/EN drafts derived from the
  last customer message. Uncertain language requires manual selection/handoff.
  Remove Kyrgyz customer-draft generation from the first-release contract.
  Never guarantee admission, scholarship, visa or another external decision.
- Keep amoCRM canonical for contact, lead, responsible sales manager and sales
  stage. Use one dedicated Supabase production project for all platform-owned
  data while keeping local/dev, persistent staging and preview
  branches/projects physically isolated and empty of production data by
  default.
- Target one private `evo-inbox` WAHA session and one webhook owner. Absorb
  useful Lead Agent identity, HMAC/idempotency, event persistence, jobs,
  amoCRM, handoff, retry/dead-letter and reconciliation logic, but never active
  auto-reply.
- Execute ordered blocks P0–P10. P0 is docs-only and must merge before code.
  Permit only one implementation PR at a time. Every PR needs exact local/CI
  evidence plus an independent, head-SHA-bound launch-control review. The
  executor does not merge its own PR; an independent merge-controller is the
  only merger.
- Require at least 72 actual hours of stable real traffic, zero unexplained
  loss/duplicates/drift, reconciliation and proven rollback before a separate
  Lead Agent retirement PR.
- Keep production deployment/migrations, DNS, WAHA QR/session changes, live
  customer WhatsApp sends, real amoCRM mutations and service deletion outside
  this run.

Remaining decisions:

- exact amoCRM account/pipeline/status/custom-field/user mappings;
- Supabase region/plan/PITR/cost;
- capacity/SLO/RPO/RTO;
- retention/privacy/residency/DPA/legal deletion;
- AI provider/model and permitted-data policy;
- dedicated sanitized test sender number, `evo-inbox` production
  QR/session-recovery owner and controlled test-send authority;
- release window, freeze rules and rollback authority.

Validation impact:

- P0 must rebuild the DOCX deterministically, pass the requirement/provenance,
  structure, hyperlink and accessibility verifier, render through real
  LibreOffice/Poppler, and record visual inspection of every page.
- Later blocks run their changed-scope checks plus the full applicable root,
  Inbox, Lead Agent, Supabase, Playwright, security, backup/restore and GitHub
  exact-head gates defined in the long-run plan.
- Unit/contract tests and configured flags remain narrow evidence; live
  provider acceptance is `blocked` until a real sanitized test path exists.

## 2026-07-28 - Bind Generated TZ Metadata And Decision Table Geometry

Affected plan section: `/goal-evo-platform-long-run`, P0 documentation
validation.

Change type: deterministic document-generation correction.

Reason:

- The first P0 regeneration revealed that the branded DOCX cover and running
  header still duplicated stale version/date/base-SHA values instead of using
  the canonical Markdown metadata.
- Page-by-page visual inspection also found an unreadable decision registry:
  the narrow gate column broke words into fragments and LibreOffice split
  `DEC-005` across pages without a useful repeated heading.
- The first evidence renderer used Poppler at 150 DPI. On this runtime that
  scale corrupted geometry on some PNG rasters even though the source PDF and
  isolated 144-DPI renders of the same pages were correct, so those 150-DPI
  PNGs could not be accepted as visual evidence.
- `NFR-007` still proposed numeric RPO/RTO values even though DEC-010 correctly
  leaves those targets for an accountable owner decision.

Decision:

- Derive generated cover/header metadata from
  `docs/specs/EVO_PLATFORM_TZ.md`; do not maintain a second hand-edited copy in
  the generator.
- Give the decision/gate column the dominant width and keep status compact so
  the registry remains readable in the committed rendering workflow.
- Keep numeric RPO/RTO open under DEC-010. Restore rehearsals report measured
  results but cannot silently turn them into approved targets.
- Count PDF pages with Poppler and rasterize every page at fixed 144 DPI
  (exactly two pixels per PDF point) in its own `pdftoppm -singlefile` process.
  This makes the evidence scale reproducible and prevents one damaged raster
  process from contaminating the page-by-page review.

Validation impact:

- Rebuild and verify the DOCX after these corrections.
- Discard visual evidence from the superseded render and inspect every page of
  the final render again.

## 2026-07-28 - Align Long-Run Dependency Gates With Current CI Policy

Affected plan section: `/goal-evo-platform-long-run`, validation baseline.

Change type: validation-command correction.

Reason:

- The first P0 draft described a raw full dependency audit even though the
  repository already has a fail-closed development-advisory policy in
  `config/npm-audit-allowlist.json` and
  `scripts/check-npm-audit-allowlist.mjs`.
- The exact shared CI commands use a blocking production audit at moderate
  severity plus that constrained allowlist checker. Replacing them with a
  different raw audit would make local evidence diverge from exact-head CI.
- `next` and TypeScript are already pinned project dependencies, so validation
  should invoke their local binaries without package resolution.

Decision:

- Keep `npm audit --omit=dev --audit-level=moderate` blocking for root and
  Inbox production graphs.
- Validate the full development graph only through the committed allowlist
  checker; unapproved, expired or changed advisories remain blocking.
- Invoke project-local Next typegen and TypeScript binaries.

Validation impact:

- Run the corrected commands locally and verify the exact-head GitHub
  `EVO platform CI` jobs before accepting the PR.

## 2026-07-28 - Label Legacy Visa-Role Screenshot As Historical Evidence

Affected plan section: `/goal-evo-platform-long-run`, P0 owner-facing TZ
design evidence.

Change type: evidence-interpretation correction.

Reason:

- The accepted roles-matrix screenshot is useful frontend evidence but reflects
  the pre-P1 runtime and visibly contains a separate `Визовый отдел` column.
- Without an adjacent warning, an owner could reasonably read that image as
  contradicting the fixed no-Visa-role contract even though screenshots are
  non-normative.

Decision:

- Preserve the accepted screenshot without redesign.
- Place an explicit visible warning immediately before it: the column is
  historical current-runtime evidence, the normative section 11 matrix
  supersedes it, P1 removes the business `visa` role, and `/visa` remains a
  Curator-owned module.

Validation impact:

- Regenerate the DOCX and restart inspection of every page from the final
  artifact; superseded visual passes are not evidence.

## 2026-07-28 - Add P1D Current-Root WhatsApp Object-Scope Gate

Affected plan section: `/goal-evo-platform-long-run`, P1 current-app
role/RBAC/handoff correction.

Change type: execution-order, authorization-scope and acceptance amendment.

Reason:

- P1A-P1C are merged through PR #78, but root `/whatsapp` still uses local
  SQLite `wa_*` shadow tables with only coarse Admin/Sales/Curator route checks.
- Conversation list/detail/message queries, send/read/create actions and
  `/api/ai/draft` do not yet apply responsible Sales, assigned Curator or
  post-handoff object scope.
- The target P5 unified communications block is intentionally broader: one
  Supabase model, Inbox/Lead Agent absorption, one WAHA owner, raw persistence,
  identifiers, ACK/outbox/reconciliation and manual-send audit. Mixing that
  provider/data redesign into a current-app authorization fix would create a
  mega-PR and weaken rollback evidence.
- Manual creation in the current root form cannot prove a non-Admin owner
  without the later amoCRM resolution/linking path, so allowing Sales or
  Curator to create an unlinked row would contradict fail-closed scope.

Decision:

- Add P1D as a sequential current-app authorization sub-block before P2.
- Limit P1D to the existing root SQLite/custom-auth `/whatsapp` path.
- Admin has full access. Responsible Sales has full access to a linked lead or
  pending case. Assigned Curator has full access after handoff for active/closed
  cases. Former responsible Sales receives only the safe case summary.
- Unrelated staff, Finance, Student, broken links, ownerless links and unlinked
  rows fail closed for non-Admin actors.
- Manual conversation creation is Admin-only until P4/P5 can prove canonical
  ownership during resolution/linking.
- Apply one actor/object policy to SQL reads, direct routes, lead-page lookup,
  replayed send/read/create actions and `/api/ai/draft`, with denial before
  protected reads, mutation, AI or WhatsApp provider access.
- Keep P1D schema-free and provider-free. Do not change WAHA session/webhook,
  Inbox Supabase, Lead Agent, transport, ACK/outbox/retry/reconciliation or
  production state.
- Block runtime implementation until this docs-only amendment is independently
  reviewed and merged.

Validation impact:

- The amendment PR is docs-only and requires plan/decision hash verification,
  `git diff --check`, secret/PII review, changed-scope documentation checks,
  exact-head CI and an independent launch-control verdict.
- The later implementation PR must prove the full actor/state/link matrix with
  positive and negative production-path tests, direct-route and Server Action
  replay denial, unchanged SQLite state on denial, and AI denial before the
  provider boundary.
- Real-provider proof is not required for P1D and must not be inferred from
  configuration, mocks or local authorization tests.
