# EVO Platform prioritized backlog

Status: superseded sequencing under #376/ADR 0020; U0-U14 is the only active
backlog order
Evidence baseline: `origin/main` at `d243b2bb370d052750278e7f5cc2625991d5f870` on 2026-08-17

## How to read priority

The priority is a gate, not a promise that a feature is missing entirely.
Several items already have schema, UI or local tests; the backlog names the
remaining proof or product slice required before a particular pilot.

`Production authorization` means an explicit action-time decision is required
before live credentials, providers, customers, students or infrastructure are
changed. Repository work may proceed without that authorization when the row
says `No`.

## Critical before staff pilot

| ID | Work item | User value | Risk addressed | Dependencies | Exact area | Acceptance criteria | PR slice | Production authorization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SP-01 | Finish active P8D and import frozen 11 client / 291 internal bundle | Staff can review grounded drafts | Candidate/deployment drift and empty retrieval | Active rollout owner only | P8D execution-control and knowledge import; excluded from this lane | Exact-main CI, immutable evidence, production import proof, draft-only gates | Already owned elsewhere | Yes |
| SP-02 | Publish post-freeze retrieval fixes after rollout | Internal retrieval covers documented misses | OZO/Sales drafts miss operational facts | SP-01; managed KB review | Knowledge second-stage handoff; do not edit frozen vault here | Managed publication, audience/PII checks, retrieval rerun and new bundle hashes | Separate knowledge PR/import | Yes |
| SP-03 | OZO assistant contract and read-only panel | Curator gets next step, gaps, sourced drafts and checklists | Agent invents facts or performs actions | SP-01/02; OZO contract in this package | New server contract/repository/UI beside Student 360; no provider send | QA-032, QA-045-049; every action stays proposed and audited | 2-3 small PRs: contract, repository, UI | Provider pilot yes; repository no |
| SP-04 | Govern employee draft feedback | Manager edits improve future versions without automatic learning | One bad edit becomes system rule | Draft/audit tables and prompt versioning | AI proposal/audit domain; migration only after plan amendment | Edits stored as labeled candidates; approved rubric/prompt release is versioned and reversible | 1 schema PR + 1 review UI PR | No for repo; yes for live evaluation data |
| SP-05 | Complete staff role/object denial matrix | Staff sees only authorized functions and students | Cross-role/org data exposure | Managed environment and synthetic accounts | Auth guards, RLS, route contracts, role E2E | QA-001-006 all pass; exact permission bundle recorded | 1 focused test/hardening PR | Managed test env yes |
| SP-06 | amoCRM mapping discovery and approval | Sales context/handoff matches the real account | Hardcoded IDs, wrong stage/manager, duplicates | DEC-006; read credentials; Sales owner | `platform-amocrm-*`, migration 058/064 contracts | Approved mapping artifact, read-only reconciliation, no hardcoded account IDs | 1 docs/config contract PR, then adapter PR | Yes for account access/test lead |
| SP-07 | Real draft-only lead/OZO evaluation set | Staff can judge tone, accuracy and usefulness | Local prompts appear good but fail on real context | SP-01/02, consent/data policy | Evaluation harness and immutable staff review records | Sanitized or authorized cases, blinded rubric, no send, no automatic training | 1 eval harness PR | Yes for customer-derived data/Gemini |

## Critical before student pilot

| ID | Work item | User value | Risk addressed | Dependencies | Exact area | Acceptance criteria | PR slice | Production authorization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ST-01 | Contract→pending case→Admin assignment→Portal E2E | Correct student enters operational workflow once | Duplicate case or premature Portal access | SP-06; account mapping; synthetic/approved contract event | migrations 042/051/052/057, case actions, Portal guard | QA-012-014 and QA-050 pass with retained audit | 1 E2E/hardening PR | Yes for real amo event/live account |
| ST-02 | Student 360 state consistency | Curator sees one reliable operational picture | Conflicting application/document/visa/finance states | ST-01 | staff client detail, domain repositories/actions | QA-015-016, 030-035, 051 pass; stale/unknown state visible | 1 read-model PR + domain fixes separately | No for repo; yes for live smoke |
| ST-03 | Managed private-document E2E | Student can safely upload and resubmit files | PII exposure, wrong object/version, unsafe type | DEC-008/012; managed Storage; scanner decision | migrations 043/046/055, document actions/routes | QA-020-024, 052 pass; real Storage and cross-user denial | Separate upload, review and download PRs | Yes |
| ST-04 | Portal object-scope E2E for every surface | Student sees own applications/docs/visa/payments/messages/team only | Cross-student leak or UI-only feature | ST-01/02; synthetic accounts | `/portal/*`, portal repositories, RLS | QA-004, 035, 050-055 pass | 1 test PR, then small fixes | Managed env yes |
| ST-05 | Portal activation/support runbook | Staff can invite, recover and disable a student safely | Locked-out or orphaned accounts | Auth owner and support owner | auth/session, activation UI, runbook | Invite/activation/recovery/disable exercises with audit and rollback | 1 runbook + focused UI/API PR | Yes for live accounts |
| ST-06 | Country requirement publication v1 | Checklist reflects reviewed country rules | Outdated or unsourced requirements | Staff playbooks; source owner/review dates | migration 053, catalog/profile actions | Approved version with sources, expiry/review workflow and deterministic slot instantiation | 1 country-version workflow PR | Publication yes |

## Critical before production operations

| ID | Work item | User value | Risk addressed | Dependencies | Exact area | Acceptance criteria | PR slice | Production authorization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OP-01 | Capacity/SLO/RPO/RTO decision and load proof | Predictable reliability and support expectations | Unknown server/database limits | DEC-009/010 | operations docs, metrics, deployment profile | Approved numbers, representative load test, resource/alert thresholds | 1 plan amendment + evidence PR | Yes for billed scale/load |
| OP-02 | Database and Storage restore drill | Recover student records and files | Backup exists but cannot restore coherently | Approved isolated destinations and credentials | disaster recovery runbook, Supabase/Storage | QA-063 with DB/object reconciliation and measured timings | 1 evidence/runbook PR | Yes |
| OP-03 | Alerts, queue recovery and incident ownership | Failures become visible and recoverable | Silent queue/provider loss | OP-01; alert destination/owner | migrations 045/072, metrics/readiness, runbooks | QA-062/064; controlled failure routes to named owner | Separate queue and alert PRs | Yes for alert destination/drill |
| OP-04 | Privacy/retention/deletion policy | Students know and control data handling | Indefinite PII retention and unlawful processing | DEC-012/013; Legal/Data owner | policy docs, deletion/retention jobs only after approval | Consent/withdrawal/retention matrix; reversible implementation; audit | Plan amendment first; then small domain PRs | Yes |
| OP-05 | Release/rollback and legacy boundary rehearsal | Deploy without losing working lead path | Cutover breaks messaging or removes rollback | DEC-017/018; P8 evidence | release manifest, runbooks, deployed services | Exact candidate, rollback rehearsal, Lead Agent retained/frozen and no hidden retirement | 1 evidence/runbook PR per release | Yes |
| OP-06 | Full audit/export and access review | Management can investigate who changed what | Gaps in accountability | Role E2E and domain coverage | migration 071, audit UI/API/export | QA-060/061; bounded export, role denial, retention decision | 1 audit coverage PR | Live export yes |

## Important after v1

| ID | Work item | User value | Risk addressed | Dependencies | Exact area | Acceptance criteria | PR slice | Production authorization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IV-01 | Additional country playbooks | Curators get consistent guidance outside China | Country knowledge exists without operating sequence | Staff deliver reviewed source material | Approved KB + country version workflow | Template-complete playbook, sources/review date, retrieval tests | One country per review/publication slice | Publication yes |
| IV-02 | Student Profile processor integration | Reduce manual transcription with human verification | Sensitive document transfer and model errors | ADR amendment, DEC-012/013, ST-03 | Separate system + proposal in this package | Future integration proposal acceptance suite; no silent overwrite | Multi-phase, never mega-PR | Yes |
| IV-03 | Reporting/KPI truth contracts | Management sees reliable operational performance | Dashboard numbers lack source/freshness | Stable domain data and DEC-015 owners | reports/read models | Every KPI has formula/source/period/freshness/owner | One KPI family per PR | No for repo; live data yes |
| IV-04 | Curator workload/coverage views | Admin balances cases and deadlines | Overloaded staff and missed tasks | Assignment/task truth | dashboard/tasks/reports | Scoped workload counts reconcile with cases/tasks | 1 read-model/UI PR | No for repo |
| IV-05 | Accessibility and responsive closure | Staff/students can use critical flows on phone and assistive tech | Blocking UX defects | Stable critical screens | e2e/accessibility/UI | QA-065 at 1440/834/390 plus manual checks | Screen family per PR | No |

## Deferred automation

| ID | Work item | Why deferred | Preconditions before reconsideration | Production authorization |
| --- | --- | --- | --- | --- |
| DA-01 | Autonomous OZO submission/payment/signing/document send | External legal/financial action must remain human-owned | Separate business/legal decision, provider contracts, approval and rollback design | Yes |
| DA-02 | Automatic university/government application submission | No approved provider/account contract and high consequence of wrong data | IV-02 verified data, official integration, human final approval | Yes |
| DA-03 | Cold/out-of-window AI follow-up and campaigns | Current scope permits at most guarded inbound reply; spam/consent risk | Separate consent, policy and WhatsApp authority | Yes |
| DA-04 | Payment gateway, telephony and email provider | Explicitly outside v1 in DEC-019 | Provider/security contracts and owner plan amendment | Yes |
| DA-05 | Lead Agent retirement or session cutover | ADR 0018/0019 and DEC-018 retain rollback path | Proven replacement, new owner decision, cutover/rollback rehearsal | Yes |
| DA-06 | Automatic learning from manager edits | Feedback may be wrong, inconsistent or contain customer data | Governed labels, reviewer quorum, offline evaluation and version release | Yes for data use |

## Recommended first independent implementation slice

After P8D is closed and its exact-main CI is green, start **SP-03a: OZO
assistant contract and deterministic validator**. It can be implemented with
synthetic data, no provider call, no production mutation and no change to the
frozen knowledge bundle. It should define the context envelope, structured
output, citations, proposed actions, refusal states and audit payload before
any UI or Gemini adapter is added.
