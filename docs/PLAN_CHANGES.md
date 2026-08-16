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
- Admin has full access. Responsible Sales has full access only to a proven
  lead-only row whose conversation has no case link, whose lead resolves and
  whose lead also has no case link, or to a valid directly linked pending case.
  Assigned Curator has full access after handoff for active/closed cases. Former
  responsible Sales receives only the safe case summary.
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

## 2026-07-28 - Fail Closed On Indirect Or Conflicting WhatsApp Case Links

Affected plan section: `/goal-evo-platform-long-run`, P1D current-root
WhatsApp object scope.

Change type: authorization-edge clarification before implementation.

Reason:

- Root conversations are normally created with `lead_id` and no
  `wa_conversations.client_id`.
- A lead can later acquire `leads.client_id` when it becomes associated with a
  student case. If the conversation link is not updated, treating it as
  lead-only would preserve Sales transcript/send access after handoff.
- Direct and lead-derived case links can also disagree. Guessing which one is
  current would weaken the fail-closed boundary and hide reconciliation debt.

Decision:

- Lead-only Sales access requires all three facts:
  `wa_conversations.client_id IS NULL`, `lead_id` resolves, and the resolved
  `leads.client_id IS NULL`.
- Every non-null raw `wa_conversations.client_id` and `lead_id` that participates
  in resolution must resolve; a dangling raw link remains Admin-only even when
  the other direct link is valid.
- When the lead already points to a case but the conversation does not, the
  direct and indirect case links conflict, either required link is broken, or
  the applicable owner is absent, only Admin has access until reconciliation.
- When direct and lead-derived case links are both present and consistent, the
  direct student-case lifecycle and handoff rule governs.
- P1D does not repair association data or infer canonical ownership. P4/P5
  remain responsible for provider-backed resolution and reconciliation.

Validation impact:

- Add positive proof for a true lead-only row where both case links are absent.
- Add negative list/detail/action/API tests for indirect lead-to-case rows and
  conflicting direct/lead case links, including unchanged SQLite state and no
  AI/WhatsApp provider invocation.
- Recompute plan/decision hashes and repeat exact-head CI plus independent
  launch-control review before merge.

## 2026-07-28 - Close Derived WhatsApp Metric And Create-Control Leaks

Affected plan section: `/goal-evo-platform-long-run`, P1D current-root
WhatsApp object scope.

Change type: authorization-surface completion before implementation.

Reason:

- Root lead and dashboard queries derive WhatsApp last-touch, message-count,
  unread, response-time and aggregate values from globally visible
  conversations.
- Those fields reveal protected communication state even when transcript access
  is summary-only or denied.
- The shared TopBar also exposes a manual-conversation shortcut outside the
  inbox component, while P1D makes creation Admin-only.

Decision:

- Apply the P1D full-conversation predicate to every WhatsApp-derived shared
  lead/cockpit metric, including queries called by Sales, dashboard, calls and
  tasks. Summary-only and denied actors receive no protected recency, count,
  unread, response-time or aggregate value, even when a caller would not render
  it.
- Treat derived metrics as protected conversation data, not harmless
  analytics; they cannot be loaded globally and redacted later.
- Hide every manual-create entry point, including the shared TopBar shortcut,
  from non-Admin actors while retaining the server-side Admin guard.
- Keep the change inside current-root authorization containment. Unified
  reporting and communications analytics remain later-platform work.
- For P1D evidence, `production-path tests` means local integration tests that
  exercise production code paths with synthetic data only and perform no
  production or provider mutation.

Validation impact:

- Add local integration assertions through production code paths for `/sales`,
  `/sales/[id]` and `/dashboard` proving protected metrics disappear
  immediately at handoff or denial, plus query-level evidence that `/calls` and
  `/tasks` do not load global WhatsApp fields through shared lead queries.
- Test both inbox-local and TopBar create controls for Admin-positive and
  non-Admin-negative behavior.
- Retain direct Server Action replay tests because hidden controls alone are
  not authorization.

## 2026-07-28 - Protect P1D Lead Ownership Inputs

Affected plan section: `/goal-evo-platform-long-run`, P1D current-root
WhatsApp object scope.

Change type: authorization-bypass closure before implementation.

Reason:

- P1D's temporary lead-only conversation rule uses the local shadow
  `leads.manager_id` to identify the responsible Sales user.
- The current `addLeadAction` and `updateLeadAction` accept a caller-supplied
  `manager_id`, and the manager selector is visible to Sales.
- Without an ownership-mutation guard, an unrelated Sales user could assign the
  lead to themselves and manufacture the predicate that unlocks transcript,
  draft and manual-send access.

Decision:

- Treat local lead ownership as authorization input for the P1D containment
  period.
- Ignore caller-supplied `manager_id` when Sales creates a local lead and force
  the authenticated Sales actor as owner.
- Permit a Sales profile update only for an already-owned lead and preserve the
  stored owner even when the request contains a forged `manager_id`.
- Allow only Admin to select or reassign the temporary local owner; validate
  that a selected non-null owner resolves to an active `sales` account.
- Hide manager selection from Sales while keeping the server-side guard
  authoritative.
- Do not treat this local shadow update as a canonical amoCRM
  `responsible_user_id` write. P4 remains responsible for account-specific
  mapping, canonical writes and reconciliation.
- Return at most one static post-handoff summary per case and sort it only by
  allowlisted case fields. Conversation multiplicity and message recency must
  not leak through duplicate rows or ordering.
- Re-authenticate and re-resolve object scope at the final server boundary so a
  stale page or captured action from before handoff cannot invoke AI, WhatsApp
  or a protected database mutation.
- Limit the P1D provider claim to authorization-before-invocation. WAHA
  `WORKING` readiness, removal of unsafe account-routing fallback and delivery
  correctness remain P5 gates.

Validation impact:

- Add negative local integration coverage for forged owner values during Sales
  create/update and for an unrelated Sales takeover attempt.
- Prove denied takeover leaves the lead and conversation access unchanged, and
  an allowed Sales profile update preserves the existing owner.
- Add Admin-positive validated-owner coverage and Sales-negative UI coverage
  for manager selection.
- Prove one static summary row per case with no message-derived ordering and
  zero provider invocations from a stale post-handoff action.

## 2026-07-28 - Decompose The Canonical Supabase Foundation

Affected plan section: `/goal-evo-platform-long-run`, P2 unified Supabase
foundation.

Change type: architecture refinement, migration ownership, execution order and
acceptance amendment.

Reason:

- The previous P2 paragraph combined repository migration reconciliation,
  namespace creation, identity/RBAC, the complete operational model, real
  Queues/Storage behavior and restore evidence in one block.
- The repository currently has one contiguous legacy Inbox history,
  migrations 001–039, under the companion path and no root
  `supabase/config.toml`.
- New Platform roles cannot safely inherit the legacy Inbox
  `owner/admin/agent/viewer` model, and a legacy signup side effect must not
  create Platform membership.
- Local schema/RLS evidence cannot prove managed-project migration parity,
  branching, PITR or production restore. Database restore evidence also cannot
  stand in for Storage-object restore.
- Existing public `avatars` and `flow-media` compatibility cannot be changed
  silently while adding new private Platform document/media storage.

Decision:

- Add ADR 0015 as a refinement of ADR 0014. Root `supabase/` becomes the sole
  repository migration authority in P2A.
- Move 001–039 byte-for-byte, record checksums and add the pinned project-local
  CLI/config/test harness in P2A. P2A creates no migration 040.
- Keep `public` for legacy Inbox compatibility, create `platform` as the
  explicitly granted/RLS-protected exposed schema, and keep
  `platform_private` backend-only and outside the Data API.
- Give browser roles no direct `platform_private` or `pgmq_public` access.
- Do not implicitly map legacy roles to Platform
  `admin/sales/curator/finance/student`, and do not create Platform membership
  from the legacy signup trigger.
- Use `student` as the target machine role for the user-facing Client/Student
  class. The current root `client` identifier remains legacy and maps only
  through the explicit P3 identity migration.
- Execute P2 sequentially as P2A canonical history, P2B namespaces/grants and
  verified legacy containment, P2C identity/RBAC/audit, P2D
  cases/admissions/visa/tasks, P2E document metadata/finance/notifications,
  P2F communications/provider/AI contracts, P2G real local Queues, P2H real
  local Storage and P2I whole-foundation/restore evidence.
- Treat merged migrations as immutable. Corrections use the next free forward
  migration. Starting with the expected 040, changes remain additive: no
  legacy table rename/drop, root-auth cutover, real-secret copy, legacy bucket
  flip or production migration.

Validation impact:

- P2A must prove byte/checksum identity for 001–039, a clean local Supabase
  reset/migration list and equivalent legacy schema/RLS inventory.
- P2B must verify current Inbox consumers before containing the proven
  browser-readable ciphertext/secret-bearing columns and backend-only secret
  writes; it must not overclaim plaintext credential exposure.
- P2C–P2F require cross-role, cross-organization and two-student negative
  matrices appropriate to each domain slice.
- P2G and P2H require real local Supabase Queues/PGMQ and Storage API behavior;
  handcrafted mocks are insufficient.
- P2I requires a separate isolated database restore and Storage-object
  restore, plus clean reset, RLS/grant inventory and browser-secret scanning.
- `real-provider-proof: not-required` remains truthful for the docs/schema
  blocks. Managed migration-ledger parity, remote branching, plan/PITR and
  managed restore remain blocked until region/plan, credentials and production
  authority exist.
- Rollback for this amendment is a docs-only revert. P2A is a reversible
  repository path move before remote apply. From the first new migration
  onward, rollback is a separately reviewed forward migration; restoring
  public secret grants is not an automatic rollback.

## 2026-07-28 - Advance The P2 Checkpoint After Canonical Authority

Affected plan section: `/goal-evo-platform-long-run`, current execution
checkpoint and P2 sequential merge gate.

Change type: docs-only plan-freshness correction; no architecture, scope, API,
schema, file-ownership or acceptance-criteria change.

Reason:

- The P2 decomposition amendment merged as PR #81 and P2A canonical migration
  authority merged as PR #82.
- Exact new `main` is
  `8ad755b5039390f418dbe12924a806f069f93b53`, and its push CI is green.
- The two active plan headers still described the already-merged P2
  decomposition as active and P2A as blocked.
- The independent merge-controller therefore rejected P2B PR #83 at plan
  freshness before evaluating code correctness. Its branch and implementation
  head remain preserved for rebase after this amendment.

Decision:

- Record P2 decomposition and P2A as completed launch-control gates.
- Make this narrow checkpoint-freshness amendment the only active block until
  it is independently reviewed and controller-merged.
- Make the checkpoint self-advancing: at this amendment's merge commit, P2B
  becomes the active block under the already-approved contract. No additional
  docs-only PR is required solely to restate that transition.
- Keep P2B as the next implementation block with the already-approved
  contract: migration 040 owns `platform`/`platform_private` namespace and
  grant containment plus verified legacy secret-path containment.
- Preserve the sequential P2A-P2I order and all existing provider,
  production-mutation, rollback, RLS, Storage, Queues and restore boundaries.
- Do not treat the earlier P2B CI or review as reusable merge authority. After
  this amendment merges, rebase P2B onto fresh `main`, rerun exact-head
  validation and obtain a new SHA-bound independent review.

Validation impact:

- This amendment must remain limited to the current-checkpoint surfaces in the
  two active plan files and this append-only entry.
- Run documentation link/format checks, `git diff --check`, repository
  secret/PII guardrails and exact-head GitHub CI.
- Require a fresh independent launch-control review and controller-only merge
  for this docs-only block.
- P2B remains unmerged and makes no production, managed Supabase, provider,
  WhatsApp, WAHA, amoCRM, DNS or customer-data mutation while the freshness
  prerequisite is processed.

## 2026-07-30 - Greenfield Platform UI And Data Boundary

Affected plan section: `/goal-evo-platform-long-run`, checkpoint, execution
order, backend boundary and thin-slice definition.

Change type: architecture and sequencing amendment.

Reason:

- The repository now contains merged unified frontend work from PRs #64, #71
  and #72 that already defines the intended product UI and route language.
- The previous plan still implied too much coupling to root SQLite/root auth,
  broad Inbox parity, P2I restore as a thin-slice blocker, and fixed-hour
  retirement/observation language.
- Current reality remains split across root SQLite/custom auth, EVO Inbox
  Supabase/WAHA and EVO Lead Agent. The next product step needs a narrower
  contract: one greenfield Supabase-native messaging slice behind the existing
  frontend, not broad backend parity or a parallel UI.

Decision:

- Treat the Platform backend as greenfield and Supabase-native: no legacy
  SQLite data import, no legacy account import, no root-auth migration, and no
  dual-read or dual-write bridge.
- Keep the current deployed root CRM as a separate legacy system with no
  automatic import, replacement or integration. Keep Inbox and Lead Agent as
  deployed messaging references until an explicitly authorized bounded
  provider cutover.
- Treat P1A-P1D as historical legacy containment only. Treat merged P2A-P2H as
  reusable greenfield foundation. Move former P2I restore duties to P7; they
  remain required later but do not block the thin slice.
- Keep the merged unified frontend from PRs #64/#71/#72 as the sole product UI
  contract. Wire it through repository/session seams rather than replacing it
  or reviving a parallel Inbox UI.
- Reuse only Inbox operator messaging capability: conversation list/thread,
  necessary contact/student context, WAHA receive/send, ACK/delivery, AI
  draft, staff manual send, approved knowledge, audit and minimal
  health/settings.
- Exclude Inbox CRM/dashboard/pipeline/deal/lead/broadcast/flow/campaign and
  unrelated analytics/settings surfaces from the Platform thin slice.
- Replace the fixed-duration current-authority requirement with bounded
  controlled-cutover evidence: zero unexplained loss or duplicates in the
  evidence window, health checks and rollback proof.
- Set the current amendment checkpoint to `b10d72863230aba646bcc8f2acafdc76c27b3fe1`
  and prioritize P3 thin messaging slice first, bounded amoCRM/WAHA/AI proof
  second, broader Student 360 later.
- Deliver P3 as sequential reviewable seams: P3A Supabase SSR/session/RBAC,
  P3B existing `/whatsapp` list/thread repositories, and P3C approved
  knowledge/draft-review/manual-send/outbox/audit state. Provider calls remain
  fail-closed; real amoCRM proof is P4 and real WAHA/AI/ACK proof is P5.
- OP/OZO/Student Profile/country overlay workflow specifics require a later
  sequential docs-only amendment rebased on this contract. That later work must
  reuse the same Supabase foundation and existing frontend and must not open a
  competing plan PR.

Validation impact:

- Keep historical plan-change entries intact and append this amendment only.
- Update the active plan/context docs to reflect the greenfield data boundary,
  unified-frontend-only UI contract, thin messaging scope and revised cutover
  evidence gate.
- Update the canonical TZ/DOCX/validation and architecture/status documents,
  but do not change runtime code, migrations, production configuration or
  provider state as part of this amendment.

## 2026-07-30 - Add The Business-Workflow Execution Lane

Date: 2026-07-30, Asia/Bishkek workspace timezone.

Author: Codex.

Block-ID: `EVO-BW0-BUSINESS-WORKFLOW-PLAN-2026-07-30`.

Change type: business workflow, source authority, lifecycle normalization,
implementation order, dependency/file ownership, acceptance criteria and
reversible assumptions.

Affected plan section: `/goal-evo-platform-business-workflows`, the active
launch-control slice after merged PR #93.

Reason:

- PR #93 merged the greenfield Supabase-native data boundary, existing
  unified-frontend-only UI contract, narrow operator-messaging donor scope and
  bounded cutover gate at exact `main`
  `26115344909261a39bbe591f3b835cda4b7e5068`.
- The Ultimate EVO Google Doc contains current OP/OZO country funnels,
  post-contract checklist/template needs, Lead Manager prompt/knowledge/handoff
  material and unresolved operational questions. Its employee OP #1-#4 and OZO
  #1-#5 real-flow slots, Student Profile, colleges and Accounting/Bema inputs
  are empty.
- The business discovery must become a reviewable repository contract before
  application code, without turning Drive/Sheets/Notion into runtime authority,
  copying customer PII or creating country-specific hardcoded applications.

Verified source boundary:

- The Ultimate EVO document was inspected read-only on 2026-07-30:
  <https://docs.google.com/document/d/1-ZrRawX2gdCmwz-vq8vYEBXnzSDVC-10wUeCuPhwlaA/edit>.
- The linked China checklist is an accessible 21-page source with document
  requirements and linked examples/templates. It is operational input pending
  owner review, not proof of current legal/university/consular validity:
  <https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view>.
- The linked admissions Sheet was inspected only for workbook and tab metadata
  (Dubai, Italy 2026, Italy 2027, Poland, China and Czech 2026). Student rows
  were not read or copied. The linked Drive folder was confirmed accessible
  without enumerating student folder names or files.
- The linked university Notion database is blocked behind AbdyldaYT workspace
  sign-in. No university records were inferred. Colleges has no confirmed data.

Decision:

- Keep the Claude Design-derived root frontend from PRs #64/#71/#72 as the
  sole UI contract. Do not create a new design system, parallel admin UI,
  fallback Inbox UI or localStorage/demo data plane.
- Keep Platform greenfield and Supabase-native from day one: no SQLite/root-auth
  migration, legacy account/data import, dual-read/dual-write or automatic
  legacy import.
- Keep amoCRM canonical for contact, lead, responsible sales manager and sales
  stage. Normalize OP into a small active lifecycle; treat no-answer/no-show as
  follow-up outcomes, event/collaboration values as source/deal metadata and
  closure as an explicit result plus reason.
- Model OZO as one common admissions lifecycle with independent application,
  document, visa, finance, housing, insurance and travel statuses. Model China,
  Italy, Czech/Poland, UAE/Turkey and Malaysia as versioned overlays with
  source/review metadata.
- Add a minimized country-neutral Student Profile plus versioned
  country-specific requirements. Collect sensitive fields/files only when an
  approved requirement needs them and only through the private document path.
- Version and approval-gate checklists, templates, generated contract drafts,
  post-contract reports, prompts, knowledge, Q&A decisions and catalog imports.
  Generated contracts remain drafts until authorized staff approval.
- Keep Lead Manager AI RU/EN draft-only with human review/edit/manual send.
  Kyrgyz or uncertain language fails to manual language selection.
- Keep Finance limited to already-approved obligations, payments, refunds,
  evidence and audit. Empty Accounting/Bema input does not authorize a general
  accounting system.
- Keep P3A-P3C as the first implementation sequence after BW0. Start BW1 only
  after P3C merges and the single-PR gate is clear. P3 owns common
  session/repository seams, P4 amoCRM adapters, P5 real WAHA/AI/ACK proof and P7
  restore/reliability evidence. BW1-BW7 consume rather than duplicate them.

Reversible assumptions:

- Empty employee real-flow slots use the normalized OP and common OZO v1
  lifecycles until owner evidence supersedes them.
- Country overlay updates apply to newly instantiated checklists by default;
  existing cases retain their applied version unless an authorized audited
  rebase is requested.
- Source imports enter reviewable staging and never directly publish approved
  catalog, knowledge or student-case records.

Implementation and acceptance impact:

- BW1 adds workflow/domain/source contracts without PII.
- BW2 connects OP/OZO to existing frontend screens through real
  repositories/actions, RLS, permissions and audit.
- BW3 adds Student Profile and versioned country checklist workflows.
- BW4 adds approved prompt/knowledge, decision backlog and handoff.
- BW5 adds catalog/import boundaries; real import remains blocked without
  authorized source access.
- BW6 adds draft contract generation and post-contract checklist/report with
  typed approved fields, approval and audit.
- BW7 rebases on latest main and proves the complete real local/staging
  Supabase workflow through the accepted frontend. Provider or production
  success requires separate real authorized evidence.

Validation impact:

- This PR remains docs-only and changes no TypeScript runtime, migration,
  provider, production, customer data or secret.
- Run `git diff --check`, deterministic TZ DOCX generation, canonical TZ
  verifier/render, visual inspection of every rendered page, repository
  secret/PII guardrails and exact-head GitHub CI.
- Require a separate independent SHA-bound launch-control review. Only the
  automation controller may merge.

Reviewer notes: pending independent SHA-bound review.

## 2026-08-02 - Restore Plan Freshness And Gate Local Supabase Reliability

Date: 2026-08-02, Asia/Almaty workspace timezone.

Author: Codex.

Block-ID: `EVO-P2R0-LOCAL-SUPABASE-RELIABILITY-PLAN-2026-08-02`.

Change type: checkpoint freshness, implementation order, schema-correction
boundary, local validation acceptance and reliability evidence.

Affected plan section: `/goal-evo-platform-local-reliability`, current
checkpoint, P2/P3/BW sequencing and local proof exit criteria.

Reason:

- `origin/main` now contains BW0, P3A-P3C and BW1-BW4 through PR #103 at
  `124ed41e1ba7f25d0f1affca336ce222e0a187d4`, while the top-level contract still
  described BW0/P3 as pending.
- PR #99 was dependency/security maintenance and is not a new product lane.
- Re-running the real local Supabase gate exposed bounded validation defects:
  transient Auth 502 during cold readiness, timed-out descendant processes,
  disposable-project cleanup ambiguity, normal PGMQ finish leases that were
  too short, and incompatible document finalization/review lock order.
- Those changes affect validation acceptance and add a forward schema
  correction, so launch-control requires a docs-only amendment before code.

Decision:

- Add P2R0 as a docs-only checkpoint and acceptance gate. It changes no
  runtime, migration, provider, customer data or production state.
- Add P2R1 as one bounded implementation PR after P2R0 merges. It may own only
  process-group deadlines, exact `evo-platform-local` label cleanup,
  transient-only GET readiness for local Auth, deterministic PGMQ test leases
  and the next-free forward document finalization/review lock-order correction.
- Expect migration 055 from the current checkpoint, but re-verify the number
  against fresh `origin/main` and open migration ownership before commit.
- Keep merged migration history immutable. P2R1 must not edit migration 046 or
  claim managed Supabase, malware provider, database/Storage restore,
  production apply, live provider behavior or cutover.
- Resume BW5 only after P2R1 is independently approved, controller-merged and
  exact-main CI is green. P4, P5 and P7 ownership remains unchanged.

Validation impact:

- P2R0 remains docs-only and requires `git diff --check`, deterministic TZ DOCX
  generation/verifier/render, visual inspection of every page, scoped
  secret/PII checks, independent exact-head review and GitHub CI.
- P2R1 requires the real local `npm run test:supabase:local` gate under Node
  22.23.1, zero exact-label EVO validation resources after cleanup, preserved
  Inbox containers/volumes, disposable PostgreSQL authorization tests,
  unit/security/lint/type/build/scenario/E2E/accessibility checks and scoped
  secret scanning.
- Local evidence is not managed Supabase, live-provider, backup/restore or
  production evidence.

Reviewer notes: exact-head independent review required before merge.

## 2026-08-03 - Advance The Authoritative Checkpoint To BW5

Date: 2026-08-03, Asia/Almaty workspace timezone.

Author: Codex.

Change type: checkpoint freshness, execution-order advance and
acceptance-boundary refresh.

Affected plan section: `/goal-evo-platform-bw5`, current checkpoint, BW5
acceptance and next-free migration boundary.

Reason:

- `origin/main` now includes PR #104 at
  `e492de74858a44eb4488a77525425e471f961214` and PR #105 at
  `9ef7a7264c901f9c25e35ccbf106afe00c3c91ad`, so the repository no longer sits
  at the pre-repair checkpoint recorded by the active contract.
- Exact-main CI run `30763498291` is green for the applicable Main CRM, EVO
  Inbox and EVO Lead Agent jobs.
- The long-run plan, launch summary, status snapshot and TZ still described
  P2R0 as active and P2R1 as pending, which is now stale.
- Migration `055_platform_document_finalization_lock_order.sql` is already
  merged, so BW5 must treat 056 as the expected next-free migration only after
  fresh `origin/main` and open-PR ownership verification.

Decision:

- Advance the authoritative checkpoint from
  `124ed41e1ba7f25d0f1affca336ce222e0a187d4` to
  `9ef7a7264c901f9c25e35ccbf106afe00c3c91ad`.
- Record P2R0 as merged docs-only planning evidence and P2R1 as the merged
  bounded local reliability repair. Neither reopens architecture, provider
  ownership, restore ownership or production authority.
- Make BW5 the active implementation block and preserve the accepted unified
  `/applications` frontend as its UI contract.
- BW5 owns only the next-free forward migration. The expected current target is
  056, but it must be re-verified against fresh `origin/main` and open PRs
  before commit.
- Require revision-pinned, bounded and PII-free source staging; no direct
  publication during staging/validation; explicit audited Admin
  approval/rejection; and role, tenant and student-case object-scope evidence.
- Preserve provider boundaries: BW5 does not prove or mutate amoCRM, WAHA, AI
  providers, managed Supabase, production deployment, restore or cutover. The
  real Notion source remains blocked behind authorized AbdyldaYT access, no
  confirmed college dataset exists, and fake replacement records are forbidden.

Validation impact:

- This docs-only amendment requires `git diff --check`, deterministic TZ DOCX
  generation/verifier/render, visual inspection of every page, scoped
  secret/PII checks, independent exact-head review and GitHub CI.
- BW5 must prove only its local/repository/browser acceptance. Provider or
  production claims remain blocked behind the P4/P5/P7/P8 gates.

Reviewer notes: checkpoint-only amendment; ADR changes are not required because
the target architecture and requirement set are unchanged. Exact-head
independent review is required before merge.

## 2026-08-03 - Pause BW5 For Issued-Token And Local Reset Repair

Source: independent launch-controller verdict on PR #108 exact head
`f719b749efaadaf02c6344c5d01cd4b6bbe3d79c`, comment
`5166574008`; owner standing instruction to repair reviewer findings under the
plan-first launch-control contract.

Change type: execution-order repair, validation-contract correction and
checkpoint freshness. This is not a target-architecture, product-scope,
provider-ownership, schema or production-authority change.

Affected plan section: `/goal-evo-platform-p2r2`, current checkpoint, P2/BW5
merge order, server-auth proof and disposable local Supabase validation.

Evidence:

- PR #107 merged the BW5 checkpoint amendment; current `origin/main` is
  `db8f3c75c898d5b68b0080099583d4eeea9931d2`, and exact-main CI run
  `30782828561` is green for applicable jobs.
- PR #108 contained a bounded issued-token auth/local-readiness repair and had
  green focused tests, exact-head CI and an independent reviewer approval.
- The separate controller rejected PR #108 because BW5 remained the active
  sequential block and no earlier amendment authorized a P2R/P3 repair slice.
- The controller's fresh physical-worktree run applied migrations 001-055 in
  two bounded reset attempts, reached container restart, then exited 1 with
  `Initial disposable Supabase reset failed after one bounded retry`.
- The controller also observed that a logical `/tmp` path could make the
  deadline runner's direct-execution guard silently skip its child because
  macOS resolves the module through `/private/tmp`; that no-op cannot count as
  test evidence.
- Controller cleanup proved zero exact-project containers, volumes, networks
  and lock. PR #108 was closed without merge and its branch was retained only
  as a recovery point.

Decision:

- Pause BW5 and make a docs-only P2R2 amendment the sole active block.
- After this amendment merges, allow one bounded implementation repair limited
  to server login/authority resolution, the deadline runner, the local Auth and
  reset harnesses, and their focused regression tests. P2R2 owns no migration.
- Require successful login to expose the just-issued access token and require
  the server to validate that exact token with `getClaims(accessToken)` before
  resolving the live `platform.current_actor_authority` bundle. Missing or
  invalid claims, blocked/inactive authority, or RPC failure must fail closed
  and clear the Platform session.
- Keep `getSession()` untrusted for server authorization. Self-registration,
  legacy-account import, root-auth fallback, dual-read and dual-write remain
  forbidden.
- Make deadline execution symlink-safe and require it to propagate the child's
  real exit code. A wrapper that exits zero without executing the child is a
  failed test.
- Make the normal exact-project Supabase path reproducible under Node 22.23.1:
  migrations 001-055, Auth, PostgREST/RLS, accepted-frontend browser checks,
  private Storage and PGMQ must finish with a real exit zero. Readiness waits
  stay bounded; retry is transient-only; diagnostics stay redacted.
- Cleanup must prove zero `evo-platform-local` lock/container/volume/network
  resources and preserve unrelated Inbox containers and volumes. Broad prune,
  Docker daemon restart and production/provider mutation remain forbidden.
- Require executor proof and a second fresh physical-worktree reproduction,
  focused regressions, all four exact-head CI jobs, a new SHA-bound independent
  reviewer approval and controller merge.
- Resume BW5 only after P2R2 implementation is merged and exact-main CI is
  green. BW5 must then re-fetch main/open ownership before claiming expected
  migration 056 and must obtain fresh exact-head evidence.

Validation impact:

- This amendment updates the long-run/launch contracts, current status,
  detailed P2 boundary and canonical TZ 1.7, then regenerates and visually
  verifies deterministic DOCX evidence.
- The P2R2 implementation must add regression coverage for the symlink-path
  no-op and real exit propagation, issued-token claims verification, bounded
  reset classification and exact cleanup.
- `real-provider-proof: not-required`: P2R2 proves a real disposable local
  Supabase path with synthetic identities, not managed Supabase, providers,
  production, malware scanning, backup/restore or cutover.

Reviewer notes: this amendment exists because the independent controller
rejected an out-of-order implementation and non-reproducible local PASS claim.
No implementation file may change in this docs-only PR. ADR 0014-0016 remain
valid because the architecture and provider boundaries are unchanged.

## 2026-08-04 - Add Response-Writable Stale-Session Handoff To P2R3

Source: independent launch-controller verdict on PR #110 exact head
`fd4428451793bdc59b3b183dcc9dde7518e80201`, comment `5171649961`; official
Next.js 16 cookie contract at
<https://nextjs.org/docs/app/api-reference/functions/cookies>.

Change type: file-ownership and validation correction for an already-approved
fail-closed acceptance outcome. This is not a target-architecture,
product-scope, schema, provider-ownership or production-authority change.

Affected plan section: `/goal-evo-platform-p2r3`, prerequisite server-auth
handoff, P2R2/P2R3 merge order and disposable local Supabase evidence.

Evidence:

- PR #109 merged the P2R2 plan at
  `30bcc956fbf1ac90e79c2a75c22748633e219d9d`; exact-main CI run `30824043775`
  is green.
- PR #110 verified the issued login token with `getClaims(accessToken)`, used
  live authority and repaired the deadline/reset harnesses, but its exact-head
  controller found that `requirePlatformActor()` only redirected an already
  authenticated invalid actor. The rejected Supabase auth cookie remained in
  the browser, so repeated connected-route requests retained a stale session.
- Next.js 16 allows cookie mutation only in a Server Function or Route Handler.
  The original P2R2 ownership list did not include either a response-writable
  invalid-session handoff or the guard/proxy surfaces needed to reach it.
- The controller also could not reproduce the mandatory second physical-
  worktree `npm run test:supabase:local` because its OrbStack Docker endpoint
  timed out. That is missing exit evidence, not a provider-success claim and
  not permission to restart the daemon or mutate unrelated stacks.
- PR #110 was closed without merge. Its branch remains a recovery point only;
  BW5 remains paused.

Decision:

- Make this docs-only P2R3 amendment the sole active block. After it merges,
  rebuild the P2R2 auth/reset repair from latest main and add only
  `src/lib/platform-guards.ts`, `src/proxy.ts`,
  `src/lib/supabase/auth-cookies.ts`, the new exact Route Handler
  `src/app/auth/platform-session/route.ts`, and the existing
  `tests/platform-auth/platform-auth.spec.ts` to the authorized file set.
- A protected connected route with invalid claims, blocked/inactive
  membership, stale access version or failed live authority must hand off to
  that same-origin Route Handler. The handler rechecks `getClaims()` plus live
  authority with response-writable cookie methods. A recovered valid actor is
  preserved; authority that remains invalid or unavailable is locally signed
  out and only this Platform project's auth-token cookie/chunks are expired.
  Query parameters are never authorization evidence, and legacy root-auth
  cookies remain untouched.
- Require a real disposable local Playwright regression that begins with an
  authenticated session, makes live authority revoked or version-stale,
  exercises a connected protected route and proves the Platform auth cookie is
  absent after the login redirect. Direct handler access by a still-valid actor
  must preserve the session.
- Retain all P2R2 issued-token, symlink/deadline, bounded reset, exact cleanup,
  Inbox-preservation and redaction requirements. Executor and independent
  fresh physical-worktree `npm run test:supabase:local` runs must both exit zero
  with a responsive existing Docker endpoint. Docker daemon restart, broad
  cleanup and unrelated stack mutation remain forbidden.
- P2R3 owns no migration, managed Supabase, provider, production, restore or
  cutover behavior. `real-provider-proof: not-required` remains the truthful
  boundary.
- Resume BW5 only after the rebuilt P2R3 implementation is independently
  reviewed, controller-merged and green on exact-main CI.

Validation impact:

- This amendment updates the long-run/launch contracts, append-only decision
  log, current status, detailed P2 boundary and only the version/checkpoint/
  execution-status portions of canonical TZ 1.8. FR/INT/DATA/SEC/NFR/ACC
  requirements remain unchanged. The deterministic owner-facing DOCX and its
  validation ledger must be regenerated and every rendered page inspected.
- The system/data model, `CONTEXT.md` and ADR 0014-0016 remain unchanged because
  no domain term, target architecture, schema, provider or production boundary
  changes.
- The implementation PR must include focused auth source tests, the real
  connected-route cookie-clearing Playwright regression, two fresh physical-
  worktree local Supabase proofs, exact cleanup/Inbox preservation, all four
  exact-head CI jobs and a new SHA-bound independent review.

Reviewer notes: the new Route Handler is not a new product surface or auth
fallback. It is the minimum response-writable handoff required to satisfy the
already-merged fail-closed session-clearing acceptance under Next.js 16. No
implementation file may change in this docs-only PR.

## 2026-08-04 - Add P4B Mapping Selection And Approval Contract

Source: merged PR #117 at
`121db548b252eff9e4b79f62297aa27fe39e5c40`, exact-main CI run `30958119076`,
the merged P4A discovery contract and the accepted unified frontend boundary.

Change type: file-ownership and acceptance-boundary refinement inside the
already-approved canonical amoCRM adapter lane. This is not a target-
architecture, product-scope, provider-ownership or production-authority change.

Affected plan section:
`/goal-evo-platform-p4b-amocrm-mapping-selection-approval-plan` and the next
bounded P4 implementation lane.

Evidence:

- P4A is merged history. Migration 058 stores immutable sanitized
  account-specific discovery versions, service-only ingest and live-authority
  Admin reads; its bounded server adapter is GET-only.
- P4A deliberately does not select an operational mapping. The repository has
  no reviewed approval/revocation seam or deterministic current selection for
  messaging.
- The accepted `/whatsapp` frontend already provides the truthful integration-
  health seam. A parallel admin application or generic CRM settings surface is
  neither required nor authorized.
- A local sanitized discovery version is not real-provider proof and cannot be
  treated as evidence that account mappings are correct or currently available.

Decision:

- Make this docs-only P4B amendment the sole active block. No implementation
  file or migration may change before this amendment is independently reviewed,
  controller-merged and green on exact-main CI.
- Preserve P4A discovery versions as immutable evidence. A later additive
  implementation may add only append-only `approved`/`revoked` decisions and a
  deterministic current projection; it must not rewrite history or use a
  mutable `active` flag on discovery evidence.
- Scope each current selection to organization, amoCRM account and `messaging`.
  It must reference one discovery version and explicitly select the account
  pipeline, signed-contract status, responsible-user source rule and named
  lead/contact custom-field bindings.
- Only a current same-organization Platform Admin with live, non-stale authority
  may approve, supersede or revoke. Each decision records actor, expected prior
  decision, reason, before/after, request ID and time. All other roles, anon,
  cross-organization Admin, inactive membership and Auth-admin without Platform
  authority fail closed.
- Keep the later UI adapter inside the existing `/whatsapp` product seam. No
  current approval must render as a truthful blocked/not-approved state.
- P4B does not authorize OAuth custody, provider calls, identity sync, webhook
  ownership, jobs/outbox, reconciliation, canonical amoCRM writes, a new UI,
  legacy SQLite/root-auth work or any production mutation.
- Migrations 001-058 remain immutable. The next implementation is expected to
  use migration 059 only after a fresh `origin/main` and open-ownership check.

Validation impact:

- This amendment updates the launch/long-run contracts, current-status ledger,
  stale P2 execution-status metadata, append-only decision log, the focused
  P4B contract and only the version, checkpoint and execution-status portions
  of canonical TZ 1.9. FR/INT/DATA/SEC/NFR/ACC requirements remain unchanged.
- Regenerate the deterministic owner-facing DOCX, run its structural,
  traceability, accessibility and render verifier, and inspect every rendered
  page. No render intermediates are committed.
- The later implementation must prove Admin positive and non-Admin/cross-org/
  stale-authority negative cases, immutable history, invalid-reference and
  concurrent-supersession rejection, safe no-current-selection UI, audit
  evidence, browser-secret absence and clean disposable local Supabase/RLS
  execution with exact cleanup.
- `real-provider-proof: not-required` for this docs-only amendment. Live amoCRM
  mapping correctness remains blocked until separately authorized and exercised.

Reviewer notes: `CONTEXT.md`, system/data-model docs and ADR 0014-0016 remain
unchanged because the architecture, provider ownership, domain model and
production boundary do not change. No implementation file may change in this
docs-only PR.

## 2026-08-05 - Prioritize BW8 Student Document Intelligence

Source: Product-owner request to build the complete repetitive-work reduction
flow from the supplied EVO Student Profile Form and the public 14-item China
document checklist; exact repository checkpoint
`10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b` after PR #118; current official
OpenAI Responses/file/vision/Structured Outputs/data-control documentation and
Google Drive file/export/auth/shared-drive documentation.

Change type: product-priority, domain/schema, provider-adapter, accepted-UI and
merge-order amendment. It does not authorize production, managed Supabase,
provider credentials/calls or real student data processing.

Affected plan section:
`/goal-evo-platform-bw8-student-document-intelligence-plan`, the Documents/
Student Profile portion of P6, the current migration ownership and the paused
P4B implementation lane.

Evidence:

- Merged P2G/P2H/BW3 already provide durable queue patterns, private Storage
  reservation/finalization/download grants, document slots/versions/reviews,
  versioned country requirements and a minimized student profile.
- The accepted `/documents` route is still intentionally honest legacy UI:
  statuses exist but binary files are not connected to Platform Storage.
- The repository has no persisted document-extraction run, evidence-backed
  field candidate, candidate-to-profile human confirmation or expanded typed
  form-field/export ledger. Directly writing model output to the current
  profile would be unauditable and unsafe.
- The supplied China source contains 14 requirements, including conditional
  minor documents and a video resume. Current P2H permits only PDF/JPEG/PNG up
  to 25 MiB, so video bytes cannot be implied as supported.
- The blank owner-supplied Student Profile Form covers personal/contact/
  language, repeating education, study goals, family, emergency, visa refusal,
  health, referral and signature/date fields; the existing minimized core is
  intentionally insufficient for the full form.
- P4B has an approved docs-only contract but no shared implementation PR or
  migration is open. A separate local uncommitted P4B worktree is owner work
  and is not touched or treated as shared source of truth.

Decision:

- Make BW8 the sole active docs-only block and pause P4B implementation. Keep
  P4A evidence and the P4B contract immutable. BW8A rechecks exact main and
  owns expected next-free migration 059; P4B later restarts from fresh main and
  rechecks then-next free, expected 060.
- Implement only through sequential BW8A-BW8E PRs: schema/RLS/domain; private
  intake, real scanner and durable worker; Drive/OpenAI adapters plus
  deterministic validation; accepted `/documents` workbench/live persisted
  state/profile DOCX-PDF drafts; integrated proof/completion audit.
- Store extraction as typed proposed/conflicting evidence tied to one immutable
  document version, exact source/page locator, confidence and extractor
  policy/model version. An LLM/OCR provider never writes canonical fields,
  checklist status or review decisions.
- Advance typed profile values only through current authorized human confirm,
  reject, supersede or manual-edit commands with optimistic revision,
  before/after, reason, request ID and append-only provenance. Project shared
  fields deterministically to the minimized core; use one typed store for the
  additional form fields and arrays for repeating education history.
- Reuse private Storage, upload reservation/finalization, validation/review,
  audited download and PGMQ patterns. Require real integrity/malware evidence
  before extraction; no synthetic `clean` status, direct Storage-table write,
  in-memory-only job or fake live UI state is permitted.
- Drive is exact import only, not the runtime database. OpenAI uses server-only
  strict structured output, `store: false`, bounded temporary-file expiry and
  best-effort deletion. Provider output is deterministically revalidated.
- Real student documents remain prohibited from OpenAI until Product/Legal/Data
  approves processing purpose, permitted field classes and retention posture.
  Before that decision, real-provider calls may use only authorized
  non-sensitive sources such as the public checklist and verified blank
  template; manual work remains available.
- Preserve the template unchanged, fill only copies, bind each export to exact
  profile/template revisions and store private immutable DOCX/PDF draft
  evidence. PDF conversion failure must not hide a valid DOCX or become fake
  success.
- Keep the existing `/documents` surface. Use a calm white/graphite operational
  layout, status color plus text/icon, evidence inspector, keyboard actions and
  a reconnectable persisted event stream with read-model fallback. No parallel
  app, decorative dashboard or localStorage/demo fallback is authorized.

Validation impact:

- This docs-only PR updates the launch/long-run contracts, focused BW8 plan,
  current-status and data/system/domain docs, canonical TZ 2.0, traceability,
  validation ledger and deterministic owner-facing DOCX. Every rendered page
  must be inspected. Only canonical document generation/validation tooling may
  change with those artifacts; no application/runtime implementation,
  dependency, migration, deployment or provider surface may change.
- Each later BW8 implementation PR requires exact-main migration/ownership
  recheck, focused unit/database/contract/browser/accessibility/security tests,
  clean local Supabase execution, exact cleanup, independent exact-head review,
  controller merge and exact-main CI.
- BW8E must prove a synthetic two-student flow across checklist, private intake,
  scan, extraction/conflict, human confirmation, profile and export in two
  physical worktrees. Provider, managed/staging and production claims remain
  separately labelled and gated.
- `real-provider-proof: not-required` for this docs-only amendment. It performs
  no provider call and processes no customer data.

Reviewer notes: ADR 0014-0016 remain valid because BW8 uses the same unified
frontend, greenfield Supabase boundary and canonical owners. This amendment
changes the domain/data contract and therefore updates `CONTEXT.md`, system
overview and data ownership instead of claiming they are unaffected.

## 2026-08-05 - Separate Student Profile document automation and restore P4B

Block-ID: `EVO-BW8-BOUNDARY-CORRECTION-P4B-RESTORE-2026-08-05`

Source: explicit owner correction that Student Profile document reading,
extracted-fact confirmation, profile autofill and profile-form export must be a
separate small system outside EVO Platform; current repository checkpoint
`4567ef5067c523604bee73e8730f1b54ac23487d`; reviewed revert PRs #125, #126 and
#127; exact-main CI run `30989252650` green.

Change type: product-boundary, architecture and merge-order correction. This
entry supersedes PR #119/BW8 as current implementation authority without
rewriting that historical decision. It is docs-only and authorizes no runtime
code, migration, provider call, managed Supabase action, production mutation or
customer/student-data processing.

Affected plan section:
`/goal-evo-platform-bw8-boundary-correction-p4b-restore`, the former BW8
Student Profile document-intelligence lane and the next bounded P4B
implementation lane.

Evidence:

- PR #119 is still present in immutable Git and append-only decision history.
  Its dependent implementation PRs #120, #122 and #124 were reverted in
  reverse dependency order by PRs #127, #126 and #125.
- Current main has the PR #119 tree, contiguous migrations `001-058`, no BW8
  implementation migrations and green exact-main CI.
- EVO Platform already owns an ordinary admissions document lifecycle:
  country/program checklists, case slots, private PDF/JPG/PNG objects up to
  25 MiB, versions, integrity/malware evidence, review/rework, audited access
  and separate Storage backup.
- PR #118 already merged the docs-only P4B amoCRM mapping
  selection/approval contract. Its implementation was paused only by the now
  superseded BW8 priority.

Decision:

- Student Profile document reading, extracted-fact confirmation, profile
  autofill and profile-form DOCX/PDF export belong to a separate system outside
  `evo_AI_CRM`.
- Remove BW8 as an active Platform lane and remove its dedicated extraction,
  fact, confirmed-profile and export requirements from current plan/TZ
  authority. Delete its focused active contract from the tree; Git and this
  append-only log preserve history.
- Preserve ordinary Platform Documents/Storage/checklist/version/review/audit
  capabilities and their existing requirements. This correction does not move
  or weaken those responsibilities.
- The separate system is not a Platform runtime dependency. No automatic
  import/export, shared database, shared Storage or data exchange is implied.
  Any future integration requires its own plan amendment covering explicit
  mapping, purpose and consent/privacy rules, authentication/authorization,
  failure handling, validation and acceptance.
- Restore P4B as the next implementation lane after this amendment is
  independently reviewed, controller-merged and exact-main CI is green. P4B
  must recheck fresh-main migration ownership; with current `001-058`, `059` is
  only the expected next-free number and is not reserved.
- Keep ADR 0014-0016 and add superseding boundary ADR 0017. ADR 0017 controls
  wherever PR #119/BW8 conflicts with this owner correction.

Validation impact:

- Update launch/long-run/current-status, data/system boundary docs, canonical TZ
  2.1, traceability, validation ledger, deterministic owner-facing DOCX and the
  TZ verifier counts.
- Remove requirement families `FR-111`-`FR-119`, `INT-021`-`INT-024`,
  `DATA-019`-`DATA-024`, `SEC-021`-`SEC-026`, `NFR-019`-`NFR-022` and
  `ACC-026`-`ACC-034`, while retaining all earlier ordinary-document
  requirements.
- Regenerate the DOCX deterministically, run structural, traceability,
  accessibility and render verification, and inspect every rendered page.
- Run stale-reference gates against active authority files while intentionally
  excluding this append-only history and ADR 0017's supersession explanation.
- Rollback is a docs-only forward/revert decision; no database or runtime
  rollback is required because this amendment changes neither.
- `real-provider-proof: not-required`. No real provider can prove or disprove a
  docs-only ownership correction.

Reviewer notes: this amendment is deliberately not an exact revert of PR #119.
It preserves immutable history, records why authority changed and separates the
normal Platform document lifecycle from the external automation system.

## 2026-08-05 - Gate P4B on reproducible local Supabase validation

Block-ID: `EVO-P2R4-LOCAL-VALIDATION-PREREQUISITE-2026-08-05`

Source: owner authorization to correct PR #119 and continue EVO Platform;
merged PR #128 at main `bb9d766163267846f406dcc376e893bb2a914af4`;
exact-main CI run `31012015566` green; and a fresh unchanged-main OrbStack run
of exactly `npm run test:supabase:local` using Node `22.23.1` and project-local
Supabase CLI `2.110.0`.

Change type: execution-order and local-validation prerequisite. This docs-only
entry changes neither product/TZ requirements nor schema/API/domain ownership.
It authorizes no application/frontend change, migration, credential, provider
call, managed Supabase action, customer/student-data processing, staging action
or production mutation.

Affected plan section:
`/goal-evo-platform-p2r4-local-validation-prerequisite`, before the already
merged P4B product contract.

Evidence:

- Current main is `bb9d766163267846f406dcc376e893bb2a914af4`, its migrations
  remain contiguous `001-058`, and exact-main CI run `31012015566` is green for
  Main CRM, EVO Inbox and EVO Lead Agent; Changed range is skipped on push as
  expected.
- From that unchanged main, the exact repo-scoped local gate exited `1` after
  the bounded local `supabase start` phase timed out on Docker context
  `orbstack`. Credential-bearing diagnostics were withheld.
- Normal cleanup completed: zero exact `evo-platform-local` containers,
  volumes and networks remained, no singleton lock/process remained, and the
  Inbox resource set was unchanged.
- Supabase CLI `2.110.0` supports `start --ignore-health-check`; its successful
  exit is not health proof, so the local harness must add its own bounded,
  fail-closed service readiness before continuing. Primary CLI reference:
  <https://github.com/supabase/cli/blob/develop/apps/cli/docs/go-cli-reference.md>.

Decision:

- Insert P2R4 before P4B. P4B remains the next product lane only after P2R4 is
  independently reviewed, controller-merged and re-proved on exact main.
- The later P2R4 implementation PR may edit only
  `scripts/test-supabase-local-reset.sh` and
  `tests/supabase-local-reset-harness.test.mjs`.
- Use local `supabase start --ignore-health-check` only with an immediate
  bounded fail-closed readiness proof for Database, PostgREST, Auth, Storage,
  Kong and CLI status. Unknown or repeated failures remain fatal; no general
  retry is authorized.
- Keep all mutation and cleanup exact-project/local only. Forbid `--linked`,
  `--project-ref`, `--db-url`, `stop --all`, broad prune, Docker daemon restart
  and unrelated-stack mutation.
- Preserve immutable migrations `001-058` and the official local reset path.
  Require exact repository-to-local migration list equality. This block does
  not reserve `059` and does not authorize a migration-repair ledger mutation.
- Preserve the existing exact-signature, exact-project Storage/Kong recovery;
  it must not become a generic retry path.
- Capture exact Inbox container IDs, volume names and network IDs before the
  run and require identical sets after cleanup. Require zero exact Platform
  resources and zero singleton lock/process after every exit path.
- This amendment does not restore PR #122, BW8, migration 059 ownership or any
  reverted Student Profile document-automation scope.

Validation impact:

- This amendment changes only `docs/EVO_LAUNCH_PLAN.md`,
  `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`, this append-only decision log and
  `docs/platform/current-status.md`. TZ/DOCX/validation and ADRs remain
  unchanged because product requirements and architecture do not change.
- The later implementation must pass focused positive and negative harness
  tests plus two independent clean real executions of
  `npm run test:supabase:local`: one by the executor and one by the independent
  controller. Each must exit `0`, prove migrations `001-058`,
  Auth/RLS/Storage/PGMQ and accepted browser gates, clean exact Platform state,
  and preserve exact Inbox identities.
- Both the docs-only plan PR and the later repair PR require exact-head CI,
  SHA-bound independent approval, controller merge and green exact-main CI.
- Rollback is a docs-only forward/revert decision for this amendment; the later
  implementation rollback is the two-file harness revert. No migration or
  runtime data rollback is required.
- `real-provider-proof: not-required`; the proof is disposable local validation,
  not amoCRM, WAHA, AI, managed Supabase, staging or production evidence.

## 2026-08-06 - Defer P4, remove P9 and continue amoCRM-independent scope

Block-ID: `EVO-P5-AMO-DEFERRAL-SCOPE-AMENDMENT-2026-08-06`

Source: explicit owner decision after the deferred P4B checkpoint and failed
local Auth/PostgREST gate; current repository checkpoint
`4d28b7f49d791a78dc387c6f6a16681dd3cf3df8`; exact-main CI run
`31038964366` green.

Change type: material execution-order, dependency and acceptance correction.
This entry does not cancel the canonical amoCRM target. It defers P4/P4B,
removes P9 from current execution and narrows P8/P10 so independent P5-P7 work
can continue honestly. It is docs-only and authorizes no runtime code,
migration, credential/provider action, customer-data action, staging/production
mutation or service deletion.

Affected plan section:
`/goal-evo-platform-p5-amocrm-deferral-scope-amendment`, P4-P10 ordering,
amoCRM-dependent acceptance, P9 retirement scope and P10 audit semantics.

Evidence:

- PRs #129-#130 are merged; current `origin/main` is
  `4d28b7f49d791a78dc387c6f6a16681dd3cf3df8`, migrations remain contiguous
  `001-058`, and exact-main CI `31038964366` is green.
- P4B implementation is preserved on remote branch
  `izzhackt/evo-platform-p4b-mapping-approval` at
  `e53ba94954f147b295f596421a255591fa343ce8`; the worktree/remote branch is
  clean, and no P4B implementation PR exists.
- P4B focused tests, unit tests, lint, Next typegen, TypeScript and production
  build passed. Its attempted full local Supabase gate failed closed in the
  real Auth/PostgREST hook before Playwright. That run is failed/non-evidence;
  read-only cleanup verification found zero exact Platform containers, volumes,
  networks, processes and lock.
- No live amoCRM account, WAHA receive/send/ACK, AI provider, managed Supabase,
  staging or production path is proved by this amendment.

Decision:

- Preserve P4/P4B as deferred, not cancelled. Resume only after a separate
  owner decision and fresh launch-control evidence.
- Continue in order P5 → P6 → P7 → P8 → P10. P5-P8 may implement/prove only
  capabilities that remain correct without canonical amoCRM.
- No mock, SQLite shim, hardcoded amo mapping, fake provider, inferred sales
  authority or silent fallback may replace P4. amoCRM identity resolution,
  contact/lead linkage, responsible Sales, canonical sales stage,
  contract-stage handoff, mapping approval and the amoCRM portion of E2E remain
  fail-closed and `DEFERRED`.
- Narrow P8 to real executable P5-P7 paths. Missing credentials, test identities
  or production authority remain explicit blockers, never synthetic proof.
- Remove P9 from the current execution scope. Do not perform a soak or plan a
  Lead Agent retirement/removal PR. Lead Agent, the legacy webhook/session and
  rollback path remain deployed/frozen and must not be deactivated or deleted.
- Run P10 directly after P8 as an authorized-scope audit. It must explicitly
  list P4 deferred and Lead Agent retained and must not claim that the original
  full Platform target is complete.
- Keep the standalone Student Profile document-reading/filling system outside
  `evo_AI_CRM` under ADR 0017.

Validation impact:

- This docs-only PR updates the authoritative long-run/launch plans, this
  append-only log, current status, canonical TZ 2.2, deterministic owner-facing
  DOCX, validation ledger, CONTEXT authority link and ADR 0018. It changes no
  application/runtime/schema/migration/deployment/provider surface.
- DOCX must be rebuilt deterministically from the canonical Markdown, verified
  structurally and for one-to-one traceability, rendered through
  LibreOffice/Poppler and visually inspected on every page.
- The PR requires `git diff --check`, scoped secret/PII scanning, exact-head CI,
  independent SHA-bound review and controller merge before any P5 code.
- Rollback is a docs-only revert/forward amendment. P4B branch state and
  production services are not changed.
- `real-provider-proof: not-required` for this docs-only amendment. Provider and
  production gates remain blocked/deferred until real authorized evidence.

## 2026-08-09 - Reprioritize the MVP and authorize guarded inbound AI replies

Block-ID: `EVO-MVP-AUTONOMOUS-INBOUND-PLAN-2026-08-09`

Source: written owner request to curate the MVP from the local/GitHub sources
of truth, preserve the accepted Claude Design frontend, research the viable
WAHA/amoCRM/AI approaches before implementation, and approve autonomous AI
sending under the recommended safeguards. Official WAHA, WhatsApp Business,
Gemini and Supabase documentation is summarized in
`docs/research/evo-mvp-waha-ai-memory-2026-08-09.md` and
`docs/research/evo-mvp-autonomous-send-2026-08-09.md`, with the bounded amoCRM
adapter decision supported by
`docs/research/evo-mvp-amocrm-integration-2026-08-09.md`.

Change type: material product scope, phase order, integration boundary,
AI-send authority, API/schema acceptance and rollback amendment. This entry is
append-only and supersedes conflicting draft-only/manual-send and fully
deferred-amo wording in active plans, TZ and summary documents. Historical
decisions remain in Git and earlier ADRs; ADR 0019 controls the new lane.

Checkpoint freshness:

- accepted `origin/main` is
  `8dbc99c578a9bad0750a04cb322f26a2fe68b1c0` with contiguous migrations
  `001-059` and green exact-main CI run `31310795550`;
- PR #132 merged the disabled-by-default, persist-before-process P5A WAHA
  ingress;
- PR #133 at the time of this amendment is draft. Its exact-head repository and
  local Supabase evidence was green, but the independent controller rejected
  plan freshness and the terminal handling of media-only inbound. That verdict
  is authoritative; the green run does not waive either finding;
- P4B is still preserved at branch
  `izzhackt/evo-platform-p4b-mapping-approval`, SHA
  `e53ba94954f147b295f596421a255591fa343ce8`. Its failed Auth/PostgREST gate is
  non-evidence and mapping activation/writes remain deferred.

Decision:

- The existing root frontend from PRs #64, #71 and #72 remains the sole product
  UI. Wire real repositories, auth, messaging and integrations behind it; do
  not add a second Inbox CRM UI or copy Inbox funnels/deals/campaigns.
- Reprioritize the thin MVP as: finish WAHA projection; available conversation
  history and private media; ACK/delivery and true realtime; bounded read-mostly
  amoCRM context; Platform-owned lead memory and approved pgvector retrieval;
  real Gemini qualification/replies; controlled E2E; then independent P6/P7,
  narrowed P8 and P10.
- Preserve P4B mapping activation and writes. Resume a separate P4R adapter only
  for account-specific reads of contact, lead, responsible manager, sales stage,
  tasks and call/chat-record references. It must expose explicit stale/degraded
  state, reconcile real provider identifiers and make no amoCRM mutation,
  inferred handoff, hardcoded mapping, SQLite fallback or fake-success claim.
- Gemini returns a structured RU/EN proposal only. It receives no WAHA send
  capability. Deterministic EVO server code validates semantics and owns every
  send decision.
- Autonomous send is limited to a reply inside the WhatsApp 24-hour customer
  service window after a real inbound message. Cold outbound, broadcasts,
  autonomous follow-up/re-engagement and out-of-window free-form sends remain
  prohibited.
- Before autonomous send, the server must pass organization/session binding,
  consent and opt-out, supported language, approved-knowledge/evidence,
  risk/sensitivity, confidence, business-hours, cooldown/rate, staff takeover,
  idempotency, WAHA `WORKING`, kill-switch and policy-version checks. Default
  hours are 09:00-21:00 Asia/Bishkek until organization-specific configuration
  is approved. Failure creates a durable human-review handoff.
- Human takeover or manual outbound pauses autonomy immediately and durably.
  Only authorized staff may resume it, with before/after audit.
- Supabase owns durable conversation summaries, explicit lead facts,
  qualification state, retrieval references, queue/outbox, AI proposal and
  gate evidence, takeover state, send attempts, ACK progression and audit. Do
  not create a filesystem/CLI agent per client; use a server Gemini adapter plus
  Platform state and approved retrieval.
- Valid media-only inbound must be stored, shown and kept actionable. Until an
  approved media-understanding path exists it is handed to staff; it must not
  be terminally consumed because text is absent.
- Unknown delivery is never automatically retried. Duplicate prevention uses
  persisted idempotency/outbox state, not model judgment.
- Lead Agent, legacy webhook/session and rollback path remain deployed/frozen.
  P9 remains removed; no retirement/deactivation is implied.

P5B authority added by this amendment:

- private bodyless `POST /api/internal/platform-messaging/waha/work`, invoked
  only by a private scheduler;
- `X-Evo-Worker-Request-Id` UUID, `X-Evo-Worker-Timestamp` Unix milliseconds,
  `X-Evo-Worker-Hmac-Algorithm: sha256` and lowercase HMAC-SHA256 over
  `<request-id>.<timestamp>`;
- disabled-by-default server configuration; configured organization, exact
  `evo-inbox` session, `waha:evo-inbox` account and verified inbound
  `provider_webhook_process` work only;
- service-only organization/session/provenance-bound claim/project/finish RPCs,
  exact lease, bounded retry/manual-review disposition, and no finish on an
  invalid repository result;
- `sales_authority_source='platform_intake'` is intake authorization only, not
  canonical amoCRM Sales ownership;
- raw WAHA chat/message IDs stay in private append-only bindings; public rows
  expose no phone-bearing provider IDs;
- no provider call/send, amoCRM write, production migration or legacy cutover.
  Rollback is flags off, code revert and forward-fix of additive schema; no
  destructive down migration.

Acceptance impact:

- P5 must prove available history/media, persist-before-process, private
  projection, ACK, true realtime, staff takeover and the structured
  proposal/deterministic send-or-handoff path through the accepted frontend.
- P4R must prove real read-only provider behavior using sanitized account data;
  absent credentials/mappings remain `BLOCKED`, never mocked.
- P8 may accept only the real receive/history/media → Platform → real read
  context where available → structured proposal → governed send/handoff → ACK
  and audit path. P4B writes/activation and unavailable provider portions remain
  explicitly deferred.
- P10 audits this amended scope, lists P4B deferred, Lead Agent retained and all
  provider/production blockers; it must not claim the original full Platform is
  production-complete.

Validation impact:

- This amendment changes docs, ADR and deterministic TZ/DOCX only. It performs
  no runtime/schema/provider/customer-data/staging/production mutation.
- Regenerate and structurally verify the DOCX, render and inspect every page,
  run traceability/accessibility checks, `git diff --check`, scoped secret/PII
  scans, exact-head CI and an independent SHA-bound launch-control review.
- After controller merge and green exact-main CI, rebase PR #133, fix media-only
  handling, rerun the complete local Supabase/browser/security gates and obtain
  fresh exact-head evidence before it can become ready.
- `real-provider-proof: not-required` for this docs-only amendment. Real WAHA,
  amoCRM and Gemini acceptance remains blocked until credentials, sanitized
  identities and explicit test/send/production authority exist.

## 2026-08-09 - Replace the scheduled merge controller with direct exact-head merges

Block-ID: `EVO-DIRECT-MERGE-GOVERNANCE-2026-08-09`

Source: explicit written owner instruction to stop using the scheduled EVO
Platform Launch Auditor and independent merge-controller because their hourly
wait materially delays the MVP. The owner instructed the executor to continue
directly while retaining the recommended safety checks that do not depend on
the removed automation.

Change type: execution-governance and merge-order amendment only. Product
scope, architecture, API/schema acceptance, provider evidence requirements and
production authority do not change.

Checkpoint freshness:

- PR #133 merged at final head
  `14de773dbfd601f0ad394743e95fc829be470b71` as current `origin/main`
  `18e0e0855fda31cba1fa837d81b3a75cedd585e9`;
- migrations are contiguous `001-060`;
- exact-main push CI run `31323907123` is green for Main CRM, EVO Inbox and EVO
  Lead Agent; Changed range is skipped on the push event as expected;
- P5A/P5B remain disabled by default and do not prove live WAHA, managed
  Supabase, customer delivery or production readiness.

Decision:

- Remove the scheduled Launch Auditor and separate independent merge-controller
  from the active EVO Platform workflow. Do not wait for or recreate their
  hourly merge cycle.
- Keep exactly one fresh independent read-only review for every final PR head.
  The reviewer must bind its verdict to the exact head SHA and check plan
  freshness, correctness, validation evidence and provider boundaries.
- Keep all required exact-head CI jobs. A changed head invalidates both the
  review and prior exact-head CI; rerun both before merge.
- After the independent exact-head approval and required exact-head CI are
  green, the executor may merge that same SHA directly with a head-matching
  merge command. This owner authorization replaces only the former separation
  between executor and merge-controller; it does not waive review or tests.
- Require green exact-main push CI before opening the next implementation PR.
  Keep only one implementation PR open at a time.
- Do not use the full Codex Security workflow in this run. Continue focused
  Auth/RLS/security tests, changed-scope negative tests, scoped secret/PII
  scans, dependency audits and independent review for security-relevant
  boundaries.
- Historical controller/Launch Auditor records remain immutable evidence of
  how earlier PRs merged; this amendment changes only the active workflow.
- No production deployment/migration, DNS change, WAHA QR/session mutation,
  live customer send, real amoCRM write, autonomous runtime enablement or
  service deletion is authorized.

Validation impact:

- This amendment changes only the four active planning/status documents. It
  changes no application code, schema, migration, CI workflow, provider,
  customer data, staging or production state.
- Run `git diff --check` plus scoped secret/PII text scans. The PR still requires
  fresh independent exact-head review and required exact-head CI before the
  executor may direct-merge its exact SHA.
- After merge, exact-main push CI must pass before P5C or any later
  implementation PR proceeds.
- Rollback is a docs-only revert or forward amendment restoring the prior merge
  governance. Product/runtime rollback paths are unchanged.
- `real-provider-proof: not-required` for this docs-only governance amendment.

## 2026-08-10 - P5C available WAHA history reconciliation

Date: 2026-08-10, Asia/Bishkek.

Author: EVO Platform owner/executor.

Block-ID: `EVO-P5C-WAHA-HISTORY-2026-08-10`.

Change type: bounded P5 implementation, private API/schema acceptance,
provider-evidence boundary and rollback record.

Affected plan sections: P5 unified communications, accepted `/whatsapp`
frontend repository, local Supabase validation, release evidence and rollback.

Reason:

- P5A and P5B durably receive and project newly verified inbound webhook work,
  but the accepted operator UI still lacks history already present in the
  configured WAHA store.
- The owner requires available WhatsApp history before private media, ACK,
  Realtime and autonomous replies. “Available” must not be misreported as
  lifetime history or real-provider proof.
- The history lane needs a resumable service-only cursor and private provider
  identifiers; browser polling or raw provider IDs are not a safe import seam.

Decision:

- Add a disabled-by-default, HMAC-authenticated server reconciliation trigger
  for the exact `evo-inbox` session and an explicitly configured organization,
  private WAHA origin and authorized Platform Sales intake membership.
- Perform read-only provider preflight and paginated `GET` chat/message reads
  with `downloadMedia=false`. Require WAHA `WORKING`; require supported engine
  metadata and an explicitly enabled NOWEB store. Do not send, mark read,
  reconfigure, restart, log out or mutate a WAHA session/webhook.
- Reconcile direct chats only. Import inbound and historical outbound messages
  into the existing Supabase conversation/message model used by the accepted
  root frontend. Preserve existing assignment; intake membership is not
  canonical amoCRM ownership.
- Keep raw chat/message identifiers, provider payload provenance, replay
  receipts, page effects and run cursor/lifecycle evidence private and
  service-only. Public rows expose opaque Platform identifiers and null
  provider/amoCRM IDs.
- Advance the cursor atomically only with a successful page projection. A
  provider or repository failure leaves the last committed cursor resumable;
  bounded unfinished work records `paused`, exhaustion records `completed`.
- Represent media-only history as an operator-visible marker without claiming
  or downloading bytes. Private media download/storage/access is the next P5
  block and remains unproved here.
- Synthetic disposable Supabase/WAHA adapter and browser tests are Platform
  contract evidence only. Real WAHA completeness/provider behavior stays
  `blocked` until a separately authorized controlled provider run.
- No production deployment/migration, WAHA session/QR/webhook mutation, live
  customer send, real amoCRM write, Gemini execution, SQLite fallback, Lead
  Agent change or service deletion is authorized.

Validation impact:

- Require focused P5A/P5B/P5C unit and negative tests, disposable PostgreSQL
  authorization/RLS execution, local Supabase/Auth/Storage/PGMQ and browser
  coverage where local infrastructure is healthy, root and Inbox lint/type/
  build/tests, migration-history verification, dependency audit, scoped secret
  scan and `git diff --check`.
- If the local OrbStack disposable-container path is wedged, do not broad-clean
  or disturb Inbox state. The exact-head Linux CI PostgreSQL gate must still
  execute migration 061 and its real-role RLS test before merge.
- One fresh independent read-only reviewer must approve the exact final head;
  every changed head invalidates prior review and exact-head CI.
- Rollback keeps P5C disabled, reverts route/worker code and forward-fixes the
  additive schema. Do not use a destructive down migration. Lead Agent and the
  legacy rollback path remain frozen and available.

## 2026-08-10 - P5D private WAHA media archival and authorized display

Date: 2026-08-10, Asia/Bishkek.

Author: EVO Platform owner/executor.

Block-ID: `EVO-P5D-PRIVATE-WAHA-MEDIA-2026-08-10`.

Change type: bounded P5 implementation, private Storage/security contract,
accepted-frontend integration and rollback record.

Affected plan sections: P5 unified communications, accepted `/whatsapp`
frontend repository, private Storage, local Supabase validation and release
evidence.

Reason:

- P5B and P5C now make verified inbound and available-history messages visible
  in the accepted frontend, but media remains only an honest marker. WAHA media
  bytes and provider URLs are not archived or safe for browser access.
- Current WAHA documentation requires the private API key to download media.
  Passing provider URLs or the key to the browser would cross the reviewed
  trust boundary and can expose phone-bearing identifiers.
- Media Storage/access and ACK/Realtime touch different security boundaries.
  P5D therefore owns only private media; the next P5 block owns ACK/session
  projection plus private Realtime and reconnect catch-up.

Decision:

- Add a disabled-by-default, service-authenticated media archive worker for the
  exact `evo-inbox` session. It may process only messages already bound by P5B
  or P5C private evidence; it may not discover or create an unrelated CRM
  identity.
- Re-fetch the exact WAHA message with `downloadMedia=true`, validate the
  returned session/chat/message identity, require a configured private WAHA
  origin and reject redirects. Enforce bounded timeout and byte size before
  Storage upload.
- Provision a fixed private `platform-whatsapp-media` bucket through Supabase
  configuration/Storage API. Upload bytes only through the Storage API; never
  write `storage.buckets` or `storage.objects` from application SQL.
- Store only safe media metadata in the exposed Platform read model. Raw WAHA
  identifiers, source URLs and provider evidence remain private and
  service-only. The opaque Storage object name contains no phone, chat,
  provider, contact or student identifier and may appear only inside the
  audited short-lived signed download URL, never in RPC rows or page content.
- Authorize access through the existing live Platform actor/record-scope rules,
  append an audit record, consume a one-time service signing grant and redirect
  to a signed URL valid for at most 60 seconds. Browser principals cannot list,
  select, sign, update or delete media objects directly.
- Render archived images/audio/video and bounded file downloads inside the
  accepted Claude Design conversation view without replacing its design
  language. Unsafe/unknown inline types remain download-only; unavailable,
  oversize or failed media stays explicit and actionable.
- Preserve idempotency by message/ordinal/provider-locator evidence. Replays do
  not duplicate exposed media, private bindings, Storage objects or audit
  effects. A provider/Storage conflict fails closed.
- Media-only input remains human-review only. No Gemini interpretation,
  autonomous reply, provider send/read marker, ACK/session mutation, amoCRM
  write, production migration, Lead Agent change or service deletion is
  authorized.

Validation impact:

- Require focused configuration, HMAC, SSRF/redirect, identity, MIME/size,
  replay and Storage-failure tests; disposable PostgreSQL RLS/grant/tenant
  denial; real local Supabase Storage API and accepted `/whatsapp` browser
  evidence; lint/type/build; dependency audit; scoped secret scan; and
  `git diff --check`.
- Synthetic local WAHA responses prove only the adapter and authorization
  contract. `real-provider-proof` remains `blocked` until a separately
  authorized private provider run with sanitized media.
- One fresh independent read-only exact-head review plus green exact-head CI is
  required. The executor may then merge that exact SHA directly and must
  verify exact-main push CI; no scheduled auditor or merge-controller is used.
- Rollback keeps P5D disabled, reverts server/UI code and forward-fixes the
  additive schema. It does not delete objects, apply a destructive down
  migration, mutate production or retire the retained legacy path.

## 2026-08-10 - MVP contract sync after owner-approved autonomous-send decision

Date: 2026-08-10, Asia/Bishkek.

Author: EVO Platform owner/executor.

Block-ID: `EVO-MVP-CONTRACT-SYNC-2026-08-10`.

Change type: docs-only authority sync for merge protocol, MVP send policy and
next-block order.

Affected plan sections: `docs/EVO_LAUNCH_PLAN.md` status/current-slice rules,
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md` execution checkpoint/merge protocol, and
the active MVP sequence.

Reason:

- The accepted source of truth moved forward after PR #138 merged P5D private
  media on `origin/main` `0032a99439bdd1cafdbefa99301fab67a7fc8aeb` with green
  exact-main CI run `31369896660`.
- The owner explicitly removed the scheduled Launch Auditor / controller-only
  merge requirement for the active MVP lane and authorized direct progress with
  one independent exact-head review plus exact-head CI.
- The owner also changed the AI decision from global draft-only/manual-send to
  autonomous sending constrained by the research-backed recommendation set.
- The active authority docs still contained stale statements about
  controller-only merges, globally draft-only AI, and the next P5 slice.

Decision:

- For the currently active owner-authorized MVP lane, the merge protocol is now:
  one fresh independent read-only exact-head review, green exact-head GitHub
  CI, a final refresh/recheck that `origin/main`, the PR base and the reviewed
  head SHA still match the evidence, direct merge only of that reviewed head
  SHA, then exact-main push-CI verification before the next block starts.
- Older references to scheduled Launch Auditor / merge-controller workflow are
  retained only as historical traceability unless restated inside an active
  slice.
- The current accepted checkpoint is `origin/main`
  `0032a99439bdd1cafdbefa99301fab67a7fc8aeb` with contiguous migrations
  `001-062`; PR #138 is part of the merged baseline.
- The next bounded P5 slice is ACK/session projection plus private realtime
  with reconnectable read-model fallback. It follows merged P5A/P5B/P5C/P5D
  and still carries no real-provider proof.
- Autonomous sending is authorized only in the constrained MVP form established
  by the 2026-08-09 research notes:
  - reply-only autonomy, not general outbound autonomy;
  - only inside the WhatsApp 24-hour service window;
  - Gemini returns structured proposals/decisions and never talks to WAHA
    directly;
  - deterministic server policy owns consent, opt-out, evidence, language,
    confidence/risk, business-hours, cooldown/rate, takeover, session-health,
    idempotency, policy-version and kill-switch checks;
  - anything outside those gates becomes durable human-review/manual-send
    handoff.
- Cold outreach, autonomous re-engagement, broadcasts, out-of-window free-form
  sends, and model-direct transport remain out of scope.

Primary-source basis:

- Supabase Realtime currently recommends Broadcast over Postgres Changes for
  scalability and security, using private-channel authorization plus
  `realtime.broadcast_changes()` triggers:
  https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- WAHA documents `POST /api/sendText`, reply anchoring via the same send guide,
  and session-health gating around `session.status` / `WORKING`:
  https://waha.devlike.pro/docs/how-to/send-messages/
  https://waha.devlike.pro/docs/how-to/sessions/
- Gemini structured outputs support JSON-schema-constrained responses, and the
  current stable model guide lists `gemini-3.6-flash` as a stable production
  target:
  https://ai.google.dev/gemini-api/docs/structured-output
  https://ai.google.dev/gemini-api/docs/models
- amoCRM documents OAuth 2.0 as the authorization model for integrations:
  https://www.amocrm.ru/developers/content/oauth/oauth

Validation impact:

- This amendment is docs-only. It changes no application/runtime code, schema,
  migration, credential, provider surface, customer data, staging or production
  state.
- Each following implementation PR still requires exact-main refresh, focused
  local validation, one independent exact-head read-only review, and green
  exact-head CI before direct merge.
- Real provider sends, WAHA QR/session mutation, amoCRM writes, auto-reply
  enablement in production, and any deployment mutation remain separately gated
  by explicit owner authority.

## 2026-08-10 - P5E WAHA ACK/session projection and private Realtime

Date: 2026-08-10, Asia/Bishkek.

Author: EVO Platform owner/executor.

Block-ID: `EVO-P5E-WAHA-ACK-SESSION-REALTIME-2026-08-10`.

Source: PR #138 merged P5D at canonical `origin/main`
`0032a99439bdd1cafdbefa99301fab67a7fc8aeb`; exact-main CI run `31369896660`
passed Main CRM, EVO Inbox and EVO Lead Agent while Changed range was skipped
on the push event as expected. This docs entry is ported into PR #140 so PR
#140 supersedes the separate docs-only P5E authority PR and remains the single
canonical MVP contract sync before the implementation head merges.

Change type: bounded P5 implementation and evidence amendment. It does not
change phase order, the accepted Claude Design UI, the ADR 0019 autonomous-send
authority, the deferred P4B write/cutover boundary or any
production/provider authorization.

Decision:

- Extend the existing disabled-by-default HMAC WAHA work processor so one
  tenant/session-scoped lane can project verified `message`, `message.any`,
  `message.ack` and `session.status` observations. Existing P5B message
  projection semantics remain unchanged.
- Require exact ACK provenance, private message binding and the documented
  integer/name pairs `ERROR/-1`, `PENDING/0`, `SERVER/1`, `DEVICE/2`,
  `READ/3` and `PLAYED/4`. Persist immutable private evidence; expose only safe
  ACK state and observation time. Missing bindings retry safely; malformed,
  cross-tenant, wrong-session, inbound-target or mismatched pairs fail closed.
- Maintain a bounded current state for the exact `evo-inbox` session while
  keeping raw provider payloads and `data` private. Observe only; never start,
  restart, log out, pair, mark read or reconfigure WAHA.
- Preserve idempotency and append-only evidence. A replay cannot duplicate an
  effect and an older observation cannot regress current delivery/session
  state.
- Emit record-free private Database Broadcast invalidations on
  `platform-messaging:<organization UUID>` for accepted conversation, message,
  media and session changes. Realtime RLS allows authenticated receive access
  only for the exact live organization and `communication.read.full`; no
  browser insert/send policy exists.
- Replace the seven-second Platform `/whatsapp` refresh loop with an
  authenticated private channel. Subscribe, reconnect, visibility restore and
  each invalidation trigger a bounded `router.refresh()` through the existing
  server RPC/RLS truth path. Broadcast data is never merged directly into UI
  state.
- Show truthful ACK and session health inside the existing frontend and keep
  raw WAHA/chat/message/contact/student identifiers out of Realtime payloads,
  RPC rows and page content. Unknown session values must render
  unhealthy/unknown, never healthy.
- This block does not shorten or restate the autonomous-send checklist. The
  complete deterministic gate set in ADR 0019 and
  `EVO-MVP-AUTONOMOUS-INBOUND-PLAN-2026-08-09` remains authoritative for the
  later AI/send lane.

Validation impact:

- Require focused worker/repository tests, exact ACK/session parser and replay
  denial, disposable PostgreSQL RLS/grant/tenant/topic tests, no raw-ID
  exposure, private receive-only Realtime authorization and accepted-browser
  update-without-reload plus reconnect catch-up proof.
- Rerun full local Supabase/Auth/Storage/PGMQ/browser coverage under the repo
  singleton protocol, then lint/type/build, dependency audit, scoped secret
  scan and `git diff --check`.
- Synthetic local WAHA and Broadcast evidence prove only adapter,
  authorization and UI integration. Real-provider proof remains `blocked`.
- Rollback keeps P5E disabled, reverts worker/UI code and forward-fixes the
  additive schema. It does not apply destructive down migration, mutate WAHA
  session state, delete historical evidence or retire the frozen Lead Agent /
  legacy rollback path.

## 2026-08-10 - P4R1 bounded live canonical amoCRM context

Date: 2026-08-10, Asia/Bishkek.

Author: EVO Platform owner/executor.

Block-ID: `EVO-P4R1-AMOCRM-CANONICAL-CONTEXT-2026-08-10`.

Change type: bounded P4R implementation, server-only provider adapter,
accepted-frontend integration and rollback record.

Affected plan sections: bounded read-mostly amoCRM adapter, accepted
`/whatsapp` frontend, provider truth/failure states, P4B deferral and validation.

Checkpoint:

- PR #141 merged P5E as
  `88169c55935f0b66d0b58e844a5e6c4cac2cc285`;
- exact-main push CI run `31390559256` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped as expected for a push;
- migrations are contiguous `001-063`;
- P4B remains preserved at
  `izzhackt/evo-platform-p4b-mapping-approval` /
  `e53ba94954f147b295f596421a255591fa343ce8` and is not resumed by this block.

Reason:

- the accepted `/whatsapp` thread already carries provider-issued amoCRM
  account/contact/lead IDs, but does not yet show the canonical contact, lead,
  responsible manager or sales stage owned by amoCRM;
- ADR 0019 now permits bounded account-specific reads after the P5 messaging
  foundation, while still prohibiting amoCRM writes, inferred mapping,
  hardcoded IDs, SQLite fallback and fake provider success;
- P4B owns approval/revocation of a current messaging mapping. A live by-ID
  context read does not need and must not recreate that approval workflow.

Decision:

- Add a disabled-by-default server-only client that accepts one validated
  amoCRM/Kommo account origin and a secret read credential from runtime
  configuration. No secret or raw provider response may cross into the browser
  or repository.
- Read only the exact account, contact, lead, pipeline/status and responsible
  user identified by the already-authorized conversation. Validate the account
  and every cross-entity relationship before returning sanitized context.
- Do not use the legacy SQLite amoCRM settings/adapter. Do not use the latest
  P4A discovery snapshot as an implicit approved mapping. Do not create a P4B
  current-selection pointer or approval event.
- Present canonical names and observation time in the existing Claude Design
  conversation context. Missing bindings/configuration, 401/402/403/404/429,
  timeout, malformed provider data, relationship conflicts and the
  administrator-only Users endpoint all become explicit disabled, blocked,
  degraded or stale states.
- Add one forward-only migration for append-only read-attempt observations and
  a minimal current projection. Service-only write RPCs validate the exact
  organization/conversation/account/contact/lead bindings; a staff GET RPC
  repeats live authority plus conversation visibility and returns only the
  safe context. Browser table writes and direct private-table access remain
  denied.
- Every successful observation records the adapter-contract version, exact
  provider relationships, capabilities actually exercised and provider-read
  time. A failed refresh records a bounded failure code; it may retain a prior
  value only as explicit `stale`. This is durable read evidence, not P4B
  semantic mapping approval, handoff authority, AI context or live provider
  proof.
- A bounded process-local single-flight guard may coalesce duplicate
  Realtime-driven refreshes, but Supabase remains the durable state.
- This first slice adds no provider write, task/call/chat read, webhook/poll
  reconciler, autonomous-send input, production configuration or provider
  exercise. Those remain separate reviewed blocks/gates.

Official provider basis:

- OAuth/private integration and token behavior:
  <https://developers.kommo.com/docs/kommo-for-developers> and
  <https://developers.kommo.com/docs/oauth-20>;
- contact and lead by ID:
  <https://developers.kommo.com/reference/get-contact> and
  <https://developers.kommo.com/reference/getting-a-lead-by-its-id>;
- pipeline/stage and responsible user:
  <https://developers.kommo.com/reference/get-pipeline-by-id>,
  <https://developers.kommo.com/reference/get-stage> and
  <https://developers.kommo.com/reference/get-user-by-id>;
- rate/error limits:
  <https://developers.kommo.com/docs/http-codes> and
  <https://developers.kommo.com/docs/limitations>.

Validation impact:

- Require focused config/parser/client/repository tests for exact endpoints,
  redirects, response bounds, timeouts, 429 metadata, account/link/stage/user
  mismatches, freshness/staleness and secret-free errors.
- Require disposable PostgreSQL authorization tests for append-only evidence,
  idempotent/conflicting replay, service-only writes, tenant isolation, current
  authority, conversation scope and safe response columns.
- Require tests that the accepted thread renders the truthful context states,
  no client component imports the server credential module, and no provider or
  customer identifier is added to logs or Realtime payloads.
- Run root unit/security-node, lint, Next type generation, TypeScript, build,
  dependency audits, scoped secret scan and `git diff --check`; then exact-head
  CI and one immediate independent read-only exact-head review.
- Synthetic fetch responses prove only the adapter/UI contract. Real-provider
  proof is `blocked` until a valid credential and sanitized provider entities
  are separately supplied and authorized.

Rollback:

- keep the feature flag off or revert the server/UI files and forward-fix the
  additive migration;
- do not apply a destructive database down migration;
- P4B stays preserved/deferred, and Lead Agent plus the legacy webhook/session
  rollback path stay frozen and available.

## 2026-08-10 - P5F AI memory and bounded autonomous reply lane

Date: 2026-08-10, Asia/Bishkek.

Author: EVO Platform owner/executor.

Block-ID: `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10`.

Change type: docs-only authority amendment for the post-P4R1 AI-memory and
bounded autonomous-reply lane.

Affected plan sections: `docs/EVO_LAUNCH_PLAN.md` current baseline, next block
order and P5F authority; `docs/EVO_PLATFORM_LONG_RUN_PLAN.md` P5 decomposition
and autonomous-reply implementation order; new
`docs/platform/p5f-ai-memory-reply-lane.md` focused implementation contract;
`docs/platform/current-status.md` current accepted base and next safe gate.

Checkpoint:

- PR #142 merged P4R1 at `origin/main`
  `8cf46a94b79e8bc24ad49b30606753a690ea5469`;
- exact-main CI run `31402664864` is green for Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range is skipped on the push event as expected;
- migrations are contiguous `001-064`;
- P4B remains preserved at
  `izzhackt/evo-platform-p4b-mapping-approval` /
  `e53ba94954f147b295f596421a255591fa343ce8`;
- Lead Agent, the legacy webhook/session path and rollback path remain
  deployed/frozen; P9 remains removed.

Reason:

- The merged messaging foundation now covers ingress, projection, available
  history, private media, ACK/session state and private Realtime. The next thin
  vertical slice is Platform-owned AI memory and bounded autonomous reply,
  not broad Inbox parity or deferred amoCRM writes.
- The owner explicitly authorized autonomous reply code, but the repository
  still needs a small, falsifiable authority split before implementation so
  memory, model proposal and send authority do not collapse into one oversized
  PR.
- The accepted frontend contract, P4B deferral, real-provider honesty and
  frozen Lead Agent/rollback boundaries must remain explicit before any AI
  block starts.

Decision:

- The next required block after merged P4R1 is docs-only
  `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10`.
- P5F SHALL be implemented in three independently reviewed slices:
  - `P5F1` — Platform-owned durable conversation-scoped memory, approved-
    knowledge chunks, retrieval audit, RLS and pgvector foundation;
  - `P5F2` — stateless Gemini structured RU/EN qualification/reply proposal
    adapter;
  - `P5F3` — deterministic policy-only durable `reply_to` send intents and
    worker.
- Supabase SHALL own durable memory, retrieval evidence, send-intent evidence,
  ACK/session linkage, pause/resume state and audit. Per-client filesystem
  agents SHALL NOT be introduced, and Gemini server-side state/cache SHALL NOT
  be a source of truth.
- `P5F1` SHALL add additive migration `065` only for staff-controlled memory,
  approved-knowledge chunks, retrieval audit, RLS and pgvector. The embedding
  target SHALL be `gemini-embedding-2` at a fixed `1536` dimensions. Provider
  ingestion remains disabled by default and real provider proof remains
  blocked. Any lexical-only retrieval preview SHALL be explicit degraded staff
  preview only and SHALL NOT authorize autonomous replies.
- `P5F2` SHALL use stateless Gemini Interactions with storage disabled
  (`store=false`) and a runtime-configured allowlist. The P5F-specific initial
  sanctioned model is the owner-named `gemini-3.5-flash`. Google's current
  catalog also lists `gemini-3.6-flash` as stable, but the older generic target
  note does not authorize it for P5F without a separate eval and plan update.
  The adapter SHALL use bounded context/token budgets and JSON-schema
  structured RU/EN proposals. Gemini SHALL NOT call WAHA, SHALL NOT own retries
  and SHALL NOT imply send success.
- `P5F3` SHALL make deterministic Platform policy the only authority that can
  create a durable WAHA `reply_to` send intent. It SHALL re-check mutable
  conditions immediately before transport. The allowed send shape remains the
  same conversation and exact inbound trigger, `<=24h` service window,
  consent/opt-out pass, approved citations/evidence, known language,
  confidence/risk pass, business-hours pass, cooldown/rate pass,
  takeover/pause clear, session-health pass, unused idempotency key, matching
  policy version, explicit autonomous-reply runtime enablement and an emergency
  stop/kill switch that is not engaged. Media-only, unsupported or ambiguous
  input SHALL fail closed to human review.
- No mock provider success, fake embeddings/retrieval, SQLite fallback,
  hardcoded amoCRM mapping or silent degraded fallback may substitute for
  missing proof or configuration.
- P6, P7, narrowed P8 and P10 continue only after the P5F implementation
  slices are accepted.

Primary-source basis:

- Gemini Interactions:
  https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini model catalog:
  https://ai.google.dev/gemini-api/docs/models
- Gemini structured output:
  https://ai.google.dev/gemini-api/docs/structured-output
- Gemini function calling:
  https://ai.google.dev/gemini-api/docs/function-calling
- Gemini embeddings:
  https://ai.google.dev/gemini-api/docs/embeddings
- Gemini Embedding 2 model contract:
  https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2
- Gemini caching:
  https://ai.google.dev/gemini-api/docs/caching
- Gemini tokens:
  https://ai.google.dev/gemini-api/docs/tokens
- Gemini generate-content quickstart:
  https://ai.google.dev/gemini-api/docs/generate-content/get-started
- Supabase semantic search:
  https://supabase.com/docs/guides/ai/semantic-search
- Supabase hybrid search:
  https://supabase.com/docs/guides/ai/hybrid-search
- Supabase RAG with permissions:
  https://supabase.com/docs/guides/ai/rag-with-permissions
- Supabase pgvector:
  https://supabase.com/docs/guides/database/extensions/pgvector
- Supabase RLS:
  https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Queues:
  https://supabase.com/docs/guides/queues
- Supabase Realtime:
  https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- WAHA receive messages:
  https://waha.devlike.pro/docs/how-to/receive-messages/
- WAHA events:
  https://waha.devlike.pro/docs/how-to/events/
- WAHA send messages:
  https://waha.devlike.pro/docs/how-to/send-messages/
- WAHA session health:
  https://waha.devlike.pro/docs/how-to/sessions/
- WAHA blocking avoidance:
  https://waha.devlike.pro/docs/overview/how-to-avoid-blocking/
- Meta WhatsApp customer service window:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages

Validation impact:

- This amendment is docs-only. It changes no product code, migration,
  configuration, credential, provider surface, customer data, staging or
  production state.
- Each P5F implementation slice still requires focused local validation, one
  fresh independent exact-head read-only review, green exact-head CI and exact-
  main CI before the next slice starts.
- Real provider execution, live customer sends, production enablement, WAHA
  session mutation and amoCRM writes remain separate blocked events that
  require explicit later authority.

Non-goals and blocked proof:

- no cold outbound, campaign/broadcast, autonomous follow-up/re-engagement,
  out-of-window free-form send or model-direct transport;
- no broad Inbox CRM/funnel/automation surfaces;
- no P4B activation/writes, amoCRM task/call/chat writes or canonical handoff;
- no production enablement or live customer send proof in this amendment;
- no claim that lexical-only retrieval preview is equivalent to approved
  pgvector retrieval or sufficient for autonomous send.

Rollback note:

- This amendment changes authority only. If a later P5F implementation slice
  proves wrong, rollback SHALL keep runtime flags off, revert code and
  forward-fix additive schema. Lead Agent and the legacy rollback path remain
  frozen and available throughout the lane.

## 2026-08-11 - Implement the stateless P5F2 Gemini proposal adapter

Block-ID: `EVO-P5F2-GEMINI-PROPOSALS-2026-08-11`

Accepted predecessor:

- P5F1 merged in PR #144 at canonical main
  `a930bfa1a3e3ad736cfa688201d157b3082cd80a`;
- exact-main push CI run `31427264318` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped as expected for a push;
- P5F2 research is recorded in
  `docs/research/evo-p5f2-gemini-interactions-2026-08-11.md`.

Reason:

- P5F1 now gives EVO durable conversation memory, approved-knowledge chunks,
  retrieval evidence and a pgvector foundation, while keeping provider
  execution and autonomy disabled;
- P4R1 gives a bounded safe amoCRM read projection;
- the next authorized slice is only the stateless Gemini structured proposal
  adapter. It must not become memory, policy, transport or send authority.

Decision:

- Add a disabled-by-default server-only adapter for the sanctioned
  `gemini-3.5-flash` model through the official `@google/genai` Interactions
  API. Every request SHALL set `store=false`, disable tools, omit background
  execution and previous-interaction state, apply bounded context/output/time
  budgets and disable SDK transport retries.
- The model allowlist SHALL contain only `gemini-3.5-flash` in this block.
  Google's newer `gemini-3.6-flash` guidance is research evidence, not current
  EVO authority.
- Add a fixed JSON-schema proposal contract carrying RU/EN language, intent,
  confidence, risk, handoff requirements, approved-knowledge citations,
  proposed memory/qualification changes and reply text. EVO SHALL parse and
  validate the result again after the provider returns it.
- Add one private append-only request/result audit and service-only begin/finish
  RPCs. The begin RPC SHALL bind the exact organization, open conversation and
  source message, prove that it is both the latest conversation message and
  inbound, and build bounded context from Platform
  messages, P5F1 memory/retrieval evidence and the safe P4R1 projection. Raw
  WAHA/phone-bearing identifiers, raw amoCRM identifiers and provider secrets
  SHALL never enter the public response.
- Add one authenticated staff read RPC and a read-only review surface inside
  the accepted Claude Design `/whatsapp` conversation context. Provider
  interaction references, private prompts, private chunk text, hashes and raw
  context remain private.
- The execution seam SHALL be an exact HMAC-authenticated internal route. It
  returns only a bounded receipt, never a provider response or a send result.
  Missing configuration, timeout, provider error, malformed output, unsupported
  language, missing evidence or unsafe semantics SHALL finish as durable human
  review.
- P5F2 SHALL NOT consume the mixed legacy `platform_work_v1` queue. That queue
  contains webhook, AI-draft and manual-send work and its generic claim RPC is
  not kind-filtered. P5F3 will own the separately reviewed durable autonomous
  trigger/intent worker.
- Existing legacy `/api/ai/draft`, Lead Agent, manual-send workflow and rollback
  path remain frozen. P5F2 performs no WAHA call, send, retry, ACK mutation,
  amoCRM write, memory write or autonomous policy decision.

Validation impact:

- Require focused config, request-shape, schema/parser, timeout/error mapping,
  prompt-bound and secret-free adapter tests using a clearly synthetic local
  transport seam. These tests are contract evidence, not real-provider proof.
- Require disposable PostgreSQL/RLS tests for exact source binding,
  append-only/idempotent audit, service-only mutation, tenant isolation, safe
  staff projection and denial of raw/private fields.
- Require focused UI/repository tests, lint, type generation, typecheck, build,
  dependency/secret audits, one fresh independent exact-head read-only review,
  all four exact-head CI jobs, direct merge at that exact SHA and green
  exact-main push CI.

Blocked proof and rollback:

- Real Gemini execution remains blocked until sanctioned credentials and
  approved non-customer test data are explicitly made available. A loopback
  fixture or injected SDK response must never be reported as provider proof.
- Production enablement, provider credential injection, live customer data,
  WAHA sends, autonomous intents and provider/model upgrades remain outside
  this block.
- Rollback keeps all P5F2 runtime flags off, reverts application code and
  forward-fixes additive migration `066` only. P5F1 data and the frozen legacy
  paths remain intact.

## 2026-08-11 - Implement deterministic P5F3 autonomous inbound replies

Block-ID: `EVO-P5F3-AUTONOMOUS-INBOUND-REPLIES-2026-08-11`.

Supersedes the active implementation checkpoint only. It does not expand the
accepted P5F3 product authority in ADR 0019 or authorize live sends.

Accepted base:

- PR #145 merged P5F2 at exact main
  `5ac5b018d475117d13aff4607debcee60ec0cc7c`;
- exact-main CI run `31452549612` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped on the push event as expected;
- migrations are contiguous through `066`;
- P5F2 persists structured Gemini proposals but deliberately reports
  `autonomous_authority=false` and performs no transport action.

Reason:

- the owner approved autonomous replies, but only as replies to an exact
  customer inbound and not as general outbound automation;
- a model proposal is not send authority, and an HTTP success is not delivery
  proof;
- the next thin slice must therefore separate deterministic policy, durable
  intent, provider attempt and later ACK observation before any production
  enablement can be considered.

Decision:

- Add additive migration `067` for private append-only control, policy/gate,
  send-intent, attempt and provider-binding evidence; guarded current
  projections may exist only for safe staff reads and ACK reconciliation.
- Deterministic Platform policy is the only creator of an autonomous intent.
  It binds the same organization/conversation, exact latest inbound source,
  exact completed P5F2 proposal, `p5f3-v1` policy and one unused idempotency
  key. Gemini and browsers cannot create or claim an intent.
- Staff must explicitly enable or resume autonomy for a conversation with a
  bounded reason. Staff pause/takeover, any later manual outbound and durable
  opt-out block autonomy. A model result, reconnect or new inbound cannot
  resume it.
- Both intent creation and worker claim re-check the exact source, open
  conversation, `<=24h` internal EVO window, `Asia/Bishkek 09:00-21:00`, known
  language, confidence `>=85`, low risk, no handoff, approved evidence,
  `WORKING` session health, 60-second cooldown, at most six autonomous sends
  rolling 24 hours and at most three consecutive autonomous replies.
- Initial intent allowlist is `greeting`, `admissions_discovery`,
  `program_or_country`, `documents` and `deadline`. Pricing/payment, visa,
  scholarship, complaint, opt-out and other/ambiguous intents fail closed to
  human review. Media-only/unsupported inbound also fails closed.
- The private worker requires exact runtime enablement and an explicitly
  disengaged emergency kill switch, then performs a current exact-session WAHA
  preflight. It sends only `POST /api/sendText` with the exact private direct
  chat, exact inbound `reply_to` and persisted bounded text.
- Its internal trigger is deliberately bodyless: HMAC authenticates the exact
  request UUID and 13-digit timestamp, while all command data is claimed
  atomically from private SQL. The caller cannot submit chat IDs, message IDs or
  reply text in an HTTP body.
- Persist the intent before transport. Provider rejection is durable
  `rejected`; timeout, connection loss, malformed response or another
  ambiguous post-call result is durable `unknown` plus human review and is
  never retried automatically. HTTP acceptance is `accepted`, not delivered.
  Existing `message.any`/`message.ack` evidence advances the safe visible state.
- Raw WAHA chat/message identifiers, provider response bodies, hashes, secrets
  and phone-bearing identifiers remain private. The accepted Claude Design
  `/whatsapp` view exposes only safe control, block/queue/attempt and ACK state.
- The `<=24h` rule is explicitly an internal conservative EVO policy. WAHA is
  not Meta Cloud API and this block must not claim WAHA enforces that service
  window. Current primary-source verification is recorded in
  `docs/research/p5f3-waha-autonomous-reply-transport-2026-08-11.md`.
- Existing Lead Agent, manual-send workflow, legacy rollback path, P4B
  deferral, P9 removal and no-SQLite boundary remain frozen.
- Fresh official WAHA verification confirms that `WORKING` alone is
  insufficient: the current Sessions guide documents
  `me.reachoutTimelock`, which can be active while the session remains
  `WORKING`. P5F3 therefore accepts only an explicit `null` or
  `isActive: false` state and fails closed on active, missing, or malformed
  state. The same-chat latest-inbound binding and internal 24-hour limit remain
  additional deterministic guards. A synthetic fixture validates the adapter
  contract but is not real-provider proof.

Validation impact:

- Require focused deterministic gate, configuration, HMAC, queue/claim/finish,
  exact WAHA request, idempotency, rejection/unknown and no-retry tests.
- Require disposable PostgreSQL/RLS tests for service-only mutation, exact
  tenant/source/proposal binding, actor-controlled resume/pause, rate/cooldown,
  provider binding, ACK linkage and public privacy.
- Require a dedicated disposable Supabase/browser partition proving a
  synthetic loopback `reply_to` flow through the accepted `/whatsapp` thread,
  with all runtime/provider flags off in every other partition.
- Require focused UI/repository tests, lint, type generation, typecheck, build,
  dependency/secret audits, one fresh independent exact-head read-only review,
  all four exact-head CI jobs, direct merge at that exact SHA and green
  exact-main push CI.

Blocked proof and rollback:

- Production enablement, credentials, customer data, a live WAHA send, real
  Gemini execution and provider/cutover proof remain blocked without separate
  explicit owner authority. A loopback fixture is never provider proof.
- Rollback keeps enablement off and the kill switch engaged, safely holds
  queued intents, reverts application code and forward-fixes additive migration
  `067` without deleting audit history.

## 2026-08-11 - Decompose P6 operations and Student Portal delivery

Block-ID: `EVO-P6-OPERATIONS-PORTAL-PLAN-2026-08-11`.

This docs-only amendment supersedes the stale P5F3 active-checkpoint wording;
it does not rewrite the accepted P5F3 implementation contract or authorize any
runtime/provider action.

Accepted baseline:

- PR #146 merged the disabled-by-default deterministic P5F3 autonomous inbound-
  reply lane;
- current `origin/main` is
  `81ae079594baaa4a453501a99ad0ed5c3ba408d6`;
- migrations are contiguous `001-067`;
- exact-main push CI run `31514964102` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped as expected for a push event;
- P5 synthetic local authorization/browser proof is accepted, while real
  Gemini, real WAHA/customer send, managed Supabase and production enablement
  remain blocked and unproved.

Repository findings:

- migration 043 already contains durable notification, delivery-intent and
  append-only event state plus `platform.create_individual_notification(...)`,
  `platform.my_notifications()` and
  `platform.mark_own_notification_read(...)`;
- the creator always persists one `in_app` and one consent-gated
  `individual_whatsapp` intent, but explicitly performs no provider send and
  returns `delivery_proof=false`;
- the current public pair is therefore not an exact in-app-only Portal
  contract, because the creator writes two channels and the reader expects both
  channels to exist;
- the accepted `/portal/notifications` page still renders
  `student_portal_updates`, whose repository deliberately has no unread
  receipt; no app path uses the durable notification read/acknowledgement RPCs;
- the accepted Portal already derives visible next actions for rejected or
  required documents, tasks, pending payments and overdue payments;
- the staff `/notifications` surface is a separate legacy SQLite-derived
  attention feed with no durable acknowledgement model;
- existing P2D/P2E/BW7 foundations already cover scoped applications, visa,
  reasoned case close/reopen, private document review, evidence-based manual
  finance and Student Portal projections, but the full two-Student P6 exit path
  has not been proved end to end.

Decision:

- Define `P6A` as a read-only overdue/attention Portal slice. It SHALL reuse
  existing Platform task, document and finance projections, make their safe
  overdue state explicit in the accepted Portal and perform no notification,
  scheduler or provider side effect. A page read SHALL never create durable
  state.
- Define `P6B` as the thinnest real durable in-app-only Student notification
  path. The accepted `/portal/notifications` surface SHALL use a new versioned
  self-only projection and read-acknowledgement contract over the existing
  durable tables; it SHALL NOT depend on the current two-channel public pair
  unchanged.
- The first producer SHALL be a reviewed human event already owned by the
  Platform: document outcomes `correction_required` and `rejected`. Review and
  publication SHALL be atomic or durably retriable against one immutable source
  event, with deterministic dedupe and no duplicate Student notification.
- Migration 043 remains immutable. Additive migration 068 MAY add a narrow
  wrapper/projection/creator, append-only evidence and private Realtime
  invalidation if needed to provide the in-app-only atomicity and authorization
  contract.
- Private Realtime SHALL broadcast only an authorization-bound invalidation;
  the client refetches the safe RPC. Notification text, case identifiers,
  provider state and private topics SHALL not be exposed in the broadcast
  payload or DOM.
- P6A-P6C SHALL NOT create a new `individual_whatsapp` intent, claim, route or
  dispatch it, and SHALL NOT report it as sent/delivered. No WAHA call, phone
  resolution, communication-message write or P5 transport reuse is authorized.
- Individual WhatsApp notification delivery remains a separate future target;
  this P6 amendment neither cancels nor activates it.
- Define `P6C` as a separate disabled-by-default, idempotent overdue-transition
  producer. It starts with explicit Platform task due times, then evidence-
  backed payment-obligation due times. An application deadline participates
  only after an authoritative Platform field and owner are proved. Page reads
  SHALL never synthesize notification writes.
- The P6C worker SHALL have one bounded scheduler/owner, an HMAC-authenticated
  internal trigger, transition-version dedupe, durable request/result audit and
  a same-transaction state recheck before publication.
- Define `P6D` as the P6 closure gate: one accepted-UI path with two distinct
  Students plus an unrelated organization across multiple applications,
  assigned-Curator visa, reasoned close/reopen, private document review,
  evidence-based manual finance, overdue Portal action and durable
  notification/read state.
- P6A-P6C do not complete broad P6. P6 is complete only after the P6D positive
  path and negative isolation matrix pass together.
- Do not migrate the legacy SQLite staff notification feed. Do not infer
  identity, responsible Sales, stage, Portal activation or canonical handoff
  from amoCRM/local shadow data. P4B activation/writes stay deferred and P4R
  remains read-only context.
- The accepted Claude Design frontend remains the sole Platform UI. P9 remains
  removed; Lead Agent, legacy webhook/session and rollback remain
  deployed/frozen.

Validation impact:

- Require exact typed RPC response contracts, actor-derived server actions and
  fail-closed handling of malformed, stale or unavailable state.
- Require disposable PostgreSQL/RLS tests for self-only reads, acknowledgement,
  staff producer permission/object scope, idempotency, cross-Student and cross-
  organization denial, private Realtime topic authorization and direct-table
  denial.
- Require a dedicated singleton local Supabase/browser partition proving
  staff review to live Portal visibility and persisted self-read state, while
  every unrelated partition keeps P6 runtime flags disabled.
- P6C additionally requires before-due, first-overdue, duplicate, resolved,
  reopened and concurrent-worker cases with no read-time write.
- P6D requires the full two-Student/cross-organization staff-to-Portal path.
- Each slice requires Node 22.23.1 focused/unit/security tests, diff check,
  lint, route type generation, TypeScript, build, staged secret scan,
  dependency audits, one fresh independent exact-head read-only review, all
  four exact-head CI jobs, direct merge of only that reviewed head, and green
  exact-main push CI before the next slice.

Blocked proof and rollback:

- This amendment authorizes no product/schema/runtime mutation. Subsequent
  implementation PRs remain local/synthetic until separately authorized.
- Production migration/deployment, credentials, customer data, WAHA session
  mutation, live customer send, amoCRM write, provider cutover and service
  retirement remain blocked.
- Rollback keeps producer/scheduler flags disabled, removes application wiring
  and forward-fixes additive migrations without deleting durable audit or
  notification history. Migration 043 and its dormant consent-gated WhatsApp
  intent model remain intact.

## 2026-08-12 - Implement P6A read-only Portal attention

Block-ID: `EVO-P6A-PORTAL-ATTENTION-2026-08-12`

Accepted baseline:

- PR #147 merged the reviewed P6A-P6D contract as
  `fcbb01b9c3918f1b570d3de5f86575110c2ee3f1`.
- Exact-main CI run `31523285552` attempt 2 is green for Main CRM, EVO Inbox
  and EVO Lead Agent; Changed range is skipped on the push event as expected.
- Attempt 1 is non-evidence: one unrelated P5F1 browser case completed in 31.2
  seconds against a 30-second limit. The failed job was rerun at the same exact
  main SHA and passed without a code change.
- Migrations remain contiguous `001-067`; P6A reserves no migration number.

Decision:

- Implement P6A only over the existing argument-free, actor-derived and
  RLS-bound Student Portal snapshot. The server continues to derive the
  organization and Student identity from the authenticated actor; browser
  route/query input is not authority.
- Add exact fail-closed runtime flag
  `EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED`, enabled only by the literal
  value `1`. Test-only selector `EVO_P6A_BROWSER_PROOF` exists solely inside
  the local Playwright harness, is never read by product runtime, and selects
  the one proof partition allowed to enable the runtime flag. Every unrelated
  local browser partition keeps both values disabled.
- When the runtime flag is disabled, preserve the accepted Portal behavior.
  When enabled, present only authoritative urgent/high task, rejected-document
  and overdue-payment items in a named read-only attention region, and add a
  localized overdue-payment explanation. Normal informational actions do not
  become attention items.
- Preserve the accepted Claude Design components, responsive layout and
  existing navigation. P6A may add localized RU/KY/EN copy and focused
  accessibility semantics, but no parallel frontend or copied Inbox surface.
- P6A adds no schema, migration, RPC, DTO field, direct-table access, write,
  read receipt, acknowledgement, scheduler, durable notification, Realtime
  publication, WAHA/amoCRM/Gemini call or provider credential path.
- P6B remains the first durable in-app-only Student notification slice; P6C
  remains the first overdue-transition producer; P6D remains the full two-
  Student and cross-organization closure proof.

Validation required before merge:

- Node `22.23.1` focused P6A UI/config and reset-harness tests; unit/security
  Node suites; `git diff --check`; ESLint; Next route type generation;
  TypeScript; production build; staged secret scan and dependency audits.
- One singleton disposable local Supabase/browser gate. Its dedicated P6A
  partition must prove the real authenticated positive Student sees the named
  attention region and overdue helper, the same-organization no-case Student
  fails closed, and a browser-supplied route/query identifier cannot expand
  scope. Existing PostgreSQL/RLS evidence remains the authority for self-only
  and cross-organization reads.
- The P6A proof must show no acknowledgement control, provider identifier,
  WAHA/amoCRM action or hidden production claim. It does not substitute for the
  P6D two-positive-Student/cross-organization matrix.
- Require one fresh independent read-only review of the final exact head, all
  four exact-head CI jobs, a final head/base refresh, direct merge of only that
  reviewed head and green exact-main push CI before P6B begins.

Proof boundary and rollback:

- Local Supabase/Auth/Playwright data is synthetic acceptance evidence only.
  It is not managed-Supabase, customer-data, provider, staging or production
  proof and authorizes no production mutation.
- Rollback is immediate and data-free: keep
  `EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED` unset/disabled and revert the
  P6A UI/harness wiring. No durable P6A row, provider effect or audit history
  requires cleanup.

## 2026-08-12 - Move the P6A runtime gate to the clean exact-head CI runner

Block-ID: `EVO-P6A-CI-RUNTIME-GATE-2026-08-12`

Observed constraint:

- Node `22.23.1` focused P6A/reset tests, the full unit and security-Node
  suites, ESLint, Next route type generation, TypeScript, production build,
  PostgreSQL/RLS authorization, migration-history verification, dependency
  audits, staged secret scan and diff checks pass in the isolated P6A
  worktree.
- Two singleton workstation runs of exactly
  `npm run test:supabase:local` remained non-evidence before the browser
  partition. The first applied migrations `001-067` and then failed the exact
  disposable stack's post-reset recovery; the second timed out during the
  initial disposable reset with exit `124`. Both failures were in OrbStack
  container lifecycle operations, not a P6A assertion, SQL error or browser
  result.
- Bounded exact-resource cleanup initially hung in the same Docker API.
  Coordinated OrbStack recovery preserved all data; only exact disposable
  `evo-platform-local` containers, volume and network were removed. Final
  verification found zero exact Platform resources/process/lock, healthy EVO
  Inbox containers and recovered unrelated frontend/API services. No broad
  Docker cleanup occurred.

Decision:

- Do not weaken, skip or replace the required runtime acceptance. The current
  exact-head Main CRM CI job must run the same repository command
  `npm run test:supabase:local` on its clean isolated Docker runner and must
  exit `0`, including the dedicated P6A Auth/PostgREST/browser partition and
  normal exact cleanup, before merge.
- The two workstation failures remain explicit infrastructure blockers and
  are not test evidence. A green exact-head CI run is the runtime/browser
  evidence for this slice; focused local PostgreSQL/RLS and Node/build evidence
  remain separate supporting checks.
- If exact-head CI reproduces any P6A, Supabase, RLS or browser failure, fix the
  actual defect and rerun. Only a clean exact-head CI pass plus one fresh
  independent exact-head review may authorize direct merge.

## 2026-08-12 - Align the P6A Next.js browser-partition bootstrap

Block-ID: `EVO-P6A-PARTITION-BOOTSTRAP-FIX-2026-08-12`

Observed exact-head evidence:

- Exact-head CI run `31534003041` attempt 1 reached the browser partitions but
  its P5F3 Next.js dev server hit a transient `next/font/google` Turbopack
  resolution failure. The same-head failed-job rerun passed P5F3, so no font,
  typography or accepted Claude Design change is justified by that attempt.
- Attempt 2 then reached the new P6A partition and failed before Playwright
  because `next.config.ts` rejected
  `EVO_PLATFORM_AUTH_BROWSER_PARTITION=p6a`. The reset harness and Playwright
  config already recognized P6A, but the Next.js bootstrap allowlist still
  ended at P5F3 and `remaining`.
- This is a deterministic P6A proof-bootstrap defect. Both CI attempts are red
  and remain non-evidence for the full P6A runtime gate.

Decision and validation impact:

- Add only the literal `p6a` to the existing fail-closed Next.js partition
  allowlist. Do not widen the accepted value shape, disable validation, change
  the font stack or alter the P6A product/runtime contract.
- Extend the reset-harness contract test so every partition used by the
  singleton browser runner must also be present in the Next.js allowlist, and
  align the existing history bootstrap assertion with that same exact list.
  The regression failed first with the exact missing-P6A assertion and passed
  after the one-value bootstrap fix under Node `22.23.1`.
- The corrected exact head still requires the full local/static checks, one
  fresh independent exact-head read-only review and all four exact-head CI
  jobs. Only a green Main CRM run proving the full disposable Supabase,
  Storage, PGMQ and every browser partition may authorize direct merge.

Scope and rollback remain unchanged:

- P6A remains read-only, server-flagged and disabled by default. This fix adds
  no schema, RPC, DTO, write, acknowledgement, provider call, production
  mutation or new public route.
- Rollback removes the single `p6a` bootstrap value and its regression
  assertion together with the P6A harness if the entire slice is reverted.

## 2026-08-12 - Implement P6B durable Student Portal notifications

Block-ID: `EVO-P6B-PORTAL-NOTIFICATIONS-2026-08-12`

Accepted baseline:

- PR #148 merged the reviewed P6A read-only attention slice as
  `6a90d9a1f00263dedfa33fb7543bd176a96d46a4`.
- Exact-main CI run `31538299201` is green at that exact SHA for Main CRM,
  EVO Inbox and EVO Lead Agent; Changed range is skipped on the push event as
  expected. Main CRM passed the full disposable Supabase, Storage, PGMQ and
  browser contract, frontend contracts, build, all CRM scenarios and audits.
- Migrations remain contiguous `001-067`; this block owns additive migration
  `068` and does not edit migration `043` or `053` history.

Decision:

- Implement P6B as the first durable, in-app-only Student notification/read
  lifecycle. Add `platform.student_portal_notification_projection_v1` over
  the existing `platform.notifications` and `platform.notification_events`
  tables. The projection is FORCE-RLS, has no direct browser policy or grant,
  and is exposed only through narrow authenticated RPCs.
- Freeze the browser read contract as argument-free
  `platform.student_portal_notifications_v1()`. It derives the active Student
  organization, membership and readable case from current Auth authority and
  returns only notification id, category, negative review decision, safe
  requirement key/label, review reason, created time and read time. It returns
  no case/source/version/reviewer/provider/phone/consent or Realtime topic
  identifier.
- Freeze acknowledgement as
  `platform.mark_own_student_portal_notification_read_v1(notification_id,
  request_id)`. It derives authority server-side, locks the exact self-owned
  notification, performs the one-way read transition through the accepted
  audited notification contract and returns only notification id, read state
  and read time. Same-organization other Students, cross-organization actors,
  inactive or wrong-role actors and malformed identifiers fail closed.
- Publish only from an `AFTER INSERT` trigger on the immutable
  `platform.document_reviews` source event for `correction_required` and
  `rejected`. The trigger resolves one live Student recipient and inserts one
  notification, one P6B projection and one created event in the review
  transaction. Exact source uniqueness provides dedupe. Publication failure
  rolls back the review; no partial success or orphan is accepted.
- Insert no `notification_delivery_intents` row and do not call the existing
  two-channel creator/list pair. P6B performs no WhatsApp intent, WAHA call,
  provider claim, communication write, delivery claim or send.
- Add membership-scoped private Realtime invalidation on projection creation
  and the exact read transition. Topic authorization requires the exact active
  Student organization and membership plus a live Portal-readable case.
  Broadcast payload is ID-free invalidation only; the browser refetches the
  safe RPC. Safe localized notification text may be rendered in the accepted
  Portal, but notification text is never placed in the Realtime payload and
  case identifiers/private topics are never rendered in the DOM.
- Current official Supabase Realtime
  [Authorization](https://supabase.com/docs/guides/realtime/authorization) and
  [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) contracts
  require a client private channel, a `SELECT` RLS policy over
  `realtime.messages` using `realtime.topic()`, and matching database-send
  privacy. P6B reuses that already accepted migration-063 pattern and grants no
  authenticated `INSERT` or `realtime.send` capability.
- Redefine the existing
  `platform.staff_student_case_documents(student_case_id)` function only in
  migration `068` so it joins `document_slots.current_version_id`. This fixes
  the current multi-version ambiguity without editing migration `053` or
  widening staff authority.
- Add the first Supabase-native staff review control to the accepted Student
  360 document section for submitted current Platform versions. It calls the
  existing audited `platform.review_document_version(...)` RPC for only
  `correction_required` or `rejected`, requires a bounded reason and exact
  request id, and remains unavailable to Sales, unassigned Curators and
  legacy SQLite documents. The legacy `/documents` workflow is not reused or
  migrated.
- Add exact fail-closed runtime flag
  `EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED`, enabled only by `1`, and a
  harness-only `EVO_P6B_BROWSER_PROOF` selector. Every unrelated browser
  partition keeps both disabled. When runtime is disabled, preserve the
  accepted P6A/Portal behavior.
- Preserve the accepted Claude Design layout. Keep P6A read-only attention
  above the new durable feed; derive the Portal unread badge from the durable
  notification projection; add localized RU/KY/EN copy and an accessible
  per-notification read action without copying Inbox CRM surfaces.

Validation required before merge:

- Node `22.23.1` focused SQL-contract, repository/action, UI/Realtime and reset
  harness tests; unit/security Node suites; `git diff --check`; ESLint; Next
  route type generation; TypeScript; production build; staged secret scan and
  dependency audits.
- One singleton disposable PostgreSQL authorization gate proving additive
  migration `068`, forced RLS/direct-access denial, current-version staff
  document reads, atomic negative-review publication, approved-review silence,
  exact idempotency, self-only read/ack and private topic authorization.
- One singleton full local Supabase/browser gate. Its dedicated P6B partition
  must prove accepted Student 360 negative review to one live Portal
  notification without reload, a persisted self-read transition and unread
  badge update, plus same-organization other-Student, cross-organization,
  anonymous, inactive/wrong-role and malformed-topic denial. The proof must
  assert there is no WhatsApp intent, provider/communication state or private
  identifier in the response or visible DOM.
- One fresh independent exact-head read-only review, all four exact-head CI
  jobs, direct merge of only that reviewed head and green exact-main push CI
  before P6C begins.

Blocked proof and rollback:

- Real provider, managed Supabase, staging, production migration/deployment,
  customer data and customer delivery remain blocked. Synthetic local
  review-to-Portal evidence is not production proof.
- Rollback disables the runtime flag and removes application/realtime wiring.
  Additive migration state is forward-fixed without deleting durable review,
  notification, event or read history. Migration `043`, dormant WhatsApp
  intents, Lead Agent and legacy rollback path remain intact.

### P6B pre-merge review correction: enforce the disabled database boundary

- The application flag alone is not a database authorization boundary. P6B
  therefore also requires an enabled row for the exact organization in the
  private FORCE-RLS
  `platform_private.student_portal_notification_runtime_controls` table.
  Migration `068` creates no enabled row, so a configured Supabase project and
  the accepted legacy review RPC remain notification-silent by default.
- Preserve `platform.review_document_version(...)` as the legacy review-only
  contract. The P6B staff action instead calls
  `platform.review_document_version_with_portal_notification_v1(...)`. That
  gated wrapper requires the private organization control and sets a
  transaction-local producer context only around the accepted immutable review
  operation. The trigger requires both controls; a missing control rolls back
  the P6B wrapper before any review or notification write.
- Publication additionally requires the Student case to be Portal-readable:
  `active|closed`, Portal activated, a current granted case scope and published
  Student bundle permissions for both Portal and self-notification reads. This
  prevents successful publication of a row that its intended recipient cannot
  read or acknowledge.
- Bound the safe feed deterministically to the latest 500 rows and enforce the
  application-safe 128-character `requirement_key` boundary before projection.
  The synthetic P6B fixture alone enables the private organization control;
  production and every unrelated environment remain disabled.

## 2026-08-12 - Implement P6C as one bounded task-then-payment overdue producer

Block-ID: `EVO-P6C-OVERDUE-NOTIFICATIONS-2026-08-12`

Accepted prerequisite and scope:

- PR `#149` merged P6B as
  `a31d2753aa94e90f6155c9cf6d5602d984befc65`; exact-main CI run
  `31614233491` passed all four jobs. P6C therefore starts from the accepted
  durable self-only Portal notification/read/Realtime contract.
- The already merged P6 contract authorizes one P6C implementation slice with
  explicit Platform tasks first and explicit payment obligations second. It
  does not authorize inferred application deadlines, read-time synthesis,
  WhatsApp delivery, amoCRM inference or production scheduler activation.

Implementation decision:

- Add additive migration `069` with private forced-RLS runtime controls,
  transition state and bounded run audit plus an overdue-specific notification
  projection. No organization is enabled by the migration. An enabled
  organization must name one live Admin automation-owner membership; the run
  audit also records the service worker identity.
- A task is overdue only when it is Student-visible, has an explicit due time
  before the transaction clock and remains `open`, `in_progress` or `blocked`.
  A payment is overdue only when its explicit due time has passed and exact
  evidence-backed outstanding minor units remain after confirmed payments and
  refunds. Application deadlines stay excluded.
- Treat each false-to-true transition as a new overdue episode. Increment a
  per-source transition version and publish exactly one durable notification
  for that version. Repeated true observations are no-ops; true-to-false marks
  the private state resolved without deleting notification or audit history;
  a later false-to-true transition publishes the next version.
- Lock and recheck every candidate in the same transaction that records its
  transition and publishes the notification. Process a fixed maximum of 50
  tasks first and then 50 payments in one run. Exact request replay is
  immutable and concurrent workers cannot duplicate an episode.
- Add actor-derived `student_portal_notifications_v2()` and v2 read
  acknowledgement over the union of accepted P6B document-review rows and P6C
  task/payment rows. Preserve the v1 RPCs. Reuse the accepted private
  membership-scoped Realtime topic with an empty invalidation payload; no
  source, case, organization, member, amount or provider identifier enters the
  public DTO or DOM.
- Add one disabled-by-default server worker and bodyless internal trigger. The
  exact runtime flag must equal `1`, the private organization control must be
  enabled, and the request UUID, 13-digit timestamp and lowercase HMAC over
  `<request-id>.<timestamp>` must pass the accepted bounded-skew contract. The
  caller supplies no organization, batch size, clock, source ID or content.
- The dedicated disposable P6C browser partition alone enables the runtime and
  one synthetic organization control. Every other partition keeps P6C off.
  No production cron, scheduler, environment mutation or customer data is in
  scope.

Validation and rollback:

- Prove disabled/absent controls, before-due, first-overdue, exact replay,
  duplicate/concurrent run, resolution and reopened episodes for tasks and
  payments; partial payment, full settlement and evidence-backed refund;
  task-before-payment ordering; P6B compatibility; two same-organization
  Students and one cross-organization Student; private topic/read denial; live
  invalidation and persisted acknowledgement; and absence of delivery intent,
  WAHA, amoCRM, SQLite or provider writes.
- Require Node `22.23.1` focused/unit/security tests, disposable PostgreSQL/RLS,
  the singleton full Supabase/browser gate, lint, typegen, TypeScript, build,
  scenario tests, staged secret scan, dependency audits, one fresh exact-head
  independent review, all four exact-head CI jobs and green exact-main CI.
- Rollback keeps both application and database controls disabled, removes only
  application/scheduler wiring, and forward-fixes additive schema without
  deleting transition, notification, read or audit history.

## 2026-08-13 - Close P6 through one Platform-owned cross-domain Student 360 path

Block-ID: `EVO-P6D-PORTAL-CLOSURE-2026-08-13`

Accepted prerequisite and discovered gap:

- PR `#152` merged P6C as
  `ae434a0a8b0b1ed46edd0f4dc657ef5d59d7e823`; exact-main CI run
  `31630205976` passed the full Main CRM, EVO Inbox and EVO Lead Agent push
  gates. P6D therefore starts from the accepted P6B/P6C durable Portal
  notification, Realtime and self-read contract.
- The accepted Platform Student 360 already uses Supabase-backed application,
  lifecycle and current-version document operations. Its Platform presentation
  still deliberately supplies `visa: null`, `payments: []` and
  `canMutatePayments: false`. The visually similar staff `/visa`, `/finance`
  and legacy client actions are SQLite-backed and cannot be used as proof of a
  Platform-to-Portal path.

Implementation decision:

- Add only the missing bounded Platform repository/action seams needed to show
  the exact Student case visa state and evidence-backed manual finance state in
  the accepted Student 360 layout. Reuse the existing migration-042 visa and
  migration-043 finance sources, permissions, request replay and case/object
  scopes. If their existing public functions cannot produce one strict safe
  staff DTO, add a forward migration with narrow actor-derived RPCs rather than
  reading private tables or copying the legacy SQLite actions.
- Visa mutation is limited to the already authorized Admin or assigned Curator
  for the exact case and requires explicit evidence and a bounded operator
  note. Manual finance mutation is limited to the existing Finance/Admin case
  authority, exact currency/minor-unit invariants and explicit evidence. The
  browser never supplies organization, membership, provider or amoCRM
  authority.
- Preserve the accepted Claude Design Student 360 and Portal surfaces. Adapt
  the safe Platform DTOs into those existing cards/forms; do not add a parallel
  CRM, a new Portal page, or a legacy fallback. Lifecycle close/reopen remains
  the accepted Platform action and document review remains the accepted P6B
  current-version action.
- Add no new notification category. The controlled path composes the accepted
  `document.review`, `task.overdue` and `payment.overdue` projections and their
  durable self-read state. A manual payment resolution may change the safe
  Portal payment state and resolve a later overdue episode, but reading a page
  never creates or resolves durable state.
- Add one dedicated disposable `p6d` browser partition. It alone seeds the
  synthetic cross-domain fixture and proof selector; every provider, WAHA,
  Gemini, autonomous-send and amoCRM-write lane remains disabled. The proof
  uses two distinct Students in one organization plus an unrelated Student in
  another organization and never uses production/customer data.

Validation and completion boundary:

- Prove multiple applications, assigned-Curator visa read/mutation, reasoned
  close and reopen, current private document negative review, evidence-backed
  manual finance, explicit overdue task/payment Portal actions, durable
  notification visibility and persisted self-read state through one accepted
  staff-to-Portal browser path.
- Prove same-organization other-Student, unrelated-organization, Sales,
  unassigned-Curator, stale/inactive and malformed-object denial at the
  applicable boundaries. Public RPCs and visible DOM must contain no raw WAHA,
  amoCRM, provider, private Realtime topic or private evidence identifier.
- Require Node `22.23.1` focused repository/action/UI/reset tests, unit and
  security-node suites, disposable PostgreSQL/RLS, one singleton full local
  Supabase/browser gate, `git diff --check`, lint, route type generation,
  TypeScript, production build, staged secret scan and dependency audits.
  Require one fresh independent exact-head review, all four exact-head CI jobs,
  direct merge of only that reviewed head and green exact-main push CI before
  P7 begins.
- Real provider, managed Supabase, staging, production migration/deployment,
  customer data and customer delivery remain blocked. Local synthetic evidence
  is not production proof. Rollback removes only the Student 360 wiring and
  proof partition; additive durable schema is forward-fixed without deleting
  visa, finance, document, lifecycle, notification or read history. Existing
  Lead Agent, WAHA, amoCRM and legacy rollback paths remain unchanged.

## 2026-08-13 - Decompose P7 security, reliability and operations

Block-ID: `EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13`

Detailed implementation contract:
`docs/platform/p7-security-reliability.md`. Primary-source evidence:
`docs/research/p7-official-evidence-2026-08-13.md`.

This docs-only amendment replaces the broad P7 wording with four sequential,
reviewable gates. It authorizes no schema, application, credential, provider,
managed-Supabase, customer-data, staging or production mutation.

Accepted baseline:

- PR `#153` merged P6D as
  `1e53d93d8c70c286e56c5d057928e9f080c58a44`; migrations are contiguous
  `001-070`. Exact-main push CI run `31650640795` passed Main CRM, EVO Inbox
  and EVO Lead Agent; Changed range was skipped on the push event as expected.
- P5-P6 evidence is synthetic/local. Real WAHA, Gemini, amoCRM-write, managed
  Supabase, customer-send and production proof remain blocked.
- `platform.audit_events` is append-only and `audit.read` belongs only to the
  Admin bundle, but authenticated browsers still have direct RLS-filtered table
  `SELECT` and the accepted Platform runtime has no safe audit presentation or
  export seam. `/settings?tab=audit` still reads legacy SQLite and is not an
  authorized Platform data source.
- `/api/health`, request correlation, bounded JSON logging, private edge paths,
  Compose limits and retained Lead Agent health exist. Platform readiness,
  safe operational metrics, alert evaluation and current runbooks remain
  incomplete.
- Database backup does not include private Storage object bytes. Database and
  Storage restore therefore remain separate evidence tracks.
- DEC-009, DEC-010, DEC-012 and DEC-017 remain open. Repository work may
  proceed around them, but affected managed, numeric, retention and release
  claims remain blocked.

P7 SHALL execute only in this order:

1. `P7-PLAN` - this docs-only authority amendment.
2. `P7A` - safe Admin-only Platform audit search and export.
3. `P7B` - private structured observability, controlled alerts and runbooks.
4. `P7C` - real isolated database restore plus separate private Storage-object
   restore using synthetic data.
5. `P7D` - approved-capacity load evidence and automated plus human
   accessibility closure.

### P7A - safe Platform audit search/export

Implementation seams:

- Use expected next-free migration `071` only after a fresh ownership check at
  implementation time; this amendment does not reserve the ordinal. Add
  actor-derived Admin-only search/export RPCs. The caller never supplies
  organization or membership authority.
- Revoke browser-role direct table reads of `platform.audit_events`; all
  browser access uses the safe RPC projection. Stop if any accepted Platform
  consumer is discovered to depend on direct table access.
- Search uses a stable `(created_at,id)` descending cursor, an immutable
  `(created_at,id)` snapshot boundary, UTC start-inclusive/end-exclusive
  timestamps, exact action/resource-type/Platform-resource-UUID filters, page
  size `1..100`, and rejects malformed or out-of-scope input.
- Export uses the same snapshot and filters, requires an explicit window no
  longer than 31 days, is capped at 5,000 rows, and fails visibly instead of
  truncating. A private replay ledger binds the request UUID to the canonical
  filters, snapshot, row count and row-set hash.
- Safe row fields are limited to Platform event UUID/time, action, resource
  type/Platform UUID, actor kind/safe staff display label, request UUID, one
  fixed safe reason code or `restricted`, and allowlisted changed-field codes.
  Raw `before_state`, `after_state`, free-text reason, actor principal, secret
  references, provider payloads, object keys, private Realtime topics and
  phone-bearing identifiers never enter RPC output, DOM or CSV.
- Export is one same-origin authenticated `POST`; `GET` cannot create an audit
  event. It writes exactly one replay-safe `audit.export` event containing only
  canonical filters, snapshot, row count and row-set hash.
- CSV generation is deterministic, `private, no-store`, never persisted to
  Storage, uses a fixed column order and neutralizes spreadsheet formula
  prefixes after leading whitespace (`=`, `+`, `-`, `@`) plus CR/LF injection.
- Connect only the accepted Platform `/settings?tab=audit` presentation and
  Admin navigation. Other Platform roles fail closed. Legacy SQLite settings
  remain available solely to explicit non-production fixture mode and are
  never a connected-runtime fallback.
- Use dedicated Platform audit contract/repository/action modules, route
  contract/guard changes, i18n, migration/RLS tests and a dedicated `p7a`
  disposable browser partition.

Acceptance:

- Active Admin can search and export only the exact organization bound to the
  verified live actor.
- Sales, Curator, Finance, Student, anonymous, inactive, stale-authority and
  cross-organization actors are denied at SQL, action, route and visible-DOM
  boundaries.
- Direct table access and malformed/oversized filters are denied.
- Pagination remains deterministic while new events append after the captured
  snapshot.
- Identical export request replay appends no duplicate audit event and returns
  the same row-set hash; changed input under the same request UUID fails.
- DOM and CSV pass secret/private-field/phone-pattern scans and CSV
  formula-injection tests.
- No SQLite, service-role browser access, provider call or production mutation
  exists.

Rollback removes Platform settings/export wiring and forward-fixes the
additive implementation migration without deleting audit or export history.

### P7B - private observability and runbooks

Implementation seams:

- Keep `/api/health` as fixed process liveness with no dependency or provider
  call.
- Replace the legacy SQLite readiness path in connected Platform runtime with
  bounded Supabase/Platform readiness. Keep `/api/readiness`, `/metrics`,
  `/api/internal/*` and Lead Agent admin/readiness surfaces private; the public
  edge must continue returning `404`, and no new public port is introduced.
- Expose only allowlisted aggregate status/count/age values. Never emit tenant,
  user, case, message, phone, provider payload, object key, token or secret
  labels.
- Reuse the existing request-ID contract and structured JSON logging. Logs may
  contain event code, service, method, route template, status class and elapsed
  time only; query strings, bodies, cookies, authorization values and customer
  content remain forbidden.
- Add deterministic alert evaluation for readiness failure, unknown delivery,
  queue/dead-letter state, audit-append failure and missing/failed restore
  evidence. External pager/log-drain delivery remains blocked until its
  destination, credentials, cost and owner are approved.
- Update the runtime-hardening validator and runbooks for Supabase unavailable,
  queue growth, unknown delivery, WAHA degraded, AI unavailable, private media
  failure, audit failure, restore failure and rollback/kill-switch handling.
  Existing Lead Agent frozen/readiness semantics remain unchanged.

Acceptance:

- Private readiness returns `503` with a safe component code on missing or
  failed Platform dependencies and never converts missing provider proof into
  green status.
- Public requests to readiness, metrics, internal and Lead Agent admin routes
  receive `404`; private synthetic probes receive only safe fields.
- Controlled local failures produce the expected severity, owner category,
  correlation UUID and runbook reference without sending an external alert.
- Runtime/Compose/Caddy tests prove private networking, no published WAHA or
  Lead Agent port, bounded logs/resources and credential-header redaction.
- No production probe, provider call, log-drain mutation or public metrics
  endpoint occurs.

Rollback disables the new collectors/routes and reverts application/runbook
wiring; additive audit/operations state is forward-fixed and retained.

### P7C - isolated database and separate Storage restore

Implementation seams:

- Add one fail-closed drill orchestrator and runbook using two distinctly named,
  empty, disposable local Supabase environments and synthetic data only.
- Produce a database artifact and manifest separately from a private
  Storage-object artifact and manifest. Manifests contain schema/version,
  object count/size, checksums, source/destination identities and measured
  timestamps, never credentials or object contents.
- Restore PostgreSQL into the empty destination, then restore Storage bytes
  through supported Storage APIs rather than direct writes to Storage catalog
  tables.
- Refuse non-loopback sources/destinations, identical source/destination,
  existing unowned destinations, missing checksums, plaintext credential
  arguments, production environment markers and destructive cleanup.
- Backup artifacts use a per-run private `0700` location and an encrypted
  mechanism with an ephemeral test key. Operational key ownership remains a
  managed-environment gate.
- Cleanup may remove only exact drill-owned resources and artifacts.

Acceptance:

- Restored migration/schema state, synthetic Auth actors, organization/object
  isolation, append-only audit history and representative P5-P6 records match
  the source.
- Private document and media object counts, byte sizes and SHA-256 hashes match;
  authorized access works and cross-user/cross-organization access remains
  denied after restore.
- Database restore and Storage restore produce two distinct reports with
  measured recovery duration and observed data-loss window. These observations
  are not claimed as approved RPO/RTO.
- An absent, corrupt, partial or wrong-destination artifact fails closed.
- Managed Supabase/PITR and S3/versioning/deleted-object recovery are reported
  blocked unless distinct approved project/bucket credentials exist.
- No production backup, restore, migration, retention deletion or customer data
  is touched.

Rollback removes only drill scripts/runbook wiring and exact owned disposable
artifacts; it changes no production state.

### P7D - capacity and accessibility closure

Entry gate:

- The owner must approve a numeric capacity profile: staff/concurrent sessions,
  cases/messages/files, request mix, test duration and allowed error rate.
- An approved human accessibility reviewer and browser/device/screen-reader
  matrix must be available.
- Without either input, P7D is `BLOCKED`; a default load or Axe-only result
  cannot complete it.

Implementation and acceptance:

- Add a bounded k6 harness that refuses production/public-provider targets,
  missing numeric limits, unbounded duration and non-synthetic credentials.
- Run only against an isolated synthetic Platform with every WAHA, Gemini,
  amoCRM-write and autonomous-send/provider lane disabled.
- At the approved profile, prove the TZ read/write latency budgets, no
  unexplained duplicate/lost update, no cross-tenant disclosure and stable
  queue/audit invariants. Record observed results; do not invent a company SLO.
- Run Axe WCAG 2.2 A/AA checks plus responsive evidence at `1440x1024`,
  `834x1194` and `390x844` over critical accepted P5-P7 staff and Portal routes.
- Complete human keyboard, focus order/visibility, dialog semantics, zoom,
  screen-reader announcement and responsive inspection. Axe alone is not a
  WCAG conformance claim.
- Fix only verified regressions within the accepted Claude Design. Any finding
  requiring a new design system, workflow or architecture stops for a separate
  amendment.

### Global P7 stop conditions and external inputs

Stop before:

- reusing SQLite audit/settings data or exposing raw audit JSON/provider IDs;
- widening Admin audit authority or retaining direct-table browser access;
- making readiness/metrics/internal/Lead Agent admin routes public;
- touching a production or managed project, provider, customer record, DNS,
  WAHA session, live send, amoCRM write, retention deletion or deployed service;
- restoring into a non-empty, same, unidentified or non-isolated destination;
- running load without the approved numeric profile or against a public target;
- claiming accessibility completion without human evidence;
- continuing after a discovered consumer depends on direct audit-table access,
  or after an accessibility/security finding changes architecture or accepted
  product flow.

Open external inputs remain:

1. DEC-009: Supabase region/plan/PITR/cost owner plus a distinct managed restore
   project, direct database credential and separate Storage/S3 destination
   credentials.
2. Alert/log-drain destination, paid-plan authority and operational owner.
3. DEC-010: capacity profile and numeric SLO/RPO/RTO.
4. DEC-012: privacy, residency, retention/legal deletion and provider DPA.
5. DEC-017: release window, freeze rules and rollback authority.
6. Dedicated sanitized private WAHA test identity/session authority for later
   provider evidence.
7. Human accessibility reviewer and approved assistive-technology/browser/device
   matrix.

P8 remains blocked until P7D is complete and every unavailable managed,
provider or production segment is explicitly recorded as blocked/deferred.
No mock, configured-equals-working result or local fixture may replace it.

Primary sources rechecked for this amendment:

- Supabase database backups and PITR:
  <https://supabase.com/docs/guides/platform/backups>
- Supabase Storage S3 compatibility:
  <https://supabase.com/docs/guides/storage/s3/compatibility>
- Supabase Log Drains:
  <https://supabase.com/docs/guides/monitoring-and-debugging/log-drains>
- Supabase Platform Audit Logs:
  <https://supabase.com/docs/guides/security/platform-audit-logs>
- PostgreSQL `pg_dump` and `pg_restore`:
  <https://www.postgresql.org/docs/current/app-pgdump.html> and
  <https://www.postgresql.org/docs/current/app-pgrestore.html>
- Grafana k6 thresholds:
  <https://grafana.com/docs/k6/latest/using-k6/thresholds/>
- W3C WCAG 2.2 conformance:
  <https://www.w3.org/WAI/WCAG22/Understanding/conformance.html>
- WAHA observability:
  <https://waha.devlike.pro/docs/how-to/observability/>

## 2026-08-13 - Record P7A acceptance and OrbStack-only local execution

Block-ID: `EVO-P7A-ACCEPTANCE-HOUSEKEEPING-2026-08-13`

This status-only amendment records already merged evidence and fixes the local
macOS container-runtime rule. It changes no product scope, architecture,
schema, API, feature flag, credential, provider, customer data, managed
environment or production state.

Accepted checkpoint:

- PR #154 merged the P7 contract as
  `b9faadd24686a22bf70db176c6192304c942b2dd`.
- PR #156 merged P7A safe Admin-only audit search/export as
  `47e2e211ba77d36e3296b12ad0b8087276ca712d`, including migration `071`.
- Exact-main push CI run `31688954104` passed Main CRM, EVO Inbox and EVO
  Lead Agent; Changed range was skipped on the push event as expected.
- P7A remains disabled by default. Its accepted evidence is
  repository/disposable-local proof, not managed Supabase, production,
  provider or customer-data proof.

Current execution order:

1. P7B private structured observability, alert evaluation and runbooks is the
   next authorized implementation block under the existing P7 contract.
2. P7C isolated database restore and separate private Storage restore follows
   only after P7B acceptance.
3. P7D remains blocked until the owner supplies a numeric capacity profile, a
   human accessibility reviewer and the approved assistive-technology,
   browser and device matrix.
4. P8 remains blocked until P7D and explicit external-evidence accounting are
   complete. P9 remains removed; P10 follows P8.

Local runtime rule:

- On macOS, OrbStack is the only allowed local container engine for this
  repository. Before local Docker, Compose or container-backed Supabase work,
  `orb status` must report `Running` and `docker context show` must return
  exactly `orbstack`.
- A failed preflight blocks the container-backed step. Agents must not fall
  back to Docker Desktop, Colima, Rancher Desktop, `default`,
  `desktop-linux` or another engine/context.
- This local tooling rule does not change the remote Docker Compose runtime on
  `hermes-vps`.

Official tooling basis:

- OrbStack replacement and context guidance:
  <https://docs.orbstack.dev/install>
- OrbStack command-line start/stop guidance:
  <https://docs.orbstack.dev/headless>

## 2026-08-13 - Freeze the P7B private observability build contract

Block-ID: `EVO-P7B-OBSERVABILITY-CONTRACT-2026-08-13`

Detailed build contract: `docs/platform/p7b-observability-contract.md`.

This docs-only amendment resolves the P7B decisions that were intentionally
left open by the parent P7 plan. It authorizes no implementation until this
exact amendment is independently reviewed and merged. It changes no schema,
application, credential, provider, customer data, managed environment or
production state.

Accepted baseline:

- PR #157 merged the P7A status refresh and OrbStack-only local runtime policy
  as `e4d10b96d0ef4061fdb03ec85430cb65d86e39fd`;
- exact-main push CI run `31701995589` passed Main CRM, EVO Inbox and EVO Lead
  Agent; Changed range was skipped for the push event as expected;
- P7A is accepted and migrations remain contiguous `001-071`.

Frozen implementation boundary:

1. P7B executes as P7B1 service-only safe Platform signals plus private CRM
   routes and a pure alert evaluator, P7B2 Inbox WAHA `/health` alignment,
   logging/runbooks/edge hardening, then P7B3 real disposable OrbStack-backed
   acceptance. P7C waits for all three.
2. The feature is enabled only by exact server-side flag
   `EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=1`. CRM and Inbox use distinct
   32..128-byte runtime-random probe secrets.
3. Exact private `GET /api/readiness` and `GET /metrics` use path-bound,
   request-UUID/timestamp HMAC-SHA256. Disabled, malformed, stale, future,
   unsigned, wrong-signature, query-bearing, body-bearing and near-path
   requests return empty `404` before SQL/provider work. The public edge keeps
   readiness, metrics, internal and Lead Agent admin surfaces at `404`.
4. Expected next migration `072`, after a fresh ownership check, adds only
   service-role executable
   `platform.platform_operational_signals_v1(p_request_id uuid)`. It returns
   one global, bounded aggregate snapshot with fixed queue/review/media/
   autonomy/dependency/audit-probe fields and no tenant or raw identifiers.
   Counts clamp at 1,000,000, ages at 31,536,000 seconds, and saturation is
   explicit. Browser roles receive no RPC/private-table/PGMQ grant.
5. Dependency readiness requires recent `provider_observed` plus `ready`
   evidence. Missing, local-only, configuration-only, unverified, blocked or
   stale evidence cannot become green. The audit append check is a rolled-back
   transactional insert probe that creates no durable audit noise.
6. Database and Storage restore evidence remains visibly `missing` until P7C
   supplies reviewed real evidence. P7B does not create a fake evidence row or
   configured-equals-passed escape hatch.
7. The alert thresholds, exact two severities, four owner categories and nine
   runbook IDs are fixed in the detailed contract. They are operational
   escalation rules, not an SLO/SLA, capacity result or approved production
   tuning. Evaluation has no external delivery.
8. Prometheus text output is deterministic format 0.0.4 with `evo_platform_`
   metric names, seconds as the time unit and fixed low-cardinality labels
   only. Readiness JSON and structured logs use fixed safe codes and exclude
   tenant/user/case/message/phone/provider/object/credential/customer data.
9. Inbox uses documented WAHA `GET /health` semantics through private,
   separately signed access. Lead Agent frozen/readiness semantics remain
   unchanged. Local proof uses loopback stubs and synthetic data, never a real
   provider.
10. P7B acceptance requires Node/SQL/static gates plus the genuine repository
    disposable Supabase/Compose path under verified OrbStack context, a
    truthful signed CRM `503` while real-provider evidence is absent, safe
    controlled failures, public `404`, safe private metrics with readiness `0`
    and no external alert/provider/production mutation.

Official metric-format basis:

- Prometheus exposition formats:
  <https://prometheus.io/docs/instrumenting/exposition_formats/>
- Prometheus metric and label naming:
  <https://prometheus.io/docs/practices/naming/>

Merging this amendment proves only a reviewed plan boundary. It is not P7B
implementation, runtime, provider, managed-environment or production evidence.

## 2026-08-14 - Consolidate managed Supabase and freeze real P7C recovery

Decision Block-ID: `EVO-P7C-MANAGED-RECOVERY-2026-08-14`

Issue: #162

### Why this amendment exists

P7B is accepted on `main` at
`a6077ad6b7642deceead31dd11ed463548216d58`, migrations are contiguous through
`072`, and exact-main push CI run `31753423736` is green. The prior P7C wording
authorized only isolated local restore mechanics and explicitly withheld
managed/production claims. It no longer captures the owner-authorized provider
decision made on 2026-08-14 or the real topology discovered before execution.

The real EVO production Supabase source existed and was healthy, but it belonged
to a Free organization with no evidenced managed-backup list at the time of the
audit. A separate Pro organization already existed. The owner authorized moving
the exact EVO project into that Pro organization, retaining its project
reference and Singapore region, and renaming only its dashboard display name.

The provider transfer and rename are now completed facts:

- `evo-platform-prod` is the canonical project display name;
- its immutable project reference remains `iosckaqtovbbnssqcpde`;
- it belongs to `Isko's org` on Pro and reports healthy;
- the dashboard exposes a scheduled physical database backup;
- production applications continue using the unchanged project URL/keys;
- the repository is at migration `072`, while the managed application history
  reports migration `039`; no Platform promotion is claimed;
- the separate `inbox-prod` project is still active and cannot be treated as
  disposable. It showed real traffic and active users during the audit and a
  live application still references it.

### Superseding P7C decision

Replace the earlier synthetic/local-only P7C execution assumption with the
real managed recovery contract in
`docs/platform/p7c-managed-recovery-contract.md`.

1. P7C uses the real owned managed source, real encrypted exports and a newly
   created empty managed recovery destination. Local stacks, mocks, fake
   projects and synthetic records are not acceptance evidence.
2. Database and Storage recovery remain separate. The current real Storage
   inventory is empty, so empty-manifest verification is valid but non-empty
   byte-restore evidence stays visibly missing; no test object is fabricated.
3. The managed production migration gap `039 -> 072` is first analyzed and run
   against the recovered destination. It is not blindly applied to production.
4. `inbox-prod` retirement is a migration/cutover block, not an immediate cost
   cleanup. It requires an encrypted backup, domain mapping, real consumer
   cutover, rollback, 72 hours of zero legacy traffic and fresh owner
   confirmation immediately before permanent deletion.
5. Precise credentials, customer data, backup contents and unresolved
   infrastructure exposure remain private evidence and never enter GitHub.

### Cost decision

- Existing Pro subscription: approximately `$25/month`.
- Current transition with `inbox-prod` and `evo-platform-prod` active:
  approximately `$35/month` for a full cycle.
- Current partial-cycle provider projection immediately after transfer:
  `$26.36`, subject to the dashboard's documented one-hour refresh delay.
- Temporary Micro recovery project: approximately `$0.01344/hour`, or `$0.32`
  for 24 hours; no new subscription or optional add-on is authorized.
- Final expected steady state after safe legacy retirement:
  approximately `$25/month` with only `evo-platform-prod` active.

Spend Cap remains enabled, but compute is billed independently of Spend Cap.
The recovery project therefore has an explicit bounded lifetime and exact-target
cleanup gate.

### Scope and proof boundary

This amendment records the completed organization/name mutation and authorizes
planning plus reviewed P7C implementation PRs. It does not authorize immediate
`inbox-prod` deletion, production migrations `040-072`, production restore,
PITR, larger compute, public infrastructure changes, provider messages or
customer-data publication. Each such action retains its contract gate and any
required action-time approval.

## 2026-08-14 — P7C recovery drill deferred; separate Inbox SaaS retained

Plan Block-ID: `EVO-P7C-DEFER-RECOVERY-2026-08-14`

Change type: owner scope correction and execution-order change

### Decision

- The owner clarified that `inbox-prod` belongs to a separate owned Inbox SaaS
  product. It is not a legacy EVO Platform database. Remove its migration,
  pause, retirement and deletion from P7C scope; leave the project and its live
  consumers untouched.
- The canonical EVO Platform managed project remains `evo-platform-prod`.
- Defer the real managed database restore and separate Storage-object recovery
  drill until the Platform is functionally complete and concretely operating.
- Keep Supabase Pro scheduled database backups enabled during the deferral.
  Their presence does not satisfy restore acceptance, and database backups do
  not contain Storage object bytes.
- Do not create the temporary recovery project now. This avoids temporary
  compute spend until the drill is resumed.
- P7C remains incomplete and must be resumed before disaster recovery can be
  described as verified. On resumption, refresh the managed source,
  destination, credentials, Storage inventory, retention and cost evidence.

### Execution order

1. Continue with a separately reviewed P7D contract and obtain the approved
   capacity profile plus human accessibility inputs required by that phase.
2. Continue the remaining release/cutover work only under its own real-service
   evidence and production-authorization gates.
3. Resume P7C after functional Platform completion and concrete operation;
   perform the real isolated database restore and separate Storage-byte restore
   before claiming disaster-recovery readiness.

### Boundaries

- This amendment authorizes no production migration, restore, deletion,
  provider message, deployment or temporary billed project.
- `inbox-prod` is explicitly outside EVO Platform consolidation scope.
- Existing automatic backups are retained, but no restore-success claim is
  inherited from a dashboard backup indicator.

## 2026-08-14 — Add local Codex-driven EVO knowledge ingestion lane

Change type: plan amendment, local knowledge ingestion, privacy boundary, and
operator workflow.

Affected plan section: new independent
`EVO-KNOWLEDGE-INGESTION-LOCAL-2026-08-14` slice.

Reason: the owner supplied real Gmail, Chrome and Google Drive Takeout exports,
the existing Notion and WhatsApp archives, and two physically separated
Obsidian vaults. The source corpus is too large and sensitive for ad hoc manual
copying, but the owner does not want a separately billed LLM API integration.

Decision: implement a local deterministic preparation pipeline and use the
authenticated Codex app or `codex exec` only for bounded semantic review. Local
code owns hashing, extraction, exclusion, sensitive classification,
deduplication, checkpoints and manifests. Codex owns business interpretation,
authority resolution and Russian Obsidian writing. Drive and Gmail trash,
spam, sensitive applicant content, credentials and secrets are excluded from
semantic batches. Clear non-sensitive knowledge may be approved by an agent;
same-authority conflicts and material legal, price, guarantee, refund,
credential or personal-data decisions escalate to the owner or EVO director.

Delivery impact: K1 is docs-only and must merge before K2 implementation. K2
then ships deterministic preparation and real-corpus proof. K3 adds the Codex
operator command and publication, and K4 completes the accepted corpus.

Validation impact: each block requires focused tests, a real owner-supplied
source run where applicable, an idempotent second run, an independent exact-head
review, green exact-head CI, exact-base recheck and reviewed merge. No block may
claim production CRM, provider, or complete-corpus success from local evidence.

## 2026-08-14 — Decompose real lead-processing proof

Block-ID: `EVO-LEAD-PROCESSING-REAL-PROOF-PLAN-2026-08-14`.
Tracking issue: [#168](https://github.com/izzhackt/evo_AI_CRM/issues/168).

Change type: docs-only plan freshness, production-gap audit and approval-gated
real-provider validation sequence.

Affected plan section: `Lead-processing real-proof lane` in
`docs/EVO_LAUNCH_PLAN.md`.

Reason: P5A-P5F3 and P4R1 are merged with repository/CI evidence, but a
read-only production inspection found `/opt/evo-crm` still running revision
`564332b420a1fb1bd6232dda945d044bb922d3f0` with no Platform enablement flags.
No accepted evidence proves the real WhatsApp-to-audit chain. The launch plan
also cited an older `main` SHA and CI run after later P7C and knowledge-contract
documentation merged.

Decision: preserve all merged lanes disabled by default and split advancement
into L0 contract, L1 disabled deployment, L2 receive-only intake, L3 canonical
amoCRM-read context plus approved-knowledge retrieval, L4 Gemini proposal plus
handoff/takeover governance without send, and optional L5 one governed outbound
proof. Each external action requires separate action-time approval. The default
accepted milestone stops after L4. No block authorizes an amoCRM write.

Knowledge-lane boundary: this plan does not edit, duplicate or publish ingestion
artifacts. It consumes only a later versioned approved-knowledge interface and
stores retrieval evidence already owned by the Platform lane.

Research: WAHA's official event contract distinguishes inbound `message`, all-
creation `message.any`, `message.ack` and `session.status`; Kommo's official
entity contract keeps person/contact and sales-opportunity/lead identity linked
but distinct; Gemini's official structured-output contract constrains JSON
shape without replacing deterministic policy. The launch plan links the exact
official sources.

Validation impact: L0 requires Markdown/diff validation, independent exact-head
review, green exact-head CI and exact-base recheck. L1-L5 require new linked
issues and PRs, real service evidence, explicit rollback proof and a stop before
any unapproved externally visible action. Mocks and synthetic fixtures cannot
replace provider proof.

## 2026-08-14 - P7D focused accessibility; large capacity stress deferred

Plan Block-ID: `EVO-P7D-FOCUSED-ACCESSIBILITY-2026-08-14`

Issue: #167

Change type: owner scope reduction, evidence boundary and execution order

### Decision

- Defer the former 2,000-active-student, 100-concurrent-session stress test and
  temporary managed load-test project. Do not call capacity or DEC-010 passed.
- Use a small-launch monitoring envelope of at most 10 routine staff accounts,
  200 active students, normally 20 simultaneous users, approximately 1,000
  daily message records and 100 daily document uploads.
- Reopen formal capacity work before planned growth beyond any envelope value,
  a major campaign or compute/topology change, or when real monitoring shows
  readiness, connection, queue, error or latency pressure.
- Retain the existing automated accessibility suite as a repository regression
  gate. Run it on the exact real release candidate; do not treat fixture/local
  output alone as live-release or WCAG-conformance proof.
- The owner will perform one focused human review using macOS Chrome keyboard
  and zoom, macOS Safari plus VoiceOver, iPhone Safari and Android Chrome.
- Fix release-blocking workflow, keyboard, focus, screen-reader, mobile,
  security and privacy defects. Record lesser findings for later work.

### Execution order

1. Merge the separately reviewed P7D contract.
2. P8 may prepare the exact real release candidate needed for the automated and
   human accessibility evidence.
3. Run the retained automated gate and focused human matrix on that candidate.
4. Fix and recheck launch-blocking findings before a release decision.
5. Keep high-load capacity, P7C recovery and formal WCAG conformance explicitly
   deferred/unproved.

### Boundaries

- No temporary billed project, load against production, deployment, provider
  send/write, customer-data access or production mutation is authorized here.
- Merging the contract does not complete P7D. Exact-candidate automated and
  human evidence remain required.
- P8 preparation may start after this contract; production release still needs
  its real-service evidence and explicit action-time authorization.

## 2026-08-14 - Freeze the P8 controlled release candidate

Plan Block-ID: `EVO-P8-CONTROLLED-RELEASE-CANDIDATE-2026-08-14`

Issue: #175

Change type: release-candidate identity, evidence boundary and approval gates

### Decision

- Create one immutable candidate identified by exact Git/base commits,
  migration hashes, application image digests, safe deployment/configuration
  hashes and validation evidence.
- Split P8 into contract/baseline, deterministic manifest, non-mutating
  environment reconciliation, approval-gated disabled deployment,
  exact-candidate accessibility and real-service accounting.
- Use only `verified`, `blocked`, `deferred` and `not_applicable` for release
  evidence. A mock, fixture or local substitute cannot prove a real provider or
  production segment.
- Require fresh owner approval before every production/provider mutation.
  Preparing and inspecting a candidate is not permission to deploy it.
- Keep Lead Agent, the legacy webhook/session path and rollback path deployed.
  Keep P4B writes, autonomous send, P7C recovery, large-load capacity and formal
  WCAG conformance deferred/unproved.

### Execution order

1. Merge this P8A docs-only contract after independent exact-head review and
   green CI.
2. Implement P8B candidate manifest/evidence tooling in a separate block.
3. Run P8C read-only reconciliation against the real owned environments.
4. Ask for action-time approval before P8D deployment or managed migration.
5. Run P8E accessibility on the exact deployed candidate, then P8F accounting.
6. Run P10 directly after P8; P9 remains removed.
## 2026-08-14 - Implement the P8B deterministic candidate manifest

Plan Block-ID: `EVO-P8B-DETERMINISTIC-CANDIDATE-MANIFEST-2026-08-14`

Issue: #177

Change type: release-evidence implementation detail

### Decision

- Add one repository-owned command that accepts an exact candidate/base SHA,
  explicit timestamp and retained validation/build evidence, directly inspects
  the three exact candidate-tagged images in OrbStack, and writes deterministic JSON under the ignored
  `.evo-release-evidence/` directory.
- Require every first-party image to carry the candidate SHA in its OCI revision
  label, and retain hashed build logs plus the real `docker image inspect`
  result. Reject output or input evidence outside the repository evidence root.
- Require an exact successful Compose build marker for each candidate-tagged
  image and embed a closed, candidate/base-bound per-image build record in the
  image evidence. A pre-existing tag without its own retained build proof fails.
- Hash the contiguous `001-072` migration inventory and the reviewed Compose,
  Caddy and safe environment-example files. Treat any changed hash as a new
  candidate.
- Keep the manifest schema closed and keep the evidence index result vocabulary
  limited to `verified`, `blocked`, `deferred` and `not_applicable`.
- Reject duplicate JSON keys after escape decoding, and require the supplied
  base commit to exist as the candidate's exact Git parent and merge base.
- Reject symlinks in every existing evidence-path component and verify real
  input/output paths remain beneath the repository's real evidence root.
- Reject secret-like values, JWTs, email addresses and credential assignments
  from retained evidence before writing a manifest. Record only SHA-256 values
  for separately retained redacted validation output.
- Inventory required runtime setting names, ownership and example-file presence
  without recording values. Bind every validation record and retained log to
  both the exact base SHA and candidate SHA so old evidence cannot be reused.
- Use BuildKit's locked npm cache mount for both Node image dependency stages
  and suppress install-time funding/audit network work. `npm ci` remains the
  lockfile-enforcing clean install; the existing separate audit gate is unchanged.
- P8B does not read providers or production, deploy images, alter configuration,
  apply migrations or enable any Platform runtime flag. Those remain P8C/P8D.

## 2026-08-14 - Implement P8C non-mutating environment reconciliation

Plan Block-ID: `EVO-P8C-ENVIRONMENT-RECONCILIATION-2026-08-14`

Issue: #180

Change type: release-evidence implementation detail

### Decision

- Add a deterministic P8C report command and closed schema for the seven
  required real-environment segments: GitHub, Hermes, managed Supabase, WAHA,
  amoCRM, Gemini and rollback.
- Keep image provenance bound to P8B pull-request head
  `0505143657858e710acdd5029f1cc77c5524083e`; separately record squash-main
  `6ee93bd308aa478357279dd71511c7dc479b1f69` and require both commits to resolve
  to the identical tree `0563636057a19949a8927abc3ce02b32ba65896c`.
- Consume only separately retained, redacted, candidate-bound read-only
  evidence below `.evo-release-evidence/`; reject symlinks, hash drift,
  secret-like content, local substitutes for verified real checks, missing or
  extra segments and non-canonical timestamps.
- Derive the overall result mechanically: any blocked segment blocks the
  report; otherwise any deferred segment defers it; otherwise verified and
  not-applicable segments produce verified.
- Record current production drift truthfully. P8C does not deploy images,
  apply migrations, alter settings, restart services, send messages, write to
  amoCRM, call Gemini with customer content or create billed resources.
- Keep P8D behind a separate action-time owner approval after the P8C report
  and independent review are complete.

## 2026-08-15 - Persist owner decisions in the EVO knowledge pipeline

Plan Block-ID: `EVO-KNOWLEDGE-OWNER-DECISIONS-2026-08-15`

Change type: knowledge publication policy, source precedence and vault lifecycle

### Decision

- Add a closed, auditable owner-decisions manifest to the existing knowledge
  publication path. Decisions bind to the deterministic item identity already
  used in managed filenames; unknown identities, duplicate identities, unknown
  fields and invalid actions fail closed.
- Support only `approve` and `exclude`. `exclude` keeps the immutable raw source
  and provenance manifest but removes the managed derived note from every AI
  publication area. `approve` may override material-claim escalation only when
  the reviewed item and its source fingerprints still validate.
- Keep raw archives, source manifests and review JSON immutable. Owner decisions
  operate only on derived managed publication files and may not move or delete
  unmanaged Obsidian content.
- Resolve competing reviewed claims by the newest source `modified_at` recorded
  in the ingestion manifest when exactly one claim has the newest timestamp.
  Equal or missing timestamps remain unresolved. Generated-file mtimes never
  participate in precedence.
- Record the 2026-08-15 owner policy: exclude the complete current sensitive and
  individual-material queue; guarantee admission and visa for all countries and
  packages; if the promised outcome is not achieved, provide a free repeat
  application to another university or country; the client AI may state this
  directly. A replacement master contract remains a later owner-supplied input.
- Publish the newest real EVO China workbook (`Новая таблица(6).xlsx`, source
  modified 2026-01-16) as active internal working knowledge for intake 2026.
  Preserve CNY as the contractual/source amount and add an explicitly
  approximate USD equivalent. A later owner/director source supersedes it.
- Add USD equivalents beside source-currency prices using an explicit,
  reviewable rate table. Preserve the source amount and currency; never rewrite
  a contract amount or claim an approximate USD value is contractually binding.

### Acceptance criteria

- Re-publishing the same real review set does not recreate excluded identities.
- Approved owner decisions publish with approved status and retain exact source
  SHA-256 provenance.
- Corrupt/traversal/unknown decision manifests fail before any publication or
  deletion.
- Stale cleanup remains restricted to files in the prior managed publication
  manifest; raw and unmanaged files survive.
- Tests cover exclusion persistence, approval override, unknown identity,
  malformed schema, newest-source conflict resolution and tied timestamps.
- The real EVO vault is re-published, dashboard counts are regenerated, no
  sensitive queue item is present in AI-approved content, and a final audit
  reports managed counts and remaining decisions.

## 2026-08-15 - Freeze P8D disabled production deployment

Plan Block-ID: `EVO-P8D-DISABLED-PRODUCTION-DEPLOYMENT-2026-08-15`

Issue: #184

Change type: production release authority and execution contract

### Decision

- Accept the owner's 2026-08-15 “do all of it” instruction as action-time
  approval for P8D's disabled deployment only. It does not approve WhatsApp
  send, WAHA cutover, customer-content Gemini calls, amoCRM writes, autonomous
  send, DNS changes, billed resources, production restore or legacy retirement.
- Preserve P8B application provenance at commit `050514...`, tree `056363...`
  and the three recorded image IDs. Use current reviewed `main` only as the
  release-control source. The intervening P8C/CI commits changed no application
  source, Dockerfile, production Compose/Caddy file, migration or runtime
  example, so no rebuild or repeated P8C is justified.
- Deploy only the frozen CRM, Inbox and Lead Agent first-party images. Keep both
  WAHA containers, the edge Caddy container, DNS, sessions, webhooks and legacy
  ownership untouched.
- Freeze Lead Agent with worker, autoreply and outbound disabled; keep Platform
  ingress and all provider-write/autonomous paths disabled. This is a health and
  rollback release, not a live provider proof.
- Treat the already-verified managed migration ledger `001-072` as an expected
  no-op. Any drift stops P8D; do not repair or push migrations during this
  release.
- Require pre-state capture, immutable image transfer/verification, rollback
  rendering, one-service-at-a-time recreation, disabled-mode health checks and
  redacted evidence under the exact contract in
  `docs/platform/p8d-disabled-deployment.md`.
- Allow a maximum 120-minute action window beginning at the recorded UTC start
  after this plan merges and exact-main CI is green. Stop or roll back on expiry
  or any frozen-identity, topology, health, security, privacy or rollback drift.

## 2026-08-15 - Authorize exact P8D Lead Agent safety correction

Plan Block-ID: `EVO-P8D-LEAD-AGENT-SAFETY-FLAG-CORRECTION-2026-08-15`

Issue: #186

Change type: fail-closed production preflight amendment

### Decision

- Record that the first P8D preflight stopped before production mutation after
  finding one exact non-secret conflict in `/opt/evo-crm/.env.lead-agent`:
  `EVO_AGENT_AUTOREPLY_ENABLED=true`. The existing Compose override and running
  container remain `false`; no message or provider call occurred.
- Authorize only an atomic correction of that one file assignment from `true`
  to `false`, after a root-only mode-`0600` rollback copy outside all evidence
  directories and before/after SHA-256 recording. Preserve root ownership and
  mode `0600`; redacted evidence retains only an opaque backup identifier,
  success state and hashes, never file contents. Delete the rollback copy after
  final success or successful rollback; retain it root-only only while a failed
  rollback is escalated.
- Require exactly one active assignment before and after the correction, then
  require Compose rendering and the recreated container to resolve the value to
  `false`.
- Keep every other P8D identity, disabled-setting value, stop condition,
  provider prohibition, rollback rule and the original 120-minute window
  unchanged. Any additional conflict requires another reviewed decision.
- Record the second pre-mutation finding: both distinct private-readiness HMAC
  settings are absent. Authorize process-only generation on Hermes of exactly
  two distinct 32-byte random values, stored only under their exact owned names
  in the CRM and Inbox mode-`0600` env files through atomic same-directory
  replacement and root-only rollback copies outside evidence.
- Never print, transmit, reuse or place either secret or its hash in evidence.
  Redacted proof is limited to presence, 64-character length, distinctness,
  update status and the env-file before/after hashes. The rollback-copy
  lifecycle matches the Lead Agent safety correction.

## 2026-08-15 - Replace the architecture-mismatched P8B images

Plan Block-ID: `EVO-P8B2-LINUX-AMD64-CANDIDATE-2026-08-15`

Issue: #188

Change type: release-candidate identity, image provenance and execution order

### Decision

- Record the fail-closed first P8D attempt: the retained P8B images were
  `linux/arm64`, while Hermes is `linux/amd64`. Lead Agent failed with an
  executable-format error and was immediately restored to its prior healthy
  image. CRM and Inbox were never recreated; environment files were restored;
  no provider/customer/DNS/Supabase mutation occurred.
- Treat operating system, architecture and variant as mandatory immutable image
  identity. Never retag or relabel the ARM64 evidence as AMD64 evidence.
- Freeze a new P8B2 candidate from the same reviewed application source commit
  `0505143657858e710acdd5029f1cc77c5524083e` and tree
  `0563636057a19949a8927abc3ce02b32ba65896c`, targeting exact
  `linux/amd64` through OrbStack Buildx.
- Extend the closed manifest/tooling before construction, use distinct
  `-linux-amd64` tags, inspect architecture and OCI revision both locally and
  on Hermes, and require real disabled-provider smoke checks.
- Retain one mode-`0600` SPDX-JSON SBOM per exact image, generated locally by
  `docker sbom`, bound by image ID/tool version/SHA-256 and screened before it
  enters the safe evidence index. Uploading SBOMs or images is not authorized.
- Run each real image with network mode `none` and the exact closed disabled
  settings, then execute only its dependency-free loopback liveness route from
  inside the container. This proves process/architecture compatibility without
  a mock dependency or any provider/customer call; it is not readiness proof.
- Redo deterministic candidate evidence, P8C reconciliation, independent
  review and exact-head/exact-main CI before a fresh action-time P8D window.
- Preserve every P8D safety boundary: no WAHA/Caddy/DNS/session/QR mutation,
  message send, customer-content Gemini call, amoCRM write, autonomous send,
  Supabase write, customer-data inspection or billed resource.

The detailed executable contract is
`docs/platform/p8b2-amd64-candidate.md`. Merging this amendment authorizes no
production restart by itself.

## 2026-08-15 - Finalize the Obsidian knowledge bases for first AI use

Plan Block-ID: `EVO-KNOWLEDGE-LAUNCH-FINALIZE-2026-08-15`

Change type: owner scope decision, local knowledge publication and readiness
criteria.

Reason: the owner wants the already collected Notion, Drive, documents and
WhatsApp text to become a practical first knowledge release. Semantic processing
of the preserved 2,589-message Gmail MBOX and retries for 386 main-account plus
10 China-curator WhatsApp media failures are explicitly deferred until later
improvement and must not block first use.

Decision: extend the local ingestion lane with a client-vault publication and
two-vault retrieval-validation block. Client publication is explicit-allowlist
only and rejects unresolved, sensitive, personal, secret or internal-only
material. Mutable university, programme, intake, deadline, visa and price facts
require a dated official source; stable owner-approved EVO policies may cite
the recorded owner decision. Preserve unmanaged Obsidian content and raw source
boundaries. Resolve the remaining human review notes without analyzing Gmail or
retrying WhatsApp downloads. Validate against the real EVO vault files and
report only artifact/retrieval readiness, not a live LLM, production deployment
or provider success.

Review amendment: the client root is bound by a closed non-symlink
`.evo-vault.json` marker with kind `evo_client_knowledge` and its exact resolved
canonical path. The version-1 allowlist `.Публикация клиентской базы.json`
binds every approved internal relative path and SHA to one Russian destination
plus a closed authority/provenance form: either owner decision/reference with
null official fields, or official HTTPS URL/date/reference. Managed outputs are
tracked in `.Манифест клиентской публикации.json`; all inputs validate before
mutation and stale cleanup touches only still-marked prior managed files.

Retrieval is fixed at `scripts/knowledge_ingestion/check_retrieval.py` with
committed versioned cases in `scripts/knowledge_ingestion/retrieval_cases.json`
and a machine-readable real-vault report in `Панель управления/Отчёт проверки
поиска.json`. Each Russian case names the vault, top-k and exact expected paths;
all cases and explicit raw/secrets forbidden-root assertions must pass.

Review amendment 2: keyword matching is not an authority boundary. Add required
closed allowlist fields `content_class` (`stable_evo_policy` or
`mutable_official_fact`) and `personal_data_reviewed: true`. Stable policy is
owner-decision-only; mutable facts are official-source-only. Reuse the ingestion
email/phone detectors as an unconditional publication rejection. Bind the
approved source to the exact non-symlink approved child of the marked internal
root, validate raw path components before resolve, and require exact typed
authority-reference frontmatter. Resolve and read every managed stale candidate
before the first output write so all input failures preserve zero mutation.

## 2026-08-15 - Build the Lead Agent real-message golden evaluation lane

Plan Block-ID: `EVO-LEAD-AGENT-REAL-WHATSAPP-GOLDEN-EVAL-2026-08-15`

Issue: #194

Change type: evaluation, prompt-governance and privacy contract

### Decision

- Treat the current Lead Agent prompts as safety/qualification baselines, not
  proof of human-quality consultative selling. No prompt is sales-ready until
  it passes an owner-approved real-message golden evaluation and controlled
  real-provider draft proof.
- Derive the first Top-50 intent inventory only from the protected EVO WhatsApp
  archive. Eligible source rows are real inbound, non-group, non-system text
  messages. Exclude staff-authored, media-only, empty, system, status and
  obvious non-lead noise before analysis.
- Keep raw messages, chat/message/provider identifiers, phone numbers, names,
  email addresses, media and surrounding personal context outside Git with
  owner-only permissions. Committed cases contain generalized questions,
  aggregate counts and non-reversible source-set hashes only; never verbatim
  customer excerpts or one-customer provenance.
- Separate dataset discovery from answer authoring. Block A produces draft
  intent/question candidates and frequency evidence. Block B requires explicit
  owner approval of each desired answer, allowed knowledge sources,
  qualification goal, CTA, forbidden claims and handoff conditions. A draft
  case is never a golden answer.
- Evaluate factual grounding, source use, privacy, language, natural WhatsApp
  tone, discovery quality, value communication, objection handling, one useful
  next step, non-manipulation and correct handoff as separate dimensions. A
  high aggregate score cannot hide a factual, privacy, guarantee or handoff
  failure.
- Version prompts and datasets independently. Compare the existing baseline
  with a candidate prompt on the same sealed approved cases; do not tune on the
  held-out acceptance split or expose desired answers to the response runner.
- This lane performs no WhatsApp send, provider/customer-data request, amoCRM
  write, knowledge-vault mutation, deployment or runtime-flag activation. The
  active knowledge-publication and linux/amd64 release lanes retain ownership
  of their files and production actions.

### Delivery blocks

1. Add deterministic privacy-preserving extraction and Top-50 candidate
   generation with private evidence from the real archive.
2. Review and approve desired answers and per-case rubrics with the EVO owner.
3. Implement the versioned consultative-sales prompt and blind baseline versus
   candidate evaluation harness.
4. Run an explicitly authorized real Gemini draft evaluation, followed later
   by a separately authorized controlled production-conversation proof.

## 2026-08-15 - Stage the exact P8B2 Linux/AMD64 candidate on Hermes without restart

Plan Block-ID: `EVO-P8D2-LINUX-AMD64-HERMES-STAGING-2026-08-15`

Change type: owner-authorized production-host staging contract; no running
service or provider mutation.

Reason: P8B2 produced three real Linux/AMD64 images from the frozen P8B
application tree, and P8C2 bound their retained manifest/evidence/SBOM/smoke
artifacts. The prior P8D directory contains the failed ARM64 attempt and cannot
be reused. The owner approved staging at `2026-08-15T13:26:01Z`, but did not
authorize container recreation or provider actions.

Decision:

- Freeze the exact image IDs and manifest/evidence/report hashes in
  `docs/platform/p8d2-amd64-staging.md` under issue #202.
- Use OrbStack only for local `docker image save --platform=linux/amd64` and
  verify full IDs/platform/revision before transfer.
- On Hermes, create a new non-colliding root-only release, evidence and rollback
  identity named `2026-08-15.p8d2.1`; never overwrite the retained ARM64
  `2026-08-15.p8d.1` attempt.
- Freeze the exact three image tags and archive filenames, the single retained
  local P8C2 evidence root and its explicit 31-file transfer allowlist, and the
  exact three-file production env rollback matrix. Use no globs or recursive
  copy; validate every source and destination type, owner, mode, collision and
  hash without printing secret bytes.
- Capture the three current application image archives and exact production env
  files into the segregated root-only rollback directory before loading the
  candidate. Evidence records only hashes and safe status/identity fields.
- Transfer and hash-verify candidate archives and the self-contained evidence,
  then load only exact Linux/AMD64 images whose tags are absent. Do not retag,
  substitute, recreate, restart, stop, pause, or signal a running container.
- Re-prove all running app and WAHA containers use their original image IDs,
  remain healthy, retain restart count zero and keep original start timestamps.
- No WAHA/Caddy/DNS/session/QR mutation, WhatsApp send, Gemini content call,
  amoCRM access, Supabase write, customer-data inspection, billed resource,
  Docker prune or unrelated cleanup is authorized.
- After staging, rerun read-only P8C2. Deployment requires a separate fresh
  owner window and an updated exact AMD64 deployment contract.

Proof and stop boundary:

- Independent exact-head review, green exact-head CI, stable base and green
  exact-main CI are mandatory before staging begins.
- Identity/hash/mode/ownership/health/capacity/topology drift, destination
  collision, fewer than 20 GiB conservative remaining disk, or any need to
  touch a running service stops the block.
- A partially created staging bundle is retained root-only with a redacted
  failure code and is never silently deleted, repaired or reused.

## 2026-08-15 - Author owner-review answers for the real WhatsApp Top-50

Plan Block-ID: `EVO-LEAD-AGENT-GOLDEN-ANSWER-DRAFTS-2026-08-15`

Issue: #194

Change type: evaluation-content and sales-governance contract

### Decision

- Add one owner-review worksheet entry for every committed real-WhatsApp
  Top-50 intent. Each entry defines the response goal, recommended draft,
  mandatory discovery questions and staff-handoff conditions.
- Ground stable EVO claims in the approved client knowledge base. Treat
  university, program, price, deadline, visa, work-right and recognition facts
  as time-sensitive: the draft must request the missing profile and require
  current approved knowledge or staff verification instead of inventing an
  answer.
- Use a consultative pattern: answer the immediate concern first, explain the
  value of the next question, ask only the minimum useful questions and offer
  one natural next step. Do not use pressure, artificial scarcity, guaranteed
  outcomes or unsupported social proof.
- Keep every answer at `owner_review_required`. This block does not promote the
  worksheet to a golden acceptance set, change a runtime prompt, call a model,
  expose customer data, send WhatsApp messages, mutate amoCRM/Supabase or
  modify either knowledge-base workspace.

### Acceptance gates

1. Exactly the 50 ranked intents exist once each and every entry has all four
   required review fields.
2. Automated checks reject phone/email/URL leakage, unconditional visa or
   admission guarantees, and unreviewed numeric price/deadline claims.
3. The EVO owner edits and explicitly approves the desired answers before they
   become sealed golden cases or are used to score a consultative-sales prompt.

## 2026-08-15 - Connect approved Obsidian knowledge to EVO Inbox

Plan Block-ID: `EVO-PLATFORM-KNOWLEDGE-K1-2026-08-15`

Change type: owner-authorized architecture and production integration contract.

Reason: the owner selected the recommended operating model: Codex maintains and
reviews the local Obsidian workspace, while the production EVO Inbox on Hermes
uses the approved knowledge at runtime and the existing account Gemini provider
to create staff-reviewed drafts. The current production account has an active
Gemini configuration and two legacy knowledge documents, but the schema has no
client/internal audience boundary and production runs an older image. Copying
vault files into a container would be non-durable and unsafe.

Decision: add `/goal-evo-platform-knowledge` to `docs/EVO_LAUNCH_PLAN.md` and
deliver it through `K1` plan, `K2` audience isolation, `K3` deterministic
Obsidian bundle/import, `K4` protected internal assistant, and `K5` reviewed
production deployment/evaluation. Existing unclassified documents migrate to
`internal`; client drafts explicitly retrieve `client`; internal drafts are
staff-authenticated and cannot send WhatsApp. Only the exact client vault and
the internal approved subtree may enter runtime storage. Raw archives, secrets,
correspondence and applicant material stay excluded.

Research basis: Gemini requires authenticated provider calls and structured
outputs still require application-side semantic validation; Supabase recommends
account-filtered Postgres full-text/vector search with explicit indexed filters.
The existing EVO Inbox already implements encrypted account-level Gemini,
knowledge chunking and operator-reviewed drafts, so this block extends that
system rather than creating a parallel agent or new provider.

- Gemini API authentication and generation:
  <https://ai.google.dev/api>
- Gemini structured-output validation boundary:
  <https://ai.google.dev/gemini-api/docs/generate-content/structured-output>
- Supabase hybrid keyword/vector search:
  <https://supabase.com/docs/guides/ai/hybrid-search>

Scope of this PR: documentation only. It authorizes no migration, Supabase
write, Gemini call, image build, deployment, container restart, WAHA change or
WhatsApp send. Each later block requires its own exact-head review and green CI.

Review amendment: close the implementation choices identified at the K1 gate.
K3 precomputes all chunks/embeddings and uses one service-role-only transactional
Postgres sync RPC with an account/audience advisory transaction lock; it never
uses the existing partial `ingestDocument()` sequence. The database and routes
use the existing `agent` minimum for staff retrieval, `admin` for manual CRUD,
hard-coded audiences per route, RLS-bound authenticated retrieval RPCs and a
service-role-only sync RPC. Bundles, manifests, path identity, canonical JSON,
managed/manual nullability and hash binding now have closed version-1 forms.
Client PII rejection reuses the existing `contains_email()`/`contains_phone()`
validators and fails the whole bundle on invalid UTF-8 or a match. K5 uses two
fixed synthetic Russian cases, immutable body-free audit rows and a redacted
closed evidence report; it does not inspect a customer conversation or invoke a
send endpoint. The timestamped preflight evidence for the production claims is
`docs/evidence/evo-platform-knowledge-k1-production-preflight.json`.

Review amendment 2: remove the clock from hashed bundle identity and require
same-input byte determinism. Close the RPC JSONB document/chunk/result schemas,
1,536-value embedding contract, document/chunk identities and exact advisory
lock expression. Both internal and client bundles now fail on the same existing
email/phone validators and invalid UTF-8. Close the client playground and new
internal-assistant request/response/error forms, the immutable body-free
`ai_assistant_audits` schema/RLS/90-day purge behavior, and compatibility with
the existing conversation audit. Bundle delivery is exact-file SCP over the
existing SSH boundary into root-only collision-free host/container staging,
verified at each boundary and removed from local/host/container on every exit;
only the redacted operational report persists.

## 2026-08-15 - Bind portable AMD64 manifests before another Hermes staging attempt

Plan Block-ID: `EVO-P8B3-PORTABLE-IMAGE-IDENTITY-2026-08-15`

Change type: evidence/tooling correction; local real-image execution only.

Reason: P8D2 proved that P8B2 recorded the OCI index digest while platform-
selected Docker save/load transports the referenced AMD64 manifest. The exact
archive bytes were valid, but comparing different OCI graph levels stopped
staging correctly.

Decision:

- Preserve P8B2 and P8D2 evidence as immutable history; never relabel their
  digests or reuse release `2026-08-15.p8d2.1`.
- Add a closed P8B3 generator/schema that binds index and AMD64 manifest
  digests and verifies raw manifest, config, ordered layers and archive bytes.
- Run it only on OrbStack against the real retained P8B2 images and prove the
  archives load to the recorded platform-manifest identities without providers
  or customer data.
- Retain a mode-`0700` ignored evidence root with mode-`0600` files and bind its
  collection-index hash in the PR body.
- P8B3 authorizes no Hermes/provider/DNS/WAHA/Supabase/container mutation. A new
  P8D3 contract, directories and fresh owner approval are required for retry.

Proof and stop boundary:

- Reject archive path escape, unsafe tar entries, missing/extra descriptors,
  platform/tag/revision/source drift, digest/size mismatch, bad mode/symlink,
  extra evidence files or unavailable real images.
- Require focused gates, real OrbStack generation/load proof, independent
  exact-head review, four green PR jobs and green exact-main CI.

## 2026-08-15 - Enforce client and internal knowledge audiences

Plan Block-ID: `EVO-PLATFORM-KNOWLEDGE-K2-2026-08-15`

Change type: authorized database and retrieval isolation implementation.

Decision: implement only K2 from `/goal-evo-platform-knowledge`. Migration 073
adds required `client`/`internal` audience checks to knowledge documents and
chunks, classifies every existing row as `internal`, replaces the retrieval RPCs
with audience-required SECURITY INVOKER forms, and narrows table RLS/object
grants to account members at `agent` or higher while retaining admin mutation.
Chunk ingestion receives an explicit audience and writes it on every chunk.
The client draft and playground hard-code `client`. Existing manual knowledge
CRUD/reindex becomes admin-only, hard-codes `internal`, and cannot read or mutate
client rows. No request body may choose an audience.

Named write set: `supabase/migrations/073_ai_knowledge_audience_isolation.sql`,
`agent-lead2-inbox/src/lib/ai/knowledge.ts`, the existing AI draft/playground/
knowledge route files and their focused tests, Supabase authorization/schema
tests, `docs/EVO_LAUNCH_PLAN.md`, and this log. K2 does not implement the sync
RPC, bundle tooling, internal assistant, provider call, production migration or
deployment. Real validation is the focused Inbox test set plus the repository's
local Supabase authorization/schema gates on OrbStack, lint, typecheck and build.

Validation amendment: because K2 adds canonical migration `073`, advance the
deterministic P8 candidate migration inventory from contiguous `001-072` to
contiguous `001-073` and update its focused contract test. Historical P8
evidence remains unchanged; this amendment only makes future candidate
generation bind the current complete migration set.

## 2026-08-15 - Resume portable AMD64 staging from the verified P8D2 checkpoint

Plan Block-ID: `EVO-P8D3-PORTABLE-AMD64-HERMES-STAGING-2026-08-15`

Issue: #209

Change type: production staging contract; no running-service change.

Decision:

- Use P8B3 portable manifest digests, not their parent OCI-index digests, as
  the expected IDs after cross-daemon `docker image load`.
- Preserve P8D2 as failed-safe history. Reuse its real transfer/load checkpoint
  only after exact archive hashes, tag/manifest/platform/revision and current
  running-service state are freshly verified.
- Create a new collision-free `2026-08-15.p8d3.1` release, evidence and rollback
  boundary. Capture the same closed three-application rollback and environment
  matrix before staging evidence.
- Do not repeat a valid image transfer/load. Copy only hash-proven archive
  bytes into the new release root and transfer the two closed P8B3 JSON files.
- Bind completion to a closed P8D3 result schema and atomic mode-`0600`
  evidence writes. Do not rerun P8C2 because its provider/credential checks
  remain outside staging authority; retain its truthful blocked result.
- Require all CRM, Lead Agent, Inbox and both WAHA containers to retain exact
  image IDs, health, zero restart counts and start timestamps.
- No deploy/recreate/restart, provider access, customer data, WAHA/session/
  webhook/QR mutation, message send, Gemini content call, amoCRM access,
  Supabase write, DNS, billed resource, prune or unrelated cleanup is allowed.

The executable contract is `docs/platform/p8d3-portable-amd64-staging.md`.
Application activation remains a later separately approved block.

## 2026-08-15 - Build deterministic Obsidian bundles and atomic runtime sync

Plan Block-ID: `EVO-PLATFORM-KNOWLEDGE-K3-2026-08-15`

Change type: authorized local bundle and server-side import implementation.

Decision: implement K3 from `/goal-evo-platform-knowledge` without production
execution. Add canonical fail-closed bundle construction for the exact marked
client vault and exact internal approved child; reject PII, hidden/control/raw/
secret content, invalid UTF-8 and symlink traversal. Add migration `074` with
managed-source metadata, bundle revision evidence and the closed service-role-
only transactional sync RPC. Add an EVO Inbox CLI that validates bundle and
manifest, precomputes every deterministic chunk and real embedding, then makes
one RPC call; it never uses the partial legacy ingestion sequence.

Named write set: migration `074`, knowledge-ingestion builder/tests/README,
EVO Inbox importer and focused tests/scripts, Supabase schema/authorization
tests, P8 migration inventory, and this plan log. No bundle transfer, managed
Supabase write, provider call, VPS mutation, deployment, WAHA change or
WhatsApp send is authorized in K3.

Validation amendment: migration `074` advances the deterministic P8 candidate
migration inventory from contiguous `001-073` to contiguous `001-074` without
changing historical evidence. The sync RPC uses PostgreSQL's built-in
`sha256(bytea)` rather than enabling `pgcrypto`, so it does not expand the
authenticated function surface. The real authorization gate exercises the
exact service-role-only signature and commits a 1,536-dimensional managed
document through the RPC.

Review amendment: reject symlinks in every raw CLI ancestor before resolving
the vault, reject visible non-Markdown files and unreadable traversal rather
than silently omitting them, and assert zero output for every failed local
build. The final PostgreSQL boundary now independently rejects non-NFC and
raw/secrets path components; real service-role regression calls prove both are
rolled back with no managed row.

## 2026-08-15 - Add audience-safe AI assistants and immutable audits

Plan Block-ID: `EVO-PLATFORM-KNOWLEDGE-K4-2026-08-15`

Change type: authorized assistant API and audit implementation.

Decision: implement K4 from `/goal-evo-platform-knowledge`. Keep the existing
staff playground strictly `client`, add a staff-only `internal` assistant, and
return normalized chunk/source identities with every draft. Add migration `075`
for body-free immutable 90-day `ai_assistant_audits`, agent-scoped read RLS,
service-role-only insert and expiry purge. Both routes validate closed request
and response shapes, generate drafts only, never call WAHA, and fail rather than
returning a generation whose audit insert did not commit.

Named write set: migration `075`, assistant retrieval/audit helpers, playground
and internal-assistant routes/tests, Supabase schema/authorization tests, P8
migration inventory, and this log. K4 performs no provider acceptance call,
bundle transfer, production migration/deploy, auto-reply enablement or send;
those remain K5.

Validation amendment: migration `075` advances the deterministic P8 candidate
inventory from contiguous `001-074` to `001-075`. The real PostgreSQL suite
must prove same-account agent read, authenticated insert denial, source
account/audience/path binding, immutable update, pre-expiry delete denial and
service-only deletion of exactly the expired 90-day audit.

Review amendment: ranked chunks without an exact managed `source_path` are
removed from excerpts, chunk ids and source identities together before prompt
construction. Mixed managed/manual retrieval can no longer expose an untracked
manual excerpt to the model while recording only the managed source.

## 2026-08-15 - Replace fixed golden answers with supervised sales learning

Plan Block-ID: `EVO-LEAD-AGENT-SUPERVISED-SALES-PROMPT-2026-08-15`

Issue: #194

Change type: prompt policy, conversation-memory and evaluation contract

### Decision

- Retire the Top-50 fixed-answer worksheet. Keep the real generalized intents
  as coverage cases, but grade behavior against a common rubric instead of
  comparing wording with one context-free answer.
- Add a versioned consultative-sales system prompt. It must answer first,
  personalize from canonical memory, ask only the smallest useful next
  question, move the conversation toward a helpful next step without pressure,
  and preserve all knowledge, guarantee, privacy and handoff boundaries.
- Treat the standard intake fields (name, age, English level, current
  education and countries under consideration) as known only when the client
  actually supplied them. Never ask a known field again unless it is missing,
  ambiguous, contradicted or changed.
- Run an initial supervised-learning period in draft/shadow mode. A designated
  EVO employee reviews every draft and the existing Platform draft record keeps
  generated text, reviewed text, reviewer, time and review reason. These edits
  are training candidates, not automatic instructions.
- Promote recurring, owner-approved lessons only through a new versioned prompt
  or curated few-shot set, held-out evaluation, independent review and CI. Do
  not fine-tune or alter runtime behavior directly from one employee edit.
- This block changes repository prompt/evaluation artifacts only. It does not
  edit either knowledge base, enable autonomous replies, send WhatsApp, call a
  provider, write amoCRM/Supabase, deploy or mutate production.

## 2026-08-15 - Deploy current-main staff-only knowledge pilot

Plan Block-ID: `EVO-PLATFORM-P8D4-STAFF-PILOT-2026-08-15`

Change type: production release and bounded real-provider acceptance contract.

Decision: execute issue #213 only through
`docs/platform/p8d4-current-main-staff-pilot.md`. Freeze application source at
current main `7c2e03cdbfbb54b85c4eef5454c31bb846c3c38a`, tree
`d9b170396364a8dcf0efcd28779fc416c8c2f65e`, parent K4
`472cc58115b7e6a459d089fd082081fa8da15610`, contiguous migrations `001-075`
and exact-main run `31900296274`. This includes PR #216's supervised
consultative sales policy in the Lead Agent candidate. Build new real OrbStack `linux/amd64` images;
never deploy or relabel the pre-knowledge P8B3 candidate. Apply only missing
forward migrations, publish each approved knowledge audience through its own
atomic/idempotent sync, recreate Inbox/CRM/Lead Agent one boundary at a time,
and prove the two K4 staff-owned evaluation cases through real production
retrieval and Gemini. Automatic reply and every WhatsApp/amoCRM/WAHA/DNS
mutation remain excluded.

Failure amendment: a completed audience sync is a safe approved partial state
if the other audience fails; application deployment cannot begin until both
exact revisions verify. Any application failure rolls back every already
deployed P8D4 application boundary in reverse. Migrations are additive and
forward-only; retained old images must first pass compatibility against schema
001-075, and migration history is never reversed or repaired.

Validation impact: require independent review and exact-head/main CI for this
contract; then real OrbStack build/SBOM/smoke/archive evidence, read-only Hermes
preflight, managed Supabase dry-run/ledger proof, deterministic real-vault
bundles, bounded real embedding calls, exact retrieval cases, two real Gemini
drafts, body-free audit verification and a closed redacted result. Stop before
the first real WhatsApp/customer lead test, which remains a separately approved
block.

## 2026-08-16 - Unify intake memory with consultative Platform drafts

Plan Block-ID: `EVO-PLATFORM-AI-INTAKE-MEMORY-PROMPT-V2-2026-08-16`

Issue: #217

Change type: additive Platform memory schema and draft-only prompt integration

Decision:

- Extend the existing Supabase-native Platform memory instead of creating
  per-client files, a second database or a legacy SQLite bridge. Add the four
  missing intake facts: age, English level, current education and countries
  considered. Contact name continues to come from canonical read-only amoCRM
  context and is not duplicated as model-authored memory.
- Keep every fact conversation-scoped, versioned, source-message-bound and
  staff-reviewable. Gemini may propose a change but cannot commit it; no staff
  edit or model output automatically changes future behavior.
- Upgrade the Platform Gemini proposal prompt from qualification-only v1 to the
  consultative-sales v2 policy: answer first, use known context, never re-ask a
  known intake field, ask at most two material questions, provide one natural
  next step and preserve grounding, privacy and handoff gates.
- Reuse the existing closed context package: latest inbound trigger, 12 recent
  messages, short/long memory summaries, allowlisted facts, qualification,
  control state, approved retrieval evidence and read-only amoCRM context.
- Add migration `076` and advance only the future candidate migration inventory
  to contiguous `001-076`. Do not alter P8D4's frozen exact-SHA `001-075`
  production contract or claim that migration `076` is deployed.
- This block performs no provider call, embedding call, production migration,
  deployment, WhatsApp send, WAHA mutation, amoCRM write, autonomous-reply
  enablement or knowledge-base edit.

Research basis:

- Gemini prompt guidance requires explicit system behavior, relevant context
  and iterative evaluation:
  https://ai.google.dev/gemini-api/docs/prompting-strategies
- Gemini embeddings are retrieval representations, not durable client memory;
  the application remains responsible for storing facts and vectors:
  https://ai.google.dev/gemini-api/docs/embeddings

## 2026-08-16 - Refresh P8D4 to the unified memory and knowledge candidate

Plan Block-ID: `EVO-PLATFORM-P8D4-UNIFIED-CANDIDATE-2026-08-16`

Issue: #219

Change type: release-candidate identity and production execution-order
amendment; no production mutation in this block.

Reason: the historical P8D4 contract correctly froze pre-076 source
`7c2e03cdbfbb54b85c4eef5454c31bb846c3c38a`. PR #218 subsequently merged the
reviewed draft-only Platform memory and consultative-sales proposal pipeline as
current main. Deploying the older candidate first would create an obsolete
double deployment and would not verify the final combined employee workflow.

Decision:

- Supersede the unexecuted P8D4 candidate identity for future execution only;
  preserve the historical decision and its evidence. The refreshed source is
  exact main `d5657acc6c1df1abc790a96778ca71df36687b24`, tree
  `9dfe44fd1c477a9a4af823ba2a37bdb398878919`, parent
  `a05e22b42e31b441ebc5f2274deddab4f3022317`, exact-main CI run
  `31902903078`, and contiguous migrations `001-076`.
- Rebuild all three first-party `linux/amd64` images from this one source so the
  first production promotion still moves CRM, EVO Inbox and Lead Agent from
  their older deployed versions to one coherent release. PR #218 itself changes
  the CRM/Platform application and migration 076; it adds no Inbox runtime,
  Python Lead Agent, environment-variable, API-key or secret change relative
  to the prior unexecuted P8D4 candidate.
- Apply only the exact missing forward suffix through migration 076. Migration
  history is never repaired, reset or rolled back. Migration 076 remains
  unapplied until the separately reviewed execution reaches its managed-
  Supabase phase.
- Publish the exact approved client and internal knowledge bundles only after
  the migration ledger and candidate identities verify. Then exercise the two
  frozen staff-owned real Gemini draft cases against the combined amoCRM
  context, durable Platform memory, approved retrieval evidence and
  consultative-sales prompt.
- Keep autonomous replies, WhatsApp sends, WAHA/session/webhook mutation,
  amoCRM writes, DNS changes and customer-content provider calls disabled.
  Gemini may produce drafts and memory proposals but cannot send messages or
  commit memory.
- Advance the closed P8D4 result schema, behavioral test, collision-free
  release/evidence roots and exact commands to the refreshed identities. Old
  candidate evidence must fail the refreshed schema.

Execution gate:

- This amendment PR performs no production, provider or customer-data action.
- Before production, require independent exact-head approval, all required PR
  checks green, merge, exact-main green CI, a fresh read-only Hermes/managed-
  Supabase preflight, real OrbStack builds, rollback proof and the existing
  P8D4 action-time authority.

## 2026-08-16 - Bind P8D4 portable archives to the unified candidate

Plan Block-ID: `EVO-PLATFORM-P8D4A-PORTABLE-D565-2026-08-16`

GitHub issue: `#221`

Status: implementation authorized; no Hermes, Supabase, provider, DNS, WAHA or
production mutation in this block

Reason: the real OrbStack build, SPDX/privacy scan and network-none smoke gates
for the unified `d5657acc6c1df1abc790a96778ca71df36687b24` candidate succeeded,
but the historical P8B3 archive generator is intentionally frozen to candidate
`0505143657858e710acdd5029f1cc77c5524083e`. Reusing it unchanged would either
fail or falsely attest the old identities; a manual `docker image save` would
bypass the reviewed OCI graph checks.

Decision:

- Preserve the historical P8B3 CLI defaults, schema and retained evidence.
- Parameterize only the shared verifier with an explicit candidate/spec matrix,
  while keeping the historical matrix as the default.
- Add a P8D4-specific wrapper and closed schema pinning the exact ordered CRM,
  Inbox and Lead Agent tags, OCI index/image IDs and platform-manifest digests
  produced by the real OrbStack build.
- Require exact `linux/amd64`, empty variant, EVO source label, d565 revision,
  tag annotations, OCI/Docker manifests, descriptor digests/sizes, closed media
  types, exact tar entry set, mode `0600`, absent output and collision refusal.
- Exercise schema/candidate/order/digest negatives in normal CI and run the
  retained real-archive suite against all three generated archives before any
  transfer.
- Obtain an independent exact-head review, green CI, merge and exact-main green
  CI before resuming P8D4 Phase B.

## 2026-08-16 - Use temporary Supabase CLI credentials for P8D4 migrations

Plan Block-ID: `EVO-PLATFORM-P8D4B-PAT-MIGRATIONS-2026-08-16`

GitHub issue: `#223`

Status: implementation authorized; this amendment and runner validation perform
no production schema write, database-password rotation, SSL/JIT configuration,
Hermes restart, knowledge publication or provider/customer action

Reason: the ignored EVO handoff contains a valid owner Management API PAT but
its historical database password no longer authenticates. Real read-only
Management API checks against project `iosckaqtovbbnssqcpde` returned HTTP 200
for the migration list and HTTP 201 for the read-only SQL endpoint; both report
exactly 72 migrations from `001` through `072`. Supabase CLI `2.110.0` has an
official passwordless linked-project path which obtains a short-lived login
role from `POST /v1/projects/{ref}/cli/login-role`. Changing the persistent
database password is therefore unnecessary. The separate PAT-as-Postgres JIT
feature is not usable without enabling SSL enforcement, which would trigger a
database reboot and is outside the minimum release action.

Decision:

- Preserve the P8D4 candidate source at
  `d5657acc6c1df1abc790a96778ca71df36687b24` and exact migration sequence
  `001-076`; this block changes only migration transport and evidence.
- Use the owner PAT only through `SUPABASE_ACCESS_TOKEN`; never print, persist,
  copy to Hermes or place it in command arguments.
- Resolve and validate the exact project and remote ledger through the official
  Management API before any temporary credential or schema write.
- Require the lockfile Supabase CLI `2.110.0`, a clean exact candidate worktree,
  exact SHA-256 for migrations `073`-`076`, and absence of database-password
  environment variables.
- Run the CLI linked-project dry-run with its provider-issued temporary login
  role. From exact `001-072`, accept only the full ordered set `073`-`076`;
  exact `001-076` is a verified no-op. Reject gaps, partial application, extra
  remote versions, timestamp versions, duplicate versions, reordered
  migrations, modified SQL, prompt output, seed/role operations or an already
  linked different project.
- Apply the accepted set once with `--linked --yes`, then require both the
  Management API migration list and read-only SQL summary to report exact
  contiguous `001-076` before P8D4 continues.
- Require an exclusive migration window with no concurrent Supabase CLI
  link/push session for this project, because cleanup revokes the project's
  temporary CLI roles. Revoke those roles and remove only the runner-owned
  local `supabase/.temp` directory in guarded `finally` cleanup. An operation
  or local-temp cleanup error with verified role cleanup records
  `operation_failed`; a role cleanup error records `cleanup_failed`. Evidence
  records both cleanup statuses. Either result blocks publication/deployment; no
  fallback to a persistent password, manual SQL, Dashboard SQL, migration
  repair, SSL enforcement or JIT is allowed.
- Emit only a closed mode-`0600` JSON result with fixed project/candidate/CLI,
  migration identifiers and SHA-256 values, normalized phase statuses and
  cleanup state. No token, temporary role/password, DB URL, SQL body, email,
  user ID or customer data may enter evidence or logs.

Official basis:

- Supabase Management API authentication and migration-history endpoints:
  `https://supabase.com/docs/reference/api/introduction` and
  `https://supabase.com/docs/reference/api/v1-list-migration-history`.
- Supabase temporary CLI login-role endpoint and current CLI `2.110.0` source:
  `https://supabase.com/docs/reference/api/getting-started` and
  `https://github.com/supabase/cli/tree/v2.110.0`.
- Supabase migration tracking contract:
  `https://supabase.com/docs/guides/deployment/database-migrations`.

Execution gate:

- Merge this plan/runner only after focused tests, full applicable Node gates,
  independent exact-head approval and exact-head CI are green.
- Require exact-main green CI and a fresh read-only production preflight before
  invoking apply mode.
- The owner-approved P8D4 production window covers only the temporary login-role
  lifecycle and reviewed migrations `073`-`076` at this step. Stop before
  knowledge publication, container recreation, Gemini generation, amoCRM write,
  WAHA change or WhatsApp send.

## 2026-08-16 - Refresh P8D4 to the final frozen knowledge inventory

Plan Block-ID: `EVO-PLATFORM-P8D4C-KNOWLEDGE-FREEZE-2026-08-16`

GitHub issue: `#225`

Status: contract correction authorized; production knowledge publication stays
blocked until this exact amendment passes independent review, CI, merge and
exact-main CI

Reason: the separately owned knowledge lane completed its approved Poland and
Malaysia delta batch after P8D4 froze an inventory of 10 client and 286 internal
documents. The final publishable vaults are now deliberately frozen at 11
client and 291 internal documents. Continuing with the old counts would either
discard reviewed knowledge or produce false completion evidence. No production
knowledge sync or Gemini call occurred while the vault changed.

Decision:

- Preserve every prior P8D4 source, image, migration, rollback, deployment,
  pilot and outbound-action boundary. This block supersedes only the stale
  Phase D document inventory and bundle evidence.
- Bind the freeze time `2026-08-16T04:16:05+06:00`, exact client/internal counts
  `11`/`291`, exact bundle SHA-256 values `c20acf2a...`/`a3a1092c...`, client
  allowlist count/hash `8`/`3c35e8db...`, and client publication-manifest
  count/hash `8`/`5f1ad3b9...` in the active contract. Full values live in that
  contract and the closed result schema; abbreviations here are descriptive.
- Require a fresh service-role query to resolve exactly one active production
  Gemini account without printing or persisting its UUID. Rebuild each frozen
  vault twice with that exact account and require the full bundle hashes above,
  plus exact generated manifest SHA-256 values `6c6c88ef...` and `6964354a...`.
  This live check closes the knowledge lane's earlier unverified account-context
  assumption without exposing the account identifier.
- Require 11/291 and the two exact account-bound bundle hashes for
  `pilot_verified` in `docs/schemas/p8d4-result.schema.json`; retain truthful
  partial failure evidence for pre-provider drift or later failures.
- Preserve the verified PII/boundary result, 10/10 retrieval result, raw/secret
  exclusions, 912-source review binding and unchanged raw archives as mandatory
  pre-import evidence. Any drift stops before embeddings.
- Keep the knowledge owner freeze in force through both transactional audience
  syncs and retrieval verification. Release it only after the rollout owner
  confirms production import completion.

Execution gate:

- Pass the focused Draft 2020-12 behavioral test, full applicable Node gates,
  independent exact-head review and exact-head CI; merge only on green.
- Require exact-main green CI and a fresh deterministic 11/291 rebuild before
  the first Gemini embedding call. No mock, fallback, partial content set or old
  10/286 result is acceptable.

## 2026-08-16 - Close the isolated Inbox importer Compose env boundary

Plan Block-ID: `EVO-PLATFORM-P8D4D-INBOX-WAHA-ENV-2026-08-16`

GitHub issue: `#227`

Status: narrow execution correction authorized; knowledge publication remains
blocked until this exact correction passes independent review, CI, merge and
exact-main CI

Reason: the first real Phase D `docker compose run --no-deps` attempt stopped
before container creation because Compose still parses the declared WAHA
service and its `env_file`. The frozen command bound the WAHA image digest but
omitted `EVO_INBOX_WAHA_ENV_FILE`, causing an invalid fallback to a missing
release-relative `.env.waha`. No container, provider call, production restart
or knowledge write occurred.

Decision:

- Preserve every P8D4/P8D4C identity, knowledge, deployment, rollback,
  provider-call and outbound-action boundary.
- Bind the existing exact source
  `/opt/evo-inbox/agent-lead2-crmwhatsapp/.env.waha` through
  `EVO_INBOX_WAHA_ENV_FILE` in the isolated Phase D Compose command. Require it
  to be root-owned, root-group, mode `0600`, regular and non-symlink before
  rendering Compose. Never print, copy or record its values.
- Retain `run -d --no-deps` and the exact importer name/image checks. This path
  only satisfies Compose interpolation; it grants no authority to create,
  recreate, reload, restart or otherwise mutate WAHA.
- Add executable source-contract coverage for the exact path, file precondition
  and no-WAHA-mutation boundary.

Execution gate:

- Pass the focused behavioral test, full applicable Node gates, independent
  exact-head review and exact-head CI; merge only on green.
- Require exact-main green CI before retrying the same isolated importer
  command. Reuse the already hash-verified staged bundles only if their bytes,
  modes, frozen vaults and singular live-account binding remain exact.

## 2026-08-16 - Package the knowledge importer in the Inbox runner image

Plan Block-ID: `EVO-PLATFORM-P8D4E-IMPORTER-IMAGE-2026-08-16`

GitHub issue: `#229`

Status: implementation authorized; production retry remains blocked on this
correction's independent review, merge, exact-main CI, a new reviewed candidate
image and fresh staging evidence

Observed failure:

- The reviewed P8D4D Compose correction created the isolated
  `evo-p8d4-knowledge-import` container from the exact d565 Inbox candidate.
- The provider step stopped before Gemini because the production runner image
  contained only Next standalone output. Its copied `package.json` advertised
  `knowledge:import`, but the image contained neither the TypeScript entrypoint,
  `tsx`, nor the importer's dependency graph.
- No embedding request or Supabase knowledge write occurred. The exact
  disposable container, in-container bundle copies and two Hermes staging
  directories were removed; the five running production containers were not
  restarted or changed.

Decision:

- Keep the importer implementation and service-role-only SQL boundary
  unchanged. Do not install npm packages, copy a source checkout, or introduce
  an alternate importer on Hermes.
- Add esbuild `0.28.2` as an exact direct development dependency and compile
  `scripts/import-knowledge-bundle.ts` after `next build` into one bundled
  Node 20 ESM artifact at `.next/knowledge-import.mjs`. Node built-ins remain
  external; application and npm dependencies are bundled into the artifact.
- Change the repository `knowledge:import` script to execute that built
  artifact and copy only the mode-`0555` artifact into the same `.next` path in
  the non-root production runner. Do not copy full development `node_modules`,
  source trees, package-manager caches or credentials into the runner.
- Add an exact `--verify-runtime` mode which loads the real bundled dependency
  graph, emits only a fixed body-free success record and performs no network,
  provider or database operation. All normal arguments and transactional
  import behavior remain fail closed.
- Keep the RPC's internal account-ID equality validation, but serialize only a
  closed UUID-free CLI result: fixed status/version, audience, bundle hash and
  document/chunk counters. Neither `account_id` nor any UUID may enter stdout.
- Prove the source/build/Dockerfile contract in registered tests, run the
  normal Inbox lint/typecheck/test/build gates, and build the real image on
  local OrbStack only. In that image, require `linux/amd64`, the exact OCI
  revision, a non-root user, absence of the TypeScript source/tsx runtime, and
  a successful `npm run knowledge:import -- --verify-runtime` with network
  disabled.
- Because runner bytes change, d565 image identities are retired for future
  deployment. After this correction merges and exact-main CI is green, freeze
  and review a new current-main candidate, rebuild and transfer the exact three
  application images through the existing P8B/P8D evidence chain, then repeat
  P8C reconciliation before another Phase D attempt.
- The final 11/291 vault freeze remains in force. The next attempt must again
  resolve exactly one active production Gemini account without outputting its
  UUID, perform two fresh deterministic builds per audience, and reproduce the
  frozen production-bound hashes before any embedding call.

The correction grants no production deployment, Gemini call, Supabase write,
WAHA action, amoCRM write, WhatsApp send, DNS change or customer-data access.
Those actions remain governed by the existing P8D4 gates and fresh exact-main
candidate evidence.

Official basis: esbuild's Node bundling documentation specifies
`--bundle --platform=node`, automatic external treatment for Node built-ins and
explicit ESM output for `.mjs` execution:
`https://esbuild.github.io/api/#platform` and
`https://esbuild.github.io/api/#format`.

## 2026-08-16 - Rebuild the unified candidate after importer packaging

Plan Block-ID: `EVO-PLATFORM-P8D4F-CANDIDATE-AAA9-2026-08-16`

Issue: #231.

Reason: PR #230 fixed the production Inbox image so its reviewed knowledge
importer is actually runnable. The frozen d565 candidate predates that fix and
is immutable historical evidence; reusing it would reproduce the exact
pre-provider failure already observed. Production publication also cannot use
a new Inbox image beside older CRM and Lead Agent images because P8D4 requires
one source-consistent release set.

Decision:

- freeze exact source commit
  `aaa9f618131f604f79c694e4b332a0b13afd7a30`, tree
  `36632068dbfa5ae3d11fdd5bb6876940ca7fc14a`, parent
  `e8e1b0e41c17b8e55f75edd34afedd551c1d57f8`, and exact-main CI run
  `31916279374`;
- use only OrbStack and the reviewed P8B2/P8B3 build, SBOM, smoke and portable
  archive machinery; reject stale tags/evidence, any non-`linux/amd64`
  platform, identity drift, privacy findings or unverified bytes;
- build the exact CRM, Inbox and Lead Agent tags suffixed
  `aaa9f618131f604f79c694e4b332a0b13afd7a30-linux-amd64`, recording distinct
  observed OCI index and platform-manifest IDs rather than predicting them;
- preserve every historical candidate wrapper/schema/evidence unchanged and
  add a P8D4F-specific closed wrapper/schema/test set for the observed images;
- require the real candidate Inbox image to execute the fixed network-none,
  credential-free, non-root `--verify-runtime` path and to fail closed on a
  normal incomplete import invocation;
- retain only hash-bound build logs, SPDX SBOM, smoke identities, portable OCI
  archives and closed indexes in a new ignored mode-`0700` evidence root with
  mode-`0600` files;
- require independent exact-head approval, 4/4 PR CI, merge and exact-main CI
  before any Hermes staging or P8C reconciliation.

This is local candidate construction only. It does not authorize a production
transfer/load/restart/deploy, knowledge import, Gemini call, Supabase write,
WAHA, amoCRM, WhatsApp, DNS, customer-data access or billed resource.
