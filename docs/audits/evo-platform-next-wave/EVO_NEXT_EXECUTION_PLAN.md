# EVO Platform next execution plan

Status: superseded proposal under #376/ADR 0020; not an active contract
Evidence baseline: `origin/main` at `d243b2bb370d052750278e7f5cc2625991d5f870` on 2026-08-17
Planning issue: [#263](https://github.com/izzhackt/evo_AI_CRM/issues/263)

## Outcome

The next wave should make the already-merged Platform domains usable as one
controlled staff and student workflow, beginning with a human-supervised OZO
assistant. It must close real authorization, Storage, amoCRM mapping and
operations proof without treating UI, migrations or synthetic tests as
production success.

## Boundary with the active rollout

The current P8D task exclusively owns its release candidate, production
deployment, execution-control, frozen `11 client / 291 internal` knowledge
import and Gemini staff pilot. This plan does not modify or rerun those steps.

Start the first code PR only after the rollout owner provides:

- merge/deployment SHA and exact-main CI result;
- deployed migration range and service/image identities;
- knowledge import counts/bundle identities;
- enabled/disabled runtime settings;
- bounded production smoke/evidence outcome and rollback state.

The post-freeze knowledge overlay is also separate. OZO may consume it only
after its managed review/publication, audience checks and retrieval rerun.

## Execution principles

1. One coherent block per issue and PR; no mega-PR.
2. Append `docs/PLAN_CHANGES.md` before code whenever a block changes target
   architecture, schema ownership, data class, provider scope or acceptance.
3. Repository tests prove implementation, not deployment or provider success.
4. Local containers use OrbStack only after `orb status` is `Running` and
   `docker context show` is exactly `orbstack`.
5. Every exact PR head receives an independent launch-control review before
   merge; exact-main CI is checked after merge.
6. Real credentials, customer/student data, external sends/writes, managed
   infrastructure and deployment require action-time owner approval.
7. Lead Agent and legacy rollback paths remain retained/frozen unless a new
   owner decision and plan amendment explicitly changes that boundary.

## Phase 0 — reconcile the post-rollout baseline

Goal: replace all `unknown deployment` cells in the capability matrix with
retained evidence, without changing production.

Tasks:

- read the final P8D release/evidence manifests and exact-main CI;
- compare deployed migration ledger, image revisions and runtime setting
  presence to the release manifest;
- record which Platform routes are reachable and which features remain
  disabled; do not exercise customer mutations;
- attach the frozen knowledge import result and the separate second-stage
  publication dependency;
- update the capability matrix in a docs-only PR if the rollout completed after
  this audit snapshot.

Acceptance: every deployment claim has an exact SHA/evidence reference;
anything not observed remains `unknown`, `blocked` or `deferred`.

## Phase 1 — OZO assistant contract, no model and no sends

### PR 1A: contract and validators

Add a versioned OZO context envelope and structured output validator based on
`EVO_OZO_ASSISTANT_V1.md`:

- Student 360 snapshot with freshness and actor scope;
- allowed knowledge audience and cited source metadata;
- `summary`, `current_stage`, `missing_items`, `deadlines`, `draft_messages`,
  `checklists`, `proposed_actions`, `unknowns` and `handoff`;
- no executable tool/provider instruction;
- deterministic rejection of external submission, payment, signing, approval,
  case close, amoCRM write or WhatsApp send.

Tests: schema/version errors, unknown source, stale mutable fact, missing
knowledge, prompt injection in source content, cross-case IDs, forbidden
actions and idempotent audit payload.

No production authorization is needed because there is no provider or runtime
activation.

### PR 1B: proposal repository and immutable review audit

After a schema/plan amendment if required, persist OZO proposals separately
from operational state. Record prompt/context/source versions, actor/case,
proposed action, staff edit/decision and correlation ID. Manager edits become
training candidates only; they do not alter prompt or knowledge automatically.

Acceptance: staff rejection/edit/approval never executes an external action,
and audit reconstruction can reproduce which context and sources produced a
proposal.

### PR 1C: Student 360 assistant panel

Show next stage, missing documents, due items, sourced draft messages,
checklists and proposed actions. Curator may copy/edit/approve a draft record;
the actual external action remains manual and outside the panel.

Acceptance: role/object denial, empty/missing/stale knowledge states,
responsive/accessibility checks and no network call to WAHA/amoCRM/provider.

### Provider pilot gate

Only after 1A-1C merge and exact-main green may a separate authorized PR add a
Gemini adapter. It must use structured output, exact model/config identity,
bounded context, no secret in browser/logs, immutable proposal evidence and a
kill switch. Start with synthetic questions, then owner-authorized staff cases;
no WhatsApp send.

## Phase 2 — amoCRM mapping and handoff truth

### PR 2A: discovery/approval artifact

Using read-only account access, export names/presence/IDs needed by the existing
mapping contract: account, pipeline, statuses, responsible users, contact/lead
fields, contract event and assignment mapping. Never hardcode account-specific
IDs in source. The Sales owner approves the artifact; values belong in
encrypted settings, not Git.

### PR 2B: read-only reconciliation

Run bounded reconciliation for synthetic or explicitly authorized test
entities. Prove canonical contact/lead/stage/manager context, freshness and
duplicate detection. No writes or test lead without action-time approval.

### PR 2C: contract-to-case E2E

With approved mapping and test-lead authority, prove one contract event creates
one pending case, replay is idempotent, Admin assignment activates the correct
Portal, and amoCRM sales stage is unchanged by Platform assignment.

Acceptance: QA-010 and QA-012-014 with retained provider/Platform evidence.

## Phase 3 — Student 360 and Portal closure

Work domain by domain so each PR stays reviewable:

1. unified Student 360 read model with explicit freshness/unknown state;
2. application transition and evidence history;
3. visa transition/evidence history;
4. finance payment/refund/stop-factor authority and student projection;
5. task and notification ownership;
6. close/reopen and Portal state behavior;
7. Portal object-scope E2E across dashboard, profile, applications, documents,
   visa, payments, messages, notifications and team.

Acceptance: QA-015-016, QA-030-035 and QA-050-055. Repository/local proof is
merged first; live-account smoke is a separate authorized event.

## Phase 4 — managed private documents

### PR 4A: Storage contract E2E

Against a sanctioned non-production managed Supabase project, prove reservation
→ signed upload → exact-object finalization → audited signed download with
synthetic files. Cover replay, expiry, wrong hash, wrong MIME/signature, size,
cross-student and cross-organization denial.

### PR 4B: validation/scanner and review

Choose/approve the real malware validation source, then prove pending/error/
infected/clean handling. Preserve immutable versions and correction reasons.

### PR 4C: backup/restore

Restore both database records and private Storage objects into an explicitly
authorized isolated destination and reconcile references.

Acceptance: QA-020-024, QA-052 and QA-063. No real student file is used.

## Phase 5 — country playbooks and OZO retrieval

1. Employees deliver country documents using
   `EVO_COUNTRY_PLAYBOOK_TEMPLATE.md`.
2. Knowledge curators separate stable process from mutable facts, attach
   official sources/review dates and resolve conflicts by authority.
3. Publish one approved country version through the managed knowledge and
   country-requirement workflow.
4. Run client/internal audience isolation and retrieval cases.
5. Run OZO missing/outdated-source cases; the assistant must abstain or propose
   official verification rather than inventing.

Start with China as a structured draft, not as automatically current truth.
Malaysia and other countries remain `facts only` until staff process material
and official mutable facts satisfy the template.

## Phase 6 — reliability and production-operation gate

Before calling the broad workflow operational:

- owner approves capacity, SLO, RPO/RTO, Supabase plan/PITR and cost;
- load test represents agreed staff/student/message/document concurrency;
- queue retry/dead-letter and controlled failure drills pass;
- alerts have a real destination and named response owner;
- DB and Storage restore evidence passes;
- privacy/consent/retention/provider policy is approved;
- audit export and access review pass;
- release/rollback rehearsal preserves the retained Lead Agent path.

Acceptance: QA-060-065 plus the approved numerical/operational targets. A green
CI run alone cannot close this phase.

## Deferred integration: Student Profile processor

Do not implement until a new ADR/plan amendment approves purpose, consent,
service authentication, secure transfer, provider data classes, retention and
failure handling. Then follow
`EVO_STUDENT_PROFILE_INTEGRATION_PROPOSAL.md` in separate phases. The local tool
is not an internet-ready dependency and real student documents are forbidden
during design and synthetic proof.

## Owner decisions that are truly required

| Decision | Blocks | Does not block |
| --- | --- | --- |
| DEC-006 exact amoCRM mappings and test-lead authority | Phase 2 provider/E2E | OZO contract/UI and synthetic tests |
| DEC-007 sanitized WhatsApp sender/session test authority | Real WAHA proof | Draft-only OZO and Platform domain work |
| DEC-009/010 Supabase plan, capacity, SLO/RPO/RTO | Phase 4 managed scale and Phase 6 | Repository contracts and local tests |
| DEC-012 privacy, consent, retention/deletion | Live student docs, Profile integration, irreversible deletion | Synthetic documents and docs-only design |
| DEC-013 provider/model/data classes/DPA | Live Gemini/OZO and document provider processing | Deterministic OZO validator |
| DEC-017 release window/rollback authority | Production rollout/rehearsal | Independent repository PRs |
| Country source owners and review cadence | Publishing each operational playbook | Template and China structured draft |

## Standard PR evidence

Every PR body must name its phase, issue, exact acceptance scenarios, plan
change status, files/schema changed, commands run, evidence level achieved,
provider/production proof status and remaining blockers. Before any local
container check:

```text
orb status
docker context show
```

The expected results are `Running` and `orbstack`. Use project-local test,
lint, typecheck/build and migration verification commands from the current
`package.json` and runbooks. The independent reviewer must read the actual
plan, `docs/PLAN_CHANGES.md`, exact PR diff and raw validation output.

## Completion definition

The next wave is complete only when:

- the relevant scenarios have the required R/L/P/X evidence;
- Student 360 and Portal complete the contract→case→assignment→operations
  journey under real authorization;
- OZO remains human-supervised and source-grounded;
- document bytes are private, versioned, validated, backed up and restorable;
- account-specific amoCRM mappings are approved and reconciled;
- owner decisions and skipped provider/production proofs remain visibly open;
- no Lead Agent retirement or autonomous external OZO action was introduced.
