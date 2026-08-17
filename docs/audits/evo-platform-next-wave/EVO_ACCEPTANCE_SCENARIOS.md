# EVO Platform acceptance scenarios

Status: next-wave QA catalog
Evidence baseline: `origin/main` at `d243b2bb370d052750278e7f5cc2625991d5f870` on 2026-08-17

## Evidence levels

- **R — repository:** schema, policy, action, UI and deterministic test evidence.
- **L — local integration:** real application plus local Supabase/Storage on
  OrbStack, using synthetic identities and files.
- **P — provider:** authorized WAHA, Gemini or amoCRM test account evidence.
- **X — production:** bounded production E2E with approved identities, window,
  rollback and retained evidence.

R or L never satisfies P or X. A visible page is not proof that its write path,
RLS, provider or production deployment works.

## Identity, roles and isolation

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-001 | Unauthenticated staff route | Open every protected staff route without a Platform session | Redirect/login; no Platform data in HTML/RSC/API | R + L |
| QA-002 | Role route denial | Attempt Sales→Finance, Finance→Curator, Student→staff routes and mutations | Fail closed with no row/audit side effect except denial telemetry | R + L |
| QA-003 | Cross-organization isolation | Two organizations contain similar cases; actor queries the other organization ID | DB/API/UI and Storage deny; no existence leak | R + L, then X smoke |
| QA-004 | Cross-student isolation | Two student accounts in one organization attempt each other's case, message, payment and document IDs | Only own case projection is visible/actionable | R + L, then X smoke |
| QA-005 | Blocked/expired membership | Disable membership or expire session during navigation and mutation | Next request fails; no stale-authority write | R + L |
| QA-006 | Service-role containment | Inspect browser bundle/logs and call privileged RPC as browser actor | No secret present; privileged operation denied | R + L + X scan |

## Sales, handoff and Student 360

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-010 | Lead context read | Read a mapped amoCRM contact/lead without write authority | Canonical IDs, stage and responsible user are recorded with freshness; no write | R + authorized P |
| QA-011 | Qualification memory | Produce staff draft after known onboarding answers and prior messages | Draft uses current client context, asks only missing questions, cites knowledge and writes no provider message | R + authorized Gemini P |
| QA-012 | Contract creates pending case | Approved account-specific contract event is applied twice | One pending case, idempotent audit, Sales remains owner until Curator assignment | R + L + authorized P/X |
| QA-013 | Admin Curator assignment | Admin assigns an eligible Curator to a pending case | Case becomes active, assignment/history and audit persist, Curator notified, sales stage unchanged | R + L + X |
| QA-014 | Unauthorized handoff | Sales, Finance, Student or wrong organization attempts assignment | Denied with no activation or Portal access | R + L |
| QA-015 | Close and reopen | Authorized actor closes with reason, then reopens with reason | State/history/audit preserved; open tasks and portal behavior follow policy | R + L |
| QA-016 | Parallel applications | Create two applications with different universities/programs and advance only one | Independent status/evidence histories; no overwrite | R + L |

## Documents and Student Profile

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-020 | Private upload lifecycle | Reserve, upload PDF/JPG/PNG <=25 MB, finalize exact object | One version bound to exact object/hash; reservation expires/replays fail | R + OrbStack L + managed X |
| QA-021 | MIME/signature/size rejection | Upload disguised executable, unsupported MIME or oversized file | Rejected before finalization; no approved slot/version | R + L |
| QA-022 | Malware/integrity gate | Finalized object has pending/error/infected or hash mismatch | Review/approval/download behavior fails closed per policy | R + L + real scanner P/X |
| QA-023 | Correction and resubmission | Curator requests correction; Student uploads replacement | Both immutable versions and reason remain; newest version is pending review | R + L + X |
| QA-024 | Signed download isolation | Authorized Curator and unauthorized actor request same object | One bounded audited grant for Curator; other actor denied; expired/replayed URL fails | R + L + managed X |
| QA-025 | Profile source conflict | Proposed extracted value conflicts with human-confirmed field | Confirmed value remains; proposal requires explicit Curator decision | Separate-system R + future integration L |
| QA-026 | Profile export gate | Required field is unresolved/conflicted | Generated form is blocked; successful export records template and source versions | Separate-system R; future integration L/P |

## Applications, visa and finance

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-030 | Application evidence gate | Advance to submitted/offer/enrolled without required evidence, then with evidence | First denied; second persists evidence and history/audit | R + L |
| QA-031 | Visa evidence and authority | Curator advances visa; Student/Sales attempts same; rejection is recorded | Authorized evidence-backed transition succeeds; others denied; rejection remains explicit | R + L |
| QA-032 | Mutable visa guidance | OZO draft uses an outdated or unsourced deadline rule | Agent says it cannot confirm, cites source/review date, proposes verification; no external promise | R + future provider P |
| QA-033 | Finance confirmation | Curator/Student attempts payment confirmation; Finance records payment with evidence | Unauthorized actors denied; obligation balance/status and audit update once | R + L |
| QA-034 | Refund and stop factor | Finance/Admin records refund or resolves stop factor with reason | Independent payment history remains; no silent delete; downstream next action updates | R + L |
| QA-035 | Student payment projection | Student views obligations and evidence references | Only own bounded status/amount/next action; no internal finance notes | R + L + X |

## Communications, knowledge and OZO assistant

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-040 | WAHA ingress replay | Send same signed event twice | Persist-before-process; one canonical message/work item; replay acknowledged idempotently | R + L + authorized P/X |
| QA-041 | Media access | Inbound media is available; unauthorized actor requests it | Private persisted metadata/object; scoped audited access only | R + L + P/X |
| QA-042 | ACK exactness | WAHA emits delivery/read ACK for exact message alias | Exact outbox/message state advances monotonically; unknown aliases do not corrupt other messages | R + P/X |
| QA-043 | Draft-only guard | Generate AI proposal while autonomous/manual provider send is disabled | Proposal visible to staff; no WAHA call; review/audit retained | R + authorized Gemini P + X |
| QA-044 | Staff takeover | Staff takes over before/after a queued proposal | Automation stops/fails gate; durable human handoff; no unattended send | R + L + P/X |
| QA-045 | Missing knowledge | Ask a factual question absent from allowed audience bundle | Agent says it lacks verified information, asks/assigns follow-up; no invention | R + retrieval L/P |
| QA-046 | Audience isolation | Client query targets internal-only note or excluded raw source | Retrieval never returns internal/raw source; internal staff query may return approved internal note | R + L + X audit |
| QA-047 | Outdated source | Retrieved mutable fact has expired review date or superseded source | Draft labels it stale and requires official verification before use | R + L/P |
| QA-048 | OZO proposed action | Curator asks agent to submit/pay/send externally | Output is a draft/checklist/proposed action requiring human confirmation; no provider write | R + future Gemini P |
| QA-049 | Manager edit learning boundary | Manager edits a draft incorrectly | Edit is audit/training candidate only; prompt/knowledge remain unchanged until governed review/version release | R + L |

## Portal, tasks and notifications

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-050 | Portal activation gate | Contract exists but Curator is not assigned; then Admin assigns | Before assignment Portal remains pending; after assignment correct account gets access | R + L + X |
| QA-051 | Portal dashboard truth | Student has multiple applications, missing docs, visa and overdue payment | Dashboard derives bounded current next actions without contradictory states | R + L + X |
| QA-052 | Student upload/rework | Student uploads to own assigned slot and responds to correction | Version/review lifecycle advances; cannot create arbitrary requirement or approve own file | R + L + X |
| QA-053 | Overdue notification dedupe | Scheduler evaluates same overdue item repeatedly | One durable notification per dedupe key/window; no broadcast; consent gates WhatsApp intent | R + L + controlled X |
| QA-054 | Notification authorization | Other student/org requests notification ID or marks it read | Denied; owner can read/ack own notification | R + L |
| QA-055 | Curator task ownership | Curator sees assigned open/blocked/overdue tasks; another curator queries them | Correct object scope and priority; no cross-assignment leak | R + L |

## Audit, operations and recovery

| ID | Scenario | Preconditions and action | Expected result | Minimum proof |
| --- | --- | --- | --- | --- |
| QA-060 | Audit completeness | Perform representative state change in every v1 domain | Actor, org, object, reason, request/correlation ID, before/after/evidence refs searchable | R + L + X |
| QA-061 | Audit export scope | Admin exports bounded period; lower role/cross-org attempts same | Admin receives bounded deterministic CSV; others denied; export itself audited | R + L + X |
| QA-062 | Queue retry and dead letter | Inject transient and terminal failure | Bounded retry, idempotency, visible terminal state and operator recovery; no duplicate effect | R + L |
| QA-063 | Storage and DB restore | Restore DB and private objects into approved isolated environment | Referential links and access policy work; missing objects are detected | Authorized restore drill |
| QA-064 | Alert/runbook drill | Force controlled worker/provider/readiness failure | Signal, alert owner and runbook action are observable; recovery is recorded | L + controlled X |
| QA-065 | Responsive/accessibility gate | Exercise critical screens at 1440/834/390 and keyboard/screen reader spot check | No blocking overflow; focus, names, errors and status changes usable | R + browser L |

## Release rule

A capability may be called **implemented** after its R evidence passes. It may be
called **locally proven** only after its required L scenario runs on OrbStack.
It may be called **provider-proven** or **production-ready** only after every P
or X scenario named for that capability has retained exact-version evidence.
Any skipped scenario stays `blocked` or `deferred`; it is not converted to pass
by a mock or synthetic fixture.
