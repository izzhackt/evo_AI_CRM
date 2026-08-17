# EVO Launch Plan

Status: `/goal-evo-platform-mvp-autonomous-inbound-plan` is active under the
owner-authorized direct exact-head merge workflow.
Historical P1, reusable greenfield P2A-P2H, BW0, P3A-P3C, BW1-BW7,
P2R0-P2R4 and P4A are merged. PR #118 merged the P4B docs-only contract, PR
#128 merged the owner-authorized correction that keeps Student Profile document
automation outside `evo_AI_CRM`, and PRs #129-#130 merged the local-validation
prerequisite and repair, PR #132 merged the disabled-by-default P5A WAHA
ingress, PR #133 merged the disabled-by-default P5B projection, PR #137 merged
the P5C available-history reconciliation lane, and PR #138 merged the
disabled-by-default P5D private WAHA media archive and accepted media display.
PR #141 merged the disabled-by-default P5E ACK/session projection and private
Realtime invalidation lane, PR #142 merged the bounded P4R1 read-only
canonical amoCRM context lane, PR #144 merged the disabled-by-default P5F1
Platform-owned memory/retrieval foundation, PR #145 merged the disabled-by-
default P5F2 stateless Gemini proposal adapter, PR #146 merged the disabled-by-
default P5F3 deterministic autonomous inbound-reply lane, and PR #147 merged
the reviewed P6A-P6D implementation contract. PRs #148, #149, #152 and #153
then merged P6A read-only attention, P6B durable Student Portal notifications,
P6C overdue-transition publication and P6D cross-domain Student 360 closure.
PR #154 merged the P7 security/reliability contract, PR #156 merged P7A safe
Admin-only audit search/export, PR #157 refreshed accepted status and the
OrbStack-only rule, PR #160 merged P7B private observability, PR #163 merged
the P7C authority contract plus the `evo-platform-prod` organization and name
consolidation, PR #164 deferred the P7C drill, PR #165 merged the local
knowledge-ingestion contract, PR #166 merged its deterministic Takeout
preparation pipeline, PR #170 merged the real lead-processing proof plan, and
PR #171 merged Codex review plus Obsidian publication. PR #169 merged the
focused P7D accessibility contract, and PRs #172-#174 hardened the local
knowledge-ingestion path. PRs #208, #212 and #214 then merged knowledge
audience isolation, atomic Obsidian bundle sync and audited staff assistants;
PR #215 merged the P8D4 staff-pilot contract, PR #216 merged the supervised
Lead Agent sales policy, PR #218 unified Platform intake memory with the
draft-only consultative-sales proposal path, and PRs #220 and #222 refreshed
and bound the unified P8D4 portable candidate. PRs #224 and #226 then applied
production migrations `073-076` and froze the final 11/291 knowledge identity,
PR #228 repaired the isolated importer Compose invocation, PR #230 packaged
the importer as a runnable, UUID-redacting production-image artifact, and PRs
#232-#233 built and independently verified the exact P8D4F `linux/amd64`
candidate, and PR #235 authorized the closed P8D4G production execution order.
Current `origin/main` is
`85fcfe94870ed05dc8a5df9ef82cf5eb7b7147d2`, migrations remain contiguous
`001-076`, and exact-main push CI run `31941905553` is the exact-main push gate
for Main CRM, EVO Inbox and EVO Lead Agent; Changed range is skipped on the push
event as expected.

P4B implementation is preserved on remote branch
`izzhackt/evo-platform-p4b-mapping-approval` at
`e53ba94954f147b295f596421a255591fa343ce8`; no implementation PR exists.
Focused repository checks passed, but its attempted full local Supabase gate
failed closed in the real Auth/PostgREST hook before Playwright and is
failed/non-evidence. The owner keeps P4B activation/writes deferred but resumes
a bounded read-mostly P4R lane after the messaging foundation. P9 remains
removed. Lead Agent, the legacy webhook/session path and rollback path remain
deployed/frozen. P5A-P5F3 and P4R1 are merged without real-provider proof. The
completed P6A-P6D evidence is synthetic/local and authorizes no managed or
production claim. P7A and P7B are repository/local evidence only and remain
disabled by default. On 2026-08-14 the owner deferred the P7C restore drill
until the Platform is functionally complete and concretely operating.
Supabase Pro scheduled database backups remain enabled, but they are not
restore evidence and do not include Storage object bytes. `inbox-prod` is a
separate owned Inbox SaaS product and is explicitly retained outside EVO
Platform consolidation and retirement scope. The active next execution slice
is P8D4S under issue #270. P8D4R safely verified the exact candidate,
migrations `001-076`, staging, rollback capture and disabled configuration,
then stopped with `knowledge_failed` before any database import, application
deployment or pilot. Cleanup removed all four local build roots, the remote
knowledge directory and the isolated importer; all five production containers
retained their prior image IDs, healthy state and restart count zero. The
immutable P8D4R result is retained with SHA-256
`9217322cf48f96daadd8ef780732b8c29cc54e9234bc4c6e2b8ecfbe4c459577`.
Its evidence incorrectly records account resolution and deterministic builds
as `not_run` even though four removed build roots prove those pre-effect
substeps ran. P8D4S corrects only this evidence integrity gap: partial
knowledge progress and a fixed redacted failure step/attempt must be retained
on failure, while credentials, UUIDs, content, stderr and private paths remain
excluded. The existing three spaced `scp` attempts, byte/deadline checks and
all remote/container SHA-256 gates remain unchanged. It uses new
collision-free release, rollback and evidence roots.
After independent review, merge, exact-main CI, execution-control rebinding,
fresh preflight and a new action-time confirmation, it may resume the frozen
11/291 import, deploy the three application boundaries with outbound behavior
disabled, and run only the two fixed staff draft pilots under
`docs/platform/p8d4-current-main-staff-pilot.md`. The owner
deferred the large capacity stress test and approved a small-launch monitoring
envelope plus focused human review on the exact P8 candidate.
Updated 2026-08-17 in the workspace timezone.

This document is the execution contract for the current EVO Platform MVP lane in
this repo. The current detailed contract is
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md`. New implementation lanes are blocked
until their plan and `docs/PLAN_CHANGES.md` amendment are independently
reviewed and merged. If scope, architecture, API/schema, acceptance criteria,
file ownership or merge order changes, stop the affected code change and merge
a separate plan amendment first.

## Lead-processing real-proof lane

Block-ID: `EVO-LEAD-PROCESSING-REAL-PROOF-PLAN-2026-08-14`.
Tracking issue: [#168](https://github.com/izzhackt/evo_AI_CRM/issues/168).

This lane converts the merged, disabled Platform messaging capabilities into a
reviewable sequence for later real-provider proof. It authorizes documentation
only. It does not authorize deployment, a managed Supabase migration, WAHA
webhook/session changes, WhatsApp messages, amoCRM writes, Gemini calls,
autonomous replies or provider-side configuration.

### Verified baseline

- Current GitHub `main` is `f363630cd2296da32930f18e64c2895e60475818`.
  Push CI run `31804372439` was still in progress when this docs head was
  created. PR #166 merged the separate knowledge-ingestion K2 implementation
  while this plan was under review; its files remain outside this lane. No
  lead-processing implementation PR was open when this refreshed baseline was
  recorded.
- P5A-P5F3 and P4R1 are merged and disabled by default. Repository contracts
  cover signed raw ingress, idempotent projection, history/media handling,
  ACK/session state, read-only canonical amoCRM context, Platform-owned memory
  and approved-knowledge retrieval, structured Gemini proposals,
  qualification, deterministic send eligibility, staff takeover/pause/resume
  and append-only audit evidence.
- Production `/opt/evo-crm` was inspected read-only on 2026-08-14. Its running
  app image and source revision are
  `564332b420a1fb1bd6232dda945d044bb922d3f0`, started 2026-07-24. The running
  app and `.env.production` expose none of the Platform enablement flags. The
  merged Platform lane is therefore not deployed or enabled there.
- No accepted evidence proves the real chain from WhatsApp through Platform
  persistence, amoCRM context, approved-knowledge retrieval, Gemini proposal,
  governed reply or handoff, WAHA ACK and staff-visible audit. Local and CI
  fixtures remain repository proof only.

### External contracts rechecked

- WAHA documents `message` as inbound, `message.any` as every message creation
  including messages sent through its API, `message.ack` as delivery/read/error
  progression, and `session.status` as the session lifecycle. The Platform must
  keep inbound identity, outbound observation, ACK and session reconciliation
  distinct: <https://waha.devlike.pro/docs/how-to/events/>.
- Kommo documents contacts as people, leads as sales opportunities and explicit
  links between them. P4R1 may read canonical linked context; creation, linking
  or stage mutation remains a separately approved write:
  <https://developers.kommo.com/reference/link-entities>.
- Gemini structured outputs constrain the final JSON shape but do not make its
  facts or reply safe. The deterministic Platform policy remains the only send
  authority: <https://ai.google.dev/gemini-api/docs/structured-output>.

### Approval-gated execution order

1. **L0 — contract (this block).** Merge this docs-only baseline after
   independent exact-head review and CI. No runtime or provider action.
2. **L1 — deploy disabled capability.** With explicit action-time deployment
   approval, deploy an exact reviewed Git SHA and apply the already-merged
   additive migrations. Keep every Platform enablement flag off and the
   autonomous-reply kill switch engaged. Prove revision, migration inventory,
   private routing, health and rollback without provider calls.
3. **L2 — receive-only intake.** With explicit WAHA webhook/session-cutover and
   managed-Supabase approval, use one EVO-controlled sanitized sender. Prove
   HMAC verification, raw persistence before processing, replay safety,
   operator-visible text and media, history reconciliation and private
   Realtime. Send no reply and write nothing to amoCRM.
4. **L3 — canonical context and retrieval.** With explicit approval for one
   real amoCRM read and the approved-knowledge publication contract available,
   resolve the sanitized sender to canonical contact/lead context or record a
   fail-closed human handoff. Consume only versioned approved knowledge and
   persist retrieval evidence; never read the raw ingestion archive directly.
5. **L4 — structured proposal and governance.** With explicit Gemini-call
   approval, produce one schema-valid proposal bound to the exact message,
   memory version, qualification version, amoCRM-context observation and
   knowledge evidence. Exercise forced-human, staff takeover/pause and audited
   resume without sending WhatsApp.
6. **L5 — one governed outbound proof.** Only if the owner separately approves
   a real WhatsApp send, queue one eligible single-use reply to the sanitized
   number, reconcile `message.any`, ACK and session evidence, and prove that an
   unknown transport outcome cannot retry automatically. Otherwise L5 remains
   blocked and the accepted milestone is receive-only plus draft/handoff.

Every block requires its own linked issue/PR, exact-head independent review,
green exact-head CI, real-path evidence, rollback record and final provider-
state recheck. A block must stop before the first externally visible action if
its action-time approval or credential is absent.

### Inputs and blockers

- deployment approval for `/opt/evo-crm` and the managed Supabase target;
- explicit ownership/cutover choice for the single target `evo-inbox` WAHA
  session and webhook, without altering the retained Lead Agent rollback path;
- sanitized EVO-controlled test sender and an identifiable test lead;
- backend-only WAHA, Supabase, amoCRM-read and Gemini credentials;
- approved, versioned knowledge artifacts and their retrieval publication
  interface from the independent ingestion lane;
- separate action-time approvals for one amoCRM read, one Gemini call and, if
  L5 is attempted, one WhatsApp send.

The default milestone is L4 with no send. No amoCRM write is required or
authorized anywhere in L0-L5.

## Local EVO Knowledge Ingestion Lane

Proposed independent slice: `EVO-KNOWLEDGE-INGESTION-LOCAL-2026-08-14`.
This slice does not modify or deploy the production CRM, EVO Inbox, WAHA,
amoCRM, Supabase, or any managed provider. It creates a local, resumable
pipeline that prepares the owner-supplied Gmail and Google Drive Takeout data
for semantic review by the authenticated Codex app or CLI without using the
OpenAI API or storing an API key.

### Scope

1. Add a Python CLI under `scripts/knowledge_ingestion/` and focused tests under
   `tests/knowledge_ingestion/`.
2. Read source roots without modifying them. The first real sources are the
   Gmail MBOX and Google Drive snapshot in
   `/Users/iskhak.tazhibaev/Documents/01_Projects/EVO_Знания/Сырой архив ЭВО`.
3. Write generated manifests, checkpoints, extracted business text and Codex
   review queues only beneath a caller-supplied output root. The default
   operational output is the internal Obsidian vault's `Входящие кандидаты`.
4. Use SHA-256 as content identity, preserve every source path as provenance,
   and avoid re-extracting content that a completed checkpoint already covers.
5. Exclude every Google Drive path beneath `Корзина` and every Gmail message
   labelled Spam or Trash from analysis.
6. Detect sensitive applicant files conservatively from path, filename and file
   type. Record only archive metadata for them; do not extract document text,
   OCR, previews, or attachment bodies.
7. Extract supported business content locally from plain text, HTML, PDF,
   DOCX, XLSX and PPTX. Unsupported or failed files remain explicit manifest
   records; there is no fake or empty-text success.
8. Extract Gmail business attachments under the same rules as Drive files and
   deduplicate them by SHA-256 across all sources.
9. Generate bounded Codex review batches and a Russian instruction contract.
   The preparation CLI must never call an LLM API. An optional operator command
   may invoke the installed authenticated `codex exec` CLI, so usage remains
   Codex-plan usage rather than OpenAI API billing.
10. Keep the client-facing Obsidian vault outside direct ingestion. Only
    reviewed outputs may be promoted there under the knowledge authority rules
    in `AGENTS.md`, `CONTEXT.md`, and ADR 0014.

### Delivery blocks

- **K1 — Contract and fixtures:** merge this plan amendment, domain vocabulary,
  ADR and repository rules before implementation.
- **K2 — Deterministic preparation:** implement source discovery, exclusions,
  sensitive classification, local extraction, SHA-256 deduplication,
  checkpoints, manifests and bounded review batches.
- **K3 — Codex review and Obsidian publication:** add the authenticated Codex
  CLI operator command, structured review schema, authority resolution and
  idempotent Russian Markdown publication to the internal vault.
- **K4 — Real corpus completion:** run K2 and K3 against all accepted source
  material, record counts and failures, resolve escalated conflicts, and verify
  that prohibited content never enters either AI vault.

### K2 acceptance criteria

- The CLI runs against the real Gmail and Drive roots and exits non-zero for a
  missing source, extraction failure that was incorrectly marked successful,
  corrupt checkpoint, or output outside the caller-authorized root.
- Re-running unchanged real inputs produces no duplicate extraction or review
  item and reports a zero-new-work result.
- No item beneath Drive `Корзина`, no Gmail Spam/Trash item, and no extracted
  sensitive applicant content appears in generated text or review batches.
- The manifest preserves source path, source kind, size, modified time,
  SHA-256, classification, extraction status and all duplicate locations.
- Tests cover the real supported parsers with repository-owned non-sensitive
  files; the end-to-end gate additionally runs against the owner-supplied real
  Takeout roots and reports real counts without printing personal content.

### K2 validation commands

- `python3 -m unittest discover -s tests/knowledge_ingestion -v`
- `python3 scripts/knowledge_ingestion/prepare.py --help`
- a real preparation run with explicit Gmail, Drive and output roots;
- the same real command a second time to prove resumability and idempotence;
- a manifest audit that fails if excluded or sensitive content entered a review
  batch.

### Stop conditions

- Stop before reading source content if the expected real roots are missing or
  their recorded Takeout checksums no longer verify.
- Stop before Codex execution if CLI authentication is unavailable or the
  prepared batch contains a prohibited classification.
- Stop before client-vault publication when authority is unresolved, a source
  conflict is escalated, or the destination is not the configured client vault.

For the currently active owner-authorized MVP lane, older references in this
file to a scheduled Launch Auditor, controller-only merge, or globally
draft-only/manual-send AI are historical unless restated inside the active
slice. The superseding rule is:

- one fresh independent read-only exact-head review is required;
- exact-head GitHub CI must be green;
- before merge, refresh `origin/main` and the PR base and confirm the reviewed
  head SHA and reviewed base/main still match the evidence;
- the executor may merge only that exact reviewed head directly;
- exact-main push CI must then be re-verified before the next block starts.

## Current Goal Slice

Active next planning slice: P8 controlled release-candidate preparation under
`EVO-P8-CONTROLLED-RELEASE-CANDIDATE-2026-08-14`. P6A-P6D, P7A and
P7B are merged, PR #163 merged the P7C authority contract and managed project
consolidation, PR #164 merged its deferral, and exact-main run `31820931774` is
green. The owner has deferred P7C database plus separate
private Storage recovery execution and the large P7D capacity stress test; those
deferrals do not count as recovery or capacity acceptance. The P7D contract is
merged; P8 now prepares the exact candidate. Accessibility closure still
requires exact-candidate automated evidence and the approved human review
before a release decision.
Each block still requires its own
fresh exact-head review, exact-head CI, exact-base recheck, reviewed merge and
green exact-main push CI. No P7 block inherits managed, provider or production
proof.

### Goal

Build the unified EVO Platform in ordered, independently reviewed blocks while
preserving the accepted frontend contract and current production safety.
amoCRM remains canonical for contact, lead, responsible sales manager and
sales stage. One greenfield Supabase-native backend becomes the platform-owned
operational store, with physically isolated dev/staging/preview environments.
The existing unified frontend from PRs #64/#71/#72 is the sole product UI
contract and must be wired through repository/session seams, not replaced or
paralleled. The MVP priority is the real operator workspace: available WAHA
history and private media, ACK and true realtime, then bounded canonical
amoCRM reads, Platform-owned lead memory/pgvector retrieval and real Gemini
qualification/replies.

Gemini may only return a structured RU/EN proposal. Deterministic server policy
may auto-send it solely as a reply inside the WhatsApp 24-hour service window
when every consent, opt-out, language, evidence, risk/confidence,
business-hours, cooldown/rate, staff-takeover, session-health, idempotency and
policy-version gate passes, explicit runtime enablement is present, and the
emergency stop/kill switch is not engaged. Cold outbound, broadcasts, autonomous follow-ups,
re-engagement, out-of-window free-form sends and direct model-to-WAHA access are
prohibited. Every other result becomes a durable human-review handoff.

This amendment preserves P4B activation/write work, recognizes merged bounded
read-only P4R1, keeps P9 removed and retains Lead Agent. No mock, SQLite shim,
hardcoded mapping, fake provider or silent fallback may substitute for
canonical amoCRM or provider evidence.

### Reconciled baseline

The first bullets below retain the P0 snapshot. The current sequential
checkpoint is:

- P0 plan/TZ/architecture merged in PR #75.
- P1A no-Visa-role migration merged in PR #76.
- P1B Admin-only Curator assignment/lifecycle merged in PR #77.
- P1C current-app object scope merged in PR #78.
- P1D current-root WhatsApp object-scope containment merged in PR #80.
- P2 Supabase-foundation decomposition merged in PR #81.
- P2A canonical migration authority merged in PR #82.
- P2B-P2H merged sequentially on `main`; this amendment recognizes them as
  reusable greenfield foundation rather than the active product slice.
- PR #93 merged the greenfield/UI boundary; PR #94 merged BW0; PRs #95-#97
  merged P3A-P3C; PRs #100-#103 merged BW1-BW4; PR #104 merged P2R0; PR #105
  merged P2R1; PR #107 merged the BW5 checkpoint amendment; PR #109 merged the
  P2R2 plan gate; PR #111 merged the P2R3 plan gate; PR #112 merged the P2R3
  repair; PR #113 merged BW5; PR #114 merged BW6; PR #116 merged BW7; PR #117
  merged P4A; and PR #118 merged the P4B plan at
  `10e5d85147ed6b87bfbd0281fc6ccce5464e8d3b`.
- PR #119 is immutable merged history but PR #128 supersedes it as current
  product authority. PRs #120, #122 and #124 were removed by reviewed revert
  PRs #127, #126 and #125. PRs #129-#130 then merged the bounded local-validation
  plan and repair. PR #132 merged the disabled-by-default P5A WAHA ingress,
  PR #133 merged the disabled-by-default P5B projection, PR #137 merged the
  P5C available-history reconciliation lane, PR #138 merged the P5D private
  WAHA media archive/display lane, PR #141 merged P5E ACK/session plus private
  Realtime, PR #142 merged bounded P4R1 read-only canonical amoCRM context,
  PRs #144-#146 merged P5F1-P5F3, PR #147 merged the P6A-P6D contract,
  and PRs #148/#149/#152/#153 completed P6A-P6D. PR #154 merged the P7
  contract, PR #156 completed P7A, PR #157 refreshed the accepted status and
  OrbStack-only rule, PR #160 completed P7B, and PR #163 merged the P7C
  authority contract plus managed project consolidation. Current `origin/main`
  is `8d16a551111add9d5e299db66bb519812473a89a`. Exact-main push CI
  `31810033100` is green, and migrations end at `072`.
- P4B implementation is preserved on remote branch
  `izzhackt/evo-platform-p4b-mapping-approval` at
  `e53ba94954f147b295f596421a255591fa343ce8`, with no implementation PR.
  Focused checks passed; the later full local Supabase gate failed closed in
  the real Auth/PostgREST hook before Playwright. Cleanup verification found no
  exact Platform resources/process/lock. This is failed/non-evidence, not P4B
  acceptance or provider proof.
- PR #108 exact head `f719b749efaadaf02c6344c5d01cd4b6bbe3d79c`
  is historical recovery evidence: it passed focused tests and CI but was
  closed without merge after controller
  comment `5166574008`: no prior plan authorization and no independently
  reproducible real local reset exit zero.
- PR #110 exact head `fd4428451793bdc59b3b183dcc9dde7518e80201`
  passed executor proof, exact-head CI and independent review but was closed
  without merge after controller comment `5171649961`: connected-route stale
  authority did not clear the resident Supabase browser cookie, and the
  controller's OrbStack endpoint did not permit the second physical-worktree
  local proof.
- Root `/whatsapp` remains a SQLite `wa_*` shadow surface with P1D
  authorization containment. It is not the unified communications backend;
  the greenfield application seam was established through P3C, while real
  provider completion remains P5.

- At the P0 snapshot, GitHub `main` and the clean P0 worktree resolved to
  `a16cd3fb`; the exact `EVO platform CI` run for that SHA was green and there
  were no open PRs.
- Production Inbox runs revision `a09a72fc`, release `2026-07-24.2`.
  Production CRM and Lead Agent run revision `564332b4`, release
  `2026-07-24.1`.
- The root app still uses SQLite/custom auth and local `wa_*` shadow tables;
  EVO Inbox still uses a separate Supabase model.
- The retained Lead Agent is frozen with worker, outbound, and automatic reply
  paths disabled; amoCRM readiness remains false.
- Read-only WAHA session queries returned `401` without a key, so current
  session state was not re-proved and no secret was read.
- No real WhatsApp/amoCRM end-to-end proof exists. Missing gates include exact
  amoCRM mappings/credentials, a dedicated sanitized test lead and number, QR
  owner, controlled-send authorization, release window, reconciliation window
  and rollback evidence.

### Immediate execution order

0. PRs #148, #149, #152 and #153 completed P6A-P6D, PR #154 merged the P7
   contract, PR #156 completed P7A, PR #157 refreshed accepted status plus the
   OrbStack-only rule, PR #160 completed P7B, and PR #163 merged the P7C
   authority contract plus managed project consolidation. Current main is
   `a8474eb57f94f952711e953be21b5e6041d2f36e`, migrations end at `072`,
   and exact-main push run `31820931774` is green. Preserve this accepted
   repository/local evidence and its non-production truth boundary.
1. Preserve P4B at
   `izzhackt/evo-platform-p4b-mapping-approval` / `e53ba94954f147b295f596421a255591fa343ce8`.
   Keep mapping activation and writes deferred. Merged P4R1 remains bounded
   read-only context without provider proof or mutation authority.
2. Defer the P7C encrypted database plus separate Storage recovery drill until
   the Platform is functionally complete and concretely operating. Keep
   automatic database backups enabled, do not create a billed recovery project,
   and leave the separate Inbox SaaS project `inbox-prod` untouched.
3. Preserve the merged focused P7D contract. Defer the large load test and
   temporary managed load environment without calling capacity passed. Prepare
   the real P8 candidate, then run the existing automated accessibility gate and the
   owner-led Mac/iPhone/Android human matrix on that exact candidate.
4. Do not infer canonical sales identity, responsible Sales, stage, Portal
   activation or contract handoff, and do not convert missing managed/provider
   evidence into a passed P7 claim.
5. P8 may prepare the real candidate after the P7D contract merges. A release
   decision remains blocked until focused accessibility and external-evidence
   accounting complete. Prove only executable P5-P7 plus P4R read paths. Report
   P4B activation/writes and unavailable provider segments as deferred, never
   passed or synthetically replaced.
6. Skip P9. Keep Lead Agent, the legacy webhook/session and rollback path
   deployed/frozen. Run P10 directly after P8 as an authorized-scope audit that
   lists P4B activation/writes deferred and does not claim full Platform
   completion.

### P7 authority and sequence

The implementation authority for P7 is append-only Block
`EVO-P7-SECURITY-RELIABILITY-PLAN-2026-08-13` in `docs/PLAN_CHANGES.md` and the
P7 section of `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`, expanded by
`docs/platform/p7-security-reliability.md` and the primary-source note
`docs/research/p7-official-evidence-2026-08-13.md`. P7A removes direct browser
audit-table access and connects the accepted Platform Settings surface to a
safe, bounded, replay-aware Supabase audit projection/export. P7B keeps
readiness, metrics, internal routes and Lead Agent operational surfaces private.
P7C follows `docs/platform/p7c-managed-recovery-contract.md` when the owner
resumes it: it will use the real managed source, a newly owned empty managed
destination, and separate encrypted database and Storage evidence. It excludes
the separate Inbox SaaS project `inbox-prod`. P7D now follows the focused
accessibility contract: high-load capacity stays deferred/unproved, while the
exact release candidate must pass the retained automated gate and approved
human review before release.

No P7 block authorizes public metrics, provider calls, customer-data exposure,
live sends, amoCRM writes, retention deletion or deployment. Only the exact
managed Supabase transfer and rename already completed under the P7C contract
supersede the earlier blanket provider/service prohibition. The deferred
recovery drill, production migration and destructive restore require fresh
action-time authority. P8 remains blocked until P7D completes and unavailable
evidence is recorded. P8 preparation may begin after the focused P7D contract
merges, but the release decision remains blocked until its accessibility proof
is complete.

### P5B authority and rollback contract

PR #133 merged as `18e0e0855fda31cba1fa837d81b3a75cedd585e9`
after its corrected exact head passed independent review, exact-head CI and the
full local Supabase/browser gate. Its accepted scope remains only a
disabled-by-default, amoCRM-independent projection worker behind the accepted
`/whatsapp` UI:

- private bodyless `POST /api/internal/platform-messaging/waha/work`, called by
  a private scheduler with UUID request ID, Unix-millisecond timestamp,
  `sha256` algorithm header and lowercase HMAC-SHA256 of
  `<request-id>.<timestamp>`;
- configured organization, exact `evo-inbox` session and `waha:evo-inbox`
  account only; verified inbound `provider_webhook_process` work only;
- service-only organization/session/provenance-bound claim, project and finish
  RPCs with a lease, bounded retry/manual-review disposition and no finish on
  invalid repository output;
- `sales_authority_source='platform_intake'` means only a Platform intake queue,
  never canonical amoCRM Sales ownership;
- raw WAHA chat/message identifiers stay in private append-only bindings and
  never appear as phone-bearing identifiers in public rows;
- valid media-only inbound remains pending/actionable and operator-visible; it
  is never terminally consumed solely because text is absent;
- no provider call, send, amoCRM write, production migration or legacy
  cutover. Rollback keeps feature flags off, reverts code and forward-fixes the
  additive schema; no destructive down migration. Lead Agent and the legacy
  path remain available.

P5B does not authorize AI or provider claims. History/media reconciliation,
ACK projection and Supabase Realtime are later independently reviewed P5
blocks and precede the autonomous-reply lane.

### P5C authority and rollback contract

Block `EVO-P5C-WAHA-HISTORY-2026-08-10` adds only a disabled-by-default,
server-side reconciliation lane for history that the existing WAHA store can
actually return for the exact `evo-inbox` session:

- the private trigger is HMAC-authenticated and requires an explicit feature
  flag, tenant, private WAHA origin, provider credential and service-only
  Supabase credential;
- provider access is read-only: session preflight plus paginated `GET` chat and
  message history with `downloadMedia=false`. It sends no message, sets no read
  marker and changes no WAHA session or webhook;
- NOWEB must explicitly report its store enabled; supported engines and
  `WORKING` session state fail closed before reconciliation;
- only direct chats enter this block. Inbound and historical outbound rows are
  projected behind the accepted `/whatsapp` UI, while raw WAHA chat/message
  identifiers remain private and browser-visible provider/amoCRM IDs stay null;
- cursor movement, page effects, replay evidence and lifecycle state are
  service-only, organization/session-bound and atomic. A provider/repository
  failure leaves the last committed cursor resumable;
- media-only history becomes an operator-visible marker. P5C does not download,
  archive or display media bytes; private media is the next P5 block;
- the configured Sales membership is an intake authorization only. P5C creates
  no canonical amoCRM identity, Sales owner, stage or handoff claim;
- synthetic local adapter/browser evidence proves the Platform path only.
  Real WAHA history completeness and provider behavior remain blocked until a
  separately authorized controlled provider run.

Rollback keeps P5C disabled, reverts the route/worker code and forward-fixes
the additive migration. It performs no destructive down migration, provider
mutation, production migration or legacy-path retirement.

### P5D private WAHA media authority and rollback contract

Block `EVO-P5D-PRIVATE-WAHA-MEDIA-2026-08-10` adds only the private-media
archive and authorized display path behind the accepted root `/whatsapp` UI.
It is deliberately separate from ACK/session projection and Supabase Realtime,
which remain the next independently reviewed P5 block:

- the Platform may archive media only for an already projected P5B/P5C
  communication message whose raw WAHA identity and source evidence remain in
  the reviewed private bindings;
- the server re-fetches one exact message with `downloadMedia=true`, validates
  the exact `evo-inbox` session, direct chat, message identity and configured
  private WAHA origin, rejects redirects and enforces bounded timeout/size;
- WAHA URLs and API keys never reach the browser. Object names are opaque,
  contain no phone, chat, contact, student or provider locator, stay out of RPC
  rows/page content and may appear only inside a short-lived audited Storage
  download URL;
- bytes are written through the Supabase Storage API to the fixed private
  `platform-whatsapp-media` bucket. Application SQL never inserts or updates
  Storage catalog rows directly;
- missing provider media, unsupported or unsafe inline content, oversize
  objects, Storage failure and binding conflict remain explicit archive states
  or staff handoff. They never become silent success or fabricated media;
- media-only messages stay operator-visible and remain in human-review state.
  P5D performs no media understanding, Gemini call or autonomous reply;
- no WAHA send/read marker, ACK/session mutation, amoCRM write, production
  migration, legacy-path change or service deletion is authorized.

Rollback keeps the archive worker disabled, reverts server/UI code and
forward-fixes additive schema. It does not delete archived objects or apply a
destructive down migration. Real-provider completeness and production
retention/restore remain blocked until separately authorized evidence exists.

### P5E WAHA ACK/session projection and private Realtime authority and rollback contract

Block `EVO-P5E-WAHA-ACK-SESSION-REALTIME-2026-08-10` keeps the accepted Claude
Design `/whatsapp` UI and adds only the next bounded P5 truth path after P5D:
durable ACK/session projection plus private Realtime invalidation. It consumes
only already verified P5A signed WAHA work and exposes only safe delivery and
session-health state through the existing server truth path:

- the disabled-by-default server worker may project exact `message`,
  `message.any`, `message.ack` and `session.status` observations for one
  organization-bound, session-bound lane. Existing P5B message projection
  semantics remain unchanged;
- ACK projection requires the exact documented integer/name pairs
  `ERROR/-1`, `PENDING/0`, `SERVER/1`, `DEVICE/2`, `READ/3` and `PLAYED/4`,
  plus exact private message binding and observation time. Missing bindings,
  cross-tenant/session mismatches, malformed pairs, inbound targets or stale
  regressions fail closed;
- current session health is bounded to the exact `evo-inbox` session and is
  observe-only. The Platform may not start, restart, log out, pair, mark read
  or reconfigure WAHA in this block;
- record-free private Database Broadcast invalidations may be emitted only on
  `platform-messaging:<organization UUID>`. Browser subscribers are
  receive-only and authenticated; no browser send/insert permission exists;
- Broadcast data is an invalidation hint only. The browser must refetch
  authoritative RLS-scoped state after subscribe, reconnect, visibility restore
  and accepted invalidation through bounded `router.refresh()`. Payload fields
  never merge directly into UI state;
- the accepted UI may show safe ACK name/time and safe session health, but raw
  WAHA chat/message/contact identifiers and raw provider payloads remain
  private. Unknown session values render unhealthy/unknown, never healthy;
- this block does not authorize provider send/read markers, amoCRM writes,
  production mutation, legacy-path retirement or any change to the autonomous
  send gate. The later AI/send lane still follows the ADR 0019 deterministic
  reply-only policy.

Validation requires focused ACK/session parser and replay-denial tests,
disposable PostgreSQL RLS/grant/topic checks, no raw-ID exposure proof,
private receive-only Realtime authorization, accepted browser update without
reload plus reconnect catch-up proof, and the full local Supabase/Auth/Storage/
PGMQ/browser gate under the repo singleton protocol. Synthetic local WAHA and
Broadcast evidence prove only the adapter, authorization and UI integration;
real-provider proof remains blocked.

Rollback keeps P5E disabled, reverts worker/UI code and forward-fixes additive
schema. It does not apply destructive down migration, mutate WAHA session
state, delete historical evidence or retire the frozen Lead Agent / legacy
rollback path.

### P4R1 bounded live canonical amoCRM read authority and rollback contract

Block `EVO-P4R1-AMOCRM-CANONICAL-CONTEXT-2026-08-10` adds the smallest
read-only amoCRM context behind the accepted `/whatsapp/[id]` thread. It does
not resume the deferred P4B approval/activation implementation.

- The server may read only the exact amoCRM account, contact, lead,
  responsible-user, pipeline and status identified by provider IDs already
  attached to the authorized Platform conversation. It may not search by name
  or phone, infer a link, select a mapping, or create an identity.
- The adapter is disabled by default and accepts only a validated HTTPS
  `<subdomain>.amocrm.ru` or `<subdomain>.kommo.com` origin plus a server-only
  read credential. The credential never reaches browser code, URLs, logs,
  errors or committed configuration.
- The provider account ID must equal the conversation account ID. Contact and
  lead responses must cross-reference each other, the lead's pipeline/status
  must resolve inside the exact provider pipeline, and a returned user must
  equal the lead's responsible-user ID. Any mismatch fails closed.
- The accepted UI may show only sanitized contact, lead, responsible-manager,
  pipeline/stage names, active status and the observation time. Missing IDs,
  configuration, scope, provider availability or administrator-only user
  access produces an explicit disabled, blocked, degraded or stale state.
- Supabase records an append-only refresh observation for each completed live
  attempt and a bounded current read projection for the authorized UI. A
  failed refresh preserves the last successful value only with an explicit
  `stale` state and original observation time. Browser actors receive it only
  through the existing live-authority and conversation-scope checks.
- The projection records the provider account/entity relationships actually
  verified, the exact adapter-contract version, observed endpoint
  capabilities, refresh outcome and time. It is not P4B mapping approval,
  custom-field semantic mapping, provider proof, AI authority or a handoff
  signal.
- No legacy SQLite settings or existing mutable amoCRM adapter may supply this
  Platform path. This block adds no approved mapping pointer, P4B event,
  task/call/chat read, webhook/poll reconciler or autonomous-send input.
- Official GET-only CRM endpoints are the account, contact-by-ID,
  lead-by-ID, pipeline-by-ID and user-by-ID APIs. The user lookup is allowed to
  degrade independently because the official Users API is administrator-only.
  Kommo Chats API is not required when the exact CRM entity IDs already exist.

Validation requires focused config/parser/client/repository and fail-closed
tests, append-only/idempotency/RLS/tenant/conversation-scope SQL tests,
secret-containment/client-boundary checks, accepted-thread integration checks,
root lint/type/build/unit/security gates, exact-head CI and one fresh
independent exact-head review. Synthetic fetch responses are adapter tests, not
real-provider proof. A live sanitized amoCRM read remains `blocked` until a
valid read credential and dedicated test entities are separately supplied and
authorized.

Rollback leaves the feature disabled or reverts server/UI code and forward-
fixes the additive schema; no destructive database down migration is allowed.
P4B remains preserved/deferred and Lead Agent plus the legacy rollback path
remain frozen and available.

### P5F authority and sequence

Block `EVO-P5F-AI-MEMORY-REPLY-LANE-2026-08-10` was the accepted docs-only
authority gate after merged P4R1. It preserves the accepted Claude Design
frontend as the sole UI contract, keeps P4B activation/writes deferred, keeps
P9 removed, and retains Lead Agent plus the legacy rollback path as
deployed/frozen. Its P5F1-P5F3 implementation slices are merged, and P6A-P6D
are now complete. P7-PLAN, P7A and P7B are also complete. The active plan group
is P7C, gated P7D, narrowed P8 and P10.

P5F SHALL be implemented in three independently reviewed slices:

- `P5F1` — Platform-owned durable conversation-scoped memory, approved-
  knowledge chunks, retrieval audit, RLS and pgvector foundation.
- `P5F2` — stateless Gemini structured qualification/reply proposal adapter.
- `P5F3` — deterministic policy-owned autonomous reply intent and worker.

Every P5F implementation slice SHALL remain disabled by default, SHALL carry no
real-provider success claim without sanctioned credentials and runtime proof,
and SHALL fail closed to durable human review whenever any required runtime
input, policy gate or provider response is missing, invalid or ambiguous.

### P5F1 authority and rollback contract

`P5F1` SHALL add only the Platform-owned memory and retrieval foundation.

- Supabase SHALL own durable conversation-scoped memory, explicit facts,
  qualification state, takeover/pause state, approved-knowledge chunk
  references and retrieval audit. Neither per-client filesystem agents nor
  Gemini server-side state/cache may be a source of truth.
- Migration `065` SHALL establish only additive schema for staff-controlled
  memory, approved-knowledge chunks, retrieval audit, RLS and pgvector. It
  SHALL NOT add Gemini execution, WAHA send, amoCRM writes or production
  enablement.
- The embedding target SHALL be `gemini-embedding-2` at a fixed `1536`
  dimensions. Provider-backed ingestion remains disabled by default and real
  provider proof remains blocked until sanctioned credentials and test data
  exist.
- Any lexical-only retrieval preview SHALL be explicit degraded staff preview
  only. It SHALL NOT authorize deterministic autonomous replies, SHALL NOT be
  presented as equivalent to approved retrieval, and SHALL fail closed for
  autonomous policy evaluation.
- No public RPC or UI may expose raw WAHA identifiers, phone-bearing provider
  identifiers, raw amoCRM entity identifiers, private retrieval internals or
  provider secrets.

Validation SHALL require focused schema/RLS/retrieval tests, build/lint/
typecheck, exact-head CI and one fresh independent exact-head read-only review.
Rollback SHALL keep runtime flags off, revert code, and forward-fix additive
schema only.

### P5F2 authority and rollback contract

`P5F2` SHALL add only the Gemini proposal adapter.

- Gemini SHALL be called through stateless Interactions with storage disabled
  (`store=false`). Official provider retention is finite and SHALL NOT replace
  Platform-owned durable memory or audit.
- The model SHALL be runtime-configured through an allowlist. The P5F-specific
  initial sanctioned model is the owner-named `gemini-3.5-flash`. Google's
  current catalog also lists `gemini-3.6-flash` as stable, but the older generic
  target note does not authorize it for P5F without a separate eval and plan
  update. Any later model change requires a decision-log update and fresh
  validation.
- The adapter SHALL use bounded conversation context, bounded retrieval
  evidence, bounded read-only amoCRM context and explicit token budgets. It
  SHALL return JSON-schema-constrained structured RU/EN proposals only.
- Gemini SHALL NOT call WAHA, SHALL NOT own transport retries, SHALL NOT imply
  send success, and SHALL NOT write amoCRM.
- Missing credentials, invalid provider configuration, malformed structured
  output, unsupported language, low confidence, missing evidence or unsafe
  semantics SHALL fail closed to durable human review.

Validation SHALL require focused adapter/contract tests, structured-output
validation, build/lint/typecheck, exact-head CI and one fresh independent
exact-head read-only review. Real provider execution remains honestly blocked
until sanctioned credentials exist. Rollback SHALL keep the adapter disabled
and forward-fix additive audit schema only.

### P5F3 authority and rollback contract

`P5F3` SHALL add only deterministic autonomous reply gating and durable send
intents.

- Deterministic Platform policy SHALL be the only authority that can create a
  WAHA `reply_to` send intent. Gemini SHALL remain proposal-only.
- An autonomous reply SHALL be permitted only for the same conversation and the
  exact inbound trigger, inside the rolling WhatsApp `<=24h` service window,
  with fresh consent/opt-out, approved citations/evidence, known language,
  confidence/risk pass, business-hours pass, cooldown/rate pass, staff
  takeover/pause clear, session-health pass, unused idempotency key, matching
  policy version, explicit autonomous-reply runtime enablement and an emergency
  stop/kill switch that is not engaged.
- The worker SHALL re-check every mutable gate immediately before transport.
  Media-only, unsupported or ambiguous inputs SHALL fail closed to human
  review.
- No cold outbound, campaign/broadcast, autonomous follow-up/re-engagement,
  out-of-window free-form send, direct model send or silent fallback is
  authorized.
- The owner authorized autonomous-reply code only. Production enablement, live
  customer sends, provider credentials and real provider proof remain separate
  blocked events that require explicit later authority.

Validation SHALL require focused policy/queue/worker/idempotency tests,
exact-head CI and one fresh independent exact-head read-only review. Synthetic
local adapter proof does not count as real provider proof. Rollback SHALL keep
autonomous runtime flags off, hold or drain queued intents safely, and
forward-fix additive schema without destructive down migration.

### P6 authority and sequence

Block `EVO-P6-OPERATIONS-PORTAL-PLAN-2026-08-11` decomposes P6 into four
sequential gates. The exact contract is
`docs/platform/p6-operations-portal.md`.

- `P6A` makes existing Platform-owned overdue/attention state explicit in the
  accepted Portal without any notification side effect or read-time write.
- `P6B` wires durable self-only notifications and persisted read state into the
  accepted Student Portal, starts with reviewed negative document outcomes and
  uses private Realtime invalidation rather than polling or public payload.
- `P6C` adds disabled-by-default, idempotent overdue-transition publication
  from explicit Platform task/payment due data. Reading a page never writes a
  notification and no deadline may be inferred from amoCRM.
- `P6D` proves the final two-Student and cross-organization path across
  applications, visa, reasoned close/reopen, private documents, manual finance,
  overdue Portal action and notification/read state.

Migration 043 remains immutable. Its consent-gated individual-WhatsApp intent
is durable state only; P6 does not claim, route or dispatch it. P6 also does not
copy the legacy SQLite staff notification feed or infer sales identity, stage,
responsible Sales, Portal activation or canonical handoff. P6 is complete only
after P6D passes. Individual WhatsApp notification delivery remains a separate
future target; this P6 plan neither cancels nor activates it.

P6A-P6D merged in PRs #148, #149, #152 and #153. Exact-main push run
`31650640795` is green at
`1e53d93d8c70c286e56c5d057928e9f080c58a44`; this completes the repository
and synthetic/local P6 gate without creating managed, provider or production
proof.

### Merged P2R3 acceptance record

- The server verifies the exact access token returned by successful Supabase
  login with `getClaims(accessToken)` before resolving the live database
  authority bundle. Missing/invalid claims, blocked membership or RPC failure
  fail closed and clear the Platform session.
- Protected connected routes hand invalid authority to the exact same-origin
  `src/app/auth/platform-session/route.ts`. That response-writable handler
  independently rechecks claims plus live authority, preserves a recovered
  valid actor, and otherwise expires only the Platform Supabase auth-token
  cookie/chunks before redirecting to a bounded login error. Query parameters
  are not authorization proof; legacy root-auth cookies remain untouched.
- Real local Playwright starts with an authenticated Platform session, makes
  the live authority revoked or version-stale, exercises the connected route,
  and proves the browser no longer holds the Platform auth cookie. A direct
  handler request with valid authority must preserve the session.
- `getSession()` is never a server authorization source; self-registration,
  legacy-account import and root-auth fallback stay disabled.
- The deadline runner executes its child and propagates the true exit code from
  both logical symlink and physical worktree paths.
- The normal real `npm run test:supabase:local` path exits zero after migrations
  001-055 and proves Auth/PostgREST/RLS/browser/Storage/PGMQ behavior. Retries
  remain bounded and transient-only; diagnostic output is redacted.
- Cleanup proves no exact-project lock, container, volume or network remains and
  preserves unrelated Inbox resources. Broad prune and daemon restart are
  forbidden.
- P2R3 owns only the original P2R2 auth/reset files plus
  `src/lib/platform-guards.ts`, `src/proxy.ts`,
  `src/lib/supabase/auth-cookies.ts`,
  `src/app/auth/platform-session/route.ts` and
  `tests/platform-auth/platform-auth.spec.ts`. It owns no migration, provider,
  production, restore or cutover behavior.
  Executor and independent physical-worktree evidence, exact-head CI and a new
  SHA-bound review are all required before controller merge.

### Business-workflow scope

- OP active stages: new, contacting, qualified, meeting scheduled, meeting
  completed, potential and contract signed. No-answer/no-show are follow-up
  outcomes; event/collaboration values are source/deal metadata; closure
  requires an explicit result and reason. amoCRM mappings remain
  account-specific and canonical.
- OZO uses one common admissions lifecycle with independent application,
  document, visa, finance, housing, insurance and travel statuses. China,
  Italy, Czech/Poland, UAE/Turkey and Malaysia are versioned overlays, not
  separate applications.
- Student Profile uses a minimized country-neutral core plus versioned
  country-specific requirements. Sensitive documents use the private document
  path only.
- Requirements/checklists, prompt/knowledge, Q&A decisions, catalogs/imports,
  document templates and generated contracts are versioned, source-aware and
  approval-gated. Generated contracts remain drafts until authorized staff
  approval.
- University import is blocked while the linked Notion workspace is
  inaccessible. Colleges and Accounting/Bema remain discovery gaps rather than
  invented modules.
- AI produces RU/EN structured proposals from approved knowledge and Platform
  memory. Deterministic server policy may auto-send only a qualified inbound
  reply inside the 24-hour window; Kyrgyz, uncertain language, sensitive/media
  input or any failed guardrail requires durable human review.
- Linked Google Docs/Sheets/Drive/PDF/Notion inputs are discovery/import
  sources, never the runtime database or a public dependency. No customer PII,
  folder names or documents may enter Git, fixtures or logs.

### Business-workflow acceptance

- BW1 proves versioned source/provenance and normalized domain contracts
  without PII.
- BW2 proves OP/OZO actions through real repositories, RLS, permissions and
  audit behind the existing frontend, with no localStorage or demo fallback.
- BW3 proves Student Profile and country checklists across staff and portal,
  including cross-student denial and historical overlay-version retention.
- BW4 proves approved prompt/knowledge, Platform memory, structured proposal,
  deterministic send/handoff lifecycle, RU/EN and the manual-language failure
  path.
- BW5 performs no real catalog import until authorized source access exists;
  staging/validation/rejection must not auto-publish.
- BW6 proves typed approved-field contract generation, draft/approval
  separation, immutable versions and audit.
- BW7 proves the complete local/staging Supabase workflow through the accepted
  frontend. It does not imply production/provider readiness without real
  authorized service exercise.

### Merge-order boundary

BW0, P3A-P3C, BW1-BW7, P2R0-P2R4, P4A, PR #128 and P5A are merged history.
This amendment is the only active docs-only block. P4B activation/writes are
preserved/deferred; P4R owns bounded canonical reads, P5 owns real WAHA/
history/media/realtime/AI/ACK proof, and P6-P7 own independent operational/
security scope. No lane may replace amoCRM with a mock, SQLite shim, hardcoded
mapping, fake provider or silent fallback. P10 follows P8; P9 is removed from
the authorized scope and Lead Agent remains deployed/frozen.
Shared migrations are selected only after fetching current main and checking
open ownership; merged migrations are immutable.
- `crm.evoadmissions.com` and `inbox.evoadmissions.com` have no DNS answer.
  The fallback CRM URL responds.
- The original checkout's modified Malaysia knowledge-base document and
  untracked presentation archive are owner work outside this goal.

### Ordered platform blocks

P0–P10, their exact exit evidence, validation commands, protected operations,
remaining owner decisions and the independent-review/merge-controller protocol
are defined in `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`.

- P0: plan/TZ/DOCX/ADR and target architecture, docs-only.
- P1: current-app role/RBAC/handoff correction. P1A-P1D are merged.
- P2: unified Supabase foundation. P2A is merged; P2B–P2H are reusable
  foundation and former P2I restore duties move to a later reliability lane.
- P2R0/P2R1: merged docs-only reliability gate and bounded local Supabase
  proof-path/document lock-order repair in PRs #104/#105.
- P3: thin messaging slice behind the existing unified frontend; P3A-P3C are
  merged with local-only, no-provider evidence.
- P4/P4R: preserve P4B activation/write checkpoint; resume bounded canonical
  reads after the messaging foundation.
- P5: unified Inbox/WAHA/Lead Agent messaging capability with history/media,
  ACK, true realtime, Platform memory and gated inbound-reply autonomy.
- P6: amoCRM-independent Admissions/Portal/Documents/Finance/Notifications.
- P7: security, reliability and operations.
- P8: narrowed real executable P5-P7 plus proved P4R read evidence; P4B
  activation/writes and unavailable provider segments remain deferred, and no
  production action is authorized.
- P9: removed from current execution scope; no soak or Lead Agent retirement.
- P10: authorized-scope evidence audit, with P4R read evidence, P4B activation/
  writes deferred and Lead Agent retained; not a full-Platform completion claim.

Only one implementation PR may be open. The owner removed the scheduled Launch
Auditor and separate merge-controller. After a separate independent read-only
reviewer approves the exact head and every required exact-head CI job passes,
the executor may directly merge that same SHA with a head-matching merge
command. Green exact-main push CI is required before the next implementation
PR. No production deployment, migration, DNS, WAHA session mutation, live
customer send, real amoCRM mutation or service deletion is authorized by this
plan.

### Completed P1D contract: current-root WhatsApp object scope

P1D applies only to the root CRM's current SQLite/custom-auth `/whatsapp`
surface. It is authorization containment before P2-P5, not a substitute for the
unified Supabase/Inbox/WAHA target.

The merged implementation:

- scope list/detail/message reads in SQL to Admin, responsible Sales before
  handoff, assigned Curator after handoff, and a safe summary-only projection
  for the former responsible Sales user;
- deny Finance, Student, unrelated staff, broken links and unlinked rows for
  every non-Admin actor;
- grant lead-only Sales access only when both the conversation and the resolved
  lead have no case link; indirect lead-to-case and conflicting case links are
  Admin-only until reconciliation;
- keep post-handoff Sales away from transcript, phone/message previews,
  provider/amoCRM/WAHA identifiers, draft/reason metadata and send/read/draft
  actions;
- enforce the same object policy in direct routes, lead-page lookups, replayed
  Server Actions and `/api/ai/draft` before protected reads, mutation, AI or
  WhatsApp provider access;
- suppress WhatsApp-derived unread/count/recency/response aggregates at the
  shared query boundary for Sales, dashboard, calls and tasks whenever the
  actor lacks full conversation access;
- make manual conversation creation Admin-only until P4/P5 can prove canonical
  ownership during resolution/linking;
- preserve the accepted frontend structure while hiding inbox and shared
  TopBar controls that cannot succeed for the current actor.

P1D has no database migration and no real-provider proof requirement. It must
not change the WAHA session/webhook, Lead Agent, EVO Inbox Supabase model,
message transport, ACK/outbox/retry/reconciliation behavior, provider
configuration or production state. Full details and the actor matrix are in
`docs/platform/p1d-root-whatsapp-scope.md`.

### P2 plan amendment: canonical Supabase foundation

ADR 0014 remains the unified target decision. ADR 0015 refines its Supabase
implementation boundary:

- root `supabase/` becomes the sole migration authority in P2A;
- legacy migrations 001–039 move byte-for-byte with a checksum manifest and no
  migration 040 in P2A;
- `public` remains the legacy Inbox compatibility schema;
- `platform` is the new exposed schema with explicit grants and RLS on every
  table;
- `platform_private` is backend-only and absent from the Data API;
- browser roles have no `platform_private` or `pgmq_public` access;
- legacy Inbox `owner/admin/agent/viewer` roles never map implicitly to
  Platform `admin/sales/curator/finance/student`;
- target machine role `student` is displayed as Client/Student; the current
  root `client` identifier is not imported or mapped into Platform without a
  later explicit scoped decision;
- the legacy signup trigger may keep legacy Inbox behavior but grants no
  Platform membership.

P2 has the following strict dependency order:

1. P2A establishes the canonical root config/history/test harness without a
   new migration.
2. P2B begins at the next free migration number, expected 040, and establishes
   schemas/grants plus verified legacy secret-bearing-column containment while
   preserving current Inbox compatibility.
3. P2C adds Platform identity, RBAC and base audit.
4. P2D adds cases, assignments/handoff, applications, visa and tasks.
5. P2E adds document metadata, finance and durable notification state.
6. P2F adds communications/provider mappings, raw events, approved knowledge
   and draft-only AI records without a live-provider claim.
7. P2G proves retryable work through real local Supabase Queues/PGMQ, including
   idempotency, dead-letter and reconciliation.
8. P2H proves new private Platform buckets/policies through the real local
   Supabase Storage API.
9. P2R1 repaired only the already-merged local proof path and merged immutable
   migration `055_platform_document_finalization_lock_order.sql` in PR #105. It
   added no production apply, provider call, restore claim or product feature.
10. Former P2I whole-foundation reset/RLS/grant/secret and separate database/
    Storage restore duties are transferred to P7.

Merged migrations are immutable; defects use the next free forward migration.
P2 is additive and does not rename/drop legacy tables, cut root auth over,
copy real secrets, silently privatize legacy `avatars`/`flow-media`, or apply a
production migration. A handcrafted queue or Storage mock is not service
proof. Local service evidence does not prove remote migration-ledger parity,
managed branching, production configuration, paid-plan PITR or managed
restore; those remain blocked by region/plan, credentials and production
authority.

Detailed ownership, negative matrices, rollback and provider boundaries are in
`docs/platform/p2-supabase-foundation.md`.

P2R1 exits only when the real local `npm run test:supabase:local` path proves
admin-provisioned Auth/RLS, private Storage, PGMQ terminal semantics and exact
disposable-resource cleanup under Node 22.23.1. The document finalization lock
repair must be a next-free forward migration with concurrent finalization and
review regression evidence. Local proof is not managed Supabase, provider,
backup/restore or production proof.

### Historical pre-platform blocks

The following A–G record is retained as prior hardening history. It is not the
active merge order; P0–P10 above and the long-run plan now control new work.
Any retirement or full-target completion language below is historical and is
superseded for current execution by ADR 0018.

Every block starts from refreshed GitHub `main`, has one coherent PR, real
validation, and a separate launch-control reviewer verdict of `approved`.
Shared migrations, deployment files, and plan files merge sequentially.

1. **A — critical authorization containment**
   - Prevent profile, account, membership, ownership, or role self-promotion.
     System-owned identity, membership, role, account, and provider/audit fields
     may change only through authorized server paths.
   - Inventory exposed Supabase tables, views, RPCs, grants, RLS/storage
     policies, and `SECURITY DEFINER` functions. Deny cross-account writes and
     remove unnecessary authenticated/anonymous grants.
   - Add disposable PostgreSQL role-policy tests using JWT claims for ordinary
     staff, privileged staff, and `service_role`, including negative
     insert/update/delete/RPC and cross-account cases. Table-owner execution
     does not prove RLS because owners normally bypass it.

2. **B — main CRM sensitive surfaces**
   - Authenticate and admin-gate Transcription Lab plus upload, job, SSE,
     detail, and improvement endpoints, or disable the complete production
     surface when no approved operator role can be proven.
   - Enforce server-side upload type/size/count limits, bounded processing, safe
     names, failure cleanup, retention/deletion, and non-sensitive audit output.
     Edge limits supplement but do not replace application validation.
   - Require production-safe secret encryption and fail closed when secure
     encryption configuration is unavailable.
   - Add negative permission tests for finance, documents, client/portal data,
     AI routes, and transcription routes.
   - Public registration versus invite-only access is an owner decision. Stop
     before changing `/register`, account creation, or invite policy without it.

3. **C — privacy and media truthfulness**
   - Keep customer documents/media in private storage with account-scoped RLS
     and short-lived authorized access. Never expose public bucket URLs or
     service-role keys. Audit upload, access grant, deletion, and retention
     without customer content.
   - Verify real WAHA media receive/send support. Disable unsupported media UI
     instead of storing or displaying simulated capability.
   - Define retention/deletion for CRM files, Inbox media, transcripts, AI
     drafts, outbound attempts/messages, ACK evidence, and logs. Preserve
     #47/#48's append-only delivery evidence; do not recreate or weaken it.

4. **D — Lead Agent minimal containment**
   - Prove whether the production Lead Agent is still an active inbound webhook
     owner. Keep outbound and automatic replies disabled.
   - If active, add bounded replay rejection, atomic crash-claim
     lease/recovery, idempotent amoCRM side effects, deterministic
     phone/contact/lead selection, and non-sensitive liveness/readiness output.
   - If unused or blocked by credentials, freeze it disabled and document the
     exact blocker. Retirement requires a separate future owner decision.

5. **E — runtime and deployment hardening**
   - Build on PR #46 rather than repeating it. Verify third-party images by
     immutable digest and first-party images by Git revision/version labels.
   - Separate liveness from dependency/provider readiness. Validate private
     endpoints, Caddy routing, CSP/cache/security headers, application/edge
     request limits, resource limits, correlation IDs, actionable logs/alerts,
     and rollback evidence.
   - Use current official Docker, Caddy, Next.js, Supabase, WAHA, and amoCRM
     documentation. Validate real Compose/Caddy/runtime state without secrets or
     customer data. Canonical DNS remains an owner-controlled external action.

6. **F — backup and disaster recovery**
   - Inventory main CRM SQLite/files, managed Supabase database and Storage
     objects, retained Lead Agent SQLite/token state, encrypted settings, WAHA
     session/relink material, and release configuration.
   - Define owner-approved RPO/RTO per store. Supabase database backups do not
     include Storage objects, so their recovery procedures are separate.
   - Restore only into isolated disposable destinations, never production.
     Verify integrity, schema/version, application reads, protected-key
     decryption, and the documented WAHA relink procedure.

7. **G — final acceptance and completion audit**
   - Map every requirement to merged PRs, clean Git state, real test/runtime
     evidence, or an exact external blocker.
   - Prove role denials, restart persistence, duplicate/replay behavior,
     provider-outage handling, zero automatic customer reply, isolated restore,
     production image-to-Git mapping, and no open hardening PR.
   - Run a real WhatsApp/amoCRM path only with real credentials, an
     EVO-controlled sender/recipient, and explicit approval for the visible
     manual reply. Missing inputs are blockers; mocks do not satisfy this plan.

### Remaining internal closure lanes

These lanes close newly confirmed internal gaps before Block G can be
re-audited. Each lane starts from refreshed `main`, uses a coherent PR, passes
real validation, and receives a separate launch-control reviewer verdict.

1. **CI enforcement for PostgreSQL authorization**
   - Require the existing real-role harness
     `scripts/test-postgres-authorization.sh` through the
     repository-root `npm run test:security` gate in GitHub Actions.
   - Provision only safe ephemeral/disposable PostgreSQL for CI. Do not connect
     the harness to production or require committed/runtime secrets.
   - Prove the workflow actually executes ordinary-staff, privileged-staff, and
     `service_role` allow/deny cases, including forbidden writes, rather than
     accepting SQL text inspection as equivalent evidence.

2. **Non-disruptive CRM checkout and permission reconciliation**
   - Inventory `/opt/evo-crm` and preserve every dirty or untracked item in a
     recoverable, access-restricted archive before changing the operational
     checkout.
   - Reconcile `/opt/evo-crm` to the exact reviewed source corresponding to the
     currently deployed CRM/Lead Agent revision. Prove the resulting Git state
     and image-to-Git mapping without building, recreating, restarting, or
     otherwise changing running services.
   - Audit legacy environment/configuration file ownership and modes without
     printing values. Tighten permissions only when the target and runtime
     access requirements are proven and the change is non-disruptive; otherwise
     record the exact blocker.

3. **WAHA runtime-limit drift containment**
   - Record the live finding that WAHA has unset `Memory`, `NanoCpus`, and
     `PidsLimit` despite reviewed Compose limits.
   - Do not recreate, restart, relink, or mutate WAHA to apply those limits
     until a QR/relink and session-continuity procedure is ready and the owner
     explicitly approves the user-visible provider risk.
   - Until approval, treat the runtime drift as an explicit Block E/G blocker,
     preserve WAHA privacy, and make no claim that its Compose limits are active
     in the running container.

Owner/external gates remain unchanged: canonical DNS, public registration
policy, monitoring destination and responsible owner, retention schedule and
owner, CSP enforcement, RPO/RTO, provider acceptance inputs/approval, and the
deferred real Supabase database-plus-Storage backup and isolated restore
rehearsal. None may be inferred or marked complete from automated tests.

### Historical write boundaries and merge order

The ownership list below applied to the pre-platform A–G hardening program. It
does not authorize current P2 work; P2A–P2H, later reliability work and the
long-run contract control.

- Plan-only PR: `docs/EVO_LAUNCH_PLAN.md` and append-only
  `docs/PLAN_CHANGES.md`.
- A owns Inbox authorization migrations/helpers/policy tests and merges before
  any later Inbox schema work.
- B owns main CRM guards, transcription, secret handling, and sensitive-surface
  tests.
- C owns private media/storage policy, signed access, truthful media UI,
  retention/deletion, and audit events; it starts after A and B.
- D owns only `evo-lead-agent/**` plus directly required deployment/docs.
- E owns shared Dockerfiles, Compose, Caddy, observability, deployment
  scripts/runbooks, and release metadata.
- F owns backup/restore scripts and runbooks and follows E for shared files.
- G owns audit evidence and plan status. DNS/provider mutation is excluded
  unless separately authorized with required inputs.

### Required evidence

- Real disposable PostgreSQL role-policy execution, not SQL text matching.
- Focused negative tests plus full affected lint/type/test/build/audit gates.
- Real browser allow/deny checks for affected roles and surfaces.
- `git diff --check origin/main..BLOCK_SHA` and redacted secret scanning.
- Real production Compose/Caddy rendering without printing secret values.
- Restart/persistence and isolated restore evidence where applicable.
- Separate independent reviewer approval before each merge.
- No scheduled Launch Auditor or separate merge-controller wait. Direct merge
  is allowed only for the independently approved SHA after exact-head CI, and
  exact-main push CI must pass before continuing.
- The full Codex Security workflow is not required for this run; focused
  authorization/RLS/security tests and scoped secret/PII checks remain gates.

### Stop conditions

- Stop before changing registration/invite behavior without the owner's policy.
- Stop before DNS mutation without authoritative access and owner approval.
- Stop before real outbound WhatsApp without real credentials, a dedicated test
  sender/recipient, and explicit approval for that reply.
- Stop before destructive or production restore actions; rehearsals must be
  isolated.
- Stop Lead Agent expansion if active ownership cannot be proven.
- Stop if architecture, schema, acceptance, or merge-order changes lack an
  append-only `PLAN_CHANGES.md` entry.
- Never print, commit, or copy secrets or customer data into evidence.

## Historical Completed EVO Platform Frontend Slice

Historical slice: `/goal-evo-platform-frontend`.

This section records the then-current runtime and acceptance contract for the
completed frontend work. Its legacy `visa` role matrix is historical evidence
only and is superseded for all P1+ implementation by
`docs/EVO_PLATFORM_LONG_RUN_PLAN.md` and `docs/specs/EVO_PLATFORM_TZ.md`.

This slice ran after its planning-only PR was independently reviewed and
merged. It did not close or weaken `/goal-evo-preplatform-hardening`; the
remaining owner/external gates in that goal stayed open.

### Goal

Turn the reviewed Claude Design handoff into the real, responsive and
accessible EVO Platform frontend inside the root Next.js CRM application.
The result should present one coherent staff workspace and student portal while
preserving the current system ownership boundaries:

- amoCRM remains authoritative for contact/lead identity, responsible manager
  and sales-pipeline stage;
- the root CRM remains the canonical host for staff operations and the student
  portal;
- EVO Inbox remains the current WhatsApp conversation runtime and Supabase
  owner until a later backend/data migration decision;
- AI customer replies remain draft-only and require a human to send;
- the retained Lead Agent remains frozen and backend-only.

One frontend does not imply one physical database or one runtime in this slice.
No schema merge, Supabase consolidation, Lead Agent deletion, live provider
mutation, production deployment or outbound WhatsApp test is authorized here.

### Reviewed design baseline

- Source bundle:
  `docs/design/evo-platform/prototype/`.
- Completion contract:
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md`.
- Browser and static audit:
  `docs/design/evo-platform/AUDIT_2026-07-24.md`.
- The handoff covers the main information architecture, seven staff roles,
  Student Portal, design tokens and eight core flows.
- The handoff is not production code. Its known gaps include broken staff
  tablet/mobile layouts, a phone-shaped rather than native desktop Student
  Portal, incomplete navigable system states, CDN runtime dependencies,
  inaccessible clickable `div` controls and unlabelled/unmanaged overlays.

### Role mapping for this frontend slice

The prototype's seven staff personas are design viewpoints, not permission
records to add to production. This slice preserves the five existing staff
roles in `src/lib/domain.ts`:

| Prototype viewpoint | Existing application role in this slice |
|---|---|
| Руководство | `admin` dashboard/report viewpoint; no new role |
| Администратор | `admin` |
| Продажи | `sales` |
| Куратор | `curator` |
| Визовый специалист | `visa` |
| Финансы | `finance` |
| Оператор Inbox | existing `admin`/`sales`/`curator` WhatsApp access; no new role |

The student remains the existing `client` role. Role switching in the design
bundle is demonstration-only and must not be copied into the real application
as an authorization mechanism. Adding a distinct leadership or Inbox-operator
role requires a later role-policy amendment and server-side authorization
work. The completion checklist's permissions-matrix item means documenting and
testing the current five staff roles plus `client`, not silently expanding
them.

### Inbox data boundary for this frontend slice

The root `/whatsapp` route currently reads and writes the main CRM's local
`wa_*` shadow tables through existing CRM queries/actions. It does not read the
separate EVO Inbox Supabase project. Therefore:

- this slice may redesign `/whatsapp` over the existing root CRM read/action
  path and must label its source truthfully;
- it must preserve all current send/configuration guards and draft-only AI;
- it must not claim that the root view is connected to EVO Inbox Supabase;
- the shell may link to or report the separate EVO Inbox runtime status only
  when that status is available through an already-authorized read path;
- a real Supabase-to-root read bridge, shared Inbox API or data migration is a
  later backend/integration slice with its own authentication, ownership,
  privacy and failure-mode design.

“Unified Inbox” in this frontend slice means one consistent interaction design,
not a hidden cross-database integration.

### Architecture and implementation order

1. **Planning and evidence**
   - Commit the unmodified Claude Design source, completion checklist, browser
     evidence and gap audit.
   - Keep the prototype clearly labelled as reference-only.
2. **Frontend foundation**
   - Implement EVO brand tokens, real logo treatment, typography, primitives,
     semantic tables, tabs, dialogs, drawers, feedback and state components.
   - Keep data-reading pages as Server Components and isolate only interactive
     controls in focused Client Components.
   - Implement keyboard focus, reduced-motion handling and native semantic
     controls.
3. **Unified responsive shell**
   - Rebuild the root staff shell and topbar for desktop, tablet and urgent
     mobile work without replacing existing authentication or role checks.
   - Expose truthful amoCRM, WAHA and AI status labels without implying that a
     provider was exercised.
4. **Staff workspaces**
   - Recreate the reviewed dashboard, sales funnel/list, Lead 360, Student 360,
     applications, documents, visa, finance, tasks/calendar, calls/meetings,
     Inbox, notifications, reports and administration surfaces on existing
     root routes where possible.
   - Add only read-model/UI routes required for missing surfaces; do not change
     provider ownership or create a second source of truth.
   - Keep `/whatsapp` on the existing CRM `wa_*` read/action path and label the
     separate EVO Inbox bridge as deferred.
5. **Student Portal**
   - Rebuild `/portal` as a true mobile-first surface with an actual desktop
     layout, accessible document resubmission and the reviewed progress,
     applications, visa, payments, messages, team and security views.
6. **Validation and handoff**
   - Run lint, type/build, relevant unit/e2e suites and secret scanning.
   - Exercise the critical flows in a real browser at 1440x1024, 834x1194 and
     390x844, save screenshots and audit keyboard/focus behavior.
   - Keep provider-dependent flows labelled blocked or simulated unless real
     credentials and explicit mutation/send approval are separately supplied.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/**`: contract, source handoff and audit evidence.
- `eslint.config.mjs`: ignore only the immutable, reference-only Claude Design
  export under `docs/design/evo-platform/prototype/**`; application source
  remains linted.
- `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/(staff)/**`, `src/app/login/**`, `src/app/portal/**`:
  responsive application surfaces.
- `src/components/**`, `src/lib/domain.ts`, `src/lib/i18n*.ts`:
  shared design system, navigation, truthful presentation models and copy.
- `src/lib/queries.ts`, `src/lib/actions.ts` only for presentation/read-model
  adaptation of existing root CRM data and existing guarded actions. No new
  cross-runtime provider write path is included.
- `tests/**`, `playwright.config.ts` only where required for frontend
  acceptance and regression coverage.

Database migrations, provider clients, webhook handlers, Compose/Caddy,
production secrets and deployments are outside this slice unless a later
append-only plan amendment explicitly adds them.

### Acceptance criteria

- Every applicable item in the completion checklist maps to a real application
  route, component state or explicitly recorded provider blocker.
- The permissions matrix covers the current `admin`, `sales`, `curator`,
  `visa`, `finance` and `client` roles; prototype-only leadership/Inbox
  personas do not become production roles in this slice.
- Staff views are usable without horizontal page overflow at 1440x1024 and
  834x1194; Inbox, tasks and notifications have an intentional 390x844 urgent
  mobile experience.
- Student Portal uses native mobile and desktop layouts rather than a device
  frame embedded in a marketing page.
- Navigation, cards, forms, tabs, tables, kanban, drawers and dialogs are
  keyboard-operable with visible focus and appropriate semantics.
- No frontend success state claims a real amoCRM, WAHA, Supabase, AI or
  telephony result unless that real service was exercised.
- Sales stages and operational student stages remain visibly distinct.
- AI auto-send remains blocked unless the currently active owner-authorized MVP
  autonomous-reply slice explicitly permits it under its reply-only,
  policy-gated boundary; outside that slice, the manual-send boundary is
  explicit.
- The root application lint, build and affected automated/browser tests pass.

### Merge order and stop conditions

1. Planning/design-evidence PR, including the narrow lint ignore required to
   store the immutable design exporter source outside the runtime.
2. Design-system and responsive-shell PR.
3. Staff workspace PRs split by non-overlapping route ownership.
4. Student Portal PR.
5. Cross-flow browser acceptance and final integration PR.

Stop before changing backend ownership, merging databases, deleting a runtime,
changing role policy, deploying to production or sending a real message. Those
actions require a separate architecture amendment and, where applicable,
explicit owner approval and real provider inputs.

## Completed Main Production Consolidation Slice

Completed slice: `/goal-evo-main-production-consolidation`.

### Goal

Make GitHub `main` the reviewed source of truth for the complete EVO platform,
then deploy that exact release to `hermes-vps` and prove the real EVO Inbox
WhatsApp path without losing active server configuration or claiming provider
success that was not exercised.

Candidate ancestry at planning time is linear:

- `origin/main`: `c1a00b0a3013946a94677fc0f01838740217b622`
- integration candidate after PR #40:
  `8116aad7c6cc97c3de198e3de1c7cad020105416`
- distance: zero commits behind and 41 commits ahead of `main`

The candidate is not releasable as-is. Current audits find vulnerable runtime
dependencies, no effective repository-root GitHub Actions workflow, three
full-range whitespace failures, dirty production checkouts, missing canonical
DNS, and incomplete real-provider readiness.

### Ordered blocks

Each block requires its own branch, PR, real validation evidence, and
independent launch-control approval. Do not begin a later block before the prior
block is merged or explicitly abandoned.

1. **Security and repository gates**
   - Upgrade both Next.js applications to the current secure stable patch.
   - Remove the shadcn code-generation CLI from production dependencies; invoke
     it through the documented ephemeral package runner when future component
     generation is needed. Preserve the small runtime Tailwind extension
     currently imported from that package as a reviewed, tracked local
     stylesheet so removing the CLI does not alter the rendered UI.
   - Apply safe transitive dependency updates until
     `npm audit --audit-level=moderate` passes for both applications.
   - Fix the three existing `git diff --check` findings without unrelated
     formatting churn.
   - Add repository-root GitHub Actions coverage for the main CRM, EVO Inbox,
     and EVO Lead Agent. A workflow nested under an application directory is
     documentation only because GitHub discovers workflows from root
     `.github/workflows/`.
   - Open a dedicated issue for normalizing the pre-existing EVO Inbox formatter
     baseline without mixing hundreds of unrelated rewrites into this release.

2. **Frozen integration promotion**
   - Open an integration-to-`main` PR from one frozen, fully validated candidate
     SHA.
   - Preserve the 41-commit implementation history with a merge commit; do not
     squash the umbrella promotion.
   - Reconfirm `main` and the candidate SHA immediately before merge. Merge only
     the independently approved unchanged candidate.

3. **Production release reconciliation**
   - Do not deploy from either dirty production checkout.
   - Preserve the active Caddy additions currently routing
     `invite-bishkek.72.62.119.112.sslip.io` and
     `inbox.72.62.119.112.sslip.io` as a separately reviewed infrastructure
     change before replacing the server checkout.
   - Preserve the `/opt/evo-crm/evo-lead-agent.git-backup-*` material until the
     owner explicitly approves archival or removal.
   - Build release images from the merged `main` SHA and add OCI source,
     revision, and version labels so a running image can be mapped back to Git.
   - Back up persistent data and record current image digests before deployment.
   - Move EVO CRM services off `acadis_*` networks onto EVO-owned networks while
     preserving private WAHA access and existing volumes.
   - Validate Compose and Caddy before restart, deploy one service boundary at a
     time, and retain the previous image digests for rollback.

4. **Canonical domains**
   - Create `A` records for `crm.evoadmissions.com` and
     `inbox.evoadmissions.com` pointing to `72.62.119.112` only through the
     authoritative DNS provider.
   - Verify public resolution, valid TLS, the expected login redirect, and Caddy
     routing. If authoritative DNS access is unavailable, record that exact
     external blocker and keep the working sslip.io routes.

5. **Real production proof**
   - Use a dedicated EVO-controlled test WhatsApp sender and the connected
     `evo-inbox` WAHA session.
   - Confirm real Supabase, encrypted WAHA, amoCRM, Gemini, and knowledge-base
     configuration through authenticated production readiness checks.
   - Keep unattended auto-reply disabled.
   - Send one controlled inbound message, verify the persisted message and
     amoCRM contact/lead identity, generate one knowledge-grounded Gemini draft,
     have the operator inspect/edit it, and send one manual WAHA reply.
   - Verify delivery and confirm no additional automatic outbound message
     exists in WAHA, Supabase, or amoCRM.
   - Run the legacy receive-only Lead Agent proof separately only after
     `crm_primary` is relinked and its missing amoCRM OAuth configuration is
      supplied. Do not reuse EVO Inbox credentials or its WAHA session.

6. **Provider-proof audit hardening**
   - Before any real outbound proof, persist every generated AI draft with its
     account, conversation, requesting operator, provider, model, knowledge
     evidence, generated text, and timestamp. Return the draft to the composer
     only after that audit record exists.
   - Carry the generated draft identifier through the editable composer to the
     manual-send request. A manual message may omit that identifier when the
     operator wrote the reply without AI.
   - Require a client-generated UUID for every manual send. Persist the complete
     send intent, operator (`messages.sender_id`), optional AI draft reference,
     and a `sending` provider state before calling WAHA. Enforce a unique
     request identifier so concurrent or repeated requests cannot call WAHA
     twice.
   - Treat a lost/ambiguous WAHA response as an uncertain operation and never
     retry it automatically. WAHA documents `POST /api/sendText`, returned
     message identifiers, `message.ack` events, and message lookup by provider
     identifier, but it does not document a caller-supplied idempotency key:
     https://waha.devlike.pro/docs/how-to/send-messages/
     https://waha.devlike.pro/docs/how-to/events/
     https://waha.devlike.pro/docs/how-to/chats/
   - Subscribe the signed EVO Inbox webhook to `message.ack`, persist
     acknowledgement history idempotently, and advance message state
     monotonically. Add a secret-protected reconciliation path only for rows
     that have a stable WAHA message identifier; do not infer provider success
     by matching message text or timestamps.
   - Keep first-launch automatic reply disabled. This block may create local
     migrations, tests, and reviewed code, but it must not send a real WhatsApp
     message. Apply the migration to the intended Supabase project before
     deploying the corresponding application image.

### Named write boundaries

- Security/gates block: root and EVO Inbox package manifests/lockfiles, the
  EVO Inbox global-style import plus its local shadcn Tailwind extension, the
  three whitespace-only files, root `.github/workflows/`, and plan evidence.
- Promotion block: plan evidence and GitHub PR state only; no runtime feature
  changes.
- Production block: EVO-owned Dockerfiles, Compose/Caddy configuration,
  deployment scripts/runbooks, and release metadata. Provider data may change
  only during the explicitly controlled production proof.
- DNS changes are limited to the two canonical EVO `A` records.
- Provider-proof audit block: EVO Inbox Supabase migrations/schema contract,
  AI draft route/composer state, manual WAHA send service/route, signed WAHA
  acknowledgement handling, bounded reconciliation route, focused tests, and
  implementation/runbook evidence. No provider message or customer record is
  created during implementation validation.

### Required validation

Run under Node `22.23.1`:

```bash
# Main CRM
npm ci
npm run lint
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm run build
npm run scenarios
npm audit --audit-level=moderate

# EVO Inbox
cd agent-lead2-inbox
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate

# EVO Lead Agent
cd evo-lead-agent
uv sync --extra dev
uv run ruff check .
uv run pytest
```

Also require:

- `git diff --check origin/main..CANDIDATE_SHA`
- a redacted Git-history secret scan over the same range
- validated production Compose rendering with real server environment files,
  without printing secret values
- real browser checks of the CRM and Inbox login/operator surfaces
- the authenticated production readiness and provider proof described above

`npm run format:check` currently fails across hundreds of pre-existing EVO
Inbox files. It is not a release gate for this slice because fixing the whole
format baseline would mix unrelated source churn into the security block.
Changed files must still match the repository formatter, and a separate
format-baseline issue must remain visible.

### Rollback and stop conditions

- Stop before DNS mutation if authoritative provider access or the exact zone is
  unavailable.
- Stop before the real message proof if an EVO-controlled test number,
  authenticated Inbox operator, connected WAHA session, or real
  Supabase/amoCRM/Gemini configuration is unavailable.
- Stop deployment if backups, current image digests, Caddy validation, Compose
  validation, or a rollback image is missing.
- Stop if the active dirty Caddy routes cannot be preserved without ownership
  clarification.
- Stop if dependency audit, CI, full-range diff, independent review, or frozen
  candidate checks fail.
- Never print, commit, or copy secret values into logs or repository files.

## Most Recently Completed Goal Slice

Completed slice: `/goal-evo-knowledge-business-context`.

This slice turns the two owner-supplied country drafts into clean text that can
be pasted into EVO Inbox and consolidates the company's business model into one
team-facing context document. The user has explicitly approved the supplied
China and Malaysia content as trusted business input. This slice therefore
cleans and structures that content without external fact-checking or silent
changes to its substantive claims.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md` and `docs/PLAN_CHANGES.md`: execution contract and
  append-only decision record for issue #36.
- `docs/business/knowledge-base/README.md`: upload workflow, document registry,
  ownership, review rules, and current EVO Inbox text-input limitation.
- `docs/business/knowledge-base/ready-to-upload/`: normalized China and Malaysia
  Markdown texts, each intended to be pasted as one separate knowledge document.
- `docs/business/evo-business-context.md`: company, customer, service,
  operating-model, system, data, AI, measurement, governance, and risk context.
- `docs/business/README.md`, `docs/README.md`, and `CONTEXT.md`: discoverability
  and canonical business vocabulary.

Deliverables:

- Preserve the supplied Downloads files byte-for-byte and create reviewed copies
  under stable ASCII filenames in the repository.
- Remove draft labels, warning markers, unresolved transcription notes, open
  questions, broken numbering, and repeated FAQ copies.
- Preserve the owner-approved country claims, prices, routes, service promises,
  office details, and process content while making cost categories and steps
  independently understandable to retrieval.
- Add instructions that keep the assistant inside the approved text, collect a
  minimal admissions profile, avoid requesting sensitive documents in ordinary
  chat, and hand case-specific or uncovered questions to an EVO manager.
- Explain the current upload path accurately: EVO Inbox accepts a title and
  pasted text, then chunks and embeds the saved content; this slice does not add
  binary Markdown-file upload behavior.
- Build the business context from supplied company documents, existing business
  docs, implemented CRM entities, EVO Inbox contracts, Lead Agent contracts,
  and the current data-ownership map. Unknown owners and KPIs remain explicit
  gaps rather than invented facts.
- Do not change runtime code, database schemas, provider settings, deployment,
  DNS, production data, or WhatsApp behavior.

Acceptance evidence:

- SHA-256 checks prove the two supplied source files are unchanged.
- Both upload texts have no `⚠️`, draft/open-question markers, placeholder
  instructions, duplicated FAQ section, secret, or real client personal data.
- A chunk preview using the application's 1,200-character boundary shows both
  documents split into bounded, readable retrieval units.
- Repository links resolve, `git diff --check` passes, and a diff scan finds no
  secrets, bank values, private legal identifiers, or copied customer records.
- Required repository validation passes, or an exact unrelated blocker is
  recorded.
- An independent launch-control reviewer approves the final diff before merge.

Implementation evidence recorded 2026-07-13:

- The supplied China and Malaysia source SHA-256 values still match the values
  recorded in the knowledge registry.
- The real EVO Inbox `chunkText` function produced 14 China chunks with a
  1,197-character maximum and 13 Malaysia chunks with a 1,185-character
  maximum. No chunk exceeded 1,200 characters, ended with an orphan heading, or
  split a handoff lead-in from its trigger list.
- Relative-link, draft-marker, secret/credential, and diff-whitespace checks
  passed with no finding.
- Root lint, Next route generation, TypeScript, production build, all 39
  repository scenarios, and `npm audit --audit-level=moderate` passed under
  Node 22.23.1. The scenario report generated by validation was restored and is
  not part of this slice.
- The two focused EVO Inbox chunk/retrieval test files passed all 16 tests.
- Independent reviewers approved the final China document, Malaysia document,
  business context, data ownership, upload mechanics, privacy controls, and
  named write-set compliance.

## Previous Goal Slice

Completed slice: `/goal-evo-platform-source-of-truth`.

Next major lanes require their own reviewed slice: integration into `main`,
then the real production proofs tracked by GitHub issues #5 and #20.

This slice makes the current repository understandable and usable as the EVO
Admissions Platform source of truth without moving runtime code or changing
production. It is documentation, governance, and controlled source-document
work.

Deliverables:

- Replace the generic root README with a team-facing platform entrypoint.
- Add a complete documentation index, platform/system map, data-ownership
  registry, current-status page, onboarding guide, and business knowledge map.
- Add an EVO company profile based only on supplied real company documents,
  with no bank account values, personal identity numbers, signatures, or home
  addresses copied into tracked Markdown.
- Store the supplied public brand book in a tracked company brand folder.
- Store supplied bank/legal originals in a local Git-ignored private folder
  with restrictive permissions and a tracked safe manifest/checksum registry.
- Add a branded team overview presentation and a concise demo/presenter script.
- Mark historical handoffs and copied issue plans as archived or superseded;
  keep GitHub Issues as the changing work-status authority.
- Correct the active deployment documentation where it still names the Acadis
  proxy instead of the EVO-owned edge boundary.
- Track the safe root `.env.example` while continuing to ignore real `.env*`
  files.
- Do not move `src/`, `agent-lead2-inbox/`, `evo-lead-agent/`, change
  APIs/data models, deploy, alter DNS, or exercise outbound WhatsApp.

Acceptance evidence:

- All four supplied PDFs are identified by page count and SHA-256 checksum;
  the 24-page brand book is tracked and visually reviewed.
- Private source PDFs are present locally, ignored by Git, and not present in
  the staged diff.
- The presentation renders without overflow, overlap, clipping, or unresolved
  placeholders and is visually reviewed slide by slide.
- Repository links and source-of-truth statements are internally consistent.
- `git diff --check`, a staged-diff secret/PII scan, root lint/typecheck/build,
  and an independent launch-control review pass before merge.

Historical implementation material below remains as prior-slice context until
the documentation archive pass is complete.

The EVO Inbox companion lane is specified in
`docs/EVO_INBOX_COMPANION_PRD.md`. It creates a WACRM-derived, fully redesigned
standalone companion app at `agent-lead2-inbox/`, hosted at
`inbox.evoadmissions.com`, using managed Supabase Cloud, WAHA session
`evo-inbox`, WACRM's own draft-only AI assistant, and amoCRM as the identity
source of truth.

Deliverables for the reliable amoCRM sync buffer slice:

- Inbound WAHA `message` webhooks must save the local Supabase contact,
  conversation, and message before attempting amoCRM identity sync.
- Missing amoCRM configuration or temporary amoCRM provider failure must not
  prevent the message from appearing in EVO Inbox.
- Conversations and messages must expose `crm_sync_status` as `pending`,
  `synced`, `not_configured`, or `blocked`, with a safe operator-visible error.
- WAHA must receive HTTP 200 after local save, including the CRM sync state, so
  a saved message is not retried as a failed webhook.
- Add a bounded internal retry endpoint protected by `AUTOMATION_CRON_SECRET`
  to process pending/not configured CRM sync rows and optionally blocked rows
  after operator repair.
- Settings, Inbox UI, public API serializers, readiness, deployment docs, and
  proof checklist must show the new local-save-first behavior truthfully.
- Add migration `036_reliable_amocrm_sync_buffer.sql`.
- Run targeted WAHA/amoCRM/readiness/schema tests plus `npm test`,
  `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`,
  and a PR diff secret scan.
- Commit only this slice with a Conventional Commit.
- Request independent launch-control code-reviewer approval before merge.

Out of scope for this slice:

- Creating the real amoCRM external integration or token in the owner's browser.
- Claiming live WhatsApp, amoCRM, Gemini, Supabase migration, or deployment
  success before the real production services are exercised.
- Auto-reply, broadcast, template, historical import, or `/opt/evo-crm` changes.

Previous Gemini/preflight slice deliverables:

- Update the lead-agent readiness/preflight path so receive-only rollout
  readiness is distinct from outbound WhatsApp readiness.
- Make missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration report
  exact input names.
- Keep local smoke no-outbound and failing when outbound is enabled.
- Update production env examples and deployment docs with Gemini configuration
  and receive-only safety flags.
- For the EVO Inbox companion, add Gemini as an encrypted account-level AI
  provider with a repeatable VPS seed command; keep the assistant draft-only.
- Run lead-agent `uv run pytest` and `uv run ruff check .`.
- Run parent CRM validation because deployment docs and Compose are touched, or
  record the exact blocker.
- Commit only this slice with a Conventional Commit.
- Request independent code-reviewer approval before merge.

Out of scope for this slice:

- Executing the production receive-only proof from issue #5.
- Enabling outbound WhatsApp.
- Claiming live WAHA, amoCRM, Gemini, or CRM sync success without real
  credentials and real provider responses.
- Merging or transplanting the unrelated Kant/Bitrix workspace.
- Rebuilding the CRM UI, role model, student portal, or amoCRM architecture.

The repository snapshot, old write sets, acceptance lists and merge orders below
are retained as historical execution evidence. They do not override the active
goal, immediate execution order or ADR 0019 at the top of this document.

## Execution Rules

- Use the real repo stack and real execution paths.
- Do not claim integration success from mocks, fallback paths, demo modes, sample
  payloads, or synthetic data.
- If a real service or credential is unavailable, the lane must fail clearly and
  name the missing input.
- Prepared AI responses are allowed only for the first presentation because the
  user explicitly requested them. They must not be represented as live Anthropic
  integration success.
- Keep each future lane small enough for review and tied to one mergeable block.
- Every future implementation block needs independent code-reviewer approval
  before merge.

## Repository Snapshot

The current repo is a Next.js App Router application for an education CRM.
Primary stack observed in `package.json`:

- Next.js `16.2.9`
- React `19.2.4`
- TypeScript `^5`
- Tailwind CSS `^4`
- ESLint `^9` with `eslint-config-next`
- SQLite through `better-sqlite3`
- Anthropic TypeScript SDK `@anthropic-ai/sdk`

Important source areas:

- `src/app/`: App Router pages, layouts, and route handlers.
- `src/app/api/ai/*/route.ts`: AI draft and client summary endpoints.
- `src/app/api/webhooks/*/route.ts`: WhatsApp and telephony webhook endpoints.
- `src/lib/db.ts`: SQLite schema bootstrap, seed data, settings, password hash
  helpers, and database access.
- `src/lib/auth.ts`: HTTP-only cookie session handling.
- `src/lib/actions.ts`: Server Actions for auth, CRM operations, WhatsApp send,
  settings, and locale.
- `src/lib/ai.ts`: Anthropic client and prompt execution.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API send/receive integration.
- `src/lib/queries.ts`: read models for dashboard, CRM, WhatsApp, calls, and
  portal views.

## Research Summary

Research was checked on 2026-06-24 against current local and online sources:

- Local Next.js docs in `node_modules/next/dist/docs/` were inspected as required
  by `AGENTS.md`, including App Router route handlers, environment variables, and
  the production checklist.
- Context7 official Next.js docs for `/vercel/next.js/v16.2.9` confirm route
  handlers live under `app/**/route.ts`, supported HTTP methods are exported
  functions, `next build` is the production build gate, and `next typegen && tsc
--noEmit` is the documented route/type validation path.
- Context7 official Anthropic TypeScript SDK docs confirm server-side SDK usage
  through `client.messages.create`, API-key configuration, and message arrays as
  the real request path. Launch validation must use a real configured API key or
  explicitly report `not_configured`.
- Context7 `better-sqlite3` docs confirm direct database opening, prepared
  statements, PRAGMA usage, transactions, and WAL mode as normal production
  patterns for SQLite-backed Node.js apps.
- amoCRM's current developer docs describe `/api/v4/leads` as the deal endpoint
  with pipeline/status IDs, responsible user IDs, custom field values, and
  embedded contacts/companies; `/api/v4/contacts` carries contact custom field
  values; OAuth access and refresh tokens come from `POST /oauth2/access_token`.
- The existing README describes demo accounts, WhatsApp demo mode, IP telephony
  webhooks, client portal, multilingual UI, SQLite backup, and Anthropic-powered
  AI features. Those claims must be verified against the actual app before any
  production or sales-readiness claim.

Current risk surfaced by repo inspection:

- The repo has demo accounts and seeded demo data in `src/lib/db.ts`.
- `src/lib/auth.ts` has a development fallback `AUTH_SECRET`.
- `src/lib/whatsapp.ts` must not return a `demo` send status when WhatsApp
  credentials are missing; missing credentials must produce a visible failed
  send state rather than fake delivery success.
- README must not say missing WhatsApp keys use demo mode. Prepared AI text is
  acceptable only for explicitly labeled presentation behavior, not production
  launch or delivery success.
- AI routes depend on live Anthropic configuration and should fail as
  `not_configured` when no key exists.
- There is currently no explicit `typecheck` script and no test script in
  `package.json`.
- `npm audit --audit-level=moderate` currently fails on an existing PostCSS XSS
  advisory reached through Next.js. The suggested `npm audit fix --force` would
  install an incompatible Next.js downgrade, so this must be handled in a future
  security or dependency lane, not hidden inside this docs-only slice.
- `npm run build` passes after local dependency repair, but Next.js warns that it
  inferred the workspace root from `/Users/iskhak.tazhibaev/package-lock.json`
  because another lockfile exists above the repo. A future config lane should
  either set the documented Turbopack root or remove the stray parent lockfile.

## Acceptance Criteria

### This QA Launch Readiness Slice

- `docs/PLAN_CHANGES.md` has an append-only `/goal-qa-launch` entry before
  runtime or test coding because this lane changes active scope, acceptance
  criteria, file ownership, merge-order status, and validation evidence.
- `docs/QA_LAUNCH_REPORT.md` records the QA method, scored checklist, desktop
  and mobile screenshots paths, pass/fail evidence, changes made, validation
  output, stop reason, and named blockers.
- Browser QA starts from a fresh context with no saved login, cookies, or site
  data, then covers login and critical staff/client flows at 1440x900 and
  390x844 or comparable desktop/mobile sizes.
- The single checklist scores auth/role routing, staff CRM flow, student portal
  flow, integration truthfulness, AI/prepared boundary, i18n/language switching,
  responsive layout, security/secret handling, validation/build readiness, and
  presentation demo clarity.
- Any implementation change is limited to launch-blocking bug fixes, blocker or
  prepared/live copy clarity, validation/scenario coverage, QA report/runbook
  documentation, or small UI polish needed for critical flows.
- Missing WhatsApp, telephony, amoCRM, and Anthropic credentials are reported as
  explicit `not_configured` / `blocked` states or blockers, never as demo or
  hidden mock success.
- Existing staff CRM, student portal, amoCRM settings/status, WhatsApp,
  telephony, and AI boundaries continue to build and smoke successfully after
  the changes.
- Validation is run through the real repo commands for this slice:
  `node node_modules/eslint/bin/eslint.js .`,
  `node node_modules/next/dist/bin/next typegen`,
  `node node_modules/typescript/bin/tsc --noEmit`,
  `node node_modules/next/dist/bin/next build`, `npm run scenarios`, fresh
  browser QA rerun, and `npm audit --audit-level=moderate`.
- Pre-commit security audit is run with `npm audit --audit-level=moderate`; any
  existing advisory is documented rather than bypassed.
- The QA launch commit uses a Conventional Commit message.
- An independent code-reviewer reviews the QA launch diff and evidence against
  this goal before merge and returns `approved` or `changes_requested`.

### Launch Acceptance

The app is launch-ready only when all items below are true and evidenced:

- Auth: no production deployment uses default secrets, demo passwords, or
  unlabeled seeded demo accounts.
- Database: SQLite file path, WAL behavior, schema bootstrap, backup/restore, and
  seed policy are documented and verified on the real runtime target.
- CRM core: staff login, dashboard, sales pipeline, lead-to-client conversion,
  client profile, tasks, finance, reports, and client portal complete real flows
  against the real SQLite database.
- WhatsApp: Cloud API credentials and webhook verification are configured against
  Meta's real service, or the feature is visibly blocked. A `demo` status cannot
  be counted as send success.
- Telephony: webhook authentication and payload handling are validated against a
  real provider configuration or blocked with the missing provider named.
- AI: draft and summary endpoints run through the real Anthropic SDK with a real
  key, or return clear `not_configured`. Prepared responses may be used only in
  the first presentation and must be labeled as prepared content.
- Security: server inputs are schema-validated at API and Server Action
  boundaries, sensitive errors are not leaked, secrets are only environment or
  settings values, and role checks match the feature surface.
- UI: production-critical pages render without broken layout at desktop and
  mobile widths, with Russian/Kyrgyz/English locale switching preserved.
- Validation: lint, typecheck, build, and critical real E2E flows pass. Any
  unavailable credential or external system is a named blocker, not a fake pass.

## File Ownership

Planning and governance:

- `docs/EVO_LAUNCH_PLAN.md`: launch contract owner. Changes require a
  corresponding entry in `docs/PLAN_CHANGES.md` after this slice lands.
- `docs/PLAN_CHANGES.md`: append-only change log. Never rewrite prior entries.

Application architecture:

- `src/app/(staff)/**`: staff-facing CRM pages and navigation.
- `src/app/portal/**`: client portal experience.
- `src/app/login/**`, `src/app/register/**`, `src/app/page.tsx`: auth entry and
  role routing.
- `src/app/api/ai/**`: Anthropic-backed AI endpoints.
- `src/app/api/webhooks/**`: external webhook boundaries.
- `src/components/**`: shared UI and client components.
- `src/lib/db.ts`: schema, connection, seed, settings, password hashing.
- `src/lib/auth.ts`: session token signing and current user resolution.
- `src/lib/actions.ts`: Server Action mutations.
- `src/lib/queries.ts`: read models.
- `src/lib/ai.ts`: Anthropic client and AI generation contract.
- `src/lib/prepared-ai.ts`: deterministic prepared prompt library and response
  scenario generator for the first presentation.
- `src/lib/whatsapp.ts`: WhatsApp Cloud API integration.
- `src/lib/i18n.ts`: locale keys and translations.
- `src/lib/domain.ts`: canonical CRM roles, route map, status values, domain
  entity types, and route access helpers.
- `src/lib/contracts/amo-crm.ts`: amoCRM adapter interface and sync DTOs.
- `src/lib/contracts/student-portal.ts`: client-visible portal contract.
- `src/lib/contracts/prepared-ai.ts`: prepared response boundary for the first
  presentation.
- `src/lib/contracts/index.ts`: public export surface for integration contracts.
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`:
  validation and build configuration.

Future lanes must name their write set before coding. If a lane needs to edit
outside its named ownership area, update `docs/PLAN_CHANGES.md` first.

`/goal-evo-inbox-companion` planned write set:

- `docs/EVO_INBOX_COMPANION_PRD.md`: product contract and acceptance context.
- `docs/EVO_LAUNCH_PLAN.md`: lane status, phase plan, write sets, and
  validation gates.
- `docs/PLAN_CHANGES.md`: append-only decisions and scope changes.
- `CONTEXT.md` and `docs/adr/**`: domain language and architectural decisions.
- `agent-lead2-inbox/**`: WACRM-derived EVO Inbox app, Supabase
  migrations, WAHA transport, amoCRM resolver, AI draft surfaces, redesigned UI,
  tests, and MIT license notice.
- `docker-compose.prod.yml`, deployment docs, and Caddy deployment notes only
  when the deployable companion service is introduced.

`/goal-evo-inbox-companion` phase plan:

1. Source setup: create a clean implementation branch from the intended base,
   copy WACRM into `agent-lead2-inbox/`, preserve MIT license notice, and
   establish local install/build/test commands.
2. Product pruning: remove or hide Meta Cloud API, broadcasts, broad
   automations, flow-driven sending, and first-launch-disabled WACRM surfaces.
3. WAHA transport: replace Meta send/webhook/session assumptions with WAHA
   session `evo-inbox`, authenticated webhooks, idempotent inbound persistence,
   and manual outbound send.
4. Supabase foundation: configure managed Supabase, migrations, Auth, storage,
   RLS, service-role server paths, and companion shadow records.
5. amoCRM identity: resolve by phone, create missing contact/lead, store
   `amo_contact_id` and `amo_lead_id`, and block local-only lead presentation
   when amoCRM is unavailable.
6. AI draft and knowledge: keep WACRM's OpenAI/Anthropic draft assistant and
   knowledge base, default auto-reply off, and route manual sends through WAHA.
7. Full EVO Inbox redesign: redesign retained surfaces around admissions
   operators, integration status, lead profile, AI draft, knowledge base, and
   production readiness.
8. VPS deployment: add a separate `hermes-vps` service and Caddy route for
   `inbox.evoadmissions.com`; verify only with real DNS, Supabase, WAHA, amoCRM,
   and AI provider credentials.

`/goal-evo-inbox-companion` acceptance criteria:

- The companion app runs from `agent-lead2-inbox/` without depending on
  Meta Cloud API configuration.
- First launch supports one WAHA session named `evo-inbox`.
- Inbound WAHA messages are authenticated, idempotent, persisted in Supabase,
  and visible in the redesigned EVO Inbox.
- The app resolves or creates amoCRM identity before presenting a lead as real.
- Supabase stores shadow records and app data, not canonical CRM identity.
- AI draft works through the companion app's own assistant; auto-reply is off by
  default.
- An operator can send one manual WhatsApp reply through WAHA after reviewing
  the conversation and optional AI draft.
- Broadcasts, broad automations, flow-driven sending, and Meta templates are
  absent or disabled in first-launch UI and runtime paths.
- `inbox.evoadmissions.com` deployment is only claimed after a real
  `hermes-vps` deployment, Caddy routing, DNS, WAHA, Supabase, amoCRM, and AI
  provider check succeeds.

`/goal-qa-launch` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: current-slice and acceptance update.
- `docs/PLAN_CHANGES.md`: append-only QA launch entry.
- `docs/QA_LAUNCH_REPORT.md`: QA checklist, screenshot paths, validation, stop
  reason, and blockers.
- `docs/SCENARIO_EVALUATION.md`: refreshed only by the required scenario runner
  as validation evidence.
- Runtime, scenario, or copy files only if the QA pass exposes a
  launch-blocking bug, fake-success claim, missing validation evidence, or small
  critical-flow UI issue inside this slice.

`/goal-lead-agent-webhook-ownership` named write set:

- `docs/EVO_LAUNCH_PLAN.md`: append this implementation block.
- `docs/PLAN_CHANGES.md`: append webhook ownership and source-of-truth decision.
- `AGENTS.md`, `deploy/README.md`, `docker-compose.prod.yml`,
  `deploy/env.lead-agent.example`, `.gitignore`, `.dockerignore`,
  `eslint.config.mjs`, `tsconfig.json`: deployment, repo-boundary, and
  validation configuration for the lead-agent sibling service.
- `src/lib/db.ts`, `src/lib/whatsapp.ts`, `src/lib/actions.ts`,
  `src/lib/queries.ts`, `src/lib/i18n-data.ts`,
  `src/app/(staff)/settings/page.tsx`,
  `src/app/(staff)/whatsapp/[id]/page.tsx`, `scripts/bootstrap-admin.mjs`: CRM
  schema, settings, read models, bootstrap schema, and operator-visible
  source-of-truth state.
- `src/app/api/internal/lead-agent/**`: private internal sync endpoint from the
  lead-agent service into EVO CRM.
- `evo-lead-agent/AGENTS.md`, `evo-lead-agent/README.md`,
  `evo-lead-agent/.env.example`, `evo-lead-agent/Dockerfile`,
  `evo-lead-agent/docker-compose.yml`, `evo-lead-agent/pyproject.toml`,
  `evo-lead-agent/uv.lock`, `evo-lead-agent/SECURITY.md`,
  `evo-lead-agent/functional-spec.md`, `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/token-cost-estimate.md`, `evo-lead-agent/research/README.md`,
  `evo-lead-agent/*context-report.md`,
  `evo-lead-agent/src/evo_lead_agent/**`, `evo-lead-agent/tests/**`:
  product rename, lead-agent runtime packaging, callback configuration, signed
  CRM sync client, service pipeline, and focused tests.

Acceptance criteria:

- WAHA webhook ownership moves to the lead-agent service. Production/session
  configuration should point WAHA at `http://evo-lead-agent:8000/webhooks/waha`
  on the private Docker network, not the public CRM route.
- The lead-agent resolves or creates amoCRM contact/lead first, then sends a
  signed internal sync payload to EVO CRM.
- EVO CRM persists remote amoCRM identifiers and lead-agent state on the local
  lead/conversation records without making local state the source of truth.
- EVO CRM keeps the staff WhatsApp inbox/operator UI usable by storing inbound
  and outbound message copies linked to the resolved amoCRM lead/contact.
- Both internal CRM sync and WAHA webhooks must be authenticated with shared
  secrets/HMAC-style verification; no public unauthenticated mutation endpoint
  is allowed.
- The first live receive-only test may enable autoreply only for Gemini draft
  review, but must keep outbound disabled until WAHA, amoCRM, CRM internal sync,
  and Gemini configuration are verified with real credentials and a later
  outbound send test is explicitly approved.
- The parent repo owns the EVO-specific `evo-lead-agent` source. Parent CRM
  validation must still avoid scanning lead-agent Python/runtime internals with
  Next.js tooling, and `evo-lead-agent/research/repos` stays untracked so
  unrelated reference snapshots do not become production source.

`/goal-gemini-receive-only-production-preflight` named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`, `deploy/README.md`,
  `deploy/env.lead-agent.example`, `docker-compose.prod.yml`: parent launch
  contract and production deployment readiness path.
- `evo-lead-agent/README.md`, `evo-lead-agent/.env.example`,
  `evo-lead-agent/PLAN_CHANGES.md`, `evo-lead-agent/implementation-plan.md`,
  `evo-lead-agent/technical-spec.md`,
  `evo-lead-agent/src/evo_lead_agent/readiness.py`,
  `evo-lead-agent/src/evo_lead_agent/preflight.py`,
  `evo-lead-agent/src/evo_lead_agent/cli.py`,
  `evo-lead-agent/tests/test_readiness.py`,
  `evo-lead-agent/tests/test_preflight.py`,
  `evo-lead-agent/tests/test_cli.py`: parent-tracked lead-agent receive-only readiness,
  preflight, local smoke, docs, and regression coverage.

Acceptance criteria:

- Env examples and deploy docs include Gemini configuration and receive-only
  safety flags.
- Readiness and preflight distinguish `receive_only_rollout` from
  `live_whatsapp_outbound`.
- Missing WAHA, amoCRM, CRM sync, Gemini, and admin configuration is reported
  by exact missing input name.
- Local smoke remains no-outbound and fails if outbound is enabled.
- `uv run pytest` and `uv run ruff check .` pass in `evo-lead-agent`.
- Parent CRM validation runs because deployment docs and Compose are touched.

## Merge Order

1. `plan-contract`: docs-only launch contract. Blocks implementation lanes.
2. `brand-research`: docs-only product/domain research for copy and education
   flow realism.
3. `architecture-contract`: role, route, entity, amoCRM adapter, student portal,
   and prepared AI contracts.
4. `crm-baseline`: separate runtime baseline commit required so later slices can
   build from a clean checkout without mixing baseline and prepared-AI review.
5. `prepared-ai-prompts`: user-requested first-presentation prepared response
   layer with explicit prepared/live boundaries.
6. `admissions-crm-core`: core staff CRM surfaces for Command Center,
   Admissions Pipeline, Student 360, tasks, documents, applications, and finance
   overview.
7. `student-portal`: first production-quality authenticated student portal over
   the stable student, application, document, payment, task, and update
   contracts.
8. `amocrm-integration`: runtime amoCRM settings/status/adapter foundation with
   truthful configured/not-configured/blocked behavior. Completed before
   `/goal-qa-launch`.
9. `/goal-qa-launch`: combined release/presentation QA readiness lane covering
   validation-baseline, production truthfulness, security/secret checks,
   CRM-core flow verification, real integration blocker recording,
   presentation-readiness evidence, release-readiness reporting, and clean-tree
   final audit without rebuilding feature architecture.
10. `/goal-lead-agent-webhook-ownership`: make the lead-agent service the
    private WAHA webhook owner, use amoCRM as source of truth, and sync local
    CRM shadow state for the operator UI.
11. `/goal-gemini-receive-only-rollout`: replace Anthropic drafting with
    Gemini 3.5 Flash draft review in the EVO lead-agent, then prove receive-only
    production WhatsApp rollout on `hermes-vps` with real WAHA, amoCRM, CRM sync,
    and Gemini credentials while outbound WhatsApp remains disabled.

Each lane must be merged or intentionally abandoned before the next lane starts.

## Required Validation Commands

Current baseline commands for this repo:

```bash
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
npm run scenarios
npm audit --audit-level=moderate
```

Future implementation lanes should add real integration and E2E checks to this
list rather than replacing these gates.

## Dependency Audit Hardening And Frontend Merge Readiness

Active slice: `/goal-evo-dependency-hardening`.

This slice restores a truthful green dependency gate after two advisories were
published against the already-merged frontend dependency graph. It must merge
before the independent design-polish PR is rebased and merged.

### Scope

- Update the root CRM and `agent-lead2-inbox` PostCSS resolutions to a current
  patched release and regenerate both lockfiles under the repository Node 22
  runtime.
- Keep `npm audit --omit=dev --audit-level=moderate` blocking for both deployed
  Next.js applications.
- Add a repository-owned development-audit verifier that accepts only
  `GHSA-mh99-v99m-4gvg` and only the known ESLint/minimatch package chain.
- Give the temporary allowlist an explicit owner, reason, and review deadline.
- Keep every other direct or transitive advisory blocking, including any new
  advisory that appears after this plan is written.
- Do not use `npm audit fix --force`, unsupported transitive major overrides,
  broad `continue-on-error`, or an unbounded audit exception.

Named write set:

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `package.json`, `package-lock.json`,
  `agent-lead2-inbox/package.json`,
  `agent-lead2-inbox/package-lock.json`: patched PostCSS resolution and locked
  dependency graphs.
- `.github/workflows/evo-platform-ci.yml`: separate blocking production and
  constrained development audit gates.
- `scripts/check-npm-audit-allowlist.mjs`,
  `config/npm-audit-allowlist.json`: real npm audit execution and the
  time-bounded exception contract.

### Acceptance criteria

- Root CRM and EVO Inbox production audits return zero vulnerabilities.
- Full development audits may contain only the known
  `brace-expansion -> minimatch -> ESLint/Next lint plugins` chain recorded in
  the allowlist.
- The verifier fails closed on malformed npm output, an expired allowlist, an
  unknown advisory URL, or an unknown affected package.
- Root CRM and EVO Inbox install, lint, type-check, test and production build
  gates pass from their committed lockfiles.
- The hardening PR passes GitHub CI and receives an independent launch-control
  `approved` verdict before merge.
- After the hardening PR merges, PR #72 is rebased onto current `main`, reruns
  the complete CI workflow, receives an independent freshness/correctness
  confirmation, and only then merges.
- No deployment, provider mutation, production database change, live WhatsApp
  send, or amoCRM write occurs in this slice.

### Current primary sources

- npm audit supports separate omitted dependency classes and severity-based
  exit thresholds:
  <https://docs.npmjs.com/cli/v11/commands/npm-audit/>.
- `brace-expansion` advisory:
  <https://github.com/advisories/GHSA-mh99-v99m-4gvg>.
- PostCSS advisory:
  <https://github.com/advisories/GHSA-r28c-9q8g-f849>.

## EVO Platform Post-Design Review Polish Slice

Historical completed slice: `/goal-evo-platform-design-polish`.

This slice applies the independent Claude Design review dated 2026-07-25 to
the already-merged unified frontend. It is a frontend refinement pass, not a
rebuild. The reviewed baseline is `origin/main` at
`3dd571bf302bd46dd020e029eb5ab40da5a1a277`.

### Product and technical boundaries

- amoCRM remains canonical for lead/contact identity and sales stage.
- For this historical design-polish slice, AI customer replies remained
  draft-only and required explicit operator send.
- Provider status remains honest; no WAHA, amoCRM, AI, telephony, storage or
  payment connection may be presented as verified without a real exercise.
- Existing roles and server-side authorization are unchanged.
- This slice changes frontend presentation and frontend regression coverage
  only. It does not change database schemas, webhook/provider contracts,
  Compose/Caddy, secrets, deployment or production state.

### Public test seams

The agreed seams for test-first changes are browser-visible behavior and
accessible DOM on existing routes. Tests should assert what an operator or
student can see and operate at `1440x1024`, `834x1194` and, where applicable,
`390x844`; they should not assert private helper implementation.

- WhatsApp: bubble semantics by delivery state, honest context summary,
  compact mobile source disclosure, useful empty state and non-duplicated
  composer guidance.
- Staff navigation: distinct application/visa destinations, discoverable
  icon-rail labels on hover and keyboard focus, and no horizontal overflow.
- Dashboard: one attention heading and an action-first queue that handles
  zero-count/all-clear states.
- Student 360, permissions and portal: collapsed data-entry affordances,
  semantic permission indicators, useful desktop density and brand-consistent
  system copy.

### Implementation waves

1. **P1 isolated refinements:** F1 outgoing WhatsApp bubbles, F2 distinct visa
   icon and F4 useful Inbox empty state.
2. **P1 responsive navigation:** F3 tablet icon rail with durable
   hover/focus-visible labels and explicit active state.
3. **P2 dashboard and Inbox:** F5 duplicated dashboard eyebrow, F6 zero-first
   priority queue, F7 repeated unverified-sync values, F8 oversized mobile
   source banner and F10 duplicated composer label/placeholder.
4. **P2 structure and polish:** F9 Student 360 anchor/form density, F11
   permission glyphs, F12 portal desktop lower-zone utility and F13 system
   update emoji.

### Acceptance

- Three consecutive outgoing messages do not create a red wall; red is
  reserved for `failed`, and all supported delivery states retain their exact
  mapping.
- `/applications` and `/visa` are visually distinct at 834px, every icon-rail
  destination has an accessible label, and that label becomes visible on
  hover and keyboard focus.
- The no-selection Inbox state explains the next action and repeats that AI
  only creates a draft.
- Dashboard attention content leads with real actions; when every count is
  zero it shows the all-clear copy from the design review.
- At 390px at least two messages are visible without scrolling while provider
  source detail remains available.
- Student 360 keeps deep links and mutations available without showing all
  add forms by default.
- Portal desktop uses existing data to reduce the empty lower zone and does
  not invent a provider result.
- Lint, TypeScript, production build, scenarios, security checks, Playwright
  and automated accessibility checks pass under Node 22.
- Fresh screenshots cover affected routes at required viewports, including
  both light and dark WhatsApp message treatment where supported.
- An independent reviewer checks the final diff against this contract before
  the pull request is offered for merge.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`,
  `docs/design/evo-platform/COMPLETION_CHECKLIST.md` and frontend screenshot or
  audit evidence under `docs/design/evo-platform/**`.
- `src/app/globals.css`, affected routes under `src/app/(staff)/**` and
  `src/app/portal/**`.
- Shared presentation components under `src/components/**` and existing
  presentation/query copy under `src/lib/**` only when needed for F1-F13.
- Focused public-behavior regression coverage under `tests/**`.

## Stop Conditions

Stop and escalate when:

- Required real credentials, provider accounts, data, or deployment targets are
  missing.
- A lane would need hidden mocks, demo paths, or fake success to pass.
- Scope, architecture, acceptance criteria, file ownership, or merge order needs
  to change and `docs/PLAN_CHANGES.md` has not been updated first.
- Independent reviewer approval is unavailable and the user has not explicitly
  waived the launch-control gate.
- Validation fails for reasons outside the lane's scope and cannot be fixed
  without changing the contract.

## Historical Final EVO Platform Technical Specification Slice

Completed predecessor slice: `/goal-evo-platform-final-tz`.

This slice turns the completed frontend, the audited repository, the
owner-supplied OZO technical brief, current production boundaries, business
process documentation, ADRs and design evidence into the implementation
contract for the unified EVO Admissions platform. P0 now corrects its remaining
role, ownership, environment, retention and release-gate gaps. Repository
implementation starts only after P0 merges; production mutations still require
their own explicit authorization.

### Scope

- Produce one canonical Russian-language specification covering business
  outcomes, actors, roles, workflows, data ownership, integrations,
  non-functional requirements, migration, release gates and acceptance tests.
- Treat the owner-supplied OZO brief as contextual input, not as automatically
  correct architecture or product truth. Preserve useful process requirements,
  record corrections, and expose unresolved decisions explicitly.
- Keep amoCRM canonical for lead/contact identity, responsible manager and
  sales stage. Keep operational admissions stages separate from the sales
  pipeline.
- Define one dedicated Supabase production project for all EVO-owned platform
  data. Keep local/dev, persistent staging and preview branches/projects
  physically isolated with the same migrations and no production-data copy by
  default. Do not create separate production projects for Inbox and CRM.
- Define one WAHA/WhatsApp ingress, idempotent event handling, durable message
  history, draft-only AI, manual outbound confirmation and delivery/read audit.
- Specify how useful Lead Agent responsibilities move into the unified backend.
  Retirement is allowed only after a controlled real end-to-end proof,
  reconciliation, rollback window and owner approval.
- Reuse the accepted EVO frontend and brand evidence as the interaction
  contract. Figma or prototype files are supporting design evidence, not a
  substitute for this technical specification.
- Distinguish verified current behavior, target requirements, assumptions,
  external blockers and future options throughout the document.

### Named write set

- `docs/EVO_LAUNCH_PLAN.md`, `docs/PLAN_CHANGES.md`: launch contract and
  append-only decision record.
- `docs/specs/EVO_PLATFORM_TZ.md`: canonical reviewable specification source.
- `docs/specs/EVO_PLATFORM_TZ.docx`: editable owner-facing specification.
- `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`: reproducible validation and
  page-inspection ledger.
- `scripts/generate-evo-platform-tz.py`: deterministic DOCX builder.
- `scripts/verify-evo-platform-tz.py`,
  `scripts/requirements-evo-platform-tz.txt`: isolated dependency, real
  LibreOffice/Poppler render and accessibility/traceability verification
  contract.
- Existing brand and implementation screenshots under `docs/company/brand/**`
  and `docs/design/evo-platform/**` may be read and embedded; they are not
  modified by this slice.

### Acceptance criteria

- Every `FR`, `NFR`, `INT`, `DATA`, `SEC`, `ACC` and `DEC` ID is listed
  individually in a provenance matrix that points to repository evidence,
  official provider documentation, the OZO brief or an explicit owner
  decision. Every requirement also has an explicit priority and verification
  method.
- Data ownership and synchronization rules prevent two independently writable
  lead/contact/sales-stage sources of truth.
- Roles and permissions cover both server-side authorization and visible UI,
  including denial, audit and privileged-action rules.
- The current plan keeps the production path reversible and retains Lead Agent,
  the legacy webhook/session and rollback path deployed/frozen. It does not
  authorize a retirement/removal PR.
- The original full-target journey remains explicit but deferred with P4:
  `WhatsApp -> amoCRM -> EVO Platform -> AI draft -> manual send ->
  delivery/read status -> audit history`. Current P8 accepts only the real
  executable amoCRM-independent P5-P7 portion and records the amoCRM segment as
  deferred, never passed.
- Unknown provider states, missing credentials and unverified integrations
  remain visibly blocked; no mock or configured flag is described as production
  proof.
- The DOCX uses the EVO brand, has a real heading hierarchy, marked table
  headers, meaningful image alt text and no secret or applicant personal data.
- A fresh Python environment installs the pinned DOCX dependency manifest, the
  repo-owned verifier builds the DOCX, renders it through real
  LibreOffice/Poppler, validates item-level traceability and writes structured
  accessibility evidence. The packaged document renderer is also used for the
  final owner-facing render.
- Every final page is visually inspected at original resolution and recorded in
  `docs/specs/EVO_PLATFORM_TZ_VALIDATION.md`; the automated accessibility audit
  has zero unresolved high, medium or low findings.
- All substantive owner-facing content comes from
  `docs/specs/EVO_PLATFORM_TZ.md`; the generator adds only presentation
  mechanics such as the branded cover, footer and Word TOC field.
- An independent reviewer checks the final specification against source
  evidence, architecture boundaries and acceptance criteria before merge.
- No production deployment, provider mutation, database migration, live
  WhatsApp send or amoCRM write occurs in this slice.

## Current P8D Disabled Deployment Slice

The first P8D attempt stopped safely before CRM or Inbox recreation because the
retained P8B images were `linux/arm64` while Hermes is `linux/amd64`. Lead Agent
was restored healthy and all production configuration was rolled back. The
P8B2 under issue #188 produced the exact platform-bound `linux/amd64`
candidate. P8C2 then bound its real retained manifest, evidence, SBOM/smoke
identities and current environment reconciliation. P8D2 under issue #202 loaded
the verified archives but stopped without restarts because its contract compared
platform-manifest digests with their parent OCI-index digests. P8B3 under issue
#205 then bound both identities and the exact portable archive graph. The active
next slice is staging-only P8D3 under issue #209 and
`docs/platform/p8d3-portable-amd64-staging.md`.

Current accepted release-control main:
`81ef7a6cb6d16404fbba53af695a80b04140cfa3`. Its exact-main CI run
`31894158294` completed successfully. P8C2 reconciled the real environments
without mutation, retained P8B application provenance at `050514...`, bound
the exact AMD64 image identities, and truthfully returned `blocked` because
portable identity, fresh staging, provider prerequisites, and deployment remain
incomplete.

The owner-authorized P8D2 attempt is closed as failed-safe evidence. All running
CRM, Inbox, Lead Agent and WAHA identities, start times, health and zero restart
counts remained unchanged; no provider call occurred. P8B3 now binds both the
OCI index and its portable AMD64 manifest plus archive/config/layer bytes. It is
local evidence generation only and grants no Hermes retry.

The current preflight records Inbox WAHA as `SCAN_QR_CODE`, canonical DNS as
absent and amoCRM credentials as incomplete. P8D must preserve those external
blockers truthfully rather than silently fixing or relabelling them. P8D3 may
reuse only the freshly hash-proven P8D2 transfer/load checkpoint, creates a new
rollback/evidence boundary and may not change a running service. Application
activation remains a later separately approved block. Current main now includes
migration `073` and updated future-candidate inventory; P8D3 does not relabel or
rebuild the frozen pre-`073` P8B3 application candidate. P8D4 must reconcile
that database/application compatibility before any deployment authorization.

## EVO Knowledge Launch Finalization

Block-ID: `EVO-KNOWLEDGE-LAUNCH-FINALIZE-2026-08-15`.

The owner authorizes finalizing the current Obsidian knowledge bases for first
AI use without making semantic Gmail processing or missing WhatsApp media a
launch blocker. Those archived sources remain preserved for later incremental
improvement. This block does not deploy an AI, send messages, inspect applicant
documents, process Gmail, retry WhatsApp media, or expose raw/sensitive content.

### Delivery blocks

1. Resolve the remaining manually created review notes by archiving status-only
   checklists and promoting only current, non-personal, sourced facts.
2. Create the client-vault marker `.evo-vault.json` with the closed object
   `{"kind":"evo_client_knowledge","canonical_path":"<resolved exact path>"}`.
   Publication rejects a missing, malformed, extra-key, symlinked or path-
   mismatched marker and any destination outside that exact marked vault.
3. Add a deterministic client-publication command that reads only approved
   internal Markdown, requires an explicit Russian allowlist, rejects sensitive
   or unresolved material, preserves provenance, and writes only beneath the
   marked client vault.
4. Publish a useful Russian client set covering EVO, services, admissions,
   countries, universities, prices and response policies. Mutable external
   facts must carry an official source and verification date; otherwise the
   client note must instruct staff to verify before quoting it.
5. Add a deterministic local retrieval check for both marked vaults and run
   real Russian control questions against the actual published Markdown. This
   proves the local knowledge artifacts are retrievable; it is not proof of a
   deployed model or provider integration.
6. Record an operational readiness report with exact counts, exclusions,
   deferred Gmail/WhatsApp work and remaining risks.

### Closed publication contract

- Allowlist path: `<client vault>/.Публикация клиентской базы.json`. It is a
  closed version-1 object with only `version` and `entries`. Every entry has
  exactly: `source_relative_path`, `source_sha256`, `destination_relative_path`,
  `content_class`, `personal_data_reviewed`, `authority`,
  `authority_reference`, `official_url`, and `verified_at`.
- `content_class` is only `stable_evo_policy` or `mutable_official_fact`, and
  `personal_data_reviewed` must be the JSON boolean `true`. Stable policy accepts
  only `owner_decision`; mutable facts accept only `official_source`. A source
  containing an email address or phone-like sequence is rejected regardless of
  the review flag. The publisher does not infer or downgrade a content class
  from keywords.
- `authority` is only `owner_decision` or `official_source`. Owner decisions
  require a non-empty internal decision-note reference; their `official_url`
  and `verified_at` are JSON null. Official-source entries require an HTTPS URL
  and ISO `YYYY-MM-DD` verification date; their `authority_reference` names the
  internal verification note. No missing/extra fields or mixed authority form
  is accepted.
- Source paths are normalized relative paths beneath the exact approved
  internal vault, must name regular non-symlink Markdown files and must match
  `source_sha256`. Destination paths are normalized Russian `.md` paths beneath
  the exact client vault and may not overwrite unmanaged files.
- The approved source is accepted only at the exact non-symlink path
  `<marked internal root>/Утверждено для внутреннего ИИ`; raw CLI path
  components are checked before canonicalization. Authority references are safe
  relative regular non-symlink Markdown paths in that approved vault. Owner
  references require exact frontmatter `тип: решение_владельца` and
  `статус: решено`; official references require `тип: протокол_проверки` and a
  valid `дата_проверки` ISO date.
- Published frontmatter contains exactly traceable fields for publication:
  `тип: клиентское_знание`, `управляется: evo_client_publisher`, source relative
  path/SHA, authority/reference, official URL and verification date. Null
  provenance remains explicit for owner decisions.
- Managed state lives at `<client vault>/.Манифест клиентской публикации.json`,
  a closed version-1 object containing the exact generated destination paths
  and their source/output SHA values. Stale deletion is restricted to paths in
  the prior valid manifest whose current file still has the managed marker.
- The publisher validates marker, allowlist, all sources, all destinations,
  provenance and the existing managed manifest before any write or deletion.
  It also resolves and reads every stale managed candidate before mutation.
  Missing/malformed/traversal/symlink/hash/provenance errors fail with zero
  mutation.

### Deterministic retrieval gate

- CLI: `scripts/knowledge_ingestion/check_retrieval.py`; committed cases:
  `scripts/knowledge_ingestion/retrieval_cases.json`; report:
  `<internal vault>/Панель управления/Отчёт проверки поиска.json`.
- Cases use a closed version-1 schema with `vault` (`internal` or `client`),
  Russian `query`, `top_k`, and one or more exact expected relative paths. A
  case passes only when an expected path is in the deterministic top-k result.
- The initial fixed cases cover client questions about EVO, result wording,
  China documents, study price and admissions; internal cases cover client
  handoff, source authority, review flow and China working data.
- The checker accepts only the two exact marked roots, walks regular non-symlink
  Markdown beneath the selected root and records result paths/scores. It rejects
  any case/path resolving into `Сырой архив ЭВО` or `Секреты и доступы ЭВО`,
  any root/marker mismatch and any unexpected fixture field. Exit is non-zero
  if any expected top-k result or forbidden-root assertion fails.

### Acceptance criteria

- Gmail semantic processing and 396 failed WhatsApp media downloads are marked
  deferred, not complete and not required for first launch.
- Raw exports, correspondence, applicant files, credentials, contracts with
  personal fields, and internal-only process notes never enter the client vault.
- Client publication is allowlist-only, fail-closed, repeatable and tested for
  traversal, unmanaged-file preservation, sensitive-content rejection and
  deterministic stale cleanup.
- Marker tests reject missing, malformed, symlinked and canonical-path-mismatched
  client markers; allowlist tests reject unknown fields, wrong SHA, invalid
  provenance and destinations outside the exact client vault before mutation.

## Active slice: `/goal-evo-platform-knowledge`

### Outcome

Connect the two approved Obsidian knowledge layers to the production EVO Inbox
without exposing raw archives or internal notes to client-reply generation.
Obsidian remains the owner-edited source; Supabase is the account-scoped runtime
index; Gemini produces operator-reviewed drafts only. No autonomous WhatsApp
send is authorized.

### Delivery blocks

1. `K1` records this architecture and its closed publication, database,
   retrieval, deployment and real-evaluation contract. It changes no runtime.
2. `K2` adds an explicit `client` / `internal` audience to knowledge documents,
   chunks and retrieval RPCs; existing unclassified production documents become
   `internal`. Client draft and playground paths request only `client` chunks.
3. `K3` adds deterministic bundle construction from the two exact marked local
   vaults and a one-shot server-side importer. The client bundle contains all
   regular non-symlink Markdown in the exact client vault except `.obsidian`,
   publication journals and hidden control files. The internal bundle contains
   only regular non-symlink Markdown under `Утверждено для внутреннего ИИ`.
4. `K4` adds an authenticated staff-only internal assistant surface. It retrieves
   only `internal` chunks, calls the account's existing active Gemini config,
   returns a draft plus source-note identities, records the same provider and
   retrieval audit metadata used by client drafts, and cannot send WhatsApp.
5. `K5` deploys only after reviewed PRs, green exact-head/main CI and the current
   release gate. It applies the migration, imports both real bundles, reindexes,
   runs fixed Russian retrieval cases and executes one explicitly authorized
   real Gemini draft for each audience. Automatic reply remains disabled.

### Closed data and sync contract

- `ai_knowledge_documents.audience` and `ai_knowledge_chunks.audience` are
  required text values restricted to `client` or `internal`. Chunk audience is
  copied from its parent document; retrieval RPCs require an audience argument
  and filter it together with `account_id` before ranking.
- Managed documents also carry `source_path`, `source_sha256` and
  `managed_by = 'evo_obsidian_sync'`. A closed check constraint requires all
  three to be non-null for managed rows and all three to be null for manual
  rows. The unique partial managed identity is
  `(account_id, audience, source_path)`. Existing/manual documents remain
  preserved but migrate to `internal`; they are never silently promoted to
  client knowledge.
- A bundle is UTF-8 canonical JSON (`sort_keys=true`, compact separators, one
  final LF) named `evo-knowledge-<audience>.json`. It is a closed version-1
  object with `version`, `account_id`, `audience`, `vault_kind`, `marker_sha256`,
  and `documents`; it contains no clock-derived field. Each
  document has exactly `source_path`, `source_sha256`, `title`, and `content`.
  `source_path` is NFC-normalized POSIX syntax relative to the exact marked
  client root for `client`, and relative to the exact approved child for
  `internal`. It must be a non-empty visible `.md` path with no absolute form,
  backslash, dot segment, hidden segment or symlink component and must resolve
  to a regular file strictly inside that lexical root.
- Its manifest is exactly `evo-knowledge-<audience>.sha256.json`, canonicalized
  the same way, with only `version`, `account_id`, `audience`, `bundle_file`,
  and `bundle_sha256`; the SHA covers the exact bundle bytes. The importer
  requires exact account/audience/file agreement and re-hashes before parsing.
  `marker_sha256` binds the exact local `.evo-vault.json` bytes; the server does
  not treat the workstation absolute path inside that marker as authorization.
  Generation time belongs only to the unhashed operational report. Rebuilding
  the same account/audience/vault bytes produces byte-identical bundle and
  manifest files and the same SHA.
- Bundle creation validates the exact non-symlink vault marker and every path,
  rejects symlink components, invalid UTF-8, non-Markdown files, duplicate
  paths, wrong hashes and any path containing raw/secrets roots. Both audiences
  unconditionally reuse `contains_email()` and `contains_phone()` from
  `scripts/knowledge_ingestion/review.py`; either match aborts the entire bundle.
  Tests include formatted/international phones, continuous 10/16-digit runs,
  email case variants, invalid UTF-8 and symlinked parent components.
- The importer runs inside the private EVO Inbox execution boundary with the
  existing service-role credential. It requires an explicit account id, validates
  the complete bundle before mutation, upserts only managed identities for the
  declared audience, rebuilds their chunks, and deletes stale documents only
  when they are still marked `evo_obsidian_sync` for that audience. Manual and
  opposite-audience documents are never deleted.
- Before database mutation, the importer deterministically chunks every document
  and obtains/validates every required embedding in memory. It then calls the
  single service-role-only Postgres function
  `public.sync_ai_knowledge_bundle(uuid,text,text,jsonb)`, passing account,
  audience, bundle SHA and the fully materialized documents/chunks. The function
  revokes `PUBLIC`/`anon`/`authenticated`, grants only `service_role`, validates
  the closed payload again, takes `pg_advisory_xact_lock` on the account/audience
  identity, upserts documents, replaces their chunks, deletes only stale managed
  rows for that audience, records the bundle SHA, and returns counts in its one
  database transaction. Any exception rolls back every write. The existing
  delete-then-insert `ingestDocument()` is not used by this importer.
- The fourth RPC argument is a closed JSON object with exactly `version: 1` and
  `documents`. Each document has exactly `source_path`, `source_sha256`, `title`,
  `content`, and `chunks`. Each chunk has exactly `chunk_index`, `content`,
  `content_sha256`, and `embedding`; indices are consecutive integers from zero,
  content is non-empty and SHA-256 matches its UTF-8 bytes, and embedding is an
  array of exactly 1,536 finite JSON numbers. Document identity is the managed
  `(account_id,audience,source_path)` row; chunk identity is that document plus
  `chunk_index`. Empty documents/chunks, duplicate paths/indices and extra keys
  reject the whole RPC. The lock is exactly
  `pg_advisory_xact_lock(hashtextextended(account_id::text || chr(31) || audience, 0))`.
  The RPC returns exactly `version`, `account_id`, `audience`, `bundle_sha256`,
  `documents_upserted`, `documents_deleted`, and `chunks_replaced`; counts are
  non-negative integers and are committed in the same transaction.
- A failed validation, embedding/provider error or database error is reported as
  failure. There is no keyword, mock or partial-success fallback during import.

### Security and behavior invariants

- Client reply generation, playground evaluation and any later auto-reply path
  can retrieve only `client` knowledge. Internal retrieval is available only to
  authenticated EVO staff and never enters a client reply prompt.
- `owner`, `admin` and `agent` are staff for this slice; `viewer` has no direct
  document/chunk/RPC or assistant access. Direct table SELECT and retrieval RPCs
  require `is_account_member(account_id, 'agent')`; document mutation remains
  admin/owner-only. Retrieval RPCs remain `authenticated` but are SECURITY
  INVOKER and RLS-bound. The sync RPC is service-role-only. Client draft and
  playground routes require `agent` and hard-code `client`; the internal route
  requires `agent` and hard-codes `internal`; manual knowledge CRUD requires
  `admin`, always creates/updates `internal` manual rows, and cannot accept an
  audience override. Negative route/RLS tests cover
  anonymous, viewer, cross-account, client-to-internal parameter injection and
  direct internal table/RPC reads.
- `Сырой архив ЭВО`, `Секреты и доступы ЭВО`, WhatsApp originals, Gmail MBOX,
  applicant files and unapproved review notes are rejected at bundle creation
  and absent from runtime storage.
- Gemini credentials stay encrypted in the existing account configuration.
  Logs, reports, bundles, Git and chat output never contain keys, message bodies
  or customer personal data.
- All generated answers are drafts. No endpoint in this slice calls WAHA or
  changes the existing disabled automatic-reply state.

### Assistant API and immutable audit contract

- Existing `POST /api/ai/playground` remains agent-or-higher and accepts only
  `{messages,evaluation_case_id?}`. `messages` contains 1–20 exact objects with
  only `role` (`user` or `assistant`) and trimmed `content` (1–4,000 characters).
  The optional id is only `client_china_documents`; unknown/extra fields return
  HTTP 400. It hard-codes `client` retrieval.
- New `POST /api/ai/internal-assistant` is agent-or-higher and accepts only
  `{message,evaluation_case_id?}` with trimmed `message` of 1–4,000 characters;
  the optional id is only `internal_malaysia_handoff`. It hard-codes `internal`.
  Both success responses contain exactly `reply`, `handoff`, `sources`, and
  `audit_id`; each source has only UUID `chunk_id` and normalized `source_path`.
  Errors contain only `error` and stable `code`, with 400 validation/config,
  401 unauthenticated, 403 insufficient role, 429 limit, or 502 provider/audit
  failure. A generation is never returned if its audit insert fails.
- `ai_assistant_audits` has UUID `id`, required account FK, audience check,
  nullable evaluation-case id restricted to the case matching its audience,
  provider/model text, and non-empty closed JSONB `knowledge_sources`; every
  element has exactly UUID `chunk_id` and normalized `source_path`, chunk ids
  are unique and repeated source paths are allowed. It also has 64-lowercase-hex
  `response_sha256`, boolean
  `handoff`/`success`, required actor FK, `created_at`, and `expires_at` fixed to
  `created_at + interval '90 days'`. It stores no prompt or response body.
  Account agents may SELECT through RLS. `anon`/`authenticated` cannot
  INSERT/UPDATE/DELETE; server routes insert with service role after role checks.
  UPDATE always raises; DELETE raises before expiry. A service-role-only
  `purge_expired_ai_assistant_audits()` deletes only expired rows and returns a
  count. Existing conversation-bound `ai_drafts` remains unchanged.

### Bundle transport and retention

- The builder writes the bundle, manifest and body-free generation report to a
  fresh `mktemp -d` directory under local `/private/tmp`, directory mode 0700
  and files 0600. It never writes them to Git, an Obsidian vault or an image.
- The operator transfers exactly the bundle and manifest over the existing SSH
  host `hermes-vps` into a collision-free
  `/opt/evo-inbox/knowledge-imports/<UTC>-<bundle-sha-prefix>/` directory owned
  by root mode 0700 with files mode 0600. The import id is strict UTC basic time
  plus the first 12 lowercase bundle-SHA characters; no glob is accepted.
  Host SHA and manifest/account/audience are verified before `docker cp` copies
  the two exact files into `/tmp/evo-knowledge-import/<import-id>/` in the exact
  Inbox app container with the same modes. The importer re-verifies before RPC.
- A trap runs on success and failure and removes only the two exact files and
  their now-empty exact staging directory from container, host and local temp;
  cleanup failure makes K5 fail. Bundles never persist in an image or volume.
  Only a root-owned 0600 redacted report containing hashes, counts, statuses and
  no note body remains under `/opt/evo-inbox/evidence/knowledge/`.

### Acceptance and real proof

- Migration/RLS/grant tests prove account and audience isolation, required
  audience filtering and fail-closed invalid values.
- Unit/integration tests use the real local Supabase stack on OrbStack; no mocked
  database/provider result counts as acceptance. UI/build/type/lint checks pass.
- Real vault bundle reports include exact document counts and hashes while
  excluding raw, secrets, hidden controls and symlinks. Repeated import is
  idempotent; a removed managed note is deleted only from its own audience.
- Production proof records image/revision, migration state, managed document and
  chunk counts per audience, retrieval case results, active provider/model,
  auto-reply disabled state and source identities for two real Gemini drafts.
  Fixed committed cases live in
  `scripts/knowledge_ingestion/platform_eval_cases.json`: client case
  `client_china_documents` asks in Russian which China-admission documents to
  prepare and requires exact source `Страны/Китай/Документы для поступления — порядок уточнения.md`;
  internal case `internal_malaysia_handoff` asks in Russian how sales hands a
  Malaysia student to the overseas-education team and requires exact source
  `Процессы/Передача студента из ОП в ОЗО по Малайзии — 68fe88af5a26.md`.
  Both run through authenticated admin playground/assistant routes with synthetic
  non-customer messages, never a real conversation. Each route writes an
  immutable `ai_assistant_audits` row containing account, audience, case id,
  provider, model, closed knowledge sources, response SHA-256, success, actor and
  timestamp but no prompt or draft body. Rows are retained 90 days. The report
  `docs/evidence/evo-platform-knowledge-k5-eval.json` contains only those safe
  fields plus HTTP status, expected-source match, cross-audience-source count
  (must be zero), auto-reply state and send-endpoint-call count (must be zero).
  Draft text and private source contents are neither committed nor logged.
- Any missing credential, migration drift, account ambiguity, provider failure,
  retrieval leakage, unexpected production image, failed CI or release-gate
  conflict stops deployment and is reported plainly.
- Tests also reject symlinked approved/client roots or path components,
  misclassified stable/mutable material, false personal-data review flags,
  email/phone content and unreadable stale candidates with zero mutation.
- Every published client note is Russian, has provenance and is either stable
  owner-approved EVO knowledge or has an official URL plus verification date.
- Actual internal and client vault retrieval checks pass every committed case's
  expected-path-in-top-k assertion and the machine-readable report confirms
  that neither raw nor secrets roots were searched.
- Focused tests pass, an independent reviewer approves the exact PR head, CI is
  green and the final report does not claim a live AI/provider deployment.

### P8D4I deterministic knowledge report correction

Issue #238 corrects only the deterministic knowledge report comparison used by
the production runner. Canonical bundle and manifest bytes must match exactly
across the two builds. The reports must validate as closed objects and match on
all stable fields; only their deliberately different generation time and
temporary output directory are excluded. Reports remain UUID-bearing temporary
validation artifacts and must be removed before deployment under P8D4H. This
does not add provider, production, customer-data or outbound authority.

### P8D4J merged-runner execution control

Issue #239 requires P8D4G to remain blocked after the implementation merge
until a separate reviewed control artifact binds that merged implementation's
commit, tree, exact-main CI and exact runner-file hashes. A production preflight
must additionally prove a clean checkout at current GitHub `main` with green
required checks and record the actual execution commit/tree/CI. This prevents a
later or dirty runner from claiming the earlier reviewed identity and grants no
production authority by itself.

### P8D4K live Inbox pilot fallback correction

Issue #242 corrects the pre-deployment connectivity gate discovered after the
P8D4J control merged. `inbox.evoadmissions.com` currently has no DNS record,
while the already-configured and TLS-valid EVO edge fallback
`evo-inbox.72.62.119.112.sslip.io` reaches the same Inbox application. The two
authorized draft-only staff pilot POSTs must use that exact fallback origin;
all paths, cookie handling, call limits, body-free audit verification,
side-effect checks and rollback rules remain unchanged. This correction makes
no DNS, Caddy, WAHA, Supabase, container, customer-data or candidate change.
Its merged operations hash must be rebound by a separate reviewed execution-
control metadata update before a fresh preflight or production execution.

### P8D4L Hermes preflight source-mode correction

Issue #245 records the first real P8D4G preflight's safe stop before any
provider or production mutation. The corrected preflight keeps the four secret
environment sources at exact `root:root 0600`, accepts only the observed exact
retained Compose modes (CRM `0644`, Inbox `0644`, Lead Agent `0600`), and keeps
regular-file, non-symlink, ownership, path, root-absence and candidate-tag
checks fail closed. The failed result remains preserved. A retry uses the new
collision-free release/evidence identity `2026-08-16.p8d4l.1` and release
version `p8d4l-20260816`.

No candidate, migration, knowledge, secret, Supabase, Gemini, WhatsApp/WAHA,
amoCRM, DNS, Caddy, container or autonomous-reply boundary changes. The
corrected implementation and then its separate execution-control metadata must
each be independently reviewed, merged and green on exact main before a fresh
read-only production preflight.

### P8D4M Hermes container-row protocol correction

Issue #248 records the P8D4L preflight's second safe stop. All five named
production containers were independently observed with their expected images,
healthy state and restart count zero; only the verifier failed because Docker
printed `\t` literally while the parser expected tab bytes. P8D4M uses one
closed literal `|` row protocol with behavioral coverage and advances the retry
to collision-free release ID `2026-08-16.p8d4m.1` and release version
`p8d4m-20260816`.

No application image, migration, knowledge, secret, provider, Supabase,
Gemini, WhatsApp/WAHA, amoCRM, DNS/Caddy, container or autonomous-reply
boundary changes. The verifier fix and its later execution-control rebind must
each pass independent review, merge and exact-main CI before another read-only
production preflight.

### P8D4N optional Docker image Variant correction

Issue #251 records the P8D4M staging stop. The read-only P8D4M preflight was
green, but Hermes omitted the optional Docker image `Variant` key for the exact
`linux/amd64` CRM candidate. Docker's Go template treated the missing key as an
error, so execution stopped before configuration, migrations, knowledge,
deployment or Gemini. All five running production containers remained healthy
on their prior images with restart count zero.

P8D4N parses full inspect JSON and accepts only `linux/amd64` with either an
omitted or empty variant. Any other or malformed platform remains blocking.
The P8D4M failure roots and result remain immutable. The already-loaded exact
CRM source tag may be reused only after its frozen image ID, candidate revision
and `linux/amd64` missing/empty-variant platform verify; the CRM Compose tag and
all Inbox/Lead candidate tags must remain absent. The next attempt uses
collision-free release ID `2026-08-16.p8d4n.1`, release version
`p8d4n-20260816`, and confirmation
`EXECUTE-P8D4N-2026-08-16.P8D4N.1`.

Candidate images, `001-076`, frozen 11/291 knowledge, disabled outbound state,
two staff-only draft pilots, cleanup, rollback and privacy boundaries do not
change. Implementation and its separate execution-control metadata must pass
independent review, merge and exact-main CI before another read-only preflight.

### P8D4O Hermes runtime image identity correction

Issue #254 records the safe P8D4N preflight stop. No staging, configuration,
migration, knowledge import, Gemini call, application deployment, WhatsApp
send or amoCRM write occurred. All five production containers remain on the
prior exact images, healthy, with restart count zero.

The immutable portable identity contains two distinct identities per image:
the OCI index digest used by OrbStack/archive provenance and the selected
`linux/amd64` platform-manifest digest used as Docker's runtime image ID on
Hermes. P8D4O keeps both and checks them at their actual boundaries. Archive
evidence remains bound to the OCI index; Hermes tag/container/importer/deploy
evidence is bound to CRM `34c0f380...`, Inbox `dfc1aae9...`, and Lead Agent
`a50289ff...`. Revision, platform, tag absence, rollback and disabled-state
checks remain mandatory.

The prior P8D4N local failure result is immutable. The next collision-free
identity is release ID `2026-08-16.p8d4o.1`, release version
`p8d4o-20260816`, and confirmation
`EXECUTE-P8D4O-2026-08-16.P8D4O.1`. Implementation and its separate
execution-control metadata must pass independent review, merge and exact-main
CI before another fresh read-only preflight.

### P8D4P named non-root importer correction

Issue #257 records the real P8D4O `knowledge_failed` stop. The exact 11-client
and 291-internal production-account bundles rebuild twice with byte-identical
frozen hashes, so neither the live account identity nor the knowledge vault is
the failure. The isolated Inbox importer was created from exact runtime image
`sha256:dfc1aae9743e2b6bf6d7e174933c36cd89e03e5d769b859f2aaaa557a7a68af3`,
but Docker reports its configured user as the Dockerfile name `nextjs`; the
adapter incorrectly required the literal string `1001`.
That image creates `nextjs:nodejs` with UID/GID `1001:1001` before switching to
`USER nextjs`.

P8D4P must verify both layers: exact `.Config.User=nextjs`, then an actual
container command proving username `nextjs`, UID `1001`, GID `1001`, and a
non-root process. Empty, numeric-only, root, wrong-name, wrong-UID/GID, command
failure, wrong image, platform or revision all fail closed before bundle copy.

P8D4O staging left the exact source and Compose tags for CRM, Inbox and Lead
Agent on Hermes while all running application containers remained unchanged.
P8D4P therefore requires one exact inventory record for each of those six tags,
full image/revision/platform validation, and performs no image load or retag.
It still transfers and verifies the four reviewed portable artifacts under its
new absent release root so the new result remains independently auditable.

The P8D4O local and Hermes failure results remain immutable at SHA-256
`35720cbdc88a9d4407d734c62a10f75f31dcaa6b58d88675a9a25587e1b87ce0`.
The retry uses release ID `2026-08-16.p8d4p.1`, release version
`p8d4p-20260816`, importer name `evo-p8d4p-knowledge-import`, and confirmation
`EXECUTE-P8D4P-2026-08-16.P8D4P.1`. A separate execution-control rebind and
fresh successful preflight are mandatory before requesting the new action-time
confirmation.

### P8D4Q bounded knowledge transfer retry

Issue #260 records the real P8D4P stop. P8D4P completed preflight, exact
candidate staging, rollback capture, disabled configuration and a verified
`001-076` migration no-op. It also resolved exactly one active production
account, rebuilt both frozen 11/291 audiences twice, and verified the isolated
`nextjs|1001|1001` importer. The first client knowledge `scp` failed before a
remote audience pair was recorded. Finally-style cleanup removed every created
local bundle root and the importer; no database import, deployment, restart,
Gemini pilot, WhatsApp send or amoCRM write occurred.

A later read-only diagnostic repeated the real client build and the same two
SSH/SCP transfers without importing. Both remote hashes matched the locally
built bytes and cleanup verified absence. P8D4Q therefore changes only that
transport seam: each of the four unchanged knowledge bundle/manifest `scp`
operations may be attempted at most three times, within the existing operation
deadline. The source path, destination path and bytes cannot change between
attempts. The existing remote and container SHA-256 comparisons remain
mandatory before either import.

The immutable P8D4P evidence remains retained. The retry uses release ID
`2026-08-17.p8d4q.1`, release version `p8d4q-20260817`, importer
`evo-p8d4q-knowledge-import`, and confirmation
`EXECUTE-P8D4Q-2026-08-17.P8D4Q.1`. Independent review, merge, exact-main CI,
a separate reviewed execution-control rebind, fresh successful preflight and
new action-time confirmation are required before execution. No provider,
deployment, send, customer-data, credential or knowledge-content authority is
added.

### P8D4R time-spaced knowledge transfer retry

Issue #267 records the real P8D4Q stop. The run verified preflight, exact
candidate staging, rollback capture, disabled configuration and the
`001-076` migration no-op, then stopped with `knowledge_failed`. Cleanup
removed all four local build roots and the isolated importer. No complete
remote audience pair, database import, application deployment, restart,
Gemini pilot, WhatsApp send or amoCRM write occurred. Its closed local result
is retained at release identity `2026-08-17.p8d4q.1` with SHA-256
`233d69ad88664500354be880e328a1618dffbd646085c08a1f5cb28f4064e90a`.

The later bounded transfer-only diagnostic succeeded with the same live
account resolution, frozen client input, builder, SSH route and exact remote
hash checks, then removed every diagnostic artifact. This proves that a later
transfer can succeed; it does not prove an import or deployment. P8D4R keeps
the same maximum of three attempts per bundle or manifest, but schedules them
at 0, 10 and 40 seconds from the start of that file's transfer sequence. Before
each attempt it recomputes the source SHA-256 and the remaining authorization
time. It must stop before sleeping or copying if the next pause cannot fit, and
must recheck the deadline after the pause. Only the exact `scp` operation has
this behavior; no build, import, migration, deployment, provider or pilot call
gains retries. Node's documented promise-based timer is the implementation
primitive, while `scp` remains the same SFTP-over-SSH command whose nonzero
exit is treated as failure:
https://nodejs.org/api/timers.html#timers-promises-api and
https://man.openbsd.org/scp.1.

The retry advances to release ID `2026-08-17.p8d4r.1`, release version
`p8d4r-20260817`, importer `evo-p8d4r-knowledge-import`, and confirmation
`EXECUTE-P8D4R-2026-08-17.P8D4R.1`. P8D4Q and all prior local/Hermes release,
rollback and evidence roots remain immutable. The exact candidate, six staged
image tags, portable artifacts, 11/291 knowledge contents, `001-076` migration
boundary, disabled outbound state, two-call pilot cap, cleanup, rollback,
privacy, no-WAHA-change, no-amoCRM-write, no-autonomous-send and
no-customer-send boundaries are unchanged. Independent review, merge,
exact-main CI, a separate reviewed execution-control rebind, fresh successful
preflight and a new action-time confirmation are required before execution.

### P8D4S truthful partial knowledge failure evidence

Issue #270 records the real P8D4R stop and the independent review finding. The
P8D4R result is retained unchanged at release identity
`2026-08-17.p8d4r.1`, locally and on Hermes as a regular mode-`0600` file with
SHA-256
`9217322cf48f96daadd8ef780732b8c29cc54e9234bc4c6e2b8ecfbe4c459577`.
It truthfully proves preflight, staging, disabled configuration and the
`001-076 -> 001-076` migration no-op, plus `knowledge_failed`, verified
cleanup, no deployment and no pilot. It does not truthfully preserve partial
knowledge progress: `cleanup.local_roots_removed=4` proves both deterministic
audience build paths created their two independent roots, while
`knowledge.account_resolution`, `knowledge.deterministic_builds` and both
audiences are recorded as `not_run`.

P8D4S makes partial progress part of the closed result contract. The
production adapter reports a UUID-free snapshot after singular account
resolution, after every deterministic audience build, before each transfer
attempt and after each completed audience import. On terminal knowledge
failure the result retains only safe status, document counts, bundle/manifest
SHA-256 values already approved for evidence, a fixed failure-step enum and a
bounded attempt number when the failed step is an `scp` transfer. It never
retains the account UUID, customer/staff content, command text, stderr,
credentials, cookies, provider payloads or private filesystem paths. A
successful result still requires two fully verified database revisions and no
failure marker.

The retry advances to release ID `2026-08-17.p8d4s.1`, release version
`p8d4s-20260817`, importer `evo-p8d4s-knowledge-import`, and confirmation
`EXECUTE-P8D4S-2026-08-17.P8D4S.1`. P8D4R and all prior local/Hermes release,
rollback and evidence roots remain immutable. The exact candidate, portable
artifacts, staged image identities, frozen 11/291 knowledge, migrations
`001-076`, disabled outbound flags, cleanup, rollback, no-WAHA-change,
no-amoCRM-write, no-autonomous-send, no-customer-send and maximum two fixed
staff-only draft calls do not change.

Another production attempt remains blocked until this implementation has an
independently approved exact-head PR, merge and exact-main green CI; a separate
reviewed execution-control metadata PR is merged and green; a new real
read-only preflight passes; and the owner provides the exact new action-time
confirmation. P8D4S grants no new production, provider, customer-data,
knowledge-content, outbound or billed-resource authority.

## P8D4T transfer evidence correction

Issue #273 and Plan Block-ID
`EVO-PLATFORM-P8D4T-TRANSFER-EVIDENCE-2026-08-18` close the final two
read-only review findings before an owner token is requested. Every
client/internal bundle/manifest transfer now distinguishes four safe states:
backoff, authorization deadline, local bytes and the real `scp` attempt. Only
the real `scp` failure may retain an attempt number. The adapter publishes the
UUID-free knowledge progress projection at each retry-state boundary, so a
terminal failure retains the exact safe step rather than an inferred one.

P8D4T uses release ID `2026-08-18.p8d4t.1`, version `p8d4t-20260818`, importer
`evo-p8d4t-knowledge-import` and confirmation
`EXECUTE-P8D4T-2026-08-18.P8D4T.1`. The schema and behavioral tests pin the
new deadline enum, null attempt on every non-`scp` state and ordered progress
callbacks. P8D4S preflight SHA-256
`27bcb7e425b991051c462523414c46091f960f90abe8155cba5beadabbfc3a26`
and every earlier artifact remain immutable.

Candidate images, `001-076`, frozen 11/291 knowledge, disabled outbound state,
cleanup, reverse rollback, maximum two staff-only draft calls, no WAHA change,
no amoCRM access and no customer send remain unchanged. Implementation review,
merge, exact-main CI, a separate execution-control rebind, fresh read-only
preflight, process-only staff-session verification and a new owner token remain
mandatory before execution.
